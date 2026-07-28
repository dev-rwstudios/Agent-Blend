# Agent-Blend

> **Control Blender entirely through AI — create 3D models, set up scenes, animate, render, and more, all through natural language.**

Agent-Blend is a powerful MCP (Model Context Protocol) server that bridges AI assistants with Blender. It goes beyond simple tool exposure — it guides the LLM to produce professional 3D results through expert prompts, proven workflows, visual feedback, and mesh quality analysis.

---

## What is Agent-Blend?

Agent-Blend connects AI assistants (like those running in Antigravity IDE, Claude, or any MCP-compatible client) directly to a live Blender session. You describe what you want in plain language, and the AI uses Blender's full toolset to make it happen — no scripting required.

**Key highlights:**

- 🛠️ **164 tools** across 24 modules — modeling, mesh editing, materials, shader nodes, lighting, camera, animation, rendering, sculpting, UV mapping, physics, geometry nodes, rigging, curves, annotations, collections, file I/O, Bool Tool, viewport control, mesh quality analysis
- 🧠 **12 expert prompts** — built-in guidance on topology, real-world scale, lighting principles, PBR materials, character modeling, scene cleanup, and more
- 📸 **Visual feedback loop** — fast OpenGL viewport screenshots with auto-critique prompts that guide the AI to verify its own work
- 🔍 **Mesh quality analysis** — structured defect reports: non-manifold edges, loose vertices, zero-area faces, duplicate vertices, wire edges
- 🔒 **Sandboxed code execution** — `execute_blender_code` blocks dangerous system imports while allowing safe Blender operations
- 🔄 **Render-aware** — detects Blender render state and queues commands; auto-recovers from stuck render guards
- ✅ **Blender 4.2+ compatible** — ships as a Blender Extension; tested against Blender 5.1
- 🔌 **Custom port** — configure from the N-panel UI (default: `9876`)
- 🚫 **Zero telemetry** — no tracking, no analytics, everything runs locally on `127.0.0.1`
- 📦 **Zero-dependency addon** — the Blender addon uses only Python stdlib + `bpy`
- 🧵 **Thread-safe** — background TCP server with queue-based main-thread execution
- 🧪 **1190 tests** — comprehensive coverage across tools, handlers, validators, and prompts

---

## Requirements

| Requirement | Minimum Version |
|-------------|----------------|
| Blender | 4.2 LTS or later |
| Python | 3.10 or later |
| `uv` | Latest recommended |

> **Blender 4.0 / 4.1 users:** Not supported. Agent-Blend ships as a Blender Extension, which requires Blender 4.2 or later. Download the latest Blender from [blender.org/download](https://www.blender.org/download/).

---

## Installation

### Step 1 — Clone the repository

```bash
git clone https://github.com/Gopikrish-30/Agent-Blend.git
cd Agent-Blend
```

### Step 2 — Install `uv` (if not already installed)

`uv` is a fast Python package manager used to run Agent-Blend.

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Verify installation:

```bash
uv --version
```

### Step 3 — Install the MCP server

```bash
uv pip install -e .
```

This installs Agent-Blend and its dependencies (`mcp`, `pydantic`) into a virtual environment managed by `uv`.

### Step 4 — Install the Blender addon

1. Locate the `blend-ai.zip` file in the repository root (or build it yourself — see [Building the addon](#building-the-addon))
2. Open **Blender 4.2 or later**
3. Go to **Edit → Preferences → Get Extensions**
4. Click the dropdown **▾** in the top-right corner
5. Select **Install from Disk...**
6. Choose the `blend-ai.zip` file
7. Enable **"blend-ai"** in the extensions list

The addon is now installed. You will see a **blend-ai** tab in Blender's N-panel (press `N` in the 3D Viewport to open it).

<details>
<summary><strong>Developer install (symlink — recommended for contributors)</strong></summary>

If you're developing or modifying Agent-Blend, symlink the `addon/` folder directly into Blender's extensions directory. This means you don't need to reinstall the zip after every change — just restart Blender.

Replace `<ver>` with your Blender version (e.g. `4.2`, `5.1`):

```bash
# macOS
ln -s "$(pwd)/addon" ~/Library/Application\ Support/Blender/<ver>/extensions/user_default/blend_ai

# Linux
ln -s "$(pwd)/addon" ~/.config/blender/<ver>/extensions/user_default/blend_ai

# Windows (run PowerShell as Administrator)
mklink /D "%APPDATA%\Blender Foundation\Blender\<ver>\extensions\user_default\blend_ai" "%cd%\addon"
```

Then enable the extension in Blender under **Get Extensions → User**.

</details>

<details>
<summary><strong>Upgrading from a previous version</strong></summary>

Python caches imported modules, so replacing files in-place without a full restart can leave stale handlers registered. Always follow these steps when upgrading:

1. In Blender's N-panel → **blend-ai** tab → click **Stop Server**
2. Go to **Edit → Preferences → Get Extensions**, find **blend-ai**, and click **Uninstall**
3. Fully quit and restart Blender (clears cached modules)
4. Install the new `.zip` via **▾ → Install from Disk...** and enable it

For the symlink developer install, upgrading is just `git pull` followed by a full Blender restart.

</details>

---

### Step 5 — Start the server in Blender

1. Open Blender's 3D Viewport
2. Press `N` to open the **N-panel** (side panel on the right)
3. Find the **blend-ai** tab
4. Set your preferred port (default: `9876`)
5. Click **Start Server**

You should see a confirmation that the server is running on `127.0.0.1:9876`.

---

### Step 6 — Connect your AI assistant

<details>
<summary><strong>Antigravity IDE</strong></summary>

1. Find your MCP config file:
   - **Windows:** `C:\Users\{username}\.gemini\antigravity\mcp_config.json`
   - **macOS / Linux:** `~/.gemini/antigravity/mcp_config.json`

2. Add the following entry (see also `mcp-config.example.json` in this repo):

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

> Replace `/absolute/path/to/Agent-Blend` with the real path to your cloned folder. On Windows, use forward slashes (e.g. `C:/Users/yourname/Agent-Blend`).

3. Restart Antigravity IDE to load the server
4. Make sure Blender is running with the server started (Step 5)

**Example prompts:**

```
> Create a red metallic sphere on a white plane with three-point lighting

> Add a subdivision surface modifier to the sphere and set it to level 3

> Analyze the mesh quality of the sphere and fix any issues
```

</details>

---


## Building the Addon

To build the `blend-ai.zip` addon from source:

```bash
# Linux / macOS
bash build.sh

# Windows (PowerShell)
.\build.ps1
```

The built `.zip` will appear in the project root, ready to install in Blender.

---

## Expert Guidance (Built-in Prompts)

Agent-Blend includes 12 MCP prompts that guide the AI toward professional-quality results:

| Prompt | What It Teaches |
|--------|----------------|
| `blender_best_practices` | Bool Tool preference, mesh editing patterns, modifier workflow |
| `topology_best_practices` | Quad topology, edge flow, poles, n-gon cleanup, face density |
| `scale_reference_guide` | Real-world dimensions for 8 common objects, unit system setup |
| `lighting_principles` | Three-point lighting, HDRI, EEVEE vs Cycles, color temperature |
| `studio_lighting_setup` | 6-step studio lighting workflow with specific energy values |
| `character_basemesh_workflow` | 7-step character base mesh from cube with mirror + subdivision |
| `material_workflow_guide` | PBR materials, Principled BSDF recipes, texture color spaces |
| `auto_critique_workflow` | Visual feedback loop — when to screenshot, what to check |
| `product_shot_setup` | Professional product shot setup guide |
| `character_base_mesh` | Character modeling guide |
| `scene_cleanup` | Scene organization workflow |
| `animation_turntable` | Turntable animation setup |

---

## Tool Domains

<details>
<summary><strong>All 164 tools across 24 modules</strong></summary>

| Domain | Tools | Highlights |
|--------|-------|-----------|
| Scene | 6 | Get scene info, set frame range, manage scenes, suggest extensions |
| Objects | 14 | Create primitives, duplicate, parent, join, visibility, origin, convert, auto-smooth |
| Transforms | 6 | Position, rotation (euler/quat), scale, apply, snap |
| Modeling | 13 | Modifiers, booleans, subdivide, extrude, bevel, loop cut, bridge edge loops |
| Mesh Editing | 16 | Inset, fill, grid fill, mark seam/sharp, normals, dissolve, knife project, spin, crease |
| Mesh Quality | 1 | Analyze mesh defects: non-manifold, loose verts, zero-area faces, duplicates |
| Bool Tool | 4 | Auto union, difference, intersect, slice |
| Materials | 15 | Principled BSDF, textures, blend modes, shader node graph |
| Lighting | 7 | Point/sun/spot/area lights, HDRIs, light rigs, shadows |
| Camera | 6 | Create, aim, DOF, viewport capture, active camera |
| Animation | 8 | Keyframes, interpolation, frame range, follow path |
| Rendering | 7 | Engine, resolution, samples, output format, render, EEVEE light path intensity |
| Curves | 10 | Bezier/NURBS/path, 3D text, convert, reverse, handle types, cyclic, subdivide |
| Sculpting | 8 | Brushes, remesh, multires, symmetry, dynamic topology |
| UV Mapping | 4 | Smart project, unwrap, projection, pack islands |
| Physics | 9 | Rigid body, cloth, fluid, particles (velocity, rendering, delete), bake |
| Geometry Nodes | 5 | Create node trees, add/connect nodes, set inputs |
| Armature | 6 | Bones, constraints, auto weights, pose |
| Annotations | 5 | Annotation layers and strokes |
| Collections | 4 | Create, move objects, visibility, delete |
| File I/O | 5 | Import/export (FBX, OBJ, glTF, USD, STL...), save/open |
| Viewport | 3 | Shading mode, overlays, focus on object |
| Screenshot | 1 | Fast OpenGL viewport capture or full render, base64 output |
| Code Exec | 1 | Sandboxed Python execution in Blender |

</details>

---

## Architecture

```
AI Assistant <--stdio/MCP--> Agent-Blend server <--TCP socket--> Blender addon <--bpy--> Blender
```

<details>
<summary><strong>How it works</strong></summary>

- **MCP Server** (`src/blend_ai/`): Python process using the `mcp` SDK. Exposes tools, resources, and prompts over stdio. Validates all inputs before forwarding to Blender.
- **Blender Addon** (`addon/`): Runs a TCP socket server inside Blender on a background thread. Commands are queued and executed on the main thread via `bpy.app.timers` to respect Blender's threading model.
- **Render Guard**: Tracks render state via `bpy.app.handlers`. During renders, the server returns a "busy" status and auto-recovers from crashed renders via `load_post` handler.
- **Protocol**: Length-prefixed JSON messages over TCP with `SO_KEEPALIVE` for stale connection detection. Each message is a 4-byte big-endian length header followed by a UTF-8 JSON payload.

</details>

---

## Privacy & Security

<details>
<summary><strong>Privacy</strong></summary>

- **Zero telemetry** — Agent-Blend collects no usage data and makes no network requests beyond the local TCP connection to Blender
- **Fully local** — all communication stays on your machine; no cloud services, no external APIs
- **Open source** — the entire codebase is auditable

</details>

<details>
<summary><strong>Security</strong></summary>

- **Localhost only** — the TCP socket binds to `127.0.0.1`, never exposed to the network
- **Sandboxed code execution** — `execute_blender_code` blocks 25 dangerous imports (`os`, `subprocess`, `socket`, `shutil`, `sys`, `ctypes`, etc.) and removes dangerous builtins (`exec`, `eval`, `open`, `globals`, etc.)
- **Input validation** — all inputs pass through validators before reaching Blender: name sanitization, path traversal prevention, numeric range checks, enum allowlists
- **File safety** — import operations disable `use_scripts_auto_execute` to prevent script injection; file extensions are checked against allowlists
- **Command allowlist** — the addon dispatcher only processes explicitly registered commands; unknown commands are rejected
- **Shader node allowlist** — only 64 known shader node types can be created

</details>

---

## Limitations

<details>
<summary><strong>Known limitations</strong></summary>

- **Blender must be running** — the MCP server communicates with Blender over TCP. Blender must be open with the addon enabled and server started
- **Single connection** — the addon accepts one client at a time; multiple AI assistants cannot control the same Blender instance simultaneously
- **Selection is all-or-nothing** — most mesh editing tools operate on all geometry; fine-grained vertex/edge/face selection by index is not yet exposed (though `select_linked` is available)
- **Sculpt strokes cannot be simulated** — you can configure brushes, symmetry, dyntopo, and remeshing, but actual brush strokes are not yet exposed
- **Node graphs require sequential calls** — shader and geometry node trees must be built one node/connection at a time
- **No undo integration** — operations appear in Blender's undo history individually, but there's no MCP-level undo/redo or transaction grouping
- **Viewport capture requires a visible 3D viewport** — headless Blender may not support viewport screenshots
- **No real-time feedback** — the MCP protocol is request/response; there's no streaming of viewport updates or render progress

</details>

---

## Development

```bash
# Install with dev dependencies
uv pip install -e ".[dev]"

# Run tests (1190 tests)
uv run --extra dev pytest

# Run tests with coverage
uv run --extra dev pytest --cov=blend_ai

# Lint
ruff check src/ tests/

# Format
ruff format src/ tests/
```

<details>
<summary><strong>Project structure</strong></summary>

```
Agent-Blend/
├── src/blend_ai/              # MCP server
│   ├── server.py              # FastMCP entry point
│   ├── connection.py          # TCP client to Blender (with busy-retry)
│   ├── validators.py          # Input validation
│   ├── tools/                 # 24 tool modules (164 tools)
│   ├── resources/             # MCP resources (scene, objects, materials)
│   └── prompts/               # 12 expert prompt templates
├── addon/                     # Blender addon (zero external deps)
│   ├── blender_manifest.toml  # Blender 4.2+ Extension manifest
│   ├── __init__.py            # Register/unregister
│   ├── server.py              # TCP socket server (SO_KEEPALIVE)
│   ├── dispatcher.py          # Command routing + allowlist
│   ├── thread_safety.py       # Main-thread execution queue
│   ├── render_guard.py        # Render state tracking + crash recovery
│   ├── ui_panel.py            # N-panel UI (start/stop + port config)
│   └── handlers/              # 23 handler modules
└── tests/                     # 1190 unit tests
```

</details>

---

## Troubleshooting

**Server won't connect to Blender**
- Make sure Blender is open and you've clicked **Start Server** in the N-panel blend-ai tab
- Verify the port matches in both Blender and your MCP config (default: `9876`)
- Check that no firewall is blocking `127.0.0.1:9876`

**"Connection timed out" errors**
- Blender may be busy rendering — wait for the render to finish
- Try clicking **Stop Server** then **Start Server** in the N-panel to reset

**Addon not showing in extensions list**
- Make sure you're using Blender 4.2 or later
- Try installing via **Edit → Preferences → Get Extensions → ▾ → Install from Disk...**

**`uv` command not found**
- Ensure `uv` is installed and on your system `PATH` — see [Step 2](#step-2--install-uv-if-not-already-installed)

---

## Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes and add tests
4. Run the test suite: `uv run --extra dev pytest`
5. Submit a pull request

Please ensure all tests pass and new features include appropriate test coverage.
