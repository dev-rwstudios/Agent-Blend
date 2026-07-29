"""Tests for the mesh_editing addon handler's new selection tools.

Covers only the selection-related handlers added for Phase 5 (index-based
selection, selection sets, grow/shrink/select-similar). The 15 pre-existing
mesh_editing handlers (inset_faces, dissolve_faces, etc.) have no handler-level
tests today (only tool-layer coverage) and backfilling that is out of scope here.
"""

import os
import sys
import json
import importlib.util
from unittest.mock import MagicMock
import pytest


def _load_mesh_editing_handler():
    """Load addon.handlers.mesh_editing directly without triggering addon/handlers/__init__.py."""
    mock_dispatcher = MagicMock()
    mock_addon = MagicMock()
    mock_addon.dispatcher = mock_dispatcher
    sys.modules["addon"] = mock_addon
    sys.modules["addon.dispatcher"] = mock_dispatcher

    mock_bmesh = MagicMock()
    sys.modules["bmesh"] = mock_bmesh

    handler_path = os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..", "addon", "handlers", "mesh_editing.py",
    )
    spec = importlib.util.spec_from_file_location("addon.handlers.mesh_editing", handler_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["addon.handlers.mesh_editing"] = mod
    spec.loader.exec_module(mod)
    return mod, mock_bmesh


@pytest.fixture
def handler_and_bmesh():
    """Provide loaded mesh_editing handler module and mock bmesh, reset per test."""
    mod, mock_bmesh = _load_mesh_editing_handler()
    mock_bmesh.reset_mock()
    import bpy
    bpy.reset_mock()
    return mod, mock_bmesh


def _make_mock_elem(index, select=False):
    """Create a mock BMesh element (vert/edge/face) with index + settable select."""
    elem = MagicMock()
    elem.index = index
    elem.select = select
    return elem


def _make_bm_sequence(items):
    """Mock BMesh element sequence: iterable, len, indexable, ensure_lookup_table."""
    seq = MagicMock()
    seq.__iter__ = MagicMock(side_effect=lambda: iter(items))
    seq.__len__ = MagicMock(return_value=len(items))
    seq.__getitem__ = MagicMock(side_effect=lambda i: items[i])
    seq.ensure_lookup_table = MagicMock()
    return seq


def _configure_bm(mock_bmesh, verts, edges, faces):
    """Configure the mock bmesh module's from_edit_mesh() return value."""
    bm = MagicMock()
    bm.verts = _make_bm_sequence(verts)
    bm.edges = _make_bm_sequence(edges)
    bm.faces = _make_bm_sequence(faces)
    bm.select_flush = MagicMock()
    mock_bmesh.from_edit_mesh.return_value = bm
    return bm


def _make_mock_mesh_obj(name="Cube", mode="OBJECT"):
    """Create a mock mesh object with a dict-like `.data` for custom properties."""
    obj = MagicMock()
    obj.name = name
    obj.type = "MESH"
    obj.mode = mode
    obj.data = {}  # plain dict stands in for Blender's ID-property-backed mesh datablock
    return obj


# ---------------------------------------------------------------------------
# select_vertices_by_index / select_edges_by_index / select_faces_by_index
# ---------------------------------------------------------------------------


class TestSelectVerticesByIndex:
    def test_selects_valid_indices(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(i) for i in range(8)]
        bm = _configure_bm(mock_bmesh, verts, [], [])

        result = mod.handle_select_vertices_by_index({"object_name": "Cube", "indices": [0, 1, 2]})

        assert result["selected"] == [0, 1, 2]
        assert result["invalid"] == []
        assert result["mode"] == "EDIT"
        assert verts[0].select is True
        assert verts[1].select is True
        assert verts[2].select is True
        assert verts[3].select is False
        mock_bmesh.update_edit_mesh.assert_called_once_with(obj.data)
        bm.select_flush.assert_called_once_with(True)

    def test_out_of_range_indices_reported_as_invalid(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(i) for i in range(4)]
        _configure_bm(mock_bmesh, verts, [], [])

        result = mod.handle_select_vertices_by_index({"object_name": "Cube", "indices": [0, 999]})

        assert result["selected"] == [0]
        assert result["invalid"] == [999]
        assert verts[0].select is True

    def test_uses_live_edit_mesh_not_new(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj
        _configure_bm(mock_bmesh, [_make_mock_elem(0)], [], [])

        mod.handle_select_vertices_by_index({"object_name": "Cube", "indices": [0]})

        mock_bmesh.from_edit_mesh.assert_called_once_with(obj.data)
        mock_bmesh.new.assert_not_called()

    def test_never_calls_bm_free(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj
        bm = _configure_bm(mock_bmesh, [_make_mock_elem(0)], [], [])

        mod.handle_select_vertices_by_index({"object_name": "Cube", "indices": [0]})

        bm.free.assert_not_called()

    def test_never_returns_to_object_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj
        _configure_bm(mock_bmesh, [_make_mock_elem(0)], [], [])

        mod.handle_select_vertices_by_index({"object_name": "Cube", "indices": [0]})

        for call in bpy.ops.object.mode_set.call_args_list:
            assert call.kwargs.get("mode") != "OBJECT"

    def test_uses_correct_select_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj
        _configure_bm(mock_bmesh, [_make_mock_elem(0)], [], [])

        mod.handle_select_vertices_by_index({"object_name": "Cube", "indices": [0]})

        bpy.ops.mesh.select_mode.assert_called_once_with(type="VERT")

    def test_missing_object_raises(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        import bpy
        bpy.data.objects.get.return_value = None

        with pytest.raises(ValueError, match="not found"):
            mod.handle_select_vertices_by_index({"object_name": "Ghost", "indices": [0]})

    def test_non_mesh_object_raises(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        obj.type = "CAMERA"
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="not a mesh"):
            mod.handle_select_vertices_by_index({"object_name": "Cam", "indices": [0]})


class TestSelectEdgesByIndex:
    def test_selects_valid_indices(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj

        edges = [_make_mock_elem(i) for i in range(6)]
        _configure_bm(mock_bmesh, [], edges, [])

        result = mod.handle_select_edges_by_index({"object_name": "Cube", "indices": [1, 2]})

        assert result["selected"] == [1, 2]
        assert result["mode"] == "EDIT"
        assert edges[1].select is True
        assert edges[2].select is True

    def test_uses_correct_select_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj
        _configure_bm(mock_bmesh, [], [_make_mock_elem(0)], [])

        mod.handle_select_edges_by_index({"object_name": "Cube", "indices": [0]})

        bpy.ops.mesh.select_mode.assert_called_once_with(type="EDGE")


class TestSelectFacesByIndex:
    def test_selects_valid_indices(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj

        faces = [_make_mock_elem(i) for i in range(6)]
        _configure_bm(mock_bmesh, [], [], faces)

        result = mod.handle_select_faces_by_index({"object_name": "Cube", "indices": [3]})

        assert result["selected"] == [3]
        assert result["mode"] == "EDIT"
        assert faces[3].select is True

    def test_uses_correct_select_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj
        _configure_bm(mock_bmesh, [], [], [_make_mock_elem(0)])

        mod.handle_select_faces_by_index({"object_name": "Cube", "indices": [0]})

        bpy.ops.mesh.select_mode.assert_called_once_with(type="FACE")


# ---------------------------------------------------------------------------
# save_selection_set / select_selection_set / list_selection_sets
# ---------------------------------------------------------------------------


class TestSaveSelectionSet:
    def test_saves_current_selection(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="EDIT")
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(0, select=True), _make_mock_elem(1, select=False)]
        faces = [_make_mock_elem(0, select=True)]
        _configure_bm(mock_bmesh, verts, [], faces)

        result = mod.handle_save_selection_set({"object_name": "Cube", "set_name": "top"})

        assert result["set_name"] == "top"
        assert result["saved"] == {"vert": [0], "edge": [], "face": [0]}
        stored = json.loads(obj.data[mod.SELECTION_SETS_KEY])
        assert stored["top"] == {"vert": [0], "edge": [], "face": [0]}

    def test_preserves_previously_saved_sets(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="EDIT")
        obj.data[mod.SELECTION_SETS_KEY] = json.dumps({"existing": {"vert": [9], "edge": [], "face": []}})
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(0, select=True)]
        _configure_bm(mock_bmesh, verts, [], [])

        mod.handle_save_selection_set({"object_name": "Cube", "set_name": "new"})

        stored = json.loads(obj.data[mod.SELECTION_SETS_KEY])
        assert "existing" in stored
        assert "new" in stored

    def test_raises_when_no_active_selection(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="OBJECT")
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="no active edit-mode selection"):
            mod.handle_save_selection_set({"object_name": "Cube", "set_name": "top"})


class TestSelectSelectionSet:
    def test_recalls_saved_set(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        obj.data[mod.SELECTION_SETS_KEY] = json.dumps(
            {"top": {"vert": [1], "edge": [], "face": [2]}}
        )
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(i) for i in range(3)]
        faces = [_make_mock_elem(i) for i in range(3)]
        bm = _configure_bm(mock_bmesh, verts, [], faces)

        result = mod.handle_select_selection_set({"object_name": "Cube", "set_name": "top"})

        assert result["mode"] == "EDIT"
        assert verts[1].select is True
        assert faces[2].select is True
        bm.select_flush.assert_called_once_with(True)

    def test_unknown_set_name_raises(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="not found"):
            mod.handle_select_selection_set({"object_name": "Cube", "set_name": "ghost"})

    def test_corrupted_property_treated_as_no_sets(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        obj.data[mod.SELECTION_SETS_KEY] = "not json"
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="not found"):
            mod.handle_select_selection_set({"object_name": "Cube", "set_name": "top"})


class TestListSelectionSets:
    def test_lists_saved_names(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        obj.data[mod.SELECTION_SETS_KEY] = json.dumps({
            "b_set": {"vert": [], "edge": [], "face": []},
            "a_set": {"vert": [], "edge": [], "face": []},
        })
        import bpy
        bpy.data.objects.get.return_value = obj

        result = mod.handle_list_selection_sets({"object_name": "Cube"})

        assert result["set_names"] == ["a_set", "b_set"]

    def test_no_sets_returns_empty_list(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        import bpy
        bpy.data.objects.get.return_value = obj

        result = mod.handle_list_selection_sets({"object_name": "Cube"})

        assert result["set_names"] == []

    def test_corrupted_property_returns_empty_list(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj()
        obj.data[mod.SELECTION_SETS_KEY] = "not json"
        import bpy
        bpy.data.objects.get.return_value = obj

        result = mod.handle_list_selection_sets({"object_name": "Cube"})

        assert result["set_names"] == []


# ---------------------------------------------------------------------------
# grow_selection / shrink_selection / select_similar
# ---------------------------------------------------------------------------


class TestGrowSelection:
    def test_grows_when_in_edit_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="EDIT")
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(0, select=True), _make_mock_elem(1, select=True)]
        _configure_bm(mock_bmesh, verts, [], [])

        result = mod.handle_grow_selection({"object_name": "Cube"})

        bpy.ops.mesh.select_more.assert_called_once_with()
        assert result["selected_count"]["vert"] == 2
        assert result["mode"] == "EDIT"

    def test_raises_when_not_in_edit_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="OBJECT")
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="no active edit-mode selection"):
            mod.handle_grow_selection({"object_name": "Cube"})


class TestShrinkSelection:
    def test_shrinks_when_in_edit_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="EDIT")
        import bpy
        bpy.data.objects.get.return_value = obj

        verts = [_make_mock_elem(0, select=True)]
        _configure_bm(mock_bmesh, verts, [], [])

        result = mod.handle_shrink_selection({"object_name": "Cube"})

        bpy.ops.mesh.select_less.assert_called_once_with()
        assert result["selected_count"]["vert"] == 1

    def test_raises_when_not_in_edit_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="OBJECT")
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="no active edit-mode selection"):
            mod.handle_shrink_selection({"object_name": "Cube"})


class TestSelectSimilar:
    def test_selects_similar_when_in_edit_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="EDIT")
        import bpy
        bpy.data.objects.get.return_value = obj

        faces = [_make_mock_elem(0, select=True), _make_mock_elem(1, select=True)]
        _configure_bm(mock_bmesh, [], [], faces)

        result = mod.handle_select_similar({"object_name": "Cube", "compare_by": "MATERIAL"})

        bpy.ops.mesh.select_similar.assert_called_once_with(type="MATERIAL")
        assert result["compare_by"] == "MATERIAL"
        assert result["selected_count"]["face"] == 2

    def test_defaults_to_normal(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="EDIT")
        import bpy
        bpy.data.objects.get.return_value = obj
        _configure_bm(mock_bmesh, [], [], [])

        mod.handle_select_similar({"object_name": "Cube"})

        bpy.ops.mesh.select_similar.assert_called_once_with(type="NORMAL")

    def test_raises_when_not_in_edit_mode(self, handler_and_bmesh):
        mod, mock_bmesh = handler_and_bmesh
        obj = _make_mock_mesh_obj(mode="OBJECT")
        import bpy
        bpy.data.objects.get.return_value = obj

        with pytest.raises(ValueError, match="no active edit-mode selection"):
            mod.handle_select_similar({"object_name": "Cube"})
