import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { StudioDrawer } from './components/StudioDrawer';
import { SettingsModal } from './components/SettingsModal';

import { 
  SceneInfo, 
  ChatMessage, 
  CheckpointItem, 
  AppSettings, 
  ToolCall 
} from './types';
import { 
  checkBlenderConnection, 
  getSceneInfo, 
  addPrimitive, 
  executeBlenderCommand, 
  launchBlenderApp,
  saveSceneCheckpoint 
} from './services/blender';
import { sendChatMessage } from './services/llm';
import assetCatalog from './assets/asset_catalog.json';

const DEFAULT_SETTINGS: AppSettings = {
  blenderHost: '127.0.0.1',
  blenderPort: 9876,
  autoRefreshViewport: true,
  requireApprovals: true,
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
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const [blenderConnected, setBlenderConnected] = useState(false);
  const [sceneInfo, setSceneInfo] = useState<SceneInfo | null>(null);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Sync connection and scene info
  const refreshScene = useCallback(async () => {
    const connected = await checkBlenderConnection(settings.blenderHost, settings.blenderPort);
    setBlenderConnected(connected);
    if (connected) {
      const info = await getSceneInfo(settings.blenderHost, settings.blenderPort);
      if (info) setSceneInfo(info);
    }
  }, [settings.blenderHost, settings.blenderPort]);

  useEffect(() => {
    refreshScene();
    const interval = setInterval(refreshScene, 3500);
    return () => clearInterval(interval);
  }, [refreshScene]);

  // Execute a single tool call in Blender
  const runToolExecution = async (tool: ToolCall) => {
    tool.status = 'executing';
    try {
      let cmdName = tool.name;
      let args = { ...tool.args };

      if (cmdName === 'execute_blender_code') {
        cmdName = 'execute_code';
      } else if (cmdName === 'import_asset') {
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
    } catch (e: any) {
      tool.status = 'failed';
      tool.error = e.message || String(e);
    }
    await refreshScene();
  };

  // Handle user sending a prompt
  const handleSendMessage = async (text: string, mode: 'build' | 'plan' | 'ask') => {
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
      // Automatic pre-action checkpoint in build mode
      if (mode === 'build' && blenderConnected) {
        saveSceneCheckpoint(`Pre_${text.substring(0, 15)}`, settings.blenderHost, settings.blenderPort).catch(() => {});
      }

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
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If mode is build and user doesn't require approvals, auto-execute
      if (mode === 'build' && !settings.requireApprovals && res.toolCalls.length > 0) {
        for (const tc of res.toolCalls) {
          await runToolExecution(tc);
        }
        setMessages((prev) => [...prev]); // re-render
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          role: 'assistant',
          content: `Error processing request: ${err.message || String(err)}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveTool = async (messageId: string, toolId: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.toolCalls) return msg;
        const target = msg.toolCalls.find((t) => t.id === toolId);
        if (target) {
          runToolExecution(target).then(() => setMessages((m) => [...m]));
        }
        return msg;
      })
    );
  };

  const handleRejectTool = (messageId: string, toolId: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.toolCalls) return msg;
        return {
          ...msg,
          toolCalls: msg.toolCalls.map((tc) =>
            tc.id === toolId ? { ...tc, status: 'rejected' } : tc
          ),
        };
      })
    );
  };

  const handleApproveAll = async (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || !msg.toolCalls) return;

    for (const tc of msg.toolCalls) {
      if (tc.status === 'pending') {
        await runToolExecution(tc);
      }
    }
    setMessages((prev) => [...prev]);
  };

  const handleAddPrimitive = async (type: string) => {
    if (!blenderConnected) return;
    await addPrimitive(type, undefined, [0, 0, 1.0], settings.blenderHost, settings.blenderPort);
    await refreshScene();
  };

  const handleLaunchBlender = async () => {
    await launchBlenderApp();
    setTimeout(refreshScene, 2000);
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('agent_blend_settings', JSON.stringify(newSettings));
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
      {/* Clean Top Navigation Bar */}
      <Header
        blenderConnected={blenderConnected}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLaunchBlender={handleLaunchBlender}
        onNewChat={() => setMessages([])}
        isStudioOpen={isStudioOpen}
        onToggleStudio={() => setIsStudioOpen(!isStudioOpen)}
      />

      {/* Main Workspace: Prominent Centered Chat with Collapsible Studio Drawer */}
      <main style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Prominent Chat Stage (Centers conversation, takes 100% or remaining flex space) */}
        <div style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            onApproveTool={handleApproveTool}
            onRejectTool={handleRejectTool}
            onApproveAll={handleApproveAll}
            isGenerating={isGenerating}
            settings={settings}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </div>

        {/* Collapsible 3D Studio & Viewport Drawer */}
        <StudioDrawer
          isOpen={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          blenderConnected={blenderConnected}
          blenderHost={settings.blenderHost}
          blenderPort={settings.blenderPort}
          sceneInfo={sceneInfo}
          onRefreshScene={refreshScene}
          checkpoints={checkpoints}
          onAddCheckpoint={(cp) => setCheckpoints((prev) => [cp, ...prev])}
          onAddPrimitive={handleAddPrimitive}
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
