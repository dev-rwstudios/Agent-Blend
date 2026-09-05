# Agent-Blend — Blender MCP Server Documentation

## 1. Project Overview

### What it is

Agent-Blend is a **Model Context Protocol (MCP) server** that gives an AI assistant direct, structured control over a running Blender session. Instead of the AI generating raw Python and hoping it runs correctly inside Blender's API, it calls well-defined, validated **tools** (`create_object`, `set_material`, `render_image`, etc.) that are dispatched to a companion Blender addon and executed safely on Blender's main thread.

It is composed of two cooperating halves:

| Half | Location | Role |
|---|---|---|
| **MCP server** | `src/blend_ai/` | A Python process that speaks MCP over stdio to the AI client, validates every input, and forwards commands over TCP. |
| **Blender addon** | `addon/` | A zero-dependency Blender Extension that runs a local TCP server inside Blender and executes commands against the live `bpy` scene. |

### The problem it solves

Driving Blender with an LLM through raw scripting has three recurring failure modes this project addresses directly:

- **Unsafe/unbounded code execution** — asking an LLM to write arbitrary Python and `exec()` it inside Blender is a security and stability risk. Agent-Blend replaces most of that surface with a fixed, allowlisted set of tools, and sandboxes the one tool that does allow code execution.
- **No feedback loop** — an LLM working blind (text-only) routinely misjudges scale, placement, and composition. Agent-Blend adds a viewport-screenshot tool and "auto-critique" prompts so the AI can look at its own work and correct it.
- **Amateur-quality output** — LLMs left to their own devices produce messy topology, unrealistic scale, and flat lighting. Agent-Blend ships built-in **expert prompts** (topology rules, scale references, lighting principles, PBR material recipes) that steer the model toward professional conventions, plus a curated **asset library** of ~90 pre-modeled, correctly-dimensioned furniture/decor pieces so the AI reuses real assets instead of hand-modeling a chair from a cube.

### Intended use cases

- **Conversational 3D scene building** — "build a modern bedroom with a queen bed, nightstands, and warm lighting" from an AI chat client.
- **Procedural / parametric modeling assistance** — applying modifiers, booleans, geometry nodes, and mesh cleanup through natural language.
- **Automated QA on meshes** — detecting non-manifold geometry, loose vertices, and other defects before export.
- **Lighting, materials, and render setup** — PBR material assignment, three-point lighting, camera framing, and render-engine configuration.
- **Rapid prototyping / previsualization** — product shots, turntables, and layout drafts without hand-authoring every step in Blender's UI.

---

## 2. Architecture

### Component diagram
![alt text](<Blender-mcp-architecture.png>)


### Layer-by-layer

**1. AI Client (outside this repo)**
Any MCP-capable host — an IDE agent, Claude, or a custom client. It discovers Agent-Blend's tools/prompts/resources over MCP and decides which to call based on the user's natural-language request. A secondary, built-in client (`blend_ai.ollama_chat`) is also included: a terminal REPL that talks directly to a local Ollama model and the same tool set, for use without an MCP host.

**2. MCP Server (`src/blend_ai/`)**
A single Python process built on the `mcp` SDK's `FastMCP`. On startup it registers:
- **177 tools** across **25 modules** (scene, objects, transforms, modeling, mesh editing, mesh quality, bool tool, materials, lighting, camera, animation, rendering, curves, sculpting, UV, physics, geometry nodes, armature, annotations (gpencil), collections, file I/O, viewport, screenshot, code execution, and the asset library).
- **13 expert prompts** (topology, scale, lighting, materials, character base mesh, scene cleanup, and an asset-first workflow, among others) that the AI client can pull in as guidance.
- **Resources** exposing read-only scene/object/material state and the local asset catalog for lightweight context lookups.

Every tool call passes through `validators.py` (name sanitization, path-traversal prevention, numeric range checks, enum allowlists) before it is allowed to reach Blender. Once validated, the tool builds a `{command, params}` message and hands it to a single shared `BlenderConnection`.

**3. TCP Transport (`connection.py` ↔ `addon/server.py`)**
`BlenderConnection` is a synchronous TCP client with connect/retry/reconnect logic. Messages are **length-prefixed**: a 4-byte big-endian length header followed by a UTF-8 JSON payload. If Blender reports it's busy (mid-render), the client automatically backs off and retries (up to ~5 minutes) rather than failing the call outright.

**4. Blender Addon (`addon/`)**
Ships as a Blender 4.2+ Extension with **zero external dependencies** (stdlib + `bpy` only):
- `server.py` runs a TCP socket server on a background thread (default `127.0.0.1:9876`, configurable from the N-panel), with `SO_KEEPALIVE` to detect stale connections.
- `dispatcher.py` is a strict command **allowlist** — only explicitly registered commands are dispatched; anything else is rejected.
- `thread_safety.py` queues the actual work and executes it on Blender's **main thread** via `bpy.app.timers`, respecting Blender's threading model (the `bpy` API is not thread-safe).
- `render_guard.py` tracks render state through `bpy.app.handlers`; while a render is in progress, incoming commands get a `"busy"` response, and a `load_post` handler auto-recovers from crashed/interrupted renders.
- `handlers/` (23 modules, mirroring the server-side tool modules) contain the actual `bpy` calls that mutate the scene.

**5. Blender itself**
The live `bpy` scene, 3D viewport, and renderer — the actual state being read and mutated.

---

## 3. Workflow — Request Lifecycle


### Narrative breakdown

1. **User input.** The user describes the desired outcome in plain language to the AI client.
2. **Planning.** The AI client selects relevant MCP tools and, where useful, reads a built-in **prompt** (e.g. `lighting_principles`, `scale_reference_guide`) for domain guidance before acting. For interior/furniture scenes, the `asset_first_workflow` prompt requires it to search the asset library and state a "Room Bill of Materials" before making any tool calls.
3. **Tool call.** The client invokes a tool over the MCP stdio transport (e.g. `create_object`).
4. **Validation.** `blend_ai` validates all parameters — object names, numeric ranges, enum values, file paths — before anything is sent to Blender. Invalid input is rejected here, without ever reaching the Blender process.
5. **TCP dispatch.** The validated command is serialized to JSON, length-prefixed, and sent over the local TCP socket to the Blender addon.
6. **Allowlist + routing.** The addon's dispatcher checks the command name against its registered handler allowlist. Unknown or disallowed commands are rejected immediately with an error response.
7. **Main-thread execution.** The matched handler is queued and executed on Blender's main thread on the next `bpy.app.timers` tick (Blender's `bpy` API cannot be safely called from a background thread). If a render is currently running, the render guard returns a `"busy"` status instead, and the MCP-side connection automatically retries with backoff.
8. **Scene mutation.** The handler performs the actual `bpy` operation (creating the object, setting the material, adding lights, etc.) and returns a result or raises an exception, which is caught and turned into an `{status: "error", result: "..."}` response.
9. **Response round-trip.** The result travels back over TCP → `BlenderConnection` → the MCP tool call → the AI client.
10. **Iteration.** The AI client repeats steps 3–9 for each remaining step of the plan (materials, lighting, camera).
11. **Visual verification (optional but encouraged).** The client calls `get_viewport_screenshot` (or `render_image` for camera-accurate framing) and compares the result against intent, per the `auto_critique_workflow` prompt — catching issues like wrong scale or occluded objects before finishing.
12. **Final response.** The AI client summarizes what was done for the user, or continues iterating if the visual check surfaced a problem.

---

## 4. Example Usage

### Prerequisite state

- Blender 4.2+ is open, the `blend-ai` addon is enabled, and **Start Server** has been clicked in the N-panel (default port `9876`).
- An MCP client (e.g. Antigravity IDE) is configured to launch `blend-ai` — see [Setup](#7-setup--installation).

### Example A — Natural-language prompt (via an MCP client)

```
> Create a red metallic sphere on a white plane with three-point lighting
```

Behind the scenes, this typically resolves to a sequence of tool calls similar to:

```jsonc
// 1. Create the ground plane
{"tool": "create_object", "params": {"type": "PLANE", "name": "Ground", "scale": [5, 5, 1]}}

// 2. Create the sphere
{"tool": "create_object", "params": {"type": "SPHERE", "name": "HeroSphere", "location": [0, 0, 1]}}

// 3. Assign materials
{"tool": "set_material", "params": {"object_name": "Ground", "base_color": [1, 1, 1, 1], "roughness": 0.4}}
{"tool": "set_material", "params": {"object_name": "HeroSphere", "base_color": [0.8, 0.05, 0.05, 1], "metallic": 1.0, "roughness": 0.2}}

// 4. Three-point lighting rig
{"tool": "create_light", "params": {"type": "AREA", "name": "KeyLight",  "location": [4, -4, 5], "energy": 1000}}
{"tool": "create_light", "params": {"type": "AREA", "name": "FillLight", "location": [-4, -3, 3], "energy": 400}}
{"tool": "create_light", "params": {"type": "AREA", "name": "RimLight",  "location": [0, 5, 4],   "energy": 600}}

// 5. Verify visually
{"tool": "get_viewport_screenshot", "params": {}}
```

Follow-up refinements in the same session:

```
> Add a subdivision surface modifier to the sphere and set it to level 3
> Analyze the mesh quality of the sphere and fix any issues
```

### Example B — Building a furnished room (asset-first workflow)

```
> Build a small modern bedroom: a queen bed against the back wall,
> two nightstands, a floor lamp, and a rug.
```

The AI is expected (per the `asset_first_workflow` prompt) to search the asset library before modeling anything from scratch:

```jsonc
{"tool": "search_asset_library", "params": {"category": "bed", "query": "queen bed frame"}}
{"tool": "import_asset", "params": {
  "asset_id": "bed_frame_02",
  "location": [0, -2, 0],
  "snap_to_floor": true,
  "place_on": null
}}
{"tool": "search_asset_library", "params": {"category": "lighting", "query": "floor lamp"}}
{"tool": "import_asset", "params": {"asset_id": "floor_lamp", "snap_to_floor": true, "location": [1.5, -1.8, 0]}}
```

### Example C — Direct Python usage (server internals, e.g. in tests/tooling)

```python
from blend_ai.connection import BlenderConnection

with BlenderConnection(host="127.0.0.1", port=9876) as conn:
    response = conn.send_command("get_scene_info", {})
    print(response["status"], response["result"])
```

### Example D — Local Ollama REPL (no MCP host required)

```bash
uv run python -m blend_ai.ollama_chat
```

```
blend-ai> Create a 2x2x2 cube named "Crate" at the origin and give it a wood material
```

---

## 5. Features

### Core capabilities

- **177 tools across 25 modules** covering scene management, objects, transforms, modeling, mesh editing, mesh quality analysis, Bool Tool, materials/shader nodes, lighting, camera, animation, rendering, curves, sculpting, UV mapping, physics, geometry nodes, armature/rigging, annotations, collections, file I/O, viewport control, screenshot capture, and sandboxed code execution.
- **13 built-in expert prompts** — reusable guidance blocks the AI client can pull in for topology, real-world scale, lighting (general + studio), PBR materials, character base-mesh workflow, scene cleanup, turntable animation, an asset-first building protocol, and a visual auto-critique workflow.
- **Local asset library** (`asset_library/`) — ~90 pre-modeled, dimensioned glTF/GLB assets across 14 categories (bed, seating, table, storage, lighting, soft furnishing, decor, rug, sanitary, door/window, window treatment, electronics, clothing, architecture), searchable via `search_asset_library` / `get_asset_details` / `list_asset_categories`, and placed via `import_asset` with floor/wall/ceiling snapping and relative placement (`place_on`).
- **Visual feedback loop** — fast OpenGL viewport screenshots (`get_viewport_screenshot`) and camera-accurate renders (`render_image`), both returned as base64 image data, paired with an auto-critique prompt so the AI checks its own results.
- **Mesh quality analysis** — structured defect reports covering non-manifold edges, loose vertices, zero-area faces, duplicate vertices, and wire edges.
- **Sandboxed code execution** — `execute_blender_code` runs arbitrary Blender-scripting Python with dangerous imports (`os`, `subprocess`, `socket`, `shutil`, `sys`, `ctypes`, etc.) and dangerous builtins (`exec`, `eval`, `open`, `globals`, etc.) stripped out.
- **Render-aware transport** — the addon detects Blender's render state and returns a `busy` status during renders; the MCP-side client automatically waits and retries. A `load_post` handler recovers from renders that crashed or were interrupted mid-flight.
- **Two client integrations out of the box** — any MCP-compatible host (stdio transport) and a standalone terminal chat client backed by a local Ollama model.
- **Thread-safe design** — the addon's TCP server runs on a background thread; all `bpy` calls are marshalled onto Blender's main thread via a queue and `bpy.app.timers`.
- **Local-only, zero telemetry** — the socket binds to `127.0.0.1` only; no analytics or external network calls.
- **Configurable port** — set from the N-panel UI in Blender (default `9876`).
- **Blender 4.2+ compatible**, ships as a proper Blender Extension; tested against Blender 5.1.
- **Test coverage** — an extensive automated test suite spans tools, addon handlers, validators, prompts, and the asset catalog.

### Security features

| Mechanism | Purpose |
|---|---|
| Command allowlist (`dispatcher.py`) | Only explicitly registered commands can be executed; unknown commands are rejected outright. |
| Input validators (`validators.py`) | Name sanitization, path-traversal prevention, numeric range checks, enum allowlists on every tool call. |
| Sandboxed `execute_blender_code` | Blocks ~25 dangerous imports and removes dangerous builtins before running user-provided code. |
| Shader node allowlist | Only a fixed set of known shader node types can be created via the node-graph tools. |
| Localhost binding | The TCP socket never listens beyond `127.0.0.1`. |
| Import safety | File import operations disable `use_scripts_auto_execute` and check extensions against an allowlist. |

---

## 6. Current Limitations

- **Blender must be running** — the MCP server is a thin client; it has no functionality without a live Blender process with the addon's server started.
- **Single connection at a time** — the addon accepts one TCP client; two AI assistants cannot drive the same Blender instance concurrently.
- **Selection-aware editing is partial** — `select_vertices_by_index` / `select_edges_by_index` / `select_faces_by_index` (plus named selection sets and grow/shrink/select-similar) build a precise selection, but several existing operations (e.g. `inset_faces`, `dissolve_faces`) still act on the whole mesh rather than consuming that selection.
- **No simulated sculpt strokes** — brush, symmetry, dyntopo, and remesh settings can be configured, but individual brush strokes are not exposed as a tool.
- **Node graphs are built sequentially** — shader and geometry node trees require one node/connection call at a time; there is no batch graph-construction tool yet.
- **No MCP-level undo/transactions** — each operation lands in Blender's native undo history individually; there is no grouping or rollback across a multi-step tool sequence.
- **Viewport capture needs a visible 3D viewport** — this may not work in fully headless Blender configurations.
- **Request/response only, no streaming** — there is no live streaming of viewport updates or render progress; the client must poll (e.g. re-screenshot) to observe change over time.
- **Asset library is a recent addition** — the catalog (~90 assets, 14 categories) and its tools (`asset_catalog.py`, `tools/asset_library.py`, `resources/asset_library.py`) are newer than the rest of the tool surface and evolving; asset entries may carry `needs_review` flags or approximate orientation metadata that should be spot-checked visually after placement.
- **Concurrency model is intentionally simple** — the background TCP thread plus main-thread queue works well for a single interactive client but is not designed for high request throughput.

---

## 7. Setup / Installation

### Prerequisites

| Requirement | Minimum Version |
|---|---|
| Blender | 4.2 LTS or later (tested against 5.1) |
| Python | 3.10 or later |
| `uv` | latest recommended |
| An MCP-compatible AI client (or Ollama, for the standalone chat client) | — |

> Blender 4.0/4.1 are **not** supported — the addon ships as a Blender Extension, which requires 4.2+.

### 1. Clone the repository

```bash
git clone https://github.com/Gopikrish-30/Agent-Blend.git
cd Agent-Blend
```

### 2. Install `uv`

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### 3. Install the MCP server

```bash
uv pip install -e .
```

Installs `blend-ai` and its dependencies (`mcp`, `pydantic`).

### 4. Install the Blender addon

1. Locate `blend-ai.zip` in the repo root (or build it — see below).
2. In Blender: **Edit → Preferences → Get Extensions**.
3. Click the **▾** dropdown (top-right) → **Install from Disk...**
4. Select `blend-ai.zip` and enable **"blend-ai"** in the extensions list.
5. A **blend-ai** tab appears in the 3D Viewport's N-panel (press `N`).

For active development, symlink `addon/` into Blender's extensions directory instead of reinstalling the zip each time (see `README.md` for OS-specific symlink commands).

### 5. Start the server inside Blender

1. Open the 3D Viewport, press `N`, select the **blend-ai** tab.
2. Confirm/set the port (default `9876`).
3. Click **Start Server** → confirms it's listening on `127.0.0.1:9876`.

### 6. Connect an AI client

Example MCP client configuration (see `mcp-config.example.json`):

```json
{
  "mcpServers": {
    "blend-ai": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/Agent-Blend", "blend-ai"],
      "env": {
        "BLENDER_HOST": "127.0.0.1",
        "BLENDER_PORT": "9876"
      }
    }
  }
}
```

Restart the client so it picks up the new server entry, then confirm Blender's server is running (Step 5) before issuing requests.

### Building the addon from source

```bash
# Linux / macOS
bash build.sh

# Windows (PowerShell)
.\build.ps1
```

### Running tests

```bash
uv pip install -e ".[dev]"
uv run --extra dev pytest
uv run --extra dev pytest --cov=blend_ai   # with coverage
```


##To Run chat app

uv run --extra chat chainlit run app.py -w

### Troubleshooting quick reference

| Symptom | Likely cause / fix |
|---|---|
| Server won't connect to Blender | Blender not open, or **Start Server** not clicked; port mismatch between Blender and client config. |
| "Connection timed out" | Blender is mid-render — wait, or **Stop Server** / **Start Server** to reset. |
| Addon missing from extensions list | Blender version < 4.2. |
| `uv` command not found | `uv` not installed or not on `PATH`. |

---

*For the condensed quick-start and full tool/prompt tables, see the repository [`README.md`](../README.md).*
