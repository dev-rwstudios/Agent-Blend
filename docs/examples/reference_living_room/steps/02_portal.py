# Wooden portal frame at the front (top beam, right pillar) and the open shelving column on the left, with decor.
X0, X1, H = -2.6, 2.6, 2.9
OAK, OAK2, OAK3, WHITE = "#B98C5E", "#9E7347", "#CBA375", "#EDE6DA"
ab.box("Portal Beam", (5.2, 0.22, 0.15), at=(0, 0.06, 2.75), color=OAK)
ab.box("Portal Pillar", (0.16, 0.22, 2.75), at=(2.23, 0.06, 0), color=OAK2)
ab.box("Front Wall Left", (0.18, 0.22, 2.9), at=(-2.51, 0.06, 0), color=WHITE)
ab.box("Front Wall Right", (0.29, 0.22, 2.9), at=(2.455, 0.06, 0), color=WHITE)

# shelving column x -2.6..-1.8, open toward the camera (-y)
ab.box("Shelf Side Outer", (0.04, 0.45, 2.75), at=(-2.40, 0.175, 0), color=OAK)
ab.box("Shelf Side Inner", (0.04, 0.45, 2.75), at=(-1.72, 0.175, 0), color=OAK)
levels = [0.08, 0.60, 1.12, 1.64, 2.16, 2.58]
for i, z in enumerate(levels):
    ab.box(f"Shelf Board {i+1}", (0.68, 0.43, 0.03), at=(-2.06, 0.165, z), color=OAK)
tops = [z + 0.03 for z in levels]

# books: rows of upright books of varied size/color
rng = ab.rng(4)
palette = ["#2F3B4A", "#7A4B3A", "#C9B98F", "#3F5D4A", "#8A8A86", "#B5483A", "#E4DDCB", "#4A4A55"]
def book_row(level, x_start, count, x_end=-1.75):
    x = x_start
    for _ in range(count):
        w, h = rng.uniform(0.025, 0.05), rng.uniform(0.20, 0.30)
        if x + w > x_end:
            break
        ab.box("Book", (w, 0.2, h), at=(x + w / 2, 0.17, tops[level]), color=rng.choice(palette))
        x += w + 0.002
book_row(3, -2.37, 12)        # 4th shelf from bottom
book_row(1, -2.37, 9)
# sculptures (teal) and brass
teal = ab.material("Teal", "#2E8B8B", roughness=0.35)
t1 = ab.torus("Sculpture Ring", 0.07, 0.022, at=(-2.12, 0.17, tops[4] + 0.07), rot=(90, 0, 20)); ab.paint(t1, teal)
s2 = ab.sphere("Sculpture Orb", 0.06, at=(-1.92, 0.17, tops[2]), color=teal)
s3 = ab.sphere("Sculpture Base", 0.045, at=(-2.22, 0.17, tops[2]), squash=(1, 1, 1.4)); ab.paint(s3, teal)
ab.sphere("Brass Orb", 0.11, at=(-2.06, 0.17, tops[0]), color="#C6A04C")
ab.box("Small Frame", (0.2, 0.02, 0.26), at=(-2.18, 0.3, tops[4]), rot=(0, 0, 0), color="#1B1B1B")
ab.box("Small Frame Picture", (0.17, 0.005, 0.23), at=(-2.18, 0.288, tops[4] + 0.015), color="#D8D5CE")
ab.log("portal done")
# library assets on the shelves
ab.asset("decor/stack_of_books", name="Books Stack", at=(-1.88, 0.17, tops[4]), rot=15)
ab.asset("decor/venus_de_milo_sculpture", name="Statuette", at=(-2.3, 0.17, tops[2]))
ab.asset("decor/design_book", name="Flat Book", at=(-2.06, 0.17, tops[1]), rot=-10)
