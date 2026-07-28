"""Blender N-panel UI for blend-ai server control."""

import bpy
import addon_utils

from . import server as addon_server


class BLENDAI_PT_MainPanel(bpy.types.Panel):
    """blend-ai MCP Server Control Panel"""
    bl_label = "blend-ai"
    bl_idname = "BLENDAI_PT_main_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "blend-ai"

    def draw(self, context):
        layout = self.layout
        srv = addon_server.get_server()

        # -------------------------------------------------------------
        # Section 1: Server Status
        # -------------------------------------------------------------
        box = layout.box()
        box.label(text="Server Connection", icon="WORLD")
        
        if srv.is_running:
            port = srv._port
            box.label(text=f"Status: Running (port {port})", icon="CHECKMARK")
            box.operator("blendai.stop_server", text="Stop Server", icon="CANCEL")
        else:
            box.label(text="Status: Stopped", icon="X")
            box.prop(context.scene, "blendai_port", text="Port")
            box.operator("blendai.start_server", text="Start Server", icon="PLAY")

        layout.separator()

        # -------------------------------------------------------------
        # Section 2: Extensions Status
        # -------------------------------------------------------------
        ext_box = layout.box()
        ext_box.label(text="Design Extensions", icon="PREFERENCES")

        enabled_addons = bpy.context.preferences.addons.keys()

        # Node Wrangler
        nw_enabled = "node_wrangler" in enabled_addons
        row = ext_box.row()
        row.label(text="Node Wrangler", icon="CHECKMARK" if nw_enabled else "X")
        if not nw_enabled:
            op = row.operator("blendai.enable_addon", text="Enable", icon="ADD")
            op.module_name = "node_wrangler"

        # Archimesh
        arch_module = "bl_ext.blender_org.archimesh"
        arch_enabled = arch_module in enabled_addons
        row2 = ext_box.row()
        row2.label(text="Archimesh", icon="CHECKMARK" if arch_enabled else "X")
        if not arch_enabled:
            op = row2.operator("blendai.enable_addon", text="Enable", icon="ADD")
            op.module_name = arch_module



class BLENDAI_OT_StartServer(bpy.types.Operator):
    """Start the blend-ai MCP server"""
    bl_idname = "blendai.start_server"
    bl_label = "Start blend-ai Server"

    def execute(self, context):
        port = context.scene.blendai_port
        addon_server.start_server(port=port)
        self.report({"INFO"}, f"blend-ai server started on 127.0.0.1:{port}")
        return {"FINISHED"}


class BLENDAI_OT_StopServer(bpy.types.Operator):
    """Stop the blend-ai MCP server"""
    bl_idname = "blendai.stop_server"
    bl_label = "Stop blend-ai Server"

    def execute(self, context):
        addon_server.stop_server()
        self.report({"INFO"}, "blend-ai server stopped")
        return {"FINISHED"}


class BLENDAI_OT_EnableAddon(bpy.types.Operator):
    """Enable a specified Blender addon"""
    bl_idname = "blendai.enable_addon"
    bl_label = "Enable Addon"
    
    module_name: bpy.props.StringProperty()

    def execute(self, context):
        try:
            addon_utils.enable(self.module_name, default_set=True)
            bpy.ops.wm.save_userpref()
            self.report({"INFO"}, f"Addon '{self.module_name}' enabled successfully.")
            return {"FINISHED"}
        except Exception as e:
            self.report({"ERROR"}, f"Failed to enable '{self.module_name}': {str(e)}")
            return {"CANCELLED"}


classes = (
    BLENDAI_PT_MainPanel,
    BLENDAI_OT_StartServer,
    BLENDAI_OT_StopServer,
    BLENDAI_OT_EnableAddon,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)

    bpy.types.Scene.blendai_port = bpy.props.IntProperty(
        name="Port",
        description="TCP port for the blend-ai server",
        default=9876,
        min=1024,
        max=65535,
    )


def unregister():
    if hasattr(bpy.types.Scene, "blendai_port"):
        del bpy.types.Scene.blendai_port

    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
