"""Tests for the chat app upgrade: provider registry, Anthropic backend,
and the session features the studio UI relies on (read-only modes, usage
accounting, cancellation, toolsets, mutation tracking)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from blend_ai import providers
from blend_ai.ollama_chat import (
    AnthropicBackend,
    BlenderChatSession,
    OpenAICompatBackend,
    _anthropic_messages,
    _openai_status_message,
    is_read_only_tool,
)


# ---- provider registry ------------------------------------------------------

class TestProviders:
    def test_every_provider_has_a_known_kind(self):
        for spec in providers.PROVIDERS.values():
            assert spec.kind in {"openai", "anthropic", "gemini", "ollama"}
        assert providers.DEFAULT_PROVIDER in providers.PROVIDERS

    @pytest.mark.parametrize("url,expected", [
        ("http://127.0.0.1:1234", "http://127.0.0.1:1234/v1"),
        ("http://127.0.0.1:1234/", "http://127.0.0.1:1234/v1"),
        ("https://api.groq.com/openai/v1", "https://api.groq.com/openai/v1"),
        ("http://host/api/v2/", "http://host/api/v2"),
    ])
    def test_normalize_openai_base_url(self, url, expected):
        assert providers.normalize_openai_base_url(url) == expected

    @pytest.mark.parametrize("model,ok", [
        ("gpt-5", True),
        ("Qwen2.5-7B-Instruct", True),
        ("text-embedding-3-large", False),
        ("whisper-1", False),
        ("gemini-2.5-flash-image", False),
        ("davinci-002", False),
    ])
    def test_is_chat_model(self, model, ok):
        assert providers.is_chat_model(model) is ok

    def test_preferred_models_come_first(self):
        spec = providers.PROVIDERS["anthropic"]
        ordered = providers.order_models(spec, ["a-model", "claude-haiku-4-5", "claude-opus-5"])
        assert ordered == ["claude-opus-5", "claude-haiku-4-5", "a-model"]

    def test_typed_key_overrides_env(self, monkeypatch):
        spec = providers.PROVIDERS["openai"]
        monkeypatch.setenv("OPENAI_API_KEY", "env-key")
        assert providers.resolve_key(spec, "") == "env-key"
        assert providers.resolve_key(spec, "  typed ") == "typed"

    def test_fixed_url_providers_ignore_user_url(self):
        spec = providers.PROVIDERS["groq"]
        assert providers.resolve_url(spec, "http://evil.example") == spec.base_url

    def test_missing_required_key_is_reported_without_network(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        models, error = providers.list_models("groq")
        assert models == []
        assert "GROQ_API_KEY" in error

    def test_pick_default_model_keeps_current(self):
        assert providers.pick_default_model("x", ["a", "b"], "b") == "b"
        assert providers.pick_default_model("x", ["a", "b"], "gone") == "a"
        assert providers.pick_default_model("x", [], None) is None

    def test_make_backend_picks_backend_class(self):
        assert isinstance(providers.make_backend("anthropic", "claude-opus-5", api_key="k"), AnthropicBackend)
        assert isinstance(providers.make_backend("openrouter", "m", api_key="k"), OpenAICompatBackend)


def test_openai_status_messages_are_actionable():
    assert "out of credits" in _openai_status_message(402, "m", Exception("x"))
    assert "wasn't found" in _openai_status_message(404, "m", Exception("x"))
    assert "HTTP 418" in _openai_status_message(418, "m", Exception("x"))


# ---- Anthropic backend ---------------------------------------------------------

class TestAnthropicMessages:
    def test_system_is_extracted(self):
        system, msgs = _anthropic_messages([
            {"role": "system", "content": "be helpful"},
            {"role": "user", "content": "hi"},
        ])
        assert system == "be helpful"
        assert msgs == [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]

    def test_tool_results_and_screenshot_share_one_user_turn(self):
        raw = [{"type": "tool_use", "id": "t1", "name": "get_viewport_screenshot", "input": {}}]
        _, msgs = _anthropic_messages([
            {"role": "user", "content": "look"},
            {"role": "assistant", "content": "", "anthropic_content": raw},
            {"role": "tool", "tool_call_id": "t1", "content": '{"image": "..."}'},
            {"role": "user", "content": "(screenshot)", "images": [{"mime": "image/png", "data": "AAA"}]},
        ])
        assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
        assert msgs[1]["content"] == raw  # echoed back verbatim
        blocks = msgs[2]["content"]
        assert blocks[0] == {"type": "tool_result", "tool_use_id": "t1", "content": '{"image": "..."}'}
        assert blocks[1]["type"] == "image"
        assert blocks[1]["source"] == {"type": "base64", "media_type": "image/png", "data": "AAA"}

    def test_tool_message_without_id_becomes_text(self):
        _, msgs = _anthropic_messages([
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "calling create_object"},
            {"role": "tool", "content": "ok"},
        ])
        assert msgs[-1]["content"] == [{"type": "text", "text": "Tool result: ok"}]

    def test_empty_text_is_never_sent(self):
        _, msgs = _anthropic_messages([{"role": "user", "content": ""}])
        assert msgs[0]["content"][0]["text"]


def _anthropic_response(content, stop_reason="end_turn"):
    usage = SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=100,
                            cache_creation_input_tokens=0)
    return SimpleNamespace(content=content, stop_reason=stop_reason, usage=usage, stop_details=None)


def _block(**kw):
    b = SimpleNamespace(**kw)
    b.model_dump = lambda exclude_none=True: dict(kw)
    return b


TOOLS = [
    {"type": "function", "function": {"name": "create_object", "description": "d",
                                      "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_scene_info", "description": "d", "parameters": {}}},
]


class TestAnthropicBackend:
    def test_tool_use_is_normalized_and_cached(self):
        backend = AnthropicBackend("claude-sonnet-5", api_key="k")
        backend.client = MagicMock()
        backend.client.messages.create.return_value = _anthropic_response([
            _block(type="text", text="Adding a cube."),
            _block(type="tool_use", id="tu_1", name="create_object", input={"type": "CUBE"}),
        ], stop_reason="tool_use")

        content, calls, raw = backend.step(
            [{"role": "system", "content": "sys"}, {"role": "user", "content": "cube"}], TOOLS,
        )

        assert content == "Adding a cube."
        assert calls == [{"id": "tu_1", "name": "create_object", "arguments": {"type": "CUBE"}}]
        assert raw["anthropic_content"][1]["type"] == "tool_use"
        kwargs = backend.client.messages.create.call_args.kwargs
        assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}
        assert kwargs["tools"][-1]["cache_control"] == {"type": "ephemeral"}
        assert "cache_control" not in kwargs["tools"][0]
        assert kwargs["tools"][1]["input_schema"] == {"type": "object", "properties": {}}
        assert backend.last_usage == {"input": 110, "output": 5}

    def test_opus_5_uses_server_side_fallbacks(self):
        backend = AnthropicBackend("claude-opus-5", api_key="k")
        backend.client = MagicMock()
        backend.client.beta.messages.create.return_value = _anthropic_response([_block(type="text", text="ok")])
        backend.step([{"role": "user", "content": "hi"}], TOOLS)
        kwargs = backend.client.beta.messages.create.call_args.kwargs
        assert kwargs["fallbacks"] == "default"
        assert kwargs["betas"] == ["server-side-fallback-2026-07-01"]

    def test_refusal_returns_text_without_tool_calls(self):
        backend = AnthropicBackend("claude-sonnet-5", api_key="k")
        backend.client = MagicMock()
        backend.client.messages.create.return_value = _anthropic_response([], stop_reason="refusal")
        content, calls, _ = backend.step([{"role": "user", "content": "x"}], TOOLS)
        assert calls == []
        assert "declined" in content


# ---- session features ---------------------------------------------------------

class ScriptedBackend:
    """Returns the queued (content, tool_calls) steps in order."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.calls = 0
        self.last_usage = {"input": 100, "output": 10}

    def step(self, messages, tools):
        self.calls += 1
        content, calls = self.steps.pop(0)
        raw = {"role": "assistant", "content": content}
        return content, calls, raw


@pytest.fixture
def session_factory():
    sample = TOOLS
    with patch("blend_ai.ollama_chat.OllamaClient"), \
         patch("blend_ai.ollama_chat.get_ollama_tools", return_value=sample), \
         patch("blend_ai.connection.BlenderConnection") as conn_cls:
        conn_cls.return_value = MagicMock()

        def make(steps, **kw):
            session = BlenderChatSession(backend=ScriptedBackend(steps), **kw)
            session.initialize()
            session.execute_tool = MagicMock(return_value='{"status": "ok"}')
            return session
        yield make


CREATE = [{"id": "c1", "name": "create_object", "arguments": {"type": "CUBE"}}]
LOOKUP = [{"id": "c2", "name": "get_scene_info", "arguments": {}}]


class TestSessionFeatures:
    def test_read_only_mode_refuses_mutations(self, session_factory):
        session = session_factory([("", CREATE), ("done", [])])
        session.read_only_reason = "Ask mode is read-only."
        assert session.chat("make a cube") == "done"
        session.execute_tool.assert_not_called()
        refusal = next(m for m in session.messages if m["role"] == "tool")
        assert "Ask mode is read-only." in refusal["content"]
        assert session.turn_mutations == []

    def test_read_only_mode_still_runs_lookups(self, session_factory):
        session = session_factory([("", LOOKUP), ("done", [])])
        session.read_only_reason = "plan mode"
        session.chat("what's here?")
        session.execute_tool.assert_called_once_with("get_scene_info", {})
        assert session.turn_mutations == []

    def test_mutations_are_tracked(self, session_factory):
        session = session_factory([("", CREATE), ("", LOOKUP), ("done", [])])
        session.chat("cube")
        assert session.turn_mutations == ["create_object"]

    def test_usage_accumulates_per_turn_and_total(self, session_factory):
        session = session_factory([("", LOOKUP), ("a", []), ("b", [])])
        session.chat("one")
        assert session.turn_usage == {"input": 200, "output": 20}
        session.chat("two")
        assert session.turn_usage == {"input": 100, "output": 10}
        assert session.total_usage == {"input": 300, "output": 30}

    def test_cancel_stops_before_next_round(self, session_factory):
        session = session_factory([("", CREATE), ("never", [])])

        def cancel_during_tool(name, args):
            session.cancel_requested = True
            return '{"status": "ok"}'
        session.execute_tool = MagicMock(side_effect=cancel_during_tool)

        assert session.chat("cube") == "(Stopped.)"
        assert session.backend.calls == 1

    def test_core_toolset_filters_tools(self, session_factory):
        session = session_factory([])
        full_names = {t["function"]["name"] for t in session.tools}

        with patch("blend_ai.ollama_chat.get_ollama_tools", return_value=TOOLS):
            core = BlenderChatSession(backend=ScriptedBackend([]))
            core.toolset = "core"
            with patch("blend_ai.connection.BlenderConnection"):
                core.initialize()
        core_names = {t["function"]["name"] for t in core.tools}
        assert core_names <= full_names
        assert "populate_scene" in core_names
        assert set(core.tools_by_module) <= {
            "objects", "transforms", "modeling", "materials", "lighting", "camera",
            "scene", "screenshot", "rendering", "asset_library", "scene_agent",
        }


def test_read_only_classification():
    assert is_read_only_tool("get_scene_info")
    assert is_read_only_tool("search_asset_library")
    assert is_read_only_tool("render_image")
    assert not is_read_only_tool("create_object")
    assert not is_read_only_tool("populate_scene")


# ---- context overflow ---------------------------------------------------------

@pytest.mark.parametrize("message,expected", [
    ("The number of tokens to keep from the initial prompt is greater than the context length "
     "(n_keep: 35085>= n_ctx: 32768).", True),
    ("This model's maximum context length is 128000 tokens.", True),
    ("prompt is too long: 250000 tokens > 200000 maximum", True),
    ("Invalid API key", False),
])
def test_is_context_overflow(message, expected):
    from blend_ai.ollama_chat import is_context_overflow
    assert is_context_overflow(message) is expected


def test_openai_backend_raises_context_overflow():
    import httpx2 as httpx
    import openai
    from blend_ai.ollama_chat import ContextOverflowError

    backend = OpenAICompatBackend("local-model", base_url="http://127.0.0.1:1234/v1")
    request = httpx.Request("POST", "http://127.0.0.1:1234/v1/chat/completions")
    response = httpx.Response(400, request=request)
    backend.client = MagicMock()
    backend.client.chat.completions.create.side_effect = openai.BadRequestError(
        "Error code: 400 - n_keep: 35085>= n_ctx: 32768", response=response, body=None,
    )
    with pytest.raises(ContextOverflowError):
        backend.step([{"role": "user", "content": "hi"}], TOOLS)
