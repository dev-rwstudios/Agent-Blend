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
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Play
} from 'lucide-react';
import { ChatMessage, AppSettings } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, mode: 'build' | 'plan' | 'ask') => void;
  onApproveTool: (messageId: string, toolId: string) => void;
  onRejectTool: (messageId: string, toolId: string) => void;
  onApproveAll: (messageId: string) => void;
  onExecutePlan: (messageId: string) => void;
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
  onExecutePlan,
  isGenerating,
  settings,
  onOpenSettings,
}) => {
  const [inputText, setInputText] = useState('');
  const [currentMode, setCurrentMode] = useState<'build' | 'plan' | 'ask'>('build');
  const [expandedMessageTools, setExpandedMessageTools] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const toggleMessageTools = (messageId: string) => {
    setExpandedMessageTools(prev => ({ ...prev, [messageId]: !prev[messageId] }));
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
      prompt: 'Furnish a modern living room scene with a sofa, coffee table, and area rug snapped to the floor.',
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
          maxWidth: '820px',
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
                maxWidth: '460px',
                lineHeight: '1.5',
                marginBottom: '24px',
              }}>
                Autonomous natural language 3D creation. Describe models, materials, lights, or full room sets.
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
            messages.map((msg) => {
              const pendingTools = (msg.toolCalls || []).filter(t => t.status === 'pending');
              const completedTools = (msg.toolCalls || []).filter(t => t.status === 'completed');
              const failedTools = (msg.toolCalls || []).filter(t => t.status === 'failed' || t.status === 'rejected');
              const isToolsExpanded = !!expandedMessageTools[msg.id];

              return (
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
                      padding: '8px 14px',
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
                      {/* Identity & Mode Badge */}
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

                      {/* Main Markdown Response Content */}
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

                      {/* Plan First Blueprint Card */}
                      {msg.plan && (
                        <div style={{
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-medium)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <ListOrdered size={14} color="var(--text-primary)" />
                              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                {msg.plan.title}
                              </span>
                            </div>
                            <span className="badge badge-zinc" style={{ fontSize: '10px' }}>
                              {msg.plan.steps.length} Steps
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '4px 0' }}>
                            {msg.plan.steps.map((st, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: '11px', width: '16px' }}>{i + 1}.</span>
                                <span>{st}</span>
                              </div>
                            ))}
                          </div>

                          {msg.plan.canExecute ? (
                            <button
                              onClick={() => onExecutePlan(msg.id)}
                              className="btn btn-primary btn-sm"
                              style={{ alignSelf: 'flex-start', marginTop: '4px', gap: '5px' }}
                            >
                              <Play size={11} fill="currentColor" /> Execute Blueprint in Blender
                            </button>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#34d399', fontSize: '11px', marginTop: '2px' }}>
                              <CheckCircle2 size={13} />
                              <span>Blueprint executed successfully into Blender scene</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tool Executions Presentation */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {/* 1. Autonomous Completed Operations (Clean Collapsible Summary) */}
                          {completedTools.length > 0 && (
                            <div style={{
                              backgroundColor: 'var(--bg-secondary)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              overflow: 'hidden',
                            }}>
                              <div
                                onClick={() => toggleMessageTools(msg.id)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '7px 10px',
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <CheckCircle2 size={13} color="#10b981" />
                                  <span style={{ fontSize: '11px', fontWeight: '500', color: 'var(--text-primary)' }}>
                                    Executed {completedTools.length} {completedTools.length === 1 ? 'operation' : 'operations'} into Blender
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}>
                                  <span style={{ fontSize: '10px' }}>{isToolsExpanded ? 'Hide details' : 'View details'}</span>
                                  {isToolsExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                </div>
                              </div>

                              {/* Expanded detailed command logs */}
                              {isToolsExpanded && (
                                <div style={{
                                  borderTop: '1px solid var(--border-subtle)',
                                  padding: '8px 10px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px',
                                  backgroundColor: 'var(--bg-primary)',
                                }}>
                                  {completedTools.map((tc) => (
                                    <div key={tc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Terminal size={11} color="var(--text-muted)" />
                                        <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{tc.name}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                          {tc.summary || JSON.stringify(tc.args)}
                                        </span>
                                      </div>
                                      <span className="badge badge-success" style={{ fontSize: '9px' }}>OK</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 2. Guarded Confirmation Card (ONLY for Destructive Actions or Manual Review) */}
                          {pendingTools.length > 0 && (
                            <div style={{
                              backgroundColor: 'var(--bg-secondary)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '10px 12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <AlertTriangle size={14} color="#f59e0b" />
                                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                    {pendingTools.some(t => t.isDestructive) 
                                      ? 'Confirm Destructive Operation' 
                                      : 'Review Requested Action'}
                                  </span>
                                </div>
                                {pendingTools.length > 1 && (
                                  <button
                                    onClick={() => onApproveAll(msg.id)}
                                    className="btn btn-primary btn-sm"
                                    style={{ padding: '2px 8px', fontSize: '10px' }}
                                  >
                                    Approve All ({pendingTools.length})
                                  </button>
                                )}
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {pendingTools.map((tc) => (
                                  <div key={tc.id} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    backgroundColor: 'var(--bg-primary)',
                                    padding: '6px 8px',
                                    borderRadius: 'var(--radius-xs)',
                                    border: '1px solid var(--border-subtle)',
                                  }}>
                                    <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                                      {tc.summary || tc.name}
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button
                                        onClick={() => onApproveTool(msg.id, tc.id)}
                                        className="btn btn-primary btn-sm"
                                        style={{ padding: '2px 8px', fontSize: '10px' }}
                                      >
                                        <Check size={10} /> {tc.isDestructive ? 'Proceed' : 'Approve'}
                                      </button>
                                      <button
                                        onClick={() => onRejectTool(msg.id, tc.id)}
                                        className="btn btn-secondary btn-sm"
                                        style={{ padding: '2px 8px', fontSize: '10px', color: '#f87171' }}
                                      >
                                        <X size={10} /> Cancel
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 3. Failed Tool Notices */}
                          {failedTools.length > 0 && (
                            <div style={{
                              padding: '6px 10px',
                              backgroundColor: 'rgba(239, 68, 68, 0.08)',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '11px',
                              color: '#f87171',
                            }}>
                              {failedTools.map(t => (
                                <div key={t.id}>Notice: {t.name} — {t.error || 'Execution skipped'}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Clickable Follow-up Suggestion Chips (Zero Typing Needed!) */}
                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '6px',
                          marginTop: '2px',
                        }}>
                          {msg.suggestions.map((sug, i) => (
                            <button
                              key={i}
                              onClick={() => onSendMessage(sug, currentMode)}
                              className="btn btn-secondary btn-sm"
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                backgroundColor: 'var(--bg-secondary)',
                                borderColor: 'var(--border-subtle)',
                                color: 'var(--text-secondary)',
                                borderRadius: 'var(--radius-xs)',
                              }}
                            >
                              + {sug}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isGenerating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '12px' }}>
              <Loader2 size={13} className="animate-spin" color="var(--text-secondary)" />
              <span>Executing Blender 3D operations...</span>
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
          maxWidth: '820px',
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
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <Hammer size={10} /> Build (Auto)
              </button>
              <button
                onClick={() => setCurrentMode('plan')}
                className="btn btn-sm"
                style={{
                  backgroundColor: currentMode === 'plan' ? 'var(--bg-tertiary)' : 'transparent',
                  color: currentMode === 'plan' ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: currentMode === 'plan' ? '1px solid var(--border-medium)' : '1px solid transparent',
                  padding: '2px 8px',
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
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <HelpCircle size={10} /> Ask
              </button>
            </div>

            {/* Model & Execution Mode Indicator */}
            <button
              onClick={onOpenSettings}
              className="btn btn-ghost btn-sm"
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                gap: '5px',
                padding: '2px 6px',
              }}
              title="Click to configure provider & settings"
            >
              <Cpu size={11} color="var(--text-secondary)" />
              <span>{settings.provider.toUpperCase()} / {settings.model}</span>
              <span className="badge badge-zinc" style={{ fontSize: '9px', padding: '1px 4px' }}>
                {settings.executionMode === 'autonomous' ? '⚡ Autonomous' : '🛡️ Manual'}
              </span>
            </button>
          </div>

          {/* Text Input Row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                currentMode === 'build'
                  ? 'Describe 3D scene action (e.g. "Add modern sofa and 3-point lighting")...'
                  : currentMode === 'plan'
                  ? 'Request a step-by-step 3D blueprint (e.g. "Plan a cyberpunk bedroom")...'
                  : 'Ask about Blender lighting, materials, or dimensions...'
              }
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
          Press Enter to send, Shift+Enter for newline. Safe actions execute directly into Blender.
        </p>
      </div>
    </div>
  );
};
