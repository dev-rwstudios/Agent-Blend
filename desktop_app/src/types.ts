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
  materials?: string[];
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
  isDestructive?: boolean;
  summary?: string;
}

export interface PlanData {
  title: string;
  steps: string[];
  canExecute: boolean;
}

export interface BucketAsset {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  format?: string;
  source: 'user' | 'agent';
  modelPath: string;
  assetId?: string;
  dimensions_m?: { width: number; depth: number; height: number };
  status: 'approved' | 'pending';
  thumbnailUrl?: string;
  suggestedLocation?: [number, number, number];
}

export interface StagingItem {
  id: string;
  slot: string;
  name: string;
  assetId?: string;
  category?: string;
  subcategory?: string;
  dimensions?: { width: number; depth: number; height: number };
  status: 'available' | 'missing' | 'custom';
  selected: boolean;
  alternatives?: Array<{
    id: string;
    name: string;
    assetId: string;
    category: string;
    subcategory?: string;
    dimensions?: { width: number; depth: number; height: number };
    modelPath?: string;
  }>;
  modelPath?: string;
  customPath?: string;
  note?: string;
  suggestedLocation?: [number, number, number];
}

export interface StagingManifest {
  id: string;
  title: string;
  roomType?: string;
  style?: string;
  items: StagingItem[];
  isExecuted?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  mode?: 'build' | 'plan' | 'ask';
  toolCalls?: ToolCall[];
  plan?: PlanData;
  staging?: StagingManifest;
  suggestions?: string[];
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
  executionMode: 'autonomous' | 'manual';
  requireApprovals?: boolean; // legacy compatibility fallback
  toolset: 'core' | 'full';
  provider: LLMProvider;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  temperature: number;
}
