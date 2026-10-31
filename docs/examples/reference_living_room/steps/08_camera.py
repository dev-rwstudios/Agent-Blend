# Lights, world, and the camera matching the reference (about 6 m back from the portal, 40 mm lens).
H, Y1 = 2.9, 6.0
ab.world("#F3EEE8", 0.3)
import bpy
bpy.context.scene.view_settings.view_transform = "AgX"
bpy.context.scene.view_settings.exposure = -0.75
ab.light("Ceiling Fill", "AREA", at=(0, 3.0, H - 0.1), energy=260, color="#FFF1E2", size=4.0)
ab.light("TV Wall Wash", "AREA", at=(0, Y1 - 0.6, H - 0.15), energy=12, color="#FFF0E0", rot=(-90, 0, 0), size=2.0)
ab.light("Entry Fill", "AREA", at=(0, -1.0, 2.2), energy=140, color="#FFF6EC", rot=(-60, 0, 0), size=3.0)
ab.camera("Reference Camera", at=(0, -6.0, 1.45), look_at=(0, 6.0, 1.45), lens=40)
ab.log("camera set")
