# Roadmap: Blend AI

## Overview

**Milestone 1** (complete) upgraded blend-ai from v0.2.0 to full Blender 5.1 compatibility, added visual feedback intelligence, hardened security, and layered expert LLM guidance on top of the existing 161-tool foundation. Its four phases followed a strict dependency order: fix what's broken, add intelligence, enable visual feedback, then expand new capabilities.

**Milestone 2** (scoped) takes the tool foundation from "solid for building scenes" to "sufficient for consistently beautiful, production-quality scenes." It closes eight capability gaps identified by usage review: fine-grained mesh selection, transaction/macro reliability, material & texture production (baking), render quality control, compositor/post-processing, cinematic camera tooling, scene dressing/instancing, and a local asset-library workflow. Selection (Phase 5) and transaction reliability (Phase 6) ship first because later phases lean on both — precise targeting and atomic multi-step operations.

## Milestone 1: Blender 5.1 Compatibility & Expert Guidance (Complete)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Blender 5.1 Compatibility** - Fix all breaking API changes so existing tools work on Blender 5.1 / Python 3.13 (completed 2026-03-24)
- [ ] **Phase 2: Expert Guidance & Stability** - Add expert MCP prompts, mesh quality validation, and fix render guard / connection stability issues
- [ ] **Phase 3: Visual Feedback Loop** - Ship fast viewport screenshot and auto-critique so the LLM can see what it built
- [ ] **Phase 4: Extension Suggestions, Security & New 5.1 Tools** - Harden code_exec, add proactive extension suggestions, expose Blender 5.1-only nodes

## Phase Details

### Phase 1: Blender 5.1 Compatibility
**Goal**: All existing tools work correctly on Blender 5.1 with Python 3.13, with CI verifying the fixed handlers
**Depends on**: Nothing (first phase)
**Requirements**: COMPAT-01, COMPAT-02, COMPAT-03, COMPAT-04, COMPAT-05, COMPAT-06
**Success Criteria** (what must be TRUE):
  1. A user on Blender 5.1 can start the server, connect an MCP client, and render with EEVEE without errors
  2. Compositor node tools function against `scene.compositing_node_group` on 5.1 without AttributeError
  3. Sculpt tools accept brush input without referencing removed 5.0 individual properties
  4. Grease Pencil annotation tools work against the split Annotation API on 5.1
  5. CI runs the full handler test suite against `bpy==5.1.0` on Python 3.13 with zero failures
**Plans:** 3/3 plans complete
Plans:
- [x] 01-01-PLAN.md — EEVEE rename, sculpt stroke_method, compositor/VSE audits (COMPAT-01, COMPAT-02, COMPAT-03, COMPAT-05)
- [x] 01-02-PLAN.md — Grease Pencil to Annotation API rewrite (COMPAT-04)
- [x] 01-03-PLAN.md — Handler tests and bpy 5.1 CI workflow (COMPAT-06)

### Phase 2: Expert Guidance & Stability
**Goal**: The LLM receives expert modeling/lighting/material guidance via MCP prompts, can run structured mesh quality checks, and the server no longer gets stuck from render guard or stale connections
**Depends on**: Phase 1
**Requirements**: GUIDE-01, GUIDE-02, GUIDE-03, GUIDE-04, GUIDE-05, GUIDE-06, FEED-04, STAB-01, STAB-02
**Success Criteria** (what must be TRUE):
  1. An LLM using the server receives topology, lighting, and material guidance before starting a modeling task
  2. User can call `analyze_mesh_quality()` on any object and receive a structured JSON report covering non-manifold edges, inverted normals, loose vertices, zero-area faces, and duplicate vertices
  3. When a task would benefit from Bool Tool, LoopTools, Node Wrangler, or similar free extensions, the MCP suggests them before starting (and skips suggestions for already-installed extensions)
  4. A render that crashes mid-way no longer leaves the render guard permanently stuck — the server recovers on `load_post` or via a reset tool
  5. Stale TCP connections are cleaned up automatically without requiring a Blender restart
**Plans:** 4/4 plans complete
Plans:
- [x] 02-01-PLAN.md — Render guard recovery and TCP stale connection cleanup (STAB-01, STAB-02)
- [x] 02-02-PLAN.md — Expert MCP prompts for topology, scale, lighting, and workflows (GUIDE-01, GUIDE-02, GUIDE-03, GUIDE-06)
- [x] 02-03-PLAN.md — Mesh quality analysis tool and handler (FEED-04)
- [x] 02-04-PLAN.md — Extension suggestion system with installed detection (GUIDE-04, GUIDE-05)

### Phase 3: Visual Feedback Loop
**Goal**: The LLM can capture the current viewport state in under 500ms without triggering render cycles, and automatically critiques what it builds
**Depends on**: Phase 2
**Requirements**: FEED-01, FEED-02, FEED-03
**Success Criteria** (what must be TRUE):
  1. Calling `get_viewport_screenshot(mode="fast")` returns a viewport image in under 500ms and does not trigger the render guard
  2. After building or modifying an object, the LLM automatically captures a screenshot and reports what it sees (good topology, issues, next steps)
  3. The auto-screenshot prompt prevents token runaway by specifying that screenshots fire only after structural changes (add/delete/boolean/apply), not after metadata-only changes
**Plans**: 2/2 plans complete
Plans:
- [x] 03-01-PLAN.md — Fast viewport capture using render.opengl + mode parameter (FEED-01)
- [x] 03-02-PLAN.md — Auto-critique prompt with token-safety guidelines (FEED-02, FEED-03)

### Phase 4: Extension Suggestions, Security & New 5.1 Tools
**Goal**: `code_exec` is sandboxed against RCE, the extension suggestion system detects installed extensions before recommending, and all Blender 5.1-exclusive nodes and tools are accessible via MCP
**Depends on**: Phase 3
**Requirements**: STAB-03, NEW51-01, NEW51-02, NEW51-03, NEW51-04, NEW51-05, NEW51-06, NEW51-07
**Success Criteria** (what must be TRUE):
  1. Calling `code_exec` with `import os` or `import subprocess` raises a sandboxing error, not a Python exception from inside Blender
  2. User can create Raycast shader nodes, Bone Info geometry nodes, Grid Dilate/Erode nodes, and Mask to SDF compositor nodes via MCP tools
  3. User can unwrap UVs using the SLIM method and configure EEVEE Light Path Intensity controls via MCP tools
  4. The N-panel includes an "unsafe mode" toggle for `code_exec` that defaults to OFF and persists across sessions
**Plans**: 2/2 plans complete
Plans:
- [x] 04-01-PLAN.md — Code exec sandboxing with import blocking (STAB-03, NEW51-07)
- [x] 04-02-PLAN.md — SLIM UV unwrap, new 5.1 shader nodes, EEVEE light path intensity (NEW51-01, NEW51-05, NEW51-06)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Blender 5.1 Compatibility | 3/3 | Complete   | 2026-03-24 |
| 2. Expert Guidance & Stability | 4/4 | Complete   | 2026-03-24 |
| 3. Visual Feedback Loop | 2/2 | Complete | 2026-03-24 |
| 4. Extension Suggestions, Security & New 5.1 Tools | 2/2 | Complete | 2026-03-24 |

## Milestone 2: Production-Quality Scene Building Tools (Scoped)

**Goal:** Close the eight highest-impact gaps between "solid foundation" and "consistently beautiful, production-quality output," identified by usage review against the existing 161-tool/24-module baseline. Eight phases follow a dependency order: precise selection and transaction safety ship first as infrastructure other phases build on; render-pipeline phases (quality control → compositor) are sequenced together since compositor effects consume render passes; camera, scene dressing, and asset library close out the milestone.

## Phases

- [ ] **Phase 5: Fine-Grained Mesh Selection & Selection Sets** - Index-based vertex/edge/face selection, named selection sets, grow/shrink/select-similar
- [ ] **Phase 6: Workflow Reliability — Transactions & Macros** - Atomic undo grouping, command audit logging, macro execution, expert workflows as callable tools
- [ ] **Phase 7: Material & Texture Production** - AO/normal/roughness baking, seam marking from selection, UV island alignment, texture fill
- [ ] **Phase 8: Render Quality Control** - AOVs/render passes, denoising config, adaptive sampling, light groups, render presets
- [ ] **Phase 9: Compositor & Post-Processing** - Compositor node tree tools, glare/bloom, color correction, vignette, depth-based effects
- [ ] **Phase 10: Cinematic Camera Tools** - Camera rigs, safe-area guides, focal-length presets, shot-framing helpers
- [ ] **Phase 11: Scene Dressing & Instancing** - Scatter/placement tools, randomization controls, collision-aware placement
- [ ] **Phase 12: Asset Library Workflow** - Browse/search/preview local asset libraries, append/link, relink missing paths

## Phase Details

### Phase 5: Fine-Grained Mesh Selection & Selection Sets
**Goal**: The LLM can target specific vertices, edges, or faces by index instead of operating on all geometry, and can save/recall named selections
**Depends on**: Nothing (Milestone 2 foundation phase; builds on existing `mesh_editing.py` tools)
**Requirements**: SEL-01, SEL-02, SEL-03, SEL-04, SEL-05
**Success Criteria** (what must be TRUE):
  1. User can select an arbitrary list of vertex indices, edge indices, or face indices on a mesh in edit mode
  2. User can save the current selection under a name and reselect it later in the same session
  3. User can grow, shrink, or select-similar (normal/material/area) from a seed selection
  4. The documented "Selection is all-or-nothing" limitation in README.md is resolved and removed
**Research:** [05-RESEARCH.md](phases/05-fine-grained-mesh-selection/05-RESEARCH.md) — complete 2026-07-29
**Plans:** 0/2 plans complete (planned, not yet executed)
Plans:
- [ ] 05-01-PLAN.md — Index-based selection: select_vertices/edges/faces_by_index + validate_index_list (SEL-01, SEL-02, SEL-03)
- [ ] 05-02-PLAN.md — Selection sets (save/select/list) + grow/shrink/select_similar (SEL-04, SEL-05), depends on 05-01

### Phase 6: Workflow Reliability — Transactions & Macros
**Goal**: Multi-step operations behave atomically for undo, every dispatched command is auditable, and common expert sequences are callable as single tools
**Depends on**: Nothing (infrastructure layer; sequenced early so Phases 7-12 can rely on transaction grouping)
**Requirements**: WFLOW-03, WFLOW-04, WFLOW-05, WFLOW-06
**Success Criteria** (what must be TRUE):
  1. A multi-step MCP sequence can be wrapped so a single Ctrl+Z reverts the entire operation
  2. Every dispatched command is logged with timestamp, command name, and parameters
  3. A `run_macro()` tool runs a named sequence of tool calls as one operation and rolls back cleanly on step failure
  4. Studio lighting setup, product shot, and character basemesh workflows are callable as direct MCP tools, not only available as prompt guidance
**Plans:** 0/0 plans complete (not yet planned)

### Phase 7: Material & Texture Production
**Goal**: The LLM can produce PBR texture maps and clean UV seams instead of relying on flat/default material properties
**Depends on**: Phase 5 (face/edge selection targets bake regions and seam edges)
**Requirements**: MAT-01, MAT-02, MAT-03, MAT-04, MAT-05
**Success Criteria** (what must be TRUE):
  1. User can bake AO, normal (high-to-low poly), and roughness/curvature maps to a target image
  2. User can mark or clear UV seams from an edge selection and straighten/align UV islands
  3. User can fill a texture's image/paint-data layer with a color or pattern for quick staging
**Plans:** 0/0 plans complete (not yet planned)

### Phase 8: Render Quality Control
**Goal**: The LLM can configure production render settings (passes, denoise, adaptive sampling, light groups) instead of only engine/samples/resolution
**Depends on**: Nothing new (extends existing `rendering.py` module)
**Requirements**: RQ-01, RQ-02, RQ-03, RQ-04, RQ-05
**Success Criteria** (what must be TRUE):
  1. User can enable AOVs/render passes (Cryptomatte, normal, depth, custom) on the active view layer
  2. User can configure denoising and Cycles adaptive sampling thresholds
  3. User can create light groups and assign lights to them
  4. User can apply a named render preset that sets engine/samples/resolution/denoise together
**Plans:** 0/0 plans complete (not yet planned)

### Phase 9: Compositor & Post-Processing
**Goal**: The LLM can build a compositor node tree for final-image polish instead of shipping raw render output
**Depends on**: Phase 8 (depth-of-field/depth effects consume the Z/mist pass and light groups from RQ-01/RQ-04)
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-05
**Success Criteria** (what must be TRUE):
  1. User can add/connect/remove compositor nodes via MCP tools, mirroring the existing shader-node tool pattern
  2. User can add glare/bloom, color correction, and vignette effects to the composite
  3. User can build a depth-based effect (e.g. depth of field) using the Z/mist pass
**Plans:** 0/0 plans complete (not yet planned)

### Phase 10: Cinematic Camera Tools
**Goal**: The LLM can frame shots like a cinematographer instead of only positioning a raw camera object
**Depends on**: Nothing new (extends existing `camera.py` module)
**Requirements**: CAM-01, CAM-02, CAM-03, CAM-04
**Success Criteria** (what must be TRUE):
  1. User can create a camera rig (camera parented to an empty/track target) for orbit/dolly shots
  2. User can enable safe-area guides on a camera
  3. User can apply named focal-length presets (24mm/50mm/85mm, etc.)
  4. User can apply shot-framing helpers (rule-of-thirds guide, frame an object/collection)
**Plans:** 0/0 plans complete (not yet planned)

### Phase 11: Scene Dressing & Instancing
**Goal**: The LLM can populate a scene with scattered props/vegetation instead of placing every instance manually
**Depends on**: Phase 5 (selection targets source objects and placement regions), Phase 6 (transaction grouping makes bulk placement a single undo step)
**Requirements**: DRESS-01, DRESS-02, DRESS-03
**Success Criteria** (what must be TRUE):
  1. User can scatter instances of one or more source objects across a target surface or region
  2. Scatter supports density, rotation, scale-variance, and seed randomization controls
  3. Scatter supports collision-aware placement that avoids overlapping instances
**Plans:** 0/0 plans complete (not yet planned)

### Phase 12: Asset Library Workflow
**Goal**: The LLM can reuse existing local assets instead of only building everything from primitives
**Depends on**: Phase 11 (recommended, not required — asset browsing is most valuable once scatter/placement tools exist to consume the results)
**Requirements**: ASSET-01, ASSET-02, ASSET-03, ASSET-04, ASSET-05
**Success Criteria** (what must be TRUE):
  1. User can list configured local Blender asset libraries and browse their contents
  2. User can search library assets by name or tag and preview metadata/thumbnail before importing
  3. User can append or link an asset into the current scene
  4. User can detect and relink assets with broken library paths
**Plans:** 0/0 plans complete (not yet planned)

## Progress (Milestone 2)

**Execution Order:**
Phases execute in numeric order: 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. Fine-Grained Mesh Selection & Selection Sets | 0/2 | Planned | — |
| 6. Workflow Reliability — Transactions & Macros | 0/0 | Not Started | — |
| 7. Material & Texture Production | 0/0 | Not Started | — |
| 8. Render Quality Control | 0/0 | Not Started | — |
| 9. Compositor & Post-Processing | 0/0 | Not Started | — |
| 10. Cinematic Camera Tools | 0/0 | Not Started | — |
| 11. Scene Dressing & Instancing | 0/0 | Not Started | — |
| 12. Asset Library Workflow | 0/0 | Not Started | — |
