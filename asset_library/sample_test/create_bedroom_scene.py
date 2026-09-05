import bpy
import math
import os
import mathutils

# ----------------------------------------------------
# 1. SETUP CLEAN SCENE
# ----------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if "Collection" not in bpy.data.collections:
        col = bpy.data.collections.new("Collection")
        bpy.context.scene.collection.children.link(col)

reset_scene()

lib_dir = "/home/realworks/rw-dev/rw-dev-projects/Blend-MCP/Agent-Blend-main/asset_library"

def import_glb_asset(rel_path, target_location=(0,0,0), target_scale=(1,1,1), target_rotation=(0,0,0)):
    full_path = os.path.join(lib_dir, rel_path, "model.glb")
    if not os.path.exists(full_path):
        print(f"Asset path not found: {full_path}")
        return None, []
    
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=full_path)
    new_objs = [o for o in bpy.data.objects if o not in existing]
    
    if not new_objs:
        return None, []
        
    min_c = [float('inf')]*3
    max_c = [float('-inf')]*3
    mesh_objs = [o for o in new_objs if o.type == 'MESH']
    
    if mesh_objs:
        for obj in mesh_objs:
            for corner in obj.bound_box:
                w_corner = obj.matrix_world @ mathutils.Vector(corner)
                for i in range(3):
                    min_c[i] = min(min_c[i], w_corner[i])
                    max_c[i] = max(max_c[i], w_corner[i])
        
        center_x = (min_c[0] + max_c[0]) / 2.0
        center_y = (min_c[1] + max_c[1]) / 2.0
        bottom_z = min_c[2]
        
        offset = mathutils.Vector((-center_x, -center_y, -bottom_z))
        for obj in new_objs:
            if obj.parent is None:
                obj.location += offset

    anchor = bpy.data.objects.new(f"Anchor_{os.path.basename(rel_path)}", None)
    bpy.context.scene.collection.objects.link(anchor)
    for obj in new_objs:
        if obj.parent is None:
            obj.parent = anchor
            
    anchor.location = target_location
    anchor.rotation_euler = target_rotation
    anchor.scale = target_scale
    return anchor, new_objs

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderSettings') and 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'

# ----------------------------------------------------
# 2. ACCURATE MATERIALS (MATCHING REFERENCE IMAGE)
# ----------------------------------------------------
def create_material(name, color, roughness=0.5, metallic=0.0, specular=0.5, bump_scale=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    
    output = nodes.new('ShaderNodeOutputMaterial')
    principled = nodes.new('ShaderNodeBsdfPrincipled')
    principled.inputs['Base Color'].default_value = color
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Metallic'].default_value = metallic
    if 'Specular IOR Level' in principled.inputs:
        principled.inputs['Specular IOR Level'].default_value = specular
    elif 'Specular' in principled.inputs:
        principled.inputs['Specular'].default_value = specular
        
    links.new(principled.outputs['BSDF'], output.inputs['Surface'])
    
    if bump_scale > 0.0:
        tex_noise = nodes.new('ShaderNodeTexNoise')
        tex_noise.inputs['Scale'].default_value = 80.0
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value = bump_scale
        links.new(tex_noise.outputs['Factor'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], principled.inputs['Normal'])
        
    return mat

def create_emission_material(name, color, strength=5.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = color
    emission.inputs['Strength'].default_value = strength
    links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return mat

mat_yellow_wall  = create_material("YellowWallMat", (0.94, 0.74, 0.14, 1.0), roughness=0.45, bump_scale=0.010)
mat_white_wall   = create_material("WhiteWallMat", (0.94, 0.94, 0.93, 1.0), roughness=0.35)
mat_marble_floor = create_material("MarbleFloorMat", (0.84, 0.81, 0.76, 1.0), roughness=0.12, specular=0.85)
mat_dark_wood    = create_material("DarkWoodMat", (0.18, 0.10, 0.05, 1.0), roughness=0.28)
mat_teal_fabric  = create_material("TealFabricMat", (0.08, 0.38, 0.48, 1.0), roughness=0.65)
mat_maroon_sheet = create_material("MaroonSheetMat", (0.38, 0.14, 0.18, 1.0), roughness=0.55)
mat_white_fabric = create_material("WhiteFabricMat", (0.96, 0.96, 0.96, 1.0), roughness=0.5)
mat_grey_fabric  = create_material("GreyFabricMat", (0.22, 0.26, 0.30, 1.0), roughness=0.6)
mat_gold         = create_material("GoldMat", (0.88, 0.70, 0.28, 1.0), roughness=0.2, metallic=0.9)
mat_mirror       = create_material("MirrorMat", (0.96, 0.96, 0.96, 1.0), roughness=0.01, metallic=1.0)
mat_cove_light   = create_emission_material("CoveLightMat", (1.0, 0.94, 0.82, 1.0), strength=12.0)
mat_lamp_glow    = create_emission_material("LampGlowMat", (1.0, 0.90, 0.70, 1.0), strength=6.0)

# ----------------------------------------------------
# 3. ROOM ARCHITECTURE
# ----------------------------------------------------
# Floor
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0.5, 0))
floor = bpy.context.active_object
floor.name = "Floor"
floor.scale = (5.2, 4.8, 1)
floor.data.materials.append(mat_marble_floor)

# Back Wall (Rich Mustard Yellow)
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 2.5, 1.5), rotation=(math.radians(90), 0, 0))
back_wall = bpy.context.active_object
back_wall.name = "BackWall_Yellow"
back_wall.scale = (5.2, 3.0, 1)
back_wall.data.materials.append(mat_yellow_wall)

# Left Wall
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(-2.6, 0.5, 1.5), rotation=(0, math.radians(90), 0))
left_wall = bpy.context.active_object
left_wall.name = "LeftWall"
left_wall.scale = (4.8, 3.0, 1)
left_wall.data.materials.append(mat_white_wall)

# Right Wall
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(2.6, 0.5, 1.5), rotation=(0, math.radians(-90), 0))
right_wall = bpy.context.active_object
right_wall.name = "RightWall"
right_wall.scale = (4.8, 3.0, 1)
right_wall.data.materials.append(mat_white_wall)

# Ceiling & Recessed Tray Cove Light
bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0.5, 3.0), rotation=(math.radians(180), 0, 0))
ceiling = bpy.context.active_object
ceiling.name = "MainCeiling"
ceiling.scale = (5.2, 4.8, 1)
ceiling.data.materials.append(mat_white_wall)

# Recessed Ceiling Inset
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0.6, 2.94))
tray = bpy.context.active_object
tray.name = "RecessedCeilingTray"
tray.scale = (4.0, 3.4, 0.08)
tray.data.materials.append(mat_white_wall)

# Cove Light Emission Strip
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0.6, 2.89))
cove_strip = bpy.context.active_object
cove_strip.name = "CoveLightStrip"
cove_strip.scale = (4.1, 3.5, 0.02)
cove_strip.data.materials.append(mat_cove_light)

# Top Moulding Trim
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 2.48, 2.96))
moulding = bpy.context.active_object
moulding.name = "CrownMoulding_Back"
moulding.scale = (5.2, 0.04, 0.06)
moulding.data.materials.append(mat_white_wall)

# Ceiling Fan
bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=0.08, location=(0, 0.6, 2.84))
fan_base = bpy.context.active_object
fan_base.name = "CeilingFan_Base"
fan_base.data.materials.append(mat_white_wall)

for i in range(4):
    angle = i * (math.pi / 2)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.42 * math.cos(angle), 0.6 + 0.42 * math.sin(angle), 2.84))
    blade = bpy.context.active_object
    blade.name = f"FanBlade_{i}"
    blade.rotation_euler = (0, 0, angle)
    blade.scale = (0.55, 0.08, 0.01)
    blade.data.materials.append(mat_white_wall)

# ----------------------------------------------------
# 4. BED FRAME, TUFTED HEADBOARD & BEDDING
# ----------------------------------------------------
bed_anchor, bed_objs = import_glb_asset("bed/bed_frame_02", target_location=(0, 1.12, 0.0), target_scale=(1.05, 1.05, 1.0))
if bed_objs:
    for o in bed_objs:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(mat_dark_wood)

hb_anchor, hb_objs = import_glb_asset("bed/headboard", target_location=(0, 2.15, 0.52), target_scale=(1.14, 2.2, 1.1))
if hb_objs:
    for o in hb_objs:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(mat_teal_fabric)

# Headboard Tufting Buttons
for row in range(3):
    for col in range(7):
        bx = -0.88 + col * 0.29
        bz = 0.62 + row * 0.22
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=(bx, 2.05, bz))
        btn = bpy.context.active_object
        btn.name = f"HeadboardButton_{row}_{col}"
        btn.data.materials.append(mat_teal_fabric)

# Bedsheet & Cover
sheet_anchor, sheet_objs = import_glb_asset("soft_furnishing/bedsheet_02", target_location=(0, 1.12, 0.25), target_scale=(1.05, 1.0, 0.8))
if sheet_objs:
    for o in sheet_objs:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(mat_maroon_sheet)

cover_anchor, cover_objs = import_glb_asset("soft_furnishing/bed_cover_01", target_location=(0, 0.72, 0.28), target_scale=(1.08, 1.0, 0.8))
if cover_objs:
    for o in cover_objs:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(mat_maroon_sheet)

# Pillow Set & Patterned Accent Pillows
import_glb_asset("soft_furnishing/pillow_set_01", target_location=(0, 1.88, 0.44), target_scale=(1.25, 1.0, 1.0))
import_glb_asset("soft_furnishing/patterned_pillow_01", target_location=(-0.42, 1.62, 0.52), target_scale=(1.1, 1.1, 1.1))
import_glb_asset("soft_furnishing/patterned_pillow_01", target_location=(0.42, 1.62, 0.52), target_scale=(1.1, 1.1, 1.1))

# Bolster Cushion
bpy.ops.mesh.primitive_cylinder_add(radius=0.10, depth=1.55, location=(0, 1.95, 0.56), rotation=(0, math.radians(90), 0))
bolster = bpy.context.active_object
bolster.name = "BolsterPillow"
bolster.data.materials.append(mat_grey_fabric)

# ----------------------------------------------------
# 5. NIGHTSTANDS & TABLE LAMPS
# ----------------------------------------------------
for side_x, prefix in [(-1.38, "Left"), (1.38, "Right")]:
    ns_anchor, ns_objs = import_glb_asset("table/modern_bedside_table", target_location=(side_x, 1.92, 0.0), target_scale=(1.1, 0.95, 1.0))
    if ns_objs:
        for o in ns_objs:
            if o.type == 'MESH':
                o.data.materials.clear()
                o.data.materials.append(mat_dark_wood)
                
    # Lamp Base (Teal Blue Ceramic)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(side_x, 1.88, 0.68))
    lamp_base = bpy.context.active_object
    lamp_base.name = f"LampBase_{prefix}"
    lamp_base.scale = (1.0, 1.0, 1.35)
    lamp_base.data.materials.append(mat_teal_fabric)
    
    # Glowing Lamp Shade
    bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.34, location=(side_x, 1.88, 0.98))
    shade = bpy.context.active_object
    shade.name = f"LampShade_{prefix}"
    shade.data.materials.append(mat_lamp_glow)
    
    # Soft Warm Lamp Light spread (120W Warm Soft Point Light)
    light_data = bpy.data.lights.new(name=f"LampLight_{prefix}", type='POINT')
    light_data.energy = 120.0
    light_data.color = (1.0, 0.88, 0.65)
    light_data.shadow_soft_size = 0.3
    light_obj = bpy.data.objects.new(f"LampLight_{prefix}", light_data)
    light_obj.location = (side_x, 1.88, 0.96)
    bpy.context.scene.collection.objects.link(light_obj)

# Books on Nightstands
import_glb_asset("decor/books_stack", target_location=(1.25, 1.88, 0.54), target_scale=(0.8, 0.8, 0.8))
import_glb_asset("decor/art_book", target_location=(-1.25, 1.88, 0.54), target_scale=(0.8, 0.8, 0.8))

# ----------------------------------------------------
# 6. WARDROBE (RIGHT WALL)
# ----------------------------------------------------
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.08, 1.15, 1.5))
wardrobe = bpy.context.active_object
wardrobe.name = "Wardrobe_Body"
wardrobe.scale = (0.88, 2.65, 3.0)
wardrobe.data.materials.append(mat_dark_wood)

for door_y in [0.2, 0.8, 1.4, 2.0]:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(1.62, door_y - 0.2, 1.4))
    door_handle = bpy.context.active_object
    door_handle.name = f"WardrobeHandle_{door_y}"
    door_handle.scale = (0.02, 0.03, 0.38)
    door_handle.data.materials.append(mat_gold)

for shelf_z in [0.6, 1.1, 1.6, 2.1, 2.6]:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(1.63, -0.05, shelf_z))
    shelf = bpy.context.active_object
    shelf.name = f"WardrobeShelf_{shelf_z}"
    shelf.scale = (0.02, 0.36, 0.02)
    shelf.data.materials.append(mat_dark_wood)

# ----------------------------------------------------
# 7. BANANA PLANT (LEFT SIDE)
# ----------------------------------------------------
import_glb_asset("decor/banana_plant", target_location=(-1.95, 1.72, 0.0), target_scale=(1.4, 1.4, 1.4))

bpy.ops.mesh.primitive_cylinder_add(radius=0.24, depth=0.52, location=(-1.95, 1.72, 0.26))
pot_base = bpy.context.active_object
pot_base.name = "BananaPlant_PotBase"
pot_base.data.materials.append(mat_white_wall)

# ----------------------------------------------------
# 8. RUG & WINDOW CURTAINS
# ----------------------------------------------------
import_glb_asset("rug/carpet_square", target_location=(0, 0.5, 0.005), target_scale=(0.85, 0.55, 0.1))
import_glb_asset("window_treatment/curtain", target_location=(-2.45, 0.8, 0.0), target_scale=(1.0, 0.75, 1.0))

# ----------------------------------------------------
# 9. PERFECT CIRCULAR ROUND MIRROR & WALL ART (5 FRAMES)
# ----------------------------------------------------
# Exact Circular Round Wall Mirror with Woven Wood Outer Ring (Positioned at X=1.20, Y=2.47, Z=2.05)
bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.03, location=(1.20, 2.47, 2.05), rotation=(math.radians(90), 0, 0))
mirror_outer_frame = bpy.context.active_object
mirror_outer_frame.name = "RoundMirror_OuterFrame"
mirror_outer_frame.data.materials.append(mat_dark_wood)

bpy.ops.mesh.primitive_torus_add(major_radius=0.28, minor_radius=0.025, location=(1.20, 2.46, 2.05), rotation=(math.radians(90), 0, 0))
mirror_woven_ring = bpy.context.active_object
mirror_woven_ring.name = "RoundMirror_WovenRing"
mirror_woven_ring.data.materials.append(mat_dark_wood)

bpy.ops.mesh.primitive_cylinder_add(radius=0.24, depth=0.015, location=(1.20, 2.45, 2.05), rotation=(math.radians(90), 0, 0))
mirror_glass_pane = bpy.context.active_object
mirror_glass_pane.name = "RoundMirror_GlassPane"
mirror_glass_pane.data.materials.append(mat_mirror)

# 5 Wall Paintings
art_colors = [
    (0.94, 0.82, 0.30, 1.0), # Gold abstract
    (0.18, 0.60, 0.70, 1.0), # Teal abstract
    (0.80, 0.38, 0.48, 1.0), # Rose floral
    (0.35, 0.70, 0.45, 1.0), # Green abstract
    (0.90, 0.48, 0.38, 1.0)  # Orange geometric
]

# Top 3 Frames
top_x_positions = [-0.48, 0.0, 0.48]
for idx, x_pos in enumerate(top_x_positions):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x_pos, 2.48, 2.25))
    frame = bpy.context.active_object
    frame.name = f"ArtFrame_Top_{idx}"
    frame.scale = (0.36, 0.04, 0.46)
    frame.data.materials.append(mat_dark_wood)
    
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(x_pos, 2.45, 2.25), rotation=(math.radians(90), 0, 0))
    canvas = bpy.context.active_object
    canvas.name = f"ArtCanvas_Top_{idx}"
    canvas.scale = (0.30, 0.40, 1.0)
    mat_art = create_material(f"ArtMat_Top_{idx}", art_colors[idx], roughness=0.3)
    canvas.data.materials.append(mat_art)

# Bottom 2 Frames
bottom_x_positions = [-0.24, 0.24]
for idx, x_pos in enumerate(bottom_x_positions):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x_pos, 2.48, 1.72))
    frame = bpy.context.active_object
    frame.name = f"ArtFrame_Bottom_{idx}"
    frame.scale = (0.36, 0.04, 0.46)
    frame.data.materials.append(mat_dark_wood)
    
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(x_pos, 2.45, 1.72), rotation=(math.radians(90), 0, 0))
    canvas = bpy.context.active_object
    canvas.name = f"ArtCanvas_Bottom_{idx}"
    canvas.scale = (0.30, 0.40, 1.0)
    mat_art = create_material(f"ArtMat_Bottom_{idx}", art_colors[idx + 3], roughness=0.3)
    canvas.data.materials.append(mat_art)

# Hanging Planter (Macrame Rope + White Pot + Cascading Leaves)
bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.85, location=(-1.55, 1.75, 2.45))
rope = bpy.context.active_object
rope.name = "HangingPlanter_Rope"
rope.data.materials.append(mat_gold)

bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=0.22, location=(-1.55, 1.75, 1.98))
h_pot = bpy.context.active_object
h_pot.name = "HangingPlanter_Pot"
h_pot.data.materials.append(mat_white_wall)

mat_h_leaf = create_material("HangingLeafMat", (0.15, 0.52, 0.20, 1.0), roughness=0.4)
for leaf_i in range(6):
    angle = leaf_i * (math.pi / 3)
    bpy.ops.mesh.primitive_cone_add(radius1=0.12, depth=0.4, location=(-1.55 + 0.08*math.cos(angle), 1.75 + 0.08*math.sin(angle), 1.82))
    h_leaf = bpy.context.active_object
    h_leaf.name = f"HangingLeaf_{leaf_i}"
    h_leaf.rotation_euler = (math.radians(45)*math.sin(angle), math.radians(45)*math.cos(angle), angle)
    h_leaf.data.materials.append(mat_h_leaf)

# ----------------------------------------------------
# 10. CAMERA & LIGHTING RIG
# ----------------------------------------------------
cam_data = bpy.data.cameras.new("FrontCamera")
cam_data.lens = 30.0
cam_obj = bpy.data.objects.new("FrontCamera", cam_data)
cam_obj.location = (0.0, -2.85, 1.25)
cam_obj.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.collection.objects.link(cam_obj)
bpy.context.scene.camera = cam_obj

# Soft Broad Warm Interior Fill
fill_light_data = bpy.data.lights.new(name="WarmNightFill", type='AREA')
fill_light_data.energy = 250.0
fill_light_data.color = (1.0, 0.90, 0.72)
fill_light_data.size = 4.0
fill_light_obj = bpy.data.objects.new("WarmNightFill", fill_light_data)
fill_light_obj.location = (0.0, -0.5, 2.6)
fill_light_obj.rotation_euler = (math.radians(45), 0, 0)
bpy.context.scene.collection.objects.link(fill_light_obj)

# Wide Warm Wall Spotlight
spot_data = bpy.data.lights.new(name="WallSpot", type='SPOT')
spot_data.energy = 280.0
spot_data.color = (1.0, 0.88, 0.65)
spot_data.spot_size = math.radians(110)
spot_data.spot_blend = 0.8
spot_obj = bpy.data.objects.new("WallSpot", spot_data)
spot_obj.location = (0.0, -0.2, 2.7)
spot_obj.rotation_euler = (math.radians(35), 0, 0)
bpy.context.scene.collection.objects.link(spot_obj)

# Night World Environment
if bpy.context.scene.world is None:
    bpy.context.scene.world = bpy.data.worlds.new("World")
bpy.context.scene.world.use_nodes = True
bg_node = bpy.context.scene.world.node_tree.nodes.get('Background')
if bg_node:
    bg_node.inputs['Color'].default_value = (0.08, 0.09, 0.12, 1.0)
    bg_node.inputs['Strength'].default_value = 0.8

# Render scene & Save .blend file
output_path = "/home/realworks/.gemini/antigravity-ide/brain/41f9fb1c-d815-417d-847b-1d2a9f779c12/bedroom_scene_render.png"
blend_path = "/home/realworks/rw-dev/rw-dev-projects/Blend-MCP/Agent-Blend-main/bedroom_scene.blend"
bpy.context.scene.render.filepath = output_path
bpy.context.scene.render.resolution_x = 1280
bpy.context.scene.render.resolution_y = 720
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"Render complete: {output_path}")
print(f"Blend file saved: {blend_path}")
