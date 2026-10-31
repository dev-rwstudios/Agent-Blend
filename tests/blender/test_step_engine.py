"""Real-Blender tests for the step engine (addon/handlers/step_engine.py).

    blender -b --factory-startup --python tests/blender/test_step_engine.py -- /path/to/repo

The scenes below are deliberately unrelated to each other: the engine must not care.
"""
import sys

sys.path.insert(0, sys.argv[-1])
import bpy  # noqa: E402

from addon import dispatcher  # noqa: E402
from addon.handlers import step_engine  # noqa: E402

step_engine.register()
PASSED, FAILED = [], []


def check(name, cond, detail=""):
    (PASSED if cond else FAILED).append(name)
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))


def call(cmd, **params):
    r = dispatcher.dispatch(cmd, params)
    assert r["status"] == "ok", r
    return r["result"]


def reset():
    bpy.ops.wm.read_homefile(use_empty=True)


def run(code, step="s1", **kw):
    return call("run_step", code=code, collection="Run", step_id=step, **kw)


def state(**kw):
    return call("scene_state", collection="Run", **kw)


# ---- three unrelated scenes, written the way a model would write them
reset()
r = run('''
rock = ab.height_field("Island", (60, 60), lambda x, y: max(0.0, 6 - 0.012 * (x * x + y * y)) + 0.4 * ab.noise(x, y, 6, seed=2), resolution=(48, 48), color="stone")
tower = ab.cylinder("Tower", 2.5, 14, at=(0, 0, 6), radius_top=1.6, color="white")
ab.place_on(tower, rock, xy=(0, 0))
gallery = ab.cylinder("Gallery", 2.2, 0.4, at=(0, 0, 0), color="black")
ab.place_on(gallery, tower, xy=(0, 0))
lamp = ab.sphere("Lamp", 0.9, at=(0, 0, 0), color="yellow")
ab.place_on(lamp, gallery, xy=(0, 0))
roof = ab.cone("Roof", 1.4, 1.8, at=(0, 0, 0), color="red")
ab.place_on(roof, lamp, xy=(0, 0))
ab.light("Beam", "SPOT", at=(0, 0, 22), energy=4000)
ab.log("lighthouse built")
''')
check("lighthouse script runs", r["ok"], r["error"])
st = state()
top = max(u["bbox_max"][2] for u in st["objects"])
check("lighthouse stacks upward (roof is the highest point, ~tens of metres up)", top > 14, top)
check("everything it made is reported", r["created_count"] >= 6 and "Tower" in r["created"], r)

reset()
r = run('''
light, dark = ab.material("Light", "#e8d9b5"), ab.material("Dark", "#5a3b1e")
tile = ab.box("Tile", (1, 1, 0.1), at=(0, 0, 0))
sq = ab.grid(tile, 8, 8, (1, 1))
for i, t in enumerate(sq):
    ab.paint(t, light if (i // 8 + i % 8) % 2 == 0 else dark)
piece = ab.cylinder("Piece", 0.3, 0.8, at=(3, 3, 0.1), radius_top=0.2, color="white")
ab.place_on(piece, sq[3 * 8 + 3], xy=(3, 3))
''')
check("chessboard script runs", r["ok"], r["error"])
st = state()
check("64 tiles collapse into one family row, the piece stays separate", any(o.get("count") == 64 for o in st["objects"]) and any(o["name"].startswith("Piece") for o in st["objects"]), [o["name"] for o in st["objects"]])

reset()
r = run('''
path = [(0, 0, 3), (10, 0, 3), (10, 10, 3), (20, 10, 1)]
ab.tube("Pipe", path, 0.4, color="metal")
post = ab.cylinder("Support", 0.15, 3.0, color="grey")
ab.along(post, [(0, 0, 0), (10, 0, 0)], 2.5)
ab.log("created", len(ab.created), "objects")
''')
check("pipe-network script runs", r["ok"], r["error"])
check("ab.log output comes back", "created" in r["output"], r["output"])

# ---- the engine's safety behaviour
reset()
r = run("ab.box('a', (1, 1, 1))\nx = undefined_name + 1\nab.box('never', (1,1,1))")
check("a runtime error is reported with its line and source", (not r["ok"]) and "NameError" in r["error"] and r["error_line"] == 2 and "undefined_name" in r["error"], r)
check("objects made before the error are still reported (so the step can be cleaned up)", "a" in r["created"])
r = run("ab.box('bad', (1, 0, 1))")
check("a toolkit guard rail surfaces as a readable error", (not r["ok"]) and "greater than 0" in r["error"], r["error"])
r = run("this is not python (")
check("a syntax error is reported with its line", (not r["ok"]) and "SyntaxError" in r["error"] and r["error_line"] == 1, r)
import time  # noqa: E402
t0 = time.monotonic()
r = run("while True:\n    pass", timeout=1.5)
check("an endless loop is stopped by the time limit instead of freezing Blender", (not r["ok"]) and "time limit" in r["error"] and time.monotonic() - t0 < 6, (r, time.monotonic() - t0))
r = run("import os\nos.system('echo hi')")
check("the sandbox still blocks dangerous imports", (not r["ok"]) and "blocked" in r["error"], r["error"])
r = run("o = bpy.data.objects.new('raw', None)\nbpy.context.scene.collection.objects.link(o)")
check("objects made with raw bpy are adopted into the run's collection and tagged", r["ok"] and "raw" in r["created"] and bpy.data.objects["raw"]["ab_role"] == "built", r)

# ---- the user's own objects
reset()
mine = bpy.data.objects.new("MyOwnThing", None)
bpy.context.scene.collection.objects.link(mine)
mine.location = (3, 0, 0)
r = run("ab.box('ok', (1,1,1))")
check("a harmless step leaves the user's objects untouched", r["ok"] and r["touched_foreign"] == [], r)
r = run("bpy.data.objects.remove(bpy.data.objects['MyOwnThing'], do_unlink=True)")
check("deleting the user's object is detected", r["touched_foreign"] == ["MyOwnThing"], r)
reset()
mine = bpy.data.objects.new("MyOwnThing", None)
bpy.context.scene.collection.objects.link(mine)
r = run("bpy.data.objects['MyOwnThing'].location.x = 99")
check("moving the user's object is detected", r["touched_foreign"] == ["MyOwnThing"], r)
st = state()
check("the user's objects are summarised separately, not mixed into the build", st["foreign"]["count"] == 1 and st["unit_count"] == 0, st["foreign"])

# ---- library assets are just another building block
import os  # noqa: E402

lib = os.path.join(sys.argv[-1], "asset_library")
reset()
r = run("bed = ab.asset('bed/bed_frame_01', name='Bed', at=(6, -3, 0), rot=90)\nprint(ab.size(bed))", assets={"bed/bed_frame_01": {"path": f"{lib}/bed/bed_frame_01/model.glb", "name": "bed_frame_01"}})
check("ab.asset imports a library model", r["ok"], r["error"])
bed = bpy.data.objects.get("Bed")
lo, hi = step_engine.Toolkit(bpy.data.collections["Run"]).bbox(bed)
check("the asset lands where asked, whatever coordinates its file carried (re-centered, on the ground)",
      abs((lo.x + hi.x) / 2 - 6) < 0.05 and abs((lo.y + hi.y) / 2 + 3) < 0.05 and abs(lo.z) < 0.01, (lo, hi))
check("the imported asset's parts are tagged, so the whole unit is removable", all(o.get("ab_role") == "built" for o in bed.children_recursive) and len(bed.children) >= 1)
st = state()
check("an asset is ONE unit in the scene state (parts hidden inside it)", sum(1 for o in st["objects"] if o["name"] == "Bed") == 1 and st["unit_count"] == 1, st["objects"])
r = run("ab.asset('sofa', name='X')", assets={"seating/sofa": {"path": "/x"}, "bed/bed_frame_01": {"path": "/y"}})
check("an unknown asset id names close matches", (not r["ok"]) and "seating/sofa" in r["error"], r["error"])

# ---- retries start clean
reset()
run("ab.box('p1', (1,1,1))\nab.box('p2', (1,1,1))", step="sA")
run("ab.box('keep', (1,1,1))", step="sB")
call("remove_step", step_id="sA")
names = {o.name for o in bpy.data.objects}
check("remove_step deletes only that step's objects", "p1" not in names and "p2" not in names and "keep" in names, names)

# ---- generic problem checks
reset()
run('''
ab.plane("Ground", (40, 40), color="green")
ab.box("Sits", (2, 2, 2), at=(0, 0, 0))
ab.box("Floats", (2, 2, 2), at=(10, 0, 8))
ab.box("Sunk", (2, 2, 2), at=(-10, 0, -5))
ab.box("Big", (4, 4, 4), at=(-10, 10, 0))
ab.box("Inside", (3, 3, 3), at=(-10.2, 10.1, 0.5))
''')
codes = {(i["code"], i["object"]) for i in state()["issues"]}
check("floating objects are flagged", ("floating", "Floats") in codes, codes)
check("objects below ground are flagged", ("below_ground", "Sunk") in codes, codes)
check("heavy interpenetration is flagged", any(c == "overlap" for c, _ in codes), codes)
check("an object resting on the ground is NOT flagged", all(o != "Sits" for _, o in codes), codes)
check("the ground plane itself is NOT flagged", all(o != "Ground" for _, o in codes), codes)
reset()
run('''
hill = ab.height_field("Hill", (60, 60), lambda x, y: 5 * math.exp(-(x*x + y*y) / 180), resolution=(40, 40))
post = ab.cylinder("Post", 0.08, 1.1)
for i in range(8):
    ab.place(ab.cylinder("Post", 0.08, 1.1), (6 * math.cos(i), 6 * math.sin(i), ab.surface_z(hill, 6 * math.cos(i), 6 * math.sin(i))))
''')
check("objects standing on terrain are NOT reported as overlapping it", not [i for i in state()["issues"] if i["code"] == "overlap"], state()["issues"][:3])

print(f"\nSTEP ENGINE TESTS: {len(PASSED)} passed, {len(FAILED)} failed")
if FAILED:
    print("FAILED:", FAILED)
    sys.exit(1)
