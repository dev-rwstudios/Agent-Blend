"""Headless Blender with the blend-ai addon's socket server on port 9877 — a safe
stand-in for your real Blender when testing the build agent end to end.

    blender -b --factory-startup --python scripts/e2e/blender_test_server.py -- /path/to/repo
"""
import sys
import time

sys.path.insert(0, sys.argv[-1])
import bpy  # noqa: E402
from addon import dispatcher, handlers, thread_safety  # noqa: E402
from addon.server import BlenderServer  # noqa: E402

handlers.register()
bpy.ops.wm.read_homefile(use_empty=True)
thread_safety.register_timer = lambda: None  # no bpy timers in background mode; the loop below pumps the queue
BlenderServer(port=9877).start()
print("E2E SERVER READY", len(dispatcher.get_registered_commands()), "commands", flush=True)
while True:
    thread_safety._process_queue()
    time.sleep(0.005)
