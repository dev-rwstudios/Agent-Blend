"""MCP tools for browsing and placing assets from the local asset_library/.

This is the fix for the AI defaulting to hand-built primitives for furniture
and decor: these tools let it find and place a real, pre-modeled asset
instead. `search_asset_library` / `get_asset_details` / `list_asset_categories`
are pure metadata lookups (no Blender connection needed). `import_asset` does
the actual placement — it imports the asset's glb, wraps it in an anchor
Empty, and positions that anchor using the asset's real-world dimensions and
placement rules (floor/wall/ceiling snapping, or resting on another named
object) instead of requiring the caller to guess coordinates.
"""

import math
from typing import Any

from blend_ai.asset_catalog import AssetCatalogError, get_catalog
from blend_ai.server import mcp, get_connection
from blend_ai.validators import (
    ValidationError,
    validate_numeric_range,
    validate_object_name,
    validate_vector,
)

_AXIS_ANGLES = {"+X": 0.0, "+Y": math.pi / 2, "-X": math.pi, "-Y": -math.pi / 2}


def _send(conn, command: str, params: dict[str, Any]) -> dict[str, Any]:
    response = conn.send_command(command, params)
    if response.get("status") == "error":
        raise RuntimeError(f"Blender error on '{command}': {response.get('result')}")
    return response.get("result")


def _axis_to_angle(axis: str) -> float:
    """World-space yaw (radians, atan2 convention) that an asset's declared
    `orientation.forward_axis` points at once its rotation has been reset to
    identity. Unrecognized/missing axis values fall back to +Y (the
    convention used by every asset in the library today)."""
    return _AXIS_ANGLES.get(axis, _AXIS_ANGLES["+Y"])


@mcp.tool()
def search_asset_library(
    query: str = "",
    category: str = "",
    subcategory: str = "",
    room_type: str = "",
    limit: int = 15,
) -> list[dict[str, Any]]:
    """Search the local asset library for a pre-modeled furniture/decor asset.

    ALWAYS call this before hand-modeling furniture, decor, lighting, seating,
    storage, soft furnishings, or similar real-world objects from primitives.
    The library holds 88 ready-to-place assets (beds, sofas, tables, wardrobes,
    lamps, pillows, rugs, curtains, plants, and more) with accurate real-world
    dimensions. Only fall back to primitives when a search here returns no
    usable match.

    Args:
        query: Free-text keyword search across id/name/category/style
               (e.g. "bedside table", "pillow", "wardrobe").
        category: Exact category filter. See list_asset_categories() for
                  valid values (e.g. "bed", "seating", "storage", "lighting",
                  "table", "decor", "soft_furnishing", "rug", "sanitary",
                  "door_window", "window_treatment", "electronics").
        subcategory: Exact subcategory filter (e.g. "bed_frame", "sofa",
                     "floor_lamp", "wardrobe", "pillow").
        room_type: Filter to assets tagged for a room (e.g. "bedroom",
                   "living_room", "bathroom", "dining_room"). Assets tagged
                   "any" always match regardless of this filter.
        limit: Maximum results to return. Defaults to 15.

    Returns:
        List of asset summaries (id, name, category, subcategory, room_types,
        dimensions_m, relations, needs_review). Use the "id" field with
        get_asset_details() or import_asset().
    """
    limit = int(validate_numeric_range(limit, min_val=1, max_val=100, name="limit"))
    catalog = get_catalog()
    results = catalog.search(
        query=query, category=category, subcategory=subcategory,
        room_type=room_type, limit=limit,
    )
    return [a.summary() for a in results]


@mcp.tool()
def get_asset_details(asset_id: str) -> dict[str, Any]:
    """Get full details for one asset: dimensions, placement rules, relations.

    Args:
        asset_id: Asset id from search_asset_library() (e.g. "bed/bed_frame_01").

    Returns:
        Dict with dimensions_m, polycount, surface ("floor"/"wall"/"ceiling"/
        "surface"), snap_mode, relations (e.g. rests_on another category),
        orientation_confidence, and needs_review. A low orientation_confidence
        or needs_review=True means double-check the result with a screenshot
        after placing it — the asset's forward-facing direction may be wrong.
    """
    catalog = get_catalog()
    try:
        asset = catalog.get(asset_id)
    except AssetCatalogError as e:
        raise ValidationError(str(e)) from e
    return asset.details()


@mcp.tool()
def list_asset_categories() -> dict[str, Any]:
    """List all asset library categories/subcategories and how many assets each has.

    Call this first when unsure what's available — it's the fastest way to
    see the full inventory shape before running targeted searches.

    Returns:
        Dict mapping category name to {"count": int, "subcategories": {name: count}}.
    """
    return get_catalog().categories()


@mcp.tool()
def import_asset(
    asset_id: str,
    name: str = "",
    location: list[float] | tuple[float, ...] | None = None,
    rotation_euler: list[float] | tuple[float, ...] = (0, 0, 0),
    scale: float = 1.0,
    place_on: str = "",
    snap_to_floor: bool = True,
    face_target: str = "",
) -> dict[str, Any]:
    """Import an asset from the library and place it in the scene.

    Imports the asset's model, groups it under one named anchor Empty (so it
    moves/rotates as a single unit), and positions that anchor using the
    asset's real-world bounding box — you specify where you want the object's
    footprint, not raw Blender coordinates for its origin.

    Placement rules:
    - If `place_on` is given (name of an existing object in the scene), the
      asset is snapped to rest exactly on top of that object's bounding box
      (use this for the library's declared `relations`, e.g. a pillow that
      `rests_on` a bed/sofa). `location`'s x/y (if given) still control
      horizontal position; z is computed automatically.
    - Otherwise, if `snap_to_floor` is True (default — correct for anything
      with placement.surface == "floor", which is most furniture), the
      asset's bottom is snapped to `location`'s z (0.0 = floor level).
    - If `snap_to_floor` is False, `location` is used as the literal anchor
      position — use this for wall/ceiling-mounted assets
      (placement.surface == "wall"/"ceiling" from get_asset_details) where
      you are positioning by hand.
    - `location` x/y always default to (0, 0) — the room origin — or to the
      center of `place_on`'s footprint when `place_on` is given.

    Args:
        asset_id: Asset id from search_asset_library() (e.g. "bed/bed_frame_01").
        name: Optional name for the anchor object. Defaults to the asset's name.
        location: Optional [x, y, z] world position for the asset's footprint
                  center (and snapped base, per snap_to_floor). Defaults to
                  (0, 0, 0), or centered on `place_on` if given.
        rotation_euler: XYZ rotation in radians applied to the whole asset.
        scale: Uniform scale multiplier. Defaults to 1.0 (use the asset's
               true real-world size — do not resize library assets without a
               specific reason).
        place_on: Name of an existing scene object to rest this asset on top
                  of (implements the library's `rests_on` relation).
        snap_to_floor: Whether to snap the asset's bottom to `location.z`
                        (or to `place_on`'s top). Defaults to True.
        face_target: Name of an existing scene object to turn this asset to
                     face (implements the library's `faces` relation, e.g. a
                     stool that faces a dressing table, a sofa that should
                     face a TV). Computes the yaw needed so the asset's real
                     forward direction (its `orientation.forward_axis` from
                     metadata, already accounted for) points at the target's
                     horizontal position, and overrides the Z component of
                     `rotation_euler` with it — any X/Y tilt you passed in
                     `rotation_euler` is kept. Leave empty to use
                     `rotation_euler` as-is.

    Returns:
        Dict with the anchor object's name, asset_id, imported_objects,
        final world location, and final dimensions in meters.
    """
    catalog = get_catalog()
    try:
        asset = catalog.get(asset_id)
    except AssetCatalogError as e:
        raise ValidationError(str(e)) from e

    if name:
        name = validate_object_name(name)
    else:
        name = asset.name

    if location is not None:
        location = validate_vector(location, size=3, name="location")
    rotation_euler = validate_vector(rotation_euler, size=3, name="rotation_euler")
    scale = float(validate_numeric_range(scale, min_val=0.001, max_val=1000, name="scale"))
    if place_on:
        place_on = validate_object_name(place_on)
    if face_target:
        face_target = validate_object_name(face_target)

    conn = get_connection()

    # 1. Import the asset's model file. Imported objects keep whatever raw
    #    coordinates they had in the source .blend they were extracted from
    #    (often far from world origin) — everything below corrects for that.
    import_result = _send(conn, "import_file", {"filepath": asset.model_path, "type": ""})
    imported_objects: list[str] = import_result.get("imported_objects", [])
    if not imported_objects:
        raise RuntimeError(f"Import of '{asset_id}' produced no objects")

    # 2. Find hierarchy roots (only these need repositioning/parenting —
    #    nested children move with their existing parent automatically).
    imported_set = set(imported_objects)
    roots = [
        obj_name for obj_name in imported_objects
        if _send(conn, "get_object_info", {"name": obj_name}).get("parent") not in imported_set
    ]

    # 2b. Reset each root's rotation to identity. Imported objects keep
    #     whatever rotation they had in the source .blend (frequently a
    #     non-zero baked rotation from axis-convention differences or how
    #     the object happened to sit in that scene) — without this, even a
    #     correctly-positioned asset can come in visibly tilted or rotated
    #     90° off, and rotation_euler=(0,0,0) from the caller would silently
    #     do nothing to fix it. Resetting here makes rotation_euler=(0,0,0)
    #     always mean "the asset's own upright/canonical pose," not
    #     "whatever the source scene left it at."
    for root_name in roots:
        _send(conn, "set_rotation", {"name": root_name, "rotation": [0, 0, 0], "mode": "EULER"})

    # 2c. Measure the combined world-space bounding box. Must happen AFTER
    #     the rotation reset above, since re-orienting the geometry changes it.
    root_info = {}
    mins, maxs = [], []
    for obj_name in imported_objects:
        info = _send(conn, "get_object_info", {"name": obj_name})
        if obj_name in roots:
            root_info[obj_name] = info
        bmin, bmax = info.get("bound_box_world_min"), info.get("bound_box_world_max")
        if bmin and bmax:
            mins.append(bmin)
            maxs.append(bmax)
    if not mins:
        raise RuntimeError(f"Could not measure bounding box for '{asset_id}'")
    combined_min = [min(v[i] for v in mins) for i in range(3)]
    combined_max = [max(v[i] for v in maxs) for i in range(3)]
    center_x = (combined_min[0] + combined_max[0]) / 2
    center_y = (combined_min[1] + combined_max[1]) / 2

    # 3. Resolve the target position.
    if place_on:
        target_info = _send(conn, "get_object_info", {"name": place_on})
        target_bmax = target_info.get("bound_box_world_max")
        target_bmin = target_info.get("bound_box_world_min")
        if not target_bmax or not target_bmin:
            raise RuntimeError(f"Could not measure bounding box for place_on target '{place_on}'")
        target_z = target_bmax[2]
        default_x = (target_bmin[0] + target_bmax[0]) / 2
        default_y = (target_bmin[1] + target_bmax[1]) / 2
    else:
        target_z = location[2] if location is not None else 0.0
        default_x = 0.0
        default_y = 0.0

    target_x = location[0] if location is not None else default_x
    target_y = location[1] if location is not None else default_y

    # 4. Translate the root objects directly (by the delta that takes the
    #    combined bbox to the target) — this fixes their real world position
    #    BEFORE any anchor exists, so the anchor's origin can end up exactly
    #    at the meaningful point (target_x, target_y, target_z) instead of
    #    an arbitrary translation offset. That matters: other tools (e.g.
    #    point_camera_at, place_on) look at the object's real origin, not at
    #    whatever this function returns.
    delta_x = target_x - center_x
    delta_y = target_y - center_y
    delta_z = (target_z - combined_min[2]) if snap_to_floor else (target_z - (combined_min[2] + combined_max[2]) / 2)
    for root_name in roots:
        loc = root_info[root_name]["location"]
        new_loc = [loc[i] + [delta_x, delta_y, delta_z][i] for i in range(3)]
        _send(conn, "set_location", {"name": root_name, "location": new_loc})

    # 5. Create the anchor Empty exactly at the target point and parent the
    #    (now correctly positioned) roots to it with keep-transform, so
    #    nothing visually moves — but rotation/scale below now pivot around
    #    a meaningful point instead of an arbitrary one.
    anchor_result = _send(conn, "create_object", {
        "type": "EMPTY", "name": name,
        "location": [target_x, target_y, target_z], "rotation": [0, 0, 0], "scale": [1, 1, 1],
    })
    anchor_name = anchor_result["name"]
    for root_name in roots:
        _send(conn, "parent_objects", {"child": root_name, "parent": anchor_name})

    # 5b. face_target: compute the yaw that turns the asset's real forward
    #     direction (its metadata forward_axis, now equal to world +Y/etc.
    #     since roots were reset to identity rotation in step 2b) toward the
    #     target's horizontal position, and use it in place of rotation_euler's
    #     Z component. X/Y from rotation_euler are kept for tilt.
    final_rotation = list(rotation_euler)
    if face_target:
        face_info = _send(conn, "get_object_info", {"name": face_target})
        face_bmin, face_bmax = face_info.get("bound_box_world_min"), face_info.get("bound_box_world_max")
        if face_bmin and face_bmax:
            face_x, face_y = (face_bmin[0] + face_bmax[0]) / 2, (face_bmin[1] + face_bmax[1]) / 2
        else:
            face_x, face_y = face_info["location"][0], face_info["location"][1]
        dx, dy = face_x - target_x, face_y - target_y
        if dx or dy:
            final_rotation[2] = math.atan2(dy, dx) - _axis_to_angle(asset.forward_axis)

    if any(final_rotation):
        _send(conn, "set_rotation", {"name": anchor_name, "rotation": final_rotation, "mode": "EULER"})
    if scale != 1.0:
        _send(conn, "set_scale", {"name": anchor_name, "scale": [scale, scale, scale]})

    # 6. Re-measure the bbox for accurate reporting if rotation/scale changed it.
    if any(final_rotation) or scale != 1.0:
        mins, maxs = [], []
        for obj_name in imported_objects:
            info = _send(conn, "get_object_info", {"name": obj_name})
            bmin, bmax = info.get("bound_box_world_min"), info.get("bound_box_world_max")
            if bmin and bmax:
                mins.append(bmin)
                maxs.append(bmax)
        combined_min = [min(v[i] for v in mins) for i in range(3)]
        combined_max = [max(v[i] for v in maxs) for i in range(3)]

    return {
        "name": anchor_name,
        "asset_id": asset_id,
        "imported_objects": imported_objects,
        "location": [target_x, target_y, target_z],
        "rotation_euler": final_rotation,
        "dimensions_m": [round(combined_max[i] - combined_min[i], 4) for i in range(3)],
        "needs_review": asset.needs_review,
        "orientation_confidence": asset.orientation_confidence,
    }
