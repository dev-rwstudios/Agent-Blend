/**
 * What the model "sees" of a scene: a compact table of what exists, an ASCII
 * top view and front view, and the generic problem checks Blender reported.
 * Built only from bounding boxes — it knows nothing about what any object is.
 *
 * Pure module (node --test).
 */

export type Vec3 = [number, number, number];

export interface StateRow {
  name: string;
  type: string;
  /** Set for a collapsed family (many copies of one thing). */
  count?: number;
  step?: string;
  bbox_min: Vec3;
  bbox_max: Vec3;
  each_size?: Vec3;
  parts?: number;
  verts?: number | null;
  material?: string | null;
}

export interface StateIssue {
  code: string;
  object: string;
  other?: string;
  message: string;
}

export interface SceneState {
  unit_count: number;
  objects: StateRow[];
  truncated: boolean;
  bounds: { min: Vec3; max: Vec3 } | null;
  foreign: { count: number; bbox_min?: Vec3; bbox_max?: Vec3 };
  issues: StateIssue[];
}

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const f = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

export function symbolFor(index: number): string {
  return SYMBOLS[index % SYMBOLS.length];
}

/** The user's own (pre-existing) objects, so new work can be kept clear of them. */
export function foreignLine(state: SceneState): string {
  if (!state.foreign || state.foreign.count === 0) return '';
  const { bbox_min: lo, bbox_max: hi } = state.foreign;
  return lo && hi
    ? `EXISTING OBJECTS (not yours — never modify, delete or build on top of them): ${state.foreign.count} object(s) occupying x ${f(lo[0])}..${f(hi[0])}, y ${f(lo[1])}..${f(hi[1])}, z ${f(lo[2])}..${f(hi[2])}. Build clear of that area.`
    : `EXISTING OBJECTS (not yours — never modify or delete): ${state.foreign.count} object(s).`;
}

/** One line per object (or family), lettered so the views can refer to them. */
export function describeState(state: SceneState, maxRows = 60): string {
  if (state.objects.length === 0) return 'Nothing has been built yet.';
  const rows = state.objects.slice(0, maxRows);
  const lines = rows.map((r, i) => {
    const size = r.each_size ?? ([r.bbox_max[0] - r.bbox_min[0], r.bbox_max[1] - r.bbox_min[1], r.bbox_max[2] - r.bbox_min[2]] as Vec3);
    const extent = `x ${f(r.bbox_min[0])}..${f(r.bbox_max[0])}, y ${f(r.bbox_min[1])}..${f(r.bbox_max[1])}, z ${f(r.bbox_min[2])}..${f(r.bbox_max[2])}`;
    // The exact name is quoted: it is what code must use (bpy.data.objects["…"]). The letter only links to the views.
    const shown = r.count ? `"${r.name}" ×${r.count}` : `"${r.name}"`;
    return `${shown} [${r.type}] ${extent} · ${r.count ? 'each ' : ''}${f(size[0])}×${f(size[1])}×${f(size[2])} m${r.step ? ` · ${r.step}` : ''} · view letter ${symbolFor(i)}`;
  });
  const more = state.objects.length > maxRows || state.truncated ? `\n… ${state.unit_count} objects in total (rows are capped)` : '';
  const b = state.bounds;
  const head = b ? `SCENE BOUNDS x ${f(b.min[0])}..${f(b.max[0])}, y ${f(b.min[1])}..${f(b.max[1])}, z ${f(b.min[2])}..${f(b.max[2])} (meters, ground z=0)\n` : '';
  return head + lines.join('\n') + more;
}

function renderGrid(
  rows: StateRow[],
  axes: [0 | 1 | 2, 0 | 1 | 2],
  cols: number,
  maxRows: number
): { lines: string[]; scale: number; origin: [number, number] } | null {
  if (rows.length === 0) return null;
  const [ha, va] = axes;
  const lo: [number, number] = [Math.min(...rows.map((r) => r.bbox_min[ha])), Math.min(...rows.map((r) => r.bbox_min[va]))];
  const hi: [number, number] = [Math.max(...rows.map((r) => r.bbox_max[ha])), Math.max(...rows.map((r) => r.bbox_max[va]))];
  const w = Math.max(hi[0] - lo[0], 1e-6);
  const h = Math.max(hi[1] - lo[1], 1e-6);
  // Terminal cells are about twice as tall as wide, so a cell covers 2x as much vertical distance.
  const scale = Math.max(w / cols, h / (maxRows * 2)) || 1;
  const nx = Math.max(1, Math.min(cols, Math.ceil(w / scale)));
  const ny = Math.max(1, Math.min(maxRows, Math.ceil(h / (scale * 2))));
  const grid: string[][] = Array.from({ length: ny }, () => Array(nx).fill('.'));
  // Larger first, so small things drawn after stay visible on top of them.
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => area(b.r, ha, va) - area(a.r, ha, va));
  for (const { r, i } of order) {
    const c0 = Math.floor((r.bbox_min[ha] - lo[0]) / scale);
    const c1 = Math.max(c0, Math.ceil((r.bbox_max[ha] - lo[0]) / scale) - 1);
    const r0 = Math.floor((r.bbox_min[va] - lo[1]) / (scale * 2));
    const r1 = Math.max(r0, Math.ceil((r.bbox_max[va] - lo[1]) / (scale * 2)) - 1);
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        // A family of copies is only drawn as an outline: its box is where the copies are, not solid.
        if (r.count && y > r0 && y < r1 && x > c0 && x < c1) continue;
        if (y >= 0 && y < ny && x >= 0 && x < nx) grid[ny - 1 - y][x] = symbolFor(i);
      }
    }
  }
  return { lines: grid.map((l) => `|${l.join('')}|`), scale, origin: lo };
}

const area = (r: StateRow, a: number, b: number) => (r.bbox_max[a] - r.bbox_min[a]) * (r.bbox_max[b] - r.bbox_min[b]);

/** ASCII top view (x →, y ↑) and front view (x →, z ↑) of everything, lettered like describeState. */
export function asciiViews(state: SceneState, maxRows = 60): string {
  const rows = state.objects.slice(0, maxRows);
  const top = renderGrid(rows, [0, 1], 64, 24);
  const front = renderGrid(rows, [0, 2], 64, 16);
  if (!top || !front) return '';
  const edge = (cols: number) => '+' + '-'.repeat(cols) + '+';
  const w = top.lines[0].length - 2;
  return [
    `TOP VIEW (x → right, y ↑ up; one character ≈ ${f(top.scale)} m wide)`,
    edge(w), ...top.lines, edge(w),
    `FRONT VIEW (x → right, z ↑ up; ground is the bottom edge only if the scene starts at z=0)`,
    edge(front.lines[0].length - 2), ...front.lines, edge(front.lines[0].length - 2),
  ].join('\n');
}

export function describeIssues(issues: StateIssue[], only?: Set<string>, max = 10): string {
  const list = issues.filter((i) => !only || only.has(i.object) || (i.other && only.has(i.other))).slice(0, max);
  return list.length ? list.map((i) => `- [${i.code}] ${i.message}`).join('\n') : 'none';
}
