"""Static UI content and formatting helpers for the chat app."""

from __future__ import annotations

import chainlit as cl
from chainlit.mode import Mode, ModeOption

# Lucide icon per tool module, for tool-call steps and the tool catalog.
MODULE_ICONS = {
    "objects": "box", "transforms": "move-3d", "modeling": "shapes", "mesh_editing": "pen-tool",
    "mesh_quality": "scan-search", "materials": "palette", "lighting": "lightbulb",
    "camera": "camera", "rendering": "clapperboard", "animation": "film", "armature": "bone",
    "physics": "atom", "geometry_nodes": "workflow", "curves": "spline", "sculpting": "brush",
    "uv": "grid-3x3", "collections": "folder-tree", "file_ops": "file-box",
    "scene": "layout-dashboard", "screenshot": "scan", "viewport": "monitor",
    "asset_library": "library", "scene_agent": "sofa", "booltool": "combine",
    "gpencil": "pencil", "code_exec": "terminal",
}

MODULE_LABELS = {
    "file_ops": "Files", "uv": "UV", "gpencil": "Grease Pencil", "code_exec": "Python",
    "booltool": "Bool Tool", "scene_agent": "Scene Agent",
}


def module_label(module: str) -> str:
    return MODULE_LABELS.get(module, module.replace("_", " ").title())


def pretty_tool_name(name: str) -> str:
    """'create_object' -> 'Create Object' — display only."""
    return name.replace("_", " ").title()


def short_args(args: dict) -> str:
    parts = []
    for k, v in args.items():
        s = repr(v)
        if len(s) > 40:
            s = s[:37] + "..."
        parts.append(f"{k}={s}")
    return ", ".join(parts)


# ---- composer modes ------------------------------------------------------

APPROACHES = [
    ModeOption(id="build", name="Build", icon="hammer", default=True,
               description="Make changes in Blender (asks before scene changes if approvals are on)."),
    ModeOption(id="plan", name="Plan first", icon="list-checks",
               description="Inspect the scene and propose a step-by-step plan for you to approve."),
    ModeOption(id="ask", name="Ask", icon="message-circle-question",
               description="Read-only: questions about the scene, never changes anything."),
]

PLAN_INSTRUCTION = (
    "[Plan mode] Before changing anything, inspect the scene as needed with read-only tools, "
    "then reply with a short numbered plan: what you will create or change, which assets or "
    "primitives, approximate sizes and positions, materials and lighting. Do not execute it — "
    "wait for approval."
)
ASK_INSTRUCTION = (
    "[Ask mode] Answer using read-only tools only (scene info, object info, screenshots, "
    "asset search). Do not modify the scene."
)


def build_modes(models: list[str], current_model: str | None, approach: str = "build") -> list[Mode]:
    modes = []
    if models:
        shown = models[:40]
        if current_model and current_model not in shown:
            shown = [current_model] + shown
        modes.append(Mode(id="model", name="Model", options=[
            ModeOption(id=m, name=m, icon="cpu", default=(m == current_model)) for m in shown
        ]))
    modes.append(Mode(id="approach", name="Approach", options=[
        ModeOption(id=o.id, name=o.name, icon=o.icon, description=o.description, default=(o.id == approach))
        for o in APPROACHES
    ]))
    return modes


# ---- composer commands ---------------------------------------------------

COMMANDS = [
    {"id": "Screenshot", "icon": "scan", "description": "Capture the Blender viewport", "button": False, "persistent": False},
    {"id": "Render", "icon": "clapperboard", "description": "Render the scene with the active camera", "button": False, "persistent": False},
    {"id": "Undo", "icon": "undo-2", "description": "Restore the scene to the previous checkpoint", "button": False, "persistent": False},
    {"id": "Export", "icon": "download", "description": "Download the scene (.blend, .glb, .fbx, ...)", "button": False, "persistent": False},
    {"id": "Tools", "icon": "wrench", "description": "Browse the tool catalog", "button": False, "persistent": False},
]


# ---- starters ------------------------------------------------------------

def starter_categories() -> list[cl.StarterCategory]:
    def s(label: str, message: str, icon: str) -> cl.Starter:
        return cl.Starter(label=label, message=message, icon=f"/public/icons/{icon}.svg")

    return [
        cl.StarterCategory(label="Model", icon="/public/icons/cube.svg", starters=[
            s("Low-poly tree", "Model a stylized low-poly tree about 3 m tall with a trunk and a faceted canopy, with simple green and brown materials.", "tree"),
            s("Stylized sword", "Model a stylized fantasy sword about 1 m long: blade, crossguard, grip and pommel, with metal and leather materials.", "sword"),
            s("Coffee mug", "Model a ceramic coffee mug at real-world scale with a proper handle, smooth shading and a glossy glaze material.", "cube"),
        ]),
        cl.StarterCategory(label="Scenes", icon="/public/icons/sofa.svg", starters=[
            s("Furnish a bedroom", "Furnish a 4 x 4 m bedroom with a bed, a nightstand with a lamp, and a rug.", "sofa"),
            s("Cozy living room", "Create a cozy living room: sofa facing a TV stand, a coffee table, a rug, a floor lamp and a plant.", "sofa"),
        ]),
        cl.StarterCategory(label="Look dev", icon="/public/icons/palette.svg", starters=[
            s("Product shot", "Set up a clean studio product shot of the selected object: seamless backdrop, three-point lighting and a camera framing it.", "camera"),
            s("Three-point lighting", "Add three-point lighting (key, fill, rim) aimed at the scene's main subject.", "light"),
            s("PBR materials", "Give every mesh in the scene a fitting PBR material based on what it is.", "palette"),
        ]),
        cl.StarterCategory(label="Animate & render", icon="/public/icons/film.svg", starters=[
            s("360° turntable", "Create a 120-frame 360° turntable animation of the scene's main subject with the camera orbiting it.", "film"),
            s("Render this view", "Render the scene from the active camera and show me the result.", "image"),
        ]),
        cl.StarterCategory(label="Inspect", icon="/public/icons/search.svg", starters=[
            s("Describe my scene", "Describe what's in my scene right now and suggest three improvements.", "search"),
            s("Check mesh quality", "Check every mesh for non-manifold edges, loose vertices and other defects, and summarize what you find.", "search"),
        ]),
    ]
