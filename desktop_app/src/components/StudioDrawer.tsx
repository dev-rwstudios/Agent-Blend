import React, { useState } from 'react';
import { 
  X, 
  Camera, 
  Layers, 
  Package, 
  Bookmark, 
  Activity,
  RefreshCw
} from 'lucide-react';
import { ViewportTab } from './ViewportTab';
import { OutlinerTab } from './OutlinerTab';
import { AssetLibraryTab } from './AssetLibraryTab';
import { CheckpointsTab } from './CheckpointsTab';
import { DiagnosticsTab } from './DiagnosticsTab';
import { SceneInfo, CheckpointItem } from '../types';

interface StudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  blenderConnected: boolean;
  blenderHost: string;
  blenderPort: number;
  sceneInfo: SceneInfo | null;
  onRefreshScene: () => void;
  checkpoints: CheckpointItem[];
  onAddCheckpoint: (item: CheckpointItem) => void;
}

export const StudioDrawer: React.FC<StudioDrawerProps> = ({
  isOpen,
  onClose,
  blenderConnected,
  blenderHost,
  blenderPort,
  sceneInfo,
  onRefreshScene,
  checkpoints,
  onAddCheckpoint,
}) => {
  const [activeTab, setActiveTab] = useState<'viewport' | 'outliner' | 'assets' | 'checkpoints' | 'diagnostics'>('viewport');

  if (!isOpen) return null;

  return (
    <aside style={{
      width: '420px',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      borderLeft: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      zIndex: 40,
    }}>
      {/* Studio Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-primary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            Scene Inspector
          </span>
          {sceneInfo && (
            <span className="badge badge-zinc" style={{ fontSize: '10px' }}>
              {sceneInfo.object_count} objects
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={onRefreshScene}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px', color: 'var(--text-secondary)' }}
            title="Refresh Scene State"
          >
            <RefreshCw size={13} />
          </button>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px', color: 'var(--text-secondary)' }}
            title="Close Inspector"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Segmented Tabs Bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-secondary)',
        padding: '3px 6px',
        gap: '2px',
      }}>
        {[
          { id: 'viewport', label: 'Viewport', icon: Camera },
          { id: 'outliner', label: 'Outliner', icon: Layers },
          { id: 'assets', label: 'Assets', icon: Package },
          { id: 'checkpoints', label: 'History', icon: Bookmark },
          { id: 'diagnostics', label: 'Console', icon: Activity },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className="btn btn-sm"
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '5px 4px',
                fontSize: '11px',
                fontWeight: isActive ? '600' : '500',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-muted)',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <Icon size={12} color={isActive ? '#818cf8' : 'currentColor'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'viewport' && (
          <ViewportTab
            blenderConnected={blenderConnected}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        )}
        {activeTab === 'outliner' && (
          <OutlinerTab
            objects={sceneInfo?.objects || []}
            onRefresh={onRefreshScene}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        )}
        {activeTab === 'assets' && (
          <AssetLibraryTab
            onRefreshScene={onRefreshScene}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        )}
        {activeTab === 'checkpoints' && (
          <CheckpointsTab
            checkpoints={checkpoints}
            onAddCheckpoint={onAddCheckpoint}
            onRefreshScene={onRefreshScene}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        )}
        {activeTab === 'diagnostics' && (
          <DiagnosticsTab
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        )}
      </div>
    </aside>
  );
};
