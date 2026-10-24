export interface SceneObject {
  name: string;
  type: string;
  location: [number, number, number];
  rotation?: [number, number, number];
  dimensions?: [number, number, number];
  parent: string | null;
  children: string[];
  visible: boolean;
  polycount?: number;
}

export interface SceneInfo {
  scene_name: string;
  objects: SceneObject[];
  object_count: number;
  type_counts: Record<string, number>;
  frame_start: number;
  frame_end: number;
  frame_current: number;
  fps: number;
  render_engine: string;
  unit_system?: string;
  use_gravity?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  mode?: 'build' | 'plan' | 'ask';
  toolCalls?: ToolCall[];
}

export type LLMProvider = 
  | 'ollama' 
  | 'lmstudio' 
  | 'openai' 
  | 'anthropic' 
  | 'gemini' 
  | 'openrouter' 
  | 'groq' 
  | 'deepseek' 
  | 'custom';

export interface AppSettings {
  blenderHost: string;
  blenderPort: number;
  assetsPath: string;
  autoRefreshViewport: boolean;
  requireApprovals: boolean;
  toolset: 'core' | 'full';
  provider: LLMProvider;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  temperature: number;
}
