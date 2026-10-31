/**
 * Projects and chats, persisted through services/storage.ts.
 *
 * Layout (relative to the app's workspace folder):
 *   state.json                          last active project/chat
 *   projects/<projectId>/
 *     project.json                      ProjectMeta (name, brief, asset sources, scene summary)
 *     scene.blend                       the project's Blender scene (written by Blender)
 *     bucket.json                       the project's Asset Bucket
 *     assets.json                       cached scan of the project's asset sources
 *     chats/<chatId>/meta.json          ChatMeta
 *     chats/<chatId>/messages.json      ChatMessage[]
 *   chats/<chatId>/...                  general chats (not attached to a project)
 *
 * A project folder is self-contained, so deleting (trashing) or backing up a
 * project is a single folder operation.
 */

import {
  AssetSource,
  BucketAsset,
  CatalogAsset,
  ChatMessage,
  ChatMeta,
  ProjectMeta,
} from '../types';
import { scanAssetDirectory } from './blender';
import * as storage from './storage';

const projectDir = (projectId: string) => `projects/${projectId}`;
const chatDir = (chat: Pick<ChatMeta, 'id' | 'projectId'>) =>
  chat.projectId ? `${projectDir(chat.projectId)}/chats/${chat.id}` : `chats/${chat.id}`;

// ---------------------------------------------------------------- app state

export interface AppState {
  activeProjectId: string | null;
  activeChatId: string | null;
}

export async function loadAppState(): Promise<AppState> {
  return (await storage.readJson<AppState>('state.json')) ?? { activeProjectId: null, activeChatId: null };
}

export async function saveAppState(state: AppState): Promise<void> {
  await storage.writeJson('state.json', state);
}

// ---------------------------------------------------------------- projects

export async function listProjects(): Promise<ProjectMeta[]> {
  const ids = await storage.list('projects');
  const metas = await Promise.all(ids.map((id) => storage.readJson<ProjectMeta>(`${projectDir(id)}/project.json`)));
  return metas.filter((m): m is ProjectMeta => m != null).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(input: {
  name: string;
  description: string;
  assetSources: AssetSource[];
}): Promise<ProjectMeta> {
  const now = Date.now();
  const project: ProjectMeta = {
    id: storage.newId(),
    name: input.name.trim(),
    description: input.description.trim(),
    assetSources: input.assetSources,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(project);
  return project;
}

export async function saveProject(project: ProjectMeta): Promise<void> {
  await storage.writeJson(`${projectDir(project.id)}/project.json`, project);
}

export async function trashProject(projectId: string): Promise<void> {
  await storage.trash(projectDir(projectId));
}

/** Absolute path of the project's scene.blend (null outside Tauri). */
export function projectScenePath(projectId: string): Promise<string | null> {
  return storage.absolutePath(`${projectDir(projectId)}/scene.blend`);
}

export function projectSceneExists(projectId: string): Promise<boolean> {
  return storage.exists(`${projectDir(projectId)}/scene.blend`);
}

export async function loadBucket(projectId: string): Promise<BucketAsset[]> {
  return (await storage.readJson<BucketAsset[]>(`${projectDir(projectId)}/bucket.json`)) ?? [];
}

export async function saveBucket(projectId: string, assets: BucketAsset[]): Promise<void> {
  await storage.writeJson(`${projectDir(projectId)}/bucket.json`, assets);
}

// ---------------------------------------------------------------- asset catalogs

export interface CatalogResult {
  assets: CatalogAsset[];
  /** One message per source that couldn't be scanned. */
  problems: string[];
}

interface CatalogCache extends CatalogResult {
  sourcesKey: string;
  scannedAt: number;
}

const sourcesKey = (sources: AssetSource[]) => sources.map((s) => s.path.trim()).sort().join('\n');

/** Scan asset source folders and merge them into one catalog (first source wins on duplicate ids). */
export async function scanSources(sources: AssetSource[]): Promise<CatalogResult> {
  const seen = new Set<string>();
  const assets: CatalogAsset[] = [];
  const problems: string[] = [];
  for (const source of sources) {
    const result = await scanAssetDirectory(source.path);
    if (!result.valid) {
      problems.push(`${source.path}: ${result.message || 'could not be scanned'}`);
      continue;
    }
    for (const a of result.assets) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      assets.push({ ...a, subcategory: a.subcategory || '' } as CatalogAsset);
    }
  }
  return { assets, problems };
}

/** The project's asset catalog — cached in assets.json and rescanned when its sources change or on request. */
export async function loadProjectCatalog(project: ProjectMeta, rescan = false): Promise<CatalogResult> {
  const path = `${projectDir(project.id)}/assets.json`;
  const key = sourcesKey(project.assetSources);
  if (!rescan) {
    const cached = await storage.readJson<CatalogCache>(path);
    if (cached && cached.sourcesKey === key) return { assets: cached.assets, problems: cached.problems };
  }
  const result = await scanSources(project.assetSources);
  await storage.writeJson(path, { ...result, sourcesKey: key, scannedAt: Date.now() } satisfies CatalogCache);
  return result;
}

// ---------------------------------------------------------------- chats

export async function listChats(projectId: string | null): Promise<ChatMeta[]> {
  const base = projectId ? `${projectDir(projectId)}/chats` : 'chats';
  const ids = await storage.list(base);
  const metas = await Promise.all(ids.map((id) => storage.readJson<ChatMeta>(`${base}/${id}/meta.json`)));
  return metas.filter((m): m is ChatMeta => m != null).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A new chat that only exists in memory until its first message is saved. */
export function newChat(projectId: string | null): ChatMeta {
  const now = Date.now();
  return { id: storage.newId(), title: 'New chat', projectId, createdAt: now, updatedAt: now, messageCount: 0 };
}

export async function loadChatMessages(chat: ChatMeta): Promise<ChatMessage[]> {
  return (await storage.readJson<ChatMessage[]>(`${chatDir(chat)}/messages.json`)) ?? [];
}

/** Persist a chat. Empty chats are never written, so "New chat" leaves no clutter. */
export async function saveChat(chat: ChatMeta, messages: ChatMessage[]): Promise<ChatMeta> {
  if (messages.length === 0) return chat;
  const firstUser = messages.find((m) => m.role === 'user');
  const title =
    chat.title === 'New chat' && firstUser ? titleFrom(firstUser.content) : chat.title;
  const updated: ChatMeta = { ...chat, title, updatedAt: Date.now(), messageCount: messages.length };
  await storage.writeJson(`${chatDir(chat)}/messages.json`, messages);
  await storage.writeJson(`${chatDir(chat)}/meta.json`, updated);
  return updated;
}

export async function renameChat(chat: ChatMeta, title: string): Promise<ChatMeta> {
  const updated = { ...chat, title: title.trim() || chat.title };
  if (chat.messageCount > 0) await storage.writeJson(`${chatDir(chat)}/meta.json`, updated);
  return updated;
}

export async function trashChat(chat: ChatMeta): Promise<void> {
  await storage.trash(chatDir(chat));
}

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine || 'New chat';
}
