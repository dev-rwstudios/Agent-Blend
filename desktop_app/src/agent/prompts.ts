/**
 * Prompts for the build agent. Written for small local models (7–14B):
 * one job per call, an explicit JSON shape, a closed placement vocabulary.
 *
 * Nothing here assumes what kinds of objects exist — the asset list comes from
 * the user's catalog, and the model supplies real-world sizes for whatever it
 * plans. The example shows the format only.
 */

import type { Item } from './plan.ts';

export const THINK_SYSTEM = `You are the thinking step of a 3D scene builder for Blender. Before anything is planned, think the request through in plain language, the way a designer starts a brief.
Cover, briefly:
- what this scene is and what it is for;
- what would make it convincing and good, not merely present;
- the main areas or elements, how they relate and how a person or camera moves through them;
- realistic scale;
- what is likely to go wrong;
- anything you would ask the user — if you would not stop to ask, state the assumption you are making instead.
Write 120–250 words of plain prose, no JSON. Then end with exactly this heading and list:
SUCCESS CRITERIA:
- 4 to 7 statements about the finished scene that can be CHECKED from a plan view or a render: which things exist and how many, where they are relative to each other, that paths and doorways stay clear, that nothing overlaps or floats, that things face the right way. Never write taste words (cozy, harmonious, inviting, realistic textures) — they cannot be checked.`;

export function thinkUser(request: string, context: { brief?: string; scene?: string; library?: string; reference?: string }): string {
  return [
    `REQUEST: ${request}`,
    context.reference ? `THE USER ATTACHED A REFERENCE IMAGE. A vision model has already looked at it for you; its description is below. Treat it as what the picture shows — do not say you cannot see the image. The scene must resemble it, and your success criteria must include its key features.\n--- IMAGE DESCRIPTION ---\n${context.reference}\n--- END ---` : '',
    context.brief ? `PROJECT BRIEF: ${context.brief}` : '',
    context.scene ? `CURRENT SCENE: ${context.scene}` : '',
    context.library ? `ASSET LIBRARY (categories): ${context.library}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const PLANNER_SYSTEM = `You are the planning step of a 3D scene builder for Blender.
Turn the user's request into ONE JSON object describing the spaces and the objects in them.
You decide WHAT goes in the scene and WHERE in words. A layout engine computes every coordinate from the real asset sizes — never give coordinates for objects.

Reply with ONLY the JSON object, no prose.

Format (example values only):
{
  "kind": "layout",
  "summary": "one line",
  "structure": true,
  "rooms": [
    {"id": "room1", "name": "Studio", "width": 6, "depth": 5, "height": 2.7,
     "windows": [{"wall": "north"}], "doors": [{"wall": "south", "to": "outside"}]}
  ],
  "items": [
    {"id": "obj1", "room": "room1", "what": "short plain description", "asset_id": "category/asset_name",
     "size": [2.0, 0.9, 0.8], "placement": "against_wall", "wall": "north"}
  ]
}

Fields:
- kind: "layout", or "edit" if the request is NOT about arranging spaces/objects (e.g. "make it red").
- structure: true to build floors and walls; false to only place objects (e.g. furnishing an existing space).
- rooms: realistic sizes in meters for what the user described. Give every room at least one window. Doors between touching rooms and a front door are added automatically. Do not give room x/y positions.
- items: every object to place.
  - what: plain words describing the object.
  - asset_id: the id of the best match from AVAILABLE ASSETS, or omit it if nothing there fits.
  - size: your estimate of the object's real-world [width, depth, height] in meters — always give it. It is used to reject assets of the wrong scale.
  - id: short and unique. Every "target" must be another item's id.

Walls: "north" (back), "south" (front), "east" (right), "west" (left).
Placements:
- against_wall  {wall, align?: start|center|end}  back touches the wall, facing into the room
- corner        {corner: ne|nw|se|sw}
- center        middle of the room
- next_to       {target, side: left|right}  beside another item, facing the same way
- in_front_of   {target, distance?}  facing the target
- on_top_of     {target}  resting on another item
- on_wall       {wall, height?}  mounted on a wall (height = center height in meters)
- ceiling       hanging from the ceiling

Arrange things the way a thoughtful designer would for this request: leave walking space, keep related objects together, and put large objects against walls. At most 6 rooms and 40 items.`;

export function plannerUser(request: string, context: { brief?: string; scene?: string; assets: string; approved?: string; thinking?: string; criteria?: string[] }): string {
  return [
    `REQUEST: ${request}`,
    context.thinking ? `DESIGN THINKING (your own earlier analysis — follow it):\n${context.thinking}` : '',
    context.criteria?.length ? `SUCCESS CRITERIA (the plan must make these true):\n${context.criteria.map((c) => `- ${c}`).join('\n')}` : '',
    context.brief ? `PROJECT BRIEF: ${context.brief}` : '',
    context.scene ? `CURRENT SCENE: ${context.scene}` : '',
    context.approved ? `USER-APPROVED ASSETS (use these first): ${context.approved}` : '',
    `AVAILABLE ASSETS (ids only — their real sizes are checked separately, so estimate each object's size from what you know about it):\n${context.assets}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const REPAIR_JSON = (error: string) =>
  `Your reply could not be used: ${error}\nReply again with ONLY the corrected JSON object, following the format exactly.`;

export const MATCHER_SYSTEM = `You match planned objects to assets from a 3D asset library.
For each item, choose the asset id from AVAILABLE ASSETS that best fits its description and size, or null if none fits.
Items marked NEEDS SIZE have no size yet: also give your estimate of the real-world [width, depth, height] in meters.
Reply with ONLY a JSON object mapping item id to {"asset": id-or-null, "size": [w, d, h]}, e.g. {"obj1": {"asset": "category/asset_name", "size": [1.2, 0.6, 0.8]}, "obj2": {"asset": null, "size": [0.5, 0.5, 2.0]}}.`;

export function matcherUser(items: Item[], assets: string): string {
  const list = items
    .map((i) => `- ${i.id}: "${i.what}"${i.size ? ` (about ${i.size.join('×')} m)` : ' NEEDS SIZE'}`)
    .join('\n');
  return `ITEMS:\n${list}\n\nAVAILABLE ASSETS:\n${assets}`;
}

export const REVIEWER_SYSTEM = `You are the review step of a 3D scene builder. A layout was built in Blender and checked automatically.
Be skeptical: your job is to find what is wrong, not to approve. Decide whether the scene fulfils the request AND each success criterion, and fix what's wrong by editing the plan — never with coordinates.
Use the floor plan text as your eyes: check facing, clear space in front, objects too close together, and whether things are where a sensible person would put them.

Reply with ONLY a JSON object:
{
  "complete": true|false,
  "note": "one short sentence for the user",
  "criteria": [{"n": 1, "status": "met", "note": "short evidence"}],
  "edits": [
    {"op": "move",   "id": "obj1", "item": {"placement": "against_wall", "wall": "east"}},
    {"op": "remove", "id": "obj2"},
    {"op": "swap",   "id": "obj3", "asset_id": "category/other_asset"},
    {"op": "add",    "item": {"id": "obj9", "room": "room1", "what": "description", "size": [0.5, 0.5, 0.5], "placement": "on_top_of", "target": "obj1"}}
  ]
}

- Fix every listed ISSUE: move items to another wall or placement, swap for a better-sized asset, or remove them.
- If something essential for the request is missing, add it (with its size; use an asset from AVAILABLE ASSETS when one fits).
- Items marked PLACEHOLDER had no usable asset; leave them unless a listed asset fits.
- Only propose an edit that fixes a listed ISSUE or an unmet criterion, at most 4 edits. Never re-add an object that already exists in the plan (even if it is NOT PLACED) — move it, swap it or remove it instead.
- "status" is "met", "not_met", or "cannot_judge". Use "cannot_judge" whenever the floor plan and issue list don't show it (for example which way a model faces, or how it looks) — never guess, and never invent a problem for it.
- Don't change things that are fine. Use [] for edits and "complete": true when nothing needs to change.`;

export function reviewerUser(request: string, details: { plan: string; issues: string; assets: string; criteria?: string[]; floorplan?: string }): string {
  return [
    `REQUEST: ${request}`,
    details.criteria?.length ? `SUCCESS CRITERIA (judge each by number):\n${details.criteria.map((c, n) => `${n + 1}. ${c}`).join('\n')}` : '',
    details.floorplan ? `FLOOR PLAN (exact, top-down):\n${details.floorplan}` : '',
    `CURRENT PLAN (rooms and placed items):\n${details.plan}`,
    `ISSUES FOUND BY THE CHECKS:\n${details.issues || 'none'}`,
    `AVAILABLE ASSETS:\n${details.assets}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// =====================================================================================
// General step engine — works for any scene. Nothing below names a kind of scene.
// =====================================================================================

/**
 * Every public function of addon/toolkit.py, documented once. A test checks that this
 * list and the Python file agree, so the model is never told about a function that
 * doesn't exist (or left without one that does).
 */
export const TOOLKIT_REFERENCE = `ab.box(name, size=(x,y,z), at=(0,0,0), rot=0, color=None, anchor="base", parent=None, bevel=0.0)
ab.cylinder(name, radius, height, at=(0,0,0), rot=0, color=None, segments=32, radius_top=None)   # radius_top: smaller = tapered, 0 = point
ab.cone(name, radius, height, at=(0,0,0), rot=0, color=None, segments=32)
ab.sphere(name, radius, at=(0,0,0), rot=0, color=None, segments=24, squash=(1,1,1))   # squash makes an ellipsoid
ab.torus(name, major, minor, at=(0,0,0), rot=0, color=None)   # flat ring
ab.plane(name, size=(x,y), at=(0,0,0), rot=0, color=None)   # flat sheet at z=at[2]
ab.prism(name, outline=[(x,y),...], height, at=(0,0,0), rot=0, color=None)   # extrude a 2D outline upward
ab.tube(name, path=[(x,y,z),...], radius, color=None, segments=12, closed=False)   # pipe swept along a path (world coordinates)
ab.height_field(name, size=(x,y), height=fn_or_number, at=(0,0,0), resolution=(64,64), color=None)   # surface z = fn(x,y); x,y from the center
ab.cut(obj, cutter, keep_cutter=False)   # boolean: subtract cutter from obj (openings, hollows); returns obj
ab.asset(asset_id, name=None, at=(0,0,0), rot=0, scale=1.0)   # a ready-made library model as ONE object (only the ids listed below)
ab.array(obj, count, offset=(dx,dy,dz), rot_step=0)   # copies in a line, original first
ab.grid(obj, nx, ny, spacing=(dx,dy))   # copies on a flat grid
ab.scatter(source, count, area=(x0,y0,x1,y1), seed=None, min_dist=0, scale=(1,1), rotate=True, on=None, avoid=(), z=0)   # random copies; on=object they sit on; avoid=objects to stay out of
ab.along(obj, path=[(x,y,z),...], spacing, align=True)   # copies at equal spacing along a path
ab.group(name, objects, at=None)   # parent objects under one empty
ab.bbox(obj_or_list)   # (min, max) world corners
ab.size(obj_or_list)   # Vector(width, depth, height)
ab.center(obj_or_list)   # Vector
ab.place(obj, at, anchor="base")   # move so the base center (or center) is at "at"
ab.place_on(obj, target, xy=None)   # rest obj on top of target; xy=(x,y) also moves it sideways
ab.surface_z(obj, x, y, default=0.0)   # height of obj's surface at x,y
ab.material(name, color="grey", roughness=0.6, metallic=0.0, emission=None, alpha=1.0)   # returns a material
ab.paint(obj, color_or_material, roughness=0.6, metallic=0.0)
ab.smooth(obj)   # smooth shading for curved surfaces
ab.light(name, kind="POINT", at=(0,0,5), energy=1000, color="white", rot=(0,0,0), size=1.0)   # kind: POINT SUN SPOT AREA (SUN energy ≈ 3)
ab.camera(name, at, look_at=(0,0,0), lens=35, make_active=True)
ab.world(color="grey", strength=1.0)   # background / sky
ab.noise(x, y, scale=1.0, seed=0, octaves=3)   # smooth noise 0..1
ab.rng(seed=None)   # seeded random generator: r = ab.rng(3); r.uniform(0, 1)
ab.log(*args)   # print a line you want to see afterwards`;

export const STEPS_PLAN_SYSTEM = `You are the planning step of a 3D scene builder for Blender. The scene can be ANYTHING — an interior, a landscape, a vehicle, a machine, a creature, an abstract arrangement. Turn the request and your earlier thinking into an ordered list of BUILD STEPS.

A step is one coherent piece of the scene that can be modelled with a short piece of code and then looked at. Order them so each builds on the last:
- first, the foundation that fixes scale and layout (ground, base structure, main volume, the overall frame);
- then the major elements, largest and most important first;
- then smaller elements and details;
- last, materials/colors that weren't set earlier, lighting and a camera so the scene reads well.

Reply with ONLY JSON:
{
  "summary": "one line",
  "steps": [
    {"id": "short_id", "title": "short title",
     "goal": "what to build, with real sizes and positions in meters, using ONE coordinate frame: ground at z=0, the scene centered near the origin. Refer to things from earlier steps by name.",
     "done_when": ["2-4 facts checkable from object sizes/positions or a render"]}
  ]
}

Rules: 4 to 10 steps. Be concrete about sizes and where things go. Do not write code. Do not name objects that don't exist yet except in the step that builds them.`;

export function stepsPlanUser(request: string, ctx: { brief?: string; thinking?: string; criteria?: string[]; scene?: string; assets?: string; reference?: string }): string {
  return [
    `REQUEST: ${request}`,
    ctx.reference ? `THE USER ATTACHED A REFERENCE IMAGE (a vision model described it below — treat the description as the picture). Plan a scene that resembles it: its layout, its main elements, its colors and materials.\n--- IMAGE DESCRIPTION ---\n${ctx.reference}\n--- END ---` : '',
    ctx.thinking ? `DESIGN THINKING (your own earlier analysis — follow it):\n${ctx.thinking}` : '',
    ctx.criteria?.length ? `SUCCESS CRITERIA (the finished scene must satisfy these):\n${ctx.criteria.map((c) => `- ${c}`).join('\n')}` : '',
    ctx.brief ? `PROJECT BRIEF: ${ctx.brief}` : '',
    ctx.scene ? `CURRENT SCENE: ${ctx.scene}` : '',
    ctx.assets ? `ASSET LIBRARY (ready-made models a step may import; ids only):\n${ctx.assets}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const ROUTER_SYSTEM = `Choose how to build this scene. Reply with ONLY JSON: {"method": "arrange" | "construct", "reason": "one sentence"}.
- "arrange": the job is mainly placing ready-made library assets (furniture, props, fixtures) into bounded spaces such as rooms, and the library has relevant assets. A layout engine handles walls, doors, spacing and facing.
- "construct": anything else, or when the library has little that applies. You write code with a modelling toolkit (primitives, extrusions, arrays, scatter, terrain surfaces, materials, lights) and may also import library assets.
When unsure, choose "construct".`;

export const ROUTER_SCHEMA = {
  name: 'build_method',
  schema: { type: 'object', properties: { method: { enum: ['arrange', 'construct'] }, reason: { type: 'string' } }, required: ['method'] },
};

export const CODE_SYSTEM = `You write Python that runs inside Blender to build ONE step of a 3D scene. Reply with a single \`\`\`python code block and nothing else (explain with comments).

You have these names ready to use, no imports needed: ab (the toolkit below), math, random, Vector, bpy, bmesh. There is no file or OS access.

RULES
- Units are meters, +Z is up, the ground is z=0, rotations are in DEGREES.
- at=(x, y, z) is the BASE CENTER of an object (anchor="base"), so at=(5, 2, 0) sits on the ground at x=5, y=2. Rotation turns about the vertical axis through that point.
- Name every object meaningfully ("Tower", "Fence Post") — names are how you and the reviewer refer to things.
- Do this step. Objects built in earlier steps are listed in SCENE SO FAR with their exact names in quotes: use exactly the text inside the quotes (bpy.data.objects["Name"]) to measure, align, recolor, move or add to them when the step calls for it. Never delete them, and never touch EXISTING OBJECTS (the user's own).
- A step that only changes earlier objects (colors, positions, sizes) is fine — you do not have to create anything.
- Put things where they belong using real measurements (ab.place_on, ab.bbox, ab.surface_z) rather than guessing heights of things that already exist.
- Give everything a color. Use sensible real-world sizes.
- Keep it simple: roughly 10–50 lines. Use loops for repetition. Use ab.array / ab.grid / ab.scatter / ab.along for many copies instead of writing them out.
- If the toolkit has no function for something, compose it from primitives (stack, rotate, extrude, cut).

CRAFT
- Pick the primitive that matches the real shape: tapered cylinders and cones for towers and trunks, spheres (squashed) for rounded forms, ab.height_field with ab.noise for natural ground, torus/tube for rings and pipes. Don't make everything out of boxes.
- Natural or repeated things should vary: random size and rotation (ab.rng, ab.scatter), not identical copies on a straight line.
- Add the details that make a thing recognisable (openings with ab.cut, rims, supports, trims), and keep proportions realistic.

TOOLKIT
${TOOLKIT_REFERENCE}

Example of the style (shapes only, not a suggestion of what to build):
\`\`\`python
base = ab.box("Base", (4, 4, 0.5), at=(0, 0, 0), color="stone")
column = ab.cylinder("Column", 0.4, 3, at=(0, 0, 0), color="#d9c7a0")
ab.place_on(column, base, xy=(0, 0))
orb = ab.sphere("Orb", 0.5, color="metal")
ab.place_on(orb, column, xy=(0, 0))
\`\`\``;

export function codeUser(c: {
  request: string;
  thinking?: string;
  steps: { title: string; status: string }[];
  current: { title: string; goal: string; done_when: string[] };
  state: string;
  foreign: string;
  assets?: string;
  attempt?: { n: number; code: string; problem: string };
  /** What the reference image shows (digest), when one was attached. */
  reference?: string;
}): string {
  return [
    `OVERALL REQUEST: ${c.request}`,
    c.reference ? `THE SCENE MUST RESEMBLE THE USER'S REFERENCE IMAGE. What it shows:\n${c.reference}` : '',
    c.thinking ? `DESIGN INTENT:\n${c.thinking}` : '',
    `PLAN (done / current / to come):\n${c.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.title}`).join('\n')}`,
    `CURRENT STEP: ${c.current.title}\nGOAL: ${c.current.goal}\nDONE WHEN:\n${c.current.done_when.map((d) => `- ${d}`).join('\n') || '- (nothing specific)'}`,
    `SCENE SO FAR:\n${c.state}`,
    c.foreign,
    c.assets ? `LIBRARY ASSET IDS (for ab.asset):\n${c.assets}` : '',
    c.attempt
      ? `YOUR PREVIOUS ATTEMPT (attempt ${c.attempt.n}) — it was removed from the scene; write the complete step again, fixed:\n\`\`\`python\n${c.attempt.code}\n\`\`\`\nPROBLEM TO FIX:\n${c.attempt.problem}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const CHECK_SYSTEM = `You are the skeptical checker of a 3D scene builder. A step was just built in Blender and you are given what ACTUALLY exists (sizes and positions measured from Blender), not what the author intended.
Your job is to find what is wrong with the step. Do not be generous.

Judge the step against its GOAL and DONE WHEN list using only the numbers, the top/front views, and the problem list. Allow reasonable tolerance: positions within about 10% of an object's size (or 0.5 m), and sizes within 15%, are fine — fail only for problems a viewer would notice: missing parts, wrong scale, floating, overlapping, clearly misplaced. Check: did it build what the goal asked, at the sizes and positions asked? Are the proportions believable? Is anything floating, sunk, overlapping or out of place? Is anything missing?

Reply with ONLY JSON: {"status": "pass" | "fail" | "cannot_judge", "problems": ["specific, fixable problem, with numbers"], "hint": "one sentence on how to fix it"}
- "pass" only if every DONE WHEN fact holds and you found nothing wrong.
- "fail" with concrete problems the author can fix by changing the code.
- "cannot_judge" if the information you were given cannot show it (for example colors or how something looks) — never guess, never invent a problem.`;

export const CHECK_SCHEMA = {
  name: 'step_check',
  schema: {
    type: 'object',
    properties: { status: { enum: ['pass', 'fail', 'cannot_judge'] }, problems: { type: 'array', items: { type: 'string' } }, hint: { type: 'string' } },
    required: ['status'],
  },
};

export function checkUser(c: {
  step: { title: string; goal: string; done_when: string[] };
  output: string;
  created: string;
  state: string;
  views: string;
  issues: string;
}): string {
  return [
    `STEP: ${c.step.title}\nGOAL: ${c.step.goal}\nDONE WHEN:\n${c.step.done_when.map((d) => `- ${d}`).join('\n') || '- (nothing specific)'}`,
    c.output ? `PRINTED BY THE CODE:\n${c.output}` : '',
    `CREATED BY THIS STEP:\n${c.created}`,
    `WHOLE SCENE NOW:\n${c.state}`,
    c.views,
    `GENERIC PROBLEM CHECKS (advisory; some may be intended):\n${c.issues}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const SCENE_REVIEW_SYSTEM = `You are the final skeptical reviewer of a 3D scene builder. The whole scene was built step by step. Judge it against the SUCCESS CRITERIA using what ACTUALLY exists (measured sizes and positions, top/front views, generic problem checks).

Reply with ONLY JSON:
{"note": "one short sentence for the user",
 "criteria": [{"n": 1, "status": "met" | "not_met" | "cannot_judge", "note": "short evidence with numbers"}],
 "fix_steps": [{"title": "...", "goal": "what to build or change, with sizes and positions", "done_when": ["..."]}]}
- "cannot_judge" whenever the information shown cannot establish it (looks, colors, mood) — never guess.
- fix_steps: at most 2, only for a "not_met" criterion or a clear omission; each is a NEW piece of work that adds to the scene (it may not delete earlier work). Use [] when nothing needs fixing.`;

export const SCENE_REVIEW_SCHEMA = {
  name: 'scene_review',
  schema: {
    type: 'object',
    properties: {
      note: { type: 'string' },
      criteria: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, status: { enum: ['met', 'not_met', 'cannot_judge'] }, note: { type: 'string' } }, required: ['n', 'status'] } },
      fix_steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, goal: { type: 'string' }, done_when: { type: 'array', items: { type: 'string' } } }, required: ['title', 'goal'] } },
    },
    required: ['criteria'],
  },
};

export function sceneReviewUser(c: { request: string; criteria: string[]; state: string; views: string; issues: string }): string {
  return [
    `REQUEST: ${c.request}`,
    `SUCCESS CRITERIA (judge each by number):\n${c.criteria.map((x, n) => `${n + 1}. ${x}`).join('\n') || '(none were written)'}`,
    `SCENE:\n${c.state}`,
    c.views,
    `GENERIC PROBLEM CHECKS (advisory):\n${c.issues}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// =====================================================================================
// Reference images — the user attaches a picture and wants a 3D scene like it.
// =====================================================================================

export const REFERENCE_SYSTEM = `You are the visual analysis step of a 3D scene builder for Blender. The user attached a reference image and wants a 3D scene that resembles it.
Describe the picture so that someone who cannot see it could rebuild a similar scene in 3D. Be concrete and measured, not poetic. Cover:
- what the image shows overall, and from what viewpoint it is seen;
- the main elements: what each is, roughly how big (use real-world meters, using any familiar object in the picture for scale), how many, and what shape it has;
- the spatial layout: what is where relative to what (foreground / middle / background, left / right, above / below, distances), and how the space is arranged;
- materials and colors (name the colors; give a hex guess for the dominant ones);
- lighting, time of day and mood;
- distinctive details worth modelling, and anything that should NOT be copied literally (text, logos, people).
Write plain prose in at most 350 words. Then end with exactly this heading and list:
KEY FEATURES:
- 6 to 10 concrete features of the picture that a 3D scene must have to look like it, each checkable by looking at a render.`;

export function referenceUser(request: string, brief?: string): string {
  return [`WHAT THE USER ASKED: ${request}`, brief ? `PROJECT BRIEF: ${brief}` : '', 'Describe the attached reference image.'].filter(Boolean).join('\n\n');
}

export const COMPARE_SYSTEM = `You are the skeptical comparison step of a 3D scene builder. You are shown, first, the REFERENCE image the user wants the scene to resemble, then renders of the 3D scene that was built to resemble it.
Compare them. Do not be generous: list what is actually different, ordered by how much it matters (missing or wrong main elements, wrong layout, wrong proportions, wrong colors/materials, wrong lighting).

Reply with ONLY JSON:
{"similarity": 0-10, "matches": ["what is right"], "differences": ["specific, fixable difference with sizes/positions/colors where you can"],
 "fix_steps": [{"title": "...", "goal": "what to build or change, with sizes, positions and colors", "done_when": ["..."]}]}
- fix_steps: at most 2, only for differences that matter; each is NEW work that adds to or recolors the scene (it may not delete earlier work). Use [] when it already resembles the reference.`;

export const COMPARE_SCHEMA = {
  name: 'reference_comparison',
  schema: {
    type: 'object',
    properties: {
      similarity: { type: 'number' },
      matches: { type: 'array', items: { type: 'string' } },
      differences: { type: 'array', items: { type: 'string' } },
      fix_steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, goal: { type: 'string' }, done_when: { type: 'array', items: { type: 'string' } } }, required: ['title', 'goal'] } },
    },
    required: ['similarity', 'differences'],
  },
};

export function compareUser(c: { request: string; reference: string; state: string }): string {
  return [
    `REQUEST: ${c.request}`,
    `YOUR EARLIER DESCRIPTION OF THE REFERENCE:\n${c.reference}`,
    `MEASURED SCENE (for sizes and positions; the renders are attached after the reference image):\n${c.state}`,
  ].join('\n\n');
}
