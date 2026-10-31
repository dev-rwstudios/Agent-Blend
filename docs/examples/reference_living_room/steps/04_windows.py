# Two windows with horizontal shutters, and a potted plant in front of each.
Y1 = 6.0
WHITE = "#EDE6DA"
for sgn in (-1, 1):
    wx = sgn * 2.05
    win = ab.asset("door_window/window", name="Window", at=(wx, Y1 - 0.06, 0.8), rot=90)
    win.scale = (1.0, 0.55, 0.84)                           # ~0.85 m wide, ~1.5 m tall
    for part in win.children_recursive:
        ab.paint(part, "#6F7377", roughness=0.2)
    ab.box("Window Frame Top", (0.95, 0.07, 0.05), at=(wx, Y1 - 0.035, 2.3), color=WHITE)
    ab.box("Window Frame Bottom", (0.95, 0.09, 0.05), at=(wx, Y1 - 0.045, 0.78), color=WHITE)
    for fx in (-0.46, 0.46):
        ab.box("Window Frame Side", (0.04, 0.07, 1.55), at=(wx + fx, Y1 - 0.035, 0.78), color=WHITE)
    slat = ab.box("Shutter Slat", (0.86, 0.03, 0.08), at=(wx, Y1 - 0.1, 0.84), rot=(-28, 0, 0), color="#D9DADB")
    ab.array(slat, 18, (0, 0, 0.08))
    plant = ab.asset("decor/banana_plant", name="Plant", at=(sgn * 2.2, Y1 - 0.4, 0), scale=1.2)
ab.log("windows done")
