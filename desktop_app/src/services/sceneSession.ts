/**
 * Keeps Blender's open file in step with the active project.
 *
 * Blender has one file open at a time, so each project owns a scene.blend in
 * its folder and switching projects means: save the current project's scene,
 * then open (or create) the next one. Every save first checks that Blender
 * really has *this* project's file open, so a scene the user opened by hand is
 * never written over a project.
 */

import { ProjectMeta, SceneInfo } from '../types';
import { executeBlenderCommand, getSceneInfo } from './blender';
import { projectScenePath, projectSceneExists, saveProject } from './projects';

export interface BlenderConn {
  host: string;
  port: number;
}

export interface OpenFileInfo {
  filepath: string;
  is_dirty: boolean;
  object_count: number;
}

/** Thrown when the installed Blender addon predates project support. */
export class AddonOutdatedError extends Error {}

async function command(conn: BlenderConn, name: string, params: Record<string, unknown> = {}) {
  const res = await executeBlenderCommand(name, params, conn.host, conn.port);
  if (res.status !== 'ok') {
    const msg = res.message || (typeof res.result === 'string' ? res.result : '') || `Blender command '${name}' failed`;
    if (/Unknown command/.test(msg)) {
      throw new AddonOutdatedError(
        'The blend-ai addon in Blender is out of date — reinstall it from this repo (build.sh / build.ps1) to use projects.'
      );
    }
    throw new Error(msg);
  }
  return res.result;
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const x = norm(a);
  const y = norm(b);
  // Windows paths are case-insensitive.
  return /^[a-z]:\//i.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export async function getOpenFile(conn: BlenderConn): Promise<OpenFileInfo> {
  return (await command(conn, 'get_file_info')) as OpenFileInfo;
}

/** Is Blender currently showing this project's scene? */
export async function isProjectOpen(project: ProjectMeta, conn: BlenderConn): Promise<boolean> {
  const [info, path] = await Promise.all([getOpenFile(conn), projectScenePath(project.id)]);
  return samePath(info.filepath, path);
}

function summarize(info: SceneInfo) {
  return {
    objectCount: info.object_count ?? info.objects?.length ?? 0,
    typeCounts: info.type_counts ?? {},
    objectNames: (info.objects ?? []).slice(0, 60).map((o) => o.name),
    capturedAt: Date.now(),
  };
}

/**
 * Save the project's scene if (and only if) Blender has it open, and refresh
 * the project's scene summary. Returns the updated project, or null when the
 * scene wasn't open so nothing was saved.
 */
export async function saveProjectScene(project: ProjectMeta, conn: BlenderConn): Promise<ProjectMeta | null> {
  const path = await projectScenePath(project.id);
  if (!path) return null;
  const info = await getOpenFile(conn);
  if (!samePath(info.filepath, path)) return null;

  await command(conn, 'save_file', { filepath: path });
  const scene = await getSceneInfo(conn.host, conn.port);
  const updated: ProjectMeta = {
    ...project,
    updatedAt: Date.now(),
    sceneSummary: scene ? summarize(scene) : project.sceneSummary,
  };
  await saveProject(updated);
  return updated;
}

/**
 * Make Blender show this project's scene: open its scene.blend, or — for a
 * brand-new project — start from `startFrom` (an existing .blend to copy) or
 * an empty scene, saved straight into the project folder.
 */
export async function openProjectScene(
  project: ProjectMeta,
  conn: BlenderConn,
  startFrom?: string
): Promise<void> {
  const path = await projectScenePath(project.id);
  if (!path) throw new Error('Projects need the desktop app (scene files can’t be created in browser preview).');

  if (await projectSceneExists(project.id)) {
    await command(conn, 'open_file', { filepath: path });
  } else if (startFrom && startFrom.trim()) {
    await command(conn, 'open_file', { filepath: startFrom.trim() });
    await command(conn, 'save_file', { filepath: path });
  } else {
    await command(conn, 'new_file', { filepath: path });
  }

  const info = await getOpenFile(conn);
  if (!samePath(info.filepath, path)) {
    throw new Error(`Blender opened '${info.filepath || 'an unsaved file'}' instead of the project scene.`);
  }
}
