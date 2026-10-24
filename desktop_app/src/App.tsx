import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { StudioDrawer } from './components/StudioDrawer';
import { SettingsModal } from './components/SettingsModal';

import { 
  SceneInfo, 
  ChatMessage, 
  AppSettings, 
  ToolCall 
} from './types';
import { 
  checkBlenderConnection, 
  getSceneInfo, 
  executeBlenderCommand, 
  launchBlenderApp 
} from './services/blender';
import { sendChatMessage, checkModelHealth } from './services/llm';
import assetCatalog from './assets/asset_catalog.json';

const DEFAULT_SETTINGS: AppSettings = {
  blenderHost: '127.0.0.1',
  blenderPort: 9876,
  assetsPath: '',
  autoRefreshViewport: true,
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

  // Sync Blender connection and scene info
  const refreshScene = useCallback(async () => {
    const connected = await checkBlenderConnection(settings.blenderHost, settings.blenderPort);
    setBlenderConnected(connected);
    if (connected) {
      const info = await getSceneInfo(settings.blenderHost, settings.blenderPort);
      if (info) setSceneInfo(info);
    }
  }, [settings.blenderHost, settings.blenderPort]);

  // Sync AI model connection status
  const refreshModelHealth = useCallback(async () => {
    const status = await checkModelHealth(settings);
    setModelStatus(status);
  }, [settings]);

  useEffect(() => {
    refreshScene();
    refreshModelHealth();
    const interval = setInterval(() => {
      refreshScene();
      refreshModelHealth();
    }, 3500);
    return () => clearInterval(interval);
  }, [refreshScene, refreshModelHealth]);

  // Execute a single tool call in Blender
  const runToolExecution = async (tool: ToolCall) => {
    tool.status = 'executing';
    try {
      let cmdName = tool.name;
      let args = { ...tool.args };

      if (cmdName === 'execute_blender_code') {
        cmdName = 'execute_code';
      } else if (cmdName === 'import_asset') {
        if (settings.assetsPath && !args.assets_path) {
          args.assets_path = settings.assetsPath;
        }
        if (!args.model_path && args.asset_id) {
          const found = (assetCatalog as any[]).find((a) => a.id === args.asset_id);
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
        tool.error = res.message || 'Operation failed in Blender';
      }
    } catch (err: any) {
      tool.status = 'failed';
      tool.error = err.message || String(err);
    }
  };

  const handleSendMessage = async (text: string, mode: 'build' | 'plan' | 'ask') => {
    if (!text.trim() || isGenerating) return;

    // 1-Click quick actions
    const lower = text.toLowerCase();
    if (lower.includes('open settings')) {
      setIsSettingsOpen(true);
      return;
    }

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      mode,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);

    try {
      const res = await sendChatMessage(
        text,
        mode,
        settings,
        messages.map((m) => ({ role: m.role, content: m.content }))
      );

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
      // In Build mode + autonomous setting, execute all safe constructive operations immediately!
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
      await refreshScene();
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
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    const tool = msg.toolCalls.find((t) => t.id === toolId);
    if (!tool || tool.status !== 'pending') return;

    await runToolExecution(tool);
    setMessages((prev) => [...prev]);
    await refreshScene();
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
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    for (const tool of msg.toolCalls) {
      if (tool.status === 'pending') {
        await runToolExecution(tool);
      }
    }
    setMessages((prev) => [...prev]);
    await refreshScene();
  };

  const handleExecutePlan = async (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    for (const tool of msg.toolCalls) {
      await runToolExecution(tool);
    }
    if (msg.plan) {
      msg.plan.canExecute = false; // Mark executed
    }
    setMessages((prev) => [...prev]);
    await refreshScene();
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
        onNewChat={() => setMessages([])}
        isStudioOpen={isStudioOpen}
        onToggleStudio={() => setIsStudioOpen(!isStudioOpen)}
      />

      {/* Main Studio Workbench */}
      <main style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
      }}>
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
            onSendMessage={handleSendMessage}
            onApproveTool={handleApproveTool}
            onRejectTool={handleRejectTool}
            onApproveAll={handleApproveAll}
            onExecutePlan={handleExecutePlan}
            isGenerating={isGenerating}
            settings={settings}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </div>

        {/* Docked Scene Inspector (Viewport & Outliner) */}
        <StudioDrawer
          isOpen={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          blenderConnected={blenderConnected}
          blenderHost={settings.blenderHost}
          blenderPort={settings.blenderPort}
          sceneInfo={sceneInfo}
          onRefreshScene={refreshScene}
        />
      </main>

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
