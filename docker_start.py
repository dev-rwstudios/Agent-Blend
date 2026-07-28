import sys
from pathlib import Path
import zipfile
import bpy

print("--- Running Docker Blender Startup Script ---")

# 1. Package the addon folder into a zip file
addon_dir = Path("/app/addon")
zip_path = Path("/app/blend-ai.zip")
print(f"Zipping addon from {addon_dir} to {zip_path}...")

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(addon_dir.rglob("*")):
        if f.is_file() and not f.name.endswith('.pyc') and '__pycache__' not in f.parts:
            zf.write(f, f.relative_to(addon_dir))

# 2. Sideload and enable the extension in Blender
print("Installing blend-ai extension...")
try:
    bpy.ops.extensions.package_install_files(
        filepath=str(zip_path),
        repo='user_default',
        enable_on_install=True,
    )
    bpy.ops.wm.save_userpref()
    print("Addon installed and enabled successfully!")
except Exception as e:
    print(f"Error installing extension: {e}")
    sys.exit(1)

# 3. Start the TCP server inside Blender
print("Starting blend-ai TCP server on port 9876...")
try:
    import bl_ext.user_default.blend_ai.server as addon_server
    addon_server.start_server(host="127.0.0.1", port=9876)
    print("Server started! Listening for connection on 127.0.0.1:9876.")
except Exception as e:
    print(f"Failed to start TCP server: {e}")
    sys.exit(1)
