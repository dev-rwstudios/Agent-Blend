"""Tests for the build agent's addon commands (scene_build.py)."""

import importlib.util
import os
import sys
from unittest.mock import MagicMock

import pytest


def _load_scene_build():
    sys.modules.setdefault("bmesh", MagicMock())  # only used inside build_boxes
    mock_dispatcher = MagicMock()
    mock_addon = MagicMock()
    mock_addon.dispatcher = mock_dispatcher
    sys.modules["addon"] = mock_addon
    sys.modules["addon.dispatcher"] = mock_dispatcher
    path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "addon", "handlers", "scene_build.py")
    spec = importlib.util.spec_from_file_location("addon.handlers.scene_build", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["addon.handlers.scene_build"] = mod
    spec.loader.exec_module(mod)
    return mod, mock_dispatcher


@pytest.fixture
def scene_build():
    return _load_scene_build()


def test_registers_agent_commands(scene_build):
    mod, dispatcher = scene_build
    mod.register()
    names = {c.args[0] for c in dispatcher.register_handler.call_args_list}
    assert {"build_boxes", "get_layout", "capture_review", "remove_units", "measure_asset"} <= names


def test_remove_units_only_touches_agent_objects(scene_build, monkeypatch):
    import bpy

    mod, _ = scene_build
    part = MagicMock()
    part.name = "Bed.part"
    agent_obj = MagicMock()
    agent_obj.name = "Bed"
    agent_obj.__contains__ = lambda self, key: key == "ab_role"
    agent_obj.children_recursive = [part]
    user_obj = MagicMock()
    user_obj.name = "MyChair"
    user_obj.__contains__ = lambda self, key: False
    objects = {"Bed": agent_obj, "MyChair": user_obj}

    fake_objects = MagicMock()
    fake_objects.get = objects.get
    monkeypatch.setattr(bpy.data, "objects", fake_objects, raising=False)

    result = mod.handle_remove_units({"names": ["Bed", "MyChair", "Missing"]})

    assert result["removed"] == ["Bed.part", "Bed"]
    removed = [c.args[0] for c in fake_objects.remove.call_args_list]
    assert user_obj not in removed


def test_build_boxes_rejects_empty_and_degenerate_boxes(scene_build):
    mod, _ = scene_build
    with pytest.raises(ValueError):
        mod.handle_build_boxes({"boxes": []})
