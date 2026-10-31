# Two wooden slat-arm sofas facing each other (left faces +X, right faces -X), with pillows from the library.
X0, X1 = -2.6, 2.6
OAK, OAK2 = "#B98C5E", "#9E7347"
CUSH, CUSH2 = "#C8C5BF", "#D3D0CA"
LEN = 2.2
def sofa(tag, s, yc):
    xb = X0 + 0.03 if s > 0 else X1 - 0.03            # back of the sofa, against the wall
    cx = lambda d: xb + s * d                          # distance out from the wall
    ab.box(f"{tag} Base", (0.85, LEN, 0.10), at=(cx(0.425), yc, 0.20), color=OAK)
    for dx in (0.07, 0.78):
        for dy in (-(LEN / 2 - 0.08), LEN / 2 - 0.08):
            ab.box(f"{tag} Leg", (0.07, 0.07, 0.20), at=(cx(dx), yc + dy, 0), color=OAK2)
    ab.box(f"{tag} Seat Cushion", (0.62, LEN - 0.38, 0.15), at=(cx(0.53), yc, 0.30), color=CUSH)
    ab.box(f"{tag} Back Frame", (0.07, LEN, 0.62), at=(cx(0.035), yc, 0.30), color=OAK)
    for dy in (-0.62, 0.0, 0.62):
        ab.box(f"{tag} Back Cushion", (0.15, 0.6, 0.42), at=(cx(0.16), yc + dy, 0.45), color=CUSH2)
    for side in (-1, 1):
        y = yc + side * (LEN / 2 - 0.04)
        ab.box(f"{tag} Arm Top", (0.85, 0.09, 0.04), at=(cx(0.425), y, 0.62), color=OAK)
        ab.box(f"{tag} Arm Rail", (0.85, 0.05, 0.04), at=(cx(0.425), y, 0.28), color=OAK)
        post = ab.box(f"{tag} Arm Slat", (0.035, 0.045, 0.30), at=(cx(0.13), y, 0.31), color=OAK)
        ab.array(post, 6, (s * 0.13, 0, 0))
    return xb, cx

xbL, cxL = sofa("Left Sofa", +1, 2.4)
xbR, cxR = sofa("Right Sofa", -1, 2.4)
def paint_all(o, color):
    for part in o.children_recursive:
        ab.paint(part, color)
# pillows (library): grey, patterned, and one orange on the left sofa; two grey on the right
p1 = ab.asset("soft_furnishing/sofa_pillow", name="Pillow L1", at=(cxL(0.3), 1.85, 0.45), rot=100); paint_all(p1, "#8F8D8A")
p2 = ab.asset("soft_furnishing/throw_pillow_01", name="Pillow L2", at=(cxL(0.32), 2.25, 0.45), rot=90); paint_all(p2, "#D2691E")
p3 = ab.asset("soft_furnishing/patterned_pillow_01", name="Pillow L3", at=(cxL(0.32), 1.5, 0.45), rot=85)
p4 = ab.asset("soft_furnishing/sofa_pillow_alt", name="Pillow R1", at=(cxR(0.3), 1.85, 0.45), rot=-95); paint_all(p4, "#8F8D8A")
p5 = ab.asset("soft_furnishing/throw_pillow_01", name="Pillow R2", at=(cxR(0.32), 2.25, 0.45), rot=-90); paint_all(p5, "#E8E4DC")
b = ab.asset("soft_furnishing/blanket_01", name="Throw Blanket", at=(cxR(0.55), 2.95, 0.38), rot=-90, scale=0.55); paint_all(b, "#9A9A9A")
ab.log("sofas done")
