"""`ab` — a small, scene-agnostic modelling toolkit for model-written code.

Nothing here knows what a house, a tree or an engine is. It gives generated code
a few reliable building blocks so a small model writes ten correct lines instead
of eighty fragile ones:

    primitives   box, cylinder (cones/frustums), sphere, torus, plane
    shapes       prism (extrude an outline), tube (sweep along a path),
                 height_field (surface from a function), cut (boolean hole)
    library      asset (a ready-made model from the user's asset library)
    repetition   array, grid, scatter, along
    organising   group, place_on, place, bbox, size, center
    look         material, paint, light, camera, world, smooth
    helpers      noise, rng, surface_z, log

Conventions (the model is told these too):
    meters, +Z up, ground at z = 0, rotations in DEGREES.
    `at=(x, y, z)` is the BASE CENTER of an object (anchor="base", the default)
    or its center (anchor="center").
    Every function returns the Blender object, already inside the run's
    collection and tagged, so everything a step makes can be found and removed.

Guard rails raise ValueError with a plain message (the model sees it and fixes
its code) instead of letting a typo create a million vertices.
"""

from __future__ import annotations

import math
import random
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

MAX_COPIES = 5000
MAX_GRID_CELLS = 160_000
MAX_SEGMENTS = 96

_COLOR_NAMES = {
    "white": (0.95, 0.95, 0.95), "black": (0.02, 0.02, 0.02), "grey": (0.5, 0.5, 0.5), "gray": (0.5, 0.5, 0.5),
    "red": (0.8, 0.08, 0.06), "orange": (0.9, 0.4, 0.05), "yellow": (0.9, 0.8, 0.1), "green": (0.1, 0.55, 0.12),
    "blue": (0.08, 0.2, 0.8), "purple": (0.45, 0.12, 0.6), "pink": (0.9, 0.4, 0.6), "brown": (0.35, 0.2, 0.1),
    "beige": (0.8, 0.72, 0.55), "sand": (0.76, 0.65, 0.42), "wood": (0.45, 0.28, 0.14), "stone": (0.45, 0.44, 0.42),
    "metal": (0.6, 0.62, 0.65), "water": (0.05, 0.3, 0.5), "grass": (0.18, 0.45, 0.1), "snow": (0.95, 0.97, 1.0),
}

TAG_ROLE = "ab_role"
TAG_STEP = "ab_step"


def _vec3(value, name: str) -> Vector:
    try:
        x, y, z = value
        return Vector((float(x), float(y), float(z)))
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be three numbers (x, y, z), got {value!r}") from None


def _positive(value, name: str) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number, got {value!r}") from None
    if not v > 0 or math.isinf(v):
        raise ValueError(f"{name} must be greater than 0, got {value!r}")
    return v


def _euler(rot) -> Euler:
    """Degrees: a single number turns about Z; three numbers are (x, y, z)."""
    if rot is None:
        return Euler((0.0, 0.0, 0.0))
    if isinstance(rot, (int, float)):
        return Euler((0.0, 0.0, math.radians(rot)))
    x, y, z = rot
    return Euler((math.radians(x), math.radians(y), math.radians(z)))


def _rgba(color) -> tuple[float, float, float, float]:
    if isinstance(color, str):
        text = color.strip().lower()
        if text in _COLOR_NAMES:
            r, g, b = _COLOR_NAMES[text]
            return (r, g, b, 1.0)
        if text.startswith("#") and len(text) in (4, 7):
            if len(text) == 4:
                text = "#" + "".join(c * 2 for c in text[1:])
            r, g, b = (int(text[i:i + 2], 16) / 255 for i in (1, 3, 5))
            # Hex colors are display colors; convert to linear for Blender.
            lin = [(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in (r, g, b)]
            return (lin[0], lin[1], lin[2], 1.0)
        raise ValueError(f"Unknown color {color!r}: use a name ({', '.join(sorted(_COLOR_NAMES))}), '#rrggbb', or (r, g, b) 0–1")
    vals = [float(c) for c in color]
    if len(vals) == 3:
        vals.append(1.0)
    if len(vals) != 4:
        raise ValueError(f"color must have 3 or 4 numbers, got {color!r}")
    return tuple(vals)  # type: ignore[return-value]


class Toolkit:
    """One instance per executed step; bound to the name `ab` in the sandbox."""

    def __init__(self, collection, step_id: str = "", seed: int = 1, assets: dict | None = None):
        self.collection = collection
        self.assets = assets or {}  # id -> {"path": ..., "name": ..., "category": ...}
        self.step_id = step_id
        self.seed = seed
        self.messages: list[str] = []
        self.created: list[str] = []
        self._materials: dict[str, object] = {}

    # ------------------------------------------------------------ internals

    def _register(self, obj, parent=None):
        if obj.name not in self.collection.objects:
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            self.collection.objects.link(obj)
        obj[TAG_ROLE] = "built"
        obj[TAG_STEP] = self.step_id
        if parent is not None:
            world = obj.matrix_world.copy()
            obj.parent = parent
            obj.matrix_world = world
        self.created.append(obj.name)
        if len(self.created) > MAX_COPIES * 2:
            raise ValueError("Too many objects created in one step — build fewer, or use array/scatter with a smaller count")
        return obj

    def _object_from_bmesh(self, name, bm, at, rot, color, anchor, parent, bevel=0.0):
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        self.collection.objects.link(obj)
        obj.location = _vec3(at, "at")
        obj.rotation_euler = _euler(rot)
        if color is not None:
            self.paint(obj, color)
        if bevel:
            mod = obj.modifiers.new("Bevel", "BEVEL")
            mod.width = float(bevel)
            mod.segments = 2
        return self._register(obj, parent)

    @staticmethod
    def _lift(bm, height, anchor):
        """Shift a mesh built about its center so its base sits on z = 0 (anchor="base")."""
        if anchor == "base":
            bmesh.ops.translate(bm, vec=(0, 0, height / 2), verts=bm.verts)
        elif anchor != "center":
            raise ValueError('anchor must be "base" or "center"')

    # ------------------------------------------------------------ primitives

    def box(self, name, size, at=(0, 0, 0), rot=0, color=None, anchor="base", parent=None, bevel=0.0):
        """Rectangular box. size=(width_x, depth_y, height_z)."""
        sx, sy, sz = (_positive(v, "size") for v in size)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= sx
            v.co.y *= sy
            v.co.z *= sz
        self._lift(bm, sz, anchor)
        return self._object_from_bmesh(name, bm, at, rot, color, anchor, parent, bevel)

    def cylinder(self, name, radius, height, at=(0, 0, 0), rot=0, color=None, segments=32, radius_top=None, anchor="base", parent=None):
        """Cylinder. radius_top makes a cone (0) or frustum (smaller/larger top)."""
        r1 = _positive(radius, "radius")
        h = _positive(height, "height")
        r2 = r1 if radius_top is None else max(0.0, float(radius_top))
        seg = int(min(max(segments, 3), MAX_SEGMENTS))
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
        self._lift(bm, h, anchor)
        return self._object_from_bmesh(name, bm, at, rot, color, anchor, parent)

    def cone(self, name, radius, height, at=(0, 0, 0), rot=0, color=None, segments=32, anchor="base", parent=None):
        """Cone with its point up."""
        return self.cylinder(name, radius, height, at, rot, color, segments, radius_top=0.0, anchor=anchor, parent=parent)

    def sphere(self, name, radius, at=(0, 0, 0), rot=0, color=None, segments=24, squash=(1, 1, 1), anchor="base", parent=None):
        """Sphere; squash=(sx, sy, sz) turns it into an ellipsoid."""
        r = _positive(radius, "radius")
        seg = int(min(max(segments, 4), MAX_SEGMENTS))
        bm = bmesh.new()
        try:
            bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(seg // 2, 3), radius=r)
        except TypeError:  # older Blender spelled it diameter
            bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(seg // 2, 3), diameter=r)
        sx, sy, sz = (float(v) for v in squash)
        for v in bm.verts:
            v.co.x *= sx
            v.co.y *= sy
            v.co.z *= sz
        self._lift(bm, 2 * r * sz, anchor)
        return self._object_from_bmesh(name, bm, at, rot, color, anchor, parent)

    def torus(self, name, major, minor, at=(0, 0, 0), rot=0, color=None, segments=32, anchor="base", parent=None):
        """Ring (donut) lying flat: major = ring radius, minor = tube radius."""
        R = _positive(major, "major")
        r = _positive(minor, "minor")
        seg = int(min(max(segments, 6), MAX_SEGMENTS))
        ring = 12
        bm = bmesh.new()
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            row = []
            for j in range(ring):
                b = 2 * math.pi * j / ring
                row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
            verts.append(row)
        for i in range(seg):
            for j in range(ring):
                bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % ring], verts[i][(j + 1) % ring]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._lift(bm, 2 * r, anchor)
        return self._object_from_bmesh(name, bm, at, rot, color, anchor, parent)

    def plane(self, name, size, at=(0, 0, 0), rot=0, color=None, parent=None):
        """Flat rectangle lying on z = at[2] (ground, water, a floor, a sheet)."""
        sx, sy = (_positive(v, "size") for v in size)
        bm = bmesh.new()
        pts = [bm.verts.new(p) for p in ((-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0))]
        bm.faces.new(pts)
        return self._object_from_bmesh(name, bm, at, rot, color, "base", parent)

    # ------------------------------------------------------------ shapes

    def prism(self, name, outline, height, at=(0, 0, 0), rot=0, color=None, anchor="base", parent=None):
        """Extrude a 2D outline [(x, y), ...] (counter-clockwise, around the origin) upward."""
        h = _positive(height, "height")
        pts = [(float(x), float(y)) for x, y in outline]
        if len(pts) < 3:
            raise ValueError("outline needs at least 3 points")
        bm = bmesh.new()
        face = bm.faces.new([bm.verts.new((x, y, 0.0)) for x, y in pts])
        extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
        moved = [e for e in extruded["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=(0, 0, h), verts=moved)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if anchor == "center":
            bmesh.ops.translate(bm, vec=(0, 0, -h / 2), verts=bm.verts)
        return self._object_from_bmesh(name, bm, at, rot, color, anchor, parent)

    def tube(self, name, path, radius, color=None, segments=12, closed=False, parent=None):
        """Round pipe swept along a path of (x, y, z) points (pipes, rails, cables, roads' edges…).

        Coordinates are world positions; the object's origin is (0, 0, 0)."""
        r = _positive(radius, "radius")
        pts = [_vec3(p, "path point") for p in path]
        if len(pts) < 2:
            raise ValueError("path needs at least 2 points")
        if len(pts) > 2000:
            raise ValueError("path has too many points (max 2000)")
        seg = int(min(max(segments, 3), MAX_SEGMENTS))
        bm = bmesh.new()
        rings = []
        up = Vector((0, 0, 1))
        for i, p in enumerate(pts):
            prev = pts[i - 1] if (i > 0 or closed) else p
            nxt = pts[(i + 1) % len(pts)] if (i < len(pts) - 1 or closed) else p
            tangent = (nxt - prev)
            if tangent.length < 1e-9:
                tangent = pts[-1] - pts[0]
            tangent.normalize()
            ref = up if abs(tangent.dot(up)) < 0.95 else Vector((1, 0, 0))
            side = tangent.cross(ref).normalized()
            lift = side.cross(tangent).normalized()
            rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / seg) + lift * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
        last = len(rings) if closed else len(rings) - 1
        for i in range(last):
            a, b = rings[i], rings[(i + 1) % len(rings)]
            for k in range(seg):
                bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
        if not closed:
            bm.faces.new(rings[0][::-1])
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._object_from_bmesh(name, bm, (0, 0, 0), 0, color, "base", parent)

    def height_field(self, name, size, height, at=(0, 0, 0), resolution=(64, 64), color=None, parent=None):
        """Surface whose height comes from a function: height(x, y) -> z, with x, y measured from the
        center of the field. Terrain, waves, dunes, a hill, a bumpy road, a curved roof…"""
        sx, sy = (_positive(v, "size") for v in size)
        nx, ny = (int(v) for v in resolution)
        if nx < 1 or ny < 1 or (nx + 1) * (ny + 1) > MAX_GRID_CELLS:
            raise ValueError(f"resolution too large or invalid (max about {int(MAX_GRID_CELLS ** 0.5)} x {int(MAX_GRID_CELLS ** 0.5)})")
        fn = height if callable(height) else (lambda x, y, _h=float(height): _h)
        bm = bmesh.new()
        grid = []
        for i in range(nx + 1):
            row = []
            for j in range(ny + 1):
                x = -sx / 2 + sx * i / nx
                y = -sy / 2 + sy * j / ny
                row.append(bm.verts.new((x, y, float(fn(x, y)))))
            grid.append(row)
        for i in range(nx):
            for j in range(ny):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        obj = self._object_from_bmesh(name, bm, at, 0, color, "base", parent)
        self.smooth(obj)
        return obj

    def cut(self, obj, cutter, keep_cutter=False):
        """Boolean: subtract `cutter` from `obj` (doors, windows, holes, hollows). Returns obj."""
        mod = obj.modifiers.new("Cut", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutter
        mod.solver = "EXACT"
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if not keep_cutter:
            bpy.data.objects.remove(cutter, do_unlink=True)
        return obj

    def asset(self, asset_id, name=None, at=(0, 0, 0), rot=0, scale=1.0, parent=None):
        """Import a ready-made model from the asset library as ONE object, base center at `at`.

        The model is re-centered first (library files keep the coordinates of the scene they came
        from), so `at` is where it really lands. Returns the group; use ab.size(obj) to read its
        real size. Ids are listed in the prompt; an unknown id says which are close."""
        info = self.assets.get(asset_id)
        if info is None:
            words = [w for w in str(asset_id).lower().replace("/", " ").replace("_", " ").split() if len(w) > 2]
            near = [k for k in self.assets if any(w in k.lower() for w in words)][:6]
            raise ValueError(f"Unknown asset {asset_id!r}." + (f" Close ids: {', '.join(near)}" if near else " No asset library ids are available."))
        from .handlers import file_ops  # lazy: only steps that use the library need it

        path = info["path"]
        before = set(bpy.data.objects.keys())
        op = file_ops.IMPORT_OPERATORS.get(file_ops._get_extension(path, ""))
        if op is None or op(path) != {"FINISHED"}:
            raise ValueError(f"Could not import {asset_id!r}")
        new = [bpy.data.objects[n] for n in sorted(set(bpy.data.objects.keys()) - before)]
        if not new:
            raise ValueError(f"{asset_id!r} contained no objects")
        file_ops._recenter_at_origin(new)
        new_set = set(new)
        roots = [o for o in new if o.parent is None or o.parent not in new_set]
        anchor = bpy.data.objects.new(name or info.get("name") or asset_id.split("/")[-1], None)
        anchor.empty_display_type = "PLAIN_AXES"
        anchor.empty_display_size = 0.25
        self.collection.objects.link(anchor)
        self._register(anchor)
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            self.collection.objects.link(o)
        for root in roots:
            world = root.matrix_world.copy()
            root.parent = anchor
            root.matrix_world = world
        for o in new:
            o[TAG_ROLE] = "built"
            o[TAG_STEP] = self.step_id
            self.created.append(o.name)
        anchor.rotation_euler = _euler(rot)
        anchor.scale = (float(scale),) * 3
        anchor.location = _vec3(at, "at")
        anchor["ab_asset_id"] = asset_id
        if parent is not None:
            world = anchor.matrix_world.copy()
            anchor.parent = parent
            anchor.matrix_world = world
        bpy.context.view_layer.update()
        return anchor

    # ------------------------------------------------------------ repetition

    def _copy(self, source, location, rot_z=None, scale=None):
        new = source.copy()
        if source.data is not None and hasattr(source.data, "name"):
            new.data = source.data  # share the mesh: thousands of copies stay cheap
        new.location = location
        if rot_z is not None:
            new.rotation_euler = Euler((source.rotation_euler.x, source.rotation_euler.y, source.rotation_euler.z + math.radians(rot_z)))
        if scale is not None:
            new.scale = source.scale * scale
        return self._register(new)

    def array(self, obj, count, offset, rot_step=0.0):
        """`count` copies in a line (the original is the first): each moved by `offset`, turned by rot_step degrees."""
        n = int(count)
        if n < 1 or n > MAX_COPIES:
            raise ValueError(f"count must be 1..{MAX_COPIES}")
        off = _vec3(offset, "offset")
        out = [obj]
        for i in range(1, n):
            out.append(self._copy(obj, obj.location + off * i, rot_z=rot_step * i if rot_step else None))
        return out

    def grid(self, obj, nx, ny, spacing, rot_z=0.0):
        """nx x ny copies on a flat grid; spacing=(dx, dy)."""
        nx, ny = int(nx), int(ny)
        if nx < 1 or ny < 1 or nx * ny > MAX_COPIES:
            raise ValueError(f"nx * ny must be 1..{MAX_COPIES}")
        dx, dy = (float(v) for v in spacing)
        out = [obj]
        for i in range(nx):
            for j in range(ny):
                if i == 0 and j == 0:
                    continue
                out.append(self._copy(obj, obj.location + Vector((dx * i, dy * j, 0)), rot_z=rot_z or None))
        return out

    def scatter(self, source, count, area, seed=None, min_dist=0.0, scale=(1.0, 1.0), rotate=True, on=None, avoid=(), z=0.0):
        """Place up to `count` copies of `source` at random spots in area=(x0, y0, x1, y1), at least
        `min_dist` apart, skipping anywhere inside the footprint of objects in `avoid`. `on` = an object
        (e.g. terrain) whose surface they sit on; otherwise they sit at height `z`. Returns the copies."""
        n = int(count)
        if n < 1 or n > MAX_COPIES:
            raise ValueError(f"count must be 1..{MAX_COPIES}")
        x0, y0, x1, y1 = (float(v) for v in area)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("area must be (x0, y0, x1, y1) with x1 > x0 and y1 > y0")
        rng = random.Random(self.seed if seed is None else seed)
        s0, s1 = (float(v) for v in scale)
        blocked = [self.bbox(o) for o in avoid]
        placed: list[tuple[float, float]] = []
        cell = max(min_dist, 1e-6)
        buckets: dict[tuple[int, int], list[tuple[float, float]]] = {}
        out = []
        attempts = 0
        while len(out) < n and attempts < n * 30:
            attempts += 1
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if any(lo.x - 0.0 <= x <= hi.x and lo.y <= y <= hi.y for lo, hi in blocked):
                continue
            if min_dist > 0:
                cx, cy = int(x // cell), int(y // cell)
                if any((px - x) ** 2 + (py - y) ** 2 < min_dist ** 2 for i in (-1, 0, 1) for j in (-1, 0, 1) for px, py in buckets.get((cx + i, cy + j), ())):
                    continue
                buckets.setdefault((cx, cy), []).append((x, y))
            placed.append((x, y))
            zz = self.surface_z(on, x, y, default=z) if on is not None else z
            k = rng.uniform(s0, s1)
            out.append(self._copy(source, Vector((x, y, zz)), rot_z=rng.uniform(0, 360) if rotate else None, scale=k if (s0 != 1.0 or s1 != 1.0) else None))
        if len(out) < n:
            self.log(f"scatter placed {len(out)} of {n} (area too small for min_dist, or blocked by `avoid`)")
        return out

    def along(self, obj, path, spacing, align=True):
        """Copies of `obj` at equal spacing along a polyline path [(x, y, z), ...] (posts, lamps, tiles…)."""
        pts = [_vec3(p, "path point") for p in path]
        step = _positive(spacing, "spacing")
        if len(pts) < 2:
            raise ValueError("path needs at least 2 points")
        out = []
        carry = 0.0
        for a, b in zip(pts, pts[1:]):
            seg = b - a
            length = seg.length
            if length < 1e-9:
                continue
            d = carry
            while d <= length + 1e-9:
                p = a + seg * (d / length)
                angle = math.degrees(math.atan2(seg.y, seg.x)) if align else None
                out.append(self._copy(obj, p, rot_z=angle))
                if len(out) > MAX_COPIES:
                    raise ValueError(f"too many copies along the path (max {MAX_COPIES}) — increase spacing")
                d += step
            carry = d - length
        return out

    # ------------------------------------------------------------ organising

    def group(self, name, objects: Iterable, at=None):
        """Parent several objects under one empty so they move/rotate together. Returns the empty."""
        objs = list(objects)
        if not objs:
            raise ValueError("group needs at least one object")
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "PLAIN_AXES"
        empty.empty_display_size = 0.3
        self.collection.objects.link(empty)
        if at is None:
            lo, hi = self.bbox(objs)
            empty.location = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        else:
            empty.location = _vec3(at, "at")
        bpy.context.view_layer.update()
        self._register(empty)
        for o in objs:
            world = o.matrix_world.copy()
            o.parent = empty
            o.matrix_world = world
        return empty

    def bbox(self, objs):
        """World-space (min, max) corners over an object or list of objects (children included)."""
        items = [objs] if hasattr(objs, "bound_box") else list(objs)
        lo = Vector((math.inf,) * 3)
        hi = Vector((-math.inf,) * 3)
        bpy.context.view_layer.update()
        for root in items:
            for o in [root, *root.children_recursive]:
                if o.type not in {"MESH", "CURVE", "SURFACE", "FONT"}:
                    continue
                for corner in o.bound_box:
                    p = o.matrix_world @ Vector(corner)
                    lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
                    hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        if lo.x == math.inf:
            p = items[0].matrix_world.translation if items else Vector((0, 0, 0))
            return p.copy(), p.copy()
        return lo, hi

    def size(self, objs):
        lo, hi = self.bbox(objs)
        return hi - lo

    def center(self, objs):
        lo, hi = self.bbox(objs)
        return (lo + hi) / 2

    def place(self, obj, at, anchor="base"):
        """Move an object so its base center (or center) is at `at`."""
        target = _vec3(at, "at")
        lo, hi = self.bbox(obj)
        cur = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z if anchor == "base" else (lo.z + hi.z) / 2))
        obj.location += target - cur
        return obj

    def place_on(self, obj, target, xy=None):
        """Rest `obj` on top of `target` (its bottom touches target's top). xy=(x, y) to also move it sideways."""
        _, thi = self.bbox(target)
        lo, hi = self.bbox(obj)
        obj.location.z += thi.z - lo.z
        if xy is not None:
            obj.location.x += float(xy[0]) - (lo.x + hi.x) / 2
            obj.location.y += float(xy[1]) - (lo.y + hi.y) / 2
        return obj

    def surface_z(self, obj, x, y, default=0.0):
        """Height of `obj`'s surface at (x, y), straight down from above; `default` if it misses."""
        inv = obj.matrix_world.inverted()
        origin = inv @ Vector((float(x), float(y), 10000.0))
        direction = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
        hit, loc, _normal, _idx = obj.ray_cast(origin, direction)
        return (obj.matrix_world @ loc).z if hit else default

    # ------------------------------------------------------------ look

    def material(self, name, color="grey", roughness=0.6, metallic=0.0, emission=None, alpha=1.0):
        """A reusable material. emission=(r, g, b) or a color name makes it glow."""
        mat = self._materials.get(name) or bpy.data.materials.get(name)
        if mat is None:
            mat = bpy.data.materials.new(name)
            try:
                mat.use_nodes = True
            except Exception:  # newer Blender: nodes are always on
                pass
        r, g, b, a = _rgba(color)
        mat.diffuse_color = (r, g, b, alpha)
        bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.node_tree else None
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
            bsdf.inputs["Roughness"].default_value = float(roughness)
            bsdf.inputs["Metallic"].default_value = float(metallic)
            if alpha < 1.0 and "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = float(alpha)
            if emission is not None:
                er, eg, eb, _ = _rgba(emission)
                for key in ("Emission Color", "Emission"):
                    if key in bsdf.inputs:
                        bsdf.inputs[key].default_value = (er, eg, eb, 1.0)
                        break
                if "Emission Strength" in bsdf.inputs:
                    bsdf.inputs["Emission Strength"].default_value = 5.0
        self._materials[name] = mat
        return mat

    def paint(self, obj, color_or_material, roughness=0.6, metallic=0.0):
        """Give an object a color (name, '#rrggbb', (r, g, b)) or an `ab.material(...)`."""
        mat = color_or_material
        if not hasattr(mat, "node_tree"):
            key = f"AB {_rgba(color_or_material)[:3]} {roughness} {metallic}"
            mat = self._materials.get(key) or self.material(key, color_or_material, roughness, metallic)
        if obj.type == "MESH" and obj.data is not None:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
        return obj

    def smooth(self, obj):
        """Smooth shading for curved surfaces."""
        if obj.type == "MESH":
            for poly in obj.data.polygons:
                poly.use_smooth = True
        return obj

    def light(self, name, kind="POINT", at=(0, 0, 5), energy=1000.0, color="white", rot=(0, 0, 0), size=1.0):
        """kind: POINT, SUN (energy ~3), SPOT, AREA."""
        kind = str(kind).upper()
        if kind not in {"POINT", "SUN", "SPOT", "AREA"}:
            raise ValueError("kind must be POINT, SUN, SPOT or AREA")
        data = bpy.data.lights.new(name, kind)
        data.energy = float(energy)
        r, g, b, _ = _rgba(color)
        data.color = (r, g, b)
        if kind == "AREA":
            data.size = float(size)
        obj = bpy.data.objects.new(name, data)
        self.collection.objects.link(obj)
        obj.location = _vec3(at, "at")
        obj.rotation_euler = _euler(rot)
        return self._register(obj)

    def camera(self, name, at, look_at=(0, 0, 0), lens=35.0, make_active=True):
        data = bpy.data.cameras.new(name)
        data.lens = float(lens)
        obj = bpy.data.objects.new(name, data)
        self.collection.objects.link(obj)
        obj.location = _vec3(at, "at")
        direction = _vec3(look_at, "look_at") - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        if make_active:
            bpy.context.scene.camera = obj
        return self._register(obj)

    def world(self, color="grey", strength=1.0):
        """Background / sky color and brightness."""
        scene = bpy.context.scene
        if scene.world is None:
            scene.world = bpy.data.worlds.new("World")
        w = scene.world
        try:
            w.use_nodes = True
        except Exception:
            pass
        r, g, b, _ = _rgba(color)
        bg = w.node_tree.nodes.get("Background") if w.node_tree else None
        if bg is not None:
            bg.inputs["Color"].default_value = (r, g, b, 1.0)
            bg.inputs["Strength"].default_value = float(strength)
        return w

    # ------------------------------------------------------------ helpers

    def noise(self, x, y, scale=1.0, seed=0, octaves=3):
        """Smooth deterministic noise in 0..1 — terrain, variation, randomness with structure."""
        def h(ix, iy):
            n = (ix * 374761393 + iy * 668265263 + seed * 144665) & 0xFFFFFFFF
            n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
            return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

        def value(px, py):
            ix, iy = math.floor(px), math.floor(py)
            fx, fy = px - ix, py - iy
            fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
            a, b = h(ix, iy), h(ix + 1, iy)
            c, d = h(ix, iy + 1), h(ix + 1, iy + 1)
            return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy

        total, amp, norm, freq = 0.0, 1.0, 0.0, 1.0 / max(float(scale), 1e-9)
        for _ in range(max(1, min(int(octaves), 6))):
            total += value(x * freq, y * freq) * amp
            norm += amp
            amp *= 0.5
            freq *= 2.0
        return total / norm

    def rng(self, seed=None):
        """A seeded random generator: r = ab.rng(3); r.uniform(0, 1)."""
        return random.Random(self.seed if seed is None else seed)

    def log(self, *args):
        """Add a line to this step's output (what you want to see afterwards)."""
        self.messages.append(" ".join(str(a) for a in args))


def public_names() -> list[str]:
    """Names of the functions the model may call on `ab` (used to keep the prompt reference honest)."""
    return sorted(n for n, v in Toolkit.__dict__.items() if callable(v) and not n.startswith("_"))
