import React, { useState } from 'react';
import { 
  X, 
  Camera, 
  Layers, 
  RefreshCw
} from 'lucide-react';
import { ViewportTab } from './ViewportTab';
import { OutlinerTab } from './OutlinerTab';
import { SceneInfo } from '../types';

interface StudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  blenderConnected: boolean;
  blenderHost: string;
  blenderPort: number;
  sceneInfo: SceneInfo | null;
  onRefreshScene: () => void;
}

export const StudioDrawer: React.FC<StudioDrawerProps> = ({
  isOpen,
  onClose,
  blenderConnected,
  blenderHost,
  blenderPort,
  sceneInfo,
  onRefreshScene,
}) => {
  const [activeTab, setActiveTab] = useState<'viewport' | 'outliner'>('viewport');

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
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-primary)',
      }}>
        {/* Segmented Switcher for Viewport & Outliner */}
        <div style={{
          display: 'flex',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px',
          gap: '2px',
        }}>
          <button
            onClick={() => setActiveTab('viewport')}
            className="btn btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 9px',
              fontSize: '11px',
              fontWeight: activeTab === 'viewport' ? '600' : '400',
              backgroundColor: activeTab === 'viewport' ? 'var(--bg-tertiary)' : 'transparent',
              color: activeTab === 'viewport' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: 'var(--radius-xs)',
              border: activeTab === 'viewport' ? '1px solid var(--border-medium)' : '1px solid transparent',
            }}
          >
            <Camera size={12} />
            <span>Viewport</span>
          </button>

          <button
            onClick={() => setActiveTab('outliner')}
            className="btn btn-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 9px',
              fontSize: '11px',
              fontWeight: activeTab === 'outliner' ? '600' : '400',
              backgroundColor: activeTab === 'outliner' ? 'var(--bg-tertiary)' : 'transparent',
              color: activeTab === 'outliner' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderRadius: 'var(--radius-xs)',
              border: activeTab === 'outliner' ? '1px solid var(--border-medium)' : '1px solid transparent',
            }}
          >
            <Layers size={12} />
            <span>Outliner {sceneInfo ? `(${sceneInfo.object_count})` : ''}</span>
          </button>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <button
            onClick={onRefreshScene}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px', color: 'var(--text-muted)' }}
            title="Refresh Scene"
          >
            <RefreshCw size={12} />
          </button>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px', color: 'var(--text-muted)' }}
            title="Hide Panel"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Tab Content Area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'viewport' ? (
          <ViewportTab
            blenderConnected={blenderConnected}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        ) : (
          <OutlinerTab
            objects={sceneInfo?.objects || []}
            onRefresh={onRefreshScene}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        )}
      </div>
    </aside>
  );
};
