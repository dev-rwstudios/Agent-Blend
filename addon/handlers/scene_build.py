"""Blender addon handlers used by the desktop app's build agent.

- build_boxes:    create many exact-size boxes (floors, wall segments) in one call
- get_layout:     read back the real world bounding boxes of what the agent built
- capture_review: render a framed review image of a region (workbench, fast)

Everything the agent creates is tagged with `ab_*` custom properties and kept
in its own collection, so it can be found, checked and removed without
touching the user's own objects.
"""

import base64
import math
import os
import tempfile

import bmesh
import bpy
from mathutils import Vector

from .. import dispatcher


def _ensure_collection(name: str):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def _material(name: str, spec: dict):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
    color = spec.get("color")
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    if color and len(color) >= 3:
        rgba = (float(color[0]), float(color[1]), float(color[2]), float(color[3]) if len(color) > 3 else 1.0)
        mat.diffuse_color = rgba  # used by the workbench review render
        if bsdf:
            bsdf.inputs["Base Color"].default_value = rgba
    if bsdf and "roughness" in spec:
        bsdf.inputs["Roughness"].default_value = float(spec["roughness"])
    return mat


def handle_build_boxes(params: dict) -> dict:
    """Create axis-aligned boxes with exact dimensions (no object scale).

    params:
      collection: collection to put them in
      materials:  {name: {"color": [r, g, b, a], "roughness": float}}
      boxes:      [{"name", "center": [x, y, z], "size": [sx, sy, sz],
                    "material"?: name, "role"?: "structure" | "placeholder",
                    "tags"?: {key: value}}]
    """
    boxes = params.get("boxes") or []
    if not boxes:
        raise ValueError("No boxes given")
    coll = _ensure_collection(params.get("collection") or "Agent Build")
    materials = {n: _material(n, spec or {}) for n, spec in (params.get("materials") or {}).items()}

    created = []
    for box in boxes:
        size = [float(v) for v in box["size"]]
        if any(v <= 0 for v in size):
            raise ValueError(f"Box '{box.get('name')}' has a non-positive size: {size}")
        mesh = bpy.data.meshes.new(box.get("name", "Box"))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= size[0]
            v.co.y *= size[1]
            v.co.z *= size[2]
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(box.get("name", "Box"), mesh)
        obj.location = Vector([float(v) for v in box["center"]])
        coll.objects.link(obj)
        mat = materials.get(box.get("material", ""))
        if mat:
            mesh.materials.append(mat)
        obj["ab_role"] = box.get("role", "structure")
        for key, value in (box.get("tags") or {}).items():
            if isinstance(value, (str, int, float, bool)):
                obj[f"ab_{key}"] = value
        created.append(obj.name)

    return {"collection": coll.name, "created": created, "count": len(created)}


def _world_bbox(objs):
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for obj in objs:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            co = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], co[i])
                hi[i] = max(hi[i], co[i])
    if lo[0] == math.inf:
        return None
    return [round(v, 4) for v in lo], [round(v, 4) for v in hi]


def _unit_objects(obj):
    """The object plus everything parented under it (an imported asset's parts)."""
    return [obj, *obj.children_recursive]


def handle_get_layout(params: dict) -> dict:
    """Bounding boxes of every tagged unit (assets, structure) in a collection,
    plus the bounds of everything else in the scene (so a new build can be
    placed beside existing objects instead of on top of them)."""
    bpy.context.view_layer.update()
    coll_name = params.get("collection", "")
    coll = bpy.data.collections.get(coll_name) if coll_name else None

    units = []
    in_build = set()
    if coll is not None:
        for obj in coll.all_objects:
            if "ab_role" not in obj or (obj.parent is not None and "ab_role" in obj.parent):
                continue
            parts = _unit_objects(obj)
            in_build.update(p.name for p in parts)
            bbox = _world_bbox(parts)
            if bbox is None:
                continue
            unit = {
                "name": obj.name,
                "bbox_min": bbox[0],
                "bbox_max": bbox[1],
                "rotation_z": round(obj.rotation_euler.z, 4),
            }
            for key in obj.keys():
                if key.startswith("ab_"):
                    value = obj[key]
                    if isinstance(value, (str, int, float, bool)):
                        unit[key[3:]] = value
            units.append(unit)

    others = [o for o in bpy.context.scene.objects if o.name not in in_build and o.type == "MESH"]
    other_bbox = _world_bbox(others)
    return {
        "collection": coll.name if coll else None,
        "units": units,
        "other_objects": len(others),
        "other_bbox_min": other_bbox[0] if other_bbox else None,
        "other_bbox_max": other_bbox[1] if other_bbox else None,
    }


def handle_capture_review(params: dict) -> dict:
    """Render a quick review image framing a region, from a temporary camera.

    params: bbox_min, bbox_max, view ("persp" | "top"), width, height.
    The user's camera, render engine and resolution are restored afterwards.
    """
    lo = Vector([float(v) for v in params["bbox_min"]])
    hi = Vector([float(v) for v in params["bbox_max"]])
    view = params.get("view", "persp")
    width = int(params.get("width", 960))
    height = int(params.get("height", 600))
    center = (lo + hi) / 2
    size = hi - lo

    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("AB_ReviewCam")
    cam = bpy.data.objects.new("AB_ReviewCam", cam_data)
    scene.collection.objects.link(cam)
    aspect = width / height

    if view == "top":
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = max(size.x, size.y * aspect) * 1.12 + 0.5
        cam.location = (center.x, center.y, hi.z + 20)
        cam.rotation_euler = (0.0, 0.0, 0.0)
        cam_data.clip_end = hi.z + 40
    else:
        radius = max(size.length / 2, 1.0)
        fov = cam_data.angle
        dist = radius / math.sin(fov / 2) * 1.3
        if "azimuth" in params or "elevation" in params:
            # azimuth 0 = looking from the -Y side toward +Y; positive turns toward +X. Degrees.
            az = math.radians(float(params.get("azimuth", -30)))
            el = math.radians(float(params.get("elevation", 35)))
            direction = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))).normalized()
        else:
            direction = Vector((-0.55, -0.9, 1.05)).normalized()  # 3/4 view from the front-left, looking down
        cam.location = center + direction * dist
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam_data.clip_end = dist * 4

    saved = {
        "camera": scene.camera,
        "engine": scene.render.engine,
        "x": scene.render.resolution_x,
        "y": scene.render.resolution_y,
        "pct": scene.render.resolution_percentage,
        "color_type": scene.display.shading.color_type,
        "light": scene.display.shading.light,
    }
    tmp_dir = tempfile.mkdtemp()
    path = os.path.join(tmp_dir, "review.png")
    try:
        scene.camera = cam
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        bpy.ops.render.render(write_still=False)
        bpy.data.images["Render Result"].save_render(path)
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
    finally:
        scene.camera = saved["camera"]
        scene.render.engine = saved["engine"]
        scene.render.resolution_x = saved["x"]
        scene.render.resolution_y = saved["y"]
        scene.render.resolution_percentage = saved["pct"]
        scene.display.shading.color_type = saved["color_type"]
        scene.display.shading.light = saved["light"]
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.cameras.remove(cam_data)
        try:
            os.remove(path)
            os.rmdir(tmp_dir)
        except OSError:
            pass

    return {"base64": data, "format": "png", "width": width, "height": height, "view": view}


def handle_remove_units(params: dict) -> dict:
    """Delete agent-built units (an asset's anchor and all of its parts).
    Only objects tagged by the agent (ab_role) are removed."""
    removed = []
    for name in params.get("names") or []:
        obj = bpy.data.objects.get(name)
        if obj is None or "ab_role" not in obj:
            continue
        for part in [*obj.children_recursive, obj]:
            removed.append(part.name)
            bpy.data.objects.remove(part, do_unlink=True)
    return {"removed": removed, "count": len(removed)}


def handle_measure_asset(params: dict) -> dict:
    """Real size of a model file (for assets without metadata): import it,
    measure, and remove it again."""
    from . import file_ops

    filepath = params.get("model_path", "")
    if not filepath or not os.path.isfile(filepath):
        raise ValueError(f"Model file not found: '{filepath}'")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    before = set(bpy.data.objects.keys())
    meshes_before = set(bpy.data.meshes.keys())
    import_op = file_ops.IMPORT_OPERATORS.get(file_ops._get_extension(filepath, ""))
    if import_op is None:
        raise ValueError(f"Unsupported model format: '{filepath}'")
    import_op(filepath)
    new_objs = [bpy.data.objects[n] for n in set(bpy.data.objects.keys()) - before]
    try:
        bpy.context.view_layer.update()
        bbox = file_ops._mesh_world_bbox(new_objs)
        if bbox is None:
            raise ValueError(f"'{filepath}' contains no mesh geometry")
        lo, hi = bbox
        return {"dimensions": [round(hi[i] - lo[i], 4) for i in range(3)]}
    finally:
        for obj in new_objs:
            bpy.data.objects.remove(obj, do_unlink=True)
        for name in set(bpy.data.meshes.keys()) - meshes_before:
            mesh = bpy.data.meshes.get(name)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)


def register():
    dispatcher.register_handler("build_boxes", handle_build_boxes)
    dispatcher.register_handler("get_layout", handle_get_layout)
    dispatcher.register_handler("capture_review", handle_capture_review)
    dispatcher.register_handler("remove_units", handle_remove_units)
    dispatcher.register_handler("measure_asset", handle_measure_asset)
