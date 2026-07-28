#!/bin/bash
set -e

echo "Starting virtual frame buffer Xvfb on display :99..."
# Start Xvfb in the background
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

sleep 1

echo "Starting Blender inside virtual frame buffer..."
# Run Blender (with GUI so viewport screenshots and EEVEE rendering work)
blender --python /app/docker_start.py &
BLENDER_PID=$!

wait_for_blender() {
    echo "Waiting for Blender TCP server to start on port 9876..."
    for i in {1..30}; do
        if nc -z 127.0.0.1 9876; then
            echo "Blender TCP server is ready!"
            return 0
        fi
        sleep 1
    done
    echo "Error: Blender TCP server failed to start within 30 seconds."
    return 1
}

wait_for_blender

cleanup() {
    echo "Shutting down Blender..."
    kill $BLENDER_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting MCP Server..."
exec uv run blend-ai
