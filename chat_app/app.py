"""Agent-Blend studio — the Chainlit chat app for driving Blender.

Wires Chainlit's handlers to BlenderChatSession (the same tool-calling loop
the blend-ai-chat terminal REPL uses) and adds the studio around it: a
provider/model picker covering local and hosted models, composer modes
(Build / Plan first / Ask), approval cards, a side panel with the live
viewport, scene objects, asset browser and per-turn undo checkpoints, and
local chat history.

Run from inside chat_app/ — Chainlit reads .chainlit/, public/ and .env
relative to the working directory:
    cd chat_app && uv run --extra chat chainlit run app.py -w

Requires Blender running with the blend-ai addon's server started (N-panel
-> blend-ai -> Start Server).
"""


import base64
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio.persistence import DATA_DIR, SQLiteDataLayer, ensure_auth_secret, ensure_database  # noqa: E402

HISTORY_ENABLED = os.environ.get("AGENT_BLEND_HISTORY", "1") != "0"
if HISTORY_ENABLED:
    # Must happen before Chainlit validates its auth config at startup.
    ensure_auth_secret()

import chainlit as cl  # noqa: E402
from chainlit.input_widget import NumberInput, Select, Switch, TextInput  # noqa: E402

from blend_ai.connection import BlenderConnection, BlenderConnectionError  # noqa: E402
from blend_ai.ollama_chat import (  # noqa: E402
    ApprovalDecision,
    BlenderChatSession,
    ContextOverflowError,
    is_read_only_tool,
    parse_tools_command,
)
from blend_ai.providers import (  # noqa: E402
    DEFAULT_PROVIDER,
    PROVIDERS,
    list_models,
    make_backend,
    pick_default_model,
)
from studio import blender_ops  # noqa: E402
from studio.checkpoints import CheckpointStore  # noqa: E402
from studio.ui import (  # noqa: E402
    ASK_INSTRUCTION,
    COMMANDS,
    MODULE_ICONS,
    PLAN_INSTRUCTION,
    build_modes,
    module_label,
    pretty_tool_name,
    short_args,
    starter_categories,
)

# Same BLENDER_HOST/BLENDER_PORT env vars the MCP server reads.
DEFAULT_BLENDER_HOST = os.environ.get("BLENDER_HOST", BlenderConnection.DEFAULT_HOST)
DEFAULT_BLENDER_PORT = int(os.environ.get("BLENDER_PORT", str(BlenderConnection.DEFAULT_PORT)))
PREFS_PATH = DATA_DIR / "prefs.json"


# ---- per-chat state ------------------------------------------------------

@dataclass
class Studio:
    provider: str = DEFAULT_PROVIDER
    urls: dict[str, str] = field(default_factory=dict)       # provider -> server URL
    chosen_models: dict[str, str] = field(default_factory=dict)  # provider -> last model
    models: list[str] = field(default_factory=list)
    model_error: str = ""
    blender_host: str = DEFAULT_BLENDER_HOST
    blender_port: int = DEFAULT_BLENDER_PORT
    toolset: str = "full"
    approvals: bool = True
    checkpoints_on: bool = True
    auto_viewport: bool = True

    # Runtime only — never persisted (API keys stay in memory).
    api_keys: dict[str, str] = field(default_factory=dict)
    session: BlenderChatSession | None = None
    blender_ok: bool = False
    blender_error: str = ""
    focus: str | None = None
    approve_all_turn: bool = False
    turn_running: bool = False
    viewport: dict[str, Any] = field(default_factory=dict)
    scene: dict[str, Any] | None = None
    assets: list[dict[str, Any]] = field(default_factory=list)
    checkpoints: CheckpointStore | None = None
    panel: cl.CustomElement | None = None
    # True once the thread has a real name — Chainlit names a thread after
    # whatever started it, which for a panel click is the action's id.
    thread_named: bool = False

    @property
    def model(self) -> str | None:
        return self.chosen_models.get(self.provider)

    @property
    def url(self) -> str:
        return self.urls.get(self.provider, "")

    @property
    def api_key(self) -> str:
        return self.api_keys.get(self.provider, "")

    def prefs(self) -> dict[str, Any]:
        return {
            "provider": self.provider, "urls": self.urls, "chosen_models": self.chosen_models,
            "blender_host": self.blender_host, "blender_port": self.blender_port,
            "toolset": self.toolset, "approvals": self.approvals,
            "checkpoints_on": self.checkpoints_on, "auto_viewport": self.auto_viewport,
        }


def load_studio() -> Studio:
    st = Studio()
    try:
        prefs = json.loads(PREFS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        prefs = {}
    for key, value in prefs.items():
        if hasattr(st, key) and key in st.prefs():
            setattr(st, key, value)
    if not prefs:
        # First run: start on a hosted provider whose key is already in the
        # environment, if any — otherwise the local LM Studio default.
        for spec in PROVIDERS.values():
            if spec.requires_key or spec.kind == "anthropic":
                if spec.key_env and os.environ.get(spec.key_env):
                    st.provider = spec.id
                    break
    if st.provider not in PROVIDERS:
        st.provider = DEFAULT_PROVIDER
    return st


def save_prefs(st: Studio) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PREFS_PATH.write_text(json.dumps(st.prefs(), indent=2))


def studio() -> Studio:
    st = cl.user_session.get("studio")
    if st is None:
        st = load_studio()
        cl.user_session.set("studio", st)
    return st


async def toast(message: str, kind: str = "info") -> None:
    await cl.context.emitter.send_toast(message, kind)


# ---- auth + history --------------------------------------------------------

if HISTORY_ENABLED:
    @cl.data_layer
    def get_data_layer():
        return SQLiteDataLayer(conninfo=ensure_database())

    @cl.header_auth_callback
    async def local_user(headers) -> cl.User:
        # Single-user local app: everyone who can reach this port is the
        # owner. Put real auth in front of it before exposing it anywhere.
        return cl.User(identifier="local", metadata={"role": "owner", "provider": "local"})


# ---- settings panel --------------------------------------------------------

def settings_widgets(st: Studio) -> list:
    spec = PROVIDERS[st.provider]
    provider_note = spec.description
    if st.model_error:
        provider_note = f"⚠ {st.model_error}"
    widgets: list = [
        Select(
            id="provider", label="Provider", initial_value=st.provider,
            items={p.label: p.id for p in PROVIDERS.values()},
            description=provider_note,
        ),
    ]
    if spec.editable_url:
        widgets.append(TextInput(
            id="server_url", label="Server URL", initial=st.url or spec.base_url,
            description="A bare host:port is fine — /v1 is added automatically for OpenAI-compatible servers.",
        ))
    if spec.key_env:
        env_set = bool(os.environ.get(spec.key_env))
        if st.api_key:
            key_note = "✓ Key set for this chat (kept in memory only, never saved to history)."
        elif env_set:
            key_note = f"✓ Using {spec.key_env} from the environment. Paste a key here to override it."
        else:
            key_note = f"Paste a key, or set {spec.key_env} in chat_app/.env (recommended)."
        widgets.append(TextInput(
            id="api_key", label=f"{spec.label} API key", initial="",
            placeholder="Paste key…" if not st.api_key else "•••••••• (set)", description=key_note,
        ))
    if st.models:
        widgets.append(Select(
            id="model", label="Model", initial_value=st.model or st.models[0],
            items={m: m for m in st.models},
            description="You can also switch models from the picker in the message box.",
        ))
    tool_total = sum(len(t) for t in (st.session.tools_by_module.values() if st.session else [])) or None
    widgets += [
        Select(
            id="toolset", label="Toolset", initial_value=st.toolset,
            items={
                "Full — every tool" + (f" ({tool_total})" if tool_total and st.toolset == "full" else ""): "full",
                "Core — ~80 everyday tools (best for small local models)": "core",
            },
        ),
        Switch(
            id="approvals", label="Ask before scene changes", initial=st.approvals,
            description="Read-only lookups never ask. You can also approve everything for a single turn.",
        ),
        Switch(
            id="checkpoints_on", label="Checkpoint after each turn", initial=st.checkpoints_on,
            description="Saves a copy of the scene after every turn that changed it, so you can undo.",
        ),
        Switch(
            id="auto_viewport", label="Refresh viewport preview after each turn", initial=st.auto_viewport,
        ),
        TextInput(id="blender_host", label="Blender host", initial=st.blender_host),
        NumberInput(id="blender_port", label="Blender port", initial=float(st.blender_port)),
    ]
    return widgets


async def refresh_models(st: Studio) -> None:
    st.models, st.model_error = await cl.make_async(list_models)(st.provider, st.url, st.api_key)
    if st.models:
        chosen = pick_default_model(st.provider, st.models, st.model)
        if chosen:
            st.chosen_models[st.provider] = chosen


async def send_settings(st: Studio) -> None:
    await cl.ChatSettings(settings_widgets(st)).send()
    await cl.context.emitter.set_modes(build_modes(st.models, st.model))


# ---- side panel ------------------------------------------------------------

def panel_props(st: Studio) -> dict[str, Any]:
    s = st.session
    spec = PROVIDERS[st.provider]
    modules = []
    if s:
        modules = [
            {"name": m, "label": module_label(m), "tools": [t["function"]["name"] for t in ts]}
            for m, ts in sorted(s.tools_by_module.items())
        ]
    return {
        "status": {
            "connected": st.blender_ok,
            "ready": s is not None,
            "host": st.blender_host, "port": st.blender_port,
            "provider": spec.label, "model": s.chat_model if s else st.model,
            "toolCount": len(s.tools) if s else 0, "toolset": st.toolset,
            "approvals": st.approvals, "checkpoints": st.checkpoints_on,
            "error": st.blender_error or st.model_error,
        },
        "usage": {
            "turnIn": s.turn_usage.get("input", 0) if s else 0,
            "turnOut": s.turn_usage.get("output", 0) if s else 0,
            "totalIn": s.total_usage.get("input", 0) if s else 0,
            "totalOut": s.total_usage.get("output", 0) if s else 0,
        },
        "viewport": st.viewport,
        "scene": st.scene,
        "focus": st.focus,
        "assets": st.assets,
        "checkpoints": st.checkpoints.as_props() if st.checkpoints else [],
        "modules": modules,
    }


async def render_panel(st: Studio) -> None:
    if st.panel is None:
        st.panel = cl.CustomElement(name="Studio", props=panel_props(st), display="side")
        await cl.ElementSidebar.set_elements([st.panel])
        await cl.ElementSidebar.set_title("Studio")
    else:
        st.panel.props = panel_props(st)
        await st.panel.update()
        await cl.ElementSidebar.set_title("Studio")


async def name_thread(st: Studio, name: str) -> None:
    """Give the thread a readable name in the history sidebar."""
    if st.thread_named or not HISTORY_ENABLED:
        return
    from chainlit.data import get_data_layer as current_data_layer
    layer = current_data_layer()
    if layer is None:
        return
    await layer.update_thread(cl.context.session.thread_id, name=name[:60])
    st.thread_named = True


async def refresh_scene_state(st: Studio, viewport: bool = True) -> None:
    if st.session is None:
        return
    try:
        st.scene = await cl.make_async(blender_ops.scene_summary)()
    except blender_ops.BlenderOpError:
        st.scene = None
    if viewport:
        image = await cl.make_async(blender_ops.capture_viewport)()
        if image:
            st.viewport = {"image": image, "updated": time.time()}


# ---- connecting ------------------------------------------------------------

def _carry_history(old: BlenderChatSession | None, new: BlenderChatSession) -> None:
    """Keep the conversation (text only) when the provider/model/toolset
    changes mid-chat, so switching doesn't wipe the context."""
    if old is None:
        return
    for m in old.messages[1:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            new.messages.append({"role": m["role"], "content": m["content"]})


def _probe_blender(host: str, port: int) -> tuple[bool, str]:
    """Connect-only reachability check (never send_command, whose busy
    retry can block for minutes while Blender renders)."""
    try:
        conn = BlenderConnection(host=host, port=port)
        conn.connect()
        conn.disconnect()
        return True, ""
    except (BlenderConnectionError, OSError) as e:
        return False, str(e)


def _blender_help(st: Studio, detail: str) -> str:
    return (
        f"Can't reach Blender at {st.blender_host}:{st.blender_port} — open Blender and click "
        f"Start Server in the N-panel's blend-ai tab. ({detail})"
    )


async def connect(st: Studio, announce: bool = False) -> bool:
    """(Re)build the chat session for the current settings. Returns True
    when connected. Failures are shown in the panel and as a toast."""
    old = st.session
    if st.model is None:
        # No model to talk to yet — still report whether Blender is up.
        st.session = None
        st.blender_ok, detail = await cl.make_async(_probe_blender)(st.blender_host, st.blender_port)
        st.blender_error = "" if st.blender_ok else _blender_help(st, detail)
        await render_panel(st)
        return False
    try:
        backend = make_backend(st.provider, st.model, st.url, st.api_key)
    except RuntimeError as e:
        st.model_error = str(e)
        await toast(str(e), "error")
        await render_panel(st)
        return False

    session = BlenderChatSession(
        chat_model=st.model, host=st.blender_host, port=st.blender_port, backend=backend,
    )
    session.toolset = st.toolset
    session.require_approval = st.approvals
    session.on_tool_call = lambda name, args, result: cl.run_sync(report_tool_call(name, args, result))
    session.on_assistant_text = lambda text: cl.run_sync(report_assistant_text(text))
    session.on_approval_request = lambda calls: cl.run_sync(ask_approval(calls))
    try:
        await cl.make_async(session.initialize)()
    except (BlenderConnectionError, OSError) as e:
        st.session = None
        st.blender_ok = False
        st.blender_error = _blender_help(st, str(e))
        await toast("Blender isn't reachable — start the blend-ai server in Blender.", "error")
        await render_panel(st)
        return False

    if old is not None and old is not session:
        _carry_history(old, session)
        session.total_usage = dict(old.total_usage)
    st.session = session
    st.blender_ok = True
    st.blender_error = ""
    if st.checkpoints is None:
        st.checkpoints = CheckpointStore(cl.context.session.thread_id)
    if not st.assets:
        st.assets = await cl.make_async(blender_ops.list_assets)()
    await refresh_scene_state(st)
    await render_panel(st)
    if announce:
        await toast(f"Connected · {st.model}", "success")
    return True


async def ensure_connected(st: Studio) -> bool:
    if st.session is not None:
        return True
    if st.model is None:
        await refresh_models(st)
        await send_settings(st)
    return await connect(st)


# ---- lifecycle -------------------------------------------------------------

@cl.set_starter_categories
async def starters(user: cl.User | None = None, language: str | None = None):
    return starter_categories()


@cl.on_chat_start
async def on_chat_start() -> None:
    st = studio()
    await cl.context.emitter.set_commands(COMMANDS)
    await refresh_models(st)
    await send_settings(st)
    # No welcome message on purpose: an empty thread is what shows the
    # starter cards. Connection problems surface in the panel and a toast.
    await connect(st)


@cl.on_chat_resume
async def on_chat_resume(thread: dict) -> None:
    st = studio()
    await cl.context.emitter.set_commands(COMMANDS)
    await refresh_models(st)
    await send_settings(st)
    if await connect(st) and st.session is not None:
        # Replay the visible conversation as context for the model.
        for step in thread.get("steps", []):
            if step.get("parentId"):
                continue
            if step.get("type") == "user_message" and step.get("output"):
                st.session.messages.append({"role": "user", "content": step["output"]})
            elif step.get("type") == "assistant_message" and step.get("output"):
                st.session.messages.append({"role": "assistant", "content": step["output"]})


@cl.on_settings_edit
async def on_settings_edit(settings: dict) -> None:
    """Fires live per field change. Only used to re-shape the panel the
    moment the provider changes (URL vs API-key fields, its model list) —
    connecting still waits for Confirm."""
    st = studio()
    provider = settings.get("provider")
    if not provider or provider == cl.user_session.get("edit_provider", st.provider) or provider not in PROVIDERS:
        return
    cl.user_session.set("edit_provider", provider)
    preview = Studio(**{**st.prefs(), "provider": provider})
    preview.api_keys = st.api_keys
    preview.session = st.session
    await refresh_models(preview)
    await cl.ChatSettings(settings_widgets(preview)).send()


@cl.on_settings_update
async def on_settings_update(settings: dict) -> None:
    st = studio()
    before = (st.provider, st.model, st.url, st.api_key, st.blender_host, st.blender_port, st.toolset)

    provider = settings.get("provider") or st.provider
    old_provider = st.provider
    provider_changed = provider != old_provider
    st.provider = provider if provider in PROVIDERS else DEFAULT_PROVIDER
    cl.user_session.set("edit_provider", st.provider)
    spec = PROVIDERS[st.provider]
    # on_settings_edit re-renders the form the moment the provider changes,
    # so what's submitted belongs to the new provider — switching provider
    # and typing its URL/key in one go is the normal flow. The one thing to
    # skip is a URL left over from the previous provider's form.
    url = (settings.get("server_url") or "").strip()
    if spec.editable_url and url:
        old_spec = PROVIDERS.get(old_provider)
        stale = provider_changed and old_spec is not None and url in (
            st.urls.get(old_provider, ""), old_spec.base_url,
        )
        if not stale:
            st.urls[st.provider] = url
    key = (settings.get("api_key") or "").strip()
    if key:
        st.api_keys[st.provider] = key
        # Keep the key out of the chat settings Chainlit persists to history.
        cl.context.session.chat_settings["api_key"] = ""

    st.toolset = settings.get("toolset") or st.toolset
    st.approvals = bool(settings.get("approvals", st.approvals))
    st.checkpoints_on = bool(settings.get("checkpoints_on", st.checkpoints_on))
    st.auto_viewport = bool(settings.get("auto_viewport", st.auto_viewport))
    st.blender_host = (settings.get("blender_host") or DEFAULT_BLENDER_HOST).strip()
    try:
        port = int(settings.get("blender_port") or DEFAULT_BLENDER_PORT)
        if not 1024 <= port <= 65535:
            raise ValueError
        st.blender_port = port
    except (TypeError, ValueError):
        await toast("Blender port must be a number between 1024 and 65535.", "error")

    await refresh_models(st)
    if settings.get("model") in st.models:
        st.chosen_models[st.provider] = settings["model"]
    save_prefs(st)
    await send_settings(st)

    if st.session is not None:
        st.session.require_approval = st.approvals
    after = (st.provider, st.model, st.url, st.api_key, st.blender_host, st.blender_port, st.toolset)
    if after != before or st.session is None:
        if await connect(st, announce=True):
            await cl.context.emitter.set_modes(build_modes(st.models, st.model))
    else:
        await render_panel(st)


@cl.on_stop
async def on_stop() -> None:
    st = studio()
    if st.session is not None:
        st.session.cancel_requested = True


@cl.on_chat_end
def on_chat_end() -> None:
    st: Studio | None = cl.user_session.get("studio")
    if st is not None and st.session is not None:
        st.session.close()


# ---- session hooks (run on the chat worker thread via cl.run_sync) ---------

def _module_of(name: str) -> str:
    st = studio()
    if st.session:
        for module, tools in st.session.tools_by_module.items():
            if any(t["function"]["name"] == name for t in tools):
                return module
    return ""


async def report_tool_call(name: str, args: dict, result: str) -> None:
    st = studio()
    try:
        parsed = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        parsed = None

    elements: list = []
    shown = parsed
    if isinstance(parsed, dict):
        image = parsed.get("image")
        if isinstance(image, str) and len(image) > 200:
            # A screenshot: show the picture, not 500 KB of base64.
            shown = {k: v for k, v in parsed.items() if k != "image"}
            elements.append(cl.Image(name="viewport", content=base64.b64decode(image), display="inline", size="large"))
            st.viewport = {"image": f"data:image/png;base64,{image}", "updated": time.time()}
        result_data = parsed.get("result") if isinstance(parsed.get("result"), dict) else parsed
        path = result_data.get("filepath") if isinstance(result_data, dict) else None
        if name == "render_image" and path and Path(path).exists():
            elements.append(cl.Image(name=Path(path).name, path=path, display="inline", size="large"))

    is_error = isinstance(parsed, dict) and parsed.get("status") == "error"
    output = json.dumps(shown, indent=2) if shown is not None else result
    if len(output) > 1200:
        output = output[:1200] + "\n…(truncated)"

    async with cl.Step(
        name=pretty_tool_name(name), type="tool", language="json",
        icon=MODULE_ICONS.get(_module_of(name), "wrench"),
    ) as step:
        step.input = args
        step.output = output
        step.is_error = is_error
        step.elements = elements
    if elements and any(getattr(e, "name", "") == "viewport" for e in elements):
        await render_panel(st)


async def report_assistant_text(text: str) -> None:
    await cl.Message(content=text).send()


async def ask_approval(tool_calls: list[dict]) -> ApprovalDecision:
    st = studio()
    if st.approve_all_turn:
        return ApprovalDecision(True)
    calls = [
        {
            "label": pretty_tool_name(tc["name"]),
            "args": tc.get("arguments", {}),
            "summary": short_args(tc.get("arguments", {})),
            "readOnly": is_read_only_tool(tc["name"]),
        }
        for tc in tool_calls
    ]
    ask = cl.AskElementMessage(
        content="",
        element=cl.CustomElement(name="ApprovalCard", props={"calls": calls}, display="inline"),
        timeout=600,
    )
    res = await ask.send()
    names = ", ".join(c["label"] for c in calls)
    if not res or not res.get("submitted"):
        ask.content = f"⏱ No answer — skipped: {names}"
        await ask.update()
        return ApprovalDecision(False, feedback="(no response — action skipped)")
    decision = res.get("decision")
    feedback = (res.get("feedback") or "").strip()
    if decision in ("approve", "approve_all"):
        if decision == "approve_all":
            st.approve_all_turn = True
        ask.content = f"✓ Approved{' (and the rest of this turn)' if decision == 'approve_all' else ''}: {names}"
        await ask.update()
        return ApprovalDecision(True)
    if decision == "suggest":
        ask.content = f"✎ Suggested instead of {names}: “{feedback}”"
        await ask.update()
        return ApprovalDecision(False, feedback=feedback or "(no suggestion given)")
    ask.content = f"✕ Rejected: {names}"
    await ask.update()
    return ApprovalDecision(False)


# ---- turns -----------------------------------------------------------------

def extract_images(elements: list) -> list[dict]:
    """Base64-encode image attachments on an incoming message."""
    images = []
    for el in elements or []:
        mime = getattr(el, "mime", "") or ""
        if getattr(el, "type", None) != "image" and not mime.startswith("image/"):
            continue
        data = getattr(el, "content", None)
        if data is None and getattr(el, "path", None):
            try:
                data = Path(el.path).read_bytes()
            except OSError:
                continue
        if data is None:
            continue
        if isinstance(data, str):
            data = data.encode("utf-8")
        images.append({"mime": mime or "image/png", "data": base64.b64encode(data).decode("ascii")})
    return images


async def run_turn(st: Studio, text: str, images: list[dict] | None = None,
                   approach: str = "build", label: str = "") -> None:
    session = st.session
    assert session is not None
    if st.turn_running:
        await toast("Still finishing the previous request — one moment.", "warning")
        return

    original = (text, st.focus)
    history_len = len(session.messages)
    if st.focus:
        text += f"\n\n(The user is referring to the Blender object named '{st.focus}'.)"
        st.focus = None
    if approach == "plan":
        session.read_only_reason = "this is plan mode — propose the plan and wait for approval."
        text = f"{PLAN_INSTRUCTION}\n\n{text}"
    elif approach == "ask":
        session.read_only_reason = "Ask mode is read-only."
        text = f"{ASK_INSTRUCTION}\n\n{text}"
    else:
        session.read_only_reason = None

    if approach == "build" and st.checkpoints_on and st.checkpoints is not None and not st.checkpoints.items:
        try:
            await cl.make_async(st.checkpoints.create)("Start of chat")
        except blender_ops.BlenderOpError as e:
            await toast(f"Couldn't save a checkpoint: {e}", "warning")

    before_turn = st.checkpoints.current_id if st.checkpoints is not None else None
    st.approve_all_turn = False
    st.turn_running = True

    def work() -> str:
        try:
            return session.chat(text, images or None)
        finally:
            st.turn_running = False

    try:
        async with cl.Step(name="Blender tools", type="run", icon="sparkles"):
            response = await cl.make_async(work)()
    except ContextOverflowError as e:
        session.read_only_reason = None
        # Drop this turn's half-finished messages so a retry doesn't repeat them.
        del session.messages[history_len:]
        if st.toolset == "full":
            st.toolset = "core"
            save_prefs(st)
            await cl.Message(content=(
                "The full toolset (170+ tool definitions) doesn't fit this model's context window, "
                "so I've switched to the **Core** toolset (~80 tools) and I'm retrying. "
                "You can change this under **Toolset** in chat settings."
            )).send()
            if await connect(st):
                await send_settings(st)
                text, st.focus = original
                await run_turn(st, text, images, approach, label)
            return
        await cl.Message(content=(
            f"**This conversation no longer fits the model's context window.**\n\n{e}\n\n"
            "Start a new chat (the pencil icon at the top left), or load the model with a larger "
            "context length in LM Studio / Ollama."
        )).send()
        await render_panel(st)
        return
    except Exception as e:  # noqa: BLE001 — any backend failure is shown to the user
        session.read_only_reason = None
        await cl.Message(content=(
            f"**Something went wrong talking to the model.**\n\n{e}\n\n"
            "If the model doesn't support tool calling, pick another one from the model picker "
            "in the message box or in chat settings."
        )).send()
        await render_panel(st)
        return
    session.read_only_reason = None

    elements = []
    if session.last_scene_agent_render:
        elements.append(cl.Image(
            name="scene_render", content=base64.b64decode(session.last_scene_agent_render),
            display="inline", size="large",
        ))
        session.last_scene_agent_render = None

    # Save the checkpoint first so the reply can offer an undo for it.
    if session.turn_mutations and st.checkpoints_on and st.checkpoints is not None:
        try:
            await cl.make_async(st.checkpoints.create)(label or text.split("\n")[0])
        except blender_ops.BlenderOpError as e:
            await toast(f"Couldn't save a checkpoint: {e}", "warning")

    actions = []
    if approach == "plan":
        actions = [
            cl.Action(name="run_plan", payload={}, label="Run this plan", icon="play"),
            cl.Action(name="revise_plan", payload={}, label="Revise", icon="pencil"),
        ]
    elif session.turn_mutations and before_turn:
        actions = [cl.Action(
            name="undo_turn", payload={"id": before_turn}, label="Undo", icon="undo-2",
            tooltip="Restore the scene to how it was before this turn",
        )]
    await cl.Message(content=response or "(no response)", elements=elements, actions=actions).send()
    if approach == "plan":
        cl.user_session.set("plan_actions", actions)

    if session.last_scene_agent_trace:
        trace_lines = [
            f"{i}. **{pretty_tool_name(t['tool'])}** — `{short_args(t['args']) or 'no arguments'}`\n   → {t['result_preview']}"
            for i, t in enumerate(session.last_scene_agent_trace, 1)
        ]
        await cl.Message(content=(
            f"<details><summary>Scene sub-agent — {len(session.last_scene_agent_trace)} step(s)</summary>\n\n"
            + "\n".join(trace_lines) + "\n\n</details>"
        )).send()
        session.last_scene_agent_trace = []

    if session.turn_mutations:
        await refresh_scene_state(st, viewport=st.auto_viewport)
    await render_panel(st)


@cl.on_message
async def on_message(message: cl.Message) -> None:
    st = studio()

    if message.command:
        await run_command(st, message.command)
        return
    tools_query = parse_tools_command(message.content)
    if tools_query is not None:
        if await ensure_connected(st):
            await cl.Message(content=st.session.list_tools(tools_query)).send()
        return

    if not await ensure_connected(st):
        await cl.Message(content=(
            "**Not connected yet.** " + (st.blender_error or st.model_error or
            "Pick a provider and model in chat settings (the gear icon in the message box).")
        )).send()
        return

    if cl.user_session.get("action_started_thread"):
        await name_thread(st, message.content.split("\n")[0] or "Untitled scene")
    st.thread_named = True

    modes = message.modes or {}
    wanted_model = modes.get("model")
    if wanted_model and wanted_model != st.session.chat_model and wanted_model in st.models:
        await switch_model(st, wanted_model)

    await run_turn(
        st, message.content, extract_images(message.elements),
        approach=modes.get("approach", "build"), label=message.content.split("\n")[0],
    )


async def switch_model(st: Studio, model: str) -> None:
    """Swap the model in place, keeping the conversation."""
    session = st.session
    assert session is not None
    try:
        session.backend = make_backend(st.provider, model, st.url, st.api_key)
    except RuntimeError as e:
        await toast(str(e), "error")
        return
    session.chat_model = model
    if PROVIDERS[st.provider].kind == "gemini":
        # Gemini keeps conversation state server-side per interaction chain,
        # which a new backend can't continue — start its context fresh.
        session.messages = session.messages[:1]
        await toast("Switched model — Gemini starts a fresh context.", "info")
    st.chosen_models[st.provider] = model
    save_prefs(st)
    await send_settings(st)


# ---- commands --------------------------------------------------------------

def _thread_dir(kind: str) -> Path:
    return DATA_DIR / kind / cl.context.session.thread_id


async def run_command(st: Studio, command: str) -> None:
    if command == "Tools":
        if await ensure_connected(st):
            await cl.Message(content=st.session.list_tools("")).send()
        return
    if not await ensure_connected(st):
        await toast("Connect to Blender first.", "error")
        return

    if command == "Screenshot":
        image = await cl.make_async(blender_ops.capture_viewport)(1280)
        if image is None:
            await toast("Couldn't capture the viewport.", "error")
            return
        st.viewport = {"image": image, "updated": time.time()}
        data = base64.b64decode(image.split(",", 1)[1])
        await cl.Message(content="Viewport", elements=[cl.Image(name="viewport", content=data, display="inline", size="large")]).send()
        await render_panel(st)

    elif command == "Render":
        path = _thread_dir("renders") / f"render_{int(time.time())}.png"
        async with cl.Step(name="Rendering", type="tool", icon="clapperboard"):
            try:
                await cl.make_async(blender_ops.render_to)(path)
            except blender_ops.BlenderOpError as e:
                await toast(f"Render failed: {e}", "error")
                return
        await cl.Message(content="Render", elements=[cl.Image(name=path.name, path=str(path), display="inline", size="large")]).send()

    elif command == "Undo":
        target = st.checkpoints.previous() if st.checkpoints else None
        if target is None:
            await toast("Nothing to undo yet.", "info")
            return
        await restore_checkpoint(st, target.id)

    elif command == "Export":
        res = await cl.AskActionMessage(
            content="Export the scene as:",
            actions=[cl.Action(name="export", payload={"fmt": f}, label=label) for f, label in blender_ops.EXPORT_FORMATS.items()],
            timeout=120, raise_on_timeout=False,
        ).send()
        if not res:
            return
        fmt = res["payload"]["fmt"]
        path = _thread_dir("exports") / f"scene_{time.strftime('%Y%m%d_%H%M%S')}.{fmt}"
        try:
            await cl.make_async(blender_ops.export_to)(path, fmt)
        except blender_ops.BlenderOpError as e:
            await toast(f"Export failed: {e}", "error")
            return
        await cl.Message(content=f"Exported **{path.name}**", elements=[cl.File(name=path.name, path=str(path), display="inline")]).send()


async def restore_checkpoint(st: Studio, cp_id: str) -> None:
    if st.checkpoints is None:
        return
    try:
        target = await cl.make_async(st.checkpoints.restore)(cp_id)
    except (blender_ops.BlenderOpError, OSError) as e:
        await toast(f"Restore failed: {e}", "error")
        return
    await refresh_scene_state(st)
    await render_panel(st)
    await cl.Message(content=(
        f"↺ Restored the scene to **{target.label}**. Blender now has a working copy of that "
        "checkpoint open — use File › Save As to keep it in your project."
    )).send()
    if st.session is not None:
        st.session.messages.append({
            "role": "user",
            "content": f"(The user restored the Blender scene to an earlier checkpoint: '{target.label}'. "
                       "Re-check the scene before relying on earlier observations.)",
        })


# ---- panel + message actions ----------------------------------------------

def _mark_action_started() -> None:
    # A panel click can be the first interaction in a thread; Chainlit then
    # names the thread after the action id ("add_asset"). The first real
    # message renames it (see on_message).
    if not studio().thread_named:
        cl.user_session.set("action_started_thread", True)


@cl.action_callback("refresh_viewport")
async def on_refresh_viewport(action: cl.Action):
    _mark_action_started()
    st = studio()
    image = await cl.make_async(blender_ops.capture_viewport)()
    if image:
        st.viewport = {"image": image, "updated": time.time()}
    else:
        await toast("Couldn't capture the viewport.", "error")
    await render_panel(st)


@cl.action_callback("refresh_scene")
async def on_refresh_scene(action: cl.Action):
    _mark_action_started()
    st = studio()
    await refresh_scene_state(st, viewport=False)
    await render_panel(st)


@cl.action_callback("focus_object")
async def on_focus_object(action: cl.Action):
    _mark_action_started()
    try:
        await cl.make_async(blender_ops.focus_object)(action.payload.get("name", ""))
    except blender_ops.BlenderOpError as e:
        await toast(str(e), "error")


@cl.action_callback("reference_object")
async def on_reference_object(action: cl.Action):
    _mark_action_started()
    st = studio()
    st.focus = action.payload.get("name") or None
    await render_panel(st)
    if st.focus:
        await toast(f"Your next message will refer to “{st.focus}”.", "info")


@cl.action_callback("add_asset")
async def on_add_asset(action: cl.Action):
    _mark_action_started()
    st = studio()
    asset_id = action.payload.get("id", "")
    try:
        result = await cl.make_async(blender_ops.import_asset)(asset_id)
    except blender_ops.BlenderOpError as e:
        await toast(f"Couldn't add asset: {e}", "error")
        return
    name = result.get("name") or result.get("anchor") or asset_id
    await toast(f"Added {name} to the scene.", "success")
    if st.session is not None:
        st.session.messages.append({
            "role": "user",
            "content": f"(The user added the library asset '{asset_id}' to the scene; it is named '{name}'.)",
        })
    if st.checkpoints_on and st.checkpoints is not None:
        await cl.make_async(st.checkpoints.create)(f"Added {name}")
    await refresh_scene_state(st)
    await render_panel(st)


@cl.action_callback("create_checkpoint")
async def on_create_checkpoint(action: cl.Action):
    _mark_action_started()
    st = studio()
    if st.checkpoints is None:
        return
    try:
        await cl.make_async(st.checkpoints.create)(f"Manual checkpoint · {time.strftime('%H:%M')}")
    except blender_ops.BlenderOpError as e:
        await toast(f"Couldn't save a checkpoint: {e}", "error")
    await render_panel(st)


@cl.action_callback("restore_checkpoint")
async def on_restore_checkpoint(action: cl.Action):
    _mark_action_started()
    await restore_checkpoint(studio(), action.payload.get("id", ""))


@cl.action_callback("undo_turn")
async def on_undo_turn(action: cl.Action):
    await action.remove()
    await restore_checkpoint(studio(), action.payload.get("id", ""))


@cl.action_callback("undo_last")
async def on_undo_last(action: cl.Action):
    _mark_action_started()
    st = studio()
    target = st.checkpoints.previous() if st.checkpoints else None
    if target is None:
        await toast("Nothing to undo yet.", "info")
        return
    await restore_checkpoint(st, target.id)


async def _clear_plan_actions() -> None:
    for plan_action in cl.user_session.get("plan_actions") or []:
        await plan_action.remove()
    cl.user_session.set("plan_actions", [])


@cl.action_callback("run_plan")
async def on_run_plan(action: cl.Action):
    st = studio()
    await _clear_plan_actions()
    if not await ensure_connected(st):
        return
    await cl.Message(content="▶ Running the approved plan.").send()
    # The plan itself was the approval, so don't ask again per step.
    st.session.require_approval = False
    try:
        await run_turn(st, "The plan above is approved. Execute it now, step by step.", label="Ran approved plan")
    finally:
        st.session.require_approval = st.approvals


@cl.action_callback("revise_plan")
async def on_revise_plan(action: cl.Action):
    await _clear_plan_actions()
    await cl.Message(content="What should change in the plan? Reply with Approach set to **Plan first** to get a revised plan.").send()
