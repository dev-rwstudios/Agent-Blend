/**
 * Deterministic layout solver: plan intent → exact coordinates.
 *
 * - Rooms are packed side by side (shared walls) unless the plan positions
 *   them without overlaps. Adjacent rooms get a connecting door, and a house
 *   without an entrance gets a front door.
 * - Walls become box segments cut around doors and windows.
 * - Furniture is positioned from its placement intent using the asset's real
 *   size and facing direction, kept inside its room, clear of walls, other
 *   furniture and door swing zones. Anything that can't fit is reported as
 *   unplaced instead of being forced into an overlap.
 *
 * Conventions: meters, +Z up, room "north" = +Y, "east" = +X. An asset with
 * forward axis +Y faces north when rotation is 0. Pure module (node --test).
 */

import type { Item, Opening, Room, Wall } from './plan.ts';
import { placementOrder } from './plan.ts';

export const WALL_THICKNESS = 0.12;
const WALL_GAP = 0.02; // furniture ↔ wall
const ITEM_GAP = 0.05; // furniture ↔ furniture
const DOOR_CLEARANCE = 0.9;
const EPS = 1e-6;

export type Vec3 = [number, number, number];
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface Box {
  name: string;
  center: Vec3;
  size: Vec3;
  material: string;
  tags: Record<string, string>;
}

export type Layer = 'floor' | 'flat' | 'wall' | 'ceiling' | 'top';

/** Asset size as stored in its file: dx along X, dy along Y (meters). */
export interface AssetDims {
  dx: number;
  dy: number;
  h: number;
  forwardAxis?: string;
  /** 0..1: how sure `forwardAxis` is (measured from geometry, or confirmed by the user). */
  orientConfidence?: number;
  /** Quarter turns the plan adds on top of `forwardAxis` (a correction for wrong facing). */
  turn?: number;
  surface?: string;
  category?: string;
}

export interface PlacedRoom extends Room {
  x: number;
  y: number;
  rect: Rect;
  /** Usable floor area (inside the wall faces). */
  inner: Rect;
}

export interface PlacedItem {
  id: string;
  room: string;
  status: 'placed' | 'unplaced';
  note?: string;
  layer: Layer;
  /** Footprint center and bottom height of the asset. */
  x: number;
  y: number;
  z: number;
  /** Rotation about Z applied to the asset. */
  yaw: number;
  /** Direction the item's front faces (radians). */
  facing: number;
  footprint: Rect;
  zMax: number;
}

export interface WallOpening {
  kind: 'door' | 'window';
  orient: 'h' | 'v';
  coord: number;
  a0: number;
  a1: number;
  z0: number;
  z1: number;
  room: string;
}

/** Space in front of a door/window that wall-mounted and tall items must leave free. */
export interface OpeningZone {
  kind: 'door' | 'window';
  rect: Rect;
  z0: number;
  z1: number;
}

export interface LayoutResult {
  rooms: PlacedRoom[];
  zones: OpeningZone[];
  floors: Box[];
  walls: Box[];
  openings: WallOpening[];
  keepouts: Rect[];
  placed: Record<string, PlacedItem>;
  notes: string[];
  bounds: { min: Vec3; max: Vec3 };
}

export interface LayoutInput {
  rooms: Room[];
  items: Item[];
  dims: Record<string, AssetDims | undefined>;
  structure: boolean;
  /** South-west corner where the build starts (to keep clear of existing objects). */
  origin?: { x: number; y: number };
}

// ------------------------------------------------------------------ geometry helpers

const normAngle = (a: number) => {
  let r = a % (2 * Math.PI);
  if (r > Math.PI + EPS) r -= 2 * Math.PI;
  if (r < -Math.PI - EPS) r += 2 * Math.PI;
  return Math.abs(r) < EPS ? 0 : r;
};

const AXIS_ANGLE: Record<string, number> = { '+Y': Math.PI / 2, '-Y': -Math.PI / 2, '+X': 0, '-X': Math.PI };

/** Inward-facing direction for an item backed against `wall`. */
const INWARD: Record<Wall, number> = { north: -Math.PI / 2, south: Math.PI / 2, east: Math.PI, west: 0 };

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x0 < b.x1 + margin - EPS && b.x0 < a.x1 + margin - EPS && a.y0 < b.y1 + margin - EPS && b.y0 < a.y1 + margin - EPS;
}

export function rectInside(inner: Rect, outer: Rect, tol = 1e-4): boolean {
  return inner.x0 >= outer.x0 - tol && inner.x1 <= outer.x1 + tol && inner.y0 >= outer.y0 - tol && inner.y1 <= outer.y1 + tol;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

// ------------------------------------------------------------------ rooms

function roomsOverlap(rooms: { rect: Rect }[]): boolean {
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) if (rectsOverlap(rooms[i].rect, rooms[j].rect, -0.01)) return true;
  return false;
}

export function packRooms(rooms: Room[], origin = { x: 0, y: 0 }, notes: string[] = []): PlacedRoom[] {
  const half = WALL_THICKNESS / 2;
  const make = (r: Room, x: number, y: number): PlacedRoom => ({
    ...r,
    doors: r.doors.map((d) => ({ ...d })),
    windows: r.windows.map((w) => ({ ...w })),
    x,
    y,
    rect: { x0: x, y0: y, x1: x + r.width, y1: y + r.depth },
    inner: { x0: x + half, y0: y + half, x1: x + r.width - half, y1: y + r.depth - half },
  });

  const positioned = rooms.every((r) => r.x !== undefined && r.y !== undefined);
  if (positioned) {
    const minX = Math.min(...rooms.map((r) => r.x!));
    const minY = Math.min(...rooms.map((r) => r.y!));
    const placed = rooms.map((r) => make(r, origin.x + r.x! - minX, origin.y + r.y! - minY));
    if (!roomsOverlap(placed)) return placed;
    notes.push('The planned room positions overlapped — rooms were packed side by side instead.');
  }

  let x = origin.x;
  return rooms.map((r) => {
    const p = make(r, x, origin.y);
    x += r.width;
    return p;
  });
}

/** Length of the shared stretch of wall between two rooms, if they touch. */
function sharedEdge(a: PlacedRoom, b: PlacedRoom): { wall: Wall; a0: number; a1: number } | null {
  const close = (u: number, v: number) => Math.abs(u - v) < 1e-3;
  if (close(a.rect.x1, b.rect.x0) || close(a.rect.x0, b.rect.x1)) {
    const a0 = Math.max(a.rect.y0, b.rect.y0);
    const a1 = Math.min(a.rect.y1, b.rect.y1);
    if (a1 - a0 > 1) return { wall: close(a.rect.x1, b.rect.x0) ? 'east' : 'west', a0, a1 };
  }
  if (close(a.rect.y1, b.rect.y0) || close(a.rect.y0, b.rect.y1)) {
    const a0 = Math.max(a.rect.x0, b.rect.x0);
    const a1 = Math.min(a.rect.x1, b.rect.x1);
    if (a1 - a0 > 1) return { wall: close(a.rect.y1, b.rect.y0) ? 'north' : 'south', a0, a1 };
  }
  return null;
}

/** Connect touching rooms with a door and make sure the building has an entrance. */
export function ensureDoors(rooms: PlacedRoom[], notes: string[]): void {
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const edge = sharedEdge(a, b);
      if (!edge) continue;
      const connected =
        a.doors.some((d) => d.to === b.id) || b.doors.some((d) => d.to === a.id);
      if (connected) continue;
      const start = edge.wall === 'north' || edge.wall === 'south' ? a.rect.x0 : a.rect.y0;
      a.doors.push({ wall: edge.wall, to: b.id, offset: (edge.a0 + edge.a1) / 2 - start, width: 0.9, height: 2.1, sill: 0 });
      notes.push(`Added a door between ${a.name} and ${b.name}.`);
    }
  }
  const hasEntrance = rooms.some((r) => r.doors.some((d) => !d.to || d.to === 'outside'));
  if (rooms.length > 0 && !hasEntrance) {
    rooms[0].doors.push({ wall: 'south', to: 'outside', width: 0.9, height: 2.1, sill: 0 });
    notes.push(`Added a front door to ${rooms[0].name}.`);
  }
}

// ------------------------------------------------------------------ walls

interface Line { orient: 'h' | 'v'; coord: number; a0: number; a1: number }

function wallLine(room: PlacedRoom, wall: Wall): Line {
  const r = room.rect;
  switch (wall) {
    case 'north': return { orient: 'h', coord: r.y1, a0: r.x0, a1: r.x1 };
    case 'south': return { orient: 'h', coord: r.y0, a0: r.x0, a1: r.x1 };
    case 'east': return { orient: 'v', coord: r.x1, a0: r.y0, a1: r.y1 };
    case 'west': return { orient: 'v', coord: r.x0, a0: r.y0, a1: r.y1 };
  }
}

function openingOnWall(room: PlacedRoom, o: Opening, kind: 'door' | 'window', notes: string[]): WallOpening | null {
  const line = wallLine(room, o.wall);
  const length = line.a1 - line.a0;
  const margin = 0.2;
  let width = o.width;
  if (width > length - 2 * margin) {
    width = length - 2 * margin;
    if (width < 0.5) {
      notes.push(`${room.name}: no room for a ${kind} on the ${o.wall} wall.`);
      return null;
    }
  }
  const lo = line.a0 + margin + width / 2;
  const hi = line.a1 - margin - width / 2;
  const center = Math.min(hi, Math.max(lo, line.a0 + (o.offset ?? length / 2)));
  return {
    kind,
    orient: line.orient,
    coord: line.coord,
    a0: center - width / 2,
    a1: center + width / 2,
    z0: o.sill,
    z1: Math.min(o.sill + o.height, room.height - 0.1),
    room: room.id,
  };
}

/** Union of overlapping intervals on the same wall line (shared walls are built once). */
function mergeLines(lines: Line[]): Line[] {
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const key = `${l.orient}:${l.coord.toFixed(4)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }
  const out: Line[] = [];
  for (const group of groups.values()) {
    group.sort((p, q) => p.a0 - q.a0);
    let cur = { ...group[0] };
    for (const l of group.slice(1)) {
      if (l.a0 <= cur.a1 + 1e-4) cur.a1 = Math.max(cur.a1, l.a1);
      else {
        out.push(cur);
        cur = { ...l };
      }
    }
    out.push(cur);
  }
  return out;
}

export function buildWalls(rooms: PlacedRoom[], openings: WallOpening[], height: number): Box[] {
  const t = WALL_THICKNESS;
  const lines = mergeLines(rooms.flatMap((r) => (['north', 'south', 'east', 'west'] as Wall[]).map((w) => wallLine(r, w))));
  const boxes: Box[] = [];
  let n = 0;
  const push = (line: Line, a0: number, a1: number, z0: number, z1: number) => {
    if (a1 - a0 < 0.01 || z1 - z0 < 0.01) return;
    const mid = (a0 + a1) / 2;
    const center: Vec3 = line.orient === 'h' ? [mid, line.coord, (z0 + z1) / 2] : [line.coord, mid, (z0 + z1) / 2];
    const size: Vec3 = line.orient === 'h' ? [a1 - a0, t, z1 - z0] : [t, a1 - a0, z1 - z0];
    boxes.push({ name: `Wall ${++n}`, center: center.map(round) as Vec3, size: size.map(round) as Vec3, material: 'AB Wall', tags: { part: 'wall' } });
  };

  for (const line of lines) {
    // Horizontal walls run past the corners by half a thickness so corners close.
    const L0 = line.orient === 'h' ? line.a0 - t / 2 : line.a0 + t / 2;
    const L1 = line.orient === 'h' ? line.a1 + t / 2 : line.a1 - t / 2;
    const holes = openings
      .filter((o) => o.orient === line.orient && Math.abs(o.coord - line.coord) < 1e-4 && o.a1 > L0 && o.a0 < L1)
      .sort((p, q) => p.a0 - q.a0);
    // Merge overlapping openings (e.g. the same door declared from both rooms).
    const merged: WallOpening[] = [];
    for (const h of holes) {
      const last = merged[merged.length - 1];
      if (last && h.a0 <= last.a1) {
        last.a1 = Math.max(last.a1, h.a1);
        last.z0 = Math.min(last.z0, h.z0);
        last.z1 = Math.max(last.z1, h.z1);
      } else merged.push({ ...h });
    }
    let cursor = L0;
    for (const h of merged) {
      const a0 = Math.max(h.a0, L0);
      const a1 = Math.min(h.a1, L1);
      push(line, cursor, a0, 0, height);
      push(line, a0, a1, 0, h.z0); // below a window
      push(line, a0, a1, h.z1, height); // above the opening
      cursor = Math.max(cursor, a1);
    }
    push(line, cursor, L1, 0, height);
  }
  return boxes;
}

// ------------------------------------------------------------------ furniture

/** Anything this flat lying on the floor is a floor covering: it can sit under furniture. */
const FLAT = 0.05;

function layerFor(item: Item, dims: AssetDims): Layer {
  if (item.placement === 'on_top_of') return 'top';
  if (item.placement === 'on_wall') return 'wall';
  if (item.placement === 'ceiling') return 'ceiling';
  return dims.h <= FLAT ? 'flat' : 'floor';
}

/** World extents (ex along X, ey along Y) of an asset rotated by a quarter-turn multiple. */
function extents(d: AssetDims, yaw: number): { ex: number; ey: number } {
  const quarter = Math.round(normAngle(yaw) / (Math.PI / 2));
  return Math.abs(quarter) % 2 === 1 ? { ex: d.dy, ey: d.dx } : { ex: d.dx, ey: d.dy };
}

/** Rotation about Z that makes the asset's front point along `facing`. */
export function yawFor(facing: number, d: AssetDims): number {
  const front = (AXIS_ANGLE[d.forwardAxis ?? '+Y'] ?? Math.PI / 2) + (d.turn ?? 0) * (Math.PI / 2);
  return normAngle(facing - front);
}

/** Search positions along a wall, nearest to the preferred spot first. */
function alongCandidates(lo: number, hi: number, preferred: number, step = 0.05): number[] {
  if (hi < lo - EPS) return [];
  const p = Math.min(hi, Math.max(lo, preferred));
  const out = [p];
  for (let k = 1; k <= Math.ceil((hi - lo) / step) + 1; k++) {
    if (p + k * step <= hi + EPS) out.push(p + k * step);
    if (p - k * step >= lo - EPS) out.push(p - k * step);
  }
  return out;
}

interface Candidate { x: number; y: number; facing: number }

function wallCandidates(room: PlacedRoom, wall: Wall, d: AssetDims, align: 'start' | 'center' | 'end' = 'center', gap = WALL_GAP): Candidate[] {
  const facing = INWARD[wall];
  const { ex, ey } = extents(d, yawFor(facing, d));
  const I = room.inner;
  if (wall === 'north' || wall === 'south') {
    const y = wall === 'north' ? I.y1 - ey / 2 - gap : I.y0 + ey / 2 + gap;
    const lo = I.x0 + ex / 2 + gap;
    const hi = I.x1 - ex / 2 - gap;
    const pref = align === 'start' ? lo : align === 'end' ? hi : (lo + hi) / 2;
    return alongCandidates(lo, hi, pref).map((x) => ({ x, y, facing }));
  }
  const x = wall === 'east' ? I.x1 - ex / 2 - gap : I.x0 + ex / 2 + gap;
  const lo = I.y0 + ey / 2 + gap;
  const hi = I.y1 - ey / 2 - gap;
  const pref = align === 'start' ? lo : align === 'end' ? hi : (lo + hi) / 2;
  return alongCandidates(lo, hi, pref).map((y) => ({ x, y, facing }));
}

function centerCandidates(room: PlacedRoom, facing = -Math.PI / 2): Candidate[] {
  const I = room.inner;
  const cx = (I.x0 + I.x1) / 2;
  const cy = (I.y0 + I.y1) / 2;
  const pts: Candidate[] = [];
  const step = 0.25;
  for (let i = -40; i <= 40; i++)
    for (let j = -40; j <= 40; j++) {
      const x = cx + i * step;
      const y = cy + j * step;
      if (x > I.x0 && x < I.x1 && y > I.y0 && y < I.y1) pts.push({ x, y, facing });
    }
  return pts.sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
}

export function solveLayout(input: LayoutInput): LayoutResult {
  const notes: string[] = [];
  const rooms = packRooms(input.rooms, input.origin, notes);
  if (input.structure) ensureDoors(rooms, notes);
  const height = Math.max(...rooms.map((r) => r.height), 2.4);

  const openings: WallOpening[] = [];
  for (const room of rooms) {
    for (const d of room.doors) {
      const o = openingOnWall(room, d, 'door', notes);
      if (o) openings.push(o);
    }
    for (const w of room.windows) {
      const o = openingOnWall(room, w, 'window', notes);
      if (o) openings.push(o);
    }
  }

  // Keep the floor in front of and behind every door clear.
  const keepouts: Rect[] = openings
    .filter((o) => o.kind === 'door')
    .map((o) =>
      o.orient === 'h'
        ? { x0: o.a0, y0: o.coord - DOOR_CLEARANCE, x1: o.a1, y1: o.coord + DOOR_CLEARANCE }
        : { x0: o.coord - DOOR_CLEARANCE, y0: o.a0, x1: o.coord + DOOR_CLEARANCE, y1: o.a1 }
    );

  // Doors and windows must not be covered by things hung on or pushed against the wall.
  const zones: OpeningZone[] = openings.map((o) => {
    const depth = 0.35;
    const rect =
      o.orient === 'h'
        ? { x0: o.a0, y0: o.coord - depth, x1: o.a1, y1: o.coord + depth }
        : { x0: o.coord - depth, y0: o.a0, x1: o.coord + depth, y1: o.a1 };
    return { kind: o.kind, rect, z0: o.z0, z1: o.z1 };
  });

  const floors: Box[] = input.structure
    ? rooms.map((r) => ({
        name: `Floor ${r.name}`,
        center: [round((r.rect.x0 + r.rect.x1) / 2), round((r.rect.y0 + r.rect.y1) / 2), -0.05] as Vec3,
        size: [round(r.width), round(r.depth), 0.1] as Vec3,
        material: 'AB Floor',
        tags: { part: 'floor', room: r.id },
      }))
    : [];
  const walls = input.structure ? buildWalls(rooms, openings, height) : [];

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const placed: Record<string, PlacedItem> = {};

  /** strict = also keep windows clear (relaxed only for floor items, as a fallback). */
  const collides = (fp: Rect, z0: number, z1: number, layer: Layer, self: string, strict: boolean): boolean => {
    if (layer === 'top') return false;
    if (layer === 'floor' || layer === 'wall') {
      for (const zone of zones) {
        if (zone.kind === 'window' && !strict && layer === 'floor') continue;
        if (z0 < zone.z1 - EPS && zone.z0 < z1 - EPS && rectsOverlap(fp, zone.rect)) return true;
      }
    }
    for (const p of Object.values(placed)) {
      if (p.status !== 'placed' || p.id === self || p.layer === 'top') continue;
      const sameFloorLayer = (layer === 'floor' && p.layer === 'floor') || (layer === 'flat' && p.layer === 'flat');
      const vertical = z0 < p.zMax - EPS && p.z < z1 - EPS;
      if (sameFloorLayer && rectsOverlap(fp, p.footprint, ITEM_GAP)) return true;
      if (!sameFloorLayer && layer !== 'flat' && p.layer !== 'flat' && vertical && rectsOverlap(fp, p.footprint, 0)) return true;
    }
    if (layer === 'floor' && keepouts.some((k) => rectsOverlap(fp, k))) return true;
    return false;
  };

  for (const item of placementOrder(input.items)) {
    const room = roomById.get(item.room) ?? rooms[0];
    const d = input.dims[item.id];
    const fail = (note: string, layer: Layer = 'floor') => {
      placed[item.id] = { id: item.id, room: room.id, status: 'unplaced', note, layer, x: 0, y: 0, z: 0, yaw: 0, facing: 0, footprint: { x0: 0, y0: 0, x1: 0, y1: 0 }, zMax: 0 };
    };
    if (!d) {
      fail('No matching asset in the library.');
      continue;
    }
    // Wall/ceiling assets go where their metadata says, whatever the plan guessed.
    let placement = item.placement;
    if (d.surface === 'wall' && !['on_wall', 'on_top_of'].includes(placement)) {
      notes.push(`"${item.what}" is a wall-mounted asset — hung on the wall.`);
      placement = 'on_wall';
    } else if (d.surface === 'ceiling' && placement !== 'ceiling') {
      placement = 'ceiling';
    }
    const layer = layerFor({ ...item, placement }, d);

    let candidates: Candidate[] = [];
    let zFor = () => 0;
    const target = item.target ? placed[item.target] : undefined;
    const targetDims = item.target ? input.dims[item.target] : undefined;

    switch (placement) {
      case 'against_wall': {
        const walls = [item.wall ?? 'north', ...(['north', 'south', 'east', 'west'] as Wall[]).filter((w) => w !== item.wall)];
        candidates = walls.flatMap((w) => wallCandidates(room, w, d, item.align));
        break;
      }
      case 'corner': {
        const c = item.corner ?? 'nw';
        const ns: Wall = c[0] === 'n' ? 'north' : 'south';
        const ew: Wall = c[1] === 'e' ? 'east' : 'west';
        const alongNS = c[1] === 'e' ? 'end' : 'start';
        const alongEW = c[0] === 'n' ? 'end' : 'start';
        candidates = [...wallCandidates(room, ns, d, alongNS), ...wallCandidates(room, ew, d, alongEW)];
        break;
      }
      case 'on_wall': {
        const wall = item.wall ?? 'north';
        // Mounted at eye level unless the plan says otherwise, kept inside the wall's height.
        const center = item.height ?? 1.5;
        const z = Math.max(0.1, Math.min(room.height - d.h - 0.05, center - d.h / 2));
        zFor = () => z;
        candidates = wallCandidates(room, wall, d, item.align, 0.01);
        break;
      }
      case 'ceiling': {
        zFor = () => Math.max(0, room.height - d.h - 0.02);
        candidates = centerCandidates(room);
        break;
      }
      case 'center':
        candidates = centerCandidates(room);
        break;
      case 'next_to':
      case 'in_front_of':
      case 'on_top_of': {
        if (!target || target.status !== 'placed' || !targetDims) {
          candidates = centerCandidates(room);
          notes.push(`"${item.what}": its target couldn't be placed — placed on its own instead.`);
          break;
        }
        const f = target.facing;
        const front = [Math.cos(f), Math.sin(f)];
        const lateral = [Math.cos(f + Math.PI / 2), Math.sin(f + Math.PI / 2)];
        const tW = target.footprint.x1 - target.footprint.x0;
        const tD = target.footprint.y1 - target.footprint.y0;
        // Target's extent along a direction (footprints are axis-aligned).
        const tAlong = (v: number[]) => Math.abs(v[0]) * tW + Math.abs(v[1]) * tD;
        if (placement === 'on_top_of') {
          zFor = () => target.zMax;
          candidates = [{ x: target.x, y: target.y, facing: f }];
        } else if (placement === 'next_to') {
          const { ex, ey } = extents(d, yawFor(f, d));
          const iAlong = (v: number[]) => Math.abs(v[0]) * ex + Math.abs(v[1]) * ey;
          const back = [target.x - front[0] * tAlong(front) / 2, target.y - front[1] * tAlong(front) / 2];
          const sides = item.side === 'right' ? [-1, 1] : [1, -1];
          for (const s of sides) {
            for (let extra = 0; extra <= 1.5 + EPS; extra += 0.1) {
              const off = tAlong(lateral) / 2 + iAlong(lateral) / 2 + ITEM_GAP + 0.01 + extra;
              candidates.push({
                x: back[0] + front[0] * iAlong(front) / 2 + lateral[0] * off * s,
                y: back[1] + front[1] * iAlong(front) / 2 + lateral[1] * off * s,
                facing: f,
              });
            }
          }
        } else {
          const facing = normAngle(f + Math.PI);
          const { ex, ey } = extents(d, yawFor(facing, d));
          const iAlong = (v: number[]) => Math.abs(v[0]) * ex + Math.abs(v[1]) * ey;
          const base = item.distance ?? 0.45;
          for (let extra = 0; extra <= 1.2 + EPS; extra += 0.1) {
            for (const lat of [0, 0.2, -0.2, 0.4, -0.4]) {
              const dist = tAlong(front) / 2 + base + extra + iAlong(front) / 2;
              candidates.push({
                x: target.x + front[0] * dist + lateral[0] * lat,
                y: target.y + front[1] * dist + lateral[1] * lat,
                facing,
              });
            }
          }
        }
        break;
      }
    }

    let chosen: PlacedItem | null = null;
    // Prefer spots that keep windows clear; floor items may fall back to covering one.
    for (const strict of [true, false]) {
    if (chosen || (!strict && layer !== 'floor')) break;
    for (const c of candidates) {
      const yaw = yawFor(c.facing, d);
      const { ex, ey } = extents(d, yaw);
      const fp: Rect = { x0: c.x - ex / 2, y0: c.y - ey / 2, x1: c.x + ex / 2, y1: c.y + ey / 2 };
      if (layer !== 'top' && !rectInside(fp, room.inner)) continue;
      const z = zFor();
      if (collides(fp, z, z + d.h, layer, item.id, strict)) continue;
      chosen = {
        id: item.id,
        room: room.id,
        status: 'placed',
        layer,
        x: round(c.x),
        y: round(c.y),
        z: round(z),
        yaw: round(yaw),
        facing: c.facing,
        footprint: { x0: round(fp.x0), y0: round(fp.y0), x1: round(fp.x1), y1: round(fp.y1) },
        zMax: round(z + d.h),
      };
      if (!strict) notes.push(`"${item.what}" stands in front of a window — there was no other spot.`);
      break;
    }
    }
    if (chosen) placed[item.id] = chosen;
    else fail(`No free spot in ${room.name} for ${d.dx.toFixed(2)}×${d.dy.toFixed(2)} m.`, layer);
  }

  const all = [...rooms.map((r) => r.rect)];
  const minX = Math.min(...all.map((r) => r.x0)) - WALL_THICKNESS;
  const minY = Math.min(...all.map((r) => r.y0)) - WALL_THICKNESS;
  const maxX = Math.max(...all.map((r) => r.x1)) + WALL_THICKNESS;
  const maxY = Math.max(...all.map((r) => r.y1)) + WALL_THICKNESS;

  return {
    rooms,
    zones,
    floors,
    walls,
    openings,
    keepouts,
    placed,
    notes,
    bounds: { min: [minX, minY, 0], max: [maxX, maxY, height] },
  };
}
