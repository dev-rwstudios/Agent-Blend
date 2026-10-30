import React from 'react';
import { 
  X, 
  Layers, 
  RefreshCw 
} from 'lucide-react';
import { OutlinerTab } from './OutlinerTab';
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
  sceneInfo,
  onRefreshScene,
}) => {
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

      {/* Outliner Body */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <OutlinerTab
          objects={sceneInfo?.objects || []}
          onRefresh={onRefreshScene}
          blenderHost={blenderHost}
          blenderPort={blenderPort}
        />
      </div>
    </aside>
  );
};
