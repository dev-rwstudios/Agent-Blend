"""Direct Blender operations the UI performs on the user's behalf.

These call blend-ai's tool functions (or the addon connection) directly
instead of going through the model's tool loop: a click on "Add to scene" or
"Restore checkpoint" is the user's own action, so it neither costs a model
round trip nor needs approval. All functions are synchronous and blocking —
call them through cl.make_async. The shared BlenderConnection serializes
access with its own lock, so these are safe to run while a chat turn is in
progress on another thread.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from blend_ai import server as srv
from blend_ai.asset_catalog import get_catalog
from blend_ai.connection import BlenderConnectionError

EXPORT_FORMATS = {
    "blend": "Blender file (.blend)",
    "glb": "glTF binary (.glb)",
    "fbx": "FBX (.fbx)",
    "obj": "Wavefront OBJ (.obj)",
    "usdz": "USDZ (.usdz)",
    "stl": "STL (.stl)",
}


class BlenderOpError(Exception):
    pass


def _command(command: str, params: dict[str, Any] | None = None) -> Any:
    conn = srv._connection
    if conn is None:
        raise BlenderOpError("Not connected to Blender.")
    try:
        response = conn.send_command(command, params or {})
    except BlenderConnectionError as e:
        raise BlenderOpError(str(e)) from e
    if response.get("status") == "error":
        raise BlenderOpError(str(response.get("result")))
    return response.get("result")


def capture_viewport(max_size: int = 900) -> str | None:
    """Fast OpenGL capture of the 3D viewport as a data: URI, or None."""
    width = max_size
    height = int(max_size * 9 / 16)
    try:
        result = _command("fast_viewport_capture", {"width": width, "height": height})
    except BlenderOpError:
        return None
    image = result.get("image") if isinstance(result, dict) else None
    return f"data:image/png;base64,{image}" if image else None


def scene_summary() -> dict[str, Any]:
    info = _command("get_scene_info")
    raw = {o["name"]: o for o in info.get("objects", [])}
    # Depth-first so each parent is directly followed by its children.
    objects: list[dict[str, Any]] = []

    def visit(name: str, depth: int) -> None:
        o = raw[name]
        children = sorted(c for c in o.get("children", []) if c in raw)
        objects.append({
            "name": name, "type": o["type"], "depth": depth,
            "parent": o.get("parent"), "children": len(children),
            "visible": o.get("visible", True),
        })
        for child in children:
            visit(child, depth + 1)

    for name in sorted(n for n, o in raw.items() if not o.get("parent") or o["parent"] not in raw):
        visit(name, 0)
    return {
        "scene": info.get("scene_name", "Scene"),
        "engine": info.get("render_engine", ""),
        "counts": info.get("type_counts", {}),
        "objects": objects,
    }


def focus_object(name: str) -> None:
    _command("focus_on_object", {"object_name": name})


def list_assets() -> list[dict[str, Any]]:
    assets = []
    for asset in get_catalog().all():
        s = asset.summary()
        assets.append({
            "id": s["id"],
            "name": s["name"],
            "label": s["name"].replace("_", " ").strip().capitalize(),
            "category": s["category"],
            "tags": (s["style_tags"] + s["room_types"])[:4],
            "dims": s["dimensions_m"],
        })
    return sorted(assets, key=lambda a: (a["category"], a["name"]))


def import_asset(asset_id: str) -> dict[str, Any]:
    from blend_ai.tools.asset_library import import_asset as _import_asset
    try:
        return _import_asset(asset_id=asset_id)
    except Exception as e:  # noqa: BLE001 — validation and Blender errors alike go to the user
        raise BlenderOpError(str(e)) from e


def render_to(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    _command("render_image", {"filepath": str(path)})
    return path


def export_to(path: Path, fmt: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "blend":
        save_copy(path)
    else:
        _command("export_file", {"filepath": str(path)})  # format comes from the extension
    return path


def save_copy(path: Path) -> None:
    """Save a copy of the open scene without changing Blender's current file.

    Uses the addon's save_checkpoint command; addon builds from before it
    existed get the same operation through the sandboxed code runner.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        _command("save_checkpoint", {"filepath": str(path)})
        return
    except BlenderOpError as e:
        if "Unknown command" not in str(e):
            raise
    code = (
        "import bpy\n"
        f"bpy.ops.wm.save_as_mainfile(filepath={json.dumps(str(path))}, copy=True, compress=True)\n"
    )
    _command("execute_code", {"code": code})


def open_blend(path: Path) -> None:
    _command("open_file", {"filepath": str(path)})


def read_image_data_uri(path: Path) -> str | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    mime = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
