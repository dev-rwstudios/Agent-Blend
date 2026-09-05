"""Tests for blend_ai.tool_registry."""

from blend_ai.tool_registry import get_tools_by_module


def _fake_registered_tool(module_name: str):
    class _Fn:
        pass

    fn = _Fn()
    fn.__module__ = module_name

    class _RegisteredTool:
        pass

    t = _RegisteredTool()
    t.fn = fn
    return t


class _FakeToolManager:
    def __init__(self, tools_by_name):
        self._tools = tools_by_name


class _FakeMCP:
    def __init__(self, ollama_tools, module_by_name):
        self._ollama_tools = ollama_tools
        self._tool_manager = _FakeToolManager(
            {name: _fake_registered_tool(module) for name, module in module_by_name.items()}
        )


class TestGetToolsByModule:
    def test_groups_by_short_module_name(self, monkeypatch):
        ollama_tools = [
            {"type": "function", "function": {"name": "create_object", "description": "Create."}},
            {"type": "function", "function": {"name": "delete_object", "description": "Delete."}},
            {"type": "function", "function": {"name": "set_material_color", "description": "Color."}},
        ]
        mcp = _FakeMCP(
            ollama_tools,
            module_by_name={
                "create_object": "blend_ai.tools.objects",
                "delete_object": "blend_ai.tools.objects",
                "set_material_color": "blend_ai.tools.materials",
            },
        )
        monkeypatch.setattr(
            "blend_ai.tool_registry.get_ollama_tools", lambda server: ollama_tools
        )

        grouped = get_tools_by_module(mcp)

        assert set(grouped.keys()) == {"objects", "materials"}
        assert {t["function"]["name"] for t in grouped["objects"]} == {"create_object", "delete_object"}
        assert {t["function"]["name"] for t in grouped["materials"]} == {"set_material_color"}

    def test_every_tool_appears_exactly_once(self, monkeypatch):
        ollama_tools = [
            {"type": "function", "function": {"name": "a", "description": ""}},
            {"type": "function", "function": {"name": "b", "description": ""}},
        ]
        mcp = _FakeMCP(
            ollama_tools,
            module_by_name={"a": "blend_ai.tools.curves", "b": "blend_ai.tools.curves"},
        )
        monkeypatch.setattr(
            "blend_ai.tool_registry.get_ollama_tools", lambda server: ollama_tools
        )

        grouped = get_tools_by_module(mcp)

        total = sum(len(v) for v in grouped.values())
        assert total == len(ollama_tools)

    def test_skips_registered_tools_missing_from_ollama_list(self, monkeypatch):
        # e.g. a tool the ollama-schema conversion couldn't represent —
        # get_tools_by_module should silently drop it rather than crash.
        ollama_tools = [{"type": "function", "function": {"name": "a", "description": ""}}]
        mcp = _FakeMCP(
            ollama_tools,
            module_by_name={"a": "blend_ai.tools.curves", "orphan": "blend_ai.tools.curves"},
        )
        monkeypatch.setattr(
            "blend_ai.tool_registry.get_ollama_tools", lambda server: ollama_tools
        )

        grouped = get_tools_by_module(mcp)

        names = {t["function"]["name"] for tools in grouped.values() for t in tools}
        assert names == {"a"}

    def test_missing_module_falls_back_to_other(self, monkeypatch):
        ollama_tools = [{"type": "function", "function": {"name": "a", "description": ""}}]
        mcp = _FakeMCP(ollama_tools, module_by_name={"a": ""})
        monkeypatch.setattr(
            "blend_ai.tool_registry.get_ollama_tools", lambda server: ollama_tools
        )

        grouped = get_tools_by_module(mcp)

        assert "other" in grouped

    def test_against_the_real_mcp_server(self):
        """Sanity check against the actual registered server — every tool
        lands in exactly one group, and the total matches list_tools()."""
        from blend_ai.server import mcp
        from blend_ai.tool_registry import get_ollama_tools

        grouped = get_tools_by_module(mcp)
        total = sum(len(v) for v in grouped.values())
        assert total == len(get_ollama_tools(mcp))
        assert "objects" in grouped
        assert "other" not in grouped
