import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  Hammer, 
  ListOrdered, 
  HelpCircle, 
  Check, 
  X, 
  Terminal, 
  Loader2, 
  Box, 
  Cpu, 
  Sun, 
  ShieldCheck,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { ChatMessage, AppSettings } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, mode: 'build' | 'plan' | 'ask') => void;
  onApproveTool: (messageId: string, toolId: string) => void;
  onRejectTool: (messageId: string, toolId: string) => void;
  onApproveAll: (messageId: string) => void;
  isGenerating: boolean;
  settings: AppSettings;
  onOpenSettings: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onApproveTool,
  onRejectTool,
  onApproveAll,
  isGenerating,
  settings,
  onOpenSettings,
}) => {
  const [inputText, setInputText] = useState('');
  const [currentMode, setCurrentMode] = useState<'build' | 'plan' | 'ask'>('build');
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const toggleToolExpanded = (id: string) => {
    setExpandedTools(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSend = () => {
    if (!inputText.trim() || isGenerating) return;
    onSendMessage(inputText.trim(), currentMode);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const starters = [
    {
      icon: Box,
      title: 'Furnish Living Room',
      desc: 'Add sofa, coffee table, and area rug snapped to floor',
      prompt: 'Furnish a living room scene with a modern sofa, coffee table, and rug snapped to the floor.',
    },
    {
      icon: Sun,
      title: '3-Point Studio Lighting',
      desc: 'Balanced key, fill, and rim lights with warm/cool tone',
      prompt: 'Set up a three-point studio lighting rig with key, fill, and rim lights.',
    },
    {
      icon: Sparkles,
      title: 'Gold Metallic Sphere',
      desc: 'PBR material with high metallic and low roughness',
      prompt: 'Create a smooth gold metallic sphere on the floor with high metallic and low roughness.',
    },
    {
      icon: ShieldCheck,
      title: 'Audit Mesh Topology',
      desc: 'Check for non-manifold edges and loose vertices',
      prompt: 'Analyze mesh quality and check the active scene objects for defects.',
    },
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      backgroundColor: 'var(--bg-app)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Scrollable Message Feed */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          width: '100%',
          maxWidth: '800px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          flex: 1,
        }}>
          {messages.length === 0 ? (
            /* Empty State Hero */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              margin: 'auto 0',
              padding: '36px 0',
              textAlign: 'center',
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '14px',
              }}>
                <Sparkles size={18} color="var(--text-primary)" />
              </div>

              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                marginBottom: '6px',
              }}>
                What would you like to build in Blender?
              </h2>

              <p style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                maxWidth: '440px',
                lineHeight: '1.5',
                marginBottom: '24px',
              }}>
                Natural language 3D creation. Describe models, materials, lights, or entire interior scenes.
              </p>

              {/* Starter Prompt Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                width: '100%',
              }}>
                {starters.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => onSendMessage(item.prompt, currentMode)}
                      className="glass-card"
                      style={{
                        padding: '12px 14px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <Icon size={14} color="var(--text-secondary)" />
                        <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {item.title}
                        </span>
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                        {item.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Message List */
            messages.map((msg) => (
              <div 
                key={msg.id} 
                className="animate-fade-in"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  width: '100%',
                }}
              >
                {/* User Message Bubble */}
                {msg.role === 'user' ? (
                  <div style={{
                    maxWidth: '82%',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 'var(--radius-md)',
                    padding: '9px 14px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    lineHeight: '1.5',
                  }}>
                    {msg.content}
                  </div>
                ) : (
                  /* Assistant Message Card */
                  <div style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-medium)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <Sparkles size={11} color="var(--text-primary)" />
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        Agent-Blend
                      </span>
                      {msg.mode && (
                        <span className="badge badge-zinc" style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                          {msg.mode}
                        </span>
                      )}
                    </div>

                    <div style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 14px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {msg.content}
                    </div>

                    {/* Tool Calls & Approvals Cards */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        marginTop: '2px',
                      }}>
                        {msg.toolCalls.filter(t => t.status === 'pending').length > 1 && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button 
                              onClick={() => onApproveAll(msg.id)}
                              className="btn btn-primary btn-sm"
                            >
                              <Check size={12} /> Approve All Actions ({msg.toolCalls.filter(t => t.status === 'pending').length})
                            </button>
                          </div>
                        )}

                        {msg.toolCalls.map((tc) => {
                          const isExpanded = !!expandedTools[tc.id];
                          return (
                            <div
                              key={tc.id}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-sm)',
                                borderLeft: `3px solid ${
                                  tc.status === 'completed' ? '#10b981' :
                                  tc.status === 'pending' ? '#f59e0b' :
                                  tc.status === 'rejected' ? '#ef4444' : '#3b82f6'
                                }`,
                              }}
                            >
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                              }}
                              onClick={() => toggleToolExpanded(tc.id)}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {isExpanded ? <ChevronDown size={12} color="var(--text-muted)" /> : <ChevronRight size={12} color="var(--text-muted)" />}
                                  <Terminal size={12} color="var(--text-secondary)" />
                                  <span className="font-mono" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                    {tc.name}
                                  </span>
                                  {/* Compact parameter summary */}
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    ({Object.keys(tc.args || {}).slice(0, 3).map(k => `${k}=${JSON.stringify(tc.args[k])}`).join(', ')})
                                  </span>
                                </div>
                                <span className={`badge ${
                                  tc.status === 'completed' ? 'badge-success' :
                                  tc.status === 'pending' ? 'badge-warning' :
                                  tc.status === 'rejected' ? 'badge-danger' : 'badge-blue'
                                }`} style={{ fontSize: '9px', textTransform: 'uppercase' }}>
                                  {tc.status}
                                </span>
                              </div>

                              {/* Expanded Parameters View */}
                              {isExpanded && (
                                <pre className="font-mono" style={{
                                  fontSize: '11px',
                                  color: 'var(--text-secondary)',
                                  backgroundColor: 'var(--bg-app)',
                                  border: '1px solid var(--border-subtle)',
                                  padding: '8px 10px',
                                  borderRadius: 'var(--radius-xs)',
                                  overflowX: 'auto',
                                  marginTop: '8px',
                                  marginBottom: 0,
                                }}>
                                  {JSON.stringify(tc.args, null, 2)}
                                </pre>
                              )}

                              {/* Approval Actions */}
                              {tc.status === 'pending' && (
                                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onApproveTool(msg.id, tc.id); }}
                                    className="btn btn-primary btn-sm"
                                    style={{ flex: 1 }}
                                  >
                                    <Check size={11} /> Approve
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onRejectTool(msg.id, tc.id); }}
                                    className="btn btn-secondary btn-sm"
                                    style={{ flex: 1, color: '#f87171' }}
                                  >
                                    <X size={11} /> Reject
                                  </button>
                                </div>
                              )}

                              {tc.error && (
                                <div style={{ fontSize: '11px', color: '#f87171', marginTop: '6px' }}>
                                  Error: {tc.error}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {isGenerating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px' }}>
              <Loader2 size={13} className="animate-spin" color="var(--text-secondary)" />
              <span>Executing Blender operations...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Modern Docked Composer */}
      <div style={{
        padding: '10px 20px 14px 20px',
        backgroundColor: 'transparent',
        flexShrink: 0,
      }}>
        <div style={{
          width: '100%',
          maxWidth: '800px',
          margin: '0 auto',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}>
          {/* Top Row: Mode Selector & Active Model */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Segmented Mode Selector */}
            <div style={{
              display: 'flex',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-xs)',
              padding: '2px',
              border: '1px solid var(--border-subtle)',
            }}>
              <button
                onClick={() => setCurrentMode('build')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'build' ? 'var(--bg-tertiary)' : 'transparent',
                  color: currentMode === 'build' ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: currentMode === 'build' ? '1px solid var(--border-medium)' : '1px solid transparent',
                  padding: '2px 7px',
                  fontSize: '11px',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <Hammer size={10} /> Build
              </button>
              <button
                onClick={() => setCurrentMode('plan')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'plan' ? 'var(--bg-tertiary)' : 'transparent',
                  color: currentMode === 'plan' ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: currentMode === 'plan' ? '1px solid var(--border-medium)' : '1px solid transparent',
                  padding: '2px 7px',
                  fontSize: '11px',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <ListOrdered size={10} /> Plan First
              </button>
              <button
                onClick={() => setCurrentMode('ask')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'ask' ? 'var(--bg-tertiary)' : 'transparent',
                  color: currentMode === 'ask' ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: currentMode === 'ask' ? '1px solid var(--border-medium)' : '1px solid transparent',
                  padding: '2px 7px',
                  fontSize: '11px',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <HelpCircle size={10} /> Ask
              </button>
            </div>

            {/* Model Indicator */}
            <button
              onClick={onOpenSettings}
              className="btn btn-ghost btn-sm"
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                gap: '4px',
                padding: '2px 6px',
              }}
              title="Click to configure provider & settings"
            >
              <Cpu size={11} color="var(--text-secondary)" />
              <span>{settings.provider.toUpperCase()} / {settings.model}</span>
            </button>
          </div>

          {/* Text Input Row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Describe 3D scene action (${currentMode} mode)...`}
              rows={2}
              style={{
                flex: 1,
                backgroundColor: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontSize: '13px',
                resize: 'none',
                lineHeight: '1.4',
                padding: '2px 0',
              }}
            />

            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isGenerating}
              className="btn btn-primary"
              style={{
                width: '30px',
                height: '30px',
                padding: 0,
                borderRadius: 'var(--radius-xs)',
                opacity: !inputText.trim() || isGenerating ? 0.3 : 1,
              }}
            >
              {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
        </div>

        <p style={{
          textAlign: 'center',
          fontSize: '10px',
          color: 'var(--text-disabled)',
          marginTop: '5px',
          margin: '5px 0 0 0',
        }}>
          Press Enter to send, Shift+Enter for newline.
        </p>
      </div>
    </div>
  );
};
