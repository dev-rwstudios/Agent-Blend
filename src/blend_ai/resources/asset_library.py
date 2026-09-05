"""MCP resource exposing the local asset library catalog."""

import json

from blend_ai.asset_catalog import get_catalog
from blend_ai.server import mcp


@mcp.resource("blender://asset_library")
def get_asset_library_resource() -> str:
    """Full catalog of pre-modeled assets available for scene building.

    Prefer placing these over hand-modeling furniture/decor from primitives —
    see the search_asset_library / import_asset tools.
    """
    catalog = get_catalog()
    summary = {
        "categories": catalog.categories(),
        "assets": [a.summary() for a in catalog.all()],
    }
    return json.dumps(summary, indent=2)
