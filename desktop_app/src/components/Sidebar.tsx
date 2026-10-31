import React, { useState } from 'react';
import {
  Plus,
  FolderPlus,
  Box,
  MessageSquare,
  MessagesSquare,
  Pencil,
  Trash2,
  Settings2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { ChatMeta, ProjectMeta } from '../types';

interface SidebarProps {
  projects: ProjectMeta[];
  /** Saved chats of the active project. */
  projectChats: ChatMeta[];
  generalChats: ChatMeta[];
  activeProjectId: string | null;
  activeChatId: string | null;
  /** Switching is blocked while the AI is working or a scene is loading. */
  disabled: boolean;
  onNewGeneralChat: () => void;
  onNewProject: () => void;
  onOpenProject: (project: ProjectMeta) => void;
  onEditProject: (project: ProjectMeta) => void;
  onDeleteProject: (project: ProjectMeta) => void;
  onNewProjectChat: (project: ProjectMeta) => void;
  onOpenChat: (chat: ChatMeta) => void;
  onRenameChat: (chat: ChatMeta, title: string) => void;
  onDeleteChat: (chat: ChatMeta) => void;
}

const sectionTitle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  padding: '0 8px',
};

export const Sidebar: React.FC<SidebarProps> = ({
  projects,
  projectChats,
  generalChats,
  activeProjectId,
  activeChatId,
  disabled,
  onNewGeneralChat,
  onNewProject,
  onOpenProject,
  onEditProject,
  onDeleteProject,
  onNewProjectChat,
  onOpenChat,
  onRenameChat,
  onDeleteChat,
}) => {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '5px 8px',
    borderRadius: 'var(--radius-xs)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    backgroundColor: active ? 'var(--bg-active)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '12px',
    opacity: disabled && !active ? 0.6 : 1,
  });

  const deleteControls = (key: string, onConfirm: () => void, title: string) =>
    confirmDelete === key ? (
      <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }} onClick={(e) => e.stopPropagation()}>
        <span style={{ fontSize: '10px', color: '#f87171' }}>Delete?</span>
        <button className="btn btn-ghost btn-sm" style={{ padding: '2px', color: '#f87171' }} title="Confirm delete"
          onClick={() => { setConfirmDelete(null); onConfirm(); }}>
          <Check size={11} />
        </button>
        <button className="btn btn-ghost btn-sm" style={{ padding: '2px' }} title="Cancel"
          onClick={() => setConfirmDelete(null)}>
          <X size={11} />
        </button>
      </span>
    ) : (
      <button className="btn btn-ghost btn-sm" style={{ padding: '2px' }} title={title} disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setConfirmDelete(key); }}>
        <Trash2 size={11} />
      </button>
    );

  const chatRow = (chat: ChatMeta, indent: boolean) => {
    const active = chat.id === activeChatId;
    const isRenaming = renaming?.id === chat.id;
    return (
      <div
        key={chat.id}
        className="sidebar-row"
        style={{ ...rowStyle(active), paddingLeft: indent ? '26px' : '8px' }}
        onClick={() => !disabled && !isRenaming && !active && onOpenChat(chat)}
        title={chat.title}
      >
        <MessageSquare size={12} style={{ flexShrink: 0 }} />
        {isRenaming ? (
          <input
            autoFocus
            value={renaming.title}
            onChange={(e) => setRenaming({ id: chat.id, title: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onRenameChat(chat, renaming.title); setRenaming(null); }
              if (e.key === 'Escape') setRenaming(null);
            }}
            onBlur={() => { onRenameChat(chat, renaming.title); setRenaming(null); }}
            style={{ flex: 1, minWidth: 0, padding: '1px 4px', fontSize: '12px' }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chat.title}
          </span>
        )}
        {!isRenaming && (
          <span className="row-actions" style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
            {confirmDelete !== `chat:${chat.id}` && (
              <button className="btn btn-ghost btn-sm" style={{ padding: '2px' }} title="Rename" disabled={disabled}
                onClick={(e) => { e.stopPropagation(); setRenaming({ id: chat.id, title: chat.title }); }}>
                <Pencil size={11} />
              </button>
            )}
            {deleteControls(`chat:${chat.id}`, () => onDeleteChat(chat), 'Delete chat')}
          </span>
        )}
      </div>
    );
  };

  return (
    <aside style={{
      width: '250px',
      height: '100%',
      flexShrink: 0,
      backgroundColor: 'var(--bg-primary)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: '1px solid var(--border-subtle)' }}>
        <button onClick={onNewGeneralChat} disabled={disabled} className="btn btn-secondary btn-sm" style={{ justifyContent: 'flex-start' }}>
          <Plus size={12} /> New chat
        </button>
        <button onClick={onNewProject} disabled={disabled} className="btn btn-primary btn-sm" style={{ justifyContent: 'flex-start' }}>
          <FolderPlus size={12} /> New project
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 6px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Projects */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={sectionTitle}>Projects</div>
          {projects.length === 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px 8px', lineHeight: 1.4 }}>
              No projects yet. A project is one scene with its own brief, assets and chats.
            </div>
          )}
          {projects.map((project) => {
            const active = project.id === activeProjectId;
            const objectCount = project.sceneSummary?.objectCount;
            return (
              <div key={project.id}>
                <div
                  className="sidebar-row"
                  style={rowStyle(active && !activeChatId)}
                  onClick={() => !disabled && !active && onOpenProject(project)}
                  title={project.description || project.name}
                >
                  {active ? <ChevronDown size={12} style={{ flexShrink: 0 }} /> : <ChevronRight size={12} style={{ flexShrink: 0 }} />}
                  <Box size={12} style={{ flexShrink: 0, color: active ? '#60a5fa' : undefined }} />
                  <span style={{
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: active ? 600 : 400,
                  }}>
                    {project.name}
                  </span>
                  {objectCount != null && confirmDelete !== `project:${project.id}` && (
                    <span className="row-meta" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{objectCount}</span>
                  )}
                  <span className="row-actions" style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                    {confirmDelete !== `project:${project.id}` && (
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px' }} title="Project settings" disabled={disabled}
                        onClick={(e) => { e.stopPropagation(); onEditProject(project); }}>
                        <Settings2 size={11} />
                      </button>
                    )}
                    {deleteControls(`project:${project.id}`, () => onDeleteProject(project), 'Delete project')}
                  </span>
                </div>

                {active && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '1px' }}>
                    {projectChats.map((chat) => chatRow(chat, true))}
                    <div
                      style={{ ...rowStyle(false), paddingLeft: '26px', color: 'var(--text-muted)' }}
                      onClick={() => !disabled && onNewProjectChat(project)}
                    >
                      <Plus size={12} /> <span>New chat in project</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* General chats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: '5px' }}>
            <MessagesSquare size={10} /> Chats
          </div>
          {generalChats.length === 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px 8px', lineHeight: 1.4 }}>
              General chats can ask about any project or the asset library.
            </div>
          )}
          {generalChats.map((chat) => chatRow(chat, false))}
        </div>
      </div>
    </aside>
  );
};
