# Agent v2 — scene-agnostic, visible thinking, verified

Why this exists: the v1 build agent (`docs/BUILD_AGENT.md`) works for rooms and
furniture, but its vocabulary is room-shaped, it only checks geometry, it
can't edit what it built, and its thinking isn't visible. Clients will ask for
houses, forests, aircraft interiors, tunnels, deserts — anything. This is the
design that handles all of them with no scene-type rules in code.

## What the research says

Sources are linked at the bottom. Claims marked (secondary) come from write-ups
or abstracts I could not check against the full paper.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Split planning from acting from criticism.** Planner decides *what*, a separate actor writes/executes, a separate critic judges. One model doing all three drifts. | Planner–Actor–Critic for Blender (ACM); Blender devtalk 3D-Agent ("separating what from how beat one model doing both"); Anthropic harness post (planner / generator / evaluator) |
| 2 | **Ground truth every step.** Feed the model what the environment really says (screenshots, scene queries, execution results), not what it assumes. Without a viewport check the agent "drifts within 3–4 steps". | Anthropic *Building effective agents*; Blender devtalk (verification called "the most important piece") |
| 3 | **The critic must be separate and skeptical.** Models praise their own work. A standalone evaluator with explicit criteria, hard thresholds and few-shot calibration is more tractable than self-critique. | Anthropic harness post |
| 4 | **LLMs should output relations, not coordinates.** Absolute LLM coordinates performed no better than random (collisions, out-of-bounds); relative constraints + a solver worked. Holodeck's vocabulary is generic (edge/middle, near/far, in-front/side-of, aligned, face-to) and scene-type-free; scene type is just free text. | Holodeck (CVPR 2024) |
| 5 | **Retrieve by text + size (+ visual) similarity, and expect gaps.** Holodeck scores text, CLIP and a size penalty. Every system lists missing assets as its main limit. | Holodeck; Scenethesis |
| 6 | **For things you can't retrieve (terrain, forests, caves) generate procedurally and scatter.** Infinigen / SceneX use parametric generators plus scatter/instancing, driven by an LLM planner that emits executable actions. | Infinigen overview; SceneX (secondary) |
| 7 | **Render → critique → refine with a vision model.** SceneCraft plans a scene graph, emits code, renders, has a VLM critique; it also keeps a library of reusable scripts. Scenethesis uses an image as layout guidance, builds a scene graph from it, optimizes physics, and a judge scores category accuracy, orientation and spatial coherence — re-planning when any falls below threshold. | SceneCraft (ICML 2024, abstract); Scenethesis (ICLR 2026) |
| 8 | **Show the plan; let humans edit it; then run autonomously.** Cursor: research → clarifying questions → editable plan (to-dos) → build. Claude Code: Explore (read-only, isolated context) → Plan → ReAct execution, with the plan as the to-do list. Anthropic: "make planning steps visible". | Cursor plan mode; Anthropic; Claude Code write-ups (secondary) |
| 9 | **Give the model the scene state explicitly** — it will not infer modifiers, settings or contents. Keep each step's task narrow. | Blender devtalk |
| 10 | **Constrained decoding makes small local models usable for structured steps.** LM Studio supports JSON-schema `response_format` (llama.cpp grammars); it guarantees valid JSON, not correct content; works best ≥7B. | LM Studio docs |
| 11 | **Every harness component encodes an assumption about what the model can't do.** Stress-test and remove components as models improve; keep the planner and evaluator, drop what the model now does alone. | Anthropic harness post |

## Where v1 was weak (measured on your live scene)

1. Vocabulary is rooms-and-furniture only → cannot express a forest, tunnel or cabin.
2. Critic is geometry-only. It marked a 5.35 m "sink" and a bedside table used as a "counter" as `ok`.
3. No exploration step, no clarifying questions, no stated success criteria.
4. Thinking is invisible; only a log of actions.
5. A follow-up ("the sofa faces the wrong way") built a second house at x = 19 m — no persistent scene graph, so no edit.
6. Orientation metadata is a default (+Y @ 0.3 for all 88 assets), so facing was a guess.
7. The Asset Bucket "Build" bypasses the agent entirely (everything at 0,0,0).
8. A small model gets free-form JSON and no schema enforcement.

## Design: one pipeline for any scene

The earlier draft of this document listed scene-specific builders (terrain, scatter,
tunnel sweeps…). That is the wrong shape: whatever list you write, clients will ask
for something outside it. The only mechanism that covers *any* scene is the model
writing Blender code — what SceneCraft and the code-execute-render-inspect systems do
— so the architecture makes that reliable instead of trying to enumerate scenes.

```
 request (+ reference image)
   │
   ▼
 THINK     free-text design thinking, streamed to the UI → SUCCESS CRITERIA
   ▼
 PLAN      an ordered list of BUILD STEPS, shown as editable to-dos. Each step:
   │         goal · what "done" looks like (checkable) · depends on
   │       Steps are free text. Nothing in the schema names a kind of scene.
   ▼
 for each step:
   CODE      the model writes Python against `ab`, a small scene-agnostic
   │         modelling toolkit (primitives, extrude, array, scatter, height-field,
   │         materials, lights, parenting, bounding boxes). The toolkit exists so a
   │         small model writes 10 reliable lines instead of 80 fragile ones.
   RUN       sandboxed (no os/subprocess/files); everything created is tagged and
   │         kept in the run's collection; a checkpoint protects the user's own objects
   OBSERVE   ground truth, not assumptions: what exists now (name, size, position),
   │         what this step created, generic problem checks (errors, empty/giant/
   │         degenerate objects, interpenetration, floating, below-ground), and
   │         renders (a vision model sees them; a text model gets the numbers)
   CHECK     a separate skeptical critic judges the step against its own acceptance
   │         test → pass / fail / can't judge
   FIX       on failure: the error + critique go back to the coder (≤3 attempts), then
   │         the run continues and the step is reported as not fully met
   ▼
 REVIEW    skeptical review of the whole scene against the SUCCESS CRITERIA
   ▼
 REPORT    steps with attempts, criteria verdicts, renders, "what the agent did", Undo
```

**Tools, not scene types.** The room/furniture layout solver stays — as one tool the
model can choose when a step is "place these library assets in this space". The
model decides per step; nothing in code decides by scene kind.

**Where domain knowledge comes from:** the model's own THINK output, the user's brief
and reference image, and optional editable playbooks (plain markdown). Never `if`
statements about kitchens, forests or aircraft.

**Reliability for small local models:** schema-constrained JSON for plan/check;
narrow per-call context (current step + compact scene state, never the whole chat);
the toolkit; the error fed back verbatim; hard attempt limits.

## Phases

1. **Think & plan visibly** — streaming, schema JSON, success criteria, skeptical reviewer
   with tri-state verdicts. *(done)*
2. **General step engine** — the `ab` toolkit, sandboxed run + scene-state/diff + generic
   problem checks, step loop (code → run → observe → check → fix), step list in the UI.
3. **Vision & facing** — renders judged by a vision model; asset-facing calibration; the
   reviewer sees images.
4. **Edit in place + memory** — a persisted scene graph so follow-ups modify the build;
   corrections remembered per asset.
5. **Reference image** — *(done for the step pipeline)* attach / paste / drop images in the
   composer; a vision model (Settings → Vision model) writes a build brief that feeds the
   thinking, success criteria and plan; after building, renders are compared with the image and
   the differences become fix steps. An image without a vision model stops with a clear message.
   Ask / general chats answer questions about an image directly. Not yet: the rooms/furniture
   pipeline only uses the written brief (no render-vs-image comparison).
6. **Remaining paths** (Asset Bucket etc.) through the agent; playbooks.

## Sources

- SceneCraft — https://proceedings.mlr.press/v235/hu24g.html · https://iclr.cc/virtual/2024/23120
- Holodeck — https://arxiv.org/html/2312.09067v2
- Scenethesis — https://arxiv.org/html/2505.02836v1
- Planner–Actor–Critic for Blender — https://dl.acm.org/doi/10.1145/3772363.3798904
- Blender devtalk, 3D-Agent architecture — https://devtalk.blender.org/t/3d-agent-blender-ai-assistant-built-a-multi-agent-system-on-top-of-blenders-mcp-and-python-api-and-sharing-architecture-learnings-for-the-lab-discussion/44260
- EZBlender — https://openaccess.thecvf.com/content/WACV2026W/VALED/papers/Wang_EZBlender_Efficient_3D_Editing_with_Plan-and-ReAct_Agent_WACVW_2026_paper.pdf
- Anthropic, Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, Harness design for long-running apps — https://www.anthropic.com/engineering/harness-design-long-running-apps
- Cursor plan mode — https://cursor.com/blog/plan-mode
- LM Studio structured output — https://lmstudio.ai/docs/app/api/structured-output
- SceneX — https://arxiv.org/pdf/2403.15698 (abstract-level only)
- Infinigen overview — https://www.cgchannel.com/2023/07/infinigen-a-free-generator-for-procedural-3d-environments

## Measured with a 14B local model (qwen2.5-coder-14b via LM Studio)

`node desktop_app/scripts/e2e/run.mjs lmstudio "<request>"` against a headless Blender.
What the runs taught us:

- Streaming and schema-constrained JSON both work on LM Studio; a server that rejects
  the schema is retried plainly and remembered.
- **Never show catalog sizes in prompts.** Given "sofa (3.35×3.80×4.18)", the model copied
  those numbers as its own size estimate, making a broken asset look right and making
  its placeholder 4 m tall. Sizes are now estimated from the model's knowledge and
  checked in code against the real asset.
- **Vague criteria are useless** ("harmonious palette"). The THINK prompt now demands
  criteria checkable from a plan view or render.
- **A text-only reviewer cannot judge facing or looks.** It said "faces the correct
  direction: met" while seeing nothing. Verdicts are now tri-state; "can't judge" is shown
  as such, and `turn` edits are not offered to a text-only reviewer.
- **Geometry-only facing estimation was wrong** (put a TV stand's front at its short end;
  one "sofa" file is three separate pieces) and was discarded. Facing needs a vision
  check or a user correction, remembered per asset (phase 3).
- A 14B reviewer proposes dubious edits; the deterministic verifier is the safety net.
  Guards added: no re-adding existing items, ≤8 edits per round, a failed asset is never
  swapped back in, unplaced items retry with a smaller asset then a placeholder.

### Known limit (phase 2)
The plan schema is still room-shaped (`rooms`, `items`, walls). A forest, tunnel or
aircraft cabin can't be expressed yet — that is exactly what phase 2 (regions + generic
builders: array / scatter / along-path / terrain / shapes) is for.
