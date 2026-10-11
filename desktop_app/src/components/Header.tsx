import React from 'react';
import { 
  Box, 
  Settings, 
  PanelRight, 
  PanelRightClose, 
  PlusCircle,
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
      padding: '0 20px',
      height: '56px',
      backgroundColor: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-subtle)',
      zIndex: 50,
      flexShrink: 0,
    }}>
      {/* Brand & Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '9px',
          background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 12px rgba(99, 102, 241, 0.35)',
        }}>
          <Box size={18} color="#ffffff" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: '700', letterSpacing: '-0.02em', color: '#ffffff' }}>
            Agent-Blend
          </span>
          <span className="badge badge-indigo" style={{ fontSize: '10px', padding: '1px 6px' }}>
            Studio
          </span>
        </div>
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Connection status indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          padding: '4px 12px',
          borderRadius: '999px',
          backgroundColor: blenderConnected ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)',
          border: `1px solid ${blenderConnected ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)'}`,
        }}>
          <div 
            className={blenderConnected ? 'pulse-dot' : ''}
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: blenderConnected ? '#10b981' : '#f43f5e',
            }} 
          />
          <span style={{ fontSize: '11px', fontWeight: '600', color: blenderConnected ? '#34d399' : '#fb7185' }}>
            {blenderConnected ? 'Blender Connected' : 'Blender Disconnected'}
          </span>
          {!blenderConnected && (
            <button 
              onClick={onLaunchBlender}
              className="btn btn-primary btn-sm"
              style={{ marginLeft: '4px', padding: '2px 8px', fontSize: '10px' }}
            >
              <Play size={10} /> Start
            </button>
          )}
        </div>

        {/* New Chat Button */}
        <button 
          onClick={onNewChat}
          className="btn btn-secondary btn-sm"
          title="Start New Chat"
        >
          <PlusCircle size={14} /> New Chat
        </button>

        {/* Toggle 3D Studio Panel Button */}
        <button 
          onClick={onToggleStudio}
          className={`btn btn-sm ${isStudioOpen ? 'btn-primary' : 'btn-secondary'}`}
          style={{ gap: '6px' }}
          title={isStudioOpen ? 'Close 3D Viewport & Studio' : 'Open 3D Viewport & Studio'}
        >
          {isStudioOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
          <span>3D Studio</span>
        </button>

        {/* Settings Button */}
        <button 
          onClick={onOpenSettings}
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px' }}
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
};
