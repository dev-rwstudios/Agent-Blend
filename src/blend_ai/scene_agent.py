"""Isolated tool-calling sub-agent dedicated to asset search + placement.

The main chat/tool loop (ollama_chat.BlenderChatSession) exposes a single
pseudo-tool, `populate_scene`, that hands a natural-language scene
description off to `run_scene_agent()` here instead of letting the main
model call search_asset_library/import_asset itself turn-by-turn. Splitting
this out means:

- The 8-rule asset-first protocol (rules.ASSET_FIRST_PROTOCOL) only has to
  be followed inside a short, single-purpose loop with a restricted tool
  set — not tracked across an entire open-ended conversation, which is
  where small/local models tend to drop rules.
- The main model's context stays clean: it gets back a compact structured
  result (what got placed, a summary, whether a verification render was
  taken), not every intermediate search/import call.

This module is deliberately UI- and backend-agnostic: it's handed a
`backend` (anything with a `.step(messages, tools) -> (content, tool_calls,
raw_message)` method, matching ollama_chat's OllamaBackend /
OpenAICompatBackend / GeminiBackend) and a `tool_executor` callable (in
practice BlenderChatSession.execute_tool, which routes through the real MCP
tool layer), so it works the same from the Chainlit app or the terminal
REPL.
"""

from __future__ import annotations

import base64
import json
import tempfile
from pathlib import Path
from typing import Any, Callable

from blend_ai.rules import ASSET_FIRST_PROTOCOL

# The only tools the sub-agent is allowed to call. Deliberately excludes
# primitive-modeling tools (create_object, modeling.*) — if the description
# calls for something the library doesn't have, the sub-agent reports that
# in its summary instead of hand-modeling a substitute, per Rule 4. Falling
# back to primitives is left to the parent conversation, which has the full
# tool set and the surrounding context to judge what's an acceptable stand-in.
SCENE_AGENT_TOOL_NAMES = {
    "search_asset_library",
    "get_asset_details",
    "list_asset_categories",
    "import_asset",
    "get_scene_info",
    "render_image",
}

# Tool definition exposed to the *main* model, in the same Ollama/OpenAI
# tool-schema shape as everything ollama_chat.tool_registry.get_ollama_tools
# produces, so it can just be appended to BlenderChatSession.tools.
POPULATE_SCENE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "populate_scene",
        "description": (
            "Delegate furnishing/decorating a room or scene to a specialized "
            "asset-placement sub-agent. Give it a natural-language description "
            "of what the space should contain (e.g. 'a cozy bedroom with a "
            "queen bed, a nightstand with a lamp, and a rug') and it will "
            "search the local asset library, place accurately-scaled real "
            "assets, and render a verification screenshot. Prefer this over "
            "calling search_asset_library/import_asset yourself for anything "
            "resembling furniture, decor, lighting, seating, storage, or soft "
            "furnishings — the sub-agent enforces the asset-first protocol "
            "precisely so you don't have to track it turn-by-turn. It has no "
            "primitive-modeling tools, so it will tell you in its summary if "
            "something you asked for has no library match."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "What the scene/room should contain, in plain language.",
                },
            },
            "required": ["description"],
        },
    },
}

SCENE_AGENT_SYSTEM_PROMPT = ASSET_FIRST_PROTOCOL + """

## You are the scene-population sub-agent
You were delegated a single, self-contained task by another AI — there is no
human to ask follow-up questions, so work autonomously:

1. State your numbered Room Bill of Materials first (per Rule 2 above).
2. Execute it: search the library, then import/place every asset. If
   something the description calls for has no library match, note it in
   your final summary instead of trying to build it — you do not have
   primitive-modeling tools in this session, only asset-library and scene
   tools.
3. When everything is placed, stop calling tools and reply with a short
   plain-text summary of what you placed (and anything you couldn't find).
   Do not call render_image yourself — the caller takes care of the final
   verification render after you finish.
"""

_RENDER_PATH = str(Path(tempfile.gettempdir()) / "blend_ai_scene_agent_render.png")


def _read_render_base64(filepath: str) -> str | None:
    """Read a rendered image off disk and base64-encode it for the UI layer.

    render_image (unlike get_viewport_screenshot) writes to a file instead of
    returning image bytes — see tools/rendering.py — so this is the one spot
    that turns the render Blender just produced into something a chat UI can
    actually display. Returns None if the render didn't produce a readable
    file (e.g. Blender is headless with no render engine configured).
    """
    try:
        data = Path(filepath).read_bytes()
    except OSError:
        return None
    return base64.b64encode(data).decode("ascii")


def run_scene_agent(
    description: str,
    backend: Any,
    tools: list[dict[str, Any]],
    tool_executor: Callable[[str, dict[str, Any]], str],
    max_rounds: int = 15,
) -> dict[str, Any]:
    """Run an isolated tool-calling loop dedicated to one scene-building request.

    Args:
        description: Natural-language description of the scene to build.
        backend: A chat backend with .step(messages, tools) -> (content,
                 normalized_tool_calls, raw_message), e.g. an
                 ollama_chat.OllamaBackend/OpenAICompatBackend/GeminiBackend.
        tools: Tool definitions to expose to the sub-agent — should already
               be filtered to SCENE_AGENT_TOOL_NAMES by the caller.
        tool_executor: Callable that actually runs a tool by name (in
                       practice BlenderChatSession.execute_tool), returning
                       its JSON-string result.
        max_rounds: Safety cap on tool-calling rounds before giving up.

    Returns:
        Dict with:
          - summary: short plain-text account of what happened.
          - placed: list of {name, asset_id, location, needs_review} for
                    every import_asset call that returned a recognizable result.
          - render_taken: whether the final verification render succeeded.
          - render_base64: base64 PNG of that render, or None.
          - trace: list of {tool, args, result_preview} for every tool call
                   made, for optional display in a UI — not meant to be fed
                   back into any model's context (results are truncated).
    """
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SCENE_AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": description},
    ]
    trace: list[dict[str, Any]] = []
    placed: list[dict[str, Any]] = []
    final_text = ""

    def run_tool(name: str, args: dict[str, Any]) -> str:
        raw_result = tool_executor(name, args)
        try:
            parsed = json.loads(raw_result)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        if name == "import_asset" and isinstance(parsed, dict):
            placed.append({
                "name": parsed.get("name"),
                "asset_id": parsed.get("asset_id"),
                "location": parsed.get("location"),
                "needs_review": parsed.get("needs_review"),
            })
        preview = raw_result if len(raw_result) <= 300 else raw_result[:300] + "...(truncated)"
        trace.append({"tool": name, "args": args, "result_preview": preview})
        return raw_result

    for _round in range(max_rounds):
        content, tool_calls, raw_message = backend.step(messages, tools)
        messages.append(raw_message)

        if not tool_calls:
            final_text = content or final_text
            break

        for call in tool_calls:
            result = run_tool(call["name"], call.get("arguments", {}))
            tool_msg: dict[str, Any] = {"role": "tool", "content": result}
            if call.get("id"):
                tool_msg["tool_call_id"] = call["id"]
            messages.append(tool_msg)
    else:
        final_text = final_text or "(scene sub-agent hit its round limit before finishing)"

    # Always take one final, controlled verification render at a known path
    # (Rule 6), regardless of what the model did — this is what lets the
    # caller show a "here's what got built" image even if the sub-agent
    # forgot or a small model never got around to it.
    run_tool("render_image", {"filepath": _RENDER_PATH})
    render_base64 = _read_render_base64(_RENDER_PATH)

    return {
        "summary": final_text or "Scene sub-agent finished without a closing summary.",
        "placed": placed,
        "render_taken": render_base64 is not None,
        "render_base64": render_base64,
        "trace": trace,
    }
