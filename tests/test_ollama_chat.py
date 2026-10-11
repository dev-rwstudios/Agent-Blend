"""Tests for blend_ai.ollama_chat."""

import json
import pytest
from unittest.mock import MagicMock, patch

import blend_ai.server
from blend_ai.ollama_chat import (
    BlenderChatSession,
    _build_tool_list,
    _compact_tool_result_for_context,
    _format_args,
    _parse_text_tool_calls,
    _strip_tool_markup,
    _find_similar_tools,
    parse_image_command,
    parse_tools_command,
    format_tools_listing,
    load_image_as_base64,
    SUPPORTED_IMAGE_FORMATS,
    SYSTEM_PROMPT_BASE,
    DEFAULT_CHAT_MODEL,
    DEFAULT_VISION_MODEL,
)


@pytest.fixture
def mock_ollama_client():
    """Mock the OllamaClient instance."""
    with patch("blend_ai.ollama_chat.OllamaClient") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        yield mock_client


@pytest.fixture
def mock_blender_connection():
    """Mock BlenderConnection for chat session."""
    with patch("blend_ai.connection.BlenderConnection") as mock_cls:
        mock_conn = MagicMock()
        mock_conn.send_command.return_value = {"status": "ok", "result": {"name": "Cube"}}
        mock_cls.return_value = mock_conn
        # Also patch the server module's connection
        with patch("blend_ai.server._connection", mock_conn, create=True):
            with patch("blend_ai.server.get_connection", return_value=mock_conn):
                yield mock_conn


@pytest.fixture
def mock_mcp_tools():
    """Mock the tool registry to return sample tools."""
    sample_tools = [
        {
            "type": "function",
            "function": {
                "name": "create_object",
                "description": "Create a primitive object.",
                "parameters": {
                    "type": "object",
                    "properties": {"type": {"type": "string"}},
                    "required": ["type"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_viewport_screenshot",
                "description": "Capture viewport.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        },
    ]
    with patch("blend_ai.ollama_chat.get_ollama_tools", return_value=sample_tools):
        yield sample_tools


class TestConstants:
    def test_max_tool_rounds_is_25(self):
        from blend_ai.ollama_chat import MAX_TOOL_ROUNDS
        assert MAX_TOOL_ROUNDS == 25

    def test_system_prompt_has_modeling_strategy(self):
        assert "Modeling strategy" in SYSTEM_PROMPT_BASE

    def test_system_prompt_organic_uses_sculpt(self):
        assert "sculpt" in SYSTEM_PROMPT_BASE.lower() or "Sculpt" in SYSTEM_PROMPT_BASE

    def test_system_prompt_hard_surface_box_model(self):
        assert "hard surface" in SYSTEM_PROMPT_BASE.lower() or "hard-surface" in SYSTEM_PROMPT_BASE.lower()

    def test_system_prompt_has_planning_step(self):
        assert "plan" in SYSTEM_PROMPT_BASE.lower()

    def test_system_prompt_mentions_boolean(self):
        assert "boolean" in SYSTEM_PROMPT_BASE.lower() or "Boolean" in SYSTEM_PROMPT_BASE

    def test_system_prompt_mentions_subdivision(self):
        assert "subdivision" in SYSTEM_PROMPT_BASE.lower() or "Subdivision" in SYSTEM_PROMPT_BASE


class TestBlenderChatSession:
    def test_init_defaults(self, mock_ollama_client):
        session = BlenderChatSession()
        assert session.chat_model == DEFAULT_CHAT_MODEL
        assert session.vision_model == DEFAULT_VISION_MODEL

    def test_init_custom_params(self, mock_ollama_client):
        session = BlenderChatSession(
            chat_model="llama3",
            vision_model="llava:34b",
            host="192.168.1.1",
            port=1234,
        )
        assert session.chat_model == "llama3"
        assert session.vision_model == "llava:34b"

    def test_init_ollama_host(self):
        with patch("blend_ai.ollama_chat.OllamaClient") as mock_cls:
            BlenderChatSession(ollama_host="http://myserver:11434")
            mock_cls.assert_called_with(host="http://myserver:11434")

    def test_initialize(self, mock_ollama_client, mock_blender_connection, mock_mcp_tools):
        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            mock_blender_connection.connect.assert_called_once()
            assert len(session.tools) == 3
            assert "create_object" in session._tool_names
            assert "get_viewport_screenshot" in session._tool_names
            assert session.messages[0]["role"] == "system"
            assert "Tool selection" in session.messages[0]["content"]

    def test_initialize_populates_tools_by_module(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        # tools_by_module is derived from the real, always-registered mcp
        # server (not the mocked 2-tool sample), so it reflects the real
        # ~177-tool catalog regardless of what get_ollama_tools() is mocked
        # to return elsewhere in this fixture set.
        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            assert "objects" in session.tools_by_module
            assert len(session.tools_by_module) > 1

    def test_list_tools_delegates_to_loaded_catalog(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            overview = session.list_tools()
            assert "tools across" in overview
            filtered = session.list_tools("objects")
            assert "objects" in filtered.lower()

    def test_execute_tool(self, mock_ollama_client, mock_blender_connection):
        """Test tool execution routes through MCP call_tool."""
        mock_text = MagicMock()
        mock_text.text = '{"name": "Cube"}'

        async def _fake_call_tool(name, args):
            return [mock_text]

        with patch("blend_ai.server.mcp") as mock_mcp:
            mock_mcp.call_tool = _fake_call_tool
            session = BlenderChatSession()
            result = session.execute_tool("create_object", {"type": "CUBE"})
            parsed = json.loads(result)
            assert parsed["name"] == "Cube"

    def test_execute_tool_error(self, mock_ollama_client, mock_blender_connection):
        """Test tool execution handles errors gracefully."""
        async def _failing_call_tool(name, args):
            raise RuntimeError("Blender error: not found")

        with patch("blend_ai.server.mcp") as mock_mcp:
            mock_mcp.call_tool = _failing_call_tool
            session = BlenderChatSession()
            result = session.execute_tool("create_object", {"type": "CUBE"})
            parsed = json.loads(result)
            assert parsed["status"] == "error"

    def test_chat_simple_response(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """Test chat with no tool calls — just a text response."""
        mock_response = MagicMock()
        mock_response.message.tool_calls = None
        mock_response.message.content = "I'll help you with Blender!"
        mock_ollama_client.chat.return_value = mock_response

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            result = session.chat("Hello")

        assert result == "I'll help you with Blender!"

    def test_chat_with_native_tool_call(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """Test chat with native Ollama tool call."""
        tool_response = MagicMock()
        tool_call = MagicMock()
        tool_call.function.name = "create_object"
        tool_call.function.arguments = {"type": "CUBE"}
        tool_response.message.tool_calls = [tool_call]
        tool_response.message.content = ""

        final_response = MagicMock()
        final_response.message.tool_calls = None
        final_response.message.content = "Created a cube!"

        mock_ollama_client.chat.side_effect = [tool_response, final_response]

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            with patch.object(BlenderChatSession, "execute_tool", return_value='{"name": "Cube"}'):
                session = BlenderChatSession()
                session.initialize()
                result = session.chat("Create a cube")

        assert result == "Created a cube!"

    def test_chat_with_text_tool_call_fallback(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """Test chat when model outputs tool calls as XML text."""
        text_response = MagicMock()
        text_response.message.tool_calls = None
        text_response.message.content = (
            '<function=create_object><parameter=type>CUBE</parameter></function>\n'
            '</tool_call>'
        )

        final_response = MagicMock()
        final_response.message.tool_calls = None
        final_response.message.content = "Done! Created a cube."

        mock_ollama_client.chat.side_effect = [text_response, final_response]

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            with patch.object(BlenderChatSession, "execute_tool", return_value='{"name": "Cube"}'):
                session = BlenderChatSession()
                session.initialize()
                result = session.chat("Make a cube")

        assert result == "Done! Created a cube."

    def test_chat_screenshot_injects_image_for_active_backend(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """After a screenshot tool call, the raw image is attached to a
        follow-up user-role message so the active backend sees it directly —
        this replaced the old separate-Ollama-vision-analysis merge, since a
        "tool"-role message can't carry image content in any of these APIs,
        and every backend now has real image support via images=."""
        screenshot_result = json.dumps({"image": "base64encodeddata", "width": 1000, "height": 562})

        tool_response = MagicMock()
        tool_call = MagicMock()
        tool_call.function.name = "get_viewport_screenshot"
        tool_call.function.arguments = {}
        tool_response.message.tool_calls = [tool_call]
        tool_response.message.content = ""

        final_response = MagicMock()
        final_response.message.tool_calls = None
        final_response.message.content = "I see a default cube."

        mock_ollama_client.chat.side_effect = [tool_response, final_response]

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            with patch.object(
                BlenderChatSession, "execute_tool", return_value=screenshot_result
            ):
                session = BlenderChatSession()
                session.initialize()
                result = session.chat("Take a screenshot")

        assert result == "I see a default cube."
        image_msgs = [m for m in session.messages if m.get("role") == "user" and m.get("images")]
        assert len(image_msgs) == 1
        assert image_msgs[0]["images"] == [{"mime": "image/png", "data": "base64encodeddata"}]
        tool_msgs = [m for m in session.messages if m.get("role") == "tool"]
        assert len(tool_msgs) == 1
        assert "base64encodeddata" not in tool_msgs[0]["content"]
        assert "omitted base64 image" in tool_msgs[0]["content"]

    def test_chat_screenshot_without_image_key_no_injection(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """A screenshot result with no "image" key (e.g. an error response)
        shouldn't produce a synthetic image message."""
        screenshot_result = json.dumps({"status": "error", "result": "no viewport available"})

        tool_response = MagicMock()
        tool_call = MagicMock()
        tool_call.function.name = "get_viewport_screenshot"
        tool_call.function.arguments = {}
        tool_response.message.tool_calls = [tool_call]
        tool_response.message.content = ""

        final_response = MagicMock()
        final_response.message.tool_calls = None
        final_response.message.content = "Something went wrong capturing the viewport."

        mock_ollama_client.chat.side_effect = [tool_response, final_response]

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            with patch.object(
                BlenderChatSession, "execute_tool", return_value=screenshot_result
            ):
                session = BlenderChatSession()
                session.initialize()
                session.chat("Take a screenshot")

        image_msgs = [m for m in session.messages if m.get("role") == "user" and m.get("images")]
        assert image_msgs == []

    def test_analyze_screenshot(self, mock_ollama_client):
        """Test vision model analysis of screenshot."""
        mock_response = MagicMock()
        mock_response.message.content = "A 3D scene with a cube and a light."
        mock_ollama_client.chat.return_value = mock_response

        session = BlenderChatSession()
        result = session.analyze_screenshot("base64data", "What objects are visible?")

        mock_ollama_client.chat.assert_called_once()
        call_kwargs = mock_ollama_client.chat.call_args
        assert call_kwargs.kwargs["model"] == DEFAULT_VISION_MODEL
        msg = call_kwargs.kwargs["messages"][0]
        assert msg["role"] == "user"
        assert "base64data" in msg["images"]
        assert result == "A 3D scene with a cube and a light."

    def test_close(self, mock_ollama_client, mock_blender_connection):
        with patch("blend_ai.server._connection", mock_blender_connection):
            session = BlenderChatSession()
            session.close()
            mock_blender_connection.disconnect.assert_called_once()

    def test_execute_tool_reuses_event_loop(self, mock_ollama_client, mock_blender_connection):
        """execute_tool must reuse a cached loop, not call asyncio.run per invocation."""
        mock_text = MagicMock()
        mock_text.text = '{"status": "ok"}'

        session = BlenderChatSession()

        with patch("blend_ai.server.mcp") as mock_mcp:
            # Make call_tool return a coroutine-compatible value via run_until_complete
            async def _fake_call_tool(name, args):
                return [mock_text]

            mock_mcp.call_tool = _fake_call_tool

            with patch("asyncio.run") as mock_asyncio_run:
                session.execute_tool("create_object", {"type": "CUBE"})
                session.execute_tool("create_object", {"type": "SPHERE"})
                mock_asyncio_run.assert_not_called()

        # The session should have cached a loop
        assert session._loop is not None


class TestParseTextToolCalls:
    def test_xml_style_no_params(self):
        text = '<function=get_scene_info></function>\n</tool_call>'
        result = _parse_text_tool_calls(text, {"get_scene_info"})
        assert len(result) == 1
        assert result[0]["name"] == "get_scene_info"
        assert result[0]["arguments"] == {}

    def test_xml_style_with_params(self):
        text = (
            '<function=create_object>'
            '<parameter=type>CUBE</parameter>'
            '<parameter=name>MyCube</parameter>'
            '</function>'
        )
        result = _parse_text_tool_calls(text, {"create_object"})
        assert len(result) == 1
        assert result[0]["name"] == "create_object"
        assert result[0]["arguments"]["type"] == "CUBE"
        assert result[0]["arguments"]["name"] == "MyCube"

    def test_xml_style_numeric_param(self):
        text = '<function=set_value><parameter=count>5</parameter></function>'
        result = _parse_text_tool_calls(text, {"set_value"})
        assert result[0]["arguments"]["count"] == 5

    def test_xml_style_list_param(self):
        text = '<function=move><parameter=location>[1, 2, 3]</parameter></function>'
        result = _parse_text_tool_calls(text, {"move"})
        assert result[0]["arguments"]["location"] == [1, 2, 3]

    def test_unknown_tool_still_parsed(self):
        """Unknown tools are parsed — validation happens in the chat loop."""
        text = '<function=unknown_tool><parameter=x>1</parameter></function>'
        result = _parse_text_tool_calls(text, {"create_object"})
        assert len(result) == 1
        assert result[0]["name"] == "unknown_tool"

    def test_json_style(self):
        text = '{"name": "create_object", "arguments": {"type": "SPHERE"}}'
        result = _parse_text_tool_calls(text, {"create_object"})
        assert len(result) == 1
        assert result[0]["name"] == "create_object"
        assert result[0]["arguments"]["type"] == "SPHERE"

    def test_no_tool_calls(self):
        text = "I'll help you create a 3D model!"
        result = _parse_text_tool_calls(text, {"create_object"})
        assert len(result) == 0

    def test_multiple_xml_calls(self):
        text = (
            '<function=create_object><parameter=type>CUBE</parameter></function>\n'
            '<function=create_object><parameter=type>SPHERE</parameter></function>'
        )
        result = _parse_text_tool_calls(text, {"create_object"})
        assert len(result) == 2

    def test_json_without_arguments_key_rejected(self):
        """JSON with only 'name' key must NOT be treated as a tool call."""
        text = '{"name": "Cube", "vertices": 8}'
        result = _parse_text_tool_calls(text, {"create_object"})
        assert result == []

    def test_json_with_name_and_arguments_accepted(self):
        """JSON with both 'name' and 'arguments' keys must be treated as a tool call."""
        text = '{"name": "create_object", "arguments": {"type": "SPHERE"}}'
        result = _parse_text_tool_calls(text, {"create_object"})
        assert len(result) == 1
        assert result[0]["name"] == "create_object"
        assert result[0]["arguments"]["type"] == "SPHERE"


class TestStripToolMarkup:
    def test_strips_xml_function(self):
        text = 'Hello <function=foo><parameter=x>1</parameter></function>\n</tool_call>'
        result = _strip_tool_markup(text)
        assert "<function" not in result
        assert "</tool_call>" not in result
        assert "Hello" in result

    def test_empty_after_strip(self):
        text = '<function=foo></function></tool_call>'
        result = _strip_tool_markup(text)
        assert result == ""

    def test_preserves_plain_text(self):
        text = "Just a normal response with no markup."
        result = _strip_tool_markup(text)
        assert result == text

    def test_strips_opening_tool_call_tag(self):
        """Both opening <tool_call> and closing </tool_call> tags must be removed."""
        text = '<tool_call>\n{"name": "foo"}\n</tool_call>'
        result = _strip_tool_markup(text)
        assert "<tool_call>" not in result
        assert "</tool_call>" not in result


class TestFindSimilarTools:
    def test_finds_similar(self):
        result = _find_similar_tools("delete_all_objects", {"delete_object", "create_object"})
        assert "delete_object" in result

    def test_no_match(self):
        result = _find_similar_tools("xyz_abc", {"create_object", "delete_object"})
        assert result == []

    def test_ranked_by_overlap(self):
        result = _find_similar_tools(
            "delete_all_objects",
            {"delete_object", "create_object", "list_objects"}
        )
        # "delete_object" shares "delete" + "object" = 2 words
        assert result[0] == "delete_object"

    def test_max_results(self):
        tools = {f"tool_{i}" for i in range(20)}
        result = _find_similar_tools("tool_5", tools, max_results=3)
        assert len(result) <= 3


class TestBuildToolList:
    def test_includes_all_tools(self):
        tools = [
            {"type": "function", "function": {"name": "create_object", "description": "Create a thing. More details."}},
            {"type": "function", "function": {"name": "delete_object", "description": "Delete a thing."}},
        ]
        result = _build_tool_list(tools)
        assert "- create_object: Create a thing" in result
        assert "- delete_object: Delete a thing" in result

    def test_sorted_alphabetically(self):
        tools = [
            {"type": "function", "function": {"name": "z_tool", "description": "Z."}},
            {"type": "function", "function": {"name": "a_tool", "description": "A."}},
        ]
        result = _build_tool_list(tools)
        assert result.index("a_tool") < result.index("z_tool")


class TestCompactToolResultForContext:
    def test_replaces_screenshot_base64_with_marker(self):
        result = _compact_tool_result_for_context(
            "get_viewport_screenshot",
            json.dumps({"image": "a" * 100, "width": 1000, "height": 562}),
        )
        assert "a" * 100 not in result
        assert "omitted base64 image: 100 chars" in result

    def test_truncates_very_large_non_json_payload(self):
        payload = "x" * 20000
        result = _compact_tool_result_for_context("get_scene_info", payload)
        assert len(result) < len(payload)
        assert "truncated" in result


class TestFormatArgs:
    def test_simple_args(self):
        result = _format_args({"type": "CUBE", "name": "MyCube"})
        assert "type='CUBE'" in result
        assert "name='MyCube'" in result

    def test_truncates_long_values(self):
        long_val = "a" * 100
        result = _format_args({"data": long_val})
        assert "..." in result
        assert len(result) < 100

    def test_empty_args(self):
        assert _format_args({}) == ""

    def test_numeric_args(self):
        result = _format_args({"x": 1.5, "y": 2})
        assert "x=1.5" in result
        assert "y=2" in result


class TestParseImageCommand:
    def test_path_and_message(self):
        result = parse_image_command("!image /path/to/img.png describe this")
        assert result == ("/path/to/img.png", "describe this")

    def test_path_only_no_message(self):
        result = parse_image_command("!image /path/to/img.jpg")
        assert result == ("/path/to/img.jpg", "")

    def test_no_path_returns_none(self):
        result = parse_image_command("!image")
        assert result is None

    def test_not_image_command_returns_none(self):
        result = parse_image_command("create a cube")
        assert result is None

    def test_multi_word_message(self):
        result = parse_image_command("!image /img.png make something like this in 3D")
        assert result == ("/img.png", "make something like this in 3D")

    def test_webp_extension(self):
        result = parse_image_command("!image /ref.webp")
        assert result == ("/ref.webp", "")


class TestParseToolsCommand:
    def test_bare_command_returns_empty_query(self):
        assert parse_tools_command("!tools") == ""

    def test_command_with_query(self):
        assert parse_tools_command("!tools materials") == "materials"

    def test_command_with_multi_word_query_and_extra_spaces(self):
        assert parse_tools_command("!tools   screenshot camera  ") == "screenshot camera"

    def test_not_a_tools_command_returns_none(self):
        assert parse_tools_command("create a cube") is None

    def test_similar_but_different_command_returns_none(self):
        assert parse_tools_command("!toolsfoo") is None


class TestFormatToolsListing:
    SAMPLE = {
        "objects": [
            {"type": "function", "function": {"name": "create_object", "description": "Create a primitive object."}},
            {"type": "function", "function": {"name": "delete_object", "description": "Delete an object."}},
        ],
        "materials": [
            {"type": "function", "function": {"name": "set_material_color", "description": "Set the base color."}},
        ],
    }

    def test_no_query_shows_overview_with_counts(self):
        result = format_tools_listing(self.SAMPLE)
        assert "3 tools across 2 modules" in result
        assert "`objects` — 2 tools" in result
        assert "`materials` — 1 tools" in result
        # Overview must not spell out individual tool names.
        assert "create_object" not in result

    def test_exact_module_name_query_returns_only_that_module(self):
        result = format_tools_listing(self.SAMPLE, "materials")
        assert "set_material_color" in result
        assert "create_object" not in result

    def test_query_matches_tool_name_substring(self):
        result = format_tools_listing(self.SAMPLE, "delete")
        assert "delete_object" in result
        assert "create_object" not in result

    def test_query_matches_description_substring(self):
        result = format_tools_listing(self.SAMPLE, "primitive")
        assert "create_object" in result

    def test_query_is_case_insensitive(self):
        result = format_tools_listing(self.SAMPLE, "MATERIALS")
        assert "set_material_color" in result

    def test_no_match_returns_helpful_message(self):
        result = format_tools_listing(self.SAMPLE, "nonexistent_xyz")
        assert "No tools match" in result
        assert "!tools" in result


class TestLoadImageAsBase64:
    def test_valid_png_returns_base64(self, tmp_path):
        img_file = tmp_path / "test.png"
        img_file.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)
        result = load_image_as_base64(str(img_file))
        assert isinstance(result, str)
        assert len(result) > 0

    def test_valid_jpg_returns_base64(self, tmp_path):
        img_file = tmp_path / "test.jpg"
        img_file.write_bytes(b"\xff\xd8\xff" + b"\x00" * 10)
        result = load_image_as_base64(str(img_file))
        assert isinstance(result, str)
        assert len(result) > 0

    def test_nonexistent_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            load_image_as_base64(str(tmp_path / "missing.png"))

    def test_unsupported_extension_raises(self, tmp_path):
        bad_file = tmp_path / "photo.bmp"
        bad_file.write_bytes(b"BM\x00")
        with pytest.raises(ValueError, match="Unsupported image format"):
            load_image_as_base64(str(bad_file))

    def test_txt_extension_raises(self, tmp_path):
        txt_file = tmp_path / "notes.txt"
        txt_file.write_bytes(b"hello")
        with pytest.raises(ValueError, match="Unsupported image format"):
            load_image_as_base64(str(txt_file))


class TestSupportedImageFormats:
    def test_contains_common_formats(self):
        assert ".png" in SUPPORTED_IMAGE_FORMATS
        assert ".jpg" in SUPPORTED_IMAGE_FORMATS
        assert ".jpeg" in SUPPORTED_IMAGE_FORMATS
        assert ".webp" in SUPPORTED_IMAGE_FORMATS
        assert ".gif" in SUPPORTED_IMAGE_FORMATS

    def test_excludes_bmp(self):
        assert ".bmp" not in SUPPORTED_IMAGE_FORMATS


class TestImageCommandRouting:
    def test_image_command_calls_analyze_screenshot_not_chat_images(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """!image should call analyze_screenshot (vision model) then chat() with text — not pass images to chat()."""
        vision_description = "A detailed humanoid figure with clear muscle definition."
        mock_response = MagicMock()
        mock_response.message.tool_calls = None
        mock_response.message.content = "I'll sculpt this!"
        mock_ollama_client.chat.return_value = mock_response

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            with patch("blend_ai.ollama_chat.load_image_as_base64", return_value="base64data"):
                with patch.object(session, "analyze_screenshot", return_value=vision_description) as mock_analyze:
                    session._handle_image_command("/ref.png", "build this")
                    mock_analyze.assert_called_once_with("base64data", context="build this")

    def test_image_command_prepends_vision_description_to_chat(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """chat() receives vision description prepended to user message, no images key."""
        vision_description = "A sphere with rough surface texture."
        mock_response = MagicMock()
        mock_response.message.tool_calls = None
        mock_response.message.content = "Got it!"
        mock_ollama_client.chat.return_value = mock_response

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            with patch("blend_ai.ollama_chat.load_image_as_base64", return_value="base64data"):
                with patch.object(session, "analyze_screenshot", return_value=vision_description):
                    session._handle_image_command("/ref.png", "make this")

        user_msg = next(m for m in session.messages if m["role"] == "user")
        assert vision_description in user_msg["content"]
        assert "make this" in user_msg["content"]
        assert "images" not in user_msg


class TestChatWithImages:
    def test_chat_includes_images_in_message(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """chat() with images adds 'images' key to user message dict."""
        mock_response = MagicMock()
        mock_response.message.tool_calls = None
        mock_response.message.content = "I see the reference image!"
        mock_ollama_client.chat.return_value = mock_response

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            session.chat("Build this", images=["base64imagedata"])

        user_msg = next(m for m in session.messages if m["role"] == "user")
        assert "images" in user_msg
        assert user_msg["images"] == ["base64imagedata"]

    def test_chat_without_images_no_images_key(
        self, mock_ollama_client, mock_blender_connection, mock_mcp_tools
    ):
        """chat() without images does not add 'images' key to user message."""
        mock_response = MagicMock()
        mock_response.message.tool_calls = None
        mock_response.message.content = "Sure!"
        mock_ollama_client.chat.return_value = mock_response

        with patch("blend_ai.connection.BlenderConnection", return_value=mock_blender_connection):
            session = BlenderChatSession()
            session.initialize()
            session.chat("Hello")

        user_msg = next(m for m in session.messages if m["role"] == "user")
        assert "images" not in user_msg
