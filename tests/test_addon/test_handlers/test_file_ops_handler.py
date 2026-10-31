"""Tests for the file_ops addon handler's checkpoint command."""

import importlib.util
import os
import sys
from unittest.mock import MagicMock

import pytest


def _load_file_ops_handler():
    """Load addon.handlers.file_ops directly without triggering addon/handlers/__init__.py."""
    mock_dispatcher = MagicMock()
    mock_addon = MagicMock()
    mock_addon.dispatcher = mock_dispatcher
    sys.modules["addon"] = mock_addon
    sys.modules["addon.dispatcher"] = mock_dispatcher

    handler_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "addon", "handlers", "file_ops.py",
    )
    spec = importlib.util.spec_from_file_location("addon.handlers.file_ops", handler_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["addon.handlers.file_ops"] = mod
    spec.loader.exec_module(mod)
    return mod, mock_dispatcher


@pytest.fixture
def file_ops():
    return _load_file_ops_handler()


class TestSaveCheckpoint:
    def test_saves_a_compressed_copy(self, file_ops, tmp_path):
        import bpy

        mod, _ = file_ops
        bpy.ops.wm.save_as_mainfile.reset_mock()
        target = tmp_path / "cp" / "one.blend"

        result = mod.handle_save_checkpoint({"filepath": str(target)})

        bpy.ops.wm.save_as_mainfile.assert_called_once_with(
            filepath=str(target), copy=True, compress=True,
        )
        assert result["success"] is True
        assert target.parent.is_dir()

    def test_rejects_non_blend_paths(self, file_ops, tmp_path):
        mod, _ = file_ops
        with pytest.raises(ValueError):
            mod.handle_save_checkpoint({"filepath": str(tmp_path / "x.txt")})

    def test_is_registered(self, file_ops):
        mod, dispatcher = file_ops
        mod.register()
        names = [c.args[0] for c in dispatcher.register_handler.call_args_list]
        assert "save_checkpoint" in names


class TestGetFileInfo:
    def test_reports_open_file(self, file_ops, monkeypatch):
        import bpy

        mod, _ = file_ops
        # monkeypatch restores the shared bpy mock so other tests aren't affected.
        monkeypatch.setattr(bpy.data, "filepath", "/projects/abc/scene.blend", raising=False)
        monkeypatch.setattr(bpy.data, "is_dirty", True, raising=False)
        monkeypatch.setattr(bpy.data, "objects", ["Cube", "Light"], raising=False)

        result = mod.handle_get_file_info({})

        assert result == {
            "filepath": "/projects/abc/scene.blend",
            "is_dirty": True,
            "object_count": 2,
        }


class TestNewFile:
    def test_opens_empty_scene_and_saves_to_path(self, file_ops, tmp_path):
        import bpy

        mod, _ = file_ops
        bpy.ops.wm.read_homefile.reset_mock()
        bpy.ops.wm.save_as_mainfile.reset_mock()
        target = tmp_path / "proj" / "scene.blend"

        result = mod.handle_new_file({"filepath": str(target)})

        bpy.ops.wm.read_homefile.assert_called_once_with(use_empty=True)
        bpy.ops.wm.save_as_mainfile.assert_called_once_with(filepath=str(target))
        assert target.parent.is_dir()
        assert result["success"] is True

    def test_without_path_does_not_save(self, file_ops):
        import bpy

        mod, _ = file_ops
        bpy.ops.wm.save_as_mainfile.reset_mock()

        mod.handle_new_file({})

        bpy.ops.wm.save_as_mainfile.assert_not_called()

    def test_rejects_non_blend_paths(self, file_ops, tmp_path):
        mod, _ = file_ops
        with pytest.raises(ValueError):
            mod.handle_new_file({"filepath": str(tmp_path / "scene.txt")})

    def test_new_commands_are_registered(self, file_ops):
        mod, dispatcher = file_ops
        mod.register()
        names = [c.args[0] for c in dispatcher.register_handler.call_args_list]
        assert {"get_file_info", "new_file"} <= set(names)
