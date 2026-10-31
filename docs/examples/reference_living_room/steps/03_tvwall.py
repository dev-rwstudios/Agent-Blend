# TV wall: library marble panel + TV, fluted wood panels either side, floating white console with wood top.
Y1 = 6.0
OAK, OAK2, OAK3, WHITE, GOLD = "#B98C5E", "#9E7347", "#CBA375", "#EDE6DA", "#C6A04C"
ab.box("TV Wall Plate", (3.3, 0.03, 2.1), at=(0, Y1 - 0.015, 0.4), color=OAK2)
marble = ab.asset("decor/marble_gold_panel_decor", name="Marble Panel", at=(0, Y1 - 0.05, 0.4))
marble.scale = (0.876, 0.2, 0.683)                      # 1.9 m wide, 2.05 m tall, thin
ab.place(marble, (0, Y1 - 0.045, 0.4))
def marble_material():
    mat = bpy.data.materials.new("Marble White Gold")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    coord, mapping = nt.nodes.new("ShaderNodeTexCoord"), nt.nodes.new("ShaderNodeMapping")
    noise, sub, absn, ramp = nt.nodes.new("ShaderNodeTexNoise"), nt.nodes.new("ShaderNodeMath"), nt.nodes.new("ShaderNodeMath"), nt.nodes.new("ShaderNodeValToRGB")
    mapping.inputs["Scale"].default_value = (2.2, 1.0, 2.6)
    noise.inputs["Scale"].default_value = 2.4; noise.inputs["Detail"].default_value = 9.0; noise.inputs["Roughness"].default_value = 0.55
    try:
        noise.inputs["Distortion"].default_value = 0.6
    except KeyError:
        pass
    sub.operation = "SUBTRACT"; sub.inputs[1].default_value = 0.5
    absn.operation = "ABSOLUTE"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.000, (0.80, 0.64, 0.30, 1)     # thin gold vein core
    els[1].position, els[1].color = 0.060, (0.945, 0.94, 0.925, 1)   # white marble
    g = els.new(0.014); g.color = (0.62, 0.60, 0.58, 1)              # grey halo around the vein
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], sub.inputs[0])
    nt.links.new(sub.outputs["Value"], absn.inputs[0])
    nt.links.new(absn.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.15
    mat.diffuse_color = (0.92, 0.91, 0.88, 1)
    return mat
try:
    marble_mat = marble_material()
except Exception as e:
    ab.log("procedural marble failed:", e)
    marble_mat = ab.material("Marble White", "#EEEBE4", roughness=0.2)
for part in marble.children_recursive:
    if part.type == "MESH":
        part.data.materials.clear()
        part.data.materials.append(marble_mat)
ab.box("Marble Trim Top", (1.95, 0.05, 0.05), at=(0, Y1 - 0.06, 2.45), color=OAK)
for sgn in (-1, 1):                                      # fluted panels: 9 vertical slats each side
    slat = ab.box("Fluting", (0.045, 0.04, 2.05), at=(sgn * 0.98, Y1 - 0.05, 0.4), color=OAK)
    ab.array(slat, 9, (sgn * 0.07, 0, 0))
tv = ab.asset("electronics/simple_wall_tv", name="TV", at=(0, Y1 - 0.075, 1.12), scale=0.7)
# console
ab.box("Console Plinth", (2.8, 0.3, 0.12), at=(0, Y1 - 0.25, 0), color="#2B2622")
ab.box("Console Body", (2.95, 0.38, 0.34), at=(0, Y1 - 0.25, 0.12), color=WHITE)
ab.box("Console Top", (3.0, 0.40, 0.04), at=(0, Y1 - 0.25, 0.46), color=OAK)
ab.box("Console Niche", (0.9, 0.012, 0.25), at=(0, Y1 - 0.446, 0.17), color="#9C9893")
for x in (-1.0, -0.6, 0.6, 1.0):
    ab.box("Console Gap", (0.008, 0.012, 0.30), at=(x, Y1 - 0.446, 0.14), color="#6E6A66")
# decor on the console
ab.cylinder("Gold Vase A", 0.035, 0.16, at=(0.42, Y1 - 0.25, 0.5), radius_top=0.02, color=GOLD)
ab.cylinder("Gold Vase B", 0.03, 0.2, at=(0.52, Y1 - 0.25, 0.5), radius_top=0.015, color=GOLD)
ab.cylinder("Mushroom Stem", 0.02, 0.1, at=(-0.78, Y1 - 0.25, 0.5), color="#CFC8B8")
ab.sphere("Mushroom Cap", 0.06, at=(-0.78, Y1 - 0.25, 0.6), squash=(1, 1, 0.6), color="#E8DFC8")
ab.log("tv wall done")
