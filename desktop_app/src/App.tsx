import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ChatPanel } from './components/ChatPanel';
import { StudioDrawer } from './components/StudioDrawer';
import { SettingsModal } from './components/SettingsModal';

import { 
  SceneInfo, 
  ChatMessage, 
  AppSettings, 
  ToolCall,
  StagingManifest,
  BucketAsset
} from './types';
import { 
  checkBlenderConnection, 
  getSceneInfo, 
  executeBlenderCommand, 
  launchBlenderApp 
} from './services/blender';
import { sendChatMessage, checkModelHealth } from './services/llm';
import { isSceneGenerationPrompt, curateSceneAssets } from './services/curator';
import assetCatalog from './assets/asset_catalog.json';

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

  const handleBuildBucketScene = async () => {
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

      await refreshScene();

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

      const stagingManifest = isSceneGenerationPrompt(text)
        ? curateSceneAssets(text)
        : undefined;

      if (stagingManifest) {
        // Stage agent proposed assets into the Scene Asset Bucket awaiting user permission
        const proposedBucketItems: BucketAsset[] = stagingManifest.items
          .filter((it) => it.status !== 'missing')
          .map((it) => {
            const ext = (it.modelPath || '').split('.').pop()?.toUpperCase() || 'GLB';
            return {
              id: it.id || Math.random().toString(36).substring(7),
              name: it.name,
              category: it.category || 'general',
              subcategory: it.subcategory,
              format: ext,
              source: 'agent' as const,
              modelPath: it.modelPath || '',
              assetId: it.assetId,
              dimensions_m: it.dimensions,
              status: 'pending' as const, // Awaits user permission!
              suggestedLocation: it.suggestedLocation,
            };
          });

        setBucketAssets((prev) => {
          const existingNames = new Set(prev.map((a) => a.name.toLowerCase()));
          const additions = proposedBucketItems.filter(
            (a) => !existingNames.has(a.name.toLowerCase())
          );
          return [...prev, ...additions];
        });
      }

      const missingItems = stagingManifest?.items.filter((it) => it.status === 'missing') || [];
      const missingWarning =
        missingItems.length > 0
          ? `\n\n⚠️ **Notice:** Can't find relevant assets in the local library for: ${missingItems
              .map((m) => `*${m.name}*`)
              .join(', ')}. You can easily import your own 3D model using the **+ Import Model** button inside the Asset Bucket!`
          : '';

      const assistantMsg: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: stagingManifest
          ? `I've analyzed your prompt and added recommended assets into your **Scene Asset Bucket** above awaiting your permission.\n\nReview the bucket: you can approve, reject, or import your own 3D models. The scene will be built using **ONLY** the approved assets in your bucket!${missingWarning}`
          : res.reply,
        timestamp: Date.now(),
        mode,
        toolCalls: stagingManifest ? undefined : res.toolCalls,
        plan: res.plan,
        staging: stagingManifest,
        suggestions: stagingManifest
          ? ['Approve all & build', '+ Import custom model', 'Browse library']
          : res.suggestions,
      };

      // AUTONOMOUS PRODUCTION ENGINE:
      // In Build mode + autonomous setting, execute all safe constructive operations immediately (if not staging)
      if (!stagingManifest && mode === 'build' && res.toolCalls && res.toolCalls.length > 0) {
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

  const handleExecuteStaging = async (manifest: StagingManifest) => {
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
      await refreshScene();
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
            isGenerating={isGenerating}
            settings={settings}
            onOpenSettings={() => setIsSettingsOpen(true)}
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
