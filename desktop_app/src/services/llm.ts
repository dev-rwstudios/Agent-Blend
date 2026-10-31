import type { AppSettings, ToolCall, PlanData } from '../types.ts';
import { readStream } from './stream.ts';
import { NO_VISION_HELP, anthropicContent, geminiParts, isNoVisionError, ollamaImages, openAiContent } from './vision.ts';
import type { Delta, StreamKind } from './stream.ts';

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
- delete_objects(names: string[]) or delete_objects(all: true)  — deletes objects with all their parts; all=true clears the whole scene
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

DELETING:
- To delete or clear objects ALWAYS use delete_objects (use the exact object names from the scene). Never use execute_blender_code to delete.

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

/** Tools that remove things from the scene — always paused for the user's approval. */
export function isDestructiveTool(name: string, args: Record<string, any>): boolean {
  if (/^(delete|remove|clear)_/.test(name)) return true;
  return name === 'execute_blender_code' && /\b(delete|remove|unlink|clear)\b/i.test(String(args?.code || ''));
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
              isDestructive: isDestructiveTool(item.name, item.args || item.parameters || {}),
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
          isDestructive: isDestructiveTool('execute_blender_code', { code }),
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
      const endpoint = resolveEndpoint(settings);
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
      const endpoint = resolveEndpoint(settings);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${endpoint}/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok && !bodyError(await res.json().catch(() => null))) {
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

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com',
  custom: 'http://localhost:8080/v1',
};

/**
 * Base URL for the configured provider. LM Studio and other OpenAI-compatible
 * servers serve their API under /v1, but their UIs show the bare host:port —
 * and LM Studio answers unknown paths with HTTP 200 plus an error body, so a
 * missing /v1 fails silently. Append it unless a version segment is present.
 */
function resolveEndpoint(settings: AppSettings): string {
  const provider = settings.provider || 'ollama';
  const url = (settings.apiBaseUrl || DEFAULT_ENDPOINTS[provider] || '').trim().replace(/\/+$/, '');
  if (provider === 'ollama' || provider === 'gemini' || /\/v\d+$/.test(url)) return url;
  return `${url}/v1`;
}

/** Error message from a response body that reported failure despite HTTP 200 (LM Studio does this). */
function bodyError(data: any): string | null {
  if (!data || !data.error) return null;
  return typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error);
}

function authHeaders(settings: AppSettings): Record<string, string> {
  const key = settings.apiKey?.trim();
  if (settings.provider === 'anthropic') {
    return {
      'x-api-key': key || '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function describeHttpError(res: Response): Promise<string> {
  const body = (await res.text().catch(() => '')).trim();
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.error || parsed?.message || body;
  } catch {
    // not JSON — keep the raw text
  }
  if (res.status === 401 || res.status === 403) return `Authentication failed (HTTP ${res.status}) — check your API key.`;
  return `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`;
}

function describeNetworkError(e: any, endpoint: string, timeoutMs: number, provider: string): string {
  if (e?.name === 'AbortError') return `No response from ${endpoint} within ${timeoutMs / 1000}s.`;
  const hint = provider === 'lmstudio'
    ? ' In LM Studio, start the local server and turn on "Enable CORS" in its server settings.'
    : '';
  return `Cannot reach ${endpoint} — is the server running and the URL correct?${hint}`;
}

/**
 * List the models the configured provider offers (e.g. models loaded/downloaded in LM Studio or Ollama).
 */
export async function fetchAvailableModels(settings: AppSettings): Promise<{ ok: boolean; models: string[]; message: string }> {
  const provider = settings.provider || 'ollama';
  const endpoint = resolveEndpoint(settings);
  const timeoutMs = 8000;

  let url = `${endpoint}/models`;
  if (provider === 'ollama') url = `${endpoint}/api/tags`;
  if (provider === 'gemini') url = `${endpoint}/v1beta/models?key=${encodeURIComponent(settings.apiKey?.trim() || '')}`;

  try {
    const res = await fetchWithTimeout(url, { headers: provider === 'gemini' ? {} : authHeaders(settings) }, timeoutMs);
    if (!res.ok) return { ok: false, models: [], message: await describeHttpError(res) };
    const data = await res.json();
    const apiError = bodyError(data);
    if (apiError) return { ok: false, models: [], message: `${apiError} (requested ${url})` };

    let models: string[] = [];
    if (provider === 'ollama') {
      models = (data.models || []).map((m: any) => m.name || m.model);
    } else if (provider === 'gemini') {
      models = (data.models || [])
        .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''));
    } else {
      models = (data.data || []).map((m: any) => m.id);
    }
    models = models.filter(Boolean).sort((a, b) => a.localeCompare(b));

    if (models.length === 0) {
      return {
        ok: false,
        models,
        message: provider === 'lmstudio'
          ? 'Server is reachable but no models are available — load or download a model in LM Studio.'
          : 'Server is reachable but returned no models.',
      };
    }
    return { ok: true, models, message: `Found ${models.length} model${models.length === 1 ? '' : 's'}.` };
  } catch (e: any) {
    return { ok: false, models: [], message: describeNetworkError(e, endpoint, timeoutMs, provider) };
  }
}

/**
 * Send a minimal one-token request to the configured model to verify that the
 * server is reachable, the credentials work, and the model actually responds.
 */
export async function testModelConnection(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  const provider = settings.provider || 'ollama';
  const endpoint = resolveEndpoint(settings);
  const model = settings.model?.trim();
  // Local servers may need to load the model into memory on first request.
  const timeoutMs = provider === 'ollama' || provider === 'lmstudio' || provider === 'custom' ? 60000 : 20000;

  if (!model) return { ok: false, message: 'Enter a model identifier first.' };
  if (provider !== 'ollama' && provider !== 'lmstudio' && provider !== 'custom' && !settings.apiKey?.trim()) {
    return { ok: false, message: 'Enter an API key first.' };
  }

  let url: string;
  let body: unknown;
  let headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(settings) };

  if (provider === 'ollama') {
    url = `${endpoint}/api/chat`;
    body = { model, messages: [{ role: 'user', content: 'ping' }], stream: false, options: { num_predict: 1 } };
  } else if (provider === 'anthropic') {
    url = `${endpoint}/messages`;
    body = { model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] };
  } else if (provider === 'gemini') {
    url = `${endpoint}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey.trim())}`;
    headers = { 'Content-Type': 'application/json' };
    body = { contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } };
  } else {
    url = `${endpoint}/chat/completions`;
    body = { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false };
  }

  const started = performance.now();
  try {
    const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
    if (!res.ok) {
      const detail = await describeHttpError(res);
      if (res.status === 404 || /not found|no such model|model_not_found|does not exist/i.test(detail)) {
        return { ok: false, message: `Server reachable, but model "${model}" was not found. ${detail}` };
      }
      return { ok: false, message: detail };
    }
    const data = await res.json().catch(() => null);
    const apiError = bodyError(data);
    if (apiError) {
      if (/not found|no such model|model_not_found|does not exist|not loaded/i.test(apiError)) {
        return { ok: false, message: `Server reachable, but model "${model}" was not found. ${apiError}` };
      }
      return { ok: false, message: `${apiError} (requested ${url})` };
    }
    const ms = Math.round(performance.now() - started);
    // LM Studio silently answers an unknown model name with whatever model is loaded.
    const servedModel = typeof data?.model === 'string' ? data.model : '';
    if (servedModel && !servedModel.startsWith(model)) {
      return {
        ok: false,
        message: `Server responded, but with "${servedModel}" instead of "${model}" — "${model}" isn't available. Use Fetch Models to pick a valid one.`,
      };
    }
    return { ok: true, message: `Connected — "${model}" responded in ${ms} ms.` };
  } catch (e: any) {
    return { ok: false, message: describeNetworkError(e, endpoint, timeoutMs, provider) };
  }
}

/**
 * Send prompt to the user's real AI model with honest connection and status reporting
 */
export async function sendChatMessage(
  prompt: string,
  mode: 'build' | 'plan' | 'ask',
  settings: AppSettings,
  history: Array<{ role: string; content: string }> = [],
  contextNote = ''
): Promise<IntentResult> {
  const provider = settings.provider || 'ollama';
  // Project / general-chat context (see services/chatContext.ts) rides along with the system prompt.
  const systemPrompt = contextNote ? `${SYSTEM_PROMPT}\n\n${contextNote}` : SYSTEM_PROMPT;

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
      const endpoint = resolveEndpoint(settings);
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
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
      const apiError = bodyError(data);
      if (apiError) {
        return {
          reply: `⚠️ **${provider.toUpperCase()} API Error**\n\n\`${apiError}\`\n\nPlease check your model name and API base URL in Settings.`,
          toolCalls: [],
          isError: true,
          suggestions: ['Open Settings'],
        };
      }
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
    const endpoint = resolveEndpoint(settings);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout for local LLM inference
      const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model || 'llama3.1',
          prompt: `${systemPrompt}\n\nUser request (${mode.toUpperCase()}): ${prompt}`,
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
    const endpoint = resolveEndpoint(settings);
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
            { role: 'system', content: systemPrompt },
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
      const apiError = bodyError(data);
      if (apiError) {
        return {
          reply: `⚠️ **LM Studio Error**\n\n${apiError}\n\nCheck the model name and the API Base URL in Settings.`,
          toolCalls: [],
          isError: true,
          suggestions: ['Open Settings'],
        };
      }
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

export interface CompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Images (data URLs) shown to the model with this message. */
  images?: string[];
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * JSON Schema the reply must follow. Sent as constrained decoding where the
   * server supports it (OpenAI-compatible `response_format`, Ollama `format`,
   * Gemini JSON mode); servers that reject it are retried without it.
   */
  schema?: { name: string; schema: Record<string, unknown> };
  /** Called with each piece of the reply (and the model's reasoning, if it sends any) as it is written. */
  onToken?: (delta: Delta) => void;
}

/** Servers that rejected a schema — not asked again this session. */
const schemaUnsupported = new Set<string>();

/**
 * Plain chat completion with the configured provider — used by the build
 * agent, which needs structured replies rather than the chat's tool blocks.
 * Throws with a readable message on any failure; honours `signal` for Stop.
 */
export async function completeChat(settings: AppSettings, messages: CompletionMessage[], opts: CompleteOptions = {}): Promise<string> {
  const provider = settings.provider || 'ollama';
  const endpoint = resolveEndpoint(settings);
  const model = settings.model?.trim();
  if (!model) throw new Error('No model is configured — choose one in Settings.');
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 4096;
  const timeoutMs = opts.timeoutMs ?? 240000;
  const serverKey = `${provider}|${endpoint}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const streamKind: StreamKind | null = !opts.onToken ? null : provider === 'ollama' ? 'ollama' : provider === 'anthropic' ? 'anthropic' : provider === 'gemini' ? null : 'openai';

  const request = (useSchema: boolean) => {
    const schema = useSchema ? opts.schema : undefined;
    const stream = streamKind !== null;
    let url: string;
    let body: Record<string, unknown>;
    let headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(settings) };
    if (provider === 'ollama') {
      url = `${endpoint}/api/chat`;
      body = { model, messages: messages.map((m) => (m.images?.length ? { role: m.role, content: m.content, images: ollamaImages(m.images) } : { role: m.role, content: m.content })), stream, options: { temperature, num_predict: maxTokens }, ...(schema ? { format: schema.schema } : {}) };
    } else if (provider === 'anthropic') {
      url = `${endpoint}/messages`;
      body = { model, system, messages: turns.map((m) => ({ role: m.role, content: anthropicContent(m.content, m.images ?? []) })), max_tokens: maxTokens, temperature, ...(stream ? { stream: true } : {}) };
    } else if (provider === 'gemini') {
      url = `${endpoint}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey?.trim() || '')}`;
      headers = { 'Content-Type': 'application/json' };
      body = {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m.content, m.images ?? []) })),
        generationConfig: { temperature, maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: 'application/json' } : {}) },
      };
    } else {
      url = `${endpoint}/chat/completions`;
      body = {
        model, messages: messages.map((m) => ({ role: m.role, content: openAiContent(m.content, m.images ?? []) })), temperature, max_tokens: maxTokens, stream,
        ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } } } : {}),
      };
    }
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  };

  try {
    let usedSchema = !!opts.schema && !schemaUnsupported.has(serverKey);
    let res = await request(usedSchema);
    if (!res.ok && usedSchema && [400, 422, 500, 501].includes(res.status)) {
      // This server can't do constrained output: remember, and ask again plainly.
      schemaUnsupported.add(serverKey);
      usedSchema = false;
      res = await request(false);
    }
    if (!res.ok) throw new Error(await describeHttpError(res));

    if (streamKind && res.body) {
      const { text, reasoning } = await readStream(res.body, streamKind, opts.onToken);
      if (!text.trim()) throw new Error(reasoning.trim() ? 'The model only produced reasoning and no answer — try again or raise the token limit.' : 'The model returned an empty reply.');
      return text;
    }

    const data = await res.json();
    const apiError = bodyError(data);
    if (apiError) throw new Error(apiError);
    const text =
      provider === 'ollama' ? data.message?.content
      : provider === 'anthropic' ? (data.content || []).map((c: any) => c.text || '').join('')
      : provider === 'gemini' ? (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('')
      : data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('The model returned an empty reply.');
    opts.onToken?.({ text });
    return text;
  } catch (e: any) {
    if (opts.signal?.aborted) throw new Error('Stopped.');
    if (messages.some((m) => m.images?.length) && !(e instanceof TypeError) && e?.name !== 'AbortError' && isNoVisionError(String(e?.message))) {
      throw new Error(NO_VISION_HELP);
    }
    if (e?.name === 'AbortError') throw new Error(`The model didn't answer within ${Math.round(timeoutMs / 1000)}s.`);
    if (e instanceof TypeError) throw new Error(describeNetworkError(e, endpoint, timeoutMs, provider));
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
