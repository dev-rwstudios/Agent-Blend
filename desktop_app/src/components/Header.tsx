import React from 'react';
import { 
  Box, 
  Settings, 
  PanelRight, 
  PanelRightClose, 
  Plus,
  Play
} from 'lucide-react';

interface HeaderProps {
  blenderConnected: boolean;
  onOpenSettings: () => void;
  onLaunchBlender: () => void;
  onNewChat: () => void;
  isStudioOpen: boolean;
  onToggleStudio: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  blenderConnected,
  onOpenSettings,
  onLaunchBlender,
  onNewChat,
  isStudioOpen,
  onToggleStudio,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Connection status indicator */}
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

        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 2px' }} />

        {/* New Session Button */}
        <button 
          onClick={onNewChat}
          className="btn btn-secondary btn-sm"
          style={{ gap: '4px' }}
          title="New Scene Chat"
        >
          <Plus size={12} />
          <span>New Chat</span>
        </button>

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
