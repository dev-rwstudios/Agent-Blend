# Agent-Blend Desktop Studio

A native desktop companion app for **Agent-Blend**, built with **Tauri 2**, **React 19**, **TypeScript**, and **Vite**.

The desktop studio provides a graphical control center for driving Blender via AI: inspect live scene hierarchies, browse 3D assets, preview the viewport, take undo checkpoints, and converse with local or cloud LLMs.

---

## Features

- 🖥️ **Live Viewport Preview**: Capture OpenGL viewport screenshots or camera-framed renders on demand.
- 🌳 **Interactive Outliner**: View all scene objects, meshes, lights, and cameras; frame or focus any object with one click.
- 📦 **Asset Library Browser**: Explore ~90 production-ready 3D furniture and decor assets with category filters, dimensions, and floor snapping.
- ⏱️ **Checkpoints & Undo**: Take named scene snapshots saved as `.blend` checkpoints and restore past states.
- 💬 **AI Studio Chat**: Stream natural language instructions to local models (Ollama, LM Studio) or cloud providers (Anthropic, OpenAI, Gemini) with real-time tool execution.
- 🩺 **Diagnostics**: Real-time connection ping, port verification, and Blender health metrics.
- 🚀 **Blender Auto-Launcher**: Launch Blender directly with the blend-ai TCP server automatically started.

---

## Architecture

```
React 19 UI  ──(Tauri IPC)──>  Tauri Rust Core (src-tauri/src/lib.rs)
                                       │
                                (Framed TCP Socket)
                                       │
                                       ▼
                       Blender Extension (127.0.0.1:9876)
```

- **Rust Backend (`src-tauri/src/lib.rs`)**: Connects directly to Blender's TCP socket using length-prefixed binary framing (4-byte big-endian header + JSON). Avoids intermediate processes for low latency.
- **Frontend Services (`src/services/`)**:
  - `blender.ts`: Typed wrappers around Tauri IPC commands (`blender_send_command`, `blender_check_connection`, `blender_launch`).
  - `llm.ts`: Provider abstraction for streaming model responses and local intent parsing.

---

## Development Setup

### Prerequisites

1. **Node.js** (v18+) and **pnpm** (or npm)
2. **Rust & Cargo** (latest stable) — required for compiling the Tauri native shell
3. **Blender 4.2+** with the **blend-ai** addon enabled and server running

### Commands

```bash
# Install dependencies
pnpm install

# Run web development server (browser mode with mocked/IPC fallback)
pnpm dev

# Run full native desktop application with live reload
pnpm tauri dev

# Type check and build web production bundle
pnpm build

# Build standalone native installer / executable
pnpm tauri build
```

---

## Configuration

Settings (Blender host/port, LLM providers, and API keys) can be configured via the in-app **Settings Modal** (gear icon) or environment variables:
- `BLENDER_HOST`: Blender server address (default: `127.0.0.1`)
- `BLENDER_PORT`: Blender server port (default: `9876`)
- `BLENDER_PATH`: Custom path to the Blender executable
