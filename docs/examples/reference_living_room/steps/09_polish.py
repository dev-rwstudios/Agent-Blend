# Finish: soft global illumination, glossy floor, oak grain, brass, beveled edges, gentle grade.
import bpy
sc = bpy.context.scene
ev = sc.eevee
for attr, val in (("use_raytracing", True), ("use_fast_gi", True), ("use_shadows", True), ("taa_render_samples", 64),
                  ("gi_diffuse_bounces", 3), ("fast_gi_ray_count", 4)):
    try:
        setattr(ev, attr, val)
    except Exception:
        pass
try:
    sc.view_settings.look = "None"
except Exception:
    pass
sc.view_settings.exposure = -0.75

def mats_of(o):
    return [s.material for s in o.material_slots if s.material]

def tweak(o, rough=None, metal=None):
    for m in mats_of(o):
        if not m.use_nodes:
            continue
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            if rough is not None: b.inputs["Roughness"].default_value = rough
            if metal is not None: b.inputs["Metallic"].default_value = metal

def grain(o, base, dark, scale=6.0, squeeze=0.08):
    m = bpy.data.materials.new(o.name + " Oak"); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale * squeeze * 10, scale * 12, scale)
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0; nz.inputs["Detail"].default_value = 8.0
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = dark; cr.color_ramp.elements[1].color = base
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], cr.inputs["Fac"]); nt.links.new(cr.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.42
    o.data.materials.clear(); o.data.materials.append(m)

def hexc(h):
    h = h.lstrip("#"); r, g, bl = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(bl), 1)

n_wood = n_gold = n_bevel = 0
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    nm = o.name
    if nm.startswith("Floor"):
        tweak(o, rough=0.28)
    elif nm in ("TV Wall Plate",) or "Shutter" in nm:
        tweak(o, rough=0.5)
    elif any(k in nm for k in ("Coffee Table", "Console Top", "Console Plinth", "Side Table Top", "Fluting", "Portal", "Ceiling Beam", "Ceiling Wood", "Shelf Side")):
        grain(o, hexc("#B08A64"), hexc("#8A6A4A")); n_wood += 1
    elif any(k in nm for k in ("Brass", "Gold", "Fan Blade", "Fan Rod", "Lamp Stem")):
        tweak(o, rough=0.22, metal=1.0); n_gold += 1
    if len(o.data.vertices) <= 32 and not nm.startswith(("Wall", "Floor", "Ceiling", "Front Wall")) and "/" not in nm:
        bv = o.modifiers.new("Bevel", "BEVEL"); bv.width = 0.006; bv.segments = 2; n_bevel += 1
ab.log(f"polish: wood={n_wood} metal={n_gold} bevel={n_bevel}")
