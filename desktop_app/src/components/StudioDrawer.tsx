import React, { useState } from 'react';
import { 
  X, 
  Layers, 
  RefreshCw,
  Box
} from 'lucide-react';
import { OutlinerTab } from './OutlinerTab';
import { AssetsTab } from './AssetsTab';
import { SceneInfo } from '../types';

interface StudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  blenderConnected?: boolean;
  blenderHost: string;
  blenderPort: number;
  assetsPath?: string;
  onSaveAssetsPath?: (newPath: string) => void;
  sceneInfo: SceneInfo | null;
  onRefreshScene: () => void;
}

export const StudioDrawer: React.FC<StudioDrawerProps> = ({
  isOpen,
  onClose,
  blenderHost,
  blenderPort,
  assetsPath,
  onSaveAssetsPath,
  sceneInfo,
  onRefreshScene,
}) => {
  const [activeTab, setActiveTab] = useState<'outliner' | 'assets'>('outliner');

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
      {/* Studio Drawer Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-primary)',
      }}>
        {/* Title and Object Count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <Layers size={14} color="var(--text-secondary)" />
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
            Scene Inspector
          </span>
          <span className="badge badge-zinc" style={{ fontSize: '10px', padding: '1px 5px' }}>
            {sceneInfo?.object_count || 0} objects
          </span>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={onRefreshScene}
            className="btn btn-ghost btn-sm"
            style={{ padding: '3px', color: 'var(--text-muted)' }}
            title="Refresh Scene Tree"
          >
            <RefreshCw size={12} />
          </button>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '3px', color: 'var(--text-muted)' }}
            title="Hide Panel"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Tabs Header */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-secondary)',
      }}>
        <button
          onClick={() => setActiveTab('outliner')}
          style={{
            flex: 1,
            padding: '7px 10px',
            fontSize: '11px',
            fontWeight: '600',
            color: activeTab === 'outliner' ? 'var(--text-primary)' : 'var(--text-muted)',
            backgroundColor: activeTab === 'outliner' ? 'var(--bg-primary)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'outliner' ? '2px solid var(--accent, #6366f1)' : '2px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <Layers size={12} />
          <span>Outliner ({sceneInfo?.object_count || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('assets')}
          style={{
            flex: 1,
            padding: '7px 10px',
            fontSize: '11px',
            fontWeight: '600',
            color: activeTab === 'assets' ? 'var(--text-primary)' : 'var(--text-muted)',
            backgroundColor: activeTab === 'assets' ? 'var(--bg-primary)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'assets' ? '2px solid var(--accent, #6366f1)' : '2px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <Box size={12} />
          <span>Asset Library</span>
        </button>
      </div>

      {/* Drawer Body */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'outliner' ? (
          <OutlinerTab
            objects={sceneInfo?.objects || []}
            onRefresh={onRefreshScene}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
          />
        ) : (
          <AssetsTab
            onRefresh={onRefreshScene}
            blenderHost={blenderHost}
            blenderPort={blenderPort}
            assetsPath={assetsPath}
            onSaveAssetsPath={onSaveAssetsPath}
          />
        )}
      </div>
    </aside>
  );
};
