import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { StudioDrawer } from './components/StudioDrawer';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { ProjectModal, ProjectFormResult } from './components/ProjectModal';

import { 
  SceneInfo, 
  ChatMessage, 
  AppSettings, 
  ToolCall,
  StagingManifest,
  BucketAsset,
  CatalogAsset,
  ChatMeta,
  ProjectMeta
} from './types';
import { 
  checkBlenderConnection, 
  getSceneInfo, 
  executeBlenderCommand, 
  launchBlenderApp 
} from './services/blender';
import { sendChatMessage, checkModelHealth, completeChat } from './services/llm';
import { setActiveCatalog, findAsset, activeCatalog } from './services/curator';
import * as projectsApi from './services/projects';
import {
  AddonOutdatedError,
  getOpenFile,
  openProjectScene,
  samePath,
  saveProjectScene,
} from './services/sceneSession';
import { generalContext, projectContext } from './services/chatContext';
import { absolutePath, defaultAssetLibrary } from './services/storage';
import { runScene } from './agent/stepAgent';
import type { WorkStep } from './agent/steps';
import type { AgentDeps, BuildRun } from './agent/buildAgent';
import type { AssetDims } from './agent/layout';
import type { ScenePlan } from './agent/plan';

/** Whether Blender is showing the active project's scene. */
type SceneStatus = 'none' | 'loading' | 'loaded' | 'other-file' | 'offline' | 'addon-outdated';

const basename = (p: string) => p.split(/[\\/]/).pop() || p;

const DEFAULT_SETTINGS: AppSettings = {
  blenderHost: '127.0.0.1',
  blenderPort: 9876,
  assetsPath: '',
  executionMode: 'autonomous',
  toolset: 'full',
  provider: 'ollama',
  model: 'llama3.1',
  apiKey: '',
  apiBaseUrl: 'http://localhost:11434',
  temperature: 0.7,
};

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('agent_blend_settings');
    if (!saved) return DEFAULT_SETTINGS;
    try {
      const parsed = JSON.parse(saved);
      if (!parsed.executionMode) {
        parsed.executionMode = 'autonomous';
      }
      if (parsed.provider === 'builtin') {
        parsed.provider = 'ollama';
        parsed.model = 'llama3.1';
        parsed.apiBaseUrl = 'http://localhost:11434';
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [blenderConnected, setBlenderConnected] = useState(false);
  const [modelStatus, setModelStatus] = useState<{ ok: boolean; message: string }>({
    ok: false,
    message: 'Checking Model...',
  });
  const [sceneInfo, setSceneInfo] = useState<SceneInfo | null>(null);
  const [isStudioOpen, setIsStudioOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [bucketAssets, setBucketAssets] = useState<BucketAsset[]>([]);

  // ---- Projects & chats -------------------------------------------------
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [generalChats, setGeneralChats] = useState<ChatMeta[]>([]);
  const [projectChats, setProjectChats] = useState<ChatMeta[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectMeta | null>(null);
  const [activeChat, setActiveChat] = useState<ChatMeta>(() => projectsApi.newChat(null));
  const [catalog, setCatalog] = useState<CatalogAsset[]>([]);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('none');
  const [otherFile, setOtherFile] = useState<{ path: string; dirty: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [projectModal, setProjectModal] = useState<{ open: boolean; project: ProjectMeta | null }>({
    open: false,
    project: null,
  });
  const [hydrated, setHydrated] = useState(false);

  // Refs give async callbacks (timers, debounced saves) the current values.
  const activeProjectRef = useRef(activeProject);
  const activeChatRef = useRef(activeChat);
  const messagesRef = useRef(messages);
  const bucketRef = useRef(bucketAssets);
  const sceneStatusRef = useRef(sceneStatus);
  const isSwitchingRef = useRef(isSwitching);
  const generalCatalogRef = useRef<CatalogAsset[] | null>(null);
  activeProjectRef.current = activeProject;
  activeChatRef.current = activeChat;
  messagesRef.current = messages;
  bucketRef.current = bucketAssets;
  sceneStatusRef.current = sceneStatus;
  isSwitchingRef.current = isSwitching;

  const conn = { host: settings.blenderHost, port: settings.blenderPort };

  const replaceProject = (updated: ProjectMeta) => {
    setProjects((list) => [updated, ...list.filter((p) => p.id !== updated.id)]);
    if (activeProjectRef.current?.id === updated.id) setActiveProject(updated);
  };

  const upsertChat = (chat: ChatMeta) => {
    const setList = chat.projectId ? setProjectChats : setGeneralChats;
    setList((list) => [chat, ...list.filter((c) => c.id !== chat.id)]);
  };

  // Debounced persistence of the active chat and the project's bucket.
  useEffect(() => {
    if (!hydrated || messages.length === 0) return;
    const chat = activeChatRef.current;
    const timer = setTimeout(async () => {
      try {
        const saved = await projectsApi.saveChat(chat, messages);
        if (activeChatRef.current.id === saved.id) setActiveChat(saved);
        upsertChat(saved);
      } catch (e: any) {
        setNotice(`Couldn't save chat: ${e?.message || e}`);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [messages, hydrated]);

  useEffect(() => {
    const project = activeProjectRef.current;
    if (!hydrated || !project) return;
    const timer = setTimeout(() => {
      projectsApi.saveBucket(project.id, bucketAssets).catch((e) => setNotice(`Couldn't save bucket: ${e?.message || e}`));
    }, 400);
    return () => clearTimeout(timer);
  }, [bucketAssets, hydrated]);

  useEffect(() => {
    setActiveCatalog(catalog);
  }, [catalog]);

  useEffect(() => {
    if (!hydrated) return;
    projectsApi
      .saveAppState({ activeProjectId: activeProject?.id ?? null, activeChatId: activeChat.messageCount > 0 ? activeChat.id : null })
      .catch(() => undefined);
  }, [activeProject?.id, activeChat.id, activeChat.messageCount, hydrated]);

  /** Catalog for general chats: the default library plus every project's sources. */
  const loadGeneralCatalog = async (projectList: ProjectMeta[]): Promise<CatalogAsset[]> => {
    if (generalCatalogRef.current) return generalCatalogRef.current;
    const defaultPath = settings.assetsPath.trim() || (await defaultAssetLibrary()) || '';
    const paths = new Set<string>(defaultPath ? [defaultPath] : []);
    projectList.forEach((p) => p.assetSources.forEach((s) => paths.add(s.path)));
    const result = await projectsApi.scanSources([...paths].map((path) => ({ id: path, path })));
    generalCatalogRef.current = result.assets;
    return result.assets;
  };

  /** Write the current chat, bucket and (if Blender has it open) project scene to disk. */
  const persistCurrent = async () => {
    const chat = activeChatRef.current;
    if (messagesRef.current.length > 0) upsertChat(await projectsApi.saveChat(chat, messagesRef.current));
    const project = activeProjectRef.current;
    if (!project) return;
    await projectsApi.saveBucket(project.id, bucketRef.current);
    if (sceneStatusRef.current === 'loaded') {
      try {
        const updated = await saveProjectScene(project, conn);
        if (updated) replaceProject(updated);
      } catch (e: any) {
        setNotice(`Couldn't save the scene of "${project.name}": ${e?.message || e}`);
      }
    }
  };

  /**
   * Make Blender show the project's scene. Refuses to discard unsaved work in
   * another file unless `discardOther` is set (the user confirmed in the banner).
   */
  const loadProjectScene = async (project: ProjectMeta, opts: { discardOther?: boolean; startFrom?: string } = {}) => {
    if (!(await checkBlenderConnection(conn.host, conn.port))) {
      setSceneStatus('offline');
      return;
    }
    setSceneStatus('loading');
    try {
      const [info, target] = await Promise.all([getOpenFile(conn), projectsApi.projectScenePath(project.id)]);
      if (samePath(info.filepath, target)) {
        setSceneStatus('loaded');
        setOtherFile(null);
        return;
      }
      if (info.is_dirty && !opts.discardOther) {
        setOtherFile({ path: info.filepath, dirty: true });
        setSceneStatus('other-file');
        return;
      }
      await openProjectScene(project, conn, opts.startFrom);
      setOtherFile(null);
      setSceneStatus('loaded');
      const updated = await saveProjectScene(project, conn);
      if (updated) replaceProject(updated);
    } catch (e: any) {
      if (e instanceof AddonOutdatedError) {
        setSceneStatus('addon-outdated');
      } else {
        setSceneStatus('other-file');
        setNotice(`Couldn't open the scene of "${project.name}": ${e?.message || e}`);
      }
    } finally {
      refreshScene();
    }
  };

  /** Enter a project: its chats, bucket, catalog, and (when Blender is up) its scene. */
  const enterProject = async (
    project: ProjectMeta,
    opts: { chatId?: string | null; startFrom?: string; openScene?: boolean } = {}
  ) => {
    const chats = await projectsApi.listChats(project.id);
    const chat = chats.find((c) => c.id === opts.chatId) ?? chats[0] ?? projectsApi.newChat(project.id);
    const [msgs, bucket] = await Promise.all([projectsApi.loadChatMessages(chat), projectsApi.loadBucket(project.id)]);
    setActiveProject(project);
    setProjectChats(chats);
    setActiveChat(chat);
    setMessages(msgs);
    setBucketAssets(bucket);
    setSceneStatus('none');
    setOtherFile(null);
    projectsApi.loadProjectCatalog(project).then((res) => {
      if (activeProjectRef.current?.id !== project.id) return;
      setCatalog(res.assets);
      if (res.problems.length) setNotice(`Some asset sources couldn't be scanned:\n${res.problems.join('\n')}`);
    });
    if (opts.openScene !== false) await loadProjectScene(project, { startFrom: opts.startFrom });
  };

  const enterGeneral = async (chat: ChatMeta | null) => {
    const target = chat ?? projectsApi.newChat(null);
    const msgs = chat ? await projectsApi.loadChatMessages(chat) : [];
    setActiveProject(null);
    setProjectChats([]);
    setActiveChat(target);
    setMessages(msgs);
    setBucketAssets([]);
    setSceneStatus('none');
    setOtherFile(null);
    loadGeneralCatalog(projects).then((assets) => {
      if (!activeProjectRef.current) setCatalog(assets);
    });
  };

  /** Run a context switch: persist what's open, then switch; never while the AI is working. */
  const switchTo = async (fn: () => Promise<void>) => {
    if (isGenerating || isSwitching) return;
    setIsSwitching(true);
    setNotice(null);
    try {
      await persistCurrent();
      await fn();
    } catch (e: any) {
      setNotice(e?.message || String(e));
    } finally {
      setIsSwitching(false);
    }
  };

  const handleOpenProject = (project: ProjectMeta) => switchTo(() => enterProject(project));

  const handleOpenChat = (chat: ChatMeta) =>
    switchTo(async () => {
      if (chat.projectId && chat.projectId === activeProjectRef.current?.id) {
        setActiveChat(chat);
        setMessages(await projectsApi.loadChatMessages(chat));
      } else if (chat.projectId) {
        const project = projects.find((p) => p.id === chat.projectId);
        if (project) await enterProject(project, { chatId: chat.id });
      } else {
        await enterGeneral(chat);
      }
    });

  const handleNewGeneralChat = () => switchTo(() => enterGeneral(null));

  const handleNewProjectChat = (project: ProjectMeta) =>
    switchTo(async () => {
      if (activeProjectRef.current?.id !== project.id) await enterProject(project);
      setActiveChat(projectsApi.newChat(project.id));
      setMessages([]);
    });

  const handleRenameChat = async (chat: ChatMeta, title: string) => {
    const updated = await projectsApi.renameChat(chat, title);
    upsertChat(updated);
    if (activeChatRef.current.id === chat.id) setActiveChat(updated);
  };

  const handleDeleteChat = (chat: ChatMeta) =>
    switchTo(async () => {
      await projectsApi.trashChat(chat);
      const setList = chat.projectId ? setProjectChats : setGeneralChats;
      setList((list) => list.filter((c) => c.id !== chat.id));
      if (activeChatRef.current.id === chat.id) {
        setActiveChat(projectsApi.newChat(chat.projectId));
        setMessages([]);
      }
    });

  const handleSubmitProject = async (form: ProjectFormResult) => {
    const editing = projectModal.project;
    if (editing) {
      const updated: ProjectMeta = {
        ...editing,
        name: form.name,
        description: form.description,
        assetSources: form.assetSources,
        updatedAt: Date.now(),
      };
      await projectsApi.saveProject(updated);
      replaceProject(updated);
      generalCatalogRef.current = null;
      if (activeProjectRef.current?.id === updated.id) {
        projectsApi.loadProjectCatalog(updated).then((res) => setCatalog(res.assets));
      }
      setProjectModal({ open: false, project: null });
      return;
    }
    const project = await projectsApi.createProject(form);
    setProjects((list) => [project, ...list]);
    generalCatalogRef.current = null;
    setProjectModal({ open: false, project: null });
    await switchTo(() => enterProject(project, { startFrom: form.startFrom }));
  };

  const handleDeleteProject = (project: ProjectMeta) =>
    switchTo(async () => {
      const wasActive = activeProjectRef.current?.id === project.id;
      const wasOpen = wasActive && sceneStatusRef.current === 'loaded';
      if (wasActive) await enterGeneral(null);
      // Detach Blender from the file before it moves to the trash.
      if (wasOpen) await executeBlenderCommand('new_file', {}, conn.host, conn.port);
      await projectsApi.trashProject(project.id);
      setProjects((list) => list.filter((p) => p.id !== project.id));
      generalCatalogRef.current = null;
    });

  const handleSaveScene = async () => {
    const project = activeProjectRef.current;
    if (!project) return;
    setIsSaving(true);
    try {
      const updated = await saveProjectScene(project, conn);
      if (updated) replaceProject(updated);
      else setNotice('The project scene isn\u2019t open in Blender, so there was nothing to save.');
    } catch (e: any) {
      setNotice(`Couldn't save the scene: ${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }
  };

  /** After the AI or the user changed the scene: refresh the inspector and save the project. */
  const afterSceneChange = async () => {
    await refreshScene();
    const project = activeProjectRef.current;
    if (!project || sceneStatusRef.current !== 'loaded') return;
    try {
      const updated = await saveProjectScene(project, conn);
      if (updated) replaceProject(updated);
    } catch (e: any) {
      setNotice(`Autosave failed: ${e?.message || e}`);
    }
  };

  // Restore the last session once on startup. The scene is NOT opened
  // automatically — that could discard unsaved work in Blender — the banner
  // offers it instead.
  useEffect(() => {
    (async () => {
      try {
        const [projectList, chats, state] = await Promise.all([
          projectsApi.listProjects(),
          projectsApi.listChats(null),
          projectsApi.loadAppState(),
        ]);
        setProjects(projectList);
        setGeneralChats(chats);
        const project = projectList.find((p) => p.id === state.activeProjectId);
        if (project) {
          await enterProject(project, { chatId: state.activeChatId, openScene: false });
        } else {
          const chat = chats.find((c) => c.id === state.activeChatId) ?? null;
          setActiveChat(chat ?? projectsApi.newChat(null));
          if (chat) setMessages(await projectsApi.loadChatMessages(chat));
          loadGeneralCatalog(projectList).then((assets) => {
            if (!activeProjectRef.current) setCatalog(assets);
          });
        }
      } catch (e: any) {
        setNotice(`Couldn't load projects: ${e?.message || e}`);
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddBucketAsset = (asset: BucketAsset) => {
    setBucketAssets((prev) => [...prev, asset]);
  };

  const handleRemoveBucketAsset = (id: string) => {
    setBucketAssets((prev) => prev.filter((a) => a.id !== id));
  };

  const handleApproveBucketAsset = (id: string) => {
    setBucketAssets((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'approved' } : a))
    );
  };

  const handleClearBucketAssets = () => {
    setBucketAssets([]);
  };

  /** Building is only allowed while Blender shows the active project's scene. */
  const ensureSceneReady = (): boolean => {
    const project = activeProjectRef.current;
    if (project && sceneStatusRef.current !== 'loaded') {
      setNotice(`Open the scene of "${project.name}" in Blender before building.`);
      return false;
    }
    return true;
  };

  const handleBuildBucketScene = async () => {
    if (!ensureSceneReady()) return;
    const approved = bucketAssets.filter((a) => a.status === 'approved');
    if (approved.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          role: 'assistant',
          content:
            '⚠️ There are no approved assets in your Asset Bucket! Please approve the proposed assets or import your own 3D models before building.',
          timestamp: Date.now(),
          mode: 'build',
        },
      ]);
      return;
    }

    setIsGenerating(true);
    try {
      for (const asset of approved) {
        let cmdName = 'import_asset';
        let args: any = {
          name: asset.name,
          location: asset.suggestedLocation || [0, 0, 0],
          snap_to_floor: true,
        };

        if (settings.assetsPath && !args.assets_path) {
          args.assets_path = settings.assetsPath;
        }

        if (asset.modelPath) {
          args.filepath = asset.modelPath;
          args.model_path = asset.modelPath;
        }
        if (asset.assetId) {
          args.asset_id = asset.assetId;
        }

        await executeBlenderCommand(
          cmdName,
          args,
          settings.blenderHost,
          settings.blenderPort
        );
      }

      await afterSceneChange();

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          role: 'assistant',
          content: `🎉 Successfully built scene into Blender using ONLY the ${approved.length} approved assets from your Asset Bucket:\n\n${approved
            .map((a, i) => `${i + 1}. **${a.name}** (${a.source === 'user' ? 'Custom Upload' : 'Library Asset'})`)
            .join('\n')}\n\nAll objects have been placed and snapped flat to the floor in Blender.`,
          timestamp: Date.now(),
          mode: 'build',
          suggestions: ['Inspect scene tree', 'Set up 3-point lighting', 'Render viewport preview'],
        },
      ]);
    } catch (err: any) {
      console.error('Failed to build bucket scene in Blender:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          role: 'assistant',
          content: `❌ Error building scene from bucket: ${err.message || String(err)}`,
          timestamp: Date.now(),
          mode: 'build',
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Sync Blender connection and scene info
  const refreshScene = useCallback(async () => {
    const connected = await checkBlenderConnection(settings.blenderHost, settings.blenderPort);
    setBlenderConnected(connected);
    if (connected) {
      const info = await getSceneInfo(settings.blenderHost, settings.blenderPort);
      if (info) setSceneInfo(info);
    }

    // Track whether Blender still shows the active project's scene (the user
    // may open another file by hand). Skipped mid-switch, when it's in flux.
    const project = activeProjectRef.current;
    const status = sceneStatusRef.current;
    if (!project || isSwitchingRef.current || status === 'loading') return;
    if (!connected) {
      setSceneStatus('offline');
      return;
    }
    try {
      const host = { host: settings.blenderHost, port: settings.blenderPort };
      const [file, target] = await Promise.all([getOpenFile(host), projectsApi.projectScenePath(project.id)]);
      if (activeProjectRef.current?.id !== project.id) return;
      if (samePath(file.filepath, target)) {
        setSceneStatus('loaded');
        setOtherFile(null);
      } else {
        setSceneStatus('other-file');
        setOtherFile({ path: file.filepath, dirty: file.is_dirty });
      }
    } catch (e) {
      if (e instanceof AddonOutdatedError) setSceneStatus('addon-outdated');
    }
  }, [settings.blenderHost, settings.blenderPort]);

  // Sync AI model connection status
  const refreshModelHealth = useCallback(async () => {
    const status = await checkModelHealth(settings);
    setModelStatus(status);
  }, [settings]);

  // Poll every 3.5 s, but never start a check while the previous one is still
  // waiting — a slow Blender would otherwise pile up requests behind each other.
  const sceneCheckInFlight = useRef(false);
  const modelCheckInFlight = useRef(false);
  useEffect(() => {
    const tick = () => {
      if (!sceneCheckInFlight.current) {
        sceneCheckInFlight.current = true;
        refreshScene().finally(() => (sceneCheckInFlight.current = false));
      }
      if (!modelCheckInFlight.current) {
        modelCheckInFlight.current = true;
        refreshModelHealth().finally(() => (modelCheckInFlight.current = false));
      }
    };
    tick();
    const interval = setInterval(tick, 3500);
    return () => clearInterval(interval);
  }, [refreshScene, refreshModelHealth]);

  // Execute a single tool call in Blender
  const runToolExecution = async (tool: ToolCall) => {
    tool.status = 'executing';
    try {
      // Save an undo point before anything that removes things from a project's scene
      // (the autosave right after would otherwise make the change permanent).
      const project = activeProjectRef.current;
      if (tool.isDestructive && project && sceneStatusRef.current === 'loaded') {
        const cp = await absolutePath(`projects/${project.id}/checkpoints/before-${tool.name}-${Date.now()}.blend`);
        if (cp) {
          const saved = await executeBlenderCommand('save_checkpoint', { name: tool.name, filepath: cp }, settings.blenderHost, settings.blenderPort);
          if (saved.status !== 'ok') throw new Error(`Couldn't save an undo point first, so nothing was changed: ${saved.message || saved.result}`);
          tool.checkpoint = cp;
        }
      }
      let cmdName = tool.name;
      let args = { ...tool.args };

      if (cmdName === 'execute_blender_code') {
        cmdName = 'execute_code';
      } else if (cmdName === 'import_asset') {
        if (settings.assetsPath && !args.assets_path) {
          args.assets_path = settings.assetsPath;
        }
        if (!args.model_path && args.asset_id) {
          const found = findAsset(args.asset_id);
          if (found?.model_path) {
            args.model_path = found.model_path;
          }
        }
      } else if (cmdName === 'create_principled_material') {
        if (!args.color && args.base_color) {
          args.color = args.base_color;
        }
      }

      const res = await executeBlenderCommand(
        cmdName,
        args,
        settings.blenderHost,
        settings.blenderPort
      );

      if (res.status === 'ok') {
        tool.status = 'completed';
        tool.result = res.result;
      } else {
        tool.status = 'failed';
        tool.error = res.message || (typeof res.result === 'string' ? res.result : 'Operation failed in Blender');
      }
    } catch (err: any) {
      tool.status = 'failed';
      tool.error = err.message || String(err);
    }
  };

  // ---- Build agent ------------------------------------------------------
  const buildAbortRef = useRef<AbortController | null>(null);
  // Real asset sizes measured in Blender, reused across runs this session.
  const measuredSizesRef = useRef<Record<string, AssetDims>>({});

  const agentDeps = (project: ProjectMeta): AgentDeps => ({
    llm: (msgs, o) => completeChat(settings, msgs, o),
    // Reads reference images. Uses the Vision model from Settings when one is set (the main model may be text-only).
    vision: (msgs, o) => completeChat({ ...settings, model: settings.visionModel?.trim() || settings.model }, msgs, { ...o, maxTokens: 1500 }),
    blender: async (command, params = {}) => {
      const res = await executeBlenderCommand(command, params, settings.blenderHost, settings.blenderPort);
      if (res.status !== 'ok') throw new Error(res.message || (typeof res.result === 'string' ? res.result : `Blender command '${command}' failed`));
      return res.result;
    },
    checkpointPath: (runId) => absolutePath(`projects/${project.id}/checkpoints/${runId}.blend`),
    // Generated code touched something it shouldn't have: put Blender back, and keep the project's scene file open.
    restore: async (checkpoint) => {
      const target = await projectsApi.projectScenePath(project.id);
      const open = await executeBlenderCommand('open_file', { filepath: checkpoint }, settings.blenderHost, settings.blenderPort);
      if (open.status !== 'ok') throw new Error(open.message || String(open.result));
      if (target) {
        const save = await executeBlenderCommand('save_file', { filepath: target }, settings.blenderHost, settings.blenderPort);
        if (save.status !== 'ok') throw new Error(save.message || String(save.result));
      }
    },
  });

  const updateBuildMessage = (messageId: string, run: BuildRun, content?: string) =>
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, buildRun: run, ...(content !== undefined ? { content } : {}) } : m)));

  const buildSummary = (run: BuildRun): string => {
    if (run.status === 'awaiting_approval') return 'Here is the plan. Review it, then build it or ask for changes.';
    if (run.status !== 'done') return run.error ? `The build ${run.status === 'stopped' ? 'was stopped' : 'failed'}: ${run.error}` : '';
    if (run.work?.length) {
      const met = run.work.filter((w) => w.status === 'passed' || w.status === 'unchecked').length;
      const bad = run.work.filter((w) => w.status === 'unmet' || w.status === 'failed').length;
      return `Built "${run.summary ?? 'the scene'}": ${met} of ${run.work.length} steps met${bad ? `, ${bad} not fully met` : ''}.`;
    }
    const count = (s: string) => run.checklist.filter((c) => c.status === s).length;
    const parts = [`${count('ok')} item(s) placed`];
    if (count('placeholder')) parts.push(`${count('placeholder')} placeholder(s) where the library had nothing suitable`);
    if (count('issue')) parts.push(`${count('issue')} with remaining issues`);
    if (count('missing')) parts.push(`${count('missing')} missing`);
    return `Built "${run.plan?.summary}": ${parts.join(', ')}.`;
  };

  /** Run the build agent for a request, showing progress in a card in the chat. */
  const startBuild = async (
    project: ProjectMeta,
    request: string,
    opts: { planOnly?: boolean; approvedPlan?: ScenePlan; approvedSteps?: WorkStep[]; prior?: { thinking: string; criteria: string[] }; reference?: { images: string[]; text?: string }; messageId?: string } = {}
  ): Promise<BuildRun> => {
    const messageId = opts.messageId ?? Math.random().toString(36).substring(7);
    if (!opts.messageId) {
      setMessages((prev) => [...prev, { id: messageId, role: 'assistant', content: '', timestamp: Date.now(), mode: opts.planOnly ? 'plan' : 'build' }]);
    }
    const controller = new AbortController();
    buildAbortRef.current = controller;
    setIsGenerating(true);
    try {
      const pool = catalog.length > 0 ? catalog : activeCatalog();
      const scene = sceneInfo
        ? `${sceneInfo.object_count} objects: ${(sceneInfo.objects || []).slice(0, 30).map((o) => o.name).join(', ')}`
        : undefined;
      const run = await runScene(agentDeps(project), {
        request,
        catalog: pool,
        preferredAssetIds: bucketAssets.filter((a) => a.status === 'approved' && a.assetId).map((a) => a.assetId!),
        brief: project.description,
        sceneSummary: scene,
        approvedPlan: opts.approvedPlan,
        approvedSteps: opts.approvedSteps,
        prior: opts.prior,
        reference: opts.reference,
        planOnly: opts.planOnly,
        captureImages: true,
        measuredSizes: measuredSizesRef.current,
        signal: controller.signal,
        onUpdate: (r) => updateBuildMessage(messageId, r),
      });
      if (run.status === 'not_layout') {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      } else {
        updateBuildMessage(messageId, run, buildSummary(run));
        if (run.status !== 'awaiting_approval') await afterSceneChange();
      }
      return run;
    } finally {
      buildAbortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleStopBuild = () => buildAbortRef.current?.abort();

  const handleRunBuildPlan = async (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    const project = activeProjectRef.current;
    if ((!msg?.buildRun?.plan && !msg?.buildRun?.work?.length) || !project || isGenerating) return;
    if (!ensureSceneReady()) return;
    await startBuild(project, msg.buildRun.request, {
      approvedPlan: msg.buildRun.work?.length ? undefined : msg.buildRun.plan,
      approvedSteps: msg.buildRun.work?.length ? msg.buildRun.work : undefined,
      // The picture was already read when the plan was made — don't read it again.
      reference: msg.buildRun.reference ? { images: msg.buildRun.reference.images, text: msg.buildRun.reference.text } : undefined,
      prior: { thinking: msg.buildRun.thinking ?? '', criteria: msg.buildRun.criteria ?? [] },
      messageId,
    });
  };

  /** Put the project's scene back to a saved checkpoint (it stays the project's open file). */
  const restoreCheckpoint = async (checkpoint: string, what: string) => {
    const project = activeProjectRef.current;
    if (!project || isGenerating) return;
    if (!ensureSceneReady()) return;
    setIsGenerating(true);
    try {
      const target = await projectsApi.projectScenePath(project.id);
      const open = await executeBlenderCommand('open_file', { filepath: checkpoint }, settings.blenderHost, settings.blenderPort);
      if (open.status !== 'ok') throw new Error(open.message || String(open.result));
      const save = await executeBlenderCommand('save_file', { filepath: target }, settings.blenderHost, settings.blenderPort);
      if (save.status !== 'ok') throw new Error(save.message || String(save.result));
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(36).substring(7), role: 'assistant', content: `↩️ Restored the scene to how it was before ${what}.`, timestamp: Date.now(), mode: 'build' },
      ]);
      await afterSceneChange();
    } catch (e: any) {
      setNotice(`Couldn't undo: ${e?.message || e}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUndoBuild = async (messageId: string) => {
    const run = messages.find((m) => m.id === messageId)?.buildRun;
    if (run?.checkpoint) await restoreCheckpoint(run.checkpoint, `"${run.summary ?? run.plan?.summary ?? 'the build'}"`);
  };

  const handleUndoTools = async (messageId: string) => {
    const tool = messages.find((m) => m.id === messageId)?.toolCalls?.find((t) => t.checkpoint && t.status === 'completed');
    if (tool?.checkpoint) await restoreCheckpoint(tool.checkpoint, 'that change');
  };

  /** Ask / general chats: answer a question about attached image(s) directly with the vision model. */
  const answerWithImages = async (text: string, images: string[], project: ProjectMeta | null) => {
    setIsGenerating(true);
    try {
      const contextNote = project ? projectContext(project, sceneInfo, sceneStatus === 'loaded', catalog, text) : generalContext(projects, catalog, text);
      const reply = await completeChat(
        { ...settings, model: settings.visionModel?.trim() || settings.model },
        [
          { role: 'system', content: `You are Agent-Blend, a 3D scene assistant for Blender. The user attached image(s). Answer concretely, in the context of 3D scenes: what is in the picture, what it would take to build it, which library assets could help.\n\n${contextNote}` },
          ...messages.slice(-6).filter((m) => m.role !== 'system' && m.content).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: text, images },
        ],
        { maxTokens: 1500, temperature: 0.4 }
      );
      setMessages((prev) => [...prev, { id: Math.random().toString(36).substring(7), role: 'assistant', content: reply, timestamp: Date.now(), mode: 'ask' }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { id: Math.random().toString(36).substring(7), role: 'assistant', content: `⚠️ ${e?.message || e}`, timestamp: Date.now(), mode: 'ask' }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async (text: string, mode: 'build' | 'plan' | 'ask', images?: string[]) => {
    if ((!text.trim() && !images?.length) || isGenerating) return;

    // 1-Click quick actions
    const lower = text.toLowerCase();
    if (lower.includes('open settings')) {
      setIsSettingsOpen(true);
      return;
    }

    if (
      lower === 'approve all & build' ||
      lower === 'build scene with staged assets' ||
      lower === 'build bucket'
    ) {
      setBucketAssets((prev) => prev.map((a) => ({ ...a, status: 'approved' })));
      setTimeout(() => {
        handleBuildBucketScene();
      }, 60);
      return;
    }

    const project = activeProject;
    const isGeneralChat = project == null;
    if (isGeneralChat) mode = 'ask';

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      mode,
      ...(images?.length ? { images } : {}),
    };

    // A project chat may only change Blender when Blender shows that project's scene.
    if (project && mode === 'build' && sceneStatus !== 'loaded') {
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: Math.random().toString(36).substring(7),
          role: 'assistant',
          content: `⚠️ The scene of "${project.name}" isn't open in Blender, so I can't build yet — that would change a different scene.\n\nUse the notice above the message box to open the project scene, then send your request again. (Ask and Plan modes still work.)`,
          timestamp: Date.now(),
          mode,
        },
      ]);
      return;
    }

    setMessages((prev) => [...prev, userMsg]);

    // Project Build/Plan requests go to the build agent (plan → build → verify → repair).
    // Requests that aren't about laying out a scene fall through to the one-shot tool flow.
    if (project && mode !== 'ask') {
      const run = await startBuild(project, text, { planOnly: mode === 'plan', reference: images?.length ? { images } : undefined });
      if (run.status !== 'not_layout') return;
    }

    // Ask / general chat with a picture: answer it directly (these modes never build).
    if (images?.length) {
      await answerWithImages(text, images, project);
      return;
    }

    setIsGenerating(true);

    try {
      const contextNote = project
        ? projectContext(project, sceneInfo, sceneStatus === 'loaded', catalog, text)
        : generalContext(projects, catalog, text);
      const res = await sendChatMessage(
        text,
        mode,
        settings,
        messages.map((m) => ({ role: m.role, content: m.content })),
        contextNote
      );
      // General chats never act on Blender, even if the model emits tool calls.
      if (isGeneralChat) res.toolCalls = [];

      const assistantMsg: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: res.reply,
        timestamp: Date.now(),
        mode,
        toolCalls: res.toolCalls,
        plan: res.plan,
        suggestions: res.suggestions,
      };

      // AUTONOMOUS PRODUCTION ENGINE:
      // In Build mode + autonomous setting, execute all safe constructive operations immediately (if not staging)
      if (mode === 'build' && res.toolCalls && res.toolCalls.length > 0) {
        if (settings.executionMode === 'autonomous') {
          for (const tc of res.toolCalls) {
            if (!tc.isDestructive) {
              await runToolExecution(tc);
            } else {
              // Destructive tools pause for explicit user confirmation
              tc.status = 'pending';
            }
          }
        }
      }

      setMessages((prev) => [...prev, assistantMsg]);
      if (!isGeneralChat) await afterSceneChange();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          role: 'assistant',
          content: `Notice: ${err.message || String(err)}`,
          timestamp: Date.now(),
          mode,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveTool = async (messageId: string, toolId: string) => {
    if (!ensureSceneReady()) return;
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    const tool = msg.toolCalls.find((t) => t.id === toolId);
    if (!tool || tool.status !== 'pending') return;

    await runToolExecution(tool);
    setMessages((prev) => [...prev]);
    await afterSceneChange();
  };

  const handleRejectTool = (messageId: string, toolId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    const tool = msg.toolCalls.find((t) => t.id === toolId);
    if (!tool) return;

    tool.status = 'rejected';
    setMessages((prev) => [...prev]);
  };

  const handleApproveAll = async (messageId: string) => {
    if (!ensureSceneReady()) return;
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    for (const tool of msg.toolCalls) {
      if (tool.status === 'pending') {
        await runToolExecution(tool);
      }
    }
    setMessages((prev) => [...prev]);
    await afterSceneChange();
  };

  const handleExecutePlan = async (messageId: string) => {
    if (!ensureSceneReady()) return;
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    for (const tool of msg.toolCalls) {
      await runToolExecution(tool);
    }
    if (msg.plan) {
      msg.plan.canExecute = false; // Mark executed
    }
    setMessages((prev) => [...prev]);
    await afterSceneChange();
  };

  const handleExecuteStaging = async (manifest: StagingManifest) => {
    if (!ensureSceneReady()) return;
    setIsGenerating(true);
    try {
      const selectedItems = manifest.items.filter((it) => it.selected);
      for (const item of selectedItems) {
        let cmdName = 'import_asset';
        let args: any = {
          name: item.name,
          location: item.suggestedLocation || [0, 0, 0],
          snap_to_floor: true,
        };

        if (settings.assetsPath && !args.assets_path) {
          args.assets_path = settings.assetsPath;
        }

        if (item.status === 'custom' && item.customPath) {
          args.filepath = item.customPath;
          args.model_path = item.customPath;
        } else if (item.assetId) {
          args.asset_id = item.assetId;
          if (item.modelPath) {
            args.model_path = item.modelPath;
          }
        }

        await executeBlenderCommand(
          cmdName,
          args,
          settings.blenderHost,
          settings.blenderPort
        );
      }

      manifest.isExecuted = true;
      setMessages((prev) => [...prev]);
      await afterSceneChange();
    } catch (err: any) {
      console.error('Failed to execute staged scene in Blender:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLaunchBlender = async () => {
    await launchBlenderApp();
    setTimeout(refreshScene, 2000);
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('agent_blend_settings', JSON.stringify(newSettings));
    refreshModelHealth();
  };

  const sceneNotice = (() => {
    if (!activeProject || sceneStatus === 'loaded' || sceneStatus === 'none') return null;
    switch (sceneStatus) {
      case 'loading':
        return { tone: 'info', text: `Opening the scene of "${activeProject.name}" in Blender…` };
      case 'offline':
        return { tone: 'warn', text: 'Blender isn\u2019t connected. Start Blender (with the blend-ai server running) to work on this project\u2019s scene.' };
      case 'addon-outdated':
        return { tone: 'error', text: 'The blend-ai addon in Blender is out of date and can\u2019t manage project scenes. Reinstall it from this repo (build.sh / build.ps1), then restart Blender.' };
      case 'other-file':
        return otherFile?.dirty
          ? {
              tone: 'warn',
              text: `Blender has unsaved changes in ${otherFile.path ? `"${basename(otherFile.path)}"` : 'an untitled file'}. Save them in Blender first, or discard them to open "${activeProject.name}".`,
              action: { label: 'Discard changes & open project', run: () => loadProjectScene(activeProject, { discardOther: true }) },
            }
          : {
              tone: 'warn',
              text: `Blender is showing ${otherFile?.path ? `"${basename(otherFile.path)}"` : 'a different file'}, not the scene of "${activeProject.name}".`,
              action: { label: 'Open project scene', run: () => loadProjectScene(activeProject) },
            };
    }
  })() as { tone: 'info' | 'warn' | 'error'; text: string; action?: { label: string; run: () => void } } | null;

  const toneColors = {
    info: { fg: '#60a5fa', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.3)' },
    warn: { fg: '#fbbf24', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.3)' },
    error: { fg: '#f87171', bg: 'rgba(248, 113, 113, 0.08)', border: 'rgba(248, 113, 113, 0.3)' },
  };
  const noticeBox = (tone: keyof typeof toneColors, text: string, extra?: React.ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', fontSize: '12px', lineHeight: 1.4,
      color: toneColors[tone].fg, backgroundColor: toneColors[tone].bg,
      border: `1px solid ${toneColors[tone].border}`, borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-line',
    }}>
      <span style={{ flex: 1 }}>{text}</span>
      {extra}
    </div>
  );
  const banner = (sceneNotice || notice) ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {sceneNotice && noticeBox(sceneNotice.tone, sceneNotice.text, sceneNotice.action && (
        <button className="btn btn-secondary btn-sm" onClick={sceneNotice.action.run} disabled={isSwitching || isGenerating}>
          {sceneNotice.action.label}
        </button>
      ))}
      {notice && noticeBox('error', notice, (
        <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)} style={{ padding: '2px 6px' }}>Dismiss</button>
      ))}
    </div>
  ) : null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      backgroundColor: 'var(--bg-app)',
      overflow: 'hidden',
    }}>
      {/* Studio Top Navigation Bar */}
      <Header
        blenderConnected={blenderConnected}
        modelStatus={modelStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLaunchBlender={handleLaunchBlender}
        isStudioOpen={isStudioOpen}
        onToggleStudio={() => setIsStudioOpen(!isStudioOpen)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        projectName={activeProject?.name ?? null}
        chatTitle={activeChat.title}
        onSaveScene={activeProject && sceneStatus === 'loaded' ? handleSaveScene : undefined}
        isSaving={isSaving}
      />

      {/* Main Studio Workbench */}
      <main style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {isSidebarOpen && (
          <Sidebar
            projects={projects}
            projectChats={projectChats}
            generalChats={generalChats}
            activeProjectId={activeProject?.id ?? null}
            activeChatId={activeChat.messageCount > 0 ? activeChat.id : null}
            disabled={isGenerating || isSwitching || !hydrated}
            onNewGeneralChat={handleNewGeneralChat}
            onNewProject={() => setProjectModal({ open: true, project: null })}
            onOpenProject={handleOpenProject}
            onEditProject={(project) => setProjectModal({ open: true, project })}
            onDeleteProject={handleDeleteProject}
            onNewProjectChat={handleNewProjectChat}
            onOpenChat={handleOpenChat}
            onRenameChat={handleRenameChat}
            onDeleteChat={handleDeleteChat}
          />
        )}

        {/* Central Action Stage */}
        <div style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-app)',
        }}>
          <ChatPanel
            messages={messages}
            bucketAssets={bucketAssets}
            onAddBucketAsset={handleAddBucketAsset}
            onRemoveBucketAsset={handleRemoveBucketAsset}
            onApproveBucketAsset={handleApproveBucketAsset}
            onClearBucketAssets={handleClearBucketAssets}
            onBuildBucketScene={handleBuildBucketScene}
            onSendMessage={handleSendMessage}
            onApproveTool={handleApproveTool}
            onRejectTool={handleRejectTool}
            onApproveAll={handleApproveAll}
            onExecutePlan={handleExecutePlan}
            onExecuteStaging={handleExecuteStaging}
            isGenerating={isGenerating || isSwitching}
            settings={settings}
            onOpenSettings={() => setIsSettingsOpen(true)}
            variant={activeProject ? 'project' : 'general'}
            onStopBuild={handleStopBuild}
            onRunBuildPlan={handleRunBuildPlan}
            onUndoBuild={handleUndoBuild}
            onUndoTools={handleUndoTools}
            projectName={activeProject?.name}
            banner={banner}
          />
        </div>

        {/* Docked Scene Inspector (Viewport, Outliner & Asset Library) */}
        <StudioDrawer
          isOpen={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          blenderConnected={blenderConnected}
          blenderHost={settings.blenderHost}
          blenderPort={settings.blenderPort}
          assetsPath={settings.assetsPath}
          onSaveAssetsPath={(newPath) => handleSaveSettings({ ...settings, assetsPath: newPath })}
          sceneInfo={sceneInfo}
          onRefreshScene={refreshScene}
        />
      </main>

      <ProjectModal
        isOpen={projectModal.open}
        project={projectModal.project}
        defaultAssetsPath={settings.assetsPath}
        onClose={() => setProjectModal({ open: false, project: null })}
        onSubmit={handleSubmitProject}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
};

export default App;
