"""Interactive Ollama chat client for controlling Blender via blend-ai."""

import asyncio
import base64
import json
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable

try:
    import ollama
    from ollama import Client as OllamaClient
except ImportError:
    ollama = None
    OllamaClient = None

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    from google import genai as google_genai
    from google.genai import errors as google_genai_errors
except ImportError:
    google_genai = None
    google_genai_errors = None

from blend_ai import scene_agent
from blend_ai.connection import BlenderConnectionError
from blend_ai.rules import ASSET_FIRST_PROTOCOL
from blend_ai.tool_registry import get_ollama_tools, get_tools_by_module

# Supported image formats for the !image REPL command
SUPPORTED_IMAGE_FORMATS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# Default models
DEFAULT_CHAT_MODEL = "qwen2.5-coder:14b"
DEFAULT_VISION_MODEL = "llava-llama3:latest"

# Max tool-call loop iterations to prevent infinite retries
MAX_TOOL_ROUNDS = 25

# Tools that only observe state (never create/modify/delete anything in the
# Blender scene or on disk) — exempt from the approval gate below even when
# require_approval is on, so read-only lookups (get_scene_info, searching
# the asset library, etc.) don't interrupt the flow. Everything else —
# create/set/delete/import/execute_code/populate_scene/file writes — is
# treated as mutating and gated when approval is required.
_READ_ONLY_TOOL_PREFIXES = ("get_", "list_", "search_")
_READ_ONLY_TOOL_NAMES = frozenset({"render_image", "fast_viewport_capture"})


def _is_read_only_tool(name: str) -> bool:
    return name.startswith(_READ_ONLY_TOOL_PREFIXES) or name in _READ_ONLY_TOOL_NAMES


@dataclass
class ApprovalDecision:
    """Returned by a BlenderChatSession.on_approval_request hook.

    approved=False with no feedback means a plain rejection; feedback (from
    a "suggest changes" style response) is fed back to the model as tool
    output so it can adjust its next attempt instead of repeating the same
    rejected action blind.
    """

    approved: bool
    feedback: str = ""


class OllamaBackend:
    """Chat backend for Ollama's native /api/chat protocol."""

    def __init__(self, model: str, host: str | None = None):
        self.model = model
        self.client = OllamaClient(host=host) if host else OllamaClient()

    def step(self, messages: list, tools: list) -> tuple[str, list[dict], Any]:
        """Run one chat turn.

        Returns (content, normalized_tool_calls, raw_assistant_message) where
        normalized_tool_calls is always a list of plain
        {"id", "name", "arguments"} dicts regardless of backend, and
        raw_assistant_message is whatever should be appended to the running
        message history to keep this backend's own conversation state correct.
        """
        response = self.client.chat(
            model=self.model, messages=_ollama_messages(messages), tools=tools, options={"num_ctx": 32768},
        )
        msg = response.message
        normalized = [
            {"id": f"call_{i}", "name": tc.function.name, "arguments": dict(tc.function.arguments)}
            for i, tc in enumerate(msg.tool_calls or [])
        ]
        return msg.content or "", normalized, msg


class OpenAICompatBackend:
    """Chat backend for any OpenAI-compatible /v1/chat/completions endpoint —
    LM Studio, llama.cpp's server, vLLM, etc. Tool schema is unchanged: Ollama's
    own tool format (from tool_registry.get_ollama_tools) is already
    OpenAI-shaped, so the same self.tools list works for both backends.
    """

    def __init__(self, model: str, base_url: str, api_key: str = "not-needed"):
        if OpenAI is None:
            raise RuntimeError(
                "The 'openai' package is required for LM Studio / OpenAI-compatible "
                "providers. Install it with: uv pip install openai"
            )
        self.model = model
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def step(self, messages: list, tools: list) -> tuple[str, list[dict], Any]:
        response = self.client.chat.completions.create(
            model=self.model, messages=_openai_messages(messages), tools=tools or None,
        )
        msg = response.choices[0].message
        raw_tool_calls = msg.tool_calls or []
        normalized = [
            {"id": tc.id, "name": tc.function.name, "arguments": json.loads(tc.function.arguments)}
            for tc in raw_tool_calls
        ]
        raw_assistant_message: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
        if raw_tool_calls:
            raw_assistant_message["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in raw_tool_calls
            ]
        return msg.content or "", normalized, raw_assistant_message

def _normalize_image(img: Any) -> dict[str, str]:
    """Accept either a bare base64 string (assumed PNG — every existing
    screenshot/render path in this codebase already only ever produces
    PNGs) or a {"mime", "data"} dict. Keeps chat()'s `images` argument
    backward compatible with plain-string callers while letting newer
    callers (chat_app's file-upload handling) specify an accurate mime
    type for non-PNG uploads."""
    if isinstance(img, str):
        return {"mime": "image/png", "data": img}
    return img


def _ollama_messages(messages: list[dict]) -> list[dict]:
    """Translate the shared generic message list into Ollama's native shape.

    Ollama's own /api/chat protocol takes images as a bare list of base64
    strings per message (no mime type needed — it sniffs the format
    itself), so this just unwraps this module's internal {"mime", "data"}
    image dicts down to plain strings. Returns a new list rather than
    mutating `messages` in place, since that list is the shared session
    history other code (and other backends, if the model is ever switched
    mid-session) reads directly.
    """
    translated = []
    for m in messages:
        if m.get("role") == "user" and m.get("images"):
            m2 = dict(m)
            m2["images"] = [_normalize_image(img)["data"] for img in m["images"]]
            translated.append(m2)
        else:
            translated.append(m)
    return translated


def _openai_messages(messages: list[dict]) -> list[dict]:
    """Translate the shared generic message list into OpenAI's chat.completions
    shape. Unlike Ollama, the OpenAI API has no separate "images" field —
    an image-bearing user turn's `content` has to become a list of content
    parts (text + one or more image_url data URIs) instead of a plain
    string. Non-image messages pass through unchanged."""
    translated = []
    for m in messages:
        if m.get("role") == "user" and m.get("images"):
            parts: list[dict] = [{"type": "text", "text": m.get("content", "")}]
            for img in m["images"]:
                img = _normalize_image(img)
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{img['mime']};base64,{img['data']}"},
                })
            translated.append({"role": "user", "content": parts})
        else:
            translated.append(m)
    return translated


_RETRY_DELAY_RE = re.compile(r"retry in ([\d.]+)\s*s", re.IGNORECASE)


def _parse_retry_delay(message: str) -> float | None:
    """Pull Google's suggested backoff out of a 429 error message, e.g.
    '...Please retry in 12.933028406s.' -> 12.933028406. Returns None if the
    message doesn't contain that phrasing so callers can fall back to their
    own default."""
    match = _RETRY_DELAY_RE.search(message)
    return float(match.group(1)) if match else None


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Attribute-or-dict accessor. The google-genai SDK's response objects
    aren't guaranteed dict vs. typed-object shape across versions, so every
    GeminiBackend field access goes through this instead of assuming one."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class GeminiBackend:
    """Chat backend for Google's Gemini Interactions API.

    Conversation state is kept server-side via `previous_interaction_id`
    rather than replayed from this module's generic `messages` list on every
    call. The Interactions API's own historical "steps" (function_call,
    thought, ...) can carry opaque continuation data the docs say must be
    replayed byte-for-byte — not something this module's generic role/content
    message shape can safely reconstruct. Chaining sidesteps that entirely:
    each call sends only what's new since the last one (a user message, or
    function results answering the previous round's tool calls), and the
    server retains everything before it.
    """

    def __init__(self, model: str, api_key: str):
        if google_genai is None:
            raise RuntimeError(
                "The 'google-genai' package is required for the Gemini provider. "
                "Install it with: uv pip install google-genai"
            )
        if not api_key:
            raise RuntimeError(
                "No Gemini API key provided. Set the GEMINI_API_KEY environment "
                "variable before starting the chat app."
            )
        self.model = model
        self.client = google_genai.Client(api_key=api_key)
        self._last_interaction_id: str | None = None
        self._sent_up_to = 0  # index into `messages` already reflected server-side
        self._pending_call_names: dict[str, str] = {}  # tool_call_id -> tool name

    def step(self, messages: list, tools: list) -> tuple[str, list[dict], Any]:
        system_instruction = None
        if messages and messages[0].get("role") == "system":
            system_instruction = messages[0].get("content")

        gemini_tools = [{"type": "function", **t["function"]} for t in tools]

        # Only translate what hasn't been sent yet — everything before that
        # is already part of the chained interaction server-side.
        new_items = messages[self._sent_up_to:]
        input_steps: list[dict[str, Any]] = []
        for item in new_items:
            role = item.get("role")
            if role == "user":
                content_parts: list[dict[str, Any]] = [{"type": "text", "text": item.get("content", "")}]
                for img in item.get("images") or []:
                    img = _normalize_image(img)
                    content_parts.append({"type": "image", "mime_type": img["mime"], "data": img["data"]})
                input_steps.append({"type": "user_input", "content": content_parts})
            elif role == "tool":
                call_id = item.get("tool_call_id")
                input_steps.append({
                    "type": "function_result",
                    "name": self._pending_call_names.get(call_id, ""),
                    "call_id": call_id,
                    "result": item.get("content", ""),
                })
            # Assistant/raw_message entries are this backend's own bookkeeping
            # (see raw_message below) — the server already has the real
            # version of that turn via previous_interaction_id, so they're
            # deliberately not resent.
        self._sent_up_to = len(messages)

        if not input_steps:
            input_steps = [{"type": "user_input", "content": [{"type": "text", "text": ""}]}]

        max_retries = 3
        interaction = None
        for attempt in range(max_retries + 1):
            try:
                interaction = self.client.interactions.create(
                    model=self.model,
                    input=input_steps,
                    tools=gemini_tools or None,
                    system_instruction=system_instruction,
                    previous_interaction_id=self._last_interaction_id,
                    store=True,
                )
                break
            except google_genai_errors.APIError as e:
                message = str(e)
                if "function calling is not enabled" in message.lower():
                    raise RuntimeError(
                        f"'{self.model}' doesn't support function calling, which this app "
                        "requires for every Blender tool call. Pick a different model from "
                        "chat settings (a general-purpose gemini-*-flash/pro model, not a "
                        "specialized preview) and reconnect."
                    ) from e

                is_rate_limited = (
                    getattr(e, "code", None) == 429 or "429" in message or "quota" in message.lower()
                )
                if is_rate_limited and attempt < max_retries:
                    # Google tells us exactly how long to wait ("...Please
                    # retry in 12.9s.") — use that over a blind guess, with a
                    # small buffer and a cap so one bad message can't stall
                    # the whole turn for minutes.
                    delay = min(_parse_retry_delay(message) or (2.0 ** attempt), 30.0) + 0.5
                    time.sleep(delay)
                    continue
                if is_rate_limited:
                    raise RuntimeError(
                        f"Gemini's free-tier quota for '{self.model}' is exhausted (tried "
                        f"{max_retries} retries). The free tier allows very few requests per "
                        "minute — wait a bit and try again, switch to a model with more "
                        "headroom, or enable billing in AI Studio for higher limits."
                    ) from e
                raise RuntimeError(f"Gemini API error: {e}") from e
        self._last_interaction_id = _get(interaction, "id")

        normalized: list[dict[str, Any]] = []
        for step_obj in _get(interaction, "steps", []) or []:
            if _get(step_obj, "type") != "function_call":
                continue
            call_id = _get(step_obj, "id") or f"call_{len(normalized)}"
            name = _get(step_obj, "name", "")
            args = dict(_get(step_obj, "arguments", {}) or {})
            self._pending_call_names[call_id] = name
            normalized.append({"id": call_id, "name": name, "arguments": args})

        content = _get(interaction, "output_text", "") or ""
        raw_message = {"role": "assistant", "content": content}
        return content, normalized, raw_message


# Base system prompt — tool list is appended dynamically in initialize()
SYSTEM_PROMPT_BASE = """You are an expert Blender 3D artist and technical director. You control \
Blender through tool calls.

IMPORTANT: You must ONLY use tools from the list below. Do NOT invent tool names.

Guidelines:
- Always get_scene_info first to understand the current state before making changes.
- Use get_viewport_screenshot to visually check your work after significant changes.
- To delete an object, use delete_object with the "name" parameter.
- To move/rotate/scale objects, use set_location, set_rotation, set_scale.
- To create objects, use create_object with "type" (CUBE, SPHERE, etc).
- Apply professional 3D practices — proper topology, edge flow, material setup — to \
whatever you're asked to build, but do not expand the scope of the request itself. \
Build EXACTLY what was asked and nothing else: if the user asks for one object, \
create that one object and stop. Do not add a ground plane, lights, a camera, or \
other objects "to make it look nice" unless the user asked for them or for a full \
scene/render — an unrequested studio setup is scope creep, not professionalism. \
When in doubt about whether something extra is wanted, ask instead of adding it.
- Name objects descriptively. Keep scenes organized with collections.
- When the user describes something to create, break it into logical steps — but \
those steps should decompose the thing they asked for, not introduce new things \
they didn't.
- Explain what you're doing briefly, then execute with tool calls.

{asset_first_protocol}
For anything that matches Rule 1 above (furniture, decor, lighting, seating, storage, soft furnishings, rugs, and similar), call the `populate_scene` tool with a plain-language description instead of calling search_asset_library/import_asset yourself. A dedicated sub-agent handles the search-plan-place-verify sequence in an isolated context so you don't have to track it turn-by-turn — just describe what the space should contain and read back its summary.

Modeling strategy for anything NOT covered by the asset library (organic shapes, \
custom hard-surface props, characters) — what actually works with available tools:
- Organic/anatomical (bodies, creatures, faces): build from multiple positioned primitives \
(UV_SPHERE for rounded forms, CYLINDER for shafts). Scale and position each part, then \
join_objects to merge. Add Subdivision modifier (levels 2-3) and set_smooth_shading for \
smooth results. Do NOT use sculpt mode — no stroke tools are available.
- Hard-surface (mechanical, weapons, props): CUBE with add_loop_cut and extrude_faces. \
Use bevel_edges for chamfers. Mirror modifier for symmetric objects.
- Layered organic forms: overlap multiple UV_SPHEREs at different scales and positions \
to approximate organic volume, then join. Subdivision smooths the joins.
- DO NOT use boolean_operation for organic shapes — unreliable without perfectly clean \
manifold meshes. Prefer join_objects + smooth shading instead.
- DO NOT enter sculpt mode — there are no brush stroke tools. It is a dead end.

Always plan before acting (see Rule 2 above for interior/room scenes):
1. State your approach: what assets or primitives, how many, how positioned, what modifiers.
2. Then execute step by step with tool calls.
3. After major changes, use get_viewport_screenshot to verify visually.
""".format(asset_first_protocol=ASSET_FIRST_PROTOCOL)


def parse_image_command(user_input: str) -> tuple[str, str] | None:
    """Parse a !image command from user input.

    Args:
        user_input: Raw user input string.

    Returns:
        Tuple of (image_path, message) or None if not an image command.
    """
    if not user_input.startswith("!image "):
        return None
    remainder = user_input[len("!image "):].strip()
    if not remainder:
        return None
    parts = remainder.split(None, 1)
    image_path = parts[0]
    message = parts[1] if len(parts) > 1 else ""
    return (image_path, message)


def parse_tools_command(user_input: str) -> str | None:
    """Parse a !tools command from user input.

    Args:
        user_input: Raw user input string.

    Returns:
        The filter/search text (possibly empty, for a bare "!tools"), or
        None if this isn't a !tools command at all.
    """
    stripped = user_input.strip()
    if stripped == "!tools":
        return ""
    if stripped.startswith("!tools "):
        return stripped[len("!tools "):].strip()
    return None


def format_tools_listing(tools_by_module: dict[str, list[dict[str, Any]]], query: str = "") -> str:
    """Format the loaded tool catalog for direct display to a human.

    With no query, shows module names and tool counts (an overview of all
    ~177 tools would be too long to be useful at a glance). With a query,
    shows full name + description for every tool whose module name, tool
    name, or description matches (case-insensitive substring).

    Args:
        tools_by_module: Output of tool_registry.get_tools_by_module().
        query: Optional module name or search term.

    Returns:
        Markdown-formatted listing.
    """
    query = query.strip().lower()

    if not query:
        total = sum(len(tools) for tools in tools_by_module.values())
        lines = [
            f"**{total} tools across {len(tools_by_module)} modules.**",
            "`!tools <module>` for one module's tools, or `!tools <search term>` to search by name/description.",
            "",
        ]
        for module in sorted(tools_by_module):
            lines.append(f"- `{module}` — {len(tools_by_module[module])} tools")
        return "\n".join(lines)

    if query in tools_by_module:
        matches = {query: tools_by_module[query]}
    else:
        matches = {}
        for module, tools in tools_by_module.items():
            hits = [
                t for t in tools
                if query in t["function"]["name"].lower()
                or query in t["function"].get("description", "").lower()
                or query in module.lower()
            ]
            if hits:
                matches[module] = hits

    if not matches:
        return f"No tools match `{query}`. Type `!tools` to see all module names."

    lines = []
    for module in sorted(matches):
        lines.append(f"**{module}** ({len(matches[module])})")
        for tool in sorted(matches[module], key=lambda t: t["function"]["name"]):
            desc = tool["function"].get("description", "").split(".")[0].strip()
            lines.append(f"- `{tool['function']['name']}` — {desc}")
        lines.append("")
    return "\n".join(lines).strip()


def load_image_as_base64(image_path: str) -> str:
    """Load an image file and return its base64-encoded string.

    Args:
        image_path: Absolute or relative path to the image file.

    Returns:
        Base64-encoded string of the image bytes.

    Raises:
        ValueError: If the file extension is not in SUPPORTED_IMAGE_FORMATS.
        FileNotFoundError: If the file does not exist.
        OSError: If the file cannot be read.
    """
    import pathlib
    ext = pathlib.Path(image_path).suffix.lower()
    if ext not in SUPPORTED_IMAGE_FORMATS:
        supported = ", ".join(sorted(SUPPORTED_IMAGE_FORMATS))
        raise ValueError(f"Unsupported image format '{ext}'. Supported: {supported}")
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


class BlenderChatSession:
    """Interactive chat session connecting Ollama to Blender."""

    def __init__(
        self,
        chat_model: str = DEFAULT_CHAT_MODEL,
        vision_model: str = DEFAULT_VISION_MODEL,
        host: str = "127.0.0.1",
        port: int = 9876,
        ollama_host: str | None = None,
        think: bool = False,
        backend: "OllamaBackend | OpenAICompatBackend | None" = None,
    ):
        self.chat_model = chat_model
        self.vision_model = vision_model
        self.host = host
        self.port = port
        self.think = think
        # Vision (screenshot analysis) always goes through Ollama regardless
        # of which backend handles the main chat/tool loop — vision-capable
        # OpenAI-compatible endpoints vary too much to standardize on yet.
        self.ollama_client = OllamaClient(host=ollama_host) if ollama_host else OllamaClient()
        # The main chat/tool-calling backend. Defaults to Ollama so the
        # terminal REPL's existing behavior (main(), below) is unchanged;
        # pass an OpenAICompatBackend to talk to LM Studio or similar instead.
        self.backend = backend or OllamaBackend(chat_model, ollama_host)
        self.messages: list[dict[str, Any]] = []
        self.tools: list[dict[str, Any]] = []
        self.tools_by_module: dict[str, list[dict[str, Any]]] = {}
        self._tool_names: set[str] = set()
        self._scene_agent_tools: list[dict[str, Any]] = []
        self.last_scene_agent_trace: list[dict[str, Any]] = []
        self.last_scene_agent_render: str | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

        # UI integration hooks — all optional, all no-ops when None (keeps
        # the terminal REPL's plain print()-based behavior unchanged).
        # chat_app wires these to live Chainlit steps/messages/action prompts.
        self.require_approval: bool = False
        self.on_tool_call: Callable[[str, dict[str, Any], str], None] | None = None
        self.on_assistant_text: Callable[[str], None] | None = None
        self.on_approval_request: Callable[[list[dict[str, Any]]], ApprovalDecision] | None = None

    def initialize(self) -> None:
        """Connect to Blender and load tool definitions."""
        # Import here to avoid circular imports — server module registers all tools
        from blend_ai.server import mcp

        # Configure and verify Blender connection
        from blend_ai.connection import BlenderConnection
        from blend_ai import server as srv
        srv._connection = BlenderConnection(host=self.host, port=self.port)
        srv._connection.connect()

        self.tools = get_ollama_tools(mcp) + [scene_agent.POPULATE_SCENE_TOOL]
        self._tool_names = {t["function"]["name"] for t in self.tools}
        self.tools_by_module = get_tools_by_module(mcp)
        # populate_scene isn't a real MCP tool (see execute_tool's special
        # case for it below), so it's added to the display grouping by hand
        # for !tools/sidebar parity with everything else the model can call.
        self.tools_by_module.setdefault("scene_agent", []).append(scene_agent.POPULATE_SCENE_TOOL)
        self._scene_agent_tools = [
            t for t in self.tools if t["function"]["name"] in scene_agent.SCENE_AGENT_TOOL_NAMES
        ]

        # Build system prompt with tool listing grouped by module
        tool_list = _build_tool_list(self.tools)
        system_prompt = SYSTEM_PROMPT_BASE + "\nAvailable tools:\n" + tool_list
        self.messages = [{"role": "system", "content": system_prompt}]

    def list_tools(self, query: str = "") -> str:
        """Format the loaded tool catalog for direct display to the human user.

        Unlike the tool listing baked into the system prompt (for the model),
        this is meant to be shown straight to the person chatting — used by
        the `!tools` REPL/chat command in both blend-ai-chat and the Chainlit
        app. Answered from the catalog loaded at initialize() time, so it
        costs no LLM round trip.

        Args:
            query: Optional module name or search term.

        Returns:
            Markdown-formatted listing.
        """
        return format_tools_listing(self.tools_by_module, query)

    def execute_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Execute a blend-ai tool through the MCP tool layer.

        Routes through FastMCP's call_tool so we get proper parameter
        validation and correct parameter-to-command mapping.

        Args:
            name: The tool name (as registered with @mcp.tool()).
            arguments: The tool parameters.

        Returns:
            JSON string of the result.
        """
        from blend_ai.server import mcp

        if self._loop is None:
            self._loop = asyncio.new_event_loop()

        try:
            result = self._loop.run_until_complete(mcp.call_tool(name, arguments))
            # call_tool returns list[TextContent] — extract the text
            if result and hasattr(result[0], "text"):
                output = result[0].text
            else:
                output = json.dumps(result, default=str)
        except Exception as e:
            output = json.dumps({"status": "error", "result": str(e)})

        # Single reporting point for every tool actually executed through the
        # MCP layer — covers both the main loop's direct calls and the scene
        # sub-agent's internal calls (it also calls this same method via its
        # tool_executor), so UI progress reporting doesn't need two call sites.
        if self.on_tool_call:
            self.on_tool_call(name, arguments, output)
        return output

    def _run_scene_agent(self, description: str) -> str:
        """Delegate a scene-building request to the isolated asset sub-agent.

        Returns a compact JSON string sized for the *parent* model's context.
        The full per-tool trace and the raw render bytes aren't useful for a
        model to read back, so they're stashed on the session instead
        (last_scene_agent_trace / last_scene_agent_render) for the UI layer
        (chat_app) to show separately.
        """
        result = scene_agent.run_scene_agent(
            description=description,
            backend=self.backend,
            tools=self._scene_agent_tools,
            tool_executor=self.execute_tool,
        )
        self.last_scene_agent_trace = result.pop("trace", [])
        self.last_scene_agent_render = result.pop("render_base64", None)
        return json.dumps(result, default=str)

    def analyze_screenshot(self, image_base64: str, context: str = "") -> str:
        """Send a viewport screenshot to the vision model for analysis.

        Args:
            image_base64: Base64-encoded PNG image data.
            context: Optional context about what to look for.

        Returns:
            Vision model's analysis of the image.
        """
        prompt = "Analyze this Blender viewport screenshot. "
        if context:
            prompt += context
        else:
            prompt += (
                "Describe what you see: objects, materials, lighting, composition. "
                "Note any issues with topology, scale, or visual quality."
            )

        response = self.ollama_client.chat(
            model=self.vision_model,
            messages=[{
                "role": "user",
                "content": prompt,
                "images": [image_base64],
            }],
        )
        return response.message.content

    def chat(self, user_message: str, images: list[dict[str, str]] | None = None) -> str:
        """Send a message and process the full tool-calling loop.

        Args:
            user_message: The user's message.
            images: Optional list of {"mime": "image/png", "data": "<base64>"}
                dicts to attach — each backend's .step() translates this into
                whatever shape its own API needs (a bare base64 list for
                Ollama, image_url data URIs for OpenAI-compatible, Gemini
                ImageContent blocks for Gemini).

        Returns:
            The final assistant response text.
        """
        if self.think:
            user_message = f"/think\n{user_message}"
        user_msg: dict[str, Any] = {"role": "user", "content": user_message}
        if images:
            user_msg["images"] = images
        self.messages.append(user_msg)

        for _round in range(MAX_TOOL_ROUNDS):
            content, tool_calls, raw_message = self.backend.step(self.messages, self.tools)

            # Fallback: parse tool calls from text if the model output them as text
            # instead of using native tool-calling (some smaller/local models do this).
            if not tool_calls and content:
                parsed = _parse_text_tool_calls(content, self._tool_names)
                if parsed:
                    tool_calls = parsed
                    # Strip tool-call markup from the message content before appending
                    clean_content = _strip_tool_markup(content)
                    self.messages.append({"role": "assistant", "content": clean_content})
                else:
                    self.messages.append(raw_message)
                    return content
            elif not tool_calls:
                self.messages.append(raw_message)
                return content or ""
            else:
                self.messages.append(raw_message)
                if content and self.on_assistant_text:
                    self.on_assistant_text(content)

            if self.require_approval and self.on_approval_request:
                mutating = [tc for tc in tool_calls if not _is_read_only_tool(tc["name"])]
                if mutating:
                    decision = self.on_approval_request(tool_calls)
                    if not decision.approved:
                        note = "User did not approve this action."
                        if decision.feedback:
                            note += f" Feedback: {decision.feedback}"
                        note += " Do not repeat it as-is — adjust your approach."
                        for tool_call in tool_calls:
                            tool_msg = {"role": "tool", "content": note}
                            if tool_call.get("id"):
                                tool_msg["tool_call_id"] = tool_call["id"]
                            self.messages.append(tool_msg)
                        continue

            for tool_call in tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call.get("arguments", {})
                tool_call_id = tool_call.get("id")

                # populate_scene isn't a real MCP tool — it's intercepted here
                # and handed off to the isolated scene sub-agent instead of
                # going through execute_tool()/mcp.call_tool().
                if tool_name == "populate_scene":
                    print(f"  -> populate_scene({_format_args(tool_args)}) [delegating to scene sub-agent]")
                    result = self._run_scene_agent(tool_args.get("description", ""))
                    tool_msg = {"role": "tool", "content": result}
                    if tool_call_id:
                        tool_msg["tool_call_id"] = tool_call_id
                    self.messages.append(tool_msg)
                    if self.on_tool_call:
                        self.on_tool_call(tool_name, tool_args, result)
                    continue

                # Check if tool exists — if not, give model corrective feedback
                if tool_name not in self._tool_names:
                    similar = _find_similar_tools(tool_name, self._tool_names)
                    hint = f"Tool '{tool_name}' does not exist."
                    if similar:
                        hint += f" Similar tools: {', '.join(similar)}."
                    hint += " Use get_scene_info to see available objects first."
                    print(f"  [!] {hint}")
                    tool_msg = {"role": "tool", "content": hint}
                    if tool_call_id:
                        tool_msg["tool_call_id"] = tool_call_id
                    self.messages.append(tool_msg)
                    continue

                print(f"  -> {tool_name}({_format_args(tool_args)})")

                result = self.execute_tool(tool_name, tool_args)

                # If tool errored, still feed it back so the model can recover
                if result.startswith('{"status": "error"'):
                    print(f"  [!] Error: {result}")

                # If this was a screenshot, auto-analyze with vision model.
                # Vision always goes through Ollama (see __init__) even when the
                # main chat backend is something else — if Ollama isn't
                # reachable at all, degrade gracefully instead of failing the turn.
                tool_msg = {"role": "tool", "content": result}
                if tool_call_id:
                    tool_msg["tool_call_id"] = tool_call_id
                self.messages.append(tool_msg)

                # Give the active backend direct visual access to any
                # screenshot it just took. A "tool"-role message can't carry
                # image content in any of these APIs, so this is a follow-up
                # "user" turn instead — reusing the same images= mechanism
                # chat_app's file-upload handling uses. Works uniformly
                # across every backend (Ollama, OpenAI-compatible, Gemini);
                # no separate vision-model call needed.
                if tool_name in ("get_viewport_screenshot", "fast_viewport_capture"):
                    try:
                        result_data = json.loads(result)
                    except (json.JSONDecodeError, TypeError):
                        result_data = None
                    if isinstance(result_data, dict) and result_data.get("image"):
                        self.messages.append({
                            "role": "user",
                            "content": "(That's the screenshot you just captured.)",
                            "images": [{"mime": "image/png", "data": result_data["image"]}],
                        })

        return "(Reached maximum tool-calling rounds. Please try a simpler request.)"

    def _handle_image_command(self, image_path: str, message: str) -> str:
        """Handle a !image command by routing through the vision model first.

        Sends the image to the vision model for analysis, then passes the
        resulting text description to the chat model. This avoids sending
        raw image bytes to non-vision chat models (which causes HTTP 500).

        Args:
            image_path: Path to the image file (already validated).
            message: User's instruction about what to do with the image.

        Returns:
            The final assistant response text.
        """
        image_data = load_image_as_base64(image_path)
        context = message if message else "Describe this image in detail for use as a 3D modeling reference."
        print("  -> Analyzing image with vision model...")
        description = self.analyze_screenshot(image_data, context=context)
        combined = f"[Reference image analysis]: {description}"
        if message:
            combined += f"\n\nUser request: {message}"
        return self.chat(combined)

    def close(self) -> None:
        """Disconnect from Blender."""
        from blend_ai import server as srv
        if srv._connection:
            srv._connection.disconnect()
        if self._loop is not None:
            self._loop.close()
            self._loop = None


def _parse_text_tool_calls(text: str, known_tools: set[str]) -> list[dict[str, Any]]:
    """Parse tool calls from model text output when native tool-calling isn't used.

    Handles formats like:
    - <function=name><parameter=key>value</parameter></function>
    - {"name": "tool", "arguments": {...}}

    Args:
        text: The model's text output.
        known_tools: Set of valid tool names.

    Returns:
        List of parsed tool call dicts, or empty list if none found.
    """
    calls = []

    # Pattern 1: XML-style <function=name>...</function>
    func_pattern = re.compile(
        r'<function=(\w+)>(.*?)</function>', re.DOTALL
    )
    param_pattern = re.compile(
        r'<parameter=(\w+)>\s*(.*?)\s*</parameter>', re.DOTALL
    )

    for match in func_pattern.finditer(text):
        func_name = match.group(1)
        body = match.group(2)
        args = {}
        for param_match in param_pattern.finditer(body):
            key = param_match.group(1)
            value = param_match.group(2).strip()
            try:
                args[key] = json.loads(value)
            except (json.JSONDecodeError, ValueError):
                args[key] = value
        # Accept all parsed tool calls — validation happens in the chat loop
        calls.append({"name": func_name, "arguments": args})

    if calls:
        return calls

    # Pattern 2: JSON object with name/arguments — find by scanning for opening brace
    for i, ch in enumerate(text):
        if ch != '{':
            continue
        depth = 0
        for j in range(i, len(text)):
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
            if depth == 0:
                candidate = text[i:j + 1]
                try:
                    obj = json.loads(candidate)
                    if isinstance(obj, dict) and "name" in obj and "arguments" in obj:
                        calls.append({
                            "name": obj["name"],
                            "arguments": obj.get("arguments", {}),
                        })
                except (json.JSONDecodeError, AttributeError):
                    pass
                break

    return calls


def _build_tool_list(tools: list[dict[str, Any]]) -> str:
    """Build a compact tool listing for the system prompt.

    Args:
        tools: List of Ollama tool definitions.

    Returns:
        Formatted string with tool names and brief descriptions.
    """
    lines = []
    for tool in sorted(tools, key=lambda t: t["function"]["name"]):
        name = tool["function"]["name"]
        desc = tool["function"].get("description", "")
        # Take just the first sentence for brevity
        short_desc = desc.split(".")[0].strip() if desc else ""
        lines.append(f"- {name}: {short_desc}")
    return "\n".join(lines)


def _find_similar_tools(name: str, known_tools: set[str], max_results: int = 5) -> list[str]:
    """Find tools with similar names for corrective suggestions.

    Args:
        name: The unknown tool name.
        known_tools: Set of valid tool names.
        max_results: Maximum suggestions to return.

    Returns:
        List of similar tool names, most relevant first.
    """
    name_words = set(name.lower().split("_"))
    scored = []
    for tool in known_tools:
        tool_words = set(tool.lower().split("_"))
        overlap = len(name_words & tool_words)
        if overlap > 0:
            scored.append((overlap, tool))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [s[1] for s in scored[:max_results]]


def _strip_tool_markup(text: str) -> str:
    """Remove tool-call markup from text, keeping any natural language."""
    # Remove XML-style function calls
    cleaned = re.sub(r'<function=\w+>.*?</function>', '', text, flags=re.DOTALL)
    # Remove opening <tool_call> tags
    cleaned = re.sub(r'<tool_call>', '', cleaned)
    # Remove closing </tool_call> tags
    cleaned = re.sub(r'</tool_call>', '', cleaned)
    return cleaned.strip() or ""


def _format_args(args: dict[str, Any]) -> str:
    """Format tool arguments for display, truncating long values."""
    parts = []
    for k, v in args.items():
        s = repr(v)
        if len(s) > 50:
            s = s[:47] + "..."
        parts.append(f"{k}={s}")
    return ", ".join(parts)


def main():
    """Run the interactive Ollama chat client for Blender."""
    if ollama is None:
        print("Error: 'ollama' package is not installed.")
        print("Install it with: uv pip install ollama")
        sys.exit(1)

    import argparse

    parser = argparse.ArgumentParser(
        description="Interactive Ollama chat client for Blender",
        prog="blend-ai-chat",
    )
    parser.add_argument(
        "--model", "-m",
        default=DEFAULT_CHAT_MODEL,
        help=f"Ollama chat model (default: {DEFAULT_CHAT_MODEL})",
    )
    parser.add_argument(
        "--vision-model", "-v",
        default=DEFAULT_VISION_MODEL,
        help=f"Ollama vision model for screenshots (default: {DEFAULT_VISION_MODEL})",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Blender addon host (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=9876,
        help="Blender addon port (default: 9876)",
    )
    parser.add_argument(
        "--ollama-host",
        default=None,
        help="Ollama API host URL (default: http://localhost:11434)",
    )
    parser.add_argument(
        "--think",
        action="store_true",
        default=False,
        help="Enable thinking mode (chain-of-thought reasoning before tool calls)",
    )
    args = parser.parse_args()

    session = BlenderChatSession(
        chat_model=args.model,
        vision_model=args.vision_model,
        host=args.host,
        port=args.port,
        ollama_host=args.ollama_host,
        think=args.think,
    )

    ollama_display = args.ollama_host or "localhost:11434"
    think_display = " | think: on" if args.think else ""
    print(f"blend-ai chat | model: {args.model} | vision: {args.vision_model}{think_display}")
    print(f"Ollama: {ollama_display}")
    print(f"Connecting to Blender at {args.host}:{args.port}...")

    try:
        session.initialize()
        print("Connected. Type 'quit' to exit.\n")
    except BlenderConnectionError as e:
        print(f"Error: {e}")
        sys.exit(1)

    try:
        while True:
            try:
                user_input = input("You: ").strip()
            except EOFError:
                break

            if not user_input:
                continue
            if user_input.lower() in ("quit", "exit", "q"):
                break

            tools_query = parse_tools_command(user_input)
            if tools_query is not None:
                print(f"\n{session.list_tools(tools_query)}\n")
                continue

            parsed_img = parse_image_command(user_input)
            if parsed_img is not None:
                image_path, message = parsed_img
                try:
                    response = session._handle_image_command(image_path, message)
                    print(f"\nAssistant: {response}\n")
                except FileNotFoundError:
                    print(f"Error: Image file not found: {image_path}")
                except ValueError as e:
                    print(f"Error: {e}")
                except OSError as e:
                    print(f"Error reading image: {e}")
                continue

            try:
                response = session.chat(user_input)
                print(f"\nAssistant: {response}\n")
            except Exception as e:
                print(f"\nError: {e}\n")
    except KeyboardInterrupt:
        print("\n")
    finally:
        session.close()
        print("Disconnected from Blender.")


if __name__ == "__main__":
    main()
