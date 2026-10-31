import React from 'react';
import { 
  Box, 
  Settings, 
  PanelRight, 
  PanelRightClose, 
  Play,
  Save,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  ChevronRight
} from 'lucide-react';

interface HeaderProps {
  blenderConnected: boolean;
  modelStatus: { ok: boolean; message: string };
  onOpenSettings: () => void;
  onLaunchBlender: () => void;
  isStudioOpen: boolean;
  onToggleStudio: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Active project name, or null in a general chat. */
  projectName: string | null;
  chatTitle: string;
  /** Saves the active project's scene; omitted outside projects. */
  onSaveScene?: () => void;
  isSaving?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  blenderConnected,
  modelStatus,
  onOpenSettings,
  onLaunchBlender,
  isStudioOpen,
  onToggleStudio,
  isSidebarOpen,
  onToggleSidebar,
  projectName,
  chatTitle,
  onSaveScene,
  isSaving,
}) => {
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 14px',
      height: '44px',
      backgroundColor: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-subtle)',
      zIndex: 50,
      flexShrink: 0,
    }}>
      {/* Brand & Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <button
          onClick={onToggleSidebar}
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px', color: 'var(--text-secondary)' }}
          title={isSidebarOpen ? 'Hide projects & chats' : 'Show projects & chats'}
        >
          {isSidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
        </button>
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: 'var(--radius-xs)',
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Box size={13} color="var(--text-primary)" />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
            Agent-Blend
          </span>
          <span className="badge badge-zinc" style={{ fontSize: '10px', padding: '1px 5px' }}>
            Studio
          </span>
        </div>

        {/* Where am I: Project › Chat, or General chat */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '10px', minWidth: 0,
          fontSize: '12px', color: 'var(--text-secondary)',
        }}>
          {projectName ? (
            <>
              <span style={{ color: '#60a5fa', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>
                {projectName}
              </span>
              <ChevronRight size={12} color="var(--text-muted)" />
            </>
          ) : (
            <span className="badge badge-zinc" style={{ fontSize: '10px', padding: '1px 5px' }}>General</span>
          )}
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>
            {chatTitle}
          </span>
        </div>
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Blender Socket Connection status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '2px 8px',
          borderRadius: 'var(--radius-xs)',
          backgroundColor: blenderConnected ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          border: `1px solid ${blenderConnected ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
        }}>
          <div 
            className={blenderConnected ? 'pulse-dot' : ''}
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              backgroundColor: blenderConnected ? '#10b981' : '#ef4444',
            }} 
          />
          <span style={{ fontSize: '11px', fontWeight: '500', color: blenderConnected ? '#34d399' : '#f87171' }}>
            {blenderConnected ? 'Blender 5.1 Connected' : 'Blender Offline'}
          </span>
          {!blenderConnected && (
            <button 
              onClick={onLaunchBlender}
              className="btn btn-primary btn-sm"
              style={{ marginLeft: '4px', padding: '1px 6px', fontSize: '10px', height: '18px' }}
            >
              <Play size={8} /> Start
            </button>
          )}
        </div>

        {/* AI Model Status Indicator (Clickable to open settings) */}
        <div 
          onClick={onOpenSettings}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '2px 8px',
            borderRadius: 'var(--radius-xs)',
            backgroundColor: modelStatus.ok ? 'rgba(59, 130, 246, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            border: `1px solid ${modelStatus.ok ? 'rgba(59, 130, 246, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
            cursor: 'pointer',
          }}
          title="AI Model Status (Click to configure)"
        >
          <div 
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              backgroundColor: modelStatus.ok ? '#3b82f6' : '#f59e0b',
            }} 
          />
          <span style={{ fontSize: '11px', fontWeight: '500', color: modelStatus.ok ? '#60a5fa' : '#fbbf24' }}>
            {modelStatus.message}
          </span>
        </div>

        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 2px' }} />

        {/* Save the project's scene.blend */}
        {onSaveScene && (
          <button
            onClick={onSaveScene}
            disabled={isSaving}
            className="btn btn-secondary btn-sm"
            style={{ gap: '4px' }}
            title="Save the project's scene in Blender"
          >
            {isSaving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
            <span>Save scene</span>
          </button>
        )}

        {/* Studio Inspector Toggle */}
        <button
          onClick={onToggleStudio}
          className={`btn btn-sm ${isStudioOpen ? 'btn-primary' : 'btn-secondary'}`}
          style={{ gap: '4px' }}
          title={isStudioOpen ? 'Hide Scene Panel' : 'Show Scene Panel'}
        >
          {isStudioOpen ? <PanelRightClose size={12} /> : <PanelRight size={12} />}
          <span>Scene</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="btn btn-ghost btn-sm"
          style={{ padding: '5px', color: 'var(--text-secondary)' }}
          title="Studio Settings"
        >
          <Settings size={13} />
        </button>
      </div>
    </header>
  );
};
