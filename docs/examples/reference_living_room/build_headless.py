# Headless dev runner: builds every step in order, renders the reference camera, prints per-step results.
import sys, os, glob, base64, time
REPO, ROOM, OUT = sys.argv[-3], sys.argv[-2], sys.argv[-1]
sys.path.insert(0, REPO)
import bpy
from addon import dispatcher
from addon.handlers import step_engine
step_engine.register()
LIB = os.path.join(REPO, "asset_library")
assets = {}
for meta in glob.glob(f"{LIB}/*/*/metadata.json"):
    aid = os.path.relpath(os.path.dirname(meta), LIB)
    assets[aid] = {"path": f"{LIB}/{aid}/model.glb", "name": aid.split("/")[1]}
bpy.ops.wm.read_homefile(use_empty=True)
only = os.environ.get("ONLY")
for f in sorted(glob.glob(f"{ROOM}/0*.py")):
    if only and os.path.basename(f)[:2] not in only.split(","):
        continue
    t = time.time()
    r = dispatcher.dispatch("run_step", {"code": open(f).read(), "collection": "Reference Living Room", "step_id": os.path.basename(f)[:2], "assets": assets, "timeout": 120})["result"]
    print(f"STEP {os.path.basename(f):16s} ok={r['ok']} created={r['created_count']:4d} {time.time()-t:4.1f}s", (r["error"] or "")[:300], (r["output"] or "")[:80])
st = dispatcher.dispatch("scene_state", {"collection": "Reference Living Room", "limit": 400})["result"]
print("UNITS", st["unit_count"], "| issues:", len(st["issues"]), [i["message"][:70] for i in st["issues"][:6]])
scene = bpy.context.scene
ENGINE = os.environ.get("ENGINE", "WB")
scene.render.engine = {"WB": "BLENDER_WORKBENCH", "EEVEE": "BLENDER_EEVEE", "CYCLES": "CYCLES"}[ENGINE]
if ENGINE == "CYCLES":
    scene.cycles.device = "CPU"; scene.cycles.samples = int(os.environ.get("SAMPLES", "48")); scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = (1280, 720) if ENGINE == "WB" else (960, 540)
scene.display.shading.light = os.environ.get("LIGHT", "STUDIO"); scene.display.shading.color_type = os.environ.get("COLOR", "TEXTURE")
scene.render.filepath = f"{OUT}/render_wb.png"
bpy.ops.render.render(write_still=True)
print("RENDERED")
