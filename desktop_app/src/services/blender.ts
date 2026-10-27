import { SceneInfo } from '../types';

// Check if running inside Tauri
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

let invokeFn: any = null;
async function getInvoke() {
  if (invokeFn) return invokeFn;
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeFn = invoke;
      return invoke;
    } catch (e) {
      console.warn('Tauri core import failed:', e);
    }
  }
  return null;
}

export interface BlenderCommandResult {
  status: 'ok' | 'error';
  result?: any;
  message?: string;
}

/**
 * Execute a command directly on the Blender TCP socket server via Rust backend
 */
export async function executeBlenderCommand(
  command: string,
  params: Record<string, any> = {},
  host = '127.0.0.1',
  port = 9876
): Promise<BlenderCommandResult> {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      const resp = await invoke('blender_send_command', {
        host,
        port,
        command,
        params,
      });
      return resp as BlenderCommandResult;
    } catch (err: any) {
      return {
        status: 'error',
        message: typeof err === 'string' ? err : err?.message || String(err),
      };
    }
  }

  // Fallback for browser testing
  console.warn(`[Blender Mock] Command '${command}'`, params);
  return {
    status: 'ok',
    result: { mock: true, command, params },
  };
}

export async function checkBlenderConnection(host = '127.0.0.1', port = 9876): Promise<boolean> {
  const invoke = await getInvoke();
  if (invoke) {
    try {
      return await invoke('blender_check_connection', { host, port });
    } catch {
      return false;
    }
  }
  return false;
}

export async function launchBlenderApp(): Promise<string> {
  const invoke = await getInvoke();
  if (invoke) {
    return await invoke('blender_launch', {});
  }
  return 'Not in Tauri environment';
}

import assetCatalog from '../assets/asset_catalog.json';

export async function getSceneInfo(host = '127.0.0.1', port = 9876): Promise<SceneInfo | null> {
  const res = await executeBlenderCommand('get_scene_info', {}, host, port);
  if (res.status === 'ok' && res.result) {
    return res.result as SceneInfo;
  }
  return null;
}

export async function setViewportShading(
  mode: 'WIREFRAME' | 'SOLID' | 'MATERIAL' | 'RENDERED',
  host = '127.0.0.1',
  port = 9876
): Promise<boolean> {
  const res = await executeBlenderCommand('set_viewport_shading', { mode }, host, port);
  return res.status === 'ok';
}

export async function focusObject(name: string, host = '127.0.0.1', port = 9876): Promise<boolean> {
  const res = await executeBlenderCommand('focus_on_object', { name, object_name: name }, host, port);
  return res.status === 'ok';
}

export async function setObjectVisibility(name: string, visible: boolean, host = '127.0.0.1', port = 9876): Promise<boolean> {
  const res = await executeBlenderCommand('set_object_visibility', { name, visible }, host, port);
  return res.status === 'ok';
}

export async function deleteObject(name: string, host = '127.0.0.1', port = 9876): Promise<boolean> {
  const res = await executeBlenderCommand('delete_object', { name }, host, port);
  return res.status === 'ok';
}

export async function addPrimitive(
  type: string,
  name?: string,
  location: [number, number, number] = [0, 0, 0],
  host = '127.0.0.1',
  port = 9876
): Promise<BlenderCommandResult> {
  return await executeBlenderCommand('create_object', {
    type,
    name: name || `${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`,
    location,
  }, host, port);
}

export async function runBlenderCode(code: string, host = '127.0.0.1', port = 9876): Promise<BlenderCommandResult> {
  return await executeBlenderCommand('execute_code', { code }, host, port);
}

export async function analyzeMeshQuality(name: string, host = '127.0.0.1', port = 9876): Promise<BlenderCommandResult> {
  return await executeBlenderCommand('analyze_mesh_quality', { name, object_name: name }, host, port);
}

export async function saveSceneCheckpoint(name = 'Checkpoint', host = '127.0.0.1', port = 9876): Promise<BlenderCommandResult> {
  const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filepath = `blend_ai_cp_${cleanName}_${Date.now()}.blend`;
  return await executeBlenderCommand('save_checkpoint', { name, filepath }, host, port);
}

export async function importAssetToScene(
  assetId: string,
  name?: string,
  location: [number, number, number] = [0, 0, 0],
  host = '127.0.0.1',
  port = 9876
): Promise<BlenderCommandResult> {
  const asset = (assetCatalog as any[]).find((a) => a.id === assetId);
  return await executeBlenderCommand('import_asset', {
    asset_id: assetId,
    name: name || asset?.name || '',
    model_path: asset?.model_path || '',
    location,
    snap_to_floor: true,
  }, host, port);
}

export interface ScannedAssetItem {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  dimensions_m?: { width: number; depth: number; height: number };
  model_path: string;
  format: string;
}

export interface ScanAssetResult {
  valid: boolean;
  path: string;
  total: number;
  categories: string[];
  assets: ScannedAssetItem[];
  message?: string;
}

export async function scanAssetDirectory(
  path: string,
  blenderHost = '127.0.0.1',
  blenderPort = 9876
): Promise<ScanAssetResult> {
  const cleanPath = path.trim().replace(/^["']|["']$/g, '');
  if (!cleanPath) {
    return {
      valid: false,
      path: '',
      total: 0,
      categories: [],
      assets: [],
      message: 'Please provide a directory path',
    };
  }

  const invoke = await getInvoke();
  if (invoke) {
    try {
      const resp = await invoke('scan_asset_directory', { path: cleanPath });
      if (resp && typeof resp === 'object' && (resp as any).valid) {
        return resp as ScanAssetResult;
      }
    } catch (e) {
      console.warn('Tauri scan_asset_directory failed, trying Blender TCP socket:', e);
    }
  }

  // Fallback to Blender TCP socket command
  const res = await executeBlenderCommand('scan_asset_library', { path: cleanPath }, blenderHost, blenderPort);
  if (res.status === 'ok' && res.result && res.result.valid) {
    return res.result as ScanAssetResult;
  }

  return {
    valid: false,
    path: cleanPath,
    total: 0,
    categories: [],
    assets: [],
    message: res.message || res.result?.message || 'Could not scan directory or no 3D models found',
  };
}

