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
  ShieldCheck 
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

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
      desc: 'Add a modern sofa, coffee table, and area rug',
      prompt: 'Furnish a living room scene with a modern sofa, coffee table, and rug snapped to the floor.',
    },
    {
      icon: Sun,
      title: '3-Point Lighting Rig',
      desc: 'Key, fill, and rim lights with warm/cool balance',
      prompt: 'Set up a three-point studio lighting rig with key, fill, and rim lights.',
    },
    {
      icon: Sparkles,
      title: 'Gold Metallic Sphere',
      desc: 'Smooth PBR sphere with high reflectance',
      prompt: 'Create a smooth gold metallic sphere on the floor with high metallic and low roughness.',
    },
    {
      icon: ShieldCheck,
      title: 'Inspect Mesh Topology',
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
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          width: '100%',
          maxWidth: '840px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          flex: 1,
        }}>
          {messages.length === 0 ? (
            /* Empty State Hero (ChatGPT / Chainlit style) */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              margin: 'auto 0',
              padding: '40px 0',
              textAlign: 'center',
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(6, 182, 212, 0.25) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '18px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
              }}>
                <Sparkles size={28} color="#818cf8" />
              </div>

              <h2 style={{
                fontSize: '22px',
                fontWeight: '700',
                color: '#ffffff',
                letterSpacing: '-0.02em',
                marginBottom: '8px',
              }}>
                What would you like to build?
              </h2>

              <p style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                maxWidth: '460px',
                lineHeight: '1.5',
                marginBottom: '32px',
              }}>
                Control your live Blender session through natural language. Describe models, materials, lighting, or full scene layouts.
              </p>

              {/* Starter Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '12px',
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
                        padding: '16px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        backgroundColor: 'var(--bg-secondary)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon size={16} color="#818cf8" />
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>
                          {item.title}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
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
                    maxWidth: '85%',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: '16px',
                    borderBottomRightRadius: '4px',
                    padding: '12px 18px',
                    color: '#ffffff',
                    fontSize: '14px',
                    lineHeight: '1.5',
                    boxShadow: 'var(--shadow-sm)',
                  }}>
                    {msg.content}
                  </div>
                ) : (
                  /* Assistant Message Card */
                  <div style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <Sparkles size={13} color="#ffffff" />
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>
                        Agent-Blend
                      </span>
                      {msg.mode && (
                        <span className={`badge ${
                          msg.mode === 'build' ? 'badge-indigo' : msg.mode === 'plan' ? 'badge-warning' : 'badge-cyan'
                        }`} style={{ fontSize: '10px' }}>
                          {msg.mode.toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '14px',
                      padding: '16px 20px',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      boxShadow: 'var(--shadow-sm)',
                    }}>
                      {msg.content}
                    </div>

                    {/* Tool Calls & Approvals Cards */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                        marginTop: '4px',
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

                        {msg.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className="glass-card"
                            style={{
                              padding: '12px 16px',
                              backgroundColor: tc.status === 'pending' ? 'rgba(30, 40, 65, 0.8)' : 'var(--bg-secondary)',
                              borderLeft: `3px solid ${
                                tc.status === 'completed' ? '#10b981' :
                                tc.status === 'pending' ? '#f59e0b' :
                                tc.status === 'rejected' ? '#f43f5e' : '#6366f1'
                              }`,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Terminal size={13} color="#818cf8" />
                                <span className="font-mono" style={{ fontSize: '12px', fontWeight: '600', color: '#f1f5f9' }}>
                                  {tc.name}
                                </span>
                              </div>
                              <span className={`badge ${
                                tc.status === 'completed' ? 'badge-success' :
                                tc.status === 'pending' ? 'badge-warning' :
                                tc.status === 'rejected' ? 'badge-danger' : 'badge-indigo'
                              }`} style={{ fontSize: '10px' }}>
                                {tc.status.toUpperCase()}
                              </span>
                            </div>

                            <pre className="font-mono" style={{
                              fontSize: '11px',
                              color: 'var(--text-secondary)',
                              backgroundColor: 'rgba(0, 0, 0, 0.35)',
                              padding: '8px 12px',
                              borderRadius: '8px',
                              overflowX: 'auto',
                              margin: 0,
                            }}>
                              {JSON.stringify(tc.args, null, 2)}
                            </pre>

                            {/* Human-in-the-loop Approval Card */}
                            {tc.status === 'pending' && (
                              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                                <button
                                  onClick={() => onApproveTool(msg.id, tc.id)}
                                  className="btn btn-primary btn-sm"
                                  style={{ flex: 1, backgroundColor: '#10b981' }}
                                >
                                  <Check size={12} /> Approve Action
                                </button>
                                <button
                                  onClick={() => onRejectTool(msg.id, tc.id)}
                                  className="btn btn-secondary btn-sm"
                                  style={{ flex: 1, color: '#fb7185' }}
                                >
                                  <X size={12} /> Reject
                                </button>
                              </div>
                            )}

                            {tc.error && (
                              <div style={{ fontSize: '12px', color: '#fb7185', marginTop: '6px' }}>
                                Error: {tc.error}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {isGenerating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <Loader2 size={16} className="animate-spin" color="#818cf8" />
              <span>Agent-Blend is processing scene commands...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Prominent Docked Composer (ChatGPT / Chainlit style) */}
      <div style={{
        padding: '16px 20px 20px 20px',
        backgroundColor: 'transparent',
        flexShrink: 0,
      }}>
        <div style={{
          width: '100%',
          maxWidth: '840px',
          margin: '0 auto',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '16px',
          padding: '12px 16px',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {/* Top Row: Approach Mode Selector & Active Model */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Mode Pills */}
            <div style={{
              display: 'flex',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: '8px',
              padding: '2px',
              border: '1px solid var(--border-subtle)',
            }}>
              <button
                onClick={() => setCurrentMode('build')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'build' ? 'var(--accent-primary)' : 'transparent',
                  color: currentMode === 'build' ? '#ffffff' : 'var(--text-secondary)',
                  padding: '3px 10px',
                  fontSize: '11px',
                }}
              >
                <Hammer size={12} /> Build
              </button>
              <button
                onClick={() => setCurrentMode('plan')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'plan' ? 'var(--accent-amber)' : 'transparent',
                  color: currentMode === 'plan' ? '#000000' : 'var(--text-secondary)',
                  padding: '3px 10px',
                  fontSize: '11px',
                }}
              >
                <ListOrdered size={12} /> Plan First
              </button>
              <button
                onClick={() => setCurrentMode('ask')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'ask' ? 'var(--accent-cyan)' : 'transparent',
                  color: currentMode === 'ask' ? '#000000' : 'var(--text-secondary)',
                  padding: '3px 10px',
                  fontSize: '11px',
                }}
              >
                <HelpCircle size={12} /> Ask
              </button>
            </div>

            {/* Model Pill (Clickable to change settings) */}
            <button
              onClick={onOpenSettings}
              className="btn btn-ghost btn-sm"
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                gap: '5px',
                padding: '2px 8px',
              }}
              title="Click to change model/provider"
            >
              <Cpu size={12} color="#06b6d4" />
              <span>{settings.provider.toUpperCase()}: {settings.model}</span>
            </button>
          </div>

          {/* Text Input Row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Describe what to build in Blender (${currentMode} mode)...`}
              rows={2}
              style={{
                flex: 1,
                backgroundColor: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                fontSize: '14px',
                resize: 'none',
                lineHeight: '1.4',
              }}
            />

            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isGenerating}
              className="btn btn-primary"
              style={{
                width: '36px',
                height: '36px',
                padding: 0,
                borderRadius: '10px',
                opacity: !inputText.trim() || isGenerating ? 0.4 : 1,
              }}
            >
              {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>

        <p style={{
          textAlign: 'center',
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginTop: '8px',
          margin: '8px 0 0 0',
        }}>
          Press Enter to send, Shift+Enter for new line. Actions pause for approval in Build mode.
        </p>
      </div>
    </div>
  );
};
