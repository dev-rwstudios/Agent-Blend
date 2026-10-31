"""Blender-side half of the general step engine.

    run_step     run model-written code with the `ab` toolkit, sandboxed, with a
                 time limit; report what it created and whether it touched
                 objects it did not create
    scene_state  ground truth for the model: what exists (compact, grouped), where,
                 how big, plus generic problem checks (nothing scene-specific)
    remove_step  delete everything a step created (before retrying that step)

Nothing here knows what kind of scene is being built.
"""

from __future__ import annotations

import io
import math
import re
import sys
import time
import traceback

import bpy

from .. import dispatcher
from ..toolkit import TAG_ROLE, TAG_STEP, Toolkit

DEFAULT_TIMEOUT = 30.0
_MESHLIKE = {"MESH", "CURVE", "SURFACE", "FONT"}


# ---------------------------------------------------------------- helpers

def _collection(name: str):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    if coll.name not in {c.name for c in bpy.context.scene.collection.children_recursive} and coll is not bpy.context.scene.collection:
        try:
            bpy.context.scene.collection.children.link(coll)
        except RuntimeError:
            pass
    return coll


def _r(v, n=3):
    return round(float(v), n)


def _foreign_snapshot() -> dict:
    """Everything the user (not the agent) owns, in enough detail to notice changes."""
    snap = {}
    for o in bpy.data.objects:
        if TAG_ROLE in o:
            continue
        verts = len(o.data.vertices) if o.type == "MESH" and o.data is not None else 0
        snap[o.name] = (
            o.type,
            tuple(_r(v, 4) for v in o.location),
            tuple(_r(v, 4) for v in o.rotation_euler),
            tuple(_r(v, 4) for v in o.scale),
            o.hide_viewport, o.hide_render, verts,
            o.parent.name if o.parent else None,
        )
    return snap


def _changed(before: dict, after: dict) -> list[str]:
    return sorted(n for n, state in before.items() if after.get(n) != state)


def _deadline_tracer(deadline: float):
    def tracer(frame, event, arg):
        if time.monotonic() > deadline:
            raise TimeoutError("the step ran longer than its time limit — look for an endless loop or far too much geometry")
        return tracer
    return tracer


def _format_error(exc: BaseException, code: str) -> tuple[str, int | None]:
    """'NameError: name 'x' is not defined (line 7: `ab.box(x, ...)`)' and the line number."""
    line = None
    if isinstance(exc, SyntaxError):
        line = exc.lineno
    else:
        for frame, lineno in traceback.walk_tb(exc.__traceback__):
            if frame.f_code.co_filename == "<step>":
                line = lineno
    text = f"{type(exc).__name__}: {exc}"
    if line:
        lines = code.splitlines()
        if 1 <= line <= len(lines):
            text += f"  (line {line}: `{lines[line - 1].strip()[:120]}`)"
    return text, line


# ---------------------------------------------------------------- run_step

def handle_run_step(params: dict) -> dict:
    """Run model-written code against the `ab` toolkit.

    params: code, collection, step_id, seed?, timeout?, assets? ({id: {path, name}} the code may import)
    returns: ok, output, error?, error_line?, created [names], touched_foreign [names]
    """
    from . import code_exec  # lazy: shares the sandbox's restricted builtins

    code = params.get("code") or ""
    if not code.strip():
        raise ValueError("No code provided")
    step_id = str(params.get("step_id") or "step")
    coll = _collection(params.get("collection") or "Agent Build")
    timeout = float(params.get("timeout") or DEFAULT_TIMEOUT)

    foreign_before = _foreign_snapshot()
    names_before = set(bpy.data.objects.keys())
    tk = Toolkit(coll, step_id=step_id, seed=int(params.get("seed") or 1), assets=params.get("assets") or {})

    import bmesh
    import mathutils

    sandbox = {
        "__builtins__": code_exec.SAFE_BUILTINS,
        "ab": tk, "bpy": bpy, "bmesh": bmesh, "mathutils": mathutils, "math": math,
        "Vector": mathutils.Vector,
    }
    import random
    sandbox["random"] = random

    old_stdout = sys.stdout
    sys.stdout = buffer = io.StringIO()
    error = None
    error_line = None
    old_trace = sys.gettrace()
    try:
        compiled = compile(code, "<step>", "exec")
        sys.settrace(_deadline_tracer(time.monotonic() + timeout))
        try:
            exec(compiled, sandbox)  # noqa: S102 — sandboxed namespace, restricted builtins
        finally:
            sys.settrace(old_trace)
    except BaseException as exc:  # noqa: BLE001 — everything the code does wrong goes back to the model
        if isinstance(exc, (KeyboardInterrupt, SystemExit)) and not isinstance(exc, SystemExit):
            raise
        error, error_line = _format_error(exc, code)
    finally:
        sys.stdout = old_stdout

    # Objects made with raw bpy calls instead of `ab`: adopt them so they're tracked and removable.
    for name in set(bpy.data.objects.keys()) - names_before:
        obj = bpy.data.objects.get(name)
        if obj is not None and TAG_ROLE not in obj:
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            coll.objects.link(obj)
            obj[TAG_ROLE] = "built"
            obj[TAG_STEP] = step_id
            tk.created.append(obj.name)

    bpy.context.view_layer.update()
    output = "\n".join([*tk.messages, buffer.getvalue().strip()]).strip()
    created = sorted({n for n in tk.created if n in bpy.data.objects})
    return {
        "ok": error is None,
        "output": output[:4000],
        "error": error,
        "error_line": error_line,
        "created": created[:500],
        "created_count": len(created),
        "touched_foreign": _changed(foreign_before, _foreign_snapshot()),
    }


# ---------------------------------------------------------------- scene_state

def _stem(name: str) -> str:
    return re.sub(r"([._ -]?\d+)+$", "", name) or name


def _unit_bbox(obj):
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for o in [obj, *obj.children_recursive]:
        if o.type not in _MESHLIKE:
            continue
        for corner in o.bound_box:
            p = o.matrix_world @ __import__("mathutils").Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
    if lo[0] == math.inf:
        t = obj.matrix_world.translation
        return [t[0], t[1], t[2]], [t[0], t[1], t[2]]
    return lo, hi


def _volume(lo, hi) -> float:
    return max(0.0, hi[0] - lo[0]) * max(0.0, hi[1] - lo[1]) * max(0.0, hi[2] - lo[2])


def _overlap(a_lo, a_hi, b_lo, b_hi):
    lo = [max(a_lo[i], b_lo[i]) for i in range(3)]
    hi = [min(a_hi[i], b_hi[i]) for i in range(3)]
    return lo, hi


def _issues(units: list[dict]) -> list[dict]:
    """Generic checks only — true of any scene. Advisory: the critic decides what matters."""
    out: list[dict] = []
    solid = [u for u in units if u["type"] in _MESHLIKE]
    for u in solid:
        lo, hi = u["bbox_min"], u["bbox_max"]
        dims = [hi[i] - lo[i] for i in range(3)]
        if any(math.isnan(v) for v in lo + hi):
            out.append({"code": "invalid", "object": u["name"], "message": f"{u['name']} has invalid (NaN) geometry"})
            continue
        if u.get("verts") == 0:
            out.append({"code": "empty", "object": u["name"], "message": f"{u['name']} has no geometry"})
        elif max(dims) < 1e-3:
            out.append({"code": "degenerate", "object": u["name"], "message": f"{u['name']} is smaller than 1 mm in every direction"})
        if hi[2] < -0.05:
            out.append({"code": "below_ground", "object": u["name"], "message": f"{u['name']} is entirely below the ground (top at z={hi[2]:.2f})"})

    # Floating: nothing underneath, judged by whether any other object's box spans the point just below it.
    for u in solid:
        lo, hi = u["bbox_min"], u["bbox_max"]
        if lo[2] <= 0.05:
            continue
        cx, cy, probe = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] - 0.03
        supported = any(
            o is not u and o["bbox_min"][0] - 0.02 <= cx <= o["bbox_max"][0] + 0.02 and o["bbox_min"][1] - 0.02 <= cy <= o["bbox_max"][1] + 0.02
            and o["bbox_min"][2] - 0.02 <= probe <= o["bbox_max"][2] + 0.02
            for o in solid
        )
        if not supported:
            out.append({"code": "floating", "object": u["name"], "message": f"{u['name']} has nothing underneath it (bottom at z={lo[2]:.2f})"})

    # Interpenetration, only when a lot of the smaller object is inside the other. Capped for big scenes.
    # Surface-like objects (ground, terrain, floors: much wider than tall) are skipped — their bounding
    # box contains everything standing on them, so a box test says nothing about them.
    def _surface_like(u):
        dims = [u["bbox_max"][k] - u["bbox_min"][k] for k in range(3)]
        return dims[2] < 0.25 * max(dims[0], dims[1], 1e-9)

    if len(solid) <= 400:
        for i in range(len(solid)):
            a = solid[i]
            va = _volume(a["bbox_min"], a["bbox_max"])
            for j in range(i + 1, len(solid)):
                b = solid[j]
                if _surface_like(a) or _surface_like(b):
                    continue
                lo, hi = _overlap(a["bbox_min"], a["bbox_max"], b["bbox_min"], b["bbox_max"])
                if any(hi[k] <= lo[k] for k in range(3)):
                    continue
                vb = _volume(b["bbox_min"], b["bbox_max"])
                smaller = min(va, vb)
                if smaller > 1e-6 and _volume(lo, hi) / smaller > 0.35:
                    out.append({"code": "overlap", "object": a["name"], "other": b["name"], "message": f"{a['name']} and {b['name']} overlap heavily ({_volume(lo, hi) / smaller:.0%} of the smaller)"})
    return out[:40]


def handle_scene_state(params: dict) -> dict:
    """What exists now. params: collection? (agent's), limit? (rows)."""
    bpy.context.view_layer.update()
    coll_name = params.get("collection") or ""
    limit = int(params.get("limit") or 80)
    coll = bpy.data.collections.get(coll_name) if coll_name else None

    built_roots = []
    foreign = []
    for o in bpy.context.scene.objects:
        tagged = TAG_ROLE in o
        if tagged and (coll is None or coll in o.users_collection):
            if o.parent is None or TAG_ROLE not in o.parent:
                built_roots.append(o)
        elif not tagged and o.parent is None:
            foreign.append(o)

    units = []
    for o in built_roots:
        lo, hi = _unit_bbox(o)
        units.append({
            "name": o.name, "type": o.type, "step": o.get(TAG_STEP, ""),
            "bbox_min": [_r(v) for v in lo], "bbox_max": [_r(v) for v in hi],
            "parts": len(o.children_recursive),
            "verts": len(o.data.vertices) if o.type == "MESH" and o.data is not None else None,
            "material": (o.data.materials[0].name if o.type == "MESH" and o.data is not None and o.data.materials and o.data.materials[0] else None),
        })

    # Collapse big families (200 copies of one thing) into one row so the model sees structure, not noise.
    families: dict[str, list[dict]] = {}
    for u in units:
        families.setdefault(_stem(u["name"]), []).append(u)
    rows = []
    for stem, members in families.items():
        if len(members) > 12:
            lo = [min(m["bbox_min"][i] for m in members) for i in range(3)]
            hi = [max(m["bbox_max"][i] for m in members) for i in range(3)]
            first = members[0]
            rows.append({
                "name": stem, "type": first["type"], "count": len(members), "step": first["step"],
                "bbox_min": lo, "bbox_max": hi,
                "each_size": [_r(first["bbox_max"][i] - first["bbox_min"][i], 2) for i in range(3)],
            })
        else:
            rows.extend(members)

    foreign_box = None
    if foreign:
        boxes = [_unit_bbox(o) for o in foreign if o.type in _MESHLIKE]
        if boxes:
            foreign_box = {
                "bbox_min": [_r(min(b[0][i] for b in boxes)) for i in range(3)],
                "bbox_max": [_r(max(b[1][i] for b in boxes)) for i in range(3)],
            }

    bounds = None
    if units:
        bounds = {
            "min": [_r(min(u["bbox_min"][i] for u in units)) for i in range(3)],
            "max": [_r(max(u["bbox_max"][i] for u in units)) for i in range(3)],
        }
    return {
        "collection": coll_name,
        "unit_count": len(units),
        "objects": rows[:limit],
        "truncated": len(rows) > limit,
        "bounds": bounds,
        "foreign": {"count": len(foreign), **(foreign_box or {})},
        "issues": _issues(units),
    }


# ---------------------------------------------------------------- remove_step

def handle_remove_step(params: dict) -> dict:
    """Delete everything a step created (so a retry starts clean)."""
    step_id = str(params.get("step_id") or "")
    if not step_id:
        raise ValueError("step_id is required")
    doomed = [o for o in bpy.data.objects if o.get(TAG_ROLE) == "built" and o.get(TAG_STEP) == step_id]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    for mesh in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(mesh)
    return {"removed": len(doomed)}


def register():
    dispatcher.register_handler("run_step", handle_run_step)
    dispatcher.register_handler("scene_state", handle_scene_state)
    dispatcher.register_handler("remove_step", handle_remove_step)
