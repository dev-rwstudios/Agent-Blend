import { AppSettings, ToolCall, PlanData } from '../types';

export const SYSTEM_PROMPT = `You are Agent-Blend, an expert AI copilot controlling live Blender 3D scenes.

CAPABILITIES & DIRECT TOOL EXECUTION:
When the user asks you to build, add, modify, light, texture, or position objects in Blender, output your natural explanation and provide an executable \`\`\`json:tools code block.

Available Tools:
- create_object(type: "CUBE"|"SPHERE"|"PLANE"|"CYLINDER", name: string, location: [x,y,z], scale: [x,y,z])
- import_asset(asset_id: string, name: string, location: [x,y,z], snap_to_floor: boolean)
  * Pre-built assets available: "seating/sofa", "seating/seat", "table/coffee_table", "table/table_taytum"
- create_light(type: "POINT"|"SUN"|"AREA", name: string, location: [x,y,z], energy: number, color: [r,g,b])
- create_principled_material(name: string, base_color: [r,g,b,a], metallic: number, roughness: number)
- assign_material(object_name: string, material_name: string)
- create_camera(name: string, location: [x,y,z], rotation: [rx,ry,rz])
- delete_object(name: string)
- execute_blender_code(code: string)

Tool Call Format:
\`\`\`json:tools
[
  { "name": "create_object", "args": { "type": "PLANE", "name": "Floor", "location": [0,0,0], "scale": [10,10,1] } },
  { "name": "import_asset", "args": { "asset_id": "seating/sofa", "name": "Sofa", "location": [0, 1.2, 0.425], "snap_to_floor": true } }
]
\`\`\`

CONVERSATIONAL RULES:
- If the user says "hi", "hello", "hey", "who are you", "what can you do", "thanks", or asks general 3D questions, respond naturally as a helpful 3D copilot.
- DO NOT output any \`\`\`json:tools block for conversational prompts. Only output tool calls when an actual scene modification is requested.

COORDINATE CONVENTIONS:
- X=left/right, Y=front/back, Z=up/down. Floor is at Z=0.
- Bounding-box rule: place_Z = surface_top_Z + (object_height / 2). Never bury objects at Z=0.`;

export interface IntentResult {
  reply: string;
  toolCalls: ToolCall[];
  plan?: PlanData;
  suggestions?: string[];
  isError?: boolean;
}

/**
 * Extract executable tool calls from model text response
 */
export function extractToolCallsFromModelResponse(text: string): { cleanText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let cleanText = text;

  // 1. Look for ```json:tools or ```json containing tool definitions
  const jsonBlockRegex = /```(?:json:tools|json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    const raw = match[1].trim();
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed.tools || parsed.toolCalls || [parsed]);
        for (const item of list) {
          if (item && item.name) {
            toolCalls.push({
              id: Math.random().toString(36).substring(7),
              name: item.name,
              args: item.args || item.parameters || {},
              status: 'pending',
              summary: item.summary || `${item.name}(${Object.keys(item.args || {}).join(', ')})`,
              isDestructive: item.name === 'delete_object' || (item.name === 'execute_blender_code' && /delete|remove/i.test(item.args?.code || '')),
            });
          }
        }
        cleanText = cleanText.replace(match[0], '').trim();
      } catch {
        // Not tool JSON, preserve as message text
      }
    }
  }

  // 2. Look for Python script execution block
  if (toolCalls.length === 0) {
    const pyRegex = /```python\s*([\s\S]*?)```/gi;
    let pyMatch;
    if ((pyMatch = pyRegex.exec(text)) !== null) {
      const code = pyMatch[1].trim();
      if (code.includes('import bpy') || code.includes('bpy.')) {
        toolCalls.push({
          id: Math.random().toString(36).substring(7),
          name: 'execute_blender_code',
          args: { code },
          status: 'pending',
          summary: 'Execute Python script in Blender',
          isDestructive: /delete|remove/i.test(code),
        });
      }
    }
  }

  return { cleanText: cleanText || text, toolCalls };
}

/**
 * Check connectivity and status for the configured AI model provider
 */
export async function checkModelHealth(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  const provider = settings.provider || 'ollama';

  if (provider === 'ollama') {
    try {
      const endpoint = settings.apiBaseUrl || 'http://localhost:11434';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        return { ok: true, message: `Ollama (${settings.model || 'llama3.1'})` };
      }
      return { ok: false, message: `Ollama (HTTP ${res.status})` };
    } catch {
      return { ok: false, message: 'Ollama Offline' };
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
        return { ok: true, message: `LM Studio (${settings.model || 'model'})` };
      }
      return { ok: false, message: 'LM Studio Offline' };
    } catch {
      return { ok: false, message: 'LM Studio Offline' };
    }
  }

  // Cloud API providers requiring keys
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return { ok: false, message: `${provider.toUpperCase()} (No API Key)` };
  }

  return { ok: true, message: `${provider.toUpperCase()} (${settings.model || 'ready'})` };
}

/**
 * Send prompt to the user's real AI model with honest connection and status reporting
 */
export async function sendChatMessage(
  prompt: string,
  mode: 'build' | 'plan' | 'ask',
  settings: AppSettings,
  history: Array<{ role: string; content: string }> = []
): Promise<IntentResult> {
  const provider = settings.provider || 'ollama';

  // 1. OpenAI API (or custom OpenAI-compatible endpoint)
  if (provider === 'openai' || provider === 'custom' || provider === 'openrouter' || provider === 'groq' || provider === 'deepseek') {
    if (!settings.apiKey || !settings.apiKey.trim()) {
      return {
        reply: `⚠️ **No API Key Configured for ${provider.toUpperCase()}**\n\nPlease open **Settings** (gear icon in the top right) and enter your API key to connect to ${provider.toUpperCase()}.`,
        toolCalls: [],
        isError: true,
        suggestions: ['Open Settings'],
      };
    }

    try {
      const defaultEndpoint = provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
        : provider === 'groq' ? 'https://api.groq.com/openai/v1'
        : provider === 'deepseek' ? 'https://api.deepseek.com'
        : 'https://api.openai.com/v1';

      const endpoint = settings.apiBaseUrl || defaultEndpoint;
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
          reply: `⚠️ **${provider.toUpperCase()} API Error (${res.status})**\n\n\`${errText || res.statusText}\`\n\nPlease check your model name and API key in Settings.`,
          toolCalls: [],
          isError: true,
          suggestions: ['Open Settings'],
        };
      }

      const data = await res.json();
      const rawContent = data.choices?.[0]?.message?.content || '';
      const { cleanText, toolCalls } = extractToolCallsFromModelResponse(rawContent);

      return {
        reply: cleanText,
        toolCalls,
        suggestions: toolCalls.length > 0 ? ['Switch shading to rendered', 'Add key light', 'Capture Viewport snapshot'] : undefined,
      };
    } catch (e: any) {
      return {
        reply: `⚠️ **Connection Error reaching ${provider.toUpperCase()}**\n\n${e.message || String(e)}. Please check your internet connection or API endpoint in Settings.`,
        toolCalls: [],
        isError: true,
        suggestions: ['Open Settings'],
      };
    }
  }

  // 2. Local Ollama Server
  if (provider === 'ollama') {
    const endpoint = settings.apiBaseUrl || 'http://localhost:11434';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout for local LLM inference
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
          reply: `⚠️ **Ollama Error (${res.status})**\n\n${errText || res.statusText}\n\nMake sure model \`${settings.model || 'llama3.1'}\` is installed: \`ollama pull ${settings.model || 'llama3.1'}\``,
          toolCalls: [],
          isError: true,
          suggestions: ['Open Settings'],
        };
      }

      const data = await res.json();
      const rawContent = data.response || '';
      const { cleanText, toolCalls } = extractToolCallsFromModelResponse(rawContent);

      return {
        reply: cleanText,
        toolCalls,
        suggestions: toolCalls.length > 0 ? ['Set shading to rendered', 'Add 3-point lighting', 'Capture Viewport snapshot'] : undefined,
      };
    } catch {
      return {
        reply: `⚠️ **Cannot Connect to Ollama**\n\nNo local Ollama server is running at \`${endpoint}\`.\n\n👉 **To connect:**\n1. Start Ollama in your terminal: \`ollama serve\`\n2. Or click **Settings** to connect a cloud AI model (OpenAI, Claude, Gemini, Groq, DeepSeek).`,
        toolCalls: [],
        isError: true,
        suggestions: ['Open Settings'],
      };
    }
  }

  // 3. Local LM Studio Server
  if (provider === 'lmstudio') {
    const endpoint = settings.apiBaseUrl || 'http://localhost:1234/v1';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model || 'default',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: `[Mode: ${mode.toUpperCase()}] ${prompt}` },
          ],
          temperature: settings.temperature ?? 0.7,
        }),
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        return {
          reply: `⚠️ **LM Studio Error (${res.status})**\n\n${errText || res.statusText}`,
          toolCalls: [],
          isError: true,
          suggestions: ['Open Settings'],
        };
      }

      const data = await res.json();
      const rawContent = data.choices?.[0]?.message?.content || '';
      const { cleanText, toolCalls } = extractToolCallsFromModelResponse(rawContent);

      return {
        reply: cleanText,
        toolCalls,
      };
    } catch {
      return {
        reply: `⚠️ **Cannot Connect to LM Studio**\n\nNo local server found at \`${endpoint}\`.\n\nPlease start the local server inside the LM Studio application.`,
        toolCalls: [],
        isError: true,
        suggestions: ['Open Settings'],
      };
    }
  }

  // 4. Anthropic / Gemini
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return {
      reply: `⚠️ **${provider.toUpperCase()} API Key Missing**\n\nPlease open **Settings** to provide your API key for ${provider.toUpperCase()}.`,
      toolCalls: [],
      isError: true,
      suggestions: ['Open Settings'],
    };
  }

  return {
    reply: `Provider ${provider} configured. Please ensure your endpoint is reachable.`,
    toolCalls: [],
  };
}
