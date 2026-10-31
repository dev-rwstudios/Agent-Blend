/**
 * Objective checks of what was actually built, using the bounding boxes
 * Blender reports (addon `get_layout`) against the solved layout.
 *
 * Pure module (node --test).
 */

import type { AssetDims, LayoutResult, PlacedItem, Rect, Vec3 } from './layout.ts';
import { rectInside, rectsOverlap } from './layout.ts';
import type { Item } from './plan.ts';
import { roomFits } from './resolve.ts';

/** One tagged unit read back from Blender. */
export interface Unit {
  name: string;
  role: string;
  item?: string;
  bbox_min: Vec3;
  bbox_max: Vec3;
}

export type IssueCode =
  | 'unplaced'
  | 'missing'
  | 'moved'
  | 'floating'
  | 'sunken'
  | 'outside_room'
  | 'overlap'
  | 'wall_clash'
  | 'door_blocked'
  | 'covers_opening'
  | 'wrong_room'
  | 'size_mismatch';

export interface Issue {
  severity: 'error' | 'warning';
  code: IssueCode;
  item?: string;
  other?: string;
  message: string;
}

const TOL = 0.03;

const footprintOf = (u: Unit): Rect => ({ x0: u.bbox_min[0], y0: u.bbox_min[1], x1: u.bbox_max[0], y1: u.bbox_max[1] });

/** Overlap depth along each axis; positive on all three means the boxes intersect. */
function overlap3(aMin: Vec3, aMax: Vec3, bMin: Vec3, bMax: Vec3): number {
  let depth = Infinity;
  for (let i = 0; i < 3; i++) depth = Math.min(depth, Math.min(aMax[i], bMax[i]) - Math.max(aMin[i], bMin[i]));
  return depth;
}

function shrink(r: Rect, by: number): Rect {
  return { x0: r.x0 + by, y0: r.y0 + by, x1: r.x1 - by, y1: r.y1 - by };
}

export interface VerifyContext {
  /** room_types metadata of each item's chosen asset (absent/empty = unknown). */
  roomTypes?: Record<string, string[] | null | undefined>;
}

export function verifyBuild(layout: LayoutResult, items: Item[], units: Unit[], ctx: VerifyContext = {}): Issue[] {
  const issues: Issue[] = [];
  const label = new Map(items.map((i) => [i.id, i.what]));
  const name = (id: string) => `"${label.get(id) ?? id}"`;
  const unitByItem = new Map(units.filter((u) => u.item).map((u) => [u.item!, u]));
  // Only resting on top of something is allowed to share space with it.
  const targetOf = new Map(items.filter((i) => i.target && i.placement === 'on_top_of').map((i) => [i.id, i.target!]));

  // 1. Every planned item must exist, where the solver put it.
  const present: { p: PlacedItem; u: Unit }[] = [];
  for (const item of items) {
    const p = layout.placed[item.id];
    if (!p || p.status !== 'placed') {
      issues.push({ severity: 'error', code: 'unplaced', item: item.id, message: `${name(item.id)} could not be placed: ${p?.note ?? 'no layout'}` });
      continue;
    }
    const u = unitByItem.get(item.id);
    if (!u) {
      issues.push({ severity: 'error', code: 'missing', item: item.id, message: `${name(item.id)} is missing from the scene.` });
      continue;
    }
    present.push({ p, u });
    const cx = (u.bbox_min[0] + u.bbox_max[0]) / 2;
    const cy = (u.bbox_min[1] + u.bbox_max[1]) / 2;
    if (Math.hypot(cx - p.x, cy - p.y) > 0.05) {
      issues.push({ severity: 'error', code: 'moved', item: item.id, message: `${name(item.id)} is ${Math.hypot(cx - p.x, cy - p.y).toFixed(2)} m from its planned spot.` });
    }
    const dz = u.bbox_min[2] - p.z;
    if (dz > TOL) issues.push({ severity: 'error', code: 'floating', item: item.id, message: `${name(item.id)} floats ${dz.toFixed(2)} m above where it should rest.` });
    if (dz < -TOL) issues.push({ severity: 'error', code: 'sunken', item: item.id, message: `${name(item.id)} sinks ${(-dz).toFixed(2)} m below where it should rest.` });
  }

  // 2. Floor items stay inside their room.
  const roomById = new Map(layout.rooms.map((r) => [r.id, r]));
  for (const { p, u } of present) {
    if (p.layer === 'top' || p.layer === 'ceiling') continue;
    const room = roomById.get(p.room);
    if (room && !rectInside(footprintOf(u), room.inner, TOL)) {
      issues.push({ severity: 'error', code: 'outside_room', item: p.id, message: `${name(p.id)} sticks out of ${room.name}.` });
    }
  }

  // 3. No furniture intersects other furniture (flat floor coverings, things resting on each other and ceiling items excepted).
  const solid = present.filter(({ p }) => p.layer === 'floor' || p.layer === 'wall');
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      if (targetOf.get(a.p.id) === b.p.id || targetOf.get(b.p.id) === a.p.id) continue;
      if (overlap3(a.u.bbox_min, a.u.bbox_max, b.u.bbox_min, b.u.bbox_max) > TOL) {
        issues.push({ severity: 'error', code: 'overlap', item: a.p.id, other: b.p.id, message: `${name(a.p.id)} overlaps ${name(b.p.id)}.` });
      }
    }
  }

  // 4. Furniture doesn't go through walls.
  for (const { p, u } of present) {
    if (p.layer === 'top' || p.layer === 'ceiling' || p.layer === 'flat') continue;
    const clash = layout.walls.find((w) => {
      const wMin: Vec3 = [w.center[0] - w.size[0] / 2, w.center[1] - w.size[1] / 2, w.center[2] - w.size[2] / 2];
      const wMax: Vec3 = [w.center[0] + w.size[0] / 2, w.center[1] + w.size[1] / 2, w.center[2] + w.size[2] / 2];
      return overlap3(u.bbox_min, u.bbox_max, wMin, wMax) > TOL;
    });
    if (clash) issues.push({ severity: 'error', code: 'wall_clash', item: p.id, message: `${name(p.id)} goes through a wall.` });
  }

  // 5. Doors stay passable.
  for (const { p, u } of present) {
    if (p.layer !== 'floor') continue;
    if (layout.keepouts.some((k) => rectsOverlap(shrink(footprintOf(u), TOL), k))) {
      issues.push({ severity: 'error', code: 'door_blocked', item: p.id, message: `${name(p.id)} blocks a doorway.` });
    }
  }

  // 6a. Objects belong in rooms their library metadata says they're made for.
  for (const item of items) {
    const room = roomById.get(item.room);
    const types = ctx.roomTypes?.[item.id];
    if (room && types && types.length > 0 && !roomFits(room.purpose, types)) {
      issues.push({
        severity: 'warning',
        code: 'wrong_room',
        item: item.id,
        message: `${name(item.id)} is meant for ${types.join('/').replace(/_/g, ' ')}, not a ${room.purpose ?? room.name}.`,
      });
    }
  }

  // 6. Nothing hangs in or stands across a door or window.
  for (const { p, u } of present) {
    if (p.layer !== 'wall' && p.layer !== 'floor') continue;
    for (const zone of layout.zones ?? []) {
      const zOverlap = Math.min(u.bbox_max[2], zone.z1) - Math.max(u.bbox_min[2], zone.z0);
      if (zOverlap > TOL && rectsOverlap(shrink(footprintOf(u), TOL), zone.rect)) {
        const isDoor = zone.kind === 'door';
        issues.push({
          severity: isDoor || p.layer === 'wall' ? 'error' : 'warning',
          code: 'covers_opening',
          item: p.id,
          message: `${name(p.id)} covers a ${zone.kind}.`,
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Real asset sizes from what Blender reports — catalog sizes are sometimes
 * wrong, and the solver should work with the truth on the next round.
 */
export function measuredDims(layout: LayoutResult, units: Unit[], current: Record<string, AssetDims | undefined>): Record<string, AssetDims | undefined> {
  const out = { ...current };
  for (const u of units) {
    if (!u.item || !out[u.item]) continue;
    const p = layout.placed[u.item];
    if (!p || p.status !== 'placed') continue;
    const sx = u.bbox_max[0] - u.bbox_min[0];
    const sy = u.bbox_max[1] - u.bbox_min[1];
    const sz = u.bbox_max[2] - u.bbox_min[2];
    const quarter = Math.abs(Math.round(p.yaw / (Math.PI / 2))) % 2 === 1;
    out[u.item] = { ...out[u.item]!, dx: quarter ? sy : sx, dy: quarter ? sx : sy, h: sz };
  }
  return out;
}

/** Items whose real size differs a lot from the catalog's (worth telling the user). */
export function sizeMismatches(before: Record<string, AssetDims | undefined>, after: Record<string, AssetDims | undefined>, items: Item[]): Issue[] {
  const issues: Issue[] = [];
  for (const item of items) {
    const a = before[item.id];
    const b = after[item.id];
    if (!a || !b) continue;
    const off = Math.max(Math.abs(b.dx - a.dx) / a.dx, Math.abs(b.dy - a.dy) / a.dy, Math.abs(b.h - a.h) / a.h);
    if (off > 0.25) {
      issues.push({
        severity: 'warning',
        code: 'size_mismatch',
        item: item.id,
        message: `"${item.what}" is ${b.dx.toFixed(2)}×${b.dy.toFixed(2)}×${b.h.toFixed(2)} m, not the catalog's ${a.dx.toFixed(2)}×${a.dy.toFixed(2)}×${a.h.toFixed(2)} m — layout adjusted.`,
      });
    }
  }
  return issues;
}
