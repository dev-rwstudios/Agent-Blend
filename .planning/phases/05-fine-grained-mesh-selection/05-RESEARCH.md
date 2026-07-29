# Phase 05: Fine-Grained Mesh Selection & Selection Sets - Research

**Researched:** 2026-07-29
**Domain:** Blender Python API (bmesh edit-mesh selection, ID properties), MCP tool/handler patterns
**Confidence:** HIGH (core selection API), MEDIUM (select_similar enum surface, ID-property storage choice)

## Summary

Phase 5 closes the README's documented "Selection is all-or-nothing" limitation. Today, every `mesh_editing.py` handler calls `_enter_edit_select_all(obj)` before operating — there is no code path anywhere in the addon that selects a subset of a mesh. This phase adds that primitive: select vertices/edges/faces by index, save/recall named selection sets, and grow/shrink/select-similar refinement — all built on `bmesh.from_edit_mesh()` (the *live* edit-mesh bmesh, not the detached `bmesh.new()` pattern `mesh_quality.py` uses for read-only analysis).

**Central architectural finding (read this before planning Task 1):** Setting a selection is only useful if something can consume it. None of the 15 existing `mesh_editing.py` operations respect an incoming selection — they all force select-all first. Phase 5's requirements (SEL-01..05, see ROADMAP.md) only cover the selection primitives themselves, not rewiring existing operations to optionally respect prior selection. That rewiring is real, cross-cutting, 15-handler-touching work and is **out of scope for this phase** — it's called out as a new deferred requirement (SEL-06) at the end of this document. Phase 5 tools must leave the mesh in **Edit Mode with the selection live** after returning (a deliberate deviation from every other mesh_editing handler, which always returns to Object Mode) — this is the only way the selection has any observable effect between one MCP call and the next, since Blender's addon session persists across stateless MCP requests even though the MCP protocol itself does not.

**Primary recommendation:** Two plans. Plan 1 (SEL-01/02/03): index-based selection primitive + the `validate_index_list` validator + shared `_select_by_indices` handler helper, added directly to `mesh_editing.py` (existing module, existing `register()` pattern — no new files needed at the addon layer; new MCP tool functions appended to `src/blend_ai/tools/mesh_editing.py`). Plan 2 (SEL-04/05): selection sets (stored as a JSON string custom property on the mesh datablock) and grow/shrink/select-similar, building on Plan 1's edit-mode-stays-active convention.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEL-01 | Select vertices by index list on a mesh object in edit mode | New `select_vertices_by_index` MCP tool + `handle_select_vertices_by_index` handler using `bmesh.from_edit_mesh` |
| SEL-02 | Select edges by index list on a mesh object in edit mode | Same pattern, `bm.edges` |
| SEL-03 | Select faces by index list on a mesh object in edit mode | Same pattern, `bm.faces` |
| SEL-04 | Save current selection as a named set; recall/reapply by name | JSON custom property on `obj.data` (`blend_ai_selection_sets`); save/recall/list tools |
| SEL-05 | Grow/shrink selection or select-similar from a seed selection | `bpy.ops.mesh.select_more/less/similar` wrapped as MCP tools, operating on whatever is currently selected in Edit Mode |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bmesh (bpy built-in) | Blender 4.2+ / 5.1 | Live edit-mesh selection state access | `bmesh.from_edit_mesh()` is the only way to read/write per-element `.select` while in Edit Mode |
| bpy.ops.mesh | Blender 4.2+ / 5.1 | `select_all`, `select_mode`, `select_more`, `select_less`, `select_similar` | Official operators; no bmesh equivalent gives the same "grow along topology" behavior without hand-rolling BFS over `link_edges`/`link_faces` |
| json (stdlib) | Python 3.10+ | Serialize named selection sets into a single string custom property | stdlib only — addon has a zero-pip-dependency constraint |

### No New External Dependencies
Everything needed is already in the project stack (`bmesh`, `bpy.ops`, `json` stdlib). No `pyproject.toml` changes required.

## Architecture Patterns

### Recommended Project Structure (additions)

```
src/blend_ai/
├── tools/
│   └── mesh_editing.py       # Append 8-9 new @mcp.tool() functions (existing file, existing import already in server.py)
├── validators.py             # Add validate_index_list()
addon/
├── handlers/
│   └── mesh_editing.py       # Append handle_* functions + register() calls (existing register() pattern, NOT the module-level dispatcher.register_handler() pattern mesh_quality.py uses)
tests/
├── test_tools/
│   └── test_mesh_editing.py  # Extend existing file with new test classes
├── test_addon/test_handlers/
│   └── test_mesh_editing_handler.py  # NEW — no handler-level test file exists for mesh_editing today (gap noted below)
```

**Important registration-pattern note:** This codebase has two handler registration styles. `addon/handlers/mesh_quality.py` calls `dispatcher.register_handler(...)` directly at module scope (executed on import). `addon/handlers/mesh_editing.py` (the file this phase extends) instead defines a `register()` function that `addon/handlers/__init__.py` calls explicitly (`mod.register()` for every module in `_modules`). **New selection handlers must be added to `mesh_editing.py`'s existing `register()` function**, matching that file's own convention — not the mesh_quality.py module-level pattern.

### Pattern 1: Select-by-index using the live edit-mesh

**What:** Enter Edit Mode, set the select mode, deselect everything, then flip `.select = True` on exactly the requested element indices via the *live* edit-mesh bmesh (`bmesh.from_edit_mesh`, not `bmesh.new()`).

**Critical difference from `mesh_quality.py`'s bmesh usage:** `mesh_quality.py` calls `bmesh.new()` + `bm.from_mesh(obj.data)` to get a **detached copy** for read-only analysis, and must `bm.free()` it when done. Selection tools must do the opposite: `bmesh.from_edit_mesh(obj.data)` returns a reference to the **live** mesh being edited. Calling `.free()` on it, or treating it like a detached copy, will corrupt the edit session. After mutating `.select`, changes must be pushed back with `bmesh.update_edit_mesh(obj.data)` — there is no `.free()` call in this pattern at all.

```python
# Source: bmesh.from_edit_mesh / bmesh.update_edit_mesh — stable since Blender 2.8,
# unchanged through 5.1. Verified against project's own bmesh usage in mesh_quality.py
# handler (bmesh.new pattern) — this is the sibling "edit mesh" pattern, documented at
# docs.blender.org/api/current/bmesh.html#edit-mode-tessellation
import bpy
import bmesh

def _select_by_indices(obj, indices, elem_type):
    """Enter edit mode and select only the given element indices.

    elem_type: one of 'VERT', 'EDGE', 'FACE' (matches bpy.ops.mesh.select_mode type values).
    Leaves the object in EDIT MODE with the selection applied — callers must NOT
    force it back to OBJECT mode (unlike every other mesh_editing handler).
    """
    _select_only(obj)  # existing helper in mesh_editing.py
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type=elem_type)
    bpy.ops.mesh.select_all(action="DESELECT")

    bm = bmesh.from_edit_mesh(obj.data)
    seq = {"VERT": bm.verts, "EDGE": bm.edges, "FACE": bm.faces}[elem_type]
    seq.ensure_lookup_table()

    max_index = len(seq) - 1
    selected, invalid = [], []
    for i in indices:
        if 0 <= i <= max_index:
            seq[i].select = True
            selected.append(i)
        else:
            invalid.append(i)

    bm.select_flush(True)
    bmesh.update_edit_mesh(obj.data)
    return selected, invalid
```

### Pattern 2: Selection Sets via JSON Custom Property

**What:** Blender datablocks support arbitrary "custom properties" (ID properties) — `obj.data["any_key"] = value`. Rather than relying on Blender's automatic Python→IDProperty type coercion for nested dict/list structures (which is finicky across versions for deeply nested data), store one JSON **string** property and (de)serialize with the stdlib `json` module. This is a common, robust addon-data-on-datablock pattern and keeps the addon's "stdlib + bpy only" constraint intact.

```python
import json

SELECTION_SETS_KEY = "blend_ai_selection_sets"

def _load_selection_sets(obj) -> dict:
    raw = obj.data.get(SELECTION_SETS_KEY, "{}")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}

def _save_selection_sets(obj, sets: dict) -> None:
    obj.data[SELECTION_SETS_KEY] = json.dumps(sets)
```

Save format per set: `{"vert": [1,2,3], "edge": [], "face": [7]}` — captures selected indices across all three element types simultaneously (a user may have mixed selections from manual Blender use), read via one bmesh pass with `elem.select` checked per element rather than relying on the current `select_mode`.

**Recall** deselects everything, then re-applies each populated list via the same per-type loop as Pattern 1 (skipping empty lists) — object ends in Edit Mode, mirroring Pattern 1.

### Pattern 3: Grow / Shrink / Select-Similar

**What:** Thin wrappers over `bpy.ops.mesh.select_more()`, `bpy.ops.mesh.select_less()`, and `bpy.ops.mesh.select_similar(type=..., threshold=...)`. These operate on **whatever is currently selected** in Edit Mode — they do not take index lists. If the object is not already in Edit Mode with a live selection (e.g., `select_vertices_by_index` was never called), raise a clear `ValueError` rather than silently entering edit mode with nothing selected.

```python
def handle_grow_selection(params):
    obj = _get_mesh_object(params["object_name"])
    if obj.mode != "EDIT":
        raise ValueError(
            f"Object '{obj.name}' has no active edit-mode selection. "
            "Call select_vertices_by_index/select_edges_by_index/select_faces_by_index "
            "(or select_selection_set) first."
        )
    bpy.ops.mesh.select_more()
    bm = bmesh.from_edit_mesh(obj.data)
    return {"object": obj.name, "selected_count": _count_selected(bm)}
```

**`select_similar` type enum — confidence MEDIUM, verify at implementation time.** The exact enum identifier set differs by current select mode (vertex/edge/face) and this document could not verify the precise string values against live Blender API docs (`docs.blender.org` blocked automated fetches during this research pass — see Sources). Long-standing, high-confidence identifiers from the Blender manual and community references: face mode → `MATERIAL`, `AREA`, `NORMAL`; edge mode → `LENGTH`, `DIR`, `FACE_ANGLE`; vertex mode → `NORMAL`, `AMOUNT_OF_CONNECTING_EDGES`. **Recommendation:** scope the `select_similar` tool's `compare_by` parameter to a conservative, well-attested subset — `NORMAL` (valid in all three modes), plus `MATERIAL` and `AREA` for face mode — validated via `validate_enum`, and confirm the exact strings against the target Blender 5.1 installation during Task implementation (run `bpy.ops.mesh.select_similar` from Blender's Python console with autocomplete, or check `bpy.types.Operator.bl_rna.properties['type'].enum_items` at runtime) before shipping the final allowlist.

### Anti-Patterns to Avoid

- **Using `bmesh.new()` + `bm.from_mesh()` for selection tools**: That pattern (used correctly in `mesh_quality.py` for read-only analysis) creates a *detached* mesh copy — mutating `.select` on it and calling `.free()` has zero effect on the actual Blender selection. Selection tools must use `bmesh.from_edit_mesh(obj.data)` + `bmesh.update_edit_mesh(obj.data)`.
- **Calling `bm.free()` on an edit-mesh bmesh**: Only detached (`bmesh.new()`) bmeshes are freed. Freeing the live edit-mesh bmesh is invalid.
- **Forcing `mode_set(mode="OBJECT")` at the end of a selection handler**: Every other `mesh_editing.py` handler does this via `_enter_edit_select_all` + final `mode_set(OBJECT)`. Selection tools must NOT — the whole point is for the selection to remain live for the next call.
- **Storing selection sets as raw nested Python dicts/lists directly as ID properties**: Works but with version-dependent coercion quirks (IDPropertyGroup vs IDPropertyArray edge cases for empty lists / mixed types). A single JSON string property sidesteps this entirely.
- **Assuming `select_similar` enum values without runtime verification**: See Pattern 3 — confirm against the actual Blender 5.1 install before finalizing the allowlist.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grow selection along topology | Manual BFS over `vert.link_edges` / `edge.link_faces` | `bpy.ops.mesh.select_more()` | Handles vertex/edge/face select-mode semantics and boundary cases (e.g. mixed selections) that Blender's own operator already resolves correctly |
| Shrink selection | Manual "remove boundary elements" logic | `bpy.ops.mesh.select_less()` | Same rationale — inverse of select_more, already correct |
| Structural similarity comparison | Custom per-vertex/edge/face property diffing | `bpy.ops.mesh.select_similar(type=..., threshold=...)` | Blender's implementation already handles the threshold/tolerance math correctly across element types |
| Selection state serialization | Custom binary or pickle format on disk | `json.dumps`/`json.loads` into a single string ID property | stdlib-only, human-inspectable, survives file save/reload as part of the .blend file automatically (ID properties persist with the datablock) |

**Key insight:** Every needed primitive (select subset, grow, shrink, select-similar) already exists as a stable `bpy.ops.mesh.*` operator or `bmesh` element property — this phase is wiring, not new mesh-processing algorithms.

## Runtime State Inventory

> Feature-addition phase (no rename/refactor of existing tools). Omit — no runtime state migration required for existing tools. New runtime state introduced: the `blend_ai_selection_sets` custom property on mesh datablocks (additive, does not affect existing `.blend` files or existing tool behavior).

## Common Pitfalls

### Pitfall 1: `bmesh.from_edit_mesh` Requires Being in Edit Mode Already
**What goes wrong:** Calling `bmesh.from_edit_mesh(obj.data)` while the object is in Object Mode raises an error or returns unusable/stale mesh state.
**Why it happens:** The "edit mesh" bmesh only exists while Blender has that object's mesh open for editing.
**How to avoid:** Always call `bpy.ops.object.mode_set(mode="EDIT")` *before* `bmesh.from_edit_mesh()`, mirroring `_enter_edit_select_all`'s existing `mode_set(mode="EDIT")` call, but without the trailing `select_all(action="SELECT")` (that would defeat the purpose) and without the trailing `mode_set(mode="OBJECT")`.
**Warning signs:** `RuntimeError` from bmesh, or selection appears to do nothing.

### Pitfall 2: Forgetting `bmesh.update_edit_mesh()` After Mutating `.select`
**What goes wrong:** Element `.select` flags are changed on the bmesh in memory, but the viewport / mesh data never reflects it, and a subsequent `bpy.ops.mesh.*` call operates on the old selection.
**Why it happens:** `bmesh.from_edit_mesh()` gives a live reference, but Blender still needs an explicit flush/update call to sync internal caches (tessellation, display).
**How to avoid:** Always call `bmesh.update_edit_mesh(obj.data)` immediately after mutating selection state, before returning from the handler.
**Warning signs:** `select_more`/`select_less`/subsequent tool calls act as if nothing (or everything, from a stale `select_all`) is selected.

### Pitfall 3: `ensure_lookup_table()` Required Before Indexing
**What goes wrong:** `bm.verts[i]` / `bm.edges[i]` / `bm.faces[i]` raises an `IndexError` or returns stale results if the lookup table wasn't rebuilt after prior topology changes in the same bmesh session.
**Why it happens:** BMesh element sequences cache their index-to-element mapping lazily; it isn't guaranteed valid after mode switches or other operator calls.
**How to avoid:** Call `seq.ensure_lookup_table()` right after acquiring `bm.verts`/`bm.edges`/`bm.faces`, before any indexed access — this project's own `mesh_quality.py` handler already does this for its (detached) bmesh; the same call is required (and equally necessary) for the live edit-mesh bmesh.
**Warning signs:** Intermittent `IndexError: BMElemSeq[index]: outdated internal index table`.

### Pitfall 4: Out-of-Range Indices Should Not Hard-Fail the Whole Call
**What goes wrong:** If the LLM requests index 500 on a 200-vertex mesh, a naive `seq[i]` raises and aborts the entire selection, even though the other 20 valid indices in the same request were fine.
**Why it happens:** Direct indexing throws on out-of-range access.
**How to avoid:** Bounds-check each index against `len(seq) - 1` before indexing (see Pattern 1); collect `invalid` indices separately and return them in the response rather than raising, so the LLM can see exactly what was skipped and why.
**Warning signs:** Entire selection calls fail on a single bad index instead of degrading gracefully.

### Pitfall 5: `obj.data.get(key, default)` on Custom Properties Returns an IDPropertyGroup-Adjacent Type, Not Always a Plain `str`
**What goes wrong:** If a selection-sets property was ever set to something other than a plain string (e.g., by external code or a future version accidentally assigning a dict), `json.loads()` on it raises `TypeError` instead of `ValueError`.
**Why it happens:** ID properties can technically hold several coercible types.
**How to avoid:** Catch both `(ValueError, TypeError)` when parsing (see Pattern 2's `_load_selection_sets`), falling back to an empty dict rather than crashing the handler.
**Warning signs:** `save_selection_set` works but a subsequent `list_selection_sets`/`select_selection_set` on the same object throws instead of showing prior data.

## Code Examples

### Full selection handler skeleton (Task 1 target)
```python
# addon/handlers/mesh_editing.py additions
import bmesh  # new import — mesh_editing.py currently only imports bpy

def handle_select_vertices_by_index(params):
    obj = _get_mesh_object(params["object_name"])
    indices = params.get("indices", [])
    selected, invalid = _select_by_indices(obj, indices, "VERT")
    return {"object": obj.name, "selected": selected, "invalid": invalid, "mode": "EDIT"}

def handle_select_edges_by_index(params):
    obj = _get_mesh_object(params["object_name"])
    indices = params.get("indices", [])
    selected, invalid = _select_by_indices(obj, indices, "EDGE")
    return {"object": obj.name, "selected": selected, "invalid": invalid, "mode": "EDIT"}

def handle_select_faces_by_index(params):
    obj = _get_mesh_object(params["object_name"])
    indices = params.get("indices", [])
    selected, invalid = _select_by_indices(obj, indices, "FACE")
    return {"object": obj.name, "selected": selected, "invalid": invalid, "mode": "EDIT"}
```

Note `_get_mesh_object` is reused as-is from the existing file (no `_ensure_object_mode()` call needed first — `_select_only` + explicit `mode_set(mode="EDIT")` inside `_select_by_indices` already handles the transition safely from either starting mode).

### Validator addition
```python
# src/blend_ai/validators.py addition
MAX_INDEX_LIST_LENGTH = 10000  # generous cap; mirrors MAX_ARRAY_COUNT precedent

def validate_index_list(indices: list, name: str = "indices") -> list[int]:
    """Validate a list of non-negative mesh element indices."""
    if not isinstance(indices, (list, tuple)):
        raise ValidationError(f"{name} must be a list of integers")
    if len(indices) > MAX_INDEX_LIST_LENGTH:
        raise ValidationError(f"{name} exceeds maximum length of {MAX_INDEX_LIST_LENGTH}")
    for i in indices:
        if not isinstance(i, int) or isinstance(i, bool) or i < 0:
            raise ValidationError(f"{name} must contain only non-negative integers, got {i!r}")
    return list(indices)
```
(`isinstance(i, bool)` excluded explicitly because `bool` is a subclass of `int` in Python — `True`/`False` should not silently pass as indices 1/0.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| All mesh_editing tools force `select_all` before operating | Unchanged by this phase — selection primitives are additive | N/A | Existing 15 tools' behavior is 100% unaffected; new tools are purely additive |

No Blender-version-specific deprecations affect this phase — `bmesh.from_edit_mesh`, `bmesh.update_edit_mesh`, and the relevant `bpy.ops.mesh.*` operators have been stable since Blender 2.8 and are unaffected by the 4.2→5.1 API changes Phase 1 already handled.

## Open Questions

1. **Should existing mesh_editing tools be taught to respect an incoming selection?**
   - What we know: This is the only way index-based selection becomes useful for "granular mesh editing" beyond the selection tools themselves (e.g., `inset_faces` on just one face).
   - What's unclear: Whether to touch all 15 existing handlers now or defer.
   - Recommendation: **Defer.** Scope as new requirement **SEL-06** (added to REQUIREMENTS.md v3 deferred bucket): add an optional `use_selection: bool = False` parameter to the highest-value existing operations (inset_faces, dissolve_faces/edges/verts, mark_seam, mark_sharp, set_edge_crease) that, when True, skips the forced `select_all` step. Keeping Phase 5 scoped to the primitives themselves keeps this plan reviewable and avoids touching 15 handlers' worth of surface area in one phase.

2. **`select_similar` exact enum values** (see Pattern 3) — MEDIUM confidence, verify against the actual Blender 5.1 installation during implementation rather than trusting this document's curated subset blindly.

3. **Should `list_selection_sets` be a separate tool, or folded into `select_selection_set`'s error message?**
   - What we know: MCP is stateless — the LLM has no memory of what set names it previously saved in a fresh context.
   - Recommendation: Ship `list_selection_sets(object_name)` as a small additional tool in Plan 2 (not a new requirement — it's an implementation necessity for SEL-04's "recall by name" to be usable at all, same as how Phase 2 added `get_installed_extensions` as a supporting handler for GUIDE-04/05 without a dedicated requirement ID).

## Environment Availability

> Code/config changes only — no new external tool or pip dependency. Runtime dependency is Blender 4.2+ with the addon loaded (already verified working; Blender 5.1 confirmed installed on this machine at `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe`).

Step 2.6: SKIPPED (no new external dependencies).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 (confirmed installed via `uv sync`) |
| Config file | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| Quick run command | `uv run pytest tests/test_tools/test_mesh_editing.py tests/test_addon/test_handlers/test_mesh_editing_handler.py -x` |
| Full suite command | `uv run pytest tests/ -x` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEL-01 | select_vertices_by_index selects exactly the requested valid indices, reports invalid ones, leaves object in EDIT mode | unit | `uv run pytest tests/test_addon/test_handlers/test_mesh_editing_handler.py::TestSelectVerticesByIndex tests/test_tools/test_mesh_editing.py::TestSelectVerticesByIndex -x` | Wave 0 (new handler test file) |
| SEL-02 | select_edges_by_index same contract for edges | unit | `uv run pytest tests/test_addon/test_handlers/test_mesh_editing_handler.py::TestSelectEdgesByIndex tests/test_tools/test_mesh_editing.py::TestSelectEdgesByIndex -x` | Wave 0 |
| SEL-03 | select_faces_by_index same contract for faces | unit | `uv run pytest tests/test_addon/test_handlers/test_mesh_editing_handler.py::TestSelectFacesByIndex tests/test_tools/test_mesh_editing.py::TestSelectFacesByIndex -x` | Wave 0 |
| SEL-04 | save/select/list selection sets round-trip correctly via JSON custom property | unit | `uv run pytest tests/test_addon/test_handlers/test_mesh_editing_handler.py::TestSelectionSets tests/test_tools/test_mesh_editing.py::TestSelectionSets -x` | Wave 0 |
| SEL-05 | grow/shrink/select_similar operate on current selection; raise clear error if not in edit mode | unit | `uv run pytest tests/test_addon/test_handlers/test_mesh_editing_handler.py::TestGrowShrinkSimilar tests/test_tools/test_mesh_editing.py::TestGrowShrinkSimilar -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** Quick run on the affected test file(s)
- **Per plan merge:** `uv run pytest tests/ -x`
- **Phase gate:** Full suite green before considering Phase 5 done

### Wave 0 Gaps
- [ ] `tests/test_addon/test_handlers/test_mesh_editing_handler.py` — does not exist yet; this is also the first handler-level test coverage for ANY mesh_editing.py handler (existing 15 operations are tested only at the tool/dispatch layer today, not the handler/bmesh layer — pre-existing gap, out of scope to backfill, but the new file should only cover the NEW handlers added by this phase)
- [ ] New test classes in `tests/test_tools/test_mesh_editing.py` for all new tools (existing file, additive)
- [ ] `tests/test_tools/test_validators.py` (or wherever validator tests live — confirm exact file) — add `TestValidateIndexList` class

## Project Constraints (from CLAUDE.md / PROJECT.md)

- **Thread model**: All bpy/bmesh calls happen inside handler functions invoked via the existing main-thread queue dispatch — no new threading concerns, same as every other handler.
- **Security**: No arbitrary code execution. Index lists are validated (non-negative ints, capped length) before reaching Blender; selection set names reuse `validate_object_name`.
- **MCP protocol**: Stateless. Selection sets must therefore be listable (`list_selection_sets`) since the LLM cannot rely on remembering what it saved in a prior turn.
- **Test-first**: Write test files before handler/tool implementation (TDD), matching Phase 2's established pattern.
- **Blender API**: Official `bmesh`/`bpy.ops` only.
- **Zero-dependency addon**: `json` is stdlib — no violation.
- **Naming conventions**: `select_vertices_by_index`/`select_edges_by_index`/`select_faces_by_index`, `save_selection_set`/`select_selection_set`/`list_selection_sets`, `grow_selection`/`shrink_selection`/`select_similar`. Handlers prefixed `handle_*`, matching every existing module.

## Sources

### Primary (HIGH confidence)
- Existing codebase (`addon/handlers/mesh_editing.py`, `addon/handlers/mesh_quality.py`, `addon/dispatcher.py`, `addon/handlers/__init__.py`, `src/blend_ai/validators.py`, `src/blend_ai/tools/mesh_editing.py`, `tests/test_addon/test_handlers/test_mesh_quality_handler.py`, `tests/test_addon/test_handlers/test_objects_handler.py`, `tests/test_addon/conftest.py`) — all read directly; registration pattern, validator conventions, and handler-test importlib pattern confirmed by direct inspection, not inference.
- `bmesh.from_edit_mesh` / `bmesh.update_edit_mesh` / `ensure_lookup_table` — stable, extensively-documented core BMesh API unchanged since Blender 2.8; same family of API this project's own `02-RESEARCH.md` already relied on (HIGH confidence there for the sibling `bmesh.new()` pattern).

### Secondary (MEDIUM confidence)
- `bpy.ops.mesh.select_similar` enum surface — WebSearch of Blender manual/community references confirmed `MATERIAL`/`AREA`/`NORMAL` (face), `LENGTH`/`DIR`/`FACE_ANGLE` (edge), `NORMAL`/`AMOUNT_OF_CONNECTING_EDGES` (vertex) as long-standing identifiers, but `docs.blender.org` blocked automated fetches during this research pass (HTTP 403 on both `/api/current/bpy.ops.mesh.html` and the manual's Select Similar page) — could not cross-check the exhaustive/current list directly. Must be verified against the actual Blender 5.1 install before finalizing the tool's enum allowlist.

### Tertiary (LOW confidence)
- None — where confidence was insufficient (select_similar enum), it is called out explicitly above rather than presented as fact.

## Metadata

**Confidence breakdown:**
- Registration pattern, existing helper reuse, validator conventions: HIGH — confirmed by direct file reads, not inference
- Core select-by-index bmesh pattern (SEL-01/02/03): HIGH — `bmesh.from_edit_mesh`/`update_edit_mesh` is stable, well-documented, unchanged across the Blender versions this project targets
- Selection sets JSON storage (SEL-04): HIGH for the storage mechanism (ID properties are standard, well-established); MEDIUM for exact edge cases around empty/absent property handling — mitigated by the `(ValueError, TypeError)` catch documented in Pitfall 5
- Grow/shrink (SEL-05 partial): HIGH — `select_more`/`select_less` take no meaningful parameters and are simple wraps
- Select-similar (SEL-05 partial): MEDIUM — enum surface not independently re-verified against live docs this pass; explicit runtime-verification step recommended before shipping

**Research date:** 2026-07-29
**Valid until:** 2027-01-29 (stable core Blender API; 6 months before re-verification needed, consistent with Phase 2's precedent)
