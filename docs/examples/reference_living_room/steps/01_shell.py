# Room shell: herringbone parquet floor, walls, ceiling, baseboards. Room: x -2.6..2.6, y 0..6, height 2.9 (portal at y=0).
import bmesh
X0, X1, Y1, H = -2.6, 2.6, 6.0, 2.9
OAK, OAK2, OAK3, WHITE = "#DFC196", "#C49E6E", "#D2B084", "#EEE7DB"

L, W, GAP = 0.60, 0.12, 0.0035          # plank length / width, tiny gap so planks read as planks
FX0, FX1, FY0, FY1 = X0, X1, -0.3, Y1
bm, tone = bmesh.new(), []
rng = ab.rng(11)
def plank(a, b, c, d):
    a, b, c, d = max(a, FX0) + GAP, max(b, FY0) + GAP, min(c, FX1) - GAP, min(d, FY1) - GAP
    if c - a < 0.01 or d - b < 0.01:
        return
    bm.faces.new([bm.verts.new(p) for p in ((a, b, 0), (c, b, 0), (c, d, 0), (a, d, 0))])
    tone.append(rng.randint(0, 2))
for m in range(-14, 16):                # herringbone: horizontal + vertical plank pairs on a lattice
    for d in range(-30, 80):
        ox, oy = d * W - m * L, d * W + m * L
        plank(ox, oy, ox + L, oy + W)
        plank(ox + L, oy + W - L, ox + L + W, oy + W)
floor = ab._object_from_bmesh("Parquet Floor", bm, (0, 0, 0), 0, None, "base", None)
for name, col in (("Oak A", OAK), ("Oak B", OAK2), ("Oak C", OAK3)):
    floor.data.materials.append(ab.material(name, col, roughness=0.4))
for poly, t in zip(floor.data.polygons, tone):
    poly.material_index = t
ab.box("Floor Base", (5.4, 6.6, 0.04), at=(0, 2.85, -0.04), color=OAK2)

ab.box("Wall Left", (0.2, 6.3, H + 0.2), at=(X0 - 0.1, 2.85, 0), color=WHITE)
ab.box("Wall Right", (0.2, 6.3, H + 0.2), at=(X1 + 0.1, 2.85, 0), color=WHITE)
ab.box("Wall Back", (5.4, 0.2, H + 0.2), at=(0, Y1 + 0.1, 0), color=WHITE)
ab.box("Ceiling", (5.4, 6.3, 0.2), at=(0, 2.85, H), color=WHITE)
ab.box("Baseboard Left", (0.03, 6.0, 0.12), at=(X0 + 0.015, 3.0, 0), color=OAK)
ab.box("Baseboard Right", (0.03, 6.0, 0.12), at=(X1 - 0.015, 3.0, 0), color=OAK)
ab.box("Baseboard Back", (5.2, 0.03, 0.12), at=(0, Y1 - 0.015, 0), color=OAK)
ab.log("planks:", len(tone))
