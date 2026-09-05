"""Registry that extracts tool definitions from FastMCP for use with Ollama."""

import asyncio
from typing import Any

# Full docstrings are meant for a human reading !tools or an MCP client's
# tool browser — some run past 3000 characters (import_asset's placement
# rules, for instance). Baked as-is into every tool's schema and repeated
# across 177 tools, that schema alone came to ~30,600 tokens (measured via
# json.dumps), enough on its own to blow past an 8K-context local model
# before a single token of actual conversation. These caps keep the model-
# facing schema small regardless of provider; get_scene_info-style full
# detail is still available to any client that reads tool docs directly.
_TOOL_DESC_MAX_LEN = 200
_PARAM_DESC_MAX_LEN = 100


def _truncate_desc(text: str, max_len: int) -> str:
    """Shorten a description for the schema sent to a model, preferring a
    sentence boundary within budget over a mid-word cut."""
    text = text.strip()
    if len(text) <= max_len:
        return text
    period = text.rfind(".", 0, max_len)
    if period > max_len * 0.4:
        return text[: period + 1]
    return text[: max_len - 1].rstrip() + "…"


def get_ollama_tools(mcp_server: Any) -> list[dict[str, Any]]:
    """Convert all registered MCP tools to Ollama tool-call format.

    Args:
        mcp_server: A FastMCP server instance with registered tools.

    Returns:
        List of tool definitions in Ollama's format.
    """
    mcp_tools = asyncio.run(mcp_server.list_tools())
    ollama_tools: list[dict[str, Any]] = []

    for tool in mcp_tools:
        schema = tool.inputSchema
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        clean_props: dict[str, Any] = {}
        for name, prop in properties.items():
            clean_prop: dict[str, Any] = {
                "type": _map_json_type(prop.get("type", "string")),
            }
            if "description" in prop:
                clean_prop["description"] = _truncate_desc(prop["description"], _PARAM_DESC_MAX_LEN)
            if "title" in prop:
                clean_prop["title"] = prop["title"]
            if "default" in prop:
                clean_prop["default"] = prop["default"]
            if "enum" in prop:
                clean_prop["enum"] = prop["enum"]
            if "items" in prop:
                clean_prop["items"] = prop["items"]
            clean_props[name] = clean_prop

        ollama_tool: dict[str, Any] = {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": _truncate_desc(tool.description or "", _TOOL_DESC_MAX_LEN),
                "parameters": {
                    "type": "object",
                    "properties": clean_props,
                    "required": required,
                },
            },
        }
        ollama_tools.append(ollama_tool)

    return ollama_tools


def get_tools_by_module(mcp_server: Any) -> dict[str, list[dict[str, Any]]]:
    """Group Ollama-format tool definitions by the blend_ai.tools module that
    registered them.

    Reads the module each tool's underlying function was defined in straight
    off FastMCP's internal tool manager, so the grouping always reflects
    whatever's actually registered (24 modules today) instead of a
    hand-maintained name-to-category table that would drift as tools are
    added.

    Args:
        mcp_server: A FastMCP server instance with registered tools.

    Returns:
        Dict mapping short module name (e.g. "objects", "mesh_editing") to
        its list of Ollama-format tool definitions.
    """
    tool_lookup = {t["function"]["name"]: t for t in get_ollama_tools(mcp_server)}

    grouped: dict[str, list[dict[str, Any]]] = {}
    for name, registered_tool in mcp_server._tool_manager._tools.items():
        tool_def = tool_lookup.get(name)
        if tool_def is None:
            continue
        module_name = getattr(registered_tool.fn, "__module__", "") or ""
        short_name = module_name.rsplit(".", 1)[-1] if module_name else "other"
        grouped.setdefault(short_name, []).append(tool_def)

    return grouped


def _map_json_type(json_type: str) -> str:
    """Map JSON Schema types to Ollama-compatible types."""
    type_map = {
        "string": "string",
        "integer": "integer",
        "number": "number",
        "boolean": "boolean",
        "array": "array",
        "object": "object",
    }
    return type_map.get(json_type, "string")
