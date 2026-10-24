import React, { useState } from 'react';
import { 
  X, 
  Layers, 
  RefreshCw
} from 'lucide-react';
import { OutlinerTab } from './OutlinerTab';
import { SceneInfo } from '../types';
import { setViewportShading } from '../services/blender';

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
  const [activeShading, setActiveShading] = useState<'SOLID' | 'MATERIAL' | 'RENDERED' | 'WIREFRAME'>('SOLID');

  if (!isOpen) return null;

  const handleShadingChange = async (mode: 'SOLID' | 'MATERIAL' | 'RENDERED' | 'WIREFRAME') => {
    setActiveShading(mode);
    if (blenderConnected) {
      await setViewportShading(mode, blenderHost, blenderPort);
    }
  };

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

        {/* Real Blender Viewport Shading Switcher & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Shading mode segmented pill */}
          <div style={{
            display: 'flex',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-xs)',
            padding: '2px',
            border: '1px solid var(--border-subtle)',
          }}>
            {(['SOLID', 'MATERIAL', 'RENDERED', 'WIREFRAME'] as const).map((m) => (
              <button
                key={m}
                onClick={() => handleShadingChange(m)}
                title={`Set Blender 3D Viewport Shading to ${m}`}
                className="btn btn-sm"
                style={{
                  fontSize: '9px',
                  padding: '2px 5px',
                  fontWeight: activeShading === m ? '600' : '400',
                  backgroundColor: activeShading === m ? 'var(--bg-elevated)' : 'transparent',
                  color: activeShading === m ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: activeShading === m ? '1px solid var(--border-medium)' : '1px solid transparent',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                {m === 'WIREFRAME' ? 'Wire' : m.charAt(0) + m.slice(1, 4).toLowerCase()}
              </button>
            ))}
          </div>

          <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-subtle)' }} />

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
