# Real shadows: every mesh casts and receives, downlights become shadow-casting spots, shadow quality raised.
import bpy
sc = bpy.context.scene
ev = sc.eevee
for attr, val in (("use_shadows", True), ("shadow_ray_count", 3), ("shadow_step_count", 12), ("light_threshold", 0.001),
                  ("use_shadow_jitter_viewport", True), ("shadow_resolution_scale", 1.0), ("fast_gi_ray_count", 8)):
    try:
        setattr(ev, attr, val)
    except Exception:
        pass
for o in bpy.data.objects:
    if o.type == "MESH":
        o.visible_shadow = True
        if hasattr(o, "is_shadow_catcher"):
            o.is_shadow_catcher = False
        if o.name.startswith(("Ceiling", "Recessed Spot")):
            continue
spots = [o for o in bpy.data.objects if o.name.startswith("Recessed Spot") and o.type == "MESH"]
for i, s in enumerate(spots):
    l = ab.light(f"Downlight {i+1}", "SPOT", at=(s.matrix_world.translation.x, s.matrix_world.translation.y, 2.85),
                 energy=300, color="#FFE9D0", rot=(0, 0, 0), size=0.08)
for o in bpy.data.objects:
    if o.type == "LIGHT":
        o.data.use_shadow = True
        if o.data.type == "SPOT":
            o.data.spot_size = 1.75
            o.data.spot_blend = 0.5
            o.data.shadow_soft_size = 0.04
        elif o.data.type == "AREA" and o.name == "Ceiling Fill":
            o.data.energy = 45
        elif o.data.type == "AREA" and o.name == "Entry Fill":
            o.data.energy = 60
w = bpy.data.worlds.get("World") or sc.world
if w and w.use_nodes:
    for n in w.node_tree.nodes:
        if n.type == "BACKGROUND":
            n.inputs["Strength"].default_value = 0.12
ab.log(f"shadows: {len(spots)} downlights")
