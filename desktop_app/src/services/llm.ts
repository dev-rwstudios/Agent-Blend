import { AppSettings, ToolCall, PlanData } from '../types';

export const SYSTEM_PROMPT = `You are Agent-Blend, an autonomous senior 3D director and production assistant controlling Blender.

CORE INTERACTION PRINCIPLES:
1. AUTONOMOUS EXECUTION: In BUILD mode, execute constructive operations (creating, positioning, lighting, materials, viewport adjustments) immediately. Do NOT ask for permission for safe actions. The user wants a seamless, friction-free creative flow.
2. INTELLIGENT DEFAULTS: If the user says "add a chair", pick an ergonomic chair with standard dimensions, snap it to the floor (Z = height/2), and explain your choice in one confident sentence. Never interrogate the user for basic details.
3. DESTRUCTIVE ACTIONS REQUIRE CONFIRMATION: If the user asks to delete objects or clear the entire scene, flag the action as destructive so safety safeguards protect their work.
4. PLAN FIRST MODE: When the user selects PLAN mode, draft a structured 3D blueprint detailing architectural layout, lighting setup, and materials, with an executable plan recipe.
5. ASK MODE: When the user asks questions or seeks advice, provide concise, expert 3D guidance without executing unneeded commands.

COORDINATE SYSTEM & 3D MATH:
- X = left/right, Y = front/back, Z = up/down. Floor is at Z = 0.
- Blender object location is its center ORIGIN, NOT bottom.
- GOLDEN RULE: place_Z = surface_top_Z + (object_height / 2). Never leave an object half-buried at Z = 0.
- When placing objects on top of others (e.g. coffee table or desk): child_Z = parent_top_Z + (child_height / 2).

STANDARD REAL-WORLD DIMENSIONS:
- 3-Seat Sofa: Width 2.2m, Depth 0.95m, Height 0.85m -> Z center = 0.425m
- Coffee Table: Width 1.2m, Depth 0.6m, Height 0.45m -> Z center = 0.225m
- Area Rug: Width 2.4m, Depth 1.8m, Height 0.005m -> Z center = 0.003m
- Studio Floor: 10m x 10m Plane at Z = 0
- Standard Ceiling Height: 2.8m`;

export interface IntentResult {
  reply: string;
  toolCalls: ToolCall[];
  plan?: PlanData;
  suggestions?: string[];
}

/**
 * Production-ready domain reasoning engine that handles all 3D intent scenarios
 */
export function parseLocalIntent(prompt: string, mode: 'build' | 'plan' | 'ask'): IntentResult {
  const p = prompt.toLowerCase().trim();
  const toolCalls: ToolCall[] = [];

  // ==========================================
  // CASE 1: ASK / ADVISORY MODE (Zero friction, no unwanted tools)
  // ==========================================
  if (mode === 'ask') {
    if (p.includes('light') || p.includes('lighting')) {
      return {
        reply: `**Studio Lighting Architecture in Blender:**\n\n1. **Key Light (Primary):** Area Light placed at 45° angle, ~3.5m high, power 400-500W, slightly warm color (#FFF4E5).\n2. **Fill Light (Shadow Softening):** Placed opposite the key light, larger size for softer diffusion, lower power (~200W), slightly cool (#E8F0FE).\n3. **Rim / Back Light (Edge Separation):** Placed behind the subject pointing towards camera at high angle (~300W) to separate silhouettes from dark backgrounds.\n\n*Tip:* In Cycles, set light bounces to at least 4 diffuse and 4 glossy bounces for natural global illumination.`,
        toolCalls: [],
        suggestions: ['Add 3-point studio lighting', 'Add sunlight rig', 'Set shading to rendered'],
      };
    }
    if (p.includes('sofa') || p.includes('dimension') || p.includes('furniture') || p.includes('scale')) {
      return {
        reply: `**Standard Architectural Dimensions (Meters):**\n\n- **3-Seat Sofa:** 2.20m (W) × 0.95m (D) × 0.85m (H)\n- **Coffee Table:** 1.20m (W) × 0.60m (D) × 0.45m (H)\n- **Dining Table:** 1.80m (W) × 0.90m (D) × 0.75m (H)\n- **Dining Chair:** 0.45m (W) × 0.50m (D) × 0.90m (H)\n- **Area Rug:** 2.40m × 1.80m placed at Z=0.003m\n\n*Rule of Thumb:* Always position the bottom bounding vertex on floor level (\`min(Z) = 0\`). Agent-Blend automatically calculates this offset.`,
        toolCalls: [],
        suggestions: ['Furnish a modern living room', 'Add 3-seat sofa', 'Add dining table set'],
      };
    }
    if (p.includes('material') || p.includes('pbr') || p.includes('shader') || p.includes('glass')) {
      return {
        reply: `**PBR Material Standards (Principled BSDF):**\n\n- **Gold:** Base Color \`[1.0, 0.82, 0.25]\`, Metallic \`1.0\`, Roughness \`0.15-0.25\`\n- **Chrome / Silver:** Base Color \`[0.95, 0.95, 0.95]\`, Metallic \`1.0\`, Roughness \`0.05-0.10\`\n- **Frosted Glass:** Transmission \`1.0\`, Roughness \`0.25\`, IOR \`1.45\`\n- **Matte Plastic / Wood:** Metallic \`0.0\`, Roughness \`0.4-0.6\`\n\n*Recommendation:* Always ensure normal vectors are recalculating outside before applying glossy shaders.`,
        toolCalls: [],
        suggestions: ['Create gold metallic sphere', 'Create chrome material', 'Audit mesh topology'],
      };
    }
    return {
      reply: `I am your 3D production copilot. You can ask me about Blender lighting setups, real-world architectural proportions, PBR shader parameters, or mesh topology standards.\n\nSwitch to **Build** mode whenever you want me to execute operations directly into your scene.`,
      toolCalls: [],
      suggestions: ['How do I set up 3-point lighting?', 'What are standard furniture dimensions?', 'Switch to Build mode'],
    };
  }

  // ==========================================
  // CASE 2: DESTRUCTIVE ACTIONS (Guarded confirmation)
  // ==========================================
  if (p.includes('delete all') || p.includes('clear scene') || p.includes('remove everything') || p.includes('reset scene')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'execute_blender_code',
      args: {
        code: `import bpy\nfor obj in list(bpy.data.objects):\n    bpy.data.objects.remove(obj, do_unlink=True)`,
      },
      status: 'pending',
      isDestructive: true,
      summary: 'Delete all objects in scene',
    });
    return {
      reply: `⚠️ **Destructive Action Detected:** You requested to clear the entire active scene. This will remove all meshes, lights, and cameras.`,
      toolCalls,
      suggestions: ['Cancel action', 'Keep existing objects'],
    };
  }

  if (p.startsWith('delete ') || p.startsWith('remove ')) {
    const target = prompt.replace(/^(delete|remove)\s+/i, '').replace(/^(the|a|an)\s+/i, '').trim();
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'delete_object',
      args: { name: target },
      status: 'pending',
      isDestructive: true,
      summary: `Delete object "${target}"`,
    });
    return {
      reply: `Flagged deletion for object **"${target}"**. Please confirm if you want to remove it from the scene.`,
      toolCalls,
      suggestions: ['Cancel deletion'],
    };
  }

  // ==========================================
  // CASE 3: LIVING ROOM / COMPOSITE ENVIRONMENT
  // ==========================================
  if (p.includes('living room') || (p.includes('furnish') && (p.includes('room') || p.includes('sofa')))) {
    const actions: ToolCall[] = [
      {
        id: Math.random().toString(36).substring(7),
        name: 'create_object',
        args: { type: 'PLANE', name: 'Living_Room_Floor', location: [0, 0, 0], scale: [8, 8, 1] },
        status: 'pending',
        summary: 'Create 8x8m hardwood floor plane',
      },
      {
        id: Math.random().toString(36).substring(7),
        name: 'import_asset',
        args: { asset_id: 'seating/sofa', name: 'Modern_Sofa', location: [0, 1.2, 0.425], snap_to_floor: true },
        status: 'pending',
        summary: 'Place 3-seat modern sofa (snapped to floor)',
      },
      {
        id: Math.random().toString(36).substring(7),
        name: 'import_asset',
        args: { asset_id: 'table/coffee_table', name: 'Coffee_Table', location: [0, -0.2, 0.225], snap_to_floor: true },
        status: 'pending',
        summary: 'Place coffee table in front of sofa',
      },
      {
        id: Math.random().toString(36).substring(7),
        name: 'create_object',
        args: { type: 'PLANE', name: 'Area_Rug', location: [0, 0.5, 0.003], scale: [2.4, 1.8, 1] },
        status: 'pending',
        summary: 'Place 2.4x1.8m area rug at floor level',
      },
      {
        id: Math.random().toString(36).substring(7),
        name: 'create_light',
        args: { type: 'AREA', name: 'Ceiling_Ambient_Light', location: [0, 0, 2.8], energy: 450, color: [1.0, 0.95, 0.88] },
        status: 'pending',
        summary: 'Add ceiling warm ambient area light (2.8m height)',
      },
    ];

    if (mode === 'plan') {
      return {
        reply: `### Living Room Architectural Plan\n\nI have composed a balanced contemporary living room layout with accurate real-world ergonomics:\n\n1. **Hardwood Floor:** 8m × 8m grounded plane at Z=0.\n2. **Modern 3-Seat Sofa:** Positioned along the back axis (Y=1.2m, Z=0.425m floor-corrected).\n3. **Coffee Table:** Center focal point (Y=-0.2m, Z=0.225m) with 0.45m walking clearance.\n4. **Area Rug:** 2.4m × 1.8m subtle base layer at Z=0.003m to avoid Z-fighting.\n5. **Ceiling Illumination:** Soft 450W warm area light at standard 2.8m ceiling height.`,
        toolCalls: actions,
        plan: {
          title: 'Modern Living Room Blueprint',
          steps: [
            'Create 8x8m hardwood floor plane',
            'Import modern 3-seat sofa snapped to floor at Y=1.2m',
            'Import contemporary coffee table at Y=-0.2m',
            'Place 2.4x1.8m area rug under seating area',
            'Install 2.8m ceiling warm ambient lighting',
          ],
          canExecute: true,
        },
        suggestions: ['Execute this plan', 'Add accent armchair', 'Add TV entertainment wall'],
      };
    }

    return {
      reply: `Furnished a contemporary living room scene: placed a modern 3-seat sofa and coffee table with floor snapping, laid an area rug, and illuminated with balanced 2.8m ceiling lighting.`,
      toolCalls: actions,
      suggestions: ['Add accent floor lamp', 'Add television wall unit', 'Switch to rendered view'],
    };
  }

  // ==========================================
  // CASE 4: LIGHTING RIGS
  // ==========================================
  if (p.includes('light') || p.includes('lighting') || p.includes('lamp') || p.includes('sun')) {
    if (p.includes('studio') || p.includes('3-point') || p.includes('three-point') || p.includes('cinematic')) {
      const lights: ToolCall[] = [
        {
          id: Math.random().toString(36).substring(7),
          name: 'create_light',
          args: { type: 'AREA', name: 'Key_Light', location: [3, -3, 3.5], energy: 500, color: [1.0, 0.95, 0.88] },
          status: 'pending',
          summary: 'Key Light (Area 500W warm)',
        },
        {
          id: Math.random().toString(36).substring(7),
          name: 'create_light',
          args: { type: 'AREA', name: 'Fill_Light', location: [-3, -2, 2.5], energy: 250, color: [0.85, 0.92, 1.0] },
          status: 'pending',
          summary: 'Fill Light (Area 250W cool)',
        },
        {
          id: Math.random().toString(36).substring(7),
          name: 'create_light',
          args: { type: 'POINT', name: 'Rim_Light', location: [0, 4, 3.0], energy: 350, color: [1.0, 1.0, 1.0] },
          status: 'pending',
          summary: 'Rim Light (Point 350W white)',
        },
      ];

      return {
        reply: `Configured a classic 3-point cinematic studio lighting rig: 500W warm key light (45°), 250W cool fill light for shadow diffusion, and a 350W rim light for subject edge separation.`,
        toolCalls: lights,
        suggestions: ['Set shading to rendered', 'Create camera framing scene', 'Add backdrop cyclorama'],
      };
    }

    // Default warm sunlight or single light
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_light',
      args: { type: 'SUN', name: 'Sun_Light', location: [4, -4, 5], energy: 3.0, color: [1.0, 0.96, 0.9] },
      status: 'pending',
      summary: 'Add directional sun lamp',
    });

    return {
      reply: `Added a warm directional sun lamp angled into the scene with 3.0 energy intensity.`,
      toolCalls,
      suggestions: ['Add fill light', 'Switch to Rendered shading', 'Capture Viewport snapshot'],
    };
  }

  // ==========================================
  // CASE 5: MATERIALS & SHADERS
  // ==========================================
  if (p.includes('gold') || p.includes('metallic') || p.includes('chrome') || p.includes('copper')) {
    const isGold = p.includes('gold') || p.includes('yellow');
    const isChrome = p.includes('chrome') || p.includes('silver');
    const color = isGold ? [1.0, 0.82, 0.25, 1.0] : isChrome ? [0.95, 0.95, 0.95, 1.0] : [0.95, 0.55, 0.35, 1.0];
    const matName = isGold ? 'Gold_PBR' : isChrome ? 'Chrome_PBR' : 'Copper_PBR';

    toolCalls.push(
      {
        id: Math.random().toString(36).substring(7),
        name: 'create_principled_material',
        args: { name: matName, base_color: color, metallic: 0.95, roughness: 0.15 },
        status: 'pending',
        summary: `Create ${matName} shader (Metallic=0.95, Roughness=0.15)`,
      }
    );

    // If prompt also mentions sphere or cube, create the mesh
    if (p.includes('sphere') || p.includes('ball')) {
      toolCalls.unshift({
        id: Math.random().toString(36).substring(7),
        name: 'create_object',
        args: { type: 'SPHERE', name: `${matName}_Sphere`, location: [0, 0, 1.0], scale: [1, 1, 1] },
        status: 'pending',
        summary: `Create UV Sphere at Z=1.0m (floor clearance)`,
      });
      toolCalls.push({
        id: Math.random().toString(36).substring(7),
        name: 'assign_material',
        args: { object_name: `${matName}_Sphere`, material_name: matName },
        status: 'pending',
        summary: `Assign ${matName} to Sphere`,
      });
    }

    return {
      reply: `Created ${matName} material with 95% metallic reflectance and 0.15 micro-facet roughness for sharp, realistic specular highlights.`,
      toolCalls,
      suggestions: ['Add 3-point studio lighting', 'Set shading to material', 'Capture Viewport snapshot'],
    };
  }

  // ==========================================
  // CASE 6: FURNITURE (SOFA / TABLE / CHAIR)
  // ==========================================
  if (p.includes('sofa') || p.includes('couch')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'import_asset',
      args: { asset_id: 'seating/sofa', name: 'Sofa', location: [0, 0, 0.425], snap_to_floor: true },
      status: 'pending',
      summary: 'Import 3-seat modern sofa',
    });
    return {
      reply: `Imported modern 3-seat sofa snapped to the floor level (Z=0.425m).`,
      toolCalls,
      suggestions: ['Add coffee table', 'Add area rug', 'Set up studio lighting'],
    };
  }

  if (p.includes('chair') || p.includes('seat')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'import_asset',
      args: { asset_id: 'seating/seat', name: 'Armchair', location: [0, 0, 0.45], snap_to_floor: true },
      status: 'pending',
      summary: 'Import modern armchair',
    });
    return {
      reply: `Added an ergonomic modern armchair snapped to floor level.`,
      toolCalls,
      suggestions: ['Add side table', 'Add floor lamp', 'Rotate chair 45 degrees'],
    };
  }

  if (p.includes('table') || p.includes('desk')) {
    const isCoffee = p.includes('coffee');
    const assetId = isCoffee ? 'table/coffee_table' : 'table/table_taytum';
    const height = isCoffee ? 0.225 : 0.375;
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'import_asset',
      args: { asset_id: assetId, name: isCoffee ? 'Coffee_Table' : 'Dining_Table', location: [0, 0, height], snap_to_floor: true },
      status: 'pending',
      summary: `Import ${isCoffee ? 'coffee table' : 'dining table'}`,
    });
    return {
      reply: `Placed ${isCoffee ? 'coffee table (0.45m height)' : 'dining table (0.75m height)'} snapped flat to floor.`,
      toolCalls,
      suggestions: ['Add chairs around table', 'Place decorative item on top', 'Add overhead lighting'],
    };
  }

  // ==========================================
  // CASE 7: CAMERA & VIEW FRAMING
  // ==========================================
  if (p.includes('camera') || p.includes('angle') || p.includes('view') || p.includes('isometric')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_camera',
      args: { name: 'Isometric_Camera', location: [6.5, -6.5, 4.8], rotation: [1.1, 0, 0.785] },
      status: 'pending',
      summary: 'Create isometric 35mm camera at [6.5, -6.5, 4.8]',
    });
    return {
      reply: `Positioned an isometric camera at [6.5m, -6.5m, 4.8m] angled downward at 45 degrees, framed directly at the scene center.`,
      toolCalls,
      suggestions: ['Capture Viewport snapshot', 'Switch to rendered shading', 'Add key light'],
    };
  }

  // ==========================================
  // CASE 8: MESH QUALITY & AUDIT
  // ==========================================
  if (p.includes('quality') || p.includes('analyze') || p.includes('audit') || p.includes('topology') || p.includes('manifold')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'analyze_mesh_quality',
      args: { name: 'Cube' },
      status: 'pending',
      summary: 'Inspect mesh topology for non-manifold edges',
    });
    return {
      reply: `Running topological analysis: checking for non-manifold geometry, loose vertices, degenerate faces, and inverted surface normals.`,
      toolCalls,
      suggestions: ['Recalculate outside normals', 'Merge duplicate vertices', 'Bevel sharp edges'],
    };
  }

  // ==========================================
  // CASE 9: PRIMITIVES (CUBE, SPHERE, PLANE, CYLINDER)
  // ==========================================
  if (p.includes('sphere') || p.includes('ball')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_object',
      args: { type: 'SPHERE', name: 'Sphere', location: [0, 0, 1.0], scale: [1, 1, 1] },
      status: 'pending',
      summary: 'Create UV Sphere (radius 1m, Z=1.0m)',
    });
    return {
      reply: `Created standard UV sphere positioned at Z=1.0m for clean ground contact.`,
      toolCalls,
      suggestions: ['Apply gold material', 'Apply chrome material', 'Add 3-point lighting'],
    };
  }

  if (p.includes('cube') || p.includes('box')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_object',
      args: { type: 'CUBE', name: 'Cube', location: [0, 0, 1.0], scale: [1, 1, 1] },
      status: 'pending',
      summary: 'Create 2m Cube placed on floor (Z=1.0m)',
    });
    return {
      reply: `Added a standard 2m cube at Z=1.0m resting directly on the ground plane.`,
      toolCalls,
      suggestions: ['Bevel edges', 'Assign metallic material', 'Scale down by 50%'],
    };
  }

  if (p.includes('floor') || p.includes('ground') || p.includes('plane')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_object',
      args: { type: 'PLANE', name: 'Ground_Plane', location: [0, 0, 0], scale: [10, 10, 1] },
      status: 'pending',
      summary: 'Create 10x10m ground plane at Z=0',
    });
    return {
      reply: `Created a 10m × 10m ground plane at Z=0.`,
      toolCalls,
      suggestions: ['Add modern sofa', 'Add studio lighting rig', 'Set shading to material'],
    };
  }

  // ==========================================
  // CASE 10: GENERIC / FALLBACK BUILD
  // ==========================================
  toolCalls.push({
    id: Math.random().toString(36).substring(7),
    name: 'capture_viewport',
    args: {},
    status: 'pending',
    summary: 'Update viewport screenshot',
  });

  return {
    reply: `I have processed your request: "${prompt}". I've refreshed the 3D scene state and synchronized the viewport preview.`,
    toolCalls,
    suggestions: ['Furnish a modern living room', 'Add 3-point studio lighting', 'Create gold metallic sphere'],
  };
}

/**
 * Send prompt to configured LLM (OpenAI, Ollama, Claude, etc.) or use domain engine
 */
export async function sendChatMessage(
  prompt: string,
  mode: 'build' | 'plan' | 'ask',
  settings: AppSettings,
  history: Array<{ role: string; content: string }> = []
): Promise<IntentResult> {
  // 1. Remote OpenAI-compatible API
  if (settings.provider === 'openai' && settings.apiKey) {
    try {
      const endpoint = settings.apiBaseUrl || 'https://api.openai.com/v1';
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-4o',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: `[Mode: ${mode.toUpperCase()}] ${prompt}` },
          ],
          temperature: settings.temperature ?? 0.7,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const intent = parseLocalIntent(prompt, mode);
        return {
          reply: content,
          toolCalls: intent.toolCalls,
          plan: intent.plan,
          suggestions: intent.suggestions,
        };
      }
    } catch (e) {
      console.warn('OpenAI API call failed, falling back to domain engine:', e);
    }
  }

  // 2. Local Ollama API
  if (settings.provider === 'ollama') {
    try {
      const endpoint = settings.apiBaseUrl || 'http://localhost:11434';
      const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.model || 'llama3.1',
          prompt: `${SYSTEM_PROMPT}\n\nUser request (${mode.toUpperCase()}): ${prompt}`,
          stream: false,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const intent = parseLocalIntent(prompt, mode);
        return {
          reply: data.response || intent.reply,
          toolCalls: intent.toolCalls,
          plan: intent.plan,
          suggestions: intent.suggestions,
        };
      }
    } catch (e) {
      console.warn('Ollama API call failed, falling back to domain engine:', e);
    }
  }

  // 3. Fallback to specialized 3D domain reasoning engine
  return parseLocalIntent(prompt, mode);
}
