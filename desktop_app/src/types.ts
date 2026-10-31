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
  /** Scene saved just before this destructive tool ran — enables Undo. */
  checkpoint?: string;
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
  /** Live state of a build-agent run started by this message. */
  buildRun?: import('./agent/buildAgent').BuildRun;
  /** Reference images attached to this message (downscaled JPEG data URLs). */
  images?: string[];
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
  /** Model used to read reference images; empty = the main model (which must then be able to see). */
  visionModel?: string;
}

/** A folder the project pulls 3D assets from (scanned for .glb/.fbx/... + metadata.json). */
export interface AssetSource {
  id: string;
  path: string;
}

/** Snapshot of a project's scene, taken when it's saved — lets general chats
 *  answer questions about a project without opening it in Blender. */
export interface SceneSummary {
  objectCount: number;
  typeCounts: Record<string, number>;
  objectNames: string[];
  capturedAt: number;
}

/** A scene-building workspace: one .blend file plus its brief, assets and chats. */
export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  assetSources: AssetSource[];
  createdAt: number;
  updatedAt: number;
  sceneSummary?: SceneSummary;
}

export interface ChatMeta {
  id: string;
  title: string;
  /** null for a general chat that isn't attached to any project. */
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** A catalog entry from scanning an asset source folder. */
export interface CatalogAsset {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  room_types?: string[] | null;
  style_tags?: string[] | null;
  dimensions_m?: { width: number; depth: number; height: number } | null;
  surface?: string;
  model_path?: string;
  forward_axis?: string;
  format?: string;
}
