"""Real-Blender tests for addon/toolkit.py (the `ab` modelling toolkit).

    blender -b --factory-startup --python tests/blender/test_toolkit.py -- /path/to/repo

(tests/test_blender_toolkit.py runs this automatically when a `blender` binary is available.)
"""
import math
import sys

sys.path.insert(0, sys.argv[-1])
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from addon.toolkit import Toolkit, public_names  # noqa: E402

PASSED, FAILED = [], []


def check(name, cond, detail=""):
    (PASSED if cond else FAILED).append(name)
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))


def near(a, b, tol=1e-3):
    return abs(a - b) <= tol


def raises(fn, text):
    try:
        fn()
    except ValueError as e:
        return text in str(e)
    except Exception as e:  # wrong exception type
        print("   unexpected", type(e).__name__, e)
        return False
    return False


def fresh():
    bpy.ops.wm.read_homefile(use_empty=True)
    coll = bpy.data.collections.new("Run")
    bpy.context.scene.collection.children.link(coll)
    return Toolkit(coll, step_id="s1", seed=7)


ab = fresh()
# ---- primitives
b = ab.box("b", (2, 3, 4), at=(1, 2, 0))
lo, hi = ab.bbox(b)
check("box base anchor: sits on z=0, centered on at", near(lo.z, 0) and near(hi.z, 4) and near((lo.x + hi.x) / 2, 1) and near((lo.y + hi.y) / 2, 2), (lo, hi))
check("box dimensions", near(hi.x - lo.x, 2) and near(hi.y - lo.y, 3) and near(hi.z - lo.z, 4))
c = ab.box("c", (1, 1, 2), at=(0, 0, 5), anchor="center")
lo, hi = ab.bbox(c)
check("box center anchor", near(lo.z, 4) and near(hi.z, 6))
r = ab.box("r", (4, 1, 1), at=(0, 0, 0), rot=90)
lo, hi = ab.bbox(r)
check("rot=90 turns about Z (4x1 footprint becomes 1x4)", near(hi.x - lo.x, 1) and near(hi.y - lo.y, 4), (lo, hi))
cone = ab.cone("cone", 1.0, 3.0, at=(5, 5, 0))
lo, hi = ab.bbox(cone)
check("cone: height 3 on the ground, base radius 1", near(lo.z, 0) and near(hi.z, 3) and near(hi.x - lo.x, 2, 0.05))
fr = ab.cylinder("fr", 2.0, 2.0, radius_top=1.0, at=(0, 0, 1))
lo, hi = ab.bbox(fr)
check("frustum rests at z=1", near(lo.z, 1) and near(hi.z, 3))
sp = ab.sphere("sp", 0.5, at=(0, 0, 0))
lo, hi = ab.bbox(sp)
check("sphere base anchor: diameter 1, bottom on ground", near(lo.z, 0) and near(hi.z, 1, 0.02), (lo, hi))
el = ab.sphere("el", 1.0, squash=(2, 1, 0.5), anchor="center")
lo, hi = ab.bbox(el)
check("ellipsoid squash", near(hi.x - lo.x, 4, 0.1) and near(hi.z - lo.z, 1, 0.05))
to = ab.torus("to", 2.0, 0.25, at=(0, 0, 0))
lo, hi = ab.bbox(to)
check("torus extent", near(hi.x - lo.x, 4.5, 0.05) and near(hi.z - lo.z, 0.5, 0.02) and near(lo.z, 0))
pl = ab.plane("pl", (10, 6), at=(0, 0, 2))
lo, hi = ab.bbox(pl)
check("plane flat at z=2", near(lo.z, 2) and near(hi.z, 2) and near(hi.x - lo.x, 10))

# ---- shapes
hexa = [(math.cos(math.radians(a)), math.sin(math.radians(a))) for a in range(0, 360, 60)]
pr = ab.prism("pr", hexa, 2.5, at=(3, 0, 0))
lo, hi = ab.bbox(pr)
check("prism: hexagon extruded 2.5 up from the ground", near(lo.z, 0) and near(hi.z, 2.5) and near(hi.x - lo.x, 2, 0.02), (lo, hi))
check("prism has outward normals (positive volume)", sum(p.normal.dot(p.center) for p in pr.data.polygons if abs(p.normal.z) < 0.5) > 0)
tu = ab.tube("tu", [(0, 0, 0), (4, 0, 0), (4, 4, 0)], 0.2)
lo, hi = ab.bbox(tu)
check("tube follows its path, padded by the radius", near(lo.x, 0, 0.01) and near(hi.x, 4.2, 0.02) and near(hi.y, 4, 0.01) and near(hi.z, 0.2, 0.02), (lo, hi))
hf = ab.height_field("hf", (20, 20), lambda x, y: 2 * math.sin(x / 3) + 1, resolution=(40, 40))
lo, hi = ab.bbox(hf)
check("height_field: size and height range follow the function", near(hi.x - lo.x, 20) and lo.z < 0 and hi.z > 2.5, (lo, hi))
z = ab.surface_z(hf, 0.0, 0.0)
check("surface_z reads the terrain height", near(z, 1.0, 0.05), z)
check("surface_z outside the field returns the default", near(ab.surface_z(hf, 500, 500, default=-3), -3))

# ---- repetition
fresh_ab = fresh()
base = fresh_ab.box("post", (0.2, 0.2, 1.0), at=(0, 0, 0))
arr = fresh_ab.array(base, 5, (2, 0, 0))
check("array: 5 objects, 2 m apart", len(arr) == 5 and near(arr[4].location.x, 8))
check("array copies share mesh data", arr[1].data is arr[0].data)
g = fresh_ab.grid(base, 3, 4, (1.5, 2.0))
check("grid: 12 objects", len(g) == 12)
al = fresh_ab.along(base, [(0, 10, 0), (10, 10, 0)], 2.5)
check("along: posts every 2.5 m on a 10 m line (5 incl. both ends)", len(al) == 5 and near(al[-1].location.x, 10), [round(o.location.x, 2) for o in al])
ter = fresh_ab.height_field("ter", (100, 100), lambda x, y: 0.05 * x, resolution=(50, 50), at=(0, 0, 0))
tree = fresh_ab.cone("tree", 0.4, 2.0)
sc = fresh_ab.scatter(tree, 40, (-40, -40, 40, 40), seed=3, min_dist=4.0, on=ter)
pts = [(o.location.x, o.location.y) for o in sc]
mind = min(math.dist(p, q) for i, p in enumerate(pts) for q in pts[i + 1:])
check("scatter: 40 placed inside the area", len(sc) == 40 and all(-40 <= x <= 40 and -40 <= y <= 40 for x, y in pts))
check("scatter: min_dist respected", mind >= 4.0 - 1e-6, mind)
check("scatter: copies sit on the terrain surface", all(near(o.location.z, 0.05 * o.location.x, 0.1) for o in sc[:10]))
house = fresh_ab.box("keepout", (10, 10, 3), at=(0, 0, 0))
sc2 = fresh_ab.scatter(tree, 60, (-20, -20, 20, 20), seed=1, avoid=[house])
check("scatter: nothing inside an avoided footprint", all(not (-5 <= o.location.x <= 5 and -5 <= o.location.y <= 5) for o in sc2))
sc3 = fresh_ab.scatter(tree, 5, (0, 0, 1, 1), seed=1, min_dist=5.0)
check("scatter that can't fit says so instead of failing", len(sc3) < 5 and any("scatter placed" in m for m in fresh_ab.messages))

# ---- organising
ab2 = fresh()
a = ab2.box("a", (2, 2, 2), at=(0, 0, 0))
t = ab2.box("t", (1, 1, 1), at=(10, 0, 0))
grp = ab2.group("grp", [a, t])
lo, hi = ab2.bbox(grp)
check("group bbox covers its children", near(lo.x, -1) and near(hi.x, 10.5), (lo, hi))
grp.location.x += 5
bpy.context.view_layer.update()
check("moving the group moves the children", near(a.matrix_world.translation.x, 5) and near(t.matrix_world.translation.x, 15))
tbl = ab2.box("table", (2, 1, 0.8), at=(0, 5, 0))
cup = ab2.cylinder("cup", 0.05, 0.1, at=(7, 7, 0))
ab2.place_on(cup, tbl, xy=(0, 5))
lo, hi = ab2.bbox(cup)
check("place_on rests the bottom on the top and moves sideways", near(lo.z, 0.8) and near((lo.x + hi.x) / 2, 0, 0.01) and near((lo.y + hi.y) / 2, 5, 0.01), (lo, hi))
wall = ab2.box("wall", (4, 0.3, 3), at=(0, 20, 0))
hole = ab2.box("hole", (1, 1, 1.2), at=(0, 20, 0.5))
before = len(wall.data.vertices)
ab2.cut(wall, hole)
check("cut: boolean hole added geometry, cutter removed", len(wall.data.vertices) > before and "hole" not in bpy.data.objects)

# ---- look
ab3 = fresh()
m1 = ab3.material("Red", "red", roughness=0.3)
m2 = ab3.material("Hex", "#ff8800")
check("material by name / hex", m1.diffuse_color[0] > 0.7 and m2.diffuse_color[1] > 0.1)
bx = ab3.box("bx", (1, 1, 1), color=(0.1, 0.5, 0.2))
check("color at creation assigns a material", len(bx.data.materials) == 1)
check("unknown color is a readable error", raises(lambda: ab3.material("x", "chartreuse-ish"), "Unknown color"))
li = ab3.light("sun", "SUN", at=(0, 0, 10), energy=3)
ca = ab3.camera("cam", at=(10, -10, 8), look_at=(0, 0, 1))
check("light and camera created; camera is active", li.type == "LIGHT" and ca.type == "CAMERA" and bpy.context.scene.camera is ca)
ab3.world("#87ceeb", 1.2)
check("world color set", bpy.context.scene.world is not None)
check("noise is deterministic and in 0..1", near(ab3.noise(3.3, 4.4, 5, seed=1), ab3.noise(3.3, 4.4, 5, seed=1)) and all(0 <= ab3.noise(x * 1.7, x * 0.3, 4) <= 1 for x in range(50)))
check("noise varies with position", len({round(ab3.noise(x, 0, 2), 3) for x in range(20)}) > 5)

# ---- guard rails and tagging
ab4 = fresh()
check("negative size is a readable error", raises(lambda: ab4.box("bad", (1, -2, 1)), "greater than 0"))
check("non-numeric size is a readable error", raises(lambda: ab4.box("bad", ("a", 1, 1)), "size must be a number"))
check("bad position is a readable error", raises(lambda: ab4.box("bad", (1, 1, 1), at=(1, 2)), "three numbers"))
check("too many copies refused", raises(lambda: ab4.array(ab4.box("p", (1, 1, 1)), 10**6, (1, 0, 0)), "count must be"))
check("huge terrain refused", raises(lambda: ab4.height_field("h", (10, 10), 0, resolution=(5000, 5000)), "resolution"))
check("bad anchor refused", raises(lambda: ab4.box("bad", (1, 1, 1), anchor="top"), "anchor"))
obj = ab4.box("tagged", (1, 1, 1))
check("everything is tagged and lives only in the run's collection", obj["ab_role"] == "built" and obj["ab_step"] == "s1" and [c.name for c in obj.users_collection] == ["Run"])
check("created objects are tracked for cleanup", "tagged" in ab4.created)

# ---- the prompt reference can't drift from reality
names = public_names()
check("public toolkit functions are discoverable", {"box", "scatter", "height_field", "cut", "group", "place_on", "material", "light"} <= set(names), names)

print(f"\nTOOLKIT TESTS: {len(PASSED)} passed, {len(FAILED)} failed")
if FAILED:
    print("FAILED:", FAILED)
    sys.exit(1)
