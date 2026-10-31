# Edges and smoothness: rounded edges on hard objects, smooth shading and subdivision on soft/curved ones, cleaner anti-aliasing.
import bpy
sc = bpy.context.scene
for attr, val in (("taa_render_samples", 192),):
    try:
        setattr(sc.eevee, attr, val)
    except Exception:
        pass
sc.render.filter_size = 1.2
SOFT = ("pillow", "blanket", "Cat", "Mushroom Cap", "Orb", "Vase", "Hub")
ARCH = ("Wall", "Floor", "Ceiling", "Front Wall", "Baseboard")
stats = {"bevel": 0, "smooth": 0, "subsurf": 0}
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    nm, nv = o.name, len(o.data.vertices)
    if o.data.polygons and not nm.startswith(ARCH):
        # Smooth by angle: curved parts look round, flat faces keep crisp edges.
        try:
            for p in o.data.polygons:
                p.use_smooth = True
            if hasattr(o.data, "use_auto_smooth"):
                o.data.use_auto_smooth = True
                o.data.auto_smooth_angle = 0.5
            elif "Smooth by Angle" not in o.modifiers:
                pass
            stats["smooth"] += 1
        except Exception:
            pass
    has = {m.type for m in o.modifiers}
    if any(k in nm for k in SOFT) and nv < 4000 and "SUBSURF" not in has:
        m = o.modifiers.new("Soften", "SUBSURF"); m.levels = 1; m.render_levels = 2; stats["subsurf"] += 1
    elif "BEVEL" not in has and nv <= 400 and not nm.startswith(ARCH) and "/" not in nm:
        b = o.modifiers.new("Bevel", "BEVEL"); b.width = 0.005; b.segments = 3; b.limit_method = "ANGLE"; b.angle_limit = 0.6; stats["bevel"] += 1
    elif "BEVEL" in has:
        for m in o.modifiers:
            if m.type == "BEVEL":
                m.segments = 3; m.limit_method = "ANGLE"; m.angle_limit = 0.6
ab.log(f"smooth: {stats}")
