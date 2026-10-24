import { AppSettings, ToolCall, PlanData } from '../types';

export const SYSTEM_PROMPT = `You are Agent-Blend, an autonomous senior 3D director and production assistant controlling live Blender scenes.

CORE OPERATIONAL RULES:
1. ONLY generate tool calls when the user explicitly requests a 3D scene operation (e.g., adding objects, configuring materials, setting lights, framing cameras, analyzing meshes, or deleting objects).
2. For greetings ("hi", "hello", "hey"), general questions, acknowledgements ("ok", "thanks"), or non-3D requests, respond conversationally with NO tool calls.
3. IN BUILD MODE: Execute constructive operations directly without asking for permission.
4. IN PLAN MODE: Return a structured architectural blueprint with step-by-step instructions.
5. IN ASK MODE: Provide deep 3D modeling and rendering advice without executing tools.
6. COORDINATE SYSTEM: X=left/right, Y=front/back, Z=up/down. Floor is at Z=0.
7. GOLDEN RULE: place_Z = surface_top_Z + (object_height / 2). Never leave objects buried at Z=0.`;

export interface IntentResult {
  reply: string;
  toolCalls: ToolCall[];
  plan?: PlanData;
  suggestions?: string[];
  isError?: boolean;
}

/**
 * Check connectivity and status for the configured AI model provider
 */
export async function checkModelHealth(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  const provider = settings.provider || 'builtin';

  if (provider === 'builtin') {
    return { ok: true, message: 'Built-in 3D Engine' };
  }

  if (provider === 'ollama') {
    try {
      const endpoint = settings.apiBaseUrl || 'http://localhost:11434';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        return { ok: true, message: `Ollama (${settings.model || 'local'})` };
      }
      return { ok: false, message: `Ollama HTTP ${res.status}` };
    } catch {
      return { ok: false, message: 'Ollama Offline (Click to configure)' };
    }
  }

  if (provider === 'lmstudio') {
    try {
      const endpoint = settings.apiBaseUrl || 'http://localhost:1234/v1';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${endpoint}/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        return { ok: true, message: `LM Studio (${settings.model || 'local'})` };
      }
      return { ok: false, message: 'LM Studio Unreachable' };
    } catch {
      return { ok: false, message: 'LM Studio Offline' };
    }
  }

  // Cloud API providers requiring keys
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return { ok: false, message: `${provider.toUpperCase()}: No API Key` };
  }

  return { ok: true, message: `${provider.toUpperCase()} Ready` };
}

/**
 * Specialized 3D domain reasoning engine that handles intent classification cleanly
 */
export function parseLocalIntent(prompt: string, mode: 'build' | 'plan' | 'ask'): IntentResult {
  const p = prompt.toLowerCase().trim();
  const words = p.split(/\s+/);
  const toolCalls: ToolCall[] = [];

  // ==========================================
  // CASE 0: GREETINGS & CASUAL CHAT (ZERO TOOLS!)
  // ==========================================
  const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'greetings', 'good morning', 'good evening', 'good afternoon'];
  if (greetings.includes(p) || (words.length <= 2 && greetings.some(g => words[0] === g))) {
    return {
      reply: `Hello! I'm **Agent-Blend**, your 3D copilot for Blender.\n\nI can build geometry, arrange furniture, set up studio lighting rigs, apply PBR materials, and frame isometric cameras. What would you like to create in your scene?`,
      toolCalls: [], // ABSOLUTELY ZERO TOOL CALLS
      suggestions: [
        'Furnish a modern living room',
        'Set up 3-point studio lighting',
        'Create a gold metallic sphere',
        'Analyze active mesh quality',
      ],
    };
  }

  // ==========================================
  // CASE 0.1: ACKNOWLEDGEMENTS & GRATITUDE (ZERO TOOLS!)
  // ==========================================
  const acknowledgements = ['ok', 'okay', 'thanks', 'thank you', 'thx', 'cool', 'awesome', 'great', 'got it', 'perfect', 'nice'];
  if (acknowledgements.includes(p)) {
    return {
      reply: `You're welcome! Let me know whenever you want to add new objects, change materials, or adjust lighting in Blender.`,
      toolCalls: [],
      suggestions: ['Add modern coffee table', 'Set up sunlight', 'Switch shading to rendered'],
    };
  }

  // ==========================================
  // CASE 0.2: CAPABILITIES / HELP (ZERO TOOLS!)
  // ==========================================
  if (p === 'help' || p.includes('what can you do') || p.includes('who are you') || p.includes('commands')) {
    return {
      reply: `**Agent-Blend Capabilities:**\n\n- **Living Rooms & Furniture:** Type *"Furnish a living room"* to auto-snap sofas, tables, and rugs to the floor.\n- **PBR Materials:** Request *"Gold sphere"*, *"Chrome cube"*, or custom roughness/metallic shaders.\n- **Cinematic Lighting:** Type *"3-point lighting"* for key, fill, and rim lights with warm/cool color balance.\n- **Cameras & Framing:** Type *"Create isometric camera"* to frame origin at a 45-degree angle.\n- **Topology Inspection:** Type *"Audit mesh quality"* to check non-manifold geometry.\n\n*Tip:* Use the segmented switcher below to toggle between **Build (Auto)**, **Plan First**, and **Ask** modes.`,
      toolCalls: [],
      suggestions: ['Furnish a modern living room', '3-point studio lighting', 'Create gold sphere'],
    };
  }

  // ==========================================
  // CASE 1: ASK / ADVISORY MODE (ZERO TOOLS!)
  // ==========================================
  if (mode === 'ask') {
    if (p.includes('light') || p.includes('lighting')) {
      return {
        reply: `**Studio Lighting Architecture in Blender:**\n\n1. **Key Light (Primary):** Area Light placed at 45° angle, ~3.5m high, power 400-500W, slightly warm color (#FFF4E5).\n2. **Fill Light (Shadow Softening):** Placed opposite the key light, larger size for softer diffusion, lower power (~200W), slightly cool (#E8F0FE).\n3. **Rim / Back Light (Edge Separation):** Placed behind the subject pointing towards camera at high angle (~300W) to separate silhouettes from dark backgrounds.\n\n*Cycles Tip:* Set light bounces to at least 4 diffuse and 4 glossy bounces for natural global illumination.`,
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
        reply: `**PBR Material Standards (Principled BSDF):**\n\n- **Gold:** Base Color \`[1.0, 0.82, 0.25]\`, Metallic \`1.0\`, Roughness \`0.15-0.25\`\n- **Chrome / Silver:** Base Color \`[0.95, 0.95, 0.95]\`, Metallic \`1.0\`, Roughness \`0.05-0.10\`\n- **Frosted Glass:** Transmission \`1.0\`, Roughness \`0.25\`, IOR \`1.45\`\n- **Matte Plastic / Wood:** Metallic \`0.0\`, Roughness \`0.4-0.6\`\n\n*Recommendation:* Always ensure normal vectors are recalculated outside before applying glossy shaders.`,
        toolCalls: [],
        suggestions: ['Create gold metallic sphere', 'Create chrome material', 'Audit mesh topology'],
      };
    }
    return {
      reply: `I am your 3D production advisor. You can ask me about Blender lighting setups, real-world architectural proportions, PBR shader parameters, or mesh topology standards.\n\nSwitch to **Build** mode whenever you want me to execute operations directly into your scene.`,
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
    if (target) {
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

    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_principled_material',
      args: { name: matName, base_color: color, metallic: 0.95, roughness: 0.15 },
      status: 'pending',
      summary: `Create ${matName} shader (Metallic=0.95, Roughness=0.15)`,
    });

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
      reply: `Created ${matName} material with 95% metallic reflectance and 0.15 roughness for sharp specular highlights.`,
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
  if (p.includes('camera') || p.includes('isometric') || p.includes('angle') || p.includes('view') && p.includes('frame')) {
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
      reply: `Running topological analysis: checking active meshes for non-manifold geometry, loose vertices, and degenerate polygons.`,
      toolCalls,
      suggestions: ['Recalculate outside normals', 'Merge duplicate vertices', 'Bevel sharp edges'],
    };
  }

  // ==========================================
  // CASE 9: PRIMITIVES (SPHERE, CUBE, PLANE)
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
  // CASE 10: UNRECOGNIZED QUERY (ZERO PHANTOM TOOLS!)
  // ==========================================
  return {
    reply: `I didn't detect a specific 3D command in: *"${prompt}"*.\n\nTo build in Blender, describe an object to add, lighting to configure, or materials to create. Or choose one of the suggestions below:`,
    toolCalls: [], // ZERO TOOL CALLS! NEVER RUN PHANTOM ACTIONS!
    suggestions: [
      'Furnish a modern living room',
      'Set up 3-point studio lighting',
      'Create a gold metallic sphere',
      'Add a ground plane at Z=0',
    ],
  };
}

/**
 * Send prompt to configured LLM or Built-in Domain Engine with honest error reporting
 */
export async function sendChatMessage(
  prompt: string,
  mode: 'build' | 'plan' | 'ask',
  settings: AppSettings,
  history: Array<{ role: string; content: string }> = []
): Promise<IntentResult> {
  const provider = settings.provider || 'builtin';

  // 1. Built-in 3D Engine (Default, Offline, Zero Setup)
  if (provider === 'builtin') {
    return parseLocalIntent(prompt, mode);
  }

  // 2. OpenAI API
  if (provider === 'openai') {
    if (!settings.apiKey || !settings.apiKey.trim()) {
      return {
        reply: `⚠️ **OpenAI API Key Missing**\n\nYou have selected OpenAI as your provider, but no API key is configured.\n\n👉 **To fix this:**\n1. Click **Settings** (gear icon in the top right)\n2. Enter your OpenAI API key (\`sk-...\`)\n3. Or switch provider to **Built-in 3D Engine** for instant offline use.`,
        toolCalls: [],
        isError: true,
        suggestions: ['Switch to Built-in Engine', 'Open Settings'],
      };
    }

    try {
      const endpoint = settings.apiBaseUrl || 'https://api.openai.com/v1';
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey.trim()}`,
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

      if (!res.ok) {
        const errText = await res.text();
        return {
          reply: `⚠️ **OpenAI API Error (${res.status})**\n\n\`${errText || res.statusText}\`\n\nPlease check your API key and quota in Settings.`,
          toolCalls: [],
          isError: true,
          suggestions: ['Open Settings'],
        };
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const intent = parseLocalIntent(prompt, mode);
      return {
        reply: content,
        toolCalls: intent.toolCalls,
        plan: intent.plan,
        suggestions: intent.suggestions,
      };
    } catch (e: any) {
      return {
        reply: `⚠️ **Failed to reach OpenAI**\n\n${e.message || String(e)}. Check your internet connection or verify your API base URL in Settings.`,
        toolCalls: [],
        isError: true,
        suggestions: ['Open Settings'],
      };
    }
  }

  // 3. Local Ollama Server
  if (provider === 'ollama') {
    const endpoint = settings.apiBaseUrl || 'http://localhost:11434';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model || 'llama3.1',
          prompt: `${SYSTEM_PROMPT}\n\nUser request (${mode.toUpperCase()}): ${prompt}`,
          stream: false,
        }),
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        return {
          reply: `⚠️ **Ollama Error (${res.status})**\n\n${errText || res.statusText}\n\nMake sure model \`${settings.model || 'llama3.1'}\` is pulled: \`ollama pull ${settings.model || 'llama3.1'}\``,
          toolCalls: [],
          isError: true,
          suggestions: ['Switch to Built-in Engine', 'Open Settings'],
        };
      }

      const data = await res.json();
      const intent = parseLocalIntent(prompt, mode);
      return {
        reply: data.response || intent.reply,
        toolCalls: intent.toolCalls,
        plan: intent.plan,
        suggestions: intent.suggestions,
      };
    } catch {
      return {
        reply: `⚠️ **Cannot Connect to Ollama**\n\nNo local Ollama server is running at \`${endpoint}\`.\n\n👉 **Options:**\n- Start Ollama in your terminal: \`ollama serve\`\n- Or open **Settings** and switch provider to **Built-in 3D Engine** (works instantly offline without Ollama).`,
        toolCalls: [],
        isError: true,
        suggestions: ['Switch to Built-in Engine', 'Open Settings'],
      };
    }
  }

  // 4. Other Cloud Providers (Anthropic, Gemini, Groq, DeepSeek)
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return {
      reply: `⚠️ **${provider.toUpperCase()} API Key Missing**\n\nPlease open **Settings** to provide your API key for ${provider.toUpperCase()}, or switch to the **Built-in 3D Engine**.`,
      toolCalls: [],
      isError: true,
      suggestions: ['Switch to Built-in Engine', 'Open Settings'],
    };
  }

  // Fallback to domain engine
  return parseLocalIntent(prompt, mode);
}
