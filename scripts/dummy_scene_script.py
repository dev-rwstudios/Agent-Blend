"""Dummy Blender (bpy) script for Agent-Blend.

Performs analysis on existing scene objects, reports total vertex/polygon counts,
identifies high-poly items, and creates a floating gold gem object.
"""

import bpy


def run_dummy_script():
    # 1. Analyze existing scene mesh statistics
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    total_verts = sum(len(obj.data.vertices) for obj in mesh_objects if obj.data)
    total_polys = sum(len(obj.data.polygons) for obj in mesh_objects if obj.data)

    print("=== Existing Scene Analysis ===")
    print(f"Total Mesh Objects: {len(mesh_objects)}")
    print(f"Total Vertices: {total_verts:,}")
    print(f"Total Polygons: {total_polys:,}")

    # Top 5 highest polygon objects
    sorted_objs = sorted(
        mesh_objects,
        key=lambda o: len(o.data.polygons) if o.data else 0,
        reverse=True,
    )
    print("\nTop 5 Complex Objects:")
    for obj in sorted_objs[:5]:
        poly_count = len(obj.data.polygons) if obj.data else 0
        print(f"  - {obj.name}: {poly_count:,} polygons")

    # 2. Create a dummy decorative object in the scene
    gem_name = "Dummy_Demo_Gem"
    if gem_name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[gem_name], do_unlink=True)

    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=2, radius=0.3, location=(0, 0, 2.5)
    )
    gem = bpy.context.active_object
    gem.name = gem_name

    # Add metallic gold material
    mat_name = "Dummy_Gold_Mat"
    mat = bpy.data.materials.get(mat_name)
    if not mat:
        mat = bpy.data.materials.new(name=mat_name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (1.0, 0.8, 0.2, 1.0)
            bsdf.inputs["Metallic"].default_value = 0.9
            bsdf.inputs["Roughness"].default_value = 0.2

    if gem.data.materials:
        gem.data.materials[0] = mat
    else:
        gem.data.materials.append(mat)

    print(
        f"\nSuccessfully created dummy object '{gem.name}' at location {gem.location} with material '{mat_name}'."
    )


if __name__ == "__main__":
    run_dummy_script()
