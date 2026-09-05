"""Unit tests for the asset_library MCP tools."""

from unittest.mock import MagicMock, patch

import pytest

from blend_ai.asset_catalog import Asset, AssetCatalogError
from blend_ai.validators import ValidationError


def _fake_asset(**overrides):
    defaults = dict(
        id="bed/bed_frame_01",
        name="bed_frame_01",
        category="bed",
        subcategory="bed_frame",
        style_tags=("contemporary",),
        room_types=("bedroom",),
        width_mm=1600.0,
        depth_mm=2000.0,
        height_mm=600.0,
        polycount=1000,
        surface="floor",
        snap_mode="bottom_to_surface",
        relations=(),
        needs_review=False,
        orientation_confidence=0.9,
        model_path="/fake/asset_library/bed/bed_frame_01/model.glb",
        metadata_path="/fake/asset_library/bed/bed_frame_01/metadata.json",
    )
    defaults.update(overrides)
    return Asset(**defaults)


@pytest.fixture
def mock_catalog():
    catalog = MagicMock()
    with patch("blend_ai.tools.asset_library.get_catalog", return_value=catalog):
        yield catalog


@pytest.fixture
def mock_conn():
    mock = MagicMock()
    with patch("blend_ai.tools.asset_library.get_connection", return_value=mock):
        yield mock


class TestSearchAssetLibrary:
    def test_returns_summaries(self, mock_catalog):
        from blend_ai.tools.asset_library import search_asset_library

        mock_catalog.search.return_value = [_fake_asset()]
        results = search_asset_library(query="bed")
        assert results[0]["id"] == "bed/bed_frame_01"
        assert results[0]["dimensions_m"]["height"] == 0.6
        mock_catalog.search.assert_called_once_with(
            query="bed", category="", subcategory="", room_type="", limit=15,
        )

    def test_limit_out_of_range_raises(self, mock_catalog):
        from blend_ai.tools.asset_library import search_asset_library

        with pytest.raises(ValidationError):
            search_asset_library(limit=1000)


class TestGetAssetDetails:
    def test_returns_details(self, mock_catalog):
        from blend_ai.tools.asset_library import get_asset_details

        mock_catalog.get.return_value = _fake_asset()
        details = get_asset_details("bed/bed_frame_01")
        assert details["snap_mode"] == "bottom_to_surface"
        assert details["polycount"] == 1000

    def test_unknown_asset_raises_validation_error(self, mock_catalog):
        from blend_ai.tools.asset_library import get_asset_details

        mock_catalog.get.side_effect = AssetCatalogError("Unknown asset id: 'nope'")
        with pytest.raises(ValidationError):
            get_asset_details("nope")


class TestListAssetCategories:
    def test_returns_catalog_categories(self, mock_catalog):
        from blend_ai.tools.asset_library import list_asset_categories

        mock_catalog.categories.return_value = {"bed": {"count": 1, "subcategories": {}}}
        assert list_asset_categories() == {"bed": {"count": 1, "subcategories": {}}}


class TestImportAsset:
    def _wire_happy_path(self, mock_conn, mock_catalog, asset=None):
        mock_catalog.get.return_value = asset or _fake_asset()

        def fake_send(command, params):
            if command == "import_file":
                return {"status": "ok", "result": {
                    "imported_objects": ["Bed_Root", "Bed_Mesh"], "success": True,
                }}
            if command == "get_object_info":
                name = params["name"]
                if name == "Bed_Root":
                    return {"status": "ok", "result": {
                        "parent": None,
                        "location": [10.0, 20.0, 0.0],  # arbitrary source-scene coordinates
                        "bound_box_world_min": [9.2, 19.0, 0.0],
                        "bound_box_world_max": [10.8, 21.0, 0.6],
                    }}
                if name == "Bed_Mesh":
                    return {"status": "ok", "result": {
                        "parent": "Bed_Root",
                        "location": [0.0, 0.0, 0.0],
                        "bound_box_world_min": [9.2, 19.0, 0.0],
                        "bound_box_world_max": [10.8, 21.0, 0.6],
                    }}
                if name == "Sofa":  # used as a place_on target
                    return {"status": "ok", "result": {
                        "parent": None,
                        "location": [0.0, 0.0, 0.0],
                        "bound_box_world_min": [-1.0, -0.5, 0.0],
                        "bound_box_world_max": [1.0, 0.5, 0.8],
                    }}
                if name == "TV":  # used as a face_target, due east of the bed target
                    return {"status": "ok", "result": {
                        "parent": None,
                        "location": [12.0, 3.0, 0.0],
                        "bound_box_world_min": [11.5, 2.5, 0.0],
                        "bound_box_world_max": [12.5, 3.5, 0.5],
                    }}
            if command == "create_object":
                return {"status": "ok", "result": {
                    "name": params["name"] or "bed_frame_01", "type": "EMPTY",
                    "location": params.get("location", [0, 0, 0]),
                }}
            if command in ("parent_objects", "set_rotation", "set_scale", "set_location"):
                return {"status": "ok", "result": {"success": True}}
            raise AssertionError(f"unexpected command {command}")

        mock_conn.send_command.side_effect = fake_send

    def test_only_parents_hierarchy_roots(self, mock_conn, mock_catalog):
        from blend_ai.tools.asset_library import import_asset

        self._wire_happy_path(mock_conn, mock_catalog)
        import_asset("bed/bed_frame_01", location=[2.0, 3.0, 0.0])

        parent_calls = [
            c.args[1] for c in mock_conn.send_command.call_args_list
            if c.args[0] == "parent_objects"
        ]
        assert parent_calls == [{"child": "Bed_Root", "parent": "bed_frame_01"}]

    def test_floor_snap_places_bottom_at_target_z(self, mock_conn, mock_catalog):
        from blend_ai.tools.asset_library import import_asset

        self._wire_happy_path(mock_conn, mock_catalog)
        result = import_asset("bed/bed_frame_01", location=[2.0, 3.0, 0.0])

        assert result["location"] == [2.0, 3.0, 0.0]
        assert result["dimensions_m"] == [1.6, 2.0, 0.6]
        assert result["imported_objects"] == ["Bed_Root", "Bed_Mesh"]

    def test_anchor_origin_lands_at_target_not_at_translation_delta(self, mock_conn, mock_catalog):
        """Regression test: the source .blend's objects keep their original
        (often far-from-origin) coordinates on import. The anchor Empty's own
        origin must end up AT the requested target point — not at whatever
        raw translation delta was needed to move the geometry there — because
        other tools (point_camera_at, place_on, distance math) read the
        anchor's real transform, not this function's return value."""
        from blend_ai.tools.asset_library import import_asset

        self._wire_happy_path(mock_conn, mock_catalog)
        import_asset("bed/bed_frame_01", name="bed_frame_01", location=[2.0, 3.0, 0.0])

        anchor_create_call = next(
            c for c in mock_conn.send_command.call_args_list if c.args[0] == "create_object"
        )
        assert anchor_create_call.args[1]["location"] == [2.0, 3.0, 0.0]

        root_set_location_calls = [
            c.args[1] for c in mock_conn.send_command.call_args_list
            if c.args[0] == "set_location" and c.args[1]["name"] == "Bed_Root"
        ]
        # Bed_Root's original location was [10, 20, 0] with bbox center (10, 20);
        # target center is (2, 3) -> delta (-8, -17, 0) -> new location (2, 3, 0).
        assert root_set_location_calls == [{"name": "Bed_Root", "location": [2.0, 3.0, 0.0]}]

    def test_resets_root_rotation_before_applying_caller_rotation(self, mock_conn, mock_catalog):
        """Regression test: source .blend files frequently leave a baked-in
        rotation on the imported root (axis-convention differences, or how
        the object happened to sit in that scene). If import_asset didn't
        reset it, rotation_euler=(0,0,0) from the caller would silently
        leave that original tilt in place. The root's rotation must be
        zeroed BEFORE the caller's rotation_euler is applied to the anchor,
        so (0,0,0) always means "the asset's own upright pose."""
        from blend_ai.tools.asset_library import import_asset

        self._wire_happy_path(mock_conn, mock_catalog)
        import_asset("bed/bed_frame_01", name="bed_frame_01", rotation_euler=(0, 0, 1.57))

        rotation_calls = [
            c.args[1] for c in mock_conn.send_command.call_args_list if c.args[0] == "set_rotation"
        ]
        assert rotation_calls[0] == {"name": "Bed_Root", "rotation": [0, 0, 0], "mode": "EULER"}
        assert rotation_calls[-1] == {
            "name": "bed_frame_01", "rotation": [0, 0, 1.57], "mode": "EULER",
        }

        reset_call_index = mock_conn.send_command.call_args_list.index(
            next(c for c in mock_conn.send_command.call_args_list if c.args == ("set_rotation", rotation_calls[0]))
        )
        location_call_index = mock_conn.send_command.call_args_list.index(
            next(c for c in mock_conn.send_command.call_args_list if c.args[0] == "set_location")
        )
        assert reset_call_index < location_call_index, "rotation must be reset before the bbox-based translate"

    def test_face_target_computes_yaw_from_forward_axis(self, mock_conn, mock_catalog):
        """The asset's declared forward_axis (+Y, after the rotation reset in
        step 2b) must be accounted for, not just a raw look-at angle: TV
        sits due east (+X) of the target, so the asset needs to turn -90°
        from its own +Y-forward canonical pose to end up facing it."""
        import math

        from blend_ai.tools.asset_library import import_asset

        self._wire_happy_path(mock_conn, mock_catalog)
        result = import_asset(
            "bed/bed_frame_01", name="bed_frame_01",
            location=[2.0, 3.0, 0.0], face_target="TV",
        )

        assert result["rotation_euler"][2] == pytest.approx(-math.pi / 2)
        anchor_rotation_call = next(
            c.args[1] for c in mock_conn.send_command.call_args_list
            if c.args[0] == "set_rotation" and c.args[1]["name"] == "bed_frame_01"
        )
        assert anchor_rotation_call["rotation"][2] == pytest.approx(-math.pi / 2)

    def test_place_on_snaps_to_target_top(self, mock_conn, mock_catalog):
        from blend_ai.tools.asset_library import import_asset

        pillow = _fake_asset(id="soft_furnishing/pillow_a", surface="surface",
                              snap_mode="rest_on_surface")
        self._wire_happy_path(mock_conn, mock_catalog, asset=pillow)
        result = import_asset("soft_furnishing/pillow_a", place_on="Sofa")

        # Bed_Root/Bed_Mesh bbox min z = 0.0, Sofa's top z = 0.8 -> delta_z = 0.8
        assert result["location"][2] == pytest.approx(0.8)
        # Sofa's footprint center is (0.0, 0.0) -> object centered there
        assert result["location"][0] == pytest.approx(0.0)
        assert result["location"][1] == pytest.approx(0.0)

    def test_unknown_asset_raises_validation_error(self, mock_conn, mock_catalog):
        from blend_ai.tools.asset_library import import_asset

        mock_catalog.get.side_effect = AssetCatalogError("Unknown asset id: 'nope'")
        with pytest.raises(ValidationError):
            import_asset("nope")

    def test_invalid_location_raises(self, mock_conn, mock_catalog):
        from blend_ai.tools.asset_library import import_asset

        mock_catalog.get.return_value = _fake_asset()
        with pytest.raises(ValidationError):
            import_asset("bed/bed_frame_01", location=[1.0, 2.0])

    def test_no_imported_objects_raises(self, mock_conn, mock_catalog):
        from blend_ai.tools.asset_library import import_asset

        mock_catalog.get.return_value = _fake_asset()
        mock_conn.send_command.return_value = {
            "status": "ok", "result": {"imported_objects": [], "success": True},
        }
        with pytest.raises(RuntimeError, match="no objects"):
            import_asset("bed/bed_frame_01")
