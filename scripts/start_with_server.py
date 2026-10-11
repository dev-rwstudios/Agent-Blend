import bpy

def run():
    print("Agent-Blend: Starting server...")
    try:
        bpy.ops.blendai.start_server()
        print("Agent-Blend: Server started successfully on 127.0.0.1:9876")
    except Exception as e:
        print("Failed to start server via operator:", e)

bpy.app.timers.register(run, first_interval=0.5)
