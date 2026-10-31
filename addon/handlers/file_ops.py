"""Blender addon handlers for file import/export commands.

SECURITY: All imports disable auto-execute scripts to prevent script injection
from untrusted files.
"""

import os

import bpy
from .. import dispatcher

# Map file extensions to import operators
IMPORT_OPERATORS = {
    ".fbx": lambda fp, **kw: bpy.ops.import_scene.fbx(filepath=fp, **kw),
    ".obj": lambda fp, **kw: bpy.ops.wm.obj_import(filepath=fp, **kw),
    ".gltf": lambda fp, **kw: bpy.ops.import_scene.gltf(filepath=fp, **kw),
    ".glb": lambda fp, **kw: bpy.ops.import_scene.gltf(filepath=fp, **kw),
    ".usd": lambda fp, **kw: bpy.ops.wm.usd_import(filepath=fp, **kw),
    ".usda": lambda fp, **kw: bpy.ops.wm.usd_import(filepath=fp, **kw),
    ".usdc": lambda fp, **kw: bpy.ops.wm.usd_import(filepath=fp, **kw),
    ".usdz": lambda fp, **kw: bpy.ops.wm.usd_import(filepath=fp, **kw),
    ".stl": lambda fp, **kw: bpy.ops.wm.stl_import(filepath=fp, **kw),
    ".ply": lambda fp, **kw: bpy.ops.wm.ply_import(filepath=fp, **kw),
    ".abc": lambda fp, **kw: bpy.ops.wm.alembic_import(filepath=fp, **kw),
    ".dae": lambda fp, **kw: bpy.ops.wm.collada_import(filepath=fp, **kw),
    ".svg": lambda fp, **kw: bpy.ops.import_curve.svg(filepath=fp, **kw),
    ".x3d": lambda fp, **kw: bpy.ops.import_scene.x3d(filepath=fp, **kw),
}

# Map file extensions to export operators
EXPORT_OPERATORS = {
    ".fbx": lambda fp, **kw: bpy.ops.export_scene.fbx(filepath=fp, **kw),
    ".obj": lambda fp, **kw: bpy.ops.wm.obj_export(filepath=fp, **kw),
    ".gltf": lambda fp, **kw: bpy.ops.export_scene.gltf(filepath=fp, export_format='GLTF_SEPARATE', **kw),
    ".glb": lambda fp, **kw: bpy.ops.export_scene.gltf(filepath=fp, export_format='GLB', **kw),
    ".usd": lambda fp, **kw: bpy.ops.wm.usd_export(filepath=fp, **kw),
    ".usda": lambda fp, **kw: bpy.ops.wm.usd_export(filepath=fp, **kw),
    ".usdc": lambda fp, **kw: bpy.ops.wm.usd_export(filepath=fp, **kw),
    ".usdz": lambda fp, **kw: bpy.ops.wm.usd_export(filepath=fp, **kw),
    ".stl": lambda fp, **kw: bpy.ops.wm.stl_export(filepath=fp, **kw),
    ".ply": lambda fp, **kw: bpy.ops.wm.ply_export(filepath=fp, **kw),
    ".abc": lambda fp, **kw: bpy.ops.wm.alembic_export(filepath=fp, **kw),
    ".dae": lambda fp, **kw: bpy.ops.wm.collada_export(filepath=fp, **kw),
    ".svg": lambda fp, **kw: bpy.ops.import_curve.svg(filepath=fp, **kw),
    ".x3d": lambda fp, **kw: bpy.ops.export_scene.x3d(filepath=fp, **kw),
}

# Map type strings to extensions
TYPE_TO_EXTENSION = {
    "FBX": ".fbx",
    "OBJ": ".obj",
    "GLTF": ".gltf",
    "USD": ".usd",
    "STL": ".stl",
    "PLY": ".ply",
    "ABC": ".abc",
    "DAE": ".dae",
    "SVG": ".svg",
    "X3D": ".x3d",
}


def _get_extension(filepath: str, type_hint: str = "") -> str:
    """Determine file extension from type hint or filepath."""
    if type_hint:
        ext = TYPE_TO_EXTENSION.get(type_hint.upper())
        if ext:
            return ext
    return os.path.splitext(filepath)[1].lower()


def handle_import_file(params: dict) -> dict:
    """Import a file into Blender."""
    filepath = params.get("filepath")
    type_hint = params.get("type", "")

    try:
        # SECURITY: Disable auto-execute scripts to prevent script injection
        # from imported files. This MUST happen before any import operation.
        bpy.context.preferences.filepaths.use_scripts_auto_execute = False

        ext = _get_extension(filepath, type_hint)
        import_op = IMPORT_OPERATORS.get(ext)
        if import_op is None:
            raise ValueError(f"Unsupported import format: '{ext}'")

        # Count objects before import to determine what was imported
        objects_before = set(bpy.data.objects.keys())

        result = import_op(filepath)

        if result != {'FINISHED'}:
            raise RuntimeError(f"Import operator did not finish successfully: {result}")

        # Determine newly imported objects
        objects_after = set(bpy.data.objects.keys())
        new_objects = list(objects_after - objects_before)

        # Asset-library models keep the coordinates of the scene they were
        # extracted from — never drop them at those stale positions.
        if _is_library_asset(filepath):
            _recenter_at_origin([bpy.data.objects[n] for n in new_objects if n in bpy.data.objects])

        return {
            "filepath": filepath,
            "format": ext.lstrip(".").upper(),
            "imported_objects": new_objects,
            "success": True,
        }
    except ValueError:
        raise
    except Exception as e:
        raise RuntimeError(f"Failed to import '{filepath}': {e}")


def handle_export_file(params: dict) -> dict:
    """Export to a file from Blender."""
    filepath = params.get("filepath")
    type_hint = params.get("type", "")
    selected_only = params.get("selected_only", False)

    try:
        ext = _get_extension(filepath, type_hint)
        export_op = EXPORT_OPERATORS.get(ext)
        if export_op is None:
            raise ValueError(f"Unsupported export format: '{ext}'")

        kwargs = {}
        if selected_only:
            # Most exporters use use_selection, some use export_selected_objects
            kwargs["use_selection"] = True

        result = export_op(filepath, **kwargs)  # noqa: F841

        return {
            "filepath": filepath,
            "format": ext.lstrip(".").upper(),
            "selected_only": selected_only,
            "success": True,
        }
    except ValueError:
        raise
    except Exception as e:
        raise RuntimeError(f"Failed to export '{filepath}': {e}")


def handle_save_file(params: dict) -> dict:
    """Save the current Blender file."""
    filepath = params.get("filepath", "")

    try:
        if filepath:
            bpy.ops.wm.save_as_mainfile(filepath=filepath)
            saved_path = filepath
        else:
            current_path = bpy.data.filepath
            if not current_path:
                raise ValueError(
                    "No current file path. Provide a filepath for Save As."
                )
            bpy.ops.wm.save_mainfile()
            saved_path = current_path

        return {
            "filepath": saved_path,
            "success": True,
        }
    except ValueError:
        raise
    except Exception as e:
        raise RuntimeError(f"Failed to save file: {e}")


def handle_open_file(params: dict) -> dict:
    """Open a .blend file."""
    filepath = params.get("filepath")

    try:
        # SECURITY: Disable auto-execute scripts before opening files
        bpy.context.preferences.filepaths.use_scripts_auto_execute = False

        bpy.ops.wm.open_mainfile(filepath=filepath)

        return {
            "filepath": filepath,
            "success": True,
        }
    except Exception as e:
        raise RuntimeError(f"Failed to open file '{filepath}': {e}")


def handle_get_file_info(params: dict) -> dict:
    """Report which .blend Blender has open — the desktop app compares this
    against the active project's scene file before saving or switching."""
    return {
        "filepath": bpy.data.filepath,
        "is_dirty": bool(bpy.data.is_dirty),
        "object_count": len(bpy.data.objects),
    }


def handle_new_file(params: dict) -> dict:
    """Replace the open file with an empty scene, optionally saving it to
    `filepath` straight away so it becomes the file Blender has open.

    Uses the user's home file with use_empty=True rather than factory
    startup — factory startup would also disable add-ons, including this one.
    """
    filepath = params.get("filepath", "")
    if filepath and not filepath.endswith(".blend"):
        raise ValueError("New file path must end in .blend")

    try:
        bpy.ops.wm.read_homefile(use_empty=True)
        if filepath:
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=filepath)
        return {"filepath": bpy.data.filepath, "success": True}
    except Exception as e:
        raise RuntimeError(f"Failed to create new file: {e}")


def handle_save_checkpoint(params: dict) -> dict:
    """Write a copy of the current scene to `filepath` without changing the
    file Blender has open — the chat app's per-turn undo snapshots."""
    import tempfile
    import time
    name = params.get("name", "checkpoint")
    filepath = params.get("filepath", "")
    if not filepath:
        clean_name = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in name)
        filepath = os.path.join(tempfile.gettempdir(), f"blend_ai_cp_{clean_name}_{int(time.time())}.blend")
    elif not filepath.endswith(".blend"):
        raise ValueError("Checkpoint path must end in .blend")

    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=filepath, copy=True, compress=True)
        return {"filepath": filepath, "name": name, "success": True, "source_filepath": bpy.data.filepath}
    except Exception as e:
        raise RuntimeError(f"Failed to save checkpoint: {e}")


def _mesh_world_bbox(objs) -> tuple[list[float], list[float]] | None:
    """World-space bounding box over the vertices of the mesh objects in `objs`."""
    from mathutils import Vector

    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    found = False
    for obj in objs:
        if obj.type != "MESH" or obj.data is None:
            continue
        mw = obj.matrix_world
        coords = [mw @ v.co for v in obj.data.vertices] or [mw @ Vector(c) for c in obj.bound_box]
        for co in coords:
            found = True
            for i in range(3):
                lo[i] = min(lo[i], co[i])
                hi[i] = max(hi[i], co[i])
    return (lo, hi) if found else None


def _import_roots(new_objs) -> list:
    """Imported objects whose parent isn't part of the same import."""
    new_set = set(new_objs)
    return [o for o in new_objs if o.parent is None or o.parent not in new_set]


def _translate(objs, delta) -> None:
    for obj in objs:
        obj.location.x += delta[0]
        obj.location.y += delta[1]
        obj.location.z += delta[2]


def _recenter_at_origin(new_objs) -> None:
    """Library asset files keep the coordinates of the scene they were cut
    from; move the asset so its footprint is centered on the origin with its
    bottom at z = 0."""
    bpy.context.view_layer.update()
    bbox = _mesh_world_bbox(new_objs)
    if bbox is None:
        return
    lo, hi = bbox
    _translate(_import_roots(new_objs), [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
    bpy.context.view_layer.update()


def _is_library_asset(filepath: str) -> bool:
    return os.path.isfile(os.path.join(os.path.dirname(filepath), "metadata.json"))


def _ensure_collection(name: str):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    if coll.name not in bpy.context.scene.collection.children and coll is not bpy.context.scene.collection:
        try:
            bpy.context.scene.collection.children.link(coll)
        except RuntimeError:
            pass  # already linked somewhere in the hierarchy
    return coll


def _move_to_collection(objs, coll) -> None:
    for obj in objs:
        for c in list(obj.users_collection):
            if c is not coll:
                c.objects.unlink(obj)
        if obj.name not in coll.objects:
            coll.objects.link(obj)


def handle_import_asset(params: dict) -> dict:
    """Import an asset model and place it as one unit.

    The asset is re-centered (library files keep the coordinates of the scene
    they were extracted from), grouped under a single named anchor Empty so it
    moves/rotates as one object, then placed so its footprint is centered on
    `location` x/y with its bottom at `location` z, and rotated by
    `rotation_z` radians about its own center.

    Optional: `collection` (put the asset there), `tags` (custom properties on
    the anchor, e.g. which plan item it fulfils), `scale` (uniform).
    """
    filepath = params.get("model_path") or params.get("filepath")
    asset_id = params.get("asset_id", "")
    name = params.get("name", "")
    location = list(params.get("location") or [0.0, 0.0, 0.0])
    while len(location) < 3:
        location.append(0.0)
    rotation_z = float(params.get("rotation_z", 0.0) or 0.0)
    scale = float(params.get("scale", 1.0) or 1.0)
    collection_name = params.get("collection", "")
    tags = params.get("tags") or {}

    if not filepath and asset_id:
        parts = asset_id.split("/")
        candidates = []
        env_assets = os.environ.get("AGENT_BLEND_ASSETS_PATH")
        if env_assets:
            candidates.append(os.path.join(env_assets, *parts, "model.glb"))
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        candidates.append(os.path.join(project_root, "asset_library", *parts, "model.glb"))
        for c in candidates:
            if os.path.exists(c):
                filepath = c
                break

    if not filepath or not os.path.exists(filepath):
        raise ValueError(f"Asset model file not found for asset_id '{asset_id}' or path '{filepath}'")

    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    objects_before = set(bpy.data.objects.keys())

    ext = _get_extension(filepath, "")
    import_op = IMPORT_OPERATORS.get(ext)
    if import_op:
        res = import_op(filepath)
    else:
        res = bpy.ops.import_scene.gltf(filepath=filepath)
    if res != {'FINISHED'}:
        raise RuntimeError(f"Import did not finish successfully: {res}")

    objects_after = set(bpy.data.objects.keys())
    new_objs = [bpy.data.objects[n] for n in sorted(objects_after - objects_before) if n in bpy.data.objects]
    if not new_objs:
        raise RuntimeError(f"Import of '{filepath}' produced no objects")

    # 1. Re-center: footprint on the origin, bottom at z = 0.
    _recenter_at_origin(new_objs)
    roots = _import_roots(new_objs)

    # 2. Group under one anchor at the origin so the asset is a single unit.
    anchor_name = name or os.path.basename(os.path.dirname(filepath)) or os.path.splitext(os.path.basename(filepath))[0]
    anchor = bpy.data.objects.new(anchor_name, None)
    anchor.empty_display_type = "PLAIN_AXES"
    anchor.empty_display_size = 0.25
    bpy.context.scene.collection.objects.link(anchor)
    for root in roots:
        world = root.matrix_world.copy()
        root.parent = anchor
        root.matrix_world = world

    # 3. Place: rotate/scale about the asset's own center, then move.
    anchor.rotation_euler = (0.0, 0.0, rotation_z)
    anchor.scale = (scale, scale, scale)
    anchor.location = (float(location[0]), float(location[1]), float(location[2]))

    if collection_name:
        _move_to_collection([anchor, *new_objs], _ensure_collection(collection_name))

    anchor["ab_role"] = "asset"
    if asset_id:
        anchor["ab_asset_id"] = asset_id
    for key, value in tags.items():
        if isinstance(value, (str, int, float, bool)):
            anchor[f"ab_{key}"] = value

    bpy.context.view_layer.update()
    bbox = _mesh_world_bbox(new_objs)
    lo, hi = bbox if bbox else ([0.0] * 3, [0.0] * 3)

    return {
        "success": True,
        "asset_id": asset_id,
        "name": anchor.name,
        "imported_objects": [o.name for o in new_objs],
        "location": [float(v) for v in anchor.location],
        "rotation_z": rotation_z,
        "bbox_min": [round(v, 4) for v in lo],
        "bbox_max": [round(v, 4) for v in hi],
        "dimensions": [round(hi[i] - lo[i], 4) for i in range(3)],
    }


def handle_list_recent_files(params: dict) -> list:
    """List recently opened files."""
    try:
        recent_files = []
        for recent in bpy.context.preferences.filepaths.recent_files:
            recent_files.append(recent.filepath)
        return recent_files
    except Exception as e:
        raise RuntimeError(f"Failed to list recent files: {e}")


def handle_scan_asset_library(params: dict) -> dict:
    """Scan a directory for 3D model assets and return structured catalog entries."""
    import json
    library_path = params.get("path", "").strip()
    if not library_path:
        env_assets = os.environ.get("AGENT_BLEND_ASSETS_PATH")
        if env_assets and os.path.isdir(env_assets):
            library_path = env_assets
        else:
            project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            candidate = os.path.join(project_root, "asset_library")
            if os.path.isdir(candidate):
                library_path = candidate

    if not library_path or not os.path.isdir(library_path):
        return {
            "valid": False,
            "path": library_path,
            "message": f"Directory does not exist: '{library_path}'",
            "total": 0,
            "categories": [],
            "assets": [],
        }

    valid_exts = {".glb", ".gltf", ".fbx", ".obj", ".blend", ".stl", ".usd", ".usdz", ".dae"}
    scanned_assets = []
    categories = set()

    for root, dirs, files in os.walk(library_path):
        model_files = [f for f in files if os.path.splitext(f)[1].lower() in valid_exts]
        if not model_files:
            continue

        meta = {}
        meta_path = os.path.join(root, "metadata.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
            except Exception:
                meta = {}

        for mf in model_files:
            full_model_path = os.path.join(root, mf)
            rel_dir = os.path.relpath(root, library_path)
            stem = os.path.splitext(mf)[0]
            ext = os.path.splitext(mf)[1].lower()

            if meta:
                cat = meta.get("classification", {}).get("category", "")
                if not cat:
                    parts = rel_dir.split(os.sep)
                    cat = parts[0] if parts and parts[0] != "." else "general"
                subcat = meta.get("classification", {}).get("subcategory", "")
                name = meta.get("name", stem)
                asset_id = meta.get("id") or rel_dir.replace("\\", "/")
                geom = meta.get("geometry", {})
                dims = None
                if geom and "width_mm" in geom:
                    dims = {
                        "width": round(geom.get("width_mm", 0) / 1000.0, 3),
                        "depth": round(geom.get("depth_mm", 0) / 1000.0, 3),
                        "height": round(geom.get("height_mm", 0) / 1000.0, 3),
                    }
            else:
                parts = rel_dir.split(os.sep)
                cat = parts[0] if parts and parts[0] != "." else "general"
                subcat = parts[1] if len(parts) > 1 else ""
                name = stem.replace("_", " ").title()
                asset_id = (os.path.join(rel_dir, stem) if rel_dir != "." else stem).replace("\\", "/")
                dims = None

            categories.add(cat)
            scanned_assets.append({
                "id": asset_id,
                "name": name,
                "category": cat,
                "subcategory": subcat,
                "dimensions_m": dims,
                "model_path": full_model_path,
                "format": ext.lstrip(".").upper(),
            })

    return {
        "valid": True,
        "path": library_path,
        "total": len(scanned_assets),
        "categories": sorted(list(categories)),
        "assets": scanned_assets,
    }


def register():
    """Register file operations handlers with the dispatcher."""
    dispatcher.register_handler("import_file", handle_import_file)
    dispatcher.register_handler("import_asset", handle_import_asset)
    dispatcher.register_handler("scan_asset_library", handle_scan_asset_library)
    dispatcher.register_handler("export_file", handle_export_file)
    dispatcher.register_handler("save_file", handle_save_file)
    dispatcher.register_handler("open_file", handle_open_file)
    dispatcher.register_handler("list_recent_files", handle_list_recent_files)
    dispatcher.register_handler("save_checkpoint", handle_save_checkpoint)
    dispatcher.register_handler("get_file_info", handle_get_file_info)
    dispatcher.register_handler("new_file", handle_new_file)

