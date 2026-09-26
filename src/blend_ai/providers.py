"""Model provider registry for the chat app.

Every provider the chat UI can talk to is described here once: how to list
its models, which ones can actually drive the tool loop, and how to build
the backend for a chosen model. Adding a provider that speaks the OpenAI
chat-completions protocol is a single ProviderSpec entry.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

from blend_ai.ollama_chat import (
    AnthropicBackend,
    GeminiBackend,
    OllamaBackend,
    OpenAICompatBackend,
)


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    # "openai" (any /v1/chat/completions server), "anthropic", "gemini", "ollama"
    kind: str
    description: str
    base_url: str = ""
    # Local/self-hosted providers let the user edit the server URL.
    editable_url: bool = False
    key_env: str = ""
    # False when the provider works without any key (local servers) or the
    # SDK can find credentials on its own (Anthropic's `ant auth login`).
    requires_key: bool = False
    # Preferred defaults, best first — the first one the server offers wins.
    preferred_models: tuple[str, ...] = ()
    headers: dict[str, str] = field(default_factory=dict)
    icon: str = "bot"


PROVIDERS: dict[str, ProviderSpec] = {p.id: p for p in [
    ProviderSpec(
        id="lmstudio", label="LM Studio", kind="openai", icon="laptop",
        description="Local models served by LM Studio (or llama.cpp / vLLM).",
        base_url="http://127.0.0.1:1234/v1", editable_url=True,
    ),
    ProviderSpec(
        id="ollama", label="Ollama", kind="ollama", icon="laptop",
        description="Local models pulled with Ollama.",
        base_url="http://127.0.0.1:11434", editable_url=True,
        preferred_models=("qwen2.5-coder:14b", "qwen3", "llama3.1"),
    ),
    ProviderSpec(
        id="anthropic", label="Anthropic Claude", kind="anthropic", icon="sparkles",
        description="Claude models — strongest tool use for long multi-step builds.",
        key_env="ANTHROPIC_API_KEY",
        preferred_models=("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"),
    ),
    ProviderSpec(
        id="openai", label="OpenAI", kind="openai", icon="cloud",
        description="GPT models via the OpenAI API.",
        base_url="https://api.openai.com/v1", key_env="OPENAI_API_KEY", requires_key=True,
    ),
    ProviderSpec(
        id="gemini", label="Google Gemini", kind="gemini", icon="cloud",
        description="Gemini models via Google AI Studio.",
        key_env="GEMINI_API_KEY", requires_key=True,
    ),
    ProviderSpec(
        id="openrouter", label="OpenRouter", kind="openai", icon="network",
        description="Hundreds of models from many vendors behind one key.",
        base_url="https://openrouter.ai/api/v1", key_env="OPENROUTER_API_KEY", requires_key=True,
        preferred_models=(
            "anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "openai/gpt-5",
            "google/gemini-2.5-pro", "google/gemini-2.5-flash",
        ),
        headers={"HTTP-Referer": "https://github.com/Gopikrish-30/Agent-Blend", "X-Title": "Agent-Blend"},
    ),
    ProviderSpec(
        id="groq", label="Groq", kind="openai", icon="zap",
        description="Very fast hosted open models.",
        base_url="https://api.groq.com/openai/v1", key_env="GROQ_API_KEY", requires_key=True,
    ),
    ProviderSpec(
        id="deepseek", label="DeepSeek", kind="openai", icon="cloud",
        description="DeepSeek chat and reasoning models.",
        base_url="https://api.deepseek.com/v1", key_env="DEEPSEEK_API_KEY", requires_key=True,
    ),
    ProviderSpec(
        id="mistral", label="Mistral", kind="openai", icon="cloud",
        description="Mistral's hosted models.",
        base_url="https://api.mistral.ai/v1", key_env="MISTRAL_API_KEY", requires_key=True,
    ),
    ProviderSpec(
        id="xai", label="xAI Grok", kind="openai", icon="cloud",
        description="Grok models via the xAI API.",
        base_url="https://api.x.ai/v1", key_env="XAI_API_KEY", requires_key=True,
    ),
    ProviderSpec(
        id="custom", label="Custom (OpenAI-compatible)", kind="openai", icon="server",
        description="Any other server that speaks the OpenAI chat-completions API.",
        base_url="http://127.0.0.1:8080/v1", editable_url=True, key_env="CUSTOM_OPENAI_API_KEY",
    ),
]}

DEFAULT_PROVIDER = "lmstudio"

# Substrings marking a model as not usable for a tool-calling chat loop —
# embeddings, speech, image generation, moderation, and Gemini's
# specialized previews that list fine but reject function calling.
_NON_CHAT_MARKERS = (
    "embed", "whisper", "tts", "audio", "realtime", "transcribe", "dall-e", "image",
    "moderation", "rerank", "guard", "search", "aqa", "banana", "video", "robotics",
    "lyria", "antigravity", "code-mender", "deep-research", "computer-use", "bidi", "live",
    "babbage", "davinci", "sora",
)


def is_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    return not any(marker in lowered for marker in _NON_CHAT_MARKERS)


def normalize_openai_base_url(url: str) -> str:
    """LM Studio and most OpenAI-compatible servers serve the API under /v1,
    but their UIs show the bare host:port. Append /v1 unless the URL already
    ends in a version segment."""
    stripped = url.rstrip("/")
    if re.search(r"/v\d+$", stripped):
        return stripped
    return stripped + "/v1"


def resolve_key(spec: ProviderSpec, api_key: str = "") -> str:
    """A key typed in settings wins; otherwise the provider's env var."""
    return (api_key or "").strip() or (os.environ.get(spec.key_env, "") if spec.key_env else "")


def resolve_url(spec: ProviderSpec, base_url: str = "") -> str:
    url = (base_url or "").strip() if spec.editable_url else ""
    url = url or spec.base_url
    return normalize_openai_base_url(url) if spec.kind == "openai" else url


def list_models(provider_id: str, base_url: str = "", api_key: str = "") -> tuple[list[str], str]:
    """Models the provider reports right now, plus an error string ("" on
    success) so an unreachable server, a bad key, and a genuinely empty
    server don't all look like the same "no models" to the user."""
    spec = PROVIDERS[provider_id]
    key = resolve_key(spec, api_key)
    if spec.requires_key and not key:
        return [], f"No API key — paste one in settings or set {spec.key_env}."
    url = resolve_url(spec, base_url)
    try:
        if spec.kind == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
            ids = [m.id for m in client.models.list(limit=100)]
        elif spec.kind == "gemini":
            from google import genai
            ids = []
            for m in genai.Client(api_key=key).models.list():
                name = getattr(m, "name", None) or (m.get("name") if isinstance(m, dict) else None)
                if name:
                    ids.append(name.removeprefix("models/"))
        elif spec.kind == "ollama":
            from ollama import Client
            ids = [m.model for m in Client(host=url).list().models]
        else:
            from openai import OpenAI
            client = OpenAI(base_url=url, api_key=key or "not-needed", default_headers=spec.headers or None)
            ids = []
            for m in client.models.list().data:
                # OpenRouter reports which parameters each model accepts;
                # skip the ones that can't take tools at all.
                params = (getattr(m, "model_extra", None) or {}).get("supported_parameters")
                if params is not None and "tools" not in params:
                    continue
                ids.append(m.id)
    except Exception as e:  # noqa: BLE001 — surfaced verbatim to the user
        if "connect" in type(e).__name__.lower() or "connection" in str(e).lower():
            where = url or spec.label
            hint = (
                " Check the server is running and the URL/port is right. If it's on another "
                "computer, turn on LM Studio's “Serve on Local Network” and use that computer's IP."
                if spec.editable_url else " Check your network connection."
            )
            return [], f"Couldn't reach {where}.{hint}"
        return [], f"{type(e).__name__}: {e}"

    ids = sorted({i for i in ids if is_chat_model(i)})
    return order_models(spec, ids), ""


def order_models(spec: ProviderSpec, ids: list[str]) -> list[str]:
    """Preferred models first (in preference order), then the rest."""
    preferred = [p for p in spec.preferred_models if p in ids]
    return preferred + [i for i in ids if i not in preferred]


def pick_default_model(provider_id: str, models: list[str], current: str | None = None) -> str | None:
    if current and current in models:
        return current
    return models[0] if models else None


def make_backend(provider_id: str, model: str, base_url: str = "", api_key: str = "") -> Any:
    spec = PROVIDERS[provider_id]
    key = resolve_key(spec, api_key)
    url = resolve_url(spec, base_url)
    if spec.kind == "anthropic":
        return AnthropicBackend(model, api_key=key)
    if spec.kind == "gemini":
        return GeminiBackend(model, api_key=key)
    if spec.kind == "ollama":
        return OllamaBackend(model, host=url)
    return OpenAICompatBackend(model, base_url=url, api_key=key, default_headers=spec.headers or None)
