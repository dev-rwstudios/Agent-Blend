"""In-memory index over the local asset_library/ directory.

Agent-Blend ships a curated library of pre-modeled furniture/decor assets
(asset_library/<category>/<item>/{model.glb,metadata.json}). This module scans
that library once and exposes a searchable catalog so the MCP tool layer can
place a real asset instead of the AI hand-modeling an approximation from
primitives. See tools/asset_library.py for the MCP-facing tools built on top
of this.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class AssetCatalogError(Exception):
    """Raised when the asset library cannot be located or parsed."""


@dataclass(frozen=True)
class Asset:
    id: str
    name: str
    category: str
    subcategory: str
    style_tags: tuple[str, ...]
    room_types: tuple[str, ...]
    width_mm: float
    depth_mm: float
    height_mm: float
    polycount: int
    surface: str
    snap_mode: str
    relations: tuple[dict[str, str], ...]
    needs_review: bool
    orientation_confidence: float
    model_path: str
    metadata_path: str
    forward_axis: str = "+Y"

    def summary(self) -> dict[str, Any]:
        """Compact view for search results."""
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "subcategory": self.subcategory,
            "room_types": list(self.room_types),
            "style_tags": list(self.style_tags),
            "dimensions_m": {
                "width": round(self.width_mm / 1000, 3),
                "depth": round(self.depth_mm / 1000, 3),
                "height": round(self.height_mm / 1000, 3),
            },
            "surface": self.surface,
            "relations": [dict(r) for r in self.relations],
            "needs_review": self.needs_review,
        }

    def details(self) -> dict[str, Any]:
        """Full view for a single asset, including placement/orientation info."""
        d = self.summary()
        d.update({
            "polycount": self.polycount,
            "snap_mode": self.snap_mode,
            "orientation_confidence": self.orientation_confidence,
            "forward_axis": self.forward_axis,
            "model_path": self.model_path,
        })
        return d


def _default_library_root() -> Path:
    override = os.environ.get("BLEND_AI_ASSET_LIBRARY")
    if override:
        return Path(override).resolve()
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "asset_library"
        if candidate.is_dir():
            return candidate
    raise AssetCatalogError(
        "Could not locate the asset_library/ directory. Set the "
        "BLEND_AI_ASSET_LIBRARY environment variable to its absolute path."
    )


class AssetCatalog:
    """Searchable index over an asset_library/ directory tree."""

    def __init__(self, root: str | Path | None = None):
        self._root = Path(root).resolve() if root else _default_library_root()
        self._assets: dict[str, Asset] = {}
        self._lock = threading.Lock()
        self._loaded = False

    @property
    def root(self) -> Path:
        return self._root

    def reload(self) -> None:
        """Force a re-scan of the asset library."""
        with self._lock:
            self._assets = self._scan()
            self._loaded = True

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._assets = self._scan()
            self._loaded = True

    def _scan(self) -> dict[str, Asset]:
        if not self._root.is_dir():
            raise AssetCatalogError(f"Asset library root does not exist: {self._root}")

        assets: dict[str, Asset] = {}
        for metadata_path in sorted(self._root.glob("*/*/metadata.json")):
            asset_dir = metadata_path.parent
            model_path = asset_dir / "model.glb"
            if not model_path.is_file():
                continue
            try:
                raw = json.loads(metadata_path.read_text())
            except (json.JSONDecodeError, OSError):
                continue

            classification = raw.get("classification", {})
            geometry = raw.get("geometry", {})
            placement = raw.get("placement", {})
            orientation = raw.get("orientation", {})

            asset_id = raw.get("id") or str(asset_dir.relative_to(self._root))
            asset = Asset(
                id=asset_id,
                name=raw.get("name", asset_dir.name),
                category=classification.get("category", asset_dir.parent.name),
                subcategory=classification.get("subcategory", ""),
                style_tags=tuple(classification.get("style_tags", [])),
                room_types=tuple(classification.get("room_types", [])),
                width_mm=float(geometry.get("width_mm", 0.0)),
                depth_mm=float(geometry.get("depth_mm", 0.0)),
                height_mm=float(geometry.get("height_mm", 0.0)),
                polycount=int(geometry.get("polycount", 0)),
                surface=placement.get("surface", ""),
                snap_mode=placement.get("snap_mode", ""),
                relations=tuple(
                    {"relation": r.get("relation", ""), "target": r.get("target", "")}
                    for r in raw.get("relations", [])
                ),
                needs_review=bool(raw.get("needs_review", False)),
                orientation_confidence=float(orientation.get("confidence", 0.0)),
                model_path=str(model_path),
                metadata_path=str(metadata_path),
                forward_axis=orientation.get("forward_axis", "+Y"),
            )
            assets[asset.id] = asset
        return assets

    def get(self, asset_id: str) -> Asset:
        self._ensure_loaded()
        asset = self._assets.get(asset_id)
        if asset is None:
            raise AssetCatalogError(f"Unknown asset id: '{asset_id}'")
        return asset

    def categories(self) -> dict[str, dict[str, Any]]:
        self._ensure_loaded()
        out: dict[str, dict[str, Any]] = {}
        for asset in self._assets.values():
            cat = out.setdefault(asset.category, {"count": 0, "subcategories": {}})
            cat["count"] += 1
            cat["subcategories"][asset.subcategory] = (
                cat["subcategories"].get(asset.subcategory, 0) + 1
            )
        return out

    def search(
        self,
        query: str = "",
        category: str = "",
        subcategory: str = "",
        room_type: str = "",
        limit: int = 15,
    ) -> list[Asset]:
        self._ensure_loaded()
        query_terms = [t for t in query.lower().split() if t]

        def matches(asset: Asset) -> bool:
            if category and asset.category != category:
                return False
            if subcategory and asset.subcategory != subcategory:
                return False
            if room_type and room_type not in asset.room_types and "any" not in asset.room_types:
                return False
            if query_terms:
                haystack = " ".join([
                    asset.id, asset.name, asset.category, asset.subcategory,
                    " ".join(asset.style_tags),
                ]).lower()
                if not all(term in haystack for term in query_terms):
                    return False
            return True

        results = [a for a in self._assets.values() if matches(a)]
        results.sort(key=lambda a: (a.needs_review, a.category, a.subcategory, a.id))
        return results[:limit]

    def all(self) -> list[Asset]:
        self._ensure_loaded()
        return list(self._assets.values())


_catalog: AssetCatalog | None = None
_catalog_lock = threading.Lock()


def get_catalog() -> AssetCatalog:
    """Get the process-wide singleton asset catalog, scanning on first use."""
    global _catalog
    if _catalog is None:
        with _catalog_lock:
            if _catalog is None:
                _catalog = AssetCatalog()
    return _catalog
