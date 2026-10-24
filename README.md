# Agent-Blend

> **Control Blender entirely through AI — create 3D models, set up scenes, animate, render, and more, all through natural language.**

Agent-Blend is a Model Context Protocol (MCP) server, companion Blender extension, and multi-frontend ecosystem that bridges AI assistants with live Blender sessions. Instead of raw, unconstrained scripts, it gives LLMs structured, validated tools, visual feedback loops, expert prompts, and a curated 3D asset library to produce professional results.

---

## Key Highlights

- 🛠️ **170+ Tools across 25 Modules** — modeling, mesh editing, materials, procedural shader nodes, lighting, camera, animation, rendering, sculpting, UV mapping, physics, geometry nodes, rigging, curves, annotations, collections, file I/O, Bool Tool, viewport control, mesh quality analysis, and asset imports.
- 🧠 **13 Expert Prompts** — built-in guidance on quad topology, real-world scale, 3-point and studio lighting, PBR materials, character base meshes, scene cleanup, and visual auto-critique.
- 📦 **Local Asset Library** — ~90 pre-modeled, dimensioned glTF/GLB models across 14 categories (beds, seating, tables, lighting, decor, storage, etc.) with automatic floor snapping and bounding-box placement.
- 📸 **Visual Feedback Loop** — fast OpenGL viewport screenshots and camera-accurate renders returning base64 images so the AI can inspect and critique its own work.
- 🔍 **Mesh Quality Analysis** — structured defect reports detecting non-manifold edges, loose vertices, zero-area faces, duplicate vertices, and wire edges.
- 🖥️ **Multiple Client Interfaces**:
  - **MCP Server** (`src/blend_ai/`): Connects to Antigravity IDE, Claude Desktop, Cursor, or any MCP client via stdio.
  - **Studio Web App** (`chat_app/`): Full-featured Chainlit UI with live viewport drawer, scene outliner, asset browser, undo checkpoints, and multi-provider LLM support.
  - **Desktop App** (`desktop_app/`): Native Tauri 2 + React 19 desktop application with direct TCP socket communication.
  - **Terminal REPL** (`blend_ai.ollama_chat`): Standalone CLI chat with local models.
- 🔒 **Sandboxed Code Execution** — AST-audited Python script execution blocking dangerous imports (`os`, `subprocess`, `socket`, `shutil`, `ctypes`, etc.) and builtins.
- 🔄 **Render-Aware & Thread-Safe** — detects Blender render state and defers execution; dispatches all operations safely to Blender's main thread via `bpy.app.timers`.
- ✅ **Blender 4.2+ & 5.1 Compatible** — ships as a zero-dependency Blender Extension.
- 🚫 **Zero Telemetry** — runs 100% locally on `127.0.0.1`.

---

## Requirements

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| Blender | 4.2 LTS or later | Tested up to Blender 5.1 |
| Python | 3.10 or later | Managed via `uv` |
| `uv` | Latest recommended | Fast Python package manager |
| Node.js & pnpm | Node 18+ / pnpm 9+ | (Optional) For running the Desktop App |

---

## Installation & Setup

### Step 1 — Clone the Repository

```bash
git clone https://github.com/Gopikrish-30/Agent-Blend.git
cd Agent-Blend
```

### Step 2 — Install `uv` (if not installed)

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### Step 3 — Install the MCP Server & Dependencies

```bash
uv pip install -e .
```

To install development dependencies (test runner, coverage, linter):
```bash
uv pip install -e ".[dev]"
```

### Step 4 — Install the Blender Addon

1. Locate `blend-ai.zip` in the repository root (or build fresh via `.\build.ps1` or `bash build.sh`).
2. Open **Blender 4.2 or later**.
3. Navigate to **Edit → Preferences → Get Extensions**.
4. Click the dropdown arrow **▾** in the top-right corner → **Install from Disk...**
5. Select `blend-ai.zip` and enable **"blend-ai"** in the extensions list.

> **Developer Symlink (Recommended for local dev):**
> Instead of reinstalling the zip each time, symlink the `addon/` folder directly into Blender's user extensions folder:
> ```bash
> # Windows (PowerShell as Admin)
> mklink /D "%APPDATA%\Blender Foundation\Blender\<ver>\extensions\user_default\blend_ai" "%cd%\addon"
>
> # macOS
> ln -s "$(pwd)/addon" ~/Library/Application\ Support/Blender/<ver>/extensions/user_default/blend_ai
>
> # Linux
> ln -s "$(pwd)/addon" ~/.config/blender/<ver>/extensions/user_default/blend_ai
> ```

### Step 5 — Start the Server in Blender

1. In Blender's 3D Viewport, press **N** to open the side panel.
2. Select the **blend-ai** tab.
3. Keep default port `9876` (or set custom) and click **Start Server**.
4. You will see a green status confirming the server is listening on `127.0.0.1:9876`.

---

## Client Applications

Choose the frontend that best fits your workflow:

### Option A — Antigravity IDE / Claude Desktop (MCP)

Add Agent-Blend to your client's MCP configuration (`mcp_config.json`):

```json
{
  "mcpServers": {
    "blend-ai": {
      "command": "uv",
      "args": ["run", "--directory", "C:/path/to/Agent-Blend", "blend-ai"],
      "env": {
        "BLENDER_HOST": "127.0.0.1",
        "BLENDER_PORT": "9876"
      }
    }
  }
}
```

Restart your IDE/client, ensure Blender's server is running, and start chatting!

### Option B — Studio Web App (`chat_app/`)

A dedicated web UI with scene outliner, live viewport previews, asset library browser, human approval cards, and `.blend` undo snapshots.

```bash
cd chat_app
cp .env.example .env        # Add optional API keys for cloud providers
uv run --extra chat chainlit run app.py -w
```

Open `http://localhost:8000` in your browser. Supported providers:
- **Local:** LM Studio, Ollama, llama.cpp
- **Cloud:** Anthropic Claude, OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI

### Option C — Desktop Studio (`desktop_app/`)

A native desktop application built with **Tauri 2 + React 19** communicating directly with Blender over framed TCP sockets:

```bash
cd desktop_app
pnpm install
pnpm tauri dev              # Launches native desktop window
```

*(To run web-only preview mode: `pnpm dev`)*

### Option D — Standalone Terminal REPL

Talk directly to a local Ollama model from the command line:

```bash
uv run python -m blend_ai.ollama_chat
```

---

## Architecture & Communication

```
  ┌────────────────────────────────────────────────────────┐
  │                    Frontends / Clients                 │
  │  Antigravity IDE  │  Chainlit Web  │  Tauri Desktop    │
  └─────────┬─────────────────┬──────────────────┬─────────┘
            │ stdio (MCP)     │ Python Session   │ Tauri IPC (Rust)
            ▼                 ▼                  ▼
  ┌───────────────────┐               ┌────────────────────┐
  │ FastMCP Server    │               │ Direct TCP Client  │
  │ (src/blend_ai/)   │               │ (src-tauri/)       │
  └─────────┬─────────┘               └──────────┬─────────┘
            │                                    │
            └──────────────┬─────────────────────┘
                           │ 4-byte BE length prefix + JSON payload
                           ▼
  ┌────────────────────────────────────────────────────────┐
  │               Blender Extension (addon/)               │
  │  TCP Server (127.0.0.1:9876)                           │
  │  ├── Dispatcher Allowlist                              │
  │  ├── Render Guard (prevents crashes during renders)    │
  │  └── Main-Thread Queue (bpy.app.timers)                │
  │         │                                              │
  │         ▼                                              │
  │     23 bpy Handlers (modeling, materials, scene, ...)   │
  └────────────────────────┬───────────────────────────────┘
                           │
                           ▼
  ┌────────────────────────────────────────────────────────┐
  │                      Blender Core                      │
  │  Live bpy Scene / Cycles / Eevee / 3D Viewport         │
  └────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
Agent-Blend/
├── addon/                     # Zero-dependency Blender 4.2+ Extension
│   ├── blender_manifest.toml  # Extension manifest
│   ├── __init__.py            # Addon lifecycle & registration
│   ├── server.py              # Background TCP socket server
│   ├── dispatcher.py          # Strict command allowlist
│   ├── thread_safety.py       # Main-thread queue via bpy.app.timers
│   ├── render_guard.py        # Render state tracking & crash recovery
│   ├── ui_panel.py            # N-panel UI (port config & server toggle)
│   └── handlers/              # 23 bpy handler modules (170+ operations)
├── asset_library/             # ~90 curated 3D assets (glTF/GLB + metadata)
│   ├── bed/                   # Bed frames, mattresses
│   ├── seating/               # Sofas, armchairs, dining chairs
│   ├── table/                 # Coffee tables, desks, dining tables
│   ├── lighting/              # Lamps, ceiling fixtures
│   ├── storage/               # Shelves, cabinets, wardrobes
│   └── ...                    # 14 categories total
├── chat_app/                  # Studio Web App (Chainlit)
│   ├── app.py                 # Chainlit application entry point
│   ├── studio/                # Outliner, checkpoints, UI drawer
│   └── .chainlit/             # Chainlit theme & styling configuration
├── desktop_app/               # Desktop Studio App (Tauri 2 + React 19)
│   ├── src-tauri/             # Rust native core & framed TCP bridge
│   ├── src/components/        # Outliner, Viewport, Assets, Diagnostics tabs
│   └── package.json           # Vite + React 19 dependencies
├── docs/                      # Architectural documentation & assets
│   ├── BLENDER_MCP.md         # Comprehensive MCP specification
│   └── Blender-mcp-architecture.png
├── scripts/                   # Utility scripts
│   └── start_with_server.py   # Headless Blender startup helper
├── src/blend_ai/              # FastMCP Server & Core Logic
│   ├── server.py              # FastMCP server entry point
│   ├── connection.py          # Resilient TCP socket client with retry
│   ├── tool_registry.py       # Dynamic tool registration & filtering
│   ├── validators.py          # Input sanitation & security boundaries
│   ├── asset_catalog.py       # Asset search & metadata indexing
│   ├── providers.py           # Multi-provider LLM abstractions
│   ├── ollama_chat.py         # Standalone CLI REPL loop
│   ├── tools/                 # 25 tool modules exposed over MCP
│   ├── prompts/               # 13 expert prompts & workflows
│   └── resources/             # Scene state & asset MCP resources
├── tests/                     # Automated test suite (1,250+ tests)
├── pyproject.toml             # Python build config & optional dependencies
└── README.md                  # Project documentation
```

---

## Tool Domains (25 Modules)

| Module | Operations & Capabilities |
|--------|---------------------------|
| **Scene** | Scene info, units, frame range, multi-scene management, extension recommendations |
| **Objects** | Create primitives, duplicate, parent, join, origins, convert, auto-smooth |
| **Transforms** | Position, rotation (euler/quat), scale, apply transforms, snap to grid |
| **Modeling** | Modifiers, booleans, subdivide, extrude, bevel, loop cut, bridge edge loops |
| **Mesh Editing** | Inset, fill, grid fill, mark seam/sharp, normals, dissolve, knife project, spin, edge crease, index-based vertex/edge/face selection |
| **Bool Tool** | Auto union, difference, intersect, slice |
| **Mesh Quality** | Defect diagnostics (non-manifold edges, loose vertices, zero-area faces, duplicate vertices) |
| **Materials** | Principled BSDF creation, procedural shader node graphs, connection/disconnection |
| **Lighting** | Point/sun/spot/area lights, HDRIs, 3-point lighting rig presets, shadow settings |
| **Camera** | Create, aim, depth of field, sensor fit, focal length, active camera toggle |
| **Animation** | Keyframe insertion, interpolation, animation paths, timeline ranges |
| **Rendering** | Cycles/EEVEE engines, resolution, sample count, output formats, render execution |
| **Curves** | Bezier/NURBS/path, 3D text, handle types, cyclic toggle, subdivide, reverse |
| **Sculpting** | Brush types, dyntopo, remesh, multiresolution, symmetry |
| **UV Mapping** | Smart UV project, unwrap, projection types, island packing |
| **Physics** | Rigid bodies, cloth, fluid, particle systems (velocity, rendering, bake) |
| **Geometry Nodes** | Node trees, add/connect nodes, socket inputs |
| **Armatures** | Bone creation, constraints, automatic weights, pose bone control |
| **Annotations** | Viewport overlay layers and sketch strokes |
| **Collections** | Collection creation, object organization, visibility toggles |
| **File I/O** | Import/export (glTF, FBX, OBJ, USD, STL), scene save/open |
| **Asset Library** | Category search, asset metadata inspection, floor-snapped asset import |
| **Viewport** | Shading modes, viewport overlays, object framing |
| **Screenshot** | Fast OpenGL viewport capture & camera renders returned as base64 |
| **Code Exec** | AST-audited fallback Python execution in Blender |

---

## Testing & Quality Assurance

Agent-Blend maintains a test suite covering tools, addon handlers, validators, prompts, and installers:

```bash
# Run the complete test suite
uv run --extra dev pytest

# Run with test coverage
uv run --extra dev pytest --cov=blend_ai

# Lint and check formatting
ruff check src/ tests/
ruff format --check src/ tests/
```

---

## Security & Privacy

- **Localhost Bound** — The TCP server binds exclusively to `127.0.0.1`. No external network exposure.
- **Strict Allowlist** — Only explicitly registered commands can be executed by `dispatcher.py`.
- **AST Sandbox** — `execute_blender_code` strips dangerous builtins (`eval`, `exec`, `open`, `globals`) and blocks OS-level modules (`os`, `subprocess`, `sys`, `socket`, `shutil`, `ctypes`).
- **Input Sanitization** — Parameter validation prevents path traversal, bounds numeric values, and validates shader node types before commands reach Blender.
- **Zero Telemetry** — No analytics, tracking, or cloud phone-home mechanisms.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
