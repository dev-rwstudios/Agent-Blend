"""Unit tests for the asset library catalog indexer."""

import json

import pytest

from blend_ai.asset_catalog import AssetCatalog, AssetCatalogError


def _write_asset(root, category, item, metadata):
    asset_dir = root / category / item
    asset_dir.mkdir(parents=True)
    (asset_dir / "model.glb").write_bytes(b"glb-stub")
    (asset_dir / "metadata.json").write_text(json.dumps(metadata))


@pytest.fixture
def library(tmp_path):
    _write_asset(tmp_path, "bed", "bed_frame_01", {
        "id": "bed/bed_frame_01",
        "name": "bed_frame_01",
        "classification": {
            "category": "bed", "subcategory": "bed_frame",
            "style_tags": ["contemporary"], "room_types": ["bedroom"],
        },
        "geometry": {"width_mm": 1600, "depth_mm": 2000, "height_mm": 600, "polycount": 1000},
        "placement": {"surface": "floor", "snap_mode": "bottom_to_surface"},
        "orientation": {"confidence": 0.9},
        "relations": [],
        "needs_review": False,
    })
    _write_asset(tmp_path, "soft_furnishing", "pillow_a", {
        "id": "soft_furnishing/pillow_a",
        "name": "pillow_a",
        "classification": {
            "category": "soft_furnishing", "subcategory": "pillow",
            "style_tags": ["contemporary"], "room_types": ["bedroom", "living_room"],
        },
        "geometry": {"width_mm": 400, "depth_mm": 400, "height_mm": 150, "polycount": 300},
        "placement": {"surface": "surface", "snap_mode": "rest_on_surface"},
        "orientation": {"confidence": 0.3},
        "relations": [{"relation": "rests_on", "target": "bed"}],
        "needs_review": True,
    })
    _write_asset(tmp_path, "lighting", "wall_lamp_a", {
        "id": "lighting/wall_lamp_a",
        "name": "wall_lamp_a",
        "classification": {
            "category": "lighting", "subcategory": "wall_lamp",
            "style_tags": [], "room_types": ["any"],
        },
        "geometry": {"width_mm": 100, "depth_mm": 100, "height_mm": 200, "polycount": 500},
        "placement": {"surface": "wall", "snap_mode": "mount_on_wall"},
        "orientation": {"confidence": 0.5},
        "relations": [],
        "needs_review": False,
    })
    return AssetCatalog(root=tmp_path)


class TestScanning:
    def test_finds_all_assets(self, library):
        assets = library.all()
        assert {a.id for a in assets} == {
            "bed/bed_frame_01", "soft_furnishing/pillow_a", "lighting/wall_lamp_a",
        }

    def test_parses_dimensions_and_relations(self, library):
        asset = library.get("soft_furnishing/pillow_a")
        assert asset.width_mm == 400
        assert asset.needs_review is True
        assert asset.relations == ({"relation": "rests_on", "target": "bed"},)

    def test_ignores_directory_without_model_glb(self, tmp_path):
        asset_dir = tmp_path / "decor" / "broken"
        asset_dir.mkdir(parents=True)
        (asset_dir / "metadata.json").write_text(json.dumps({
            "id": "decor/broken", "name": "broken",
            "classification": {"category": "decor", "subcategory": "x"},
            "geometry": {}, "placement": {}, "orientation": {}, "relations": [],
        }))
        catalog = AssetCatalog(root=tmp_path)
        assert catalog.all() == []

    def test_missing_root_raises(self, tmp_path):
        catalog = AssetCatalog(root=tmp_path / "does_not_exist")
        with pytest.raises(AssetCatalogError):
            catalog.all()

    def test_reload_picks_up_new_assets(self, library, tmp_path):
        assert len(library.all()) == 3
        _write_asset(tmp_path, "table", "new_table", {
            "id": "table/new_table", "name": "new_table",
            "classification": {"category": "table", "subcategory": "side_table"},
            "geometry": {}, "placement": {}, "orientation": {}, "relations": [],
        })
        library.reload()
        assert len(library.all()) == 4


class TestGet:
    def test_get_unknown_raises(self, library):
        with pytest.raises(AssetCatalogError, match="Unknown asset id"):
            library.get("nope/nope")


class TestCategories:
    def test_categories_counts(self, library):
        cats = library.categories()
        assert cats["bed"]["count"] == 1
        assert cats["soft_furnishing"]["subcategories"]["pillow"] == 1
        assert set(cats.keys()) == {"bed", "soft_furnishing", "lighting"}


class TestSearch:
    def test_search_by_category(self, library):
        results = library.search(category="bed")
        assert [a.id for a in results] == ["bed/bed_frame_01"]

    def test_search_by_query_keyword(self, library):
        results = library.search(query="pillow")
        assert [a.id for a in results] == ["soft_furnishing/pillow_a"]

    def test_search_by_room_type_matches_any(self, library):
        # wall_lamp_a is tagged room_types=["any"], so it should match every room filter.
        results = library.search(room_type="bathroom")
        assert "lighting/wall_lamp_a" in [a.id for a in results]

    def test_search_room_type_filters_out_non_matching(self, library):
        results = library.search(category="bed", room_type="living_room")
        assert results == []

    def test_search_no_filters_returns_all_up_to_limit(self, library):
        results = library.search(limit=2)
        assert len(results) == 2

    def test_search_multi_word_query_requires_all_terms(self, library):
        assert library.search(query="bed frame") != []
        assert library.search(query="bed nonexistentterm") == []
