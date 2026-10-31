/**
 * Thin wrapper over the Rust storage commands (src-tauri/src/storage.rs).
 * Paths are relative to the app's workspace folder, e.g. `projects/<id>/project.json`.
 *
 * In browser-only preview (`pnpm dev` outside Tauri) files are kept in
 * localStorage instead, so the UI still works — Blender scene files can't be
 * created there, of course.
 */

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const LS_PREFIX = 'agent_blend_fs:';

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function readText(path: string): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(LS_PREFIX + path);
  return invoke<string | null>('storage_read', { path });
}

export async function writeText(path: string, contents: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(LS_PREFIX + path, contents);
    return;
  }
  await invoke('storage_write', { path, contents });
}

export async function readJson<T>(path: string): Promise<T | null> {
  const text = await readText(path);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn(`Ignoring corrupt JSON in ${path}`);
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value, null, 2));
}

export async function exists(path: string): Promise<boolean> {
  if (!isTauri()) return localStorage.getItem(LS_PREFIX + path) != null;
  return invoke<boolean>('storage_exists', { path });
}

/** Names of the direct children of a stored directory. */
export async function list(dir: string): Promise<string[]> {
  if (!isTauri()) {
    const prefix = `${LS_PREFIX}${dir}/`;
    const names = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
    }
    return [...names].sort();
  }
  return invoke<string[]>('storage_list', { path: dir });
}

/** Move a file or folder to the workspace's .trash (recoverable). */
export async function trash(path: string): Promise<void> {
  if (!isTauri()) {
    for (const key of Object.keys(localStorage)) {
      if (key === LS_PREFIX + path || key.startsWith(`${LS_PREFIX}${path}/`)) localStorage.removeItem(key);
    }
    return;
  }
  await invoke('storage_trash', { path });
}

/** Absolute on-disk path for a stored file, or null outside Tauri. */
export async function absolutePath(path: string): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('storage_abs_path', { path });
}

export async function defaultAssetLibrary(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('default_asset_library');
}

export function newId(): string {
  return crypto.randomUUID();
}
