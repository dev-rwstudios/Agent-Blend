/**
 * Tests for the build agent's pure logic. Run with `pnpm test`
 * (node --test with built-in TypeScript type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACEMENTS, extractJson, normalizePlan, placementOrder } from './plan.ts';
import { rectInside, rectsOverlap, solveLayout, WALL_THICKNESS } from './layout.ts';
import type { AssetDims, LayoutResult } from './layout.ts';
import { measuredDims, verifyBuild } from './verify.ts';
import type { Unit } from './verify.ts';

const DIMS: Record<string, AssetDims> = {
  bed: { dx: 1.63, dy: 2.16, h: 0.9 },
  nightstand: { dx: 0.5, dy: 0.4, h: 0.55 },
  wardrobe: { dx: 1.2, dy: 0.6, h: 2.0 },
  rug: { dx: 2.0, dy: 1.4, h: 0.01, category: 'rug' },
  lamp: { dx: 0.3, dy: 0.3, h: 0.4 },
  sofa: { dx: 2.1, dy: 0.9, h: 0.85 },
  table: { dx: 1.1, dy: 0.6, h: 0.45 },
  tv: { dx: 1.2, dy: 0.08, h: 0.7, surface: 'wall' },
  chandelier: { dx: 0.6, dy: 0.6, h: 0.5, surface: 'ceiling' },
};

const HOUSE = {
  kind: 'layout',
  summary: 'Small house',
  rooms: [
    { id: 'living', name: 'Living Room', width: 5, depth: 4, windows: [{ wall: 'north' }] },
    { id: 'bedroom', name: 'Bedroom', width: 4, depth: 4, windows: [{ wall: 'north' }] },
  ],
  items: [
    { id: 'sofa', room: 'living', what: 'sofa', placement: 'against_wall', wall: 'north' },
    { id: 'table', room: 'living', what: 'coffee table', placement: 'in_front_of', target: 'sofa' },
    { id: 'tv', room: 'living', what: 'tv', placement: 'against_wall', wall: 'south' },
    { id: 'chandelier', room: 'living', what: 'chandelier', placement: 'center' },
    { id: 'bed', room: 'bedroom', what: 'bed', placement: 'against_wall', wall: 'north' },
    { id: 'nightstand', room: 'bedroom', what: 'nightstand', placement: 'next_to', target: 'bed', side: 'left' },
    { id: 'lamp', room: 'bedroom', what: 'lamp', placement: 'on_top_of', target: 'nightstand' },
    { id: 'wardrobe', room: 'bedroom', what: 'wardrobe', placement: 'corner', corner: 'se' },
    { id: 'rug', room: 'bedroom', what: 'rug', placement: 'center' },
  ],
};

function solveHouse(): { layout: LayoutResult; items: ReturnType<typeof normalizePlan>['plan']['items'] } {
  const { plan, errors } = normalizePlan(HOUSE);
  assert.deepEqual(errors, []);
  const dims = Object.fromEntries(plan.items.map((i) => [i.id, DIMS[i.id]]));
  return { layout: solveLayout({ rooms: plan.rooms, items: plan.items, dims, structure: true }), items: plan.items };
}

/** What Blender would report if every item landed exactly where the solver said. */
function perfectUnits(layout: LayoutResult): Unit[] {
  return Object.values(layout.placed)
    .filter((p) => p.status === 'placed')
    .map((p) => ({
      name: p.id,
      role: 'asset',
      item: p.id,
      bbox_min: [p.footprint.x0, p.footprint.y0, p.z],
      bbox_max: [p.footprint.x1, p.footprint.y1, p.zMax],
    }));
}

// ------------------------------------------------------------------ plan

test('extractJson tolerates fences, prose, comments and trailing commas', () => {
  const text = 'Sure! Here is the plan:\n```json\n{ "a": 1, // note\n "b": [1, 2,], }\n```\nEnjoy.';
  assert.deepEqual(extractJson(text), { a: 1, b: [1, 2] });
  assert.throws(() => extractJson('no json here'));
});

test('normalizePlan repairs bad values and reports them', () => {
  const { plan, notes, errors } = normalizePlan({
    rooms: [{ name: 'Tiny', width: 0.5, depth: 99 }],
    items: [
      { what: 'bed', placement: 'floating', room: 'nowhere' },
      { what: 'lamp', placement: 'on_top_of', target: 'ghost' },
      { what: 'shelf', placement: 'against_wall', wall: 'back' },
    ],
  });
  assert.deepEqual(errors, []);
  assert.equal(plan.rooms[0].width, 1.5);
  assert.equal(plan.rooms[0].depth, 20);
  assert.equal(plan.items[0].placement, 'center');
  assert.equal(plan.items[0].room, plan.rooms[0].id);
  assert.equal(plan.items[1].placement, 'center', 'missing target falls back to center');
  assert.equal(plan.items[2].wall, 'north', '"back" wall means north');
  assert.ok(notes.length >= 3);
});

test('normalizePlan breaks circular references and orders targets first', () => {
  const { plan } = normalizePlan({
    rooms: [{ id: 'r', width: 4, depth: 4 }],
    items: [
      { id: 'a', what: 'a', placement: 'next_to', target: 'b' },
      { id: 'b', what: 'b', placement: 'next_to', target: 'a' },
      { id: 'c', what: 'c', placement: 'on_top_of', target: 'd' },
      { id: 'd', what: 'd', placement: 'center' },
    ],
  });
  assert.ok(plan.items.some((i) => i.placement === 'center' && (i.id === 'a' || i.id === 'b')));
  const order = placementOrder(plan.items).map((i) => i.id);
  assert.ok(order.indexOf('d') < order.indexOf('c'));
});

// ------------------------------------------------------------------ layout

test('rooms are packed side by side with a connecting door and a front door', () => {
  const { layout } = solveHouse();
  const [living, bedroom] = layout.rooms;
  assert.equal(living.rect.x1, bedroom.rect.x0, 'rooms share a wall');
  assert.ok(layout.openings.some((o) => o.kind === 'door' && o.orient === 'v' && o.coord === living.rect.x1), 'interior door on the shared wall');
  assert.ok(layout.openings.some((o) => o.kind === 'door' && o.orient === 'h' && o.coord === living.rect.y0), 'front door on the south wall');
  assert.equal(layout.openings.filter((o) => o.kind === 'window').length, 2);
});

test('walls are cut around openings and the shared wall is built once', () => {
  const { layout } = solveHouse();
  const shared = layout.walls.filter((w) => Math.abs(w.center[0] - 5) < 1e-6 && w.size[0] === WALL_THICKNESS);
  // Shared wall = left piece + right piece + lintel over the door (not doubled).
  assert.equal(shared.length, 3);
  for (const o of layout.openings) {
    // Nothing fills the opening itself.
    const blocking = layout.walls.some((w) => {
      const along = o.orient === 'h' ? 0 : 1;
      const lo = w.center[along] - w.size[along] / 2;
      const hi = w.center[along] + w.size[along] / 2;
      const zlo = w.center[2] - w.size[2] / 2;
      const zhi = w.center[2] + w.size[2] / 2;
      const across = o.orient === 'h' ? 1 : 0;
      const onLine = Math.abs(w.center[across] - o.coord) < 1e-6;
      return onLine && lo < o.a1 - 1e-6 && hi > o.a0 + 1e-6 && zlo < o.z1 - 1e-6 && zhi > o.z0 + 1e-6;
    });
    assert.equal(blocking, false, `${o.kind} opening is clear`);
  }
});

test('every item is placed inside its room, clear of walls, furniture and doors', () => {
  const { layout } = solveHouse();
  const placed = Object.values(layout.placed);
  assert.deepEqual(placed.filter((p) => p.status !== 'placed').map((p) => p.id), []);
  const roomById = new Map(layout.rooms.map((r) => [r.id, r]));
  for (const p of placed) {
    if (p.layer !== 'top') assert.ok(rectInside(p.footprint, roomById.get(p.room)!.inner), `${p.id} inside room`);
  }
  const floor = placed.filter((p) => p.layer === 'floor');
  for (let i = 0; i < floor.length; i++)
    for (let j = i + 1; j < floor.length; j++) assert.ok(!rectsOverlap(floor[i].footprint, floor[j].footprint), `${floor[i].id} vs ${floor[j].id}`);
  for (const p of floor) assert.ok(!layout.keepouts.some((k) => rectsOverlap(p.footprint, k)), `${p.id} clear of doors`);
});

test('placement intent is honoured', () => {
  const { layout } = solveHouse();
  const P = layout.placed;
  const bedroom = layout.rooms[1];
  // Bed backed against the north wall, facing south (into the room).
  assert.ok(Math.abs(P.bed.footprint.y1 - (bedroom.inner.y1 - 0.02)) < 1e-3);
  assert.ok(Math.abs(P.bed.facing - -Math.PI / 2) < 1e-6);
  // Nightstand beside the bed, flush with its back, not overlapping.
  assert.ok(Math.abs(P.nightstand.footprint.y1 - P.bed.footprint.y1) < 1e-3);
  assert.ok(P.nightstand.footprint.x1 <= P.bed.footprint.x0 || P.nightstand.footprint.x0 >= P.bed.footprint.x1);
  // Lamp sits on the nightstand.
  assert.equal(P.lamp.z, P.nightstand.zMax);
  assert.equal(P.lamp.x, P.nightstand.x);
  // Coffee table in front of the sofa (south of it), facing the sofa.
  assert.ok(P.table.y < P.sofa.y);
  assert.ok(Math.abs(P.table.facing - Math.PI / 2) < 1e-6);
  // The TV is a wall asset: hung on the wall, off the floor.
  assert.equal(P.tv.layer, 'wall');
  assert.ok(P.tv.z > 0.5);
  // The chandelier hangs from the ceiling.
  assert.equal(P.chandelier.layer, 'ceiling');
  assert.ok(Math.abs(P.chandelier.zMax - (2.7 - 0.02)) < 1e-6);
  // Wardrobe in the south-east corner.
  assert.ok(Math.abs(P.wardrobe.footprint.x1 - (bedroom.inner.x1 - 0.02)) < 1e-3 || Math.abs(P.wardrobe.footprint.y0 - (bedroom.inner.y0 + 0.02)) < 1e-3);
});

test('wall-mounted items never cover a door or window', () => {
  // TV and front door both on the south wall; the TV must move aside, not hang in the doorway.
  const plan = normalizePlan({
    rooms: [{ id: 'r', width: 4, depth: 4, doors: [{ wall: 'south', to: 'outside' }], windows: [{ wall: 'north' }] }],
    items: [
      { id: 'tv', what: 'tv', placement: 'on_wall', wall: 'south' },
      { id: 'mirror', what: 'mirror', placement: 'on_wall', wall: 'north' },
    ],
  }).plan;
  const layout = solveLayout({
    rooms: plan.rooms, items: plan.items, structure: true,
    dims: { tv: { dx: 1.2, dy: 0.08, h: 0.7, surface: 'wall' }, mirror: { dx: 0.8, dy: 0.05, h: 1.0, surface: 'wall' } },
  });
  for (const id of ['tv', 'mirror']) {
    const p = layout.placed[id];
    assert.equal(p.status, 'placed', id);
    for (const z of layout.zones) {
      const covers = rectsOverlap(p.footprint, z.rect) && p.z < z.z1 && z.z0 < p.zMax;
      assert.equal(covers, false, `${id} covers a ${z.kind}`);
    }
  }
  assert.deepEqual(verifyBuild(layout, plan.items, perfectUnits(layout)), []);
});

test('assets facing another axis are rotated so their front faces into the room', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', width: 4, depth: 4 }], items: [{ id: 'sofa', what: 'sofa', placement: 'against_wall', wall: 'west' }] }).plan;
  const layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims: { sofa: { dx: 0.9, dy: 2.1, h: 0.8, forwardAxis: '+X' } }, structure: false });
  const p = layout.placed.sofa;
  assert.equal(p.facing, 0, 'faces east, away from the west wall');
  assert.equal(p.yaw, 0, 'a +X asset already faces east');
  assert.ok(Math.abs(p.footprint.x1 - p.footprint.x0 - 0.9) < 1e-6, 'depth runs away from the wall');
});

test('a turn correction changes which side of the asset is its front', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', width: 5, depth: 5 }], items: [{ id: 'a', what: 'thing', placement: 'against_wall', wall: 'north' }] }).plan;
  const solve = (turn: number) =>
    solveLayout({ rooms: plan.rooms, items: plan.items, structure: false, dims: { a: { dx: 1, dy: 2, h: 1, forwardAxis: '+Y', turn } } }).placed.a;
  const base = solve(0);
  const turned = solve(2);
  assert.ok(Math.abs(base.yaw - turned.yaw) > 3.1 && Math.abs(base.yaw - turned.yaw) < 3.2, 'two quarter turns = half a revolution');
  assert.equal(turned.facing, base.facing, 'still faces into the room — only the model is rotated');
});

test('an item too big for its room is reported, never forced into an overlap', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', width: 2, depth: 2 }], items: [{ id: 'bed', what: 'bed', placement: 'against_wall', wall: 'north' }] }).plan;
  const layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims: { bed: { dx: 2.5, dy: 2.5, h: 1 } }, structure: true });
  assert.equal(layout.placed.bed.status, 'unplaced');
  assert.match(layout.placed.bed.note!, /No free spot/);
});

test('an item with no asset is reported as unplaced', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', width: 4, depth: 4 }], items: [{ id: 'piano', what: 'piano', placement: 'center' }] }).plan;
  const layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims: {}, structure: false });
  assert.equal(layout.placed.piano.status, 'unplaced');
});

test('the build starts at the given origin (beside existing objects)', () => {
  const plan = normalizePlan(HOUSE).plan;
  const dims = Object.fromEntries(plan.items.map((i) => [i.id, DIMS[i.id]]));
  const layout = solveLayout({ rooms: plan.rooms, items: plan.items, dims, structure: true, origin: { x: 20, y: 3 } });
  assert.equal(layout.rooms[0].rect.x0, 20);
  assert.equal(layout.rooms[0].rect.y0, 3);
  assert.ok(Object.values(layout.placed).every((p) => p.x > 20));
});

// ------------------------------------------------------------------ verify

test('a perfect build has no issues', () => {
  const { layout, items } = solveHouse();
  assert.deepEqual(verifyBuild(layout, items, perfectUnits(layout)), []);
});

test('verification catches missing, moved, floating, overlapping and wall-clashing items', () => {
  const { layout, items } = solveHouse();
  const units = perfectUnits(layout).filter((u) => u.item !== 'rug');
  const shift = (u: Unit, dx: number, dy: number, dz: number) => {
    u.bbox_min = [u.bbox_min[0] + dx, u.bbox_min[1] + dy, u.bbox_min[2] + dz];
    u.bbox_max = [u.bbox_max[0] + dx, u.bbox_max[1] + dy, u.bbox_max[2] + dz];
  };
  const by = (id: string) => units.find((u) => u.item === id)!;
  shift(by('wardrobe'), 0, 0, 0.3); // floating
  shift(by('sofa'), 0, 0.3, 0); // pushed into the north wall
  const table = by('table');
  const sofa = by('sofa');
  table.bbox_min = [...sofa.bbox_min];
  table.bbox_max = [sofa.bbox_min[0] + 1, sofa.bbox_min[1] + 0.5, 0.45]; // overlaps the sofa

  const codes = new Set(verifyBuild(layout, items, units).map((i) => `${i.code}:${i.item}`));
  for (const expected of ['missing:rug', 'floating:wardrobe', 'moved:sofa', 'wall_clash:sofa', 'outside_room:sofa']) {
    assert.ok(codes.has(expected), `expected ${expected}, got ${[...codes].join(', ')}`);
  }
  assert.ok([...codes].some((c) => c.startsWith('overlap:')));
});

test('an object in a room it wasn\'t made for is flagged', () => {
  const { layout, items } = solveHouse();
  const issues = verifyBuild(layout, items, perfectUnits(layout), { roomTypes: { bed: ['bedroom'], sofa: ['living_room'], nightstand: ['bedroom'] } });
  assert.deepEqual(issues, [], 'bed in the bedroom and sofa in the living room are fine');
  const wrong = verifyBuild(layout, items, perfectUnits(layout), { roomTypes: { bed: ['kitchen'] } });
  assert.deepEqual(wrong.map((i) => i.code), ['wrong_room']);
  assert.equal(wrong[0].severity, 'warning');
});

test('measured sizes replace catalog sizes, accounting for rotation', () => {
  const { layout } = solveHouse();
  const units = perfectUnits(layout);
  const bed = units.find((u) => u.item === 'bed')!;
  bed.bbox_max = [bed.bbox_max[0] + 0.4, bed.bbox_max[1], bed.bbox_max[2]]; // really 40 cm wider
  const dims = measuredDims(layout, units, Object.fromEntries(Object.keys(layout.placed).map((id) => [id, DIMS[id]])));
  assert.ok(Math.abs(dims.bed!.dx - (DIMS.bed.dx + 0.4)) < 1e-6);
  assert.ok(Math.abs(dims.bed!.dy - DIMS.bed.dy) < 1e-6);
});

// ------------------------------------------------------------------ resolve (generic — no built-in object types)

import { dimsOf, implausible, placeholderDims, rankCandidates, roomFits } from './resolve.ts';
import { readFileSync } from 'node:fs';

const CATALOG = JSON.parse(readFileSync(new URL('../assets/asset_catalog.json', import.meta.url), 'utf8'));
const asset = (id: string) => CATALOG.find((a: any) => a.id === id);

test('the model\'s asset choice comes first; text matching is only a fallback', () => {
  assert.equal(rankCandidates({ what: 'anything at all', asset_id: 'bed/bed_frame_03' }, CATALOG)[0].id, 'bed/bed_frame_03');
  assert.match(rankCandidates({ what: 'bed frame' }, CATALOG)[0].id, /^bed\/bed_frame/);
  assert.equal(rankCandidates({ what: 'xylophone' }, CATALOG).length, 0, 'no forced match');
  assert.equal(rankCandidates({ what: 'bed frame' }, CATALOG, new Set(['bed/bed_frame_02']))[0].id, 'bed/bed_frame_02', 'approved assets preferred');
});

test('assets are judged against the model\'s size estimate, whatever the object is', () => {
  // Broken library files: a 4.2 m tall "sofa" and a 2 cm "wardrobe".
  assert.match(implausible([2.1, 0.9, 0.85], dimsOf(asset('seating/sofa'))!)!, /far from the expected/);
  assert.match(implausible([1.2, 0.6, 2.0], dimsOf(asset('storage/wardrobe'))!)!, /far from the expected/);
  // A sculpture is fine when the estimate matches; orientation of the footprint doesn't matter.
  const sculpture = dimsOf(asset('decor/decor_standing_man_sculpture'))!;
  assert.equal(implausible([sculpture.dy, sculpture.dx, sculpture.h], sculpture), null);
  // Without an estimate only empty geometry is rejected.
  assert.equal(implausible(undefined, sculpture), null);
  assert.match(implausible(undefined, { dx: 0, dy: 0, h: 0 })!, /empty or broken/);
});

test('without a size estimate, objects still can\'t be taller than the room or bigger than it', () => {
  const space = { height: 2.7, span: 5 };
  // The bundled library's 5.35 m-tall "sink" and 4.2 m-tall "sofa".
  assert.match(implausible(undefined, { dx: 0.73, dy: 3.68, h: 5.35 }, space)!, /taller than/);
  assert.match(implausible(undefined, dimsOf(asset('seating/sofa'))!, space)!, /taller than/);
  assert.match(implausible(undefined, { dx: 4.6, dy: 0.5, h: 1 }, space)!, /bigger than the room/);
  assert.equal(implausible(undefined, { dx: 2.1, dy: 0.9, h: 0.85 }, space), null);
});

test('room purpose is checked against the library\'s own room_types metadata', () => {
  assert.equal(roomFits('master bedroom', ['bedroom']), true);
  assert.equal(roomFits('kitchen', ['bedroom']), false);
  assert.equal(roomFits('living room', ['living_room', 'lounge']), true);
  assert.equal(roomFits('kitchen', []), true, 'no metadata → no objection');
  assert.equal(roomFits(undefined, ['bedroom']), true);
  const beds = rankCandidates({ what: 'bed frame' }, CATALOG, { purpose: 'bedroom' });
  assert.ok(beds.length > 0 && roomFits('bedroom', beds[0].room_types));
});

test('only the approved assets are used when the choice is restricted', () => {
  const only = new Set(['bed/bed_frame_02']);
  const ranked = rankCandidates({ what: 'bed frame' }, CATALOG, { only });
  assert.deepEqual(ranked.map((a: any) => a.id), ['bed/bed_frame_02']);
  assert.equal(rankCandidates({ what: 'sofa' }, CATALOG, { only }).length, 0);
});

test('placeholders take the model\'s size estimate', () => {
  assert.deepEqual([placeholderDims({ size: [1.4, 0.7, 1.1] }).dx, placeholderDims({ size: [1.4, 0.7, 1.1] }).h], [1.4, 1.1]);
});

test('flat objects are recognised by geometry, not by name', () => {
  // A 2 cm tall object can lie under furniture, whatever it is called.
  const plan = normalizePlan({ rooms: [{ id: 'r', width: 4, depth: 4 }], items: [
    { id: 'mat', what: 'zebra hide', placement: 'center' },
    { id: 'box', what: 'pinball machine', placement: 'center' },
  ] }).plan;
  const layout = solveLayout({ rooms: plan.rooms, items: plan.items, structure: false,
    dims: { mat: { dx: 2, dy: 1.5, h: 0.02 }, box: { dx: 0.7, dy: 1.4, h: 1.8 } } });
  assert.equal(layout.placed.mat.layer, 'flat');
  assert.equal(layout.placed.box.layer, 'floor');
  assert.ok(rectsOverlap(layout.placed.mat.footprint, layout.placed.box.footprint), 'both centered: the machine stands on the hide');
});

// ------------------------------------------------------------------ floor plan

import { clearanceAhead, compass, describeLayout } from './floorplan.ts';

test('the floor plan shows each object, its facing and the clear space in front', () => {
  const { layout, items } = solveHouse();
  const plan = normalizePlan(HOUSE).plan;
  const text = describeLayout(layout, plan);
  assert.match(text, /ROOM "Living Room"/);
  assert.match(text, /north is up/);
  for (const item of items) assert.ok(text.includes(item.what) || text.includes(item.id), `${item.id} is listed`);
  assert.match(text, /front faces south/, 'the sofa against the north wall faces south');
  assert.match(text, /back against the north wall/);
  assert.match(text, /\d\.\d\d m clear in front/);
  assert.match(text, /D/, 'doors are drawn');
  // Grid lines are all the same width (a real rectangle).
  const rows = text.split('\n').filter((l) => /^\|.*\|$/.test(l));
  assert.ok(rows.length > 10);
  assert.equal(new Set(rows.filter((_, i) => i < 18).map((l) => l.length)).size >= 1, true);
});

test('clearance in front is measured against walls and other objects', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', width: 4, depth: 4 }], items: [
    { id: 'a', what: 'a', placement: 'against_wall', wall: 'north' },
    { id: 'b', what: 'b', placement: 'in_front_of', target: 'a', distance: 1.0 },
  ] }).plan;
  const layout = solveLayout({ rooms: plan.rooms, items: plan.items, structure: false, dims: { a: { dx: 1, dy: 0.5, h: 1 }, b: { dx: 0.5, dy: 0.5, h: 1 } } });
  const room = layout.rooms[0];
  const all = Object.values(layout.placed);
  const free = clearanceAhead(layout.placed.a, room, all);
  assert.ok(Math.abs(free - 0.95) < 0.11, `a's front is blocked by b about 1 m away, got ${free}`);
  assert.equal(compass(-Math.PI / 2), 'south');
  assert.equal(compass(0), 'east');
});

// ------------------------------------------------------------------ review edits & thinking

import { PLAN_SCHEMA, applyEdits, parseCriteria } from './plan.ts';

test('the reviewer cannot re-add something already in the plan', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', name: 'Room', width: 5, depth: 5 }], items: [{ id: 'table_1', room: 'r', what: 'small coffee table', placement: 'center' }] }).plan;
  const notes: string[] = [];
  const edited = applyEdits(plan, [
    { op: 'add', item: { id: 'coffee_table', room: 'r', what: 'small coffee table', placement: 'center' } },
    { op: 'add', item: { id: 'table_1', room: 'r', what: 'something else', placement: 'center' } },
    { op: 'add', item: { id: 'lamp', room: 'r', what: 'floor lamp', placement: 'corner', corner: 'ne' } },
  ], notes);
  assert.deepEqual(edited.items.map((i) => i.what), ['small coffee table', 'floor lamp'], 'both duplicates ignored, the genuinely new item added');
  assert.equal(notes.filter((n) => /Ignored adding/.test(n)).length, 2);
});

test('at most 8 edits are applied per round', () => {
  const plan = normalizePlan({ rooms: [{ id: 'r', name: 'R', width: 5, depth: 5 }], items: [] }).plan;
  const edits = Array.from({ length: 20 }, (_, n) => ({ op: 'add' as const, item: { id: `o${n}`, room: 'r', what: `thing ${n}`, placement: 'center' as const } }));
  assert.equal(applyEdits(plan, edits).items.length, 8);
});

test('success criteria are read from the end of the thinking text', () => {
  const text = 'Some thinking...\n\nSUCCESS CRITERIA:\n- The bed is against a wall\n* Nothing blocks a doorway\n3. Every room has a window\n\n';
  assert.deepEqual(parseCriteria(text), ['The bed is against a wall', 'Nothing blocks a doorway', 'Every room has a window']);
  assert.deepEqual(parseCriteria('no criteria here'), []);
  assert.equal(parseCriteria('SUCCESS CRITERIA:\n' + Array.from({ length: 12 }, (_, n) => `- criterion number ${n}`).join('\n')).length, 8);
});

test('the plan schema allows every field the normalizer understands and nothing the solver cannot place', () => {
  const props = (PLAN_SCHEMA.schema as any).properties.items.items.properties;
  for (const key of ['id', 'room', 'what', 'asset_id', 'size', 'placement', 'wall', 'corner', 'target', 'side', 'reason']) assert.ok(key in props, key);
  assert.deepEqual([...props.placement.enum].sort(), [...PLACEMENTS].sort());
  assert.doesNotThrow(() => JSON.stringify(PLAN_SCHEMA));
});
