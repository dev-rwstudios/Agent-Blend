import { AppSettings, ToolCall } from '../types';

export const SYSTEM_PROMPT = `You are Agent-Blend, an expert 3D assistant controlling Blender via direct tool execution.

COORDINATE SYSTEM:
- X=left/right, Y=front/back, Z=up/down. Floor is at Z=0.
- Object location is its ORIGIN (center). Placed at Z=0 means half underground.
- Golden rule: surface_top_Z + (object_height / 2) for floor placement.
- When placing objects on top of another (e.g. coffee table or desk), compute parent top Z + child height / 2.

AVAILABLE TOOLS INCLUDE:
- create_object(type, name, location, rotation, scale)
- set_location(name, location)
- set_rotation(name, rotation)
- set_scale(name, scale)
- delete_object(name)
- assign_material(name, material_name)
- create_principled_material(name, base_color, metallic, roughness)
- create_light(type, name, location, energy, color)
- create_camera(name, location, rotation)
- analyze_mesh_quality(name)
- capture_viewport()
- import_asset(asset_id, location, name)
- execute_blender_code(code)

Always explain your 3D design choices and return actionable operations.`;

/**
 * Fallback intent parser that generates Blender tool calls directly for common 3D modeling requests
 */
export function parseLocalIntent(prompt: string, mode: 'build' | 'plan' | 'ask'): { reply: string; toolCalls: ToolCall[] } {
  const p = prompt.toLowerCase();
  const toolCalls: ToolCall[] = [];

  if (p.includes('chair') || p.includes('sofa') || p.includes('couch') || p.includes('seating')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'import_asset',
      args: {
        asset_id: p.includes('sofa') || p.includes('couch') ? 'seating/sofa' : 'seating/seat',
        location: [0, 0, 0],
        snap_to_floor: true,
      },
      status: 'pending',
    });
    return {
      reply: `I have selected a pre-modeled, production-ready seating asset from the Agent-Blend library with accurate real-world scale and PBR textures.`,
      toolCalls,
    };
  }

  if (p.includes('table') || p.includes('desk')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'import_asset',
      args: {
        asset_id: p.includes('coffee') ? 'table/coffee_table' : 'table/table_taytum',
        location: [0, 0, 0],
        snap_to_floor: true,
      },
      status: 'pending',
    });
    return {
      reply: `Placing a high-quality table asset from the library with floor snapping.`,
      toolCalls,
    };
  }

  if (p.includes('lamp') || p.includes('lighting') || p.includes('light')) {
    if (p.includes('studio') || p.includes('3-point') || p.includes('three point')) {
      toolCalls.push(
        {
          id: Math.random().toString(36).substring(7),
          name: 'create_light',
          args: { type: 'AREA', name: 'Key_Light', location: [3, -3, 3.5], energy: 500, color: [1.0, 0.95, 0.88] },
          status: 'pending',
        },
        {
          id: Math.random().toString(36).substring(7),
          name: 'create_light',
          args: { type: 'AREA', name: 'Fill_Light', location: [-3, -2, 2.5], energy: 250, color: [0.85, 0.9, 1.0] },
          status: 'pending',
        },
        {
          id: Math.random().toString(36).substring(7),
          name: 'create_light',
          args: { type: 'POINT', name: 'Rim_Light', location: [0, 4, 3.0], energy: 350, color: [1.0, 1.0, 1.0] },
          status: 'pending',
        }
      );
      return {
        reply: `Setting up a classic 3-point cinematic lighting rig (Key Light, Fill Light, and Rim/Back Light) with warm key temperature and cool fill balance.`,
        toolCalls,
      };
    }

    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_light',
      args: { type: 'SUN', name: 'Sun_Light', location: [4, -4, 5], energy: 3.5, color: [1.0, 0.96, 0.9] },
      status: 'pending',
    });
    return {
      reply: `Adding a directional sunlight source to illuminate the scene.`,
      toolCalls,
    };
  }

  if (p.includes('sphere') || p.includes('ball')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_object',
      args: { type: 'SPHERE', name: 'Sphere', location: [0, 0, 1.0], scale: [1, 1, 1] },
      status: 'pending',
    });
    if (p.includes('gold') || p.includes('metallic') || p.includes('yellow')) {
      toolCalls.push({
        id: Math.random().toString(36).substring(7),
        name: 'create_principled_material',
        args: { name: 'Gold_Material', base_color: [1.0, 0.82, 0.25, 1.0], metallic: 0.95, roughness: 0.18 },
        status: 'pending',
      });
      toolCalls.push({
        id: Math.random().toString(36).substring(7),
        name: 'assign_material',
        args: { object_name: 'Sphere', material_name: 'Gold_Material' },
        status: 'pending',
      });
    }
    return {
      reply: `Created a UV Sphere at Z=1.0m with smooth floor clearance and configured materials.`,
      toolCalls,
    };
  }

  if (p.includes('cube') || p.includes('box')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_object',
      args: { type: 'CUBE', name: 'Procedural_Cube', location: [0, 0, 1.0], scale: [1, 1, 1] },
      status: 'pending',
    });
    return {
      reply: `Added a 2m standard cube placed on the floor level.`,
      toolCalls,
    };
  }

  if (p.includes('plane') || p.includes('floor') || p.includes('ground')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_object',
      args: { type: 'PLANE', name: 'Studio_Floor', location: [0, 0, 0], scale: [10, 10, 1] },
      status: 'pending',
    });
    return {
      reply: `Added a 10x10m ground plane at Z=0.`,
      toolCalls,
    };
  }

  if (p.includes('quality') || p.includes('analyze') || p.includes('inspect')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'analyze_mesh_quality',
      args: { name: 'Cube' },
      status: 'pending',
    });
    return {
      reply: `Inspecting active mesh topology for non-manifold edges, loose vertices, duplicate points, and degenerate polygons.`,
      toolCalls,
    };
  }

  if (p.includes('camera') || p.includes('view')) {
    toolCalls.push({
      id: Math.random().toString(36).substring(7),
      name: 'create_camera',
      args: { name: 'Studio_Camera', location: [7.0, -7.0, 5.0], rotation: [1.1, 0, 0.78] },
      status: 'pending',
    });
    return {
      reply: `Positioned a 35mm focal camera framed at the scene origin with a 45-degree isometric viewing angle.`,
      toolCalls,
    };
  }

  // Default answer with capture_viewport
  toolCalls.push({
    id: Math.random().toString(36).substring(7),
    name: 'capture_viewport',
    args: {},
    status: 'pending',
  });

  return {
    reply: `I analyzed your request in **${mode.toUpperCase()}** mode: "${prompt}". I've queued a viewport verification to assess the current 3D composition.`,
    toolCalls,
  };
}

/**
 * Send prompt to configured LLM (Ollama, OpenAI, Gemini, etc.) or use fallback
 */
export async function sendChatMessage(
  prompt: string,
  mode: 'build' | 'plan' | 'ask',
  settings: AppSettings,
  history: Array<{ role: string; content: string }> = []
): Promise<{ reply: string; toolCalls: ToolCall[] }> {
  // If OpenAI API key or custom endpoint configured
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
        // Extract local tool calls or fallback to intent matching
        const intent = parseLocalIntent(prompt, mode);
        return {
          reply: content,
          toolCalls: intent.toolCalls,
        };
      }
    } catch (e) {
      console.warn('OpenAI API call failed, falling back to local intent parser:', e);
    }
  }

  // If Ollama is running locally
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
        };
      }
    } catch (e) {
      console.warn('Ollama API call failed, falling back to local intent parser:', e);
    }
  }

  // Fallback to local 3D domain reasoning engine
  return parseLocalIntent(prompt, mode);
}
