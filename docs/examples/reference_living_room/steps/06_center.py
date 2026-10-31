# Rug (library), low coffee table with lower shelf, side table with lamp, and a cat on the rug.
import math
import bpy
OAK, OAK2, OAK3, GOLD = "#B98C5E", "#9E7347", "#CBA375", "#C6A04C"
rug = ab.asset("rug/carpet_square", name="Rug", at=(0, 2.75, 0.004))
rug.scale = (0.9, 0.75, 1.0)
def rug_material():                      # soft grey diamonds, like the reference rug
    mat = bpy.data.materials.new("Rug Diamonds")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    coord, mapping, chk = nt.nodes.new("ShaderNodeTexCoord"), nt.nodes.new("ShaderNodeMapping"), nt.nodes.new("ShaderNodeTexChecker")
    mapping.inputs["Scale"].default_value = (9.0, 9.0, 9.0)
    mapping.inputs["Rotation"].default_value = (0, 0, 0.7854)
    chk.inputs["Color1"].default_value = (0.86, 0.85, 0.82, 1)
    chk.inputs["Color2"].default_value = (0.70, 0.69, 0.66, 1)
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], chk.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    mat.diffuse_color = (0.8, 0.79, 0.76, 1)
    return mat
try:
    rug_mat = rug_material()
except Exception as e:
    ab.log("rug material failed:", e)
    rug_mat = ab.material("Rug Grey", "#D2CFC8", roughness=0.95)
for part in rug.children_recursive:
    if part.type == "MESH":
        part.data.materials.clear()
        part.data.materials.append(rug_mat)                                   # ~2.7 x 2.3 m
# coffee table
cy = 2.75
ab.box("Coffee Table Top", (1.1, 0.64, 0.045), at=(0, cy, 0.335), color=OAK)
for dx in (-0.5, 0.5):
    for dy in (-0.27, 0.27):
        ab.box("Coffee Table Leg", (0.06, 0.06, 0.335), at=(dx, cy + dy, 0), color=OAK2)
ab.box("Coffee Table Shelf", (0.96, 0.5, 0.025), at=(0, cy, 0.11), color=OAK3)
ab.box("Tray", (0.36, 0.26, 0.015), at=(0.15, cy, 0.38), color="#E4DAC6")
ab.asset("decor/art_book", name="Table Book", at=(-0.25, cy + 0.05, 0.38), rot=12)
ab.asset("decor/black_vase", name="Table Vase", at=(0.2, cy, 0.395))
# side table (dark marble top, brass legs) with a lamp, near the right sofa
sx, sy = 2.1, 0.95
ab.cylinder("Side Table Top", 0.26, 0.03, at=(sx, sy, 0.52), color="#2A2A2E", segments=48)
for k in range(3):
    a = math.radians(90 + 120 * k)
    ab.cylinder("Side Table Leg", 0.012, 0.52, at=(sx + 0.2 * math.cos(a), sy + 0.2 * math.sin(a), 0), color=GOLD)
ab.torus("Side Table Ring", 0.2, 0.01, at=(sx, sy, 0.22), color=GOLD)
ab.cylinder("Lamp Base", 0.07, 0.02, at=(sx, sy, 0.55), color=GOLD)
ab.cylinder("Lamp Stem", 0.012, 0.3, at=(sx, sy, 0.57), color=GOLD)
shade = ab.cylinder("Lamp Shade", 0.2, 0.28, at=(sx, sy, 0.78), radius_top=0.14, color="#F4EEDD")
ab.paint(shade, ab.material("Shade Glow", "#F4EEDD", roughness=0.8, emission="#FFE9B8"))
# cat lying on the rug
cx, cyy = 0.95, 3.15
ab.sphere("Cat Body", 0.2, at=(cx, cyy, 0.14), squash=(1.5, 0.75, 0.65), anchor="center", rot=25, color="#9A9A9A")
ab.sphere("Cat Head", 0.085, at=(cx + 0.27, cyy + 0.12, 0.13), anchor="center", color="#A4A4A4")
for dy in (-0.045, 0.045):
    ab.cone("Cat Ear", 0.03, 0.06, at=(cx + 0.27 + dy * 0.4, cyy + 0.12 + dy, 0.19), color="#8F8F8F")
ab.tube("Cat Tail", [(cx - 0.28, cyy - 0.14, 0.06), (cx - 0.42, cyy - 0.1, 0.05), (cx - 0.5, cyy + 0.04, 0.05)], 0.025, color="#9A9A9A")
ab.log("center done")
