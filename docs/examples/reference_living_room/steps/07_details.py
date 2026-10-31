# Wall art, ceiling wood panel + fan + beams, recessed spot lights.
import math
X0, X1, H = -2.6, 2.6, 2.9
OAK2 = "#9E7347"
def frame(x, y, z, w, h, s):             # picture on a side wall; s=+1 faces +X (left wall), -1 faces -X
    ab.box("Art Frame", (0.035, w, h), at=(x, y, z), color="#1B1B1B")
    ab.box("Art Mat", (0.04, w - 0.05, h - 0.05), at=(x + s * 0.003, y, z + 0.025), color="#EEEAE2")
    ab.box("Art Mark", (0.045, w * 0.55, h * 0.3), at=(x + s * 0.006, y, z + h * 0.38), color="#7A7772")
    ab.box("Art Mark 2", (0.045, w * 0.3, h * 0.2), at=(x + s * 0.006, y + w * 0.1, z + h * 0.15), color="#2A2A2A")
for y, z, w, h in ((1.0, 1.72, 0.5, 0.72), (1.7, 1.85, 0.46, 0.66), (1.0, 1.05, 0.3, 0.42), (1.7, 1.1, 0.3, 0.42)):
    frame(X0 + 0.02, y, z, w, h, +1)
for y, z, w, h in ((3.7, 1.45, 0.55, 0.82), (4.5, 1.45, 0.5, 0.82)):
    frame(X1 - 0.02, y, z, w, h, -1)
# ceiling
ab.box("Ceiling Wood Panel", (1.7, 0.95, 0.05), at=(0, 3.4, H - 0.05), color=OAK2)
for sgn in (-1, 1):
    ab.box("Ceiling Beam", (0.22, 0.12, 0.12), at=(sgn * 1.55, 5.0, H - 0.12), color=OAK2)
ab.cylinder("Fan Rod", 0.015, 0.25, at=(0, 3.4, H - 0.3), color="#EDEDED")
ab.cylinder("Fan Hub", 0.09, 0.08, at=(0, 3.4, H - 0.38), color="#F2F2F2")
for k in range(3):
    a = 120 * k + 15
    ab.box("Fan Blade", (0.62, 0.11, 0.012), at=(0.38 * math.cos(math.radians(a)), 3.4 + 0.38 * math.sin(math.radians(a)), H - 0.36), rot=a, color="#F2F2F2")
glow = ab.material("Spot Glow", "#FFFFFF", emission="#FFF1D6")
for x in (-1.7, -0.7, 0.7, 1.7):
    for y in (1.0, 2.2, 4.6, 5.5):
        ab.paint(ab.cylinder("Recessed Spot", 0.05, 0.012, at=(x, y, H - 0.012), color="#FFFFFF"), glow)
# make the ceiling softly bright (bounce light alone leaves it grey)
import bpy
ceil = bpy.data.objects["Ceiling"]
glow = ab.material("Ceiling Glow", "#F3EEE6", roughness=0.9, emission="#F3EEE6")
ab.paint(ceil, glow)
bsdf = glow.node_tree.nodes.get("Principled BSDF")
if bsdf is not None and "Emission Strength" in bsdf.inputs:
    bsdf.inputs["Emission Strength"].default_value = 0.45
ab.log("details done")
