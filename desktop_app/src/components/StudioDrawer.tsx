import React, { useState } from 'react';
import { 
  X, 
  Camera, 
  Layers, 
  Package, 
  Bookmark, 
  Activity,
  Plus,
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
  onAddPrimitive: (type: string) => void;
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
  onAddPrimitive,
}) => {
  const [activeTab, setActiveTab] = useState<'viewport' | 'outliner' | 'assets' | 'checkpoints' | 'diagnostics'>('viewport');
  const [showAddMenu, setShowAddMenu] = useState(false);

  if (!isOpen) return null;

  return (
    <aside style={{
      width: '500px',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      borderLeft: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      zIndex: 40,
      boxShadow: 'var(--shadow-lg)',
    }}>
      {/* Studio Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#f8fafc' }}>
            3D Studio
          </span>
          {sceneInfo && (
            <span className="badge badge-indigo" style={{ fontSize: '10px' }}>
              {sceneInfo.object_count} objects
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Quick Add Menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="btn btn-secondary btn-sm"
              style={{ padding: '3px 8px', fontSize: '11px' }}
              title="Add Primitive"
            >
              <Plus size={12} /> Add
            </button>

            {showAddMenu && (
              <div
                className="glass-panel"
                style={{
                  position: 'absolute',
                  top: '32px',
                  right: 0,
                  borderRadius: '10px',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  minWidth: '130px',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 100,
                }}
              >
                {['CUBE', 'SPHERE', 'PLANE', 'LIGHT', 'CAMERA'].map((type) => (
                  <button
                    key={type}
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'flex-start', fontSize: '11px' }}
                    onClick={() => {
                      onAddPrimitive(type);
                      setShowAddMenu(false);
                    }}
                  >
                    + {type.charAt(0) + type.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onRefreshScene}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px' }}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px' }}
            title="Close Drawer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-secondary)',
        padding: '2px 8px 0 8px',
        gap: '4px',
        overflowX: 'auto',
      }}>
        {[
          { id: 'viewport', label: 'Viewport', icon: Camera },
          { id: 'outliner', label: 'Outliner', icon: Layers },
          { id: 'assets', label: 'Assets (88)', icon: Package },
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
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: '600',
                borderRadius: '6px 6px 0 0',
                backgroundColor: isActive ? 'var(--bg-primary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                borderBottom: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
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
