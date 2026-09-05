"""Shared behavioral rules injected into every entry point (MCP server
instructions, the asset_first_workflow prompt, and the local Ollama chat
system prompt) so the rules apply regardless of which client drives the AI.
"""

ASSET_FIRST_PROTOCOL = """\
## Asset-First Scene Building Protocol

This applies whenever you are building or extending an interior scene \
(rooms, furniture layouts, product/prop arrangements) — anything where the \
objects involved resemble real-world furniture or decor.

### Rule 1 — Search before you model
Before calling `create_object` or any primitive-based modeling tool for \
something that resembles furniture, decor, lighting, seating, storage, a \
bed, a table, a rug, curtains, or similar household/interior objects, you \
MUST call `search_asset_library` first. The library holds ~90 pre-modeled, \
accurately-dimensioned assets across 14 categories (bed, seating, table, \
storage, lighting, soft_furnishing, decor, rug, sanitary, door_window, \
window_treatment, electronics, clothing, architecture). Call \
`list_asset_categories()` if you're unsure what's available.

### Rule 2 — Plan before you build
For any interior/room-building request, before making ANY tool calls, state \
a numbered "Room Bill of Materials": one line per object you intend to \
place, as:
  N. <role/description> — source: <asset_id> OR primitive (<why no asset fits>)
     position: <where/relation>, e.g. "centered against back wall" or \
"rests_on bed"
Only start executing tool calls after the full list is stated. If new \
objects come up mid-build, extend the plan first — don't improvise silently.

### Rule 3 — Reuse, don't rebuild
If `search_asset_library` returns a usable match, import and place it with \
`import_asset`. Do NOT hand-model a substitute for something the library \
already has, even if it seems faster — real-world scale and consistency \
beat improvisation. A `needs_review: true` or low `orientation_confidence` \
result is still usable — it just means double-check its orientation \
visually after placing it, not that you should avoid it.

### Rule 4 — Primitives are for what's actually missing
Reserve `create_object`/modeling tools for: room shells (walls, floor, \
ceiling), trim/mouldings, and object categories confirmed absent from the \
library after a search. State the reason explicitly in your plan (Rule 2) \
whenever you fall back to a primitive for something that sounds like \
furniture or decor.

### Rule 5 — Placement uses real dimensions, not guesses
Use `import_asset`'s `location` / `rotation_euler` / `place_on` / \
`snap_to_floor` parameters — it snaps assets to the floor or onto another \
named object using their true bounding box, so you don't compute z-offsets \
by hand. Use `place_on` to implement an asset's declared `relations` (e.g. a \
pillow that `rests_on` a bed/sofa) — check `get_asset_details()` for \
relations before placing dependent items, and always place the base object \
(bed, sofa, table) before anything that rests on it.

### Rule 6 — Verify visually
After placing the major assets for a room (or a batch of related ones), \
capture a viewport screenshot and compare composition, scale, and \
positioning against any reference image before continuing. Use `render_image` \
for this, not `get_viewport_screenshot` — the latter captures whatever the 3D \
viewport happens to be orbited to, not the scene's actual camera, and will \
silently show you the wrong thing.

### Rule 7 — Metadata tells you WHERE, not WHAT IT LOOKS LIKE
`width_mm`/`depth_mm`/`height_mm` and `needs_review` are extraction \
artifacts, not a quality signal — a `needs_review: false` asset can still be \
low quality, and `source.extraction_notes` (when present) often says more \
than the flags do (e.g. an entry whose notes say the source collection only \
contained a door handle, not a full body). When a category has multiple \
candidates and it matters which one you use (the main bed, a hero piece), \
import 1-2 candidates into an out-of-the-way spot, render a close-up of \
each, and compare before committing — don't pick by dimensions alone. Delete \
the losing candidates afterward.

### Rule 8 — Check sightlines, not just footprints
Two assets can each be placed at valid, non-overlapping floor positions and \
still have one fully block the camera's view of the other (e.g. a tall wide \
wardrobe in front of a wall-mounted mirror behind it). After placing wall- \
mounted or elevated items (mirrors, art, shelves), sanity-check that nothing \
closer to the camera and spanning the same angular range sits between the \
camera and it — not just that their footprints don't intersect.
"""
