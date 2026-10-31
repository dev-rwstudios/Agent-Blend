/**
 * The scene plan the model writes, and the code that makes it safe to use.
 *
 * The model describes rooms and furniture with *intent* ("bed against the
 * north wall") — never raw coordinates for furniture. `normalizePlan` turns
 * whatever the model produced into a complete, bounded plan: unknown values
 * get sensible defaults, sizes are clamped to realistic ranges, references
 * are checked, and every change is reported as a note.
 *
 * Pure module (no browser/Tauri APIs) so it runs under `node --test`.
 */

export type Wall = 'north' | 'south' | 'east' | 'west';
export type Corner = 'ne' | 'nw' | 'se' | 'sw';
export type Placement =
  | 'against_wall'
  | 'corner'
  | 'center'
  | 'next_to'
  | 'in_front_of'
  | 'on_top_of'
  | 'on_wall'
  | 'ceiling';

export const WALLS: Wall[] = ['north', 'south', 'east', 'west'];
export const PLACEMENTS: Placement[] = [
  'against_wall', 'corner', 'center', 'next_to', 'in_front_of', 'on_top_of', 'on_wall', 'ceiling',
];

export interface Opening {
  wall: Wall;
  /** Room id on the other side, or "outside". */
  to?: string;
  /** Center of the opening, in meters from the wall's west/south end. Default: middle. */
  offset?: number;
  width: number;
  height: number;
  /** Bottom of the opening above the floor (0 for doors). */
  sill: number;
}

export interface Room {
  id: string;
  name: string;
  /** What the space is for ("bedroom", "kitchen", …) — matched against assets' room_types metadata. */
  purpose?: string;
  width: number;
  depth: number;
  height: number;
  /** Optional south-west corner; rooms without it are packed automatically. */
  x?: number;
  y?: number;
  doors: Opening[];
  windows: Opening[];
}

export interface Item {
  id: string;
  room: string;
  /** Plain description used to find an asset ("queen bed", "floor lamp"). */
  what: string;
  placement: Placement;
  wall?: Wall;
  align?: 'start' | 'center' | 'end';
  corner?: Corner;
  target?: string;
  side?: 'left' | 'right';
  /** Gap in meters for in_front_of. */
  distance?: number;
  /** Center height in meters for on_wall. */
  height?: number;
  /** Specific catalog asset chosen by the model or the user. */
  asset_id?: string;
  /** One sentence: why this object goes here (shown to the user, used in review). */
  reason?: string;
  /**
   * Quarter turns (0–3, counter-clockwise) added to the asset's measured facing.
   * The correction when an asset faces the wrong way; remembered for that asset.
   */
  turn?: number;
  /**
   * The model's estimate of the object's real-world size [width, depth, height]
   * in meters. Used to reject assets that can't be right (wrong scale, broken
   * exports) and to size placeholders — for any kind of object, no built-in list.
   */
  size?: [number, number, number];
}

export interface ScenePlan {
  /** "layout" = rooms + furniture; "edit" = not a layout task (use the normal tool flow). */
  kind: 'layout' | 'edit';
  summary: string;
  /** Build floors and walls (false = furnish only, e.g. an existing room). */
  structure: boolean;
  /** Where objects come from: the asset library, or shapes designed live from boxes/cylinders. */
  assets: 'library' | 'shapes';
  rooms: Room[];
  items: Item[];
}

export interface NormalizeResult {
  plan: ScenePlan;
  /** Fatal problems — the plan can't be used. */
  errors: string[];
  /** Things that were corrected automatically. */
  notes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
}

function uniqueId(base: string, used: Set<string>): string {
  let id = slug(base);
  let n = 2;
  while (used.has(id)) id = `${slug(base)}_${n++}`;
  used.add(id);
  return id;
}

function asWall(v: unknown): Wall | undefined {
  const s = str(v).toLowerCase();
  const map: Record<string, Wall> = { n: 'north', s: 'south', e: 'east', w: 'west', back: 'north', front: 'south', left: 'west', right: 'east' };
  return (WALLS as string[]).includes(s) ? (s as Wall) : map[s];
}

function normalizeOpening(raw: any, kind: 'door' | 'window', roomName: string, notes: string[]): Opening | null {
  const wall = asWall(raw?.wall);
  if (!wall) {
    notes.push(`Ignored a ${kind} in ${roomName} with no valid wall.`);
    return null;
  }
  const isDoor = kind === 'door';
  return {
    wall,
    to: str(raw?.to) || undefined,
    offset: num(raw?.offset),
    width: clamp(num(raw?.width) ?? (isDoor ? 0.9 : 1.2), isDoor ? 0.7 : 0.4, isDoor ? 2.4 : 4),
    height: clamp(num(raw?.height) ?? (isDoor ? 2.1 : 1.2), 0.4, isDoor ? 2.4 : 2.2),
    sill: isDoor ? 0 : clamp(num(raw?.sill) ?? 0.9, 0.2, 1.8),
  };
}

/** Turn the model's JSON into a complete plan, or explain why it can't be used. */
export function normalizePlan(raw: any): NormalizeResult {
  const errors: string[] = [];
  const notes: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { plan: emptyPlan(), errors: ['The plan is not a JSON object.'], notes };
  }

  const kind = raw.kind === 'edit' ? 'edit' : 'layout';
  const summary = str(raw.summary) || 'Scene build';
  const structure = raw.structure !== false;
  const assets: 'library' | 'shapes' = /shape|primitive|scratch/i.test(str(raw.assets)) ? 'shapes' : 'library';

  // Rooms
  const roomIds = new Set<string>();
  const rooms: Room[] = [];
  const rawRooms: any[] = Array.isArray(raw.rooms) ? raw.rooms : [];
  for (const r of rawRooms.slice(0, 12)) {
    const name = str(r?.name) || str(r?.id) || `Room ${rooms.length + 1}`;
    const id = uniqueId(str(r?.id) || name, roomIds);
    const width = clamp(num(r?.width) ?? 4, 1.5, 20);
    const depth = clamp(num(r?.depth) ?? 4, 1.5, 20);
    if (num(r?.width) !== width || num(r?.depth) !== depth) notes.push(`Room "${name}" size set to ${width}×${depth} m.`);
    const room: Room = {
      id,
      name,
      purpose: str(r?.purpose) || name,
      width,
      depth,
      height: clamp(num(r?.height) ?? 2.7, 2.2, 5),
      x: num(r?.x),
      y: num(r?.y),
      doors: [],
      windows: [],
    };
    for (const d of Array.isArray(r?.doors) ? r.doors : []) {
      const o = normalizeOpening(d, 'door', name, notes);
      if (o) room.doors.push(o);
    }
    for (const w of Array.isArray(r?.windows) ? r.windows : []) {
      const o = normalizeOpening(w, 'window', name, notes);
      if (o) room.windows.push(o);
    }
    rooms.push(room);
  }

  if (kind === 'layout' && rooms.length === 0) {
    rooms.push({ id: 'room', name: 'Room', width: 5, depth: 4, height: 2.7, doors: [], windows: [] });
    notes.push('No rooms were given — using one 5×4 m room.');
  }

  // Items
  const itemIds = new Set<string>();
  const items: Item[] = [];
  const rawItems: any[] = Array.isArray(raw.items) ? raw.items : [];
  for (const it of rawItems.slice(0, 80)) {
    const what = str(it?.what) || str(it?.name) || str(it?.id);
    if (!what) {
      notes.push('Skipped an item with no description.');
      continue;
    }
    const id = uniqueId(str(it?.id) || what, itemIds);
    let room = slug(str(it?.room));
    if (!roomIds.has(room)) {
      const byName = rooms.find((r) => slug(r.name) === room);
      room = byName ? byName.id : rooms[0]?.id ?? 'room';
      if (str(it?.room) && !byName) notes.push(`"${what}" referred to an unknown room — placed in ${rooms[0]?.name}.`);
    }
    let placement = str(it?.placement).toLowerCase() as Placement;
    if (!PLACEMENTS.includes(placement)) {
      if (placement) notes.push(`"${what}": unknown placement "${placement}" → center.`);
      placement = 'center';
    }
    const item: Item = {
      id,
      room,
      what,
      placement,
      wall: asWall(it?.wall),
      align: ['start', 'center', 'end'].includes(it?.align) ? it.align : undefined,
      corner: ['ne', 'nw', 'se', 'sw'].includes(str(it?.corner).toLowerCase()) ? (str(it?.corner).toLowerCase() as Corner) : undefined,
      target: str(it?.target) ? slug(str(it?.target)) : undefined,
      side: it?.side === 'left' || it?.side === 'right' ? it.side : undefined,
      distance: num(it?.distance) !== undefined ? clamp(num(it?.distance)!, 0, 4) : undefined,
      height: num(it?.height) !== undefined ? clamp(num(it?.height)!, 0.3, 4) : undefined,
      asset_id: str(it?.asset_id) || undefined,
      size: parseSize(it?.size),
      reason: str(it?.reason).slice(0, 200) || undefined,
      turn: Number.isInteger(num(it?.turn)) ? (((num(it?.turn)! % 4) + 4) % 4) : undefined,
    };
    items.push(item);
  }

  // References between items must point at earlier-or-later existing items, without cycles.
  const ids = new Set(items.map((i) => i.id));
  for (const item of items) {
    const needsTarget = item.placement === 'next_to' || item.placement === 'in_front_of' || item.placement === 'on_top_of';
    if (needsTarget && (!item.target || !ids.has(item.target) || item.target === item.id)) {
      notes.push(`"${item.what}": ${item.placement} needs a valid target → center.`);
      item.placement = 'center';
      item.target = undefined;
    }
    if ((item.placement === 'against_wall' || item.placement === 'on_wall') && !item.wall) item.wall = 'north';
    if (item.placement === 'corner' && !item.corner) item.corner = 'nw';
  }
  breakCycles(items, notes);

  if (kind === 'layout' && items.length === 0 && !structure) errors.push('The plan has nothing to build.');

  return { plan: { kind, summary, structure, assets, rooms, items }, errors, notes };
}

/** Schema for constrained decoding of the plan (servers that can't do it just ignore it). */
export const PLAN_SCHEMA: { name: string; schema: Record<string, unknown> } = {
  name: 'scene_plan',
  schema: {
    type: 'object',
    properties: {
      kind: { enum: ['layout', 'edit'] },
      summary: { type: 'string' },
      structure: { type: 'boolean' },
      assets: { enum: ['library', 'shapes'] },
      rooms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, purpose: { type: 'string' },
            width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' },
            windows: { type: 'array', items: { type: 'object', properties: { wall: { enum: WALLS } }, required: ['wall'] } },
            doors: { type: 'array', items: { type: 'object', properties: { wall: { enum: WALLS }, to: { type: 'string' } }, required: ['wall'] } },
          },
          required: ['id', 'name', 'width', 'depth'],
        },
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, room: { type: 'string' }, what: { type: 'string' }, asset_id: { type: 'string' },
            size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            placement: { enum: PLACEMENTS }, wall: { enum: WALLS }, align: { enum: ['start', 'center', 'end'] },
            corner: { enum: ['ne', 'nw', 'se', 'sw'] }, target: { type: 'string' }, side: { enum: ['left', 'right'] },
            distance: { type: 'number' }, height: { type: 'number' }, reason: { type: 'string' },
          },
          required: ['id', 'room', 'what', 'placement'],
        },
      },
    },
    required: ['kind', 'summary'],
  },
};

/**
 * Many local reasoning models write their chain of thought inline between <think> tags.
 * Split it from the answer: closed blocks, an unclosed block, and an orphan closing tag
 * (some chat templates strip the opening tag).
 */
export function splitThinkTags(text: string): { answer: string; reasoning: string } {
  let reasoning = '';
  let answer = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, r: string) => {
    reasoning += r;
    return '';
  });
  const open = answer.search(/<think>/i);
  if (open >= 0) {
    reasoning += answer.slice(open + 7);
    answer = answer.slice(0, open);
  }
  const close = answer.search(/<\/think>/i);
  if (close >= 0) {
    reasoning += answer.slice(0, close);
    answer = answer.slice(close + 8);
  }
  return { answer: answer.trim(), reasoning: reasoning.trim() };
}

/** Success criteria from the end of the THINK reply ("SUCCESS CRITERIA:" followed by a list). */
export function parseCriteria(text: string): string[] {
  const at = text.search(/success criteria\s*:?/i);
  if (at < 0) return [];
  return text
    .slice(at)
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 3)
    .slice(0, 8);
}

/** [w, d, h] from an array or {width, depth, height}; undefined unless all three are positive. */
function parseSize(v: any): [number, number, number] | undefined {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.width ?? v.w, v.depth ?? v.d, v.height ?? v.h] : null;
  if (!arr || arr.length < 3) return undefined;
  const nums = arr.slice(0, 3).map(num);
  if (nums.some((n: number | undefined) => n === undefined || n <= 0)) return undefined;
  return nums.map((n: number | undefined) => clamp(n!, 0.005, 30)) as [number, number, number];
}

/** Items that depend on each other in a loop can't be placed — drop the back-reference. */
function breakCycles(items: Item[], notes: string[]): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    const seen = new Set<string>([item.id]);
    let cur = item.target ? byId.get(item.target) : undefined;
    while (cur) {
      if (seen.has(cur.id)) {
        notes.push(`"${item.what}" was part of a circular reference → center.`);
        item.placement = 'center';
        item.target = undefined;
        break;
      }
      seen.add(cur.id);
      cur = cur.target ? byId.get(cur.target) : undefined;
    }
  }
}

/** Items ordered so every target is placed before the items that depend on it. */
export function placementOrder(items: Item[]): Item[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: Item[] = [];
  const done = new Set<string>();
  const visit = (item: Item) => {
    if (done.has(item.id)) return;
    done.add(item.id);
    if (item.target && byId.has(item.target)) visit(byId.get(item.target)!);
    out.push(item);
  };
  items.forEach(visit);
  return out;
}

function emptyPlan(): ScenePlan {
  return { kind: 'layout', summary: '', structure: true, assets: 'library', rooms: [], items: [] };
}

/**
 * Pull a JSON object out of a model reply: tolerates ```json fences, prose
 * around the object, trailing commas and // comments.
 */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in the reply.');
  const candidate = body.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    const cleaned = candidate
      .replace(/\/\/[^\n"]*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  }
}

/** A change the reviewing model asks for. */
export interface PlanEdit {
  op: 'move' | 'remove' | 'swap' | 'add' | 'turn';
  id?: string;
  /** For turn: quarter turns to add (1–3). */
  turns?: number;
  /** For move: new placement fields. For add: the full item. */
  item?: Partial<Item>;
  what?: string;
  asset_id?: string;
}

/** Apply review edits and re-normalize, so edits get the same safety checks as the plan. */
export function applyEdits(plan: ScenePlan, edits: PlanEdit[], notes: string[] = []): ScenePlan {
  const items: any[] = plan.items.map((i) => ({ ...i }));
  const find = (id?: string) => items.find((i) => i.id === (id ? slug(id) : ''));
  for (const e of edits.slice(0, 8)) {
    const target = find(e.id);
    switch (e.op) {
      case 'remove':
        if (target) {
          items.splice(items.indexOf(target), 1);
          notes.push(`Removed "${target.what}".`);
        }
        break;
      case 'move':
        if (target && e.item) {
          for (const key of ['room', 'placement', 'wall', 'align', 'corner', 'target', 'side', 'distance', 'height'] as const) {
            if (e.item[key] !== undefined) target[key] = e.item[key];
          }
          notes.push(`Moved "${target.what}" (${target.placement}${target.wall ? `, ${target.wall} wall` : ''}).`);
        }
        break;
      case 'swap':
        if (target && (e.what || e.asset_id)) {
          if (e.what) target.what = e.what;
          target.asset_id = e.asset_id;
          notes.push(`Swapped "${target.id}" for ${e.asset_id ?? e.what}.`);
        }
        break;
      case 'turn':
        if (target) {
          const n = Number.isInteger(e.turns) ? (e.turns as number) : 2;
          target.turn = (((target.turn ?? 0) + n) % 4 + 4) % 4;
          notes.push(`Turned "${target.what}" by ${n * 90}°.`);
        }
        break;
      case 'add': {
        if (!e.item?.what) break;
        // The reviewer must not re-add something already in the plan (even if it hasn't been placed).
        const norm = (t: string) => slug(String(t));
        const dup = items.find((i) => i.id === norm(e.item!.id ?? e.item!.what!) || (norm(i.what) === norm(e.item!.what!) && i.room === (e.item!.room ?? i.room)));
        if (dup) {
          notes.push(`Ignored adding "${e.item.what}" again — "${dup.what}" is already in the plan.`);
          break;
        }
        items.push({ ...e.item });
        notes.push(`Added "${e.item.what}".`);
        break;
      }
    }
  }
  // Dropping an item also frees anything that referred to it.
  const remaining = new Set(items.map((i) => i.id));
  for (const i of items) if (i.target && !remaining.has(i.target)) delete i.target;
  return normalizePlan({ ...plan, assets: plan.assets, items }).plan;
}
