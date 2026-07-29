"""Blender handlers for edit-mode mesh operations."""

import json

import bpy
import bmesh
from .. import dispatcher

SELECTION_SETS_KEY = "blend_ai_selection_sets"


def _ensure_object_mode():
    """Ensure we are in object mode."""
    if bpy.context.active_object and bpy.context.active_object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def _select_only(obj):
    """Deselect all and select only the given object, making it active."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _get_mesh_object(name):
    """Get a Blender mesh object by name, raising if not found or not a mesh."""
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise ValueError(f"Object '{name}' not found")
    if obj.type != "MESH":
        raise ValueError(f"Object '{name}' is not a mesh")
    return obj


def _enter_edit_select_all(obj):
    """Select object, enter edit mode, and select all geometry."""
    _select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")


def _select_by_indices(obj, indices, elem_type):
    """Enter edit mode and select only the given element indices.

    elem_type: 'VERT' | 'EDGE' | 'FACE'. Leaves the object in EDIT MODE with
    the selection applied — callers must NOT force it back to OBJECT mode
    (unlike every other handler in this file), since the whole point is for
    the selection to remain live for the next call.
    """
    _select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type=elem_type)
    bpy.ops.mesh.select_all(action="DESELECT")

    bm = bmesh.from_edit_mesh(obj.data)
    seq = {"VERT": bm.verts, "EDGE": bm.edges, "FACE": bm.faces}[elem_type]
    seq.ensure_lookup_table()

    max_index = len(seq) - 1
    selected, invalid = [], []
    for i in indices:
        if 0 <= i <= max_index:
            seq[i].select = True
            selected.append(i)
        else:
            invalid.append(i)

    bm.select_flush(True)
    bmesh.update_edit_mesh(obj.data)
    return selected, invalid


def _require_active_edit_selection(obj):
    """Raise a clear error if the object has no active edit-mode selection."""
    if obj.mode != "EDIT":
        raise ValueError(
            f"Object '{obj.name}' has no active edit-mode selection. "
            "Call select_vertices_by_index/select_edges_by_index/select_faces_by_index "
            "(or select_selection_set) first."
        )


def _current_selection_by_type(obj) -> dict:
    """Read current selection across all three element types from the live edit-mesh."""
    bm = bmesh.from_edit_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    return {
        "vert": [v.index for v in bm.verts if v.select],
        "edge": [e.index for e in bm.edges if e.select],
        "face": [f.index for f in bm.faces if f.select],
    }


def _count_selected(bm) -> dict:
    """Count currently-selected elements per type on a live edit-mesh bmesh."""
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    return {
        "vert": sum(1 for v in bm.verts if v.select),
        "edge": sum(1 for e in bm.edges if e.select),
        "face": sum(1 for f in bm.faces if f.select),
    }


def _load_selection_sets(obj) -> dict:
    """Load saved selection sets from the mesh datablock's JSON custom property."""
    raw = obj.data.get(SELECTION_SETS_KEY, "{}")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {}


def _save_selection_sets(obj, sets: dict) -> None:
    """Persist selection sets to the mesh datablock as a JSON string."""
    obj.data[SELECTION_SETS_KEY] = json.dumps(sets)


def handle_inset_faces(params):
    """Inset all faces of a mesh."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    thickness = params.get("thickness", 0.1)
    depth = params.get("depth", 0.0)

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.inset(thickness=thickness, depth=depth)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "thickness": thickness, "depth": depth}


def handle_fill_faces(params):
    """Fill selected edges with a face."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.fill()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_grid_fill(params):
    """Fill a closed edge loop with a grid of quads."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    span = params.get("span", 1)
    offset = params.get("offset", 0)

    _enter_edit_select_all(obj)
    bpy.ops.mesh.fill_grid(span=span, offset=offset)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "span": span, "offset": offset}


def handle_mark_seam(params):
    """Mark or clear UV seams on all edges."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    clear = params.get("clear", False)

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="EDGE")
    bpy.ops.mesh.mark_seam(clear=clear)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "clear": clear}


def handle_mark_sharp(params):
    """Mark or clear sharp edges."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    clear = params.get("clear", False)

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="EDGE")
    bpy.ops.mesh.mark_sharp(clear=clear)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "clear": clear}


def handle_recalculate_normals(params):
    """Recalculate face normals to be consistent."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    inside = params.get("inside", False)

    _enter_edit_select_all(obj)
    bpy.ops.mesh.normals_make_consistent(inside=inside)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "inside": inside}


def handle_flip_normals(params):
    """Flip all face normals."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_quads_to_tris(params):
    """Convert all quad faces to triangles."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_tris_to_quads(params):
    """Convert adjacent triangles to quads."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.tris_convert_to_quads()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_dissolve_faces(params):
    """Dissolve all faces."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.dissolve_faces()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_dissolve_edges(params):
    """Dissolve all edges."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="EDGE")
    bpy.ops.mesh.dissolve_edges()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_dissolve_verts(params):
    """Dissolve all vertices."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="VERT")
    bpy.ops.mesh.dissolve_verts()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_knife_project(params):
    """Project a cutter object onto a mesh."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    cutter_name = params["cutter_name"]
    cutter = bpy.data.objects.get(cutter_name)
    if cutter is None:
        raise ValueError(f"Cutter object '{cutter_name}' not found")

    # Bool Tool pattern: cutter selected, target active in edit mode
    bpy.ops.object.select_all(action="DESELECT")
    cutter.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.knife_project()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "cutter": cutter.name}


def handle_spin_mesh(params):
    """Spin mesh geometry around an axis."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    angle = params.get("angle", 6.283185307179586)
    steps = params.get("steps", 12)
    axis = tuple(params.get("axis", (0, 0, 1)))
    center = tuple(params.get("center", (0, 0, 0)))

    _enter_edit_select_all(obj)
    bpy.ops.mesh.spin(angle=angle, steps=steps, axis=axis, center=center)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {
        "object": obj.name,
        "angle": angle,
        "steps": steps,
        "axis": list(axis),
        "center": list(center),
    }


def handle_set_edge_crease(params):
    """Set edge crease on all edges."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])
    value = params.get("value", 1.0)

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_mode(type="EDGE")
    bpy.ops.transform.edge_crease(value=value)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name, "value": value}


def handle_select_linked(params):
    """Select all linked geometry."""
    _ensure_object_mode()
    obj = _get_mesh_object(params["object_name"])

    _enter_edit_select_all(obj)
    bpy.ops.mesh.select_linked()
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"object": obj.name}


def handle_select_vertices_by_index(params):
    """Select specific vertices by index, leaving the mesh in edit mode."""
    obj = _get_mesh_object(params["object_name"])
    indices = params.get("indices", [])
    selected, invalid = _select_by_indices(obj, indices, "VERT")
    return {"object": obj.name, "selected": selected, "invalid": invalid, "mode": "EDIT"}


def handle_select_edges_by_index(params):
    """Select specific edges by index, leaving the mesh in edit mode."""
    obj = _get_mesh_object(params["object_name"])
    indices = params.get("indices", [])
    selected, invalid = _select_by_indices(obj, indices, "EDGE")
    return {"object": obj.name, "selected": selected, "invalid": invalid, "mode": "EDIT"}


def handle_select_faces_by_index(params):
    """Select specific faces by index, leaving the mesh in edit mode."""
    obj = _get_mesh_object(params["object_name"])
    indices = params.get("indices", [])
    selected, invalid = _select_by_indices(obj, indices, "FACE")
    return {"object": obj.name, "selected": selected, "invalid": invalid, "mode": "EDIT"}


def handle_save_selection_set(params):
    """Save the current selection under a name for later recall."""
    obj = _get_mesh_object(params["object_name"])
    set_name = params["set_name"]
    _require_active_edit_selection(obj)
    sets = _load_selection_sets(obj)
    sets[set_name] = _current_selection_by_type(obj)
    _save_selection_sets(obj, sets)
    return {"object": obj.name, "set_name": set_name, "saved": sets[set_name]}


def handle_select_selection_set(params):
    """Recall a previously-saved named selection set."""
    obj = _get_mesh_object(params["object_name"])
    set_name = params["set_name"]
    sets = _load_selection_sets(obj)
    if set_name not in sets:
        raise ValueError(
            f"Selection set '{set_name}' not found on '{obj.name}'. "
            f"Available: {sorted(sets.keys())}"
        )
    saved = sets[set_name]

    _select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")

    bm = bmesh.from_edit_mesh(obj.data)
    for elem_type, seq_name in (("vert", "verts"), ("edge", "edges"), ("face", "faces")):
        elem_indices = saved.get(elem_type, [])
        if not elem_indices:
            continue
        seq = getattr(bm, seq_name)
        seq.ensure_lookup_table()
        max_index = len(seq) - 1
        for i in elem_indices:
            if 0 <= i <= max_index:
                seq[i].select = True

    bm.select_flush(True)
    bmesh.update_edit_mesh(obj.data)
    return {"object": obj.name, "set_name": set_name, "applied": saved, "mode": "EDIT"}


def handle_list_selection_sets(params):
    """List saved selection set names on an object."""
    obj = _get_mesh_object(params["object_name"])
    sets = _load_selection_sets(obj)
    return {"object": obj.name, "set_names": sorted(sets.keys())}


def handle_grow_selection(params):
    """Grow the current edit-mode selection along mesh topology."""
    obj = _get_mesh_object(params["object_name"])
    _require_active_edit_selection(obj)
    bpy.ops.mesh.select_more()
    bm = bmesh.from_edit_mesh(obj.data)
    return {"object": obj.name, "selected_count": _count_selected(bm), "mode": "EDIT"}


def handle_shrink_selection(params):
    """Shrink the current edit-mode selection along mesh topology."""
    obj = _get_mesh_object(params["object_name"])
    _require_active_edit_selection(obj)
    bpy.ops.mesh.select_less()
    bm = bmesh.from_edit_mesh(obj.data)
    return {"object": obj.name, "selected_count": _count_selected(bm), "mode": "EDIT"}


def handle_select_similar(params):
    """Select geometry similar to the current selection."""
    obj = _get_mesh_object(params["object_name"])
    _require_active_edit_selection(obj)
    compare_by = params.get("compare_by", "NORMAL")
    bpy.ops.mesh.select_similar(type=compare_by)
    bm = bmesh.from_edit_mesh(obj.data)
    return {"object": obj.name, "compare_by": compare_by, "selected_count": _count_selected(bm), "mode": "EDIT"}


def register():
    """Register all mesh editing handlers with the dispatcher."""
    dispatcher.register_handler("inset_faces", handle_inset_faces)
    dispatcher.register_handler("fill_faces", handle_fill_faces)
    dispatcher.register_handler("grid_fill", handle_grid_fill)
    dispatcher.register_handler("mark_seam", handle_mark_seam)
    dispatcher.register_handler("mark_sharp", handle_mark_sharp)
    dispatcher.register_handler("recalculate_normals", handle_recalculate_normals)
    dispatcher.register_handler("flip_normals", handle_flip_normals)
    dispatcher.register_handler("quads_to_tris", handle_quads_to_tris)
    dispatcher.register_handler("tris_to_quads", handle_tris_to_quads)
    dispatcher.register_handler("dissolve_faces", handle_dissolve_faces)
    dispatcher.register_handler("dissolve_edges", handle_dissolve_edges)
    dispatcher.register_handler("dissolve_verts", handle_dissolve_verts)
    dispatcher.register_handler("knife_project", handle_knife_project)
    dispatcher.register_handler("spin_mesh", handle_spin_mesh)
    dispatcher.register_handler("set_edge_crease", handle_set_edge_crease)
    dispatcher.register_handler("select_linked", handle_select_linked)
    dispatcher.register_handler("select_vertices_by_index", handle_select_vertices_by_index)
    dispatcher.register_handler("select_edges_by_index", handle_select_edges_by_index)
    dispatcher.register_handler("select_faces_by_index", handle_select_faces_by_index)
    dispatcher.register_handler("save_selection_set", handle_save_selection_set)
    dispatcher.register_handler("select_selection_set", handle_select_selection_set)
    dispatcher.register_handler("list_selection_sets", handle_list_selection_sets)
    dispatcher.register_handler("grow_selection", handle_grow_selection)
    dispatcher.register_handler("shrink_selection", handle_shrink_selection)
    dispatcher.register_handler("select_similar", handle_select_similar)
