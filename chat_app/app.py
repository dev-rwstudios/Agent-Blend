"""Chainlit chat shell for Agent-Blend.

Base scaffold: wires Chainlit's async message handlers directly to
BlenderChatSession (the same tool-calling loop the blend-ai-chat terminal
REPL uses), so the whole chain — Chainlit -> tool loop -> Blender TCP
connection -> model backend — is proven end to end before anything else
(the human-in-the-loop asset picker, hosted API-key providers, real
MCP-client connection) is layered on top.

Run with (from inside chat_app/ — Chainlit writes its config/welcome files
relative to the current working directory, and this repo's copy of both
already lives here, not at the repo root):
    cd chat_app && uv run --extra chat chainlit run app.py -w

Requires Blender running with the blend-ai addon's server started, and
either a local OpenAI-compatible server (LM Studio, llama.cpp's server,
vLLM, ...) or a Gemini API key. Provider, host, and model are all chosen
from chat settings (the settings/sliders icon in the message toolbar, near attach-file and history — not a top-right gear), populated from whatever
that server actually reports as loaded/available — nothing is hardcoded.
"""

import base64
import json
import os
import re

import chainlit as cl
from chainlit.input_widget import NumberInput, Select, Switch, TextInput

from blend_ai.connection import BlenderConnection, BlenderConnectionError
from blend_ai.ollama_chat import (
    DEFAULT_CHAT_MODEL,
    ApprovalDecision,
    BlenderChatSession,
    GeminiBackend,
    OpenAICompatBackend,
    parse_tools_command,
)
from blend_ai.tool_registry import get_tools_by_module

# For LM Studio this is a host URL; for Gemini the same settings-panel slot
# (see _host_widget/_models_for/_connect) instead holds the pasted API key,
# so its "provider default" here is just an empty string to reset to when
# switching providers. Ollama isn't offered — this deployment only talks to
# LM Studio (local) and Gemini (cloud).
PROVIDERS = {
    "LM Studio / OpenAI-compatible": "http://127.0.0.1:1234/v1",
    "Gemini": "",
}
DEFAULT_PROVIDER = "LM Studio / OpenAI-compatible"
# Fallback only — if the field in chat settings is left blank, an API key
# from the environment still works. Not required; pasting a key in the UI
# is the primary path now.
GEMINI_API_KEY_ENV = "GEMINI_API_KEY"

# Same BLENDER_HOST/BLENDER_PORT env vars the main MCP server
# (blend_ai.server.get_connection) reads, so one env setup covers both.
DEFAULT_BLENDER_HOST = os.environ.get("BLENDER_HOST", BlenderConnection.DEFAULT_HOST)
DEFAULT_BLENDER_PORT = int(os.environ.get("BLENDER_PORT", str(BlenderConnection.DEFAULT_PORT)))


def _check_blender_reachable(host: str, port: int) -> tuple[bool, str]:
    """Whether a Blender addon server is actually listening at host:port.

    Deliberately uses connect() alone, not send_command() — send_command's
    busy-retry loop can block for up to 5 minutes if Blender is mid-render,
    which would be a terrible price for a sidebar status check.
    """
    try:
        conn = BlenderConnection(host=host, port=port)
        conn.connect()
        conn.disconnect()
        return True, ""
    except BlenderConnectionError as e:
        return False, str(e)


def _sidebar_markdown(host: str, port: int, reachable: bool, detail: str) -> str:
    """Blender connection status + the full tool catalog, independent of
    whether a chat model/provider has ever been picked — this is the
    standalone "is Blender connected, what tools exist" view."""
    from blend_ai.server import mcp

    if reachable:
        status = f"🟢 **Connected** — `{host}:{port}`"
    else:
        status = f"🔴 **Not connected** — `{host}:{port}`\n\n{detail}"

    tools_by_module = get_tools_by_module(mcp)
    total = sum(len(tools) for tools in tools_by_module.values())

    lines = [
        "### Blender", status, "",
        f"### Toolset — {total} tools · {len(tools_by_module)} modules",
    ]
    for module in sorted(tools_by_module):
        lines.append(f"- {_pretty_tool_name(module)} — {len(tools_by_module[module])}")
    lines.append("")
    lines.append(
        "Loaded straight from blend-ai's registered tools — no chat model or "
        "provider required. Pick one in chat settings when you're ready to talk to it."
    )
    return "\n".join(lines)


async def _refresh_sidebar(blender_host: str, blender_port: int) -> None:
    reachable, detail = await cl.make_async(_check_blender_reachable)(blender_host, blender_port)
    content = _sidebar_markdown(blender_host, blender_port, reachable, detail)

    await cl.ElementSidebar.set_title("blend-ai MCP")
    await cl.ElementSidebar.set_elements(
        [cl.Text(name="mcp_status", content=content, display="side")]
    )


# Substrings that mark a Gemini model as specialized/non-conversational —
# image/audio/video generation, embeddings, music, robotics, and Google's
# own agent-specific previews (e.g. "antigravity-preview-05-2026", which
# listed fine but rejected every request with "Function calling is not
# enabled for models/antigravity-preview-05-2026"). This app's whole tool
# loop requires function calling, so anything matching here is useless to
# offer in the picker regardless of what it's otherwise good at.
_GEMINI_NON_TOOL_MODEL_MARKERS = (
    "antigravity", "embedding", "aqa", "image", "banana", "audio", "tts",
    "video", "robotics", "lyria", "code-mender", "deep-research",
    "computer-use", "bidi", "live",
)


def _gemini_supports_tools(model_name: str) -> bool:
    lowered = model_name.lower()
    return not any(marker in lowered for marker in _GEMINI_NON_TOOL_MODEL_MARKERS)


def _models_for(provider: str, host: str) -> tuple[list[str], str]:
    """Whatever models the server at `host` actually reports right now, plus
    a short failure reason (empty string on success) — an empty model list
    alone isn't enough to tell a genuinely-empty server apart from a wrong
    URL/bad key/unreachable host, which otherwise all look identical to the
    user ("no models found") with no way to tell which one it was.

    For Gemini, `host` is actually the pasted API key (see _host_widget) —
    entering a key and submitting the settings form is what triggers this
    live model lookup, same as pointing LM Studio at a host does.
    """
    try:
        if provider == "Gemini":
            api_key = host or os.environ.get(GEMINI_API_KEY_ENV, "")
            if not api_key:
                return [], ""
            from google import genai
            client = genai.Client(api_key=api_key)
            names = []
            for m in client.models.list():
                name = getattr(m, "name", None) or (m.get("name") if isinstance(m, dict) else None)
                if name:
                    names.append(name.removeprefix("models/"))
            return sorted(n for n in set(names) if _gemini_supports_tools(n)), ""
        else:
            from openai import OpenAI
            base_url = _normalize_openai_base_url(host)
            models = [m.id for m in OpenAI(base_url=base_url, api_key="not-needed").models.list().data]
            return models, ""
    except Exception as e:
        return [], f"{type(e).__name__}: {e}"


def _normalize_openai_base_url(host: str) -> str:
    """LM Studio, llama.cpp's server, and most OpenAI-compatible servers
    expose their API under /v1 — but their own UI just shows the bare
    host:port, which is exactly what's natural to paste into the host field
    here. Without /v1 the openai SDK gets a malformed response and silently
    looks like "no models available" with no clue why. Append /v1
    automatically unless the URL already ends in a version segment."""
    stripped = host.rstrip("/")
    if re.search(r"/v\d+$", stripped):
        return stripped
    return stripped + "/v1"


def _pick_default(models: list[str], preferred: str) -> str:
    if preferred in models:
        return preferred
    return models[0] if models else preferred


def _short(args: dict) -> str:
    """Compact one-line rendering of tool call args for the sub-agent trace display."""
    parts = []
    for k, v in args.items():
        s = repr(v)
        if len(s) > 40:
            s = s[:37] + "..."
        parts.append(f"{k}={s}")
    return ", ".join(parts)


def _pretty_tool_name(name: str) -> str:
    """'create_object' -> 'Create Object' -- for display only; tool dispatch
    always uses the real snake_case name, never this."""
    return name.replace("_", " ").title()


def _extract_images(elements: list) -> list[dict]:
    """Base64-encode every image attachment on an incoming message.

    Chainlit's spontaneous-file-upload feature (on for this app — see
    features.spontaneous_file_upload in .chainlit/config.toml) attaches
    uploads to message.elements; without reading that, an attached image is
    silently never sent to the model at all, which used to happen here.
    Checks both `.type` and `.mime` since it isn't documented which one
    Chainlit's upload widget reliably sets for a given file.
    """
    images = []
    for el in elements or []:
        mime = getattr(el, "mime", "") or ""
        if getattr(el, "type", None) != "image" and not mime.startswith("image/"):
            continue
        data = getattr(el, "content", None)
        if data is None and getattr(el, "path", None):
            try:
                with open(el.path, "rb") as f:
                    data = f.read()
            except OSError:
                continue
        if data is None:
            continue
        if isinstance(data, str):
            data = data.encode("utf-8")
        images.append({"mime": mime or "image/png", "data": base64.b64encode(data).decode("ascii")})
    return images


def _host_widget(provider: str, host: str) -> TextInput:
    """The one "connection detail" field in chat settings, shaped per provider.

    Ollama/LM Studio: a host URL. Gemini: an API key, pasted directly —
    Chainlit's ChatSettings has no masked/password widget type, so this is
    plain text in the UI. It's kept only in this session's server-side state
    (cl.user_session) for the life of the chat; it isn't written to disk or
    echoed back into any message. Prefer the GEMINI_API_KEY environment
    variable instead if that visibility is a concern.
    """
    if provider == "Gemini":
        return TextInput(
            id="host",
            label="Gemini API key",
            initial=host,
            placeholder="AIza...",
            description=(
                "Pasted keys are visible in this settings panel and are not masked. "
                "Submit to fetch your available models. Leave blank to fall back to "
                f"a {GEMINI_API_KEY_ENV} environment variable instead."
            ),
        )
    return TextInput(id="host", label=f"{provider} host", initial=host)


def _build_settings_widgets(
    provider: str,
    host: str,
    blender_host: str,
    blender_port: int,
    require_approval: bool,
    models: list[str],
    chat_model: str | None,
) -> list:
    """Shared widget list for both the submit path (_send_settings) and the
    live edit path (on_settings_edit) — kept in one place so the two never
    drift into showing different fields for the same provider."""
    widgets = [
        Select(id="provider", label="Provider", values=list(PROVIDERS.keys()), initial_value=provider),
        _host_widget(provider, host),
        TextInput(id="blender_host", label="Blender host", initial=blender_host),
        NumberInput(id="blender_port", label="Blender port", initial=float(blender_port)),
        Switch(
            id="require_approval",
            label="Ask before scene-changing actions",
            initial=require_approval,
            description=(
                "When on, anything that would create/modify/delete objects, run code, or "
                "write files pauses for your approval first. Read-only lookups (scene info, "
                "asset search) never pause."
            ),
        ),
    ]
    if models:
        widgets.append(
            Select(
                id="chat_model", label="Chat model", values=models,
                initial_value=_pick_default(models, chat_model or DEFAULT_CHAT_MODEL),
            ),
        )
    return widgets


async def _send_settings(
    provider: str,
    host: str,
    chat_model: str | None,
    blender_host: str,
    blender_port: int,
    require_approval: bool = True,
) -> None:
    models, error_detail = _models_for(provider, host)
    widgets = _build_settings_widgets(
        provider, host, blender_host, blender_port, require_approval, models, chat_model,
    )
    settings = await cl.ChatSettings(widgets).send()

    if not models:
        detail_line = f"\n\nError: `{error_detail}`" if error_detail else ""
        if provider == "Gemini":
            message = (
                "No models found — either no API key was entered above, or it isn't "
                f"valid.{detail_line}\n\n"
                "Paste a Gemini API key into the **Gemini API key** field above and submit "
                "again to fetch your available models. (Alternatively, set a "
                f"`{GEMINI_API_KEY_ENV}` environment variable before launching the chat app "
                "and leave the field blank.)"
            )
        else:
            normalized = _normalize_openai_base_url(host)
            message = (
                f"No models found at `{normalized}` ({provider}).{detail_line}\n\n"
                "Load a model in LM Studio and start its local server (a bare `host:port` "
                "is fine — `/v1` is added automatically), or point the host field at "
                "wherever that server is reachable.\n\n"
                "Then update the fields above to retry."
            )
        await cl.Message(content=message).send()
        return

    blender_host, blender_port, port_error = _resolve_blender_target(settings)
    if port_error:
        await cl.Message(content=port_error).send()
        return

    await _connect(
        provider, host, settings["chat_model"], blender_host, blender_port,
        require_approval=bool(settings.get("require_approval", True)),
    )


def _resolve_blender_target(settings: dict) -> tuple[str, int, str | None]:
    """Pull blender_host/blender_port out of a settings dict, with a
    friendly error string (third element) instead of raising on a bad port —
    a settings panel is easy to mistype into."""
    blender_host = settings.get("blender_host") or DEFAULT_BLENDER_HOST
    raw_port = settings.get("blender_port")
    try:
        blender_port = int(raw_port) if raw_port is not None else DEFAULT_BLENDER_PORT
    except (TypeError, ValueError):
        return blender_host, DEFAULT_BLENDER_PORT, f"Blender port must be a number, got `{raw_port}`."
    if not (1024 <= blender_port <= 65535):
        return blender_host, DEFAULT_BLENDER_PORT, f"Blender port must be between 1024 and 65535, got `{blender_port}`."
    return blender_host, blender_port, None


@cl.on_chat_start
async def start() -> None:
    # Blender status + the full tool catalog, in the sidebar, before any
    # model/provider is picked — these don't need one.
    await _refresh_sidebar(DEFAULT_BLENDER_HOST, DEFAULT_BLENDER_PORT)

    await _send_settings(
        provider=DEFAULT_PROVIDER, host=PROVIDERS[DEFAULT_PROVIDER], chat_model=None,
        blender_host=DEFAULT_BLENDER_HOST, blender_port=DEFAULT_BLENDER_PORT,
    )


@cl.on_settings_update
async def on_settings_update(settings: dict) -> None:
    old_session: BlenderChatSession | None = cl.user_session.get("session")
    if old_session is not None:
        old_session.close()

    provider = settings.get("provider") or DEFAULT_PROVIDER
    # Trust the submitted host outright. This used to fall back to the
    # provider's default whenever the *confirmed* provider differed from
    # this submission's — meant to clear a stale value carried over from a
    # previous provider's render — but on_settings_edit now already resets
    # the field live the instant the dropdown changes (see below), before
    # the user ever types into it. Re-applying that same reset here on
    # submit had a real bug: switching provider AND typing a new host in
    # the same sitting (the normal way to do it) has "confirmed provider"
    # still pointing at the OLD provider at submit time, so this branch
    # threw away the just-typed host and silently fell back to localhost —
    # exactly what happened when a custom LM Studio LAN address got
    # replaced with 127.0.0.1 without any error.
    host = settings.get("host") or PROVIDERS[provider]
    cl.user_session.set("provider", provider)
    cl.user_session.set("edit_provider", provider)

    blender_host, blender_port, port_error = _resolve_blender_target(settings)
    if port_error:
        await cl.Message(content=port_error).send()
        blender_host = settings.get("blender_host") or DEFAULT_BLENDER_HOST
        blender_port = cl.user_session.get("blender_port") or DEFAULT_BLENDER_PORT

    # Re-check whichever Blender target is now configured, independent of
    # whatever happens with the model/provider below.
    await _refresh_sidebar(blender_host, blender_port)

    await _send_settings(
        provider=provider, host=host, chat_model=settings.get("chat_model"),
        blender_host=blender_host, blender_port=blender_port,
        require_approval=bool(settings.get("require_approval", True)),
    )


@cl.on_settings_edit
async def on_settings_edit(settings: dict) -> None:
    """Fires live, per field change (Chainlit's "chat_settings_edit" socket
    event) — unlike on_settings_update, this needs no Confirm click. Used
    ONLY to re-render the panel immediately when the provider dropdown
    changes, so switching to Gemini shows the "Gemini API key" field right
    away instead of only after confirming and reopening settings. Never
    connects/reconnects or fetches models here — that stays gated behind an
    actual submit, so typing into the key field doesn't spam the API.

    Chainlit doesn't document whether this payload is the full settings
    dict or just the changed field, so it's merged into a per-session draft
    rather than trusted alone — a partial payload then can't wipe out
    fields (Blender host/port, the approval toggle) the user already set
    earlier in the same still-open panel.
    """
    draft = cl.user_session.get("settings_draft") or {}
    draft.update(settings)
    cl.user_session.set("settings_draft", draft)

    provider = draft.get("provider") or DEFAULT_PROVIDER
    prev_provider = cl.user_session.get("edit_provider") or cl.user_session.get("provider")
    if provider == prev_provider:
        return  # only the field shape (which provider) needs a live re-render
    cl.user_session.set("edit_provider", provider)

    # Same reset rule on_settings_update uses: a provider that just changed
    # gets a fresh (empty) field rather than showing the previous provider's
    # value in a field now labeled for a different one.
    host = PROVIDERS[provider]
    blender_host = draft.get("blender_host") or DEFAULT_BLENDER_HOST
    raw_port = draft.get("blender_port")
    try:
        blender_port = float(raw_port) if raw_port is not None else DEFAULT_BLENDER_PORT
    except (TypeError, ValueError):
        blender_port = DEFAULT_BLENDER_PORT
    require_approval = bool(draft.get("require_approval", True))

    models, _ = _models_for(provider, host)  # empty for a freshly-switched-to provider — no API hit for Gemini here
    widgets = _build_settings_widgets(provider, host, blender_host, blender_port, require_approval, models, None)
    await cl.ChatSettings(widgets).send()


async def _ask_approval(tool_calls: list[dict]) -> ApprovalDecision:
    """Approve/Reject/Suggest prompt for one round's proposed mutating tool
    calls. Blocks (via cl.run_sync, since this is invoked from the worker
    thread running session.chat()) until the user responds or it times out.
    """
    lines = [
        f"{i}. **{_pretty_tool_name(tc['name'])}** — `{_short(tc.get('arguments', {})) or 'no arguments'}`"
        for i, tc in enumerate(tool_calls, 1)
    ]
    content = "#### Confirm before this runs\n\nThe assistant wants to:\n\n" + "\n".join(lines)
    actions = [
        cl.Action(name="approve", payload={}, label="Approve", tooltip="Run this exactly as proposed"),
        cl.Action(name="reject", payload={}, label="Reject", tooltip="Skip it — the assistant will try a different approach"),
        cl.Action(name="suggest", payload={}, label="Suggest changes", tooltip="Skip it and tell the assistant what to do instead"),
    ]
    res = await cl.AskActionMessage(content=content, actions=actions, timeout=300, raise_on_timeout=False).send()
    if res is None:
        return ApprovalDecision(False, feedback="(no response within 5 minutes — action skipped)")
    if res["name"] == "approve":
        return ApprovalDecision(True)
    if res["name"] == "suggest":
        follow = await cl.AskUserMessage(content="What would you like it to do instead?", timeout=300).send()
        feedback = (follow.get("output") if follow else "") or "(no suggestion given)"
        return ApprovalDecision(False, feedback=feedback)
    return ApprovalDecision(False)


async def _report_tool_call(name: str, args: dict, result: str) -> None:
    """One completed tool call as its own live step — this is what replaces
    the single unbroken spinner with visible incremental progress."""
    try:
        parsed = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        parsed = None

    is_error = isinstance(parsed, dict) and parsed.get("status") == "error"
    output = json.dumps(parsed, indent=2) if parsed is not None else result
    if len(output) > 800:
        output = output[:800] + "\n...(truncated)"

    async with cl.Step(name=_pretty_tool_name(name), type="tool", language="json") as step:
        step.input = args
        step.output = output
        step.is_error = is_error


async def _report_assistant_text(text: str) -> None:
    """Surface the model's interim narration (said before it goes on to call
    tools) instead of silently discarding it — the other half of "I can't
    tell what it's thinking"."""
    await cl.Message(content=text, author="blend-ai").send()


async def _connect(
    provider: str, host: str, chat_model: str, blender_host: str, blender_port: int,
    require_approval: bool = True,
) -> None:
    cl.user_session.set("provider", provider)
    cl.user_session.set("blender_host", blender_host)
    cl.user_session.set("blender_port", blender_port)

    try:
        if provider == "Gemini":
            # `host` is the pasted API key here (see _host_widget), with an
            # environment variable as a fallback for anyone who'd rather not
            # put it in the (unmasked) settings panel.
            backend = GeminiBackend(chat_model, api_key=host or os.environ.get(GEMINI_API_KEY_ENV, ""))
        else:
            backend = OpenAICompatBackend(chat_model, base_url=_normalize_openai_base_url(host))
    except RuntimeError as e:
        await cl.Message(content=f"Couldn't set up the {provider} backend: {e}").send()
        return

    # Screenshots and uploaded images go straight to whichever backend is
    # active (see ollama_chat.chat()'s screenshot handling and
    # _extract_images below) — no separate Ollama vision model involved.
    session = BlenderChatSession(
        chat_model=chat_model,
        host=blender_host,
        port=blender_port,
        backend=backend,
    )
    session.require_approval = require_approval
    # These hooks run on the worker thread session.chat() executes on (see
    # cl.make_async below) — cl.run_sync is Chainlit's documented bridge for
    # calling back into async UI code from exactly that kind of sync context.
    session.on_tool_call = lambda name, args, result: cl.run_sync(_report_tool_call(name, args, result))
    session.on_assistant_text = lambda text: cl.run_sync(_report_assistant_text(text))
    session.on_approval_request = lambda tool_calls: cl.run_sync(_ask_approval(tool_calls))
    try:
        await cl.make_async(session.initialize)()
    except BlenderConnectionError as e:
        await cl.Message(
            content=(
                f"Couldn't connect to Blender at `{blender_host}:{blender_port}`: {e}\n\n"
                "Make sure Blender is running with the blend-ai addon's server started "
                "(N-panel -> blend-ai tab -> Start Server), and that the port there matches "
                "the Blender port in this chat's settings (the settings/sliders icon in the "
                "message toolbar at the bottom, not a top-right gear)."
            )
        ).send()
        return

    cl.user_session.set("session", session)
    displayed_host = _normalize_openai_base_url(host) if provider == "LM Studio / OpenAI-compatible" else host
    provider_detail = provider if provider == "Gemini" else f"{provider} (`{displayed_host}`)"
    approval_note = (
        "Scene-changing actions will pause for your approval before running."
        if require_approval else
        "Approval prompts are off — everything runs immediately (toggle this back on in chat settings)."
    )
    await cl.Message(
        content=(
            f"Connected to Blender at `{blender_host}:{blender_port}`. "
            f"Model: `{chat_model}` via {provider_detail}. "
            f"{len(session.tools)} tools loaded — type `!tools` to see them, `!mcp` for connection details. "
            f"{approval_note} "
            "Describe a scene (e.g. \"furnish a bedroom with a bed, nightstand, and a rug\") and "
            "the scene sub-agent will pull real assets from the library. What do you want to build?"
        )
    ).send()


def _mcp_status(session: BlenderChatSession) -> str:
    """Current connection config, for the `!mcp` command — everything the
    settings panel lets you configure, read back from the live session."""
    provider = cl.user_session.get("provider") or DEFAULT_PROVIDER
    return (
        f"**Blender:** `{session.host}:{session.port}` — {len(session.tools)} tools loaded "
        f"across {len(session.tools_by_module)} modules\n"
        f"**Chat model:** `{session.chat_model}` via {provider} (handles text, tools, and images directly)\n\n"
        "Change any of this from chat settings (the settings/sliders icon in the message toolbar, near attach-file and history — not a top-right gear) — "
        "editing it there reconnects to Blender with the new host/port."
    )


@cl.on_message
async def on_message(message: cl.Message) -> None:
    session: BlenderChatSession | None = cl.user_session.get("session")
    if session is None:
        await cl.Message(
            content=(
                "Not connected — open chat settings (the settings/sliders icon in the "
                "message toolbar at the bottom, not a top-right gear) to pick a provider "
                "and model first."
            )
        ).send()
        return

    # !tools [query] lists the loaded tool catalog directly — answered from
    # what's already loaded in the session, no model round trip.
    tools_query = parse_tools_command(message.content)
    if tools_query is not None:
        await cl.Message(content=session.list_tools(tools_query)).send()
        return

    # !mcp shows the current connection config — the settings panel (gear
    # icon) is where you *change* it; this is where you *see* it without
    # opening that panel.
    if message.content.strip() == "!mcp":
        await cl.Message(content=_mcp_status(session)).send()
        return

    images = _extract_images(message.elements)

    async with cl.Step(name="blend-ai", type="run"):
        try:
            response = await cl.make_async(session.chat)(message.content, images or None)
        except Exception as e:
            await cl.Message(
                content=(
                    f"Something went wrong talking to the model: {e}\n\n"
                    "If this is a model-capability error, pick a different model from "
                    "chat settings (the settings/sliders icon in the message toolbar) "
                    "and try again."
                )
            ).send()
            return

    # If the request went through the scene sub-agent (populate_scene), show
    # its verification render + call trace as follow-up messages rather than
    # folding them into the main reply — keeps the primary answer readable
    # while still giving full transparency into what it actually did.
    elements = []
    if session.last_scene_agent_render:
        elements.append(cl.Image(
            name="scene_render",
            content=base64.b64decode(session.last_scene_agent_render),
            display="inline",
        ))
        session.last_scene_agent_render = None

    await cl.Message(content=response or "(no response)", elements=elements).send()

    if session.last_scene_agent_trace:
        trace_lines = [
            f"{i}. **{_pretty_tool_name(t['tool'])}** — `{_short(t['args']) or 'no arguments'}`\n   → {t['result_preview']}"
            for i, t in enumerate(session.last_scene_agent_trace, 1)
        ]
        await cl.Message(
            content=(
                f"<details><summary>Scene sub-agent — {len(session.last_scene_agent_trace)} "
                f"step(s)</summary>\n\n" + "\n".join(trace_lines) + "\n\n</details>"
            ),
        ).send()
        session.last_scene_agent_trace = []


@cl.on_chat_end
def end() -> None:
    session: BlenderChatSession | None = cl.user_session.get("session")
    if session is not None:
        session.close()
