# Requirements: Blend AI

**Defined:** 2026-03-23
**Core Value:** An LLM using this MCP should produce professional-quality 3D output without the user needing to know Blender — the MCP provides the expertise.

## v1 Requirements — Milestone 1 (Complete)

Requirements for the Blender 5.1 compatibility + expert guidance milestone. Each maps to roadmap phases 1-4.

### Blender 5.1 Compatibility

- [x] **COMPAT-01**: All tools work correctly on Blender 5.1 with the EEVEE engine identifier change (`BLENDER_EEVEE_NEXT` → `BLENDER_EEVEE`)
- [x] **COMPAT-02**: Compositor tools use `scene.compositing_node_group` instead of `scene.node_tree`
- [x] **COMPAT-03**: Sculpting tools handle consolidated `brush.stroke_method` enum replacing 8 individual properties
- [x] **COMPAT-04**: Grease pencil tools work with Annotation API split (`bpy.data.annotations`, `AnnotationStroke`)
- [x] **COMPAT-05**: VSE strip tools handle renamed time properties (`frame_final_duration` → `duration`, etc.)
- [x] **COMPAT-06**: All existing tools pass on Python 3.13 without errors

### Blender 5.1 New Features

- [ ] **NEW51-01**: User can create Raycast shader nodes for NPR/toon shading workflows
- [ ] **NEW51-02**: User can create Bone Info geometry nodes for procedural rigging
- [ ] **NEW51-03**: User can create Grid Dilate/Erode geometry nodes for volume operations
- [ ] **NEW51-04**: User can create Mask to SDF compositor nodes
- [ ] **NEW51-05**: User can unwrap UVs using SLIM method for better organic mesh quality
- [ ] **NEW51-06**: User can configure EEVEE Light Path Intensity controls
- [ ] **NEW51-07**: User can add F-curve Gaussian smoothing modifier for animation cleanup

### Visual Feedback

- [ ] **FEED-01**: Viewport screenshot uses fast capture (not full render) and does not trigger the render guard
- [ ] **FEED-02**: After building or modifying objects, the LLM automatically captures a viewport screenshot and critiques the result
- [ ] **FEED-03**: Auto-feedback prompt includes frequency guidance to prevent token runaway (not after every single tool call)
- [x] **FEED-04**: User can run `analyze_mesh_quality()` on any object to get structured JSON report of non-manifold edges, inverted normals, loose vertices, disconnected islands, zero-area faces, and duplicate vertices

### Expert Guidance

- [x] **GUIDE-01**: MCP prompts guide the LLM on quad topology best practices, proper edge flow, and when to use modifiers vs. direct mesh editing
- [x] **GUIDE-02**: MCP prompts include scale reference guidance (real-world dimensions for common objects)
- [x] **GUIDE-03**: MCP prompts include lighting principles (three-point setup, HDRI usage, EEVEE vs. Cycles tradeoffs)
- [ ] **GUIDE-04**: When a task would benefit from a free Blender extension (Bool Tool, LoopTools, Node Wrangler, ND, Mio3 UV), the MCP suggests it proactively before starting
- [ ] **GUIDE-05**: Extension suggestions detect whether the extension is already installed before recommending
- [x] **GUIDE-06**: Workflow prompts guide the LLM through multi-step expert patterns (studio lighting setup, character basemesh, product shot)

### Security & Stability

- [ ] **STAB-01**: Render guard recovers from stuck state automatically (e.g., via `load_post` handler or manual reset tool)
- [ ] **STAB-02**: Stale TCP connections are handled gracefully with proper cleanup and atomic reconnection
- [ ] **STAB-03**: `code_exec` tool is sandboxed — `os`, `subprocess`, `socket`, `importlib` are blocked; only safe `bpy` operations are permitted

## v2 Requirements — Milestone 2: Production-Quality Scene Building (Scoped 2026-07-29)

Requirements for the new milestone. The tool foundation (161 tools / 24 modules) is solid for building scenes but stops short of consistently "beautiful," production-quality output. This milestone closes that gap. Each maps to roadmap phases 5-12.

Supersedes the following items from the old deferred bucket: **ADV-01** (select by index) → SEL-01..03; **ADV-02** (undo grouping) → WFLOW-03; **WFLOW-01** (workflows as tools) → WFLOW-06; **WFLOW-02** (audit logging) → WFLOW-04.

### Fine-Grained Mesh Selection (Phase 5)

- [ ] **SEL-01**: User can select vertices by index list on a mesh object in edit mode
- [ ] **SEL-02**: User can select edges by index list on a mesh object in edit mode
- [ ] **SEL-03**: User can select faces by index list on a mesh object in edit mode
- [ ] **SEL-04**: User can save the current selection as a named selection set on an object and recall/reapply it later by name
- [ ] **SEL-05**: User can grow/shrink the current selection or select-similar (by normal, material, or area) from a seed selection

### Workflow Reliability: Transactions & Macros (Phase 6)

- [ ] **WFLOW-03**: Multi-step MCP tool sequences can be wrapped in a single undo step so Ctrl+Z reverts the whole operation atomically
- [ ] **WFLOW-04**: Every dispatched command is captured in an audit log with timestamp, command name, and parameters
- [ ] **WFLOW-05**: A `run_macro()` tool executes a named sequence of tool calls as one logical operation and rolls back cleanly if a step fails
- [ ] **WFLOW-06**: Expert workflows already described as prompts (studio lighting setup, product shot, character basemesh) are also exposed as directly callable MCP tools, not only prompt guidance

### Material & Texture Production (Phase 7)

- [ ] **MAT-01**: User can bake ambient occlusion maps from a mesh's geometry to a target image texture
- [ ] **MAT-02**: User can bake normal maps, including high-to-low poly baking via a selected source object
- [ ] **MAT-03**: User can bake roughness, curvature, or other PBR channel maps to a target image texture
- [ ] **MAT-04**: User can mark or clear UV seams from an edge selection (built on SEL-02) and straighten/align UV islands
- [ ] **MAT-05**: User can fill a texture's active image/paint-data layer with a color or pattern for quick texture staging (stroke-based painting is out of scope — see Out of Scope)

### Render Quality Control (Phase 8)

- [ ] **RQ-01**: User can enable and configure render passes and AOVs (Cryptomatte, normal, depth, custom AOVs) for the active view layer
- [ ] **RQ-02**: User can configure denoising settings (OIDN/OptiX/engine-native) per render engine
- [ ] **RQ-03**: User can configure Cycles adaptive sampling thresholds
- [ ] **RQ-04**: User can create light groups and assign lights to them for per-light compositing control
- [ ] **RQ-05**: User can apply a named render preset (e.g. draft, final, product-shot) that sets engine, samples, resolution, and denoise together in one call

### Compositor & Post-Processing (Phase 9)

- [ ] **COMP-01**: User can create and manage compositor node trees via MCP tools (add/connect/remove compositor nodes), mirroring the existing shader-node tool pattern in `materials.py`
- [ ] **COMP-02**: User can add and configure glare/bloom effects in the compositor
- [ ] **COMP-03**: User can add and configure color correction (color balance, curves, LUT-style grading) in the compositor
- [ ] **COMP-04**: User can add a vignette effect to the composite
- [ ] **COMP-05**: User can build depth-of-field / depth-based compositor effects using the Z/mist pass (depends on RQ-01 depth AOV)

### Cinematic Camera Tools (Phase 10)

- [ ] **CAM-01**: User can create a camera rig (camera parented to an empty/track target) for orbit and dolly shots
- [ ] **CAM-02**: User can enable safe-area guides (title-safe/action-safe overlays) on a camera
- [ ] **CAM-03**: User can apply named focal-length presets (e.g. 24mm wide, 50mm normal, 85mm portrait) to a camera
- [ ] **CAM-04**: User can apply shot-framing helpers (rule-of-thirds guide, frame an object/collection in view) to a camera

### Scene Dressing & Instancing (Phase 11)

- [ ] **DRESS-01**: User can scatter instances of one or more source objects across a target surface or region
- [ ] **DRESS-02**: Scatter placement supports randomization controls (density, rotation, scale variance, seed)
- [ ] **DRESS-03**: Scatter placement supports collision-aware placement to avoid overlapping instances

### Asset Library Workflow (Phase 12)

- [ ] **ASSET-01**: User can list configured local Blender asset libraries and browse their contents
- [ ] **ASSET-02**: User can search library assets by name or tag
- [ ] **ASSET-03**: User can preview an asset (metadata/thumbnail) before importing it
- [ ] **ASSET-04**: User can append or link an asset from a library into the current scene
- [ ] **ASSET-05**: User can detect and relink assets with missing/broken library paths

## v3 Requirements

Deferred beyond Milestone 2. Tracked but not in the current roadmap.

### Performance

- **PERF-01**: Configurable per-command timeouts (some operations need >30s, some should fail fast)
- **PERF-02**: Queue depth monitoring with warnings when backlog exceeds threshold

### Selection Integration

- **SEL-06**: High-value existing edit-mode tools (inset_faces, dissolve_faces/edges/verts, mark_seam, mark_sharp, set_edge_crease) gain an optional `use_selection` flag that, when True, skips the forced select-all step and operates on the current selection instead — identified during Phase 5 research (05-RESEARCH.md) as the necessary follow-up to make SEL-01..03 useful beyond the selection tools themselves; deferred to keep Phase 5 scoped to the selection primitives

## Out of Scope

| Feature | Reason |
|---------|--------|
| Remote/network access (non-localhost) | Destroys security model; SSH tunneling is the documented alternative |
| Real-time viewport streaming | MCP is request/response; would require protocol change and token costs explode |
| AI-to-3D mesh generation (Meshy, Tripo) | Separate product category; creates dependency/trust issues |
| Multi-user/multi-connection | Blender is single-threaded; concurrent modifications corrupt scene state |
| Auto-install extensions | Bypasses user consent; supply chain attack vector |
| Sculpt brush stroke simulation | Requires viewport/mouse context that cannot be injected from TCP server |
| Stroke-based texture painting | Same limitation as sculpt strokes — no mouse/tablet input channel from TCP server; MAT-05 covers fill/data-layer operations instead |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMPAT-01 | Phase 1 | Complete |
| COMPAT-02 | Phase 1 | Complete |
| COMPAT-03 | Phase 1 | Complete |
| COMPAT-04 | Phase 1 | Complete |
| COMPAT-05 | Phase 1 | Complete |
| COMPAT-06 | Phase 1 | Complete |
| NEW51-01 | Phase 4 | Pending |
| NEW51-02 | Phase 4 | Pending |
| NEW51-03 | Phase 4 | Pending |
| NEW51-04 | Phase 4 | Pending |
| NEW51-05 | Phase 4 | Pending |
| NEW51-06 | Phase 4 | Pending |
| NEW51-07 | Phase 4 | Pending |
| FEED-01 | Phase 3 | Pending |
| FEED-02 | Phase 3 | Pending |
| FEED-03 | Phase 3 | Pending |
| FEED-04 | Phase 2 | Complete |
| GUIDE-01 | Phase 2 | Complete |
| GUIDE-02 | Phase 2 | Complete |
| GUIDE-03 | Phase 2 | Complete |
| GUIDE-04 | Phase 2 | Pending |
| GUIDE-05 | Phase 2 | Pending |
| GUIDE-06 | Phase 2 | Complete |
| STAB-01 | Phase 2 | Pending |
| STAB-02 | Phase 2 | Pending |
| STAB-03 | Phase 4 | Pending |
| SEL-01 | Phase 5 | Not Started |
| SEL-02 | Phase 5 | Not Started |
| SEL-03 | Phase 5 | Not Started |
| SEL-04 | Phase 5 | Not Started |
| SEL-05 | Phase 5 | Not Started |
| WFLOW-03 | Phase 6 | Not Started |
| WFLOW-04 | Phase 6 | Not Started |
| WFLOW-05 | Phase 6 | Not Started |
| WFLOW-06 | Phase 6 | Not Started |
| MAT-01 | Phase 7 | Not Started |
| MAT-02 | Phase 7 | Not Started |
| MAT-03 | Phase 7 | Not Started |
| MAT-04 | Phase 7 | Not Started |
| MAT-05 | Phase 7 | Not Started |
| RQ-01 | Phase 8 | Not Started |
| RQ-02 | Phase 8 | Not Started |
| RQ-03 | Phase 8 | Not Started |
| RQ-04 | Phase 8 | Not Started |
| RQ-05 | Phase 8 | Not Started |
| COMP-01 | Phase 9 | Not Started |
| COMP-02 | Phase 9 | Not Started |
| COMP-03 | Phase 9 | Not Started |
| COMP-04 | Phase 9 | Not Started |
| COMP-05 | Phase 9 | Not Started |
| CAM-01 | Phase 10 | Not Started |
| CAM-02 | Phase 10 | Not Started |
| CAM-03 | Phase 10 | Not Started |
| CAM-04 | Phase 10 | Not Started |
| DRESS-01 | Phase 11 | Not Started |
| DRESS-02 | Phase 11 | Not Started |
| DRESS-03 | Phase 11 | Not Started |
| ASSET-01 | Phase 12 | Not Started |
| ASSET-02 | Phase 12 | Not Started |
| ASSET-03 | Phase 12 | Not Started |
| ASSET-04 | Phase 12 | Not Started |
| ASSET-05 | Phase 12 | Not Started |

**Coverage:**
- v1 requirements (Milestone 1): 26 total, mapped to phases 1-4
- v2 requirements (Milestone 2): 31 total, mapped to phases 5-12
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-07-29 — Milestone 2 (Production-Quality Scene Building) scoped*
