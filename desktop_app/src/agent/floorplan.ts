/**
 * A text rendering of a solved layout — the model's "eyes".
 *
 * Text-only models can't look at a render, so the reviewer gets an exact
 * top-down plan per room (a character grid), plus a legend with each object's
 * size, position, facing and the clear space in front of it. Derived entirely
 * from the layout: nothing here knows what any object is.
 *
 * Pure module (node --test).
 */

import type { LayoutResult, PlacedItem, PlacedRoom, Rect } from './layout.ts';
import { rectsOverlap } from './layout.ts';
import type { ScenePlan } from './plan.ts';

// Item letters never reuse the grid's own markers (D = door, W = window).
const SYMBOLS = 'ABCEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Compass word for a facing angle (0 = east, π/2 = north). */
export function compass(facing: number): string {
  const deg = ((Math.round((facing * 180) / Math.PI) % 360) + 360) % 360;
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  return names[Math.round(deg / 45) % 8];
}

/** Free distance in front of an item before it meets a wall or another object (capped at 4 m). */
export function clearanceAhead(item: PlacedItem, room: PlacedRoom, others: PlacedItem[]): number {
  const fx = Math.round(Math.cos(item.facing));
  const fy = Math.round(Math.sin(item.facing));
  if (fx === 0 && fy === 0) return 0;
  const fp = item.footprint;
  // The strip the item would sweep through moving forward.
  const strip = (d: number): Rect => ({
    x0: fx > 0 ? fp.x1 : fx < 0 ? fp.x0 - d : fp.x0,
    x1: fx > 0 ? fp.x1 + d : fx < 0 ? fp.x0 : fp.x1,
    y0: fy > 0 ? fp.y1 : fy < 0 ? fp.y0 - d : fp.y0,
    y1: fy > 0 ? fp.y1 + d : fy < 0 ? fp.y0 : fp.y1,
  });
  let free = 0;
  for (let d = 0.05; d <= 4; d += 0.05) {
    const s = strip(d);
    const inside = s.x0 >= room.inner.x0 - 1e-6 && s.x1 <= room.inner.x1 + 1e-6 && s.y0 >= room.inner.y0 - 1e-6 && s.y1 <= room.inner.y1 + 1e-6;
    if (!inside || others.some((o) => o.id !== item.id && o.layer === 'floor' && rectsOverlap(s, o.footprint))) break;
    free = d;
  }
  return Math.round(free * 100) / 100;
}

/** Which wall (if any) the item's back is against. */
function wallContact(item: PlacedItem, room: PlacedRoom): string | null {
  const fp = item.footprint;
  const gap = 0.06;
  const hits: string[] = [];
  if (room.inner.y1 - fp.y1 < gap) hits.push('north');
  if (fp.y0 - room.inner.y0 < gap) hits.push('south');
  if (room.inner.x1 - fp.x1 < gap) hits.push('east');
  if (fp.x0 - room.inner.x0 < gap) hits.push('west');
  return hits.length ? hits.join('+') : null;
}

export interface FloorPlanOptions {
  /** Display label per item id (defaults to the plan's `what`). */
  labels?: Map<string, string>;
  cell?: number;
}

/** Everything the reviewer needs to "see" the layout, as text. */
export function describeLayout(layout: LayoutResult, plan: ScenePlan, opts: FloorPlanOptions = {}): string {
  const label = (id: string) => opts.labels?.get(id) ?? plan.items.find((i) => i.id === id)?.what ?? id;
  const out: string[] = [];
  const symbolOf = new Map<string, string>();
  plan.items.forEach((item, n) => symbolOf.set(item.id, SYMBOLS[n % SYMBOLS.length]));

  for (const room of layout.rooms) {
    const cell = opts.cell ?? (Math.max(room.width, room.depth) > 9 ? 0.5 : 0.25);
    const cols = Math.max(1, Math.round(room.width / cell));
    const rows = Math.max(1, Math.round(room.depth / cell));
    const here = Object.values(layout.placed).filter((p) => p.status === 'placed' && p.room === room.id);
    const doors = layout.openings.filter((o) => o.kind === 'door' && o.room === room.id);
    const windows = layout.openings.filter((o) => o.kind === 'window' && o.room === room.id);

    // Grid rows run north (top) → south (bottom).
    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const line: string[] = [];
      for (let c = 0; c < cols; c++) {
        const cx = room.rect.x0 + (c + 0.5) * cell;
        const cy = room.rect.y1 - (r + 0.5) * cell;
        const spot: Rect = { x0: cx - 0.001, y0: cy - 0.001, x1: cx + 0.001, y1: cy + 0.001 };
        let ch = layout.keepouts.some((k) => rectsOverlap(spot, k)) ? ':' : '.';
        // Larger items first, so small ones on top of them stay visible.
        for (const p of [...here].sort((a, b) => area(b.footprint) - area(a.footprint))) {
          if (p.layer === 'top' || p.layer === 'ceiling') continue;
          if (rectsOverlap(spot, p.footprint)) ch = p.layer === 'flat' ? (ch === '.' ? ',' : ch) : symbolOf.get(p.id) ?? '?';
        }
        line.push(ch);
      }
      grid.push(line);
    }

    const mark = (o: { orient: 'h' | 'v'; coord: number; a0: number; a1: number }, ch: string) => {
      for (let n = 0; n < (o.orient === 'h' ? cols : rows); n++) {
        const lo = (o.orient === 'h' ? room.rect.x0 : room.rect.y0) + n * cell;
        if (lo + cell <= o.a0 || lo >= o.a1) continue;
        if (o.orient === 'h') {
          const row = Math.abs(o.coord - room.rect.y1) < 1e-3 ? 0 : Math.abs(o.coord - room.rect.y0) < 1e-3 ? rows - 1 : -1;
          if (row >= 0) grid[row][n] = ch;
        } else {
          const col = Math.abs(o.coord - room.rect.x0) < 1e-3 ? 0 : Math.abs(o.coord - room.rect.x1) < 1e-3 ? cols - 1 : -1;
          if (col >= 0) grid[rows - 1 - n][col] = ch;
        }
      }
    };
    doors.forEach((d) => mark(d, 'D'));
    windows.forEach((w) => mark(w, 'W'));

    out.push(
      `ROOM "${room.name}" (${room.purpose ?? room.name}) ${room.width}×${room.depth} m — north is up, east is right; one character = ${cell} m`,
      '+' + '-'.repeat(cols) + '+',
      ...grid.map((l) => '|' + l.join('') + '|'),
      '+' + '-'.repeat(cols) + '+',
      '(D door, W window, : door clearance, . free floor, , flat floor covering)'
    );

    for (const p of here) {
      const item = plan.items.find((i) => i.id === p.id);
      const w = p.footprint.x1 - p.footprint.x0;
      const d = p.footprint.y1 - p.footprint.y0;
      const wall = wallContact(p, room);
      const parts = [
        `${symbolOf.get(p.id)} = ${label(p.id)}`,
        `${w.toFixed(2)}×${d.toFixed(2)} m`,
        `at (${(p.x - room.rect.x0).toFixed(1)}, ${(p.y - room.rect.y0).toFixed(1)}) from the room's SW corner`,
      ];
      if (p.layer === 'top') parts.push(`on top of ${label(item?.target ?? '?')}`);
      else if (p.layer === 'ceiling') parts.push('hangs from the ceiling');
      else if (p.layer === 'wall') parts.push(`mounted on the ${wall ?? 'wall'} wall at height ${p.z.toFixed(2)}–${p.zMax.toFixed(2)} m`);
      else {
        parts.push(`front faces ${compass(p.facing)}`);
        parts.push(wall ? `back against the ${wall} wall` : 'free-standing');
        if (p.layer === 'floor') parts.push(`${clearanceAhead(p, room, here).toFixed(2)} m clear in front`);
      }
      if (item?.reason) parts.push(`why: ${item.reason}`);
      out.push('  ' + parts.join(' · '));
    }
    const unplaced = Object.values(layout.placed).filter((p) => p.status === 'unplaced' && p.room === room.id);
    for (const p of unplaced) out.push(`  NOT PLACED: ${label(p.id)} — ${p.note}`);

    // Pairs that are suspiciously tight (walkability), derived from the footprints.
    const floor = here.filter((p) => p.layer === 'floor');
    for (let i = 0; i < floor.length; i++) {
      for (let j = i + 1; j < floor.length; j++) {
        const gap = footprintGap(floor[i].footprint, floor[j].footprint);
        if (gap < 0.3) out.push(`  tight: ${symbolOf.get(floor[i].id)} and ${symbolOf.get(floor[j].id)} are only ${(gap * 100).toFixed(0)} cm apart`);
      }
    }
    out.push('');
  }
  if (layout.notes.length) out.push('NOTES: ' + layout.notes.join(' | '));
  return out.join('\n').trim();
}

const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

function footprintGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.hypot(dx, dy);
}
