---
gsd_state_version: 1.0
milestone: v0.3.0
milestone_name: scene-production-tools
status: Phase In Progress
stopped_at: Phase 5 researched and planned (2 plans) — ready for execution, not yet implemented
last_updated: "2026-07-29T00:00:00.000Z"
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 2
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-29)

**Core value:** An LLM using this MCP should produce professional-quality 3D output without the user needing to know Blender — the MCP provides the expertise.
**Current focus:** Phase 05 — fine-grained-mesh-selection (researched and planned, execution not started)

## Milestone History

- **v0.2.0** (milestone 1) — Complete 2026-03-24. 4/4 phases, 11/11 plans. Blender 5.1 compatibility, expert guidance, visual feedback, security & new-tools. See ROADMAP.md "Milestone 1" section.

## Current Position

Phase: 05-fine-grained-mesh-selection
Plan: 05-01-PLAN.md ready to execute (05-02 depends on it)

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-blender-5-1-compatibility P01 | 8 | 2 tasks | 6 files |
| Phase 01-blender-5-1-compatibility P02 | 8 | 1 tasks | 3 files |
| Phase 01-blender-5-1-compatibility P03 | 12 | 2 tasks | 3 files |
| Phase 02-expert-guidance-stability P02 | 10 | 2 tasks | 2 files |
| Phase 02-expert-guidance-stability P03 | 15 | 2 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Init]: Auto-screenshot uses prompt-driven feedback (not server-push) — MCP is stateless request/response
- [Init]: Extension suggestions use static knowledge base — avoids undocumented bpy.ops.extensions and network deps
- [Init]: Phase 1 must fix all 9 breaking 5.1 API changes before any feature work can be tested on target Blender
- [Phase 01-blender-5-1-compatibility]: BLENDER_EEVEE_NEXT removed from all allowlists — 5.1 fully dropped it, no alias needed
- [Phase 01-blender-5-1-compatibility]: stroke_method validation added at both MCP tool and addon handler layers for defense-in-depth
- [Phase 01-blender-5-1-compatibility]: Annotation API targets viewport overlays not 3D drawing objects — bpy.data.annotations, not bpy.data.objects
- [Phase 01-blender-5-1-compatibility]: AnnotationStroke has no .strength property — removed from handler and MCP tool signature
- [Phase 01-blender-5-1-compatibility]: Direct importlib.util loading for handler tests avoids mathutils import failure — mirrors gpencil handler test pattern
- [Phase 01-blender-5-1-compatibility]: CI workflow uses Python 3.13 only — bpy==5.1.0 requires Python ==3.13.* exactly; separate from pylint.yml matrix
- [Phase 02-expert-guidance-stability]: HDRI test assertion uses uppercase 'HDRI' in result.upper() — acronym must match case when using .upper() comparison
- [Phase 02-expert-guidance-stability]: wire_edges excluded from non_manifold_edge_count — tracked as separate defect category
- [Phase 02-expert-guidance-stability]: MAX_SAMPLE_INDICES=50 caps index lists to prevent oversized JSON responses
- [Milestone 2 scoping]: Selection (Phase 5) and transactions (Phase 6) sequenced first — later phases (baking, scatter) depend on precise targeting and atomic undo
- [Milestone 2 scoping]: Compositor (Phase 9) sequenced after render quality (Phase 8) — depth/DOF compositor effects consume the Z/mist pass and light groups Phase 8 introduces
- [Milestone 2 scoping]: Texture painting scoped as fill/data-layer ops only — stroke-based painting excluded, same rationale as the existing sculpt-brush-stroke out-of-scope decision (no mouse/tablet input channel from TCP server)
- [Phase 05 research]: Selection tools must use bmesh.from_edit_mesh() (live edit-mesh) and leave the object in EDIT mode after returning — the opposite of every other mesh_editing handler, which uses bmesh.new()/free() or forces select-all + mode_set(OBJECT). Required so the selection has any effect on a subsequent MCP call.
- [Phase 05 research]: Teaching the 15 existing mesh_editing tools to respect an incoming selection (vs. forcing select-all) is deferred as new requirement SEL-06 (REQUIREMENTS.md v3) — kept out of Phase 5 to avoid touching 15 handlers in one phase
- [Phase 05 research]: select_similar's exact enum values (MATERIAL/AREA/NORMAL etc.) are MEDIUM confidence — docs.blender.org blocked automated fetches during research; must verify against the actual Blender 5.1 install during Plan 05-02 Task 3 before finalizing SIMILAR_COMPARE_OPTIONS
- [Phase 05 planning]: Selection sets stored as a single JSON string custom property on the mesh datablock (blend_ai_selection_sets), not nested Python dict/list ID properties — avoids Blender's IDPropertyGroup coercion quirks, stdlib-only (json)

### Pending Todos

- Execute 05-01-PLAN.md (index-based selection: SEL-01/02/03) — Wave 1, no dependencies
- Execute 05-02-PLAN.md (selection sets + grow/shrink/select-similar: SEL-04/05) — Wave 2, depends on 05-01
- During 05-02 Task 3: verify SIMILAR_COMPARE_OPTIONS enum strings against the real Blender 5.1 install (05-RESEARCH.md Open Question 2 — MEDIUM confidence)
- After 05-02 completes: remove README.md's "Selection is all-or-nothing" line from Known Limitations

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260324-r68 | Add !image inline command to blend-ai-chat REPL for reference images | 2026-03-25 | b5f0619 | [260324-r68-add-image-inline-command-to-blend-ai-cha](.planning/quick/260324-r68-add-image-inline-command-to-blend-ai-cha/) |
| 260324-rdw | Fix MAX_TOOL_ROUNDS to 25 and set_modifier_property type coercion | 2026-03-25 | 228d09f | [260324-rdw-fix-max-tool-rounds-to-25-and-set-modifi](.planning/quick/260324-rdw-fix-max-tool-rounds-to-25-and-set-modifi/) |
| 260324-rld | Add modeling strategy heuristics to SYSTEM_PROMPT_BASE | 2026-03-25 | ad577a1 | [260324-rld-add-modeling-strategy-heuristics-to-syst](.planning/quick/260324-rld-add-modeling-strategy-heuristics-to-syst/) |
| 260324-rns | Fix !image to route through vision model before chat | 2026-03-25 | 2efa82a | [260324-rns-fix-image-to-route-through-vision-model-](.planning/quick/260324-rns-fix-image-to-route-through-vision-model-/) |
| 260401-1eu | Fix ollama_chat.py review issues: cached event loop, tighter JSON scanner, full tag stripping, structured vision note | 2026-04-01 | a2069a8 | [260401-1eu-fix-ollama-chat-py-review-issues-asyncio](.planning/quick/260401-1eu-fix-ollama-chat-py-review-issues-asyncio/) |

### Blockers/Concerns

- [Research flag] Grease Pencil v3 scope: must decide whether COMPAT-04 targets GreasePencilv3 (3D drawing objects), Annotation (viewport overlays), or both — required before Phase 1 gpencil work begins
- [Research flag] Vulkan viewport capture: `bpy.ops.render.opengl` behavior under Blender 5.1's Vulkan backend on Linux not yet verified — needs discovery task in Phase 3 planning
- [Research flag] RestrictedPython API: exact `compile_restricted()` + safe_globals pattern needs proof-of-concept before Phase 4 — rated MEDIUM confidence in research

## Session Continuity

Last activity: 2026-07-29 - Researched and planned Phase 5 (Fine-Grained Mesh Selection & Selection Sets): 05-RESEARCH.md (bmesh live-edit-mesh selection pattern, JSON selection-set storage, select_similar enum caveat), 05-01-PLAN.md (SEL-01/02/03, 3 tasks), 05-02-PLAN.md (SEL-04/05, 3 tasks, depends on 05-01). Added deferred SEL-06 to REQUIREMENTS.md v3.
Last session: 2026-07-29T00:00:00.000Z
Stopped at: Phase 5 planned — ready to execute 05-01-PLAN.md
Resume file: .planning/phases/05-fine-grained-mesh-selection/05-01-PLAN.md
