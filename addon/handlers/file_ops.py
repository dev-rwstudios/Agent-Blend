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
        filepath = f"{filepath}.blend"

    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=filepath, copy=True, compress=True)
        return {"filepath": filepath, "name": name, "success": True, "source_filepath": bpy.data.filepath}
    except Exception as e:
        raise RuntimeError(f"Failed to save checkpoint: {e}")


def handle_import_asset(params: dict) -> dict:
    """Import an asset model (.glb) and snap/position in the scene."""
    filepath = params.get("model_path") or params.get("filepath")
    asset_id = params.get("asset_id", "")
    name = params.get("name", "")
    location = params.get("location", [0.0, 0.0, 0.0])
    snap_to_floor = params.get("snap_to_floor", True)

    if not filepath and asset_id:
        parts = asset_id.split("/")
        candidates = [
            os.path.join(r"C:\Users\admin\Desktop\Agent-Blend\Agent-Blend\asset_library", *parts, "model.glb"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "asset_library", *parts, "model.glb"),
        ]
        for c in candidates:
            if os.path.exists(c):
                filepath = c
                break

    if not filepath or not os.path.exists(filepath):
        raise ValueError(f"Asset model file not found for asset_id '{asset_id}' or path '{filepath}'")

    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    objects_before = set(bpy.data.objects.keys())

    res = bpy.ops.import_scene.gltf(filepath=filepath)
    if res != {'FINISHED'}:
        raise RuntimeError(f"GLTF import did not finish successfully: {res}")

    objects_after = set(bpy.data.objects.keys())
    new_objs = [bpy.data.objects[n] for n in (objects_after - objects_before) if n in bpy.data.objects]

    if not new_objs:
        raise RuntimeError(f"Import of '{filepath}' produced no objects")

    bpy.context.view_layer.update()

    all_verts = []
    for obj in new_objs:
        if obj.type == 'MESH' and obj.data:
            all_verts.extend([obj.matrix_world @ v.co for v in obj.data.vertices])

    if all_verts:
        min_x = min(v.x for v in all_verts)
        max_x = max(v.x for v in all_verts)
        min_y = min(v.y for v in all_verts)
        max_y = max(v.y for v in all_verts)
        min_z = min(v.z for v in all_verts)
        center_x = (min_x + max_x) / 2.0
        center_y = (min_y + max_y) / 2.0

        target_x = float(location[0]) if len(location) > 0 else 0.0
        target_y = float(location[1]) if len(location) > 1 else 0.0
        target_z = float(location[2]) if len(location) > 2 else 0.0

        dx = target_x - center_x
        dy = target_y - center_y
        dz = (target_z - min_z) if snap_to_floor else target_z

        for obj in new_objs:
            if obj.parent is None or obj.parent not in new_objs:
                obj.location.x += dx
                obj.location.y += dy
                obj.location.z += dz

        bpy.context.view_layer.update()

    root_name = new_objs[0].name
    if name and name != root_name:
        new_objs[0].name = name
        root_name = name

    return {
        "success": True,
        "asset_id": asset_id,
        "name": root_name,
        "imported_objects": [o.name for o in new_objs],
        "location": [float(location[0]), float(location[1]), float(location[2])] if len(location) >= 3 else [0, 0, 0],
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


def register():
    """Register file operations handlers with the dispatcher."""
    dispatcher.register_handler("import_file", handle_import_file)
    dispatcher.register_handler("import_asset", handle_import_asset)
    dispatcher.register_handler("export_file", handle_export_file)
    dispatcher.register_handler("save_file", handle_save_file)
    dispatcher.register_handler("open_file", handle_open_file)
    dispatcher.register_handler("list_recent_files", handle_list_recent_files)
    dispatcher.register_handler("save_checkpoint", handle_save_checkpoint)

