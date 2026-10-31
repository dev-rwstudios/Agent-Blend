# Build Agent — plan → build → verify → repair

How the desktop app turns "build a house" into a finished, checked scene.

## What was wrong (measured, not guessed)

| # | Problem | Evidence |
|---|---|---|
| 1 | Scene requests never reached the model as a build task. A keyword matcher (`curator.ts`) swapped the model's answer for a hard-coded template: sofa at (-2, 1.2), bed at (2.5, 1.0)… identical every time. | Saved chat: "can you build a house" → staging manifest with those exact coordinates; model reply discarded. |
| 2 | Asset files still carry the coordinates of the scene they were cut from. Any import path that doesn't re-center reproduces the old layout. | 86 of 88 `model.glb` files sit far from the origin (bed at (3.96, 4.48), coat at (-0.85, 13.34)). |
| 3 | Multi-part assets aren't grouped. 15 assets import as several loose roots; the name lands on an arbitrary part, so moving "the bed" later moves only one piece. | 15 multi-root assets. |
| 4 | One-shot execution: one model reply, tools run, done. No look at the result, no checking, no second pass. | `handleSendMessage` |
| 5 | The model gets no spatial facts (asset sizes, room bounds, what's occupied) and has no tools for walls/doors/windows — so "build a house" can only mean "drop furniture". | `SYSTEM_PROMPT` lists 8 tools; no structure tools. |

## Principles

1. **The model decides *what* and *where, in words*; code decides the coordinates.**
   Small local models are poor at arithmetic with 3D coordinates and great at
   intent. The model writes a plan like "bed against the north wall, centered;
   nightstand next to the bed, left". A deterministic layout solver turns that
   into exact positions using real asset dimensions, room bounds, wall
   thickness and door clearances.
2. **Every step is checked against the real scene.** After building, the agent
   reads back actual bounding boxes from Blender and runs objective checks.
3. **Repair loops until clean or a hard limit.** Deterministic fixes first
   (snap, slide, clamp), then the model reviews what's left.
4. **Nothing is silent.** The user sees each phase, the issues found, the
   fixes, review screenshots, and a final completeness checklist.
5. **Nothing about objects is hard-coded.** The code has no list of furniture
   types, synonyms or size tables — it works for any asset library and any
   kind of object. Meaning comes from the model (which asset fits, how big the
   object really is), behaviour comes from geometry and metadata (a 2 cm-tall
   object is a floor covering; `placement.surface` says wall/ceiling mount).
6. **Safe by construction.** Checkpoint before every run (one-click undo),
   never delete user objects, everything the agent builds lives in its own
   collection and is tagged.

## The run

```
 user: "build a small 2-bedroom house"
   │
   ▼
 1. PLAN (LLM → JSON)        rooms + sizes, doors/windows, items with placement intent
   │   validate + normalize (bad JSON → one repair round)
   │   Plan mode: show plan, wait for "Run". Build mode: continue.
   ▼
 2. RESOLVE ASSETS (code)    each item → best catalog match (bucket-approved first),
   │                         real dimensions; unmatched → reported (or simple primitive)
   ▼
 3. LAYOUT (code)            rooms packed (shared walls), wall segments cut around
   │                         doors/windows, furniture positioned from intent with
   │                         collision avoidance + door clearance
   ▼
 4. BUILD (Blender)          checkpoint → floor/walls (one command) → assets imported,
   │                         normalized, grouped under one anchor each, rotated, tagged
   ▼
 5. VERIFY (Blender + code)  read back real bboxes → checks: missing items, overlaps,
   │                         wall penetration, outside room, floating/sunken,
   │                         blocked doors, scale mismatch; review screenshot
   ▼
 6. REPAIR (≤3 rounds)       deterministic fixes → re-verify → LLM reviews remaining
   │                         issues and returns plan edits (move/swap/remove/add)
   ▼
 7. REPORT                   checklist of every planned item ✓/✗, remaining issues,
                             final screenshot, autosave, "Undo build"
```

### Choosing assets (generic)

1. The planner sets `asset_id` from the real catalog and estimates every item's
   real-world `size` [w, d, h].
2. Items without a valid id go to one batched **matcher** call (item → asset id
   or `null` = nothing fits).
3. Every candidate's real size (catalog, or measured in Blender with
   `measure_asset` when metadata is missing) must be within 2.5× of the
   estimate — this rejects broken files and wrong scales (the bundled library's
   4.2 m-tall "sofa", its 2 cm "wardrobe", sofa *pillows* matched by name).
4. Nothing believable → a **placeholder** box at the estimated size, clearly
   labeled in the scene and the checklist. Text matching is only a fallback
   when the model gave no answer.

### Plan schema (what the model writes)

```json
{
  "kind": "layout",
  "summary": "Small 2-bedroom house",
  "rooms": [
    {"id": "living", "name": "Living Room", "width": 5, "depth": 4, "height": 2.7,
     "doors":   [{"wall": "south", "to": "outside"}],
     "windows": [{"wall": "north"}]}
  ],
  "items": [
    {"id": "obj1", "room": "living", "what": "plain description", "asset_id": "category/name",
     "size": [2.0, 0.9, 0.8], "placement": "against_wall", "wall": "north"},
    {"id": "obj2", "room": "living", "what": "plain description", "size": [1.0, 0.6, 0.45],
     "placement": "in_front_of", "target": "obj1"}
  ]
}
```

Placement vocabulary (small enough for a 7–14B model): `against_wall`
(wall, align start/center/end), `corner`, `center`, `next_to` (target, side),
`in_front_of` (target, distance), `on_top_of` (target), `on_wall` (wall, height),
`ceiling`. Coordinates are optional — rooms without them are packed
automatically and adjacent rooms get connecting doors.

### Verification checks

| Check | Rule |
|---|---|
| Missing | every planned item exists in the scene |
| Overlap | furniture AABBs don't intersect (rugs and on-top-of pairs exempt) |
| Wall clash | furniture doesn't penetrate wall segments |
| Outside room | floor items stay inside their room |
| Floating / sunken | floor items rest at z = 0; on-top items rest on their target |
| Door blocked | nothing stands in a door's clearance zone |
| Covers opening | nothing hangs in / stands across a door or window |
| Scale | imported size matches catalog size (±20 %) |

## Edge cases

- **Not a layout request** ("make the sphere gold") → normal one-shot tool flow.
- **Blender disconnects mid-run** → stop, report what was done; checkpoint allows undo.
- **Broken or wrong-scale asset** → rejected with its real size in the log; next candidate, else a placeholder.
- **Asset import fails** → item reported as missing; run continues.
- **Item larger than its room / no free spot** → solver reports it instead of overlapping.
- **Existing objects in the scene** → the new build is placed beside them, never on top; nothing existing is deleted.
- **Model returns invalid JSON** → one repair prompt with the error; then fail with a clear message.
- **Model can't see images** (e.g. qwen2.5-coder) → review uses the objective checks; screenshots are still shown to the user.
- **User stops the run** → stops after the current step; partial result kept, undo available.
- **Re-running** → each run gets its own collection (`Build 2`, …) and checkpoint.

## Code map

| Piece | Where |
|---|---|
| Plan types, validation, JSON extraction, review edits | `desktop_app/src/agent/plan.ts` |
| Asset matching + size plausibility (generic) | `desktop_app/src/agent/resolve.ts` |
| Layout solver + wall/opening geometry | `desktop_app/src/agent/layout.ts` |
| Verification checks | `desktop_app/src/agent/verify.ts` |
| Prompts | `desktop_app/src/agent/prompts.ts` |
| Orchestrator (LLM + Blender) | `desktop_app/src/agent/buildAgent.ts` |
| Run UI | `desktop_app/src/components/BuildRunCard.tsx` |
| Blender side | `addon/handlers/scene_build.py` (`build_boxes`, `get_layout`, `capture_review`, `remove_units`, `measure_asset`), `import_asset` re-centering/grouping/rotation in `file_ops.py` |
| Tests | `desktop_app/src/agent/agent.test.ts` (`pnpm test`), `tests/test_addon/test_handlers/test_scene_build_handler.py` |
