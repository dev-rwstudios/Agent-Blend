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
      padding: '0 16px',
      height: '50px',
      backgroundColor: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-subtle)',
      zIndex: 50,
      flexShrink: 0,
    }}>
      {/* Brand & Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '7px',
          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 1px 8px rgba(99, 102, 241, 0.4)',
        }}>
          <Box size={16} color="#ffffff" />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', letterSpacing: '-0.02em', color: '#ffffff' }}>
            Agent-Blend
          </span>
          <span className="badge badge-zinc" style={{ fontSize: '10px', padding: '1px 5px' }}>
            v1.2.1
          </span>
        </div>
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Connection status indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          padding: '3px 10px',
          borderRadius: '999px',
          backgroundColor: blenderConnected ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)',
          border: `1px solid ${blenderConnected ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)'}`,
        }}>
          <div 
            className={blenderConnected ? 'pulse-dot' : ''}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: blenderConnected ? '#10b981' : '#f43f5e',
            }} 
          />
          <span style={{ fontSize: '11px', fontWeight: '600', color: blenderConnected ? '#34d399' : '#fb7185' }}>
            {blenderConnected ? 'Blender 5.1' : 'Blender Offline'}
          </span>
          {!blenderConnected && (
            <button 
              onClick={onLaunchBlender}
              className="btn btn-primary btn-sm"
              style={{ marginLeft: '4px', padding: '1px 7px', fontSize: '10px', height: '20px' }}
            >
              <Play size={9} /> Start
            </button>
          )}
        </div>

        <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-subtle)', margin: '0 2px' }} />

        {/* New Session Button */}
        <button 
          onClick={onNewChat}
          className="btn btn-secondary btn-sm"
          style={{ gap: '4px', fontSize: '11px' }}
          title="New Scene Conversation"
        >
          <Plus size={13} />
          <span>New Chat</span>
        </button>

        {/* Studio Inspector Toggle */}
        <button
          onClick={onToggleStudio}
          className={`btn btn-sm ${isStudioOpen ? 'btn-primary' : 'btn-secondary'}`}
          style={{ gap: '5px', fontSize: '11px' }}
          title={isStudioOpen ? 'Hide Studio Inspector' : 'Show Studio Inspector'}
        >
          {isStudioOpen ? <PanelRightClose size={13} /> : <PanelRight size={13} />}
          <span>Inspector</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px', color: 'var(--text-secondary)' }}
          title="Studio Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
};
