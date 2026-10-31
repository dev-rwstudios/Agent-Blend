import React, { useState } from 'react';
import { 
  X, 
  Settings, 
  Save, 
  Check,
  Folder,
  Zap,
  ShieldCheck,
  Plug,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { AppSettings, LLMProvider } from '../types';
import { fetchAvailableModels, testModelConnection } from '../services/llm';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [formData, setFormData] = useState<AppSettings>({ ...settings });
  const [savedToast, setSavedToast] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  if (!isOpen) return null;

  const providers: { id: LLMProvider; name: string; defaultModel: string; defaultUrl: string }[] = [
    { id: 'ollama', name: 'Ollama (Local)', defaultModel: 'llama3.1', defaultUrl: 'http://localhost:11434' },
    { id: 'lmstudio', name: 'LM Studio (Local)', defaultModel: 'qwen2.5-coder', defaultUrl: 'http://localhost:1234/v1' },
    { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o', defaultUrl: 'https://api.openai.com/v1' },
    { id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-3-5-sonnet-20241022', defaultUrl: 'https://api.anthropic.com/v1' },
    { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-2.5-pro', defaultUrl: 'https://generativelanguage.googleapis.com' },
    { id: 'openrouter', name: 'OpenRouter', defaultModel: 'anthropic/claude-3.5-sonnet', defaultUrl: 'https://openrouter.ai/api/v1' },
    { id: 'groq', name: 'Groq Cloud', defaultModel: 'llama-3.3-70b-versatile', defaultUrl: 'https://api.groq.com/openai/v1' },
    { id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat', defaultUrl: 'https://api.deepseek.com' },
    { id: 'custom', name: 'Custom OpenAI-Compatible', defaultModel: 'default', defaultUrl: 'http://localhost:8080/v1' },
  ];

  // Any change to the connection details invalidates earlier test/fetch results.
  const updateConnectionField = (patch: Partial<AppSettings>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    setConnectionResult(null);
    if (!('model' in patch)) setAvailableModels([]);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionResult(null);
    try {
      setConnectionResult(await testModelConnection(formData));
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setConnectionResult(null);
    try {
      const result = await fetchAvailableModels(formData);
      setAvailableModels(result.models);
      setConnectionResult({ ok: result.ok, message: result.message });
      if (result.ok && !result.models.includes(formData.model)) {
        setFormData((prev) => ({ ...prev, model: result.models[0] }));
      }
    } finally {
      setFetchingModels(false);
    }
  };

  const handleProviderChange = (prov: LLMProvider) => {
    const found = providers.find((p) => p.id === prov);
    setConnectionResult(null);
    setAvailableModels([]);
    setFormData((prev) => ({
      ...prev,
      provider: prov,
      model: found ? found.defaultModel : prev.model,
      apiBaseUrl: found ? found.defaultUrl : prev.apiBaseUrl,
    }));
  };

  const handleSave = () => {
    onSave(formData);
    setSavedToast(true);
    setTimeout(() => {
      setSavedToast(false);
      onClose();
    }, 600);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div 
        style={{
          width: '520px',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={15} color="var(--text-secondary)" />
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
              Studio Settings
            </span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ padding: '3px' }}>
            <X size={15} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{
          padding: '16px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}>
          {/* Permanent Asset Library Path */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
              <Folder size={12} color="var(--text-muted)" />
              Permanent Asset Library Directory
            </label>
            <input
              type="text"
              value={formData.assetsPath || ''}
              onChange={(e) => setFormData({ ...formData, assetsPath: e.target.value })}
              placeholder="e.g. C:\Users\admin\Desktop\Agent-Blend\Agent-Blend\asset_library"
              style={{
                width: '100%',
                padding: '6px 10px',
              }}
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
              Local directory where the AI copilot pulls 3D furniture, decor, and models.
            </span>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

          {/* Execution Engine Mode (Autonomous vs Manual Review) */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Copilot Execution Mode
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div 
                onClick={() => setFormData({ ...formData, executionMode: 'autonomous' })}
                style={{
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: formData.executionMode === 'autonomous' ? 'var(--bg-active)' : 'var(--bg-secondary)',
                  border: `1px solid ${formData.executionMode === 'autonomous' ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Zap size={13} color={formData.executionMode === 'autonomous' ? '#34d399' : 'var(--text-muted)'} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    Autonomous (Pro)
                  </span>
                </div>
                <p style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
                  Safe 3D operations execute instantly. Only destructive actions (clear scene) pause for confirmation.
                </p>
              </div>

              <div 
                onClick={() => setFormData({ ...formData, executionMode: 'manual' })}
                style={{
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: formData.executionMode === 'manual' ? 'var(--bg-active)' : 'var(--bg-secondary)',
                  border: `1px solid ${formData.executionMode === 'manual' ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={13} color={formData.executionMode === 'manual' ? '#60a5fa' : 'var(--text-muted)'} />
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    Manual Review
                  </span>
                </div>
                <p style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
                  Every single tool execution pauses and requires manual approval before running into Blender.
                </p>
              </div>
            </div>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

          {/* Provider Selection */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              AI LLM Provider
            </label>
            <select
              value={formData.provider}
              onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
              style={{
                width: '100%',
                padding: '6px 10px',
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model Name */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Model Identifier
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {availableModels.length > 0 ? (
                <select
                  value={formData.model}
                  onChange={(e) => updateConnectionField({ model: e.target.value })}
                  style={{ flex: 1, minWidth: 0, padding: '6px 10px' }}
                >
                  {!availableModels.includes(formData.model) && formData.model && (
                    <option value={formData.model}>{formData.model}</option>
                  )}
                  {availableModels.map((m) => (
                    <option key={m} value={m} style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => updateConnectionField({ model: e.target.value })}
                  placeholder="e.g. gpt-4o, llama3.1, claude-3-5-sonnet..."
                  style={{ flex: 1, minWidth: 0, padding: '6px 10px' }}
                />
              )}
              <button
                onClick={handleFetchModels}
                disabled={fetchingModels || testing}
                className="btn btn-secondary btn-sm"
                title="Fetch the models available from this provider"
                style={{ whiteSpace: 'nowrap' }}
              >
                {fetchingModels ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Fetch Models
              </button>
            </div>
            {availableModels.length > 0 && (
              <button
                onClick={() => setAvailableModels([])}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '10px', padding: '2px 0', marginTop: '3px', color: 'var(--text-muted)' }}
              >
                Type a model name manually instead
              </button>
            )}
          </div>

          {/* Vision model — reads reference images */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Vision model <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(for reference images — optional)</span>
            </label>
            <input
              type="text"
              list="vision-models"
              value={formData.visionModel || ''}
              onChange={(e) => setFormData({ ...formData, visionModel: e.target.value })}
              placeholder="Leave empty to use the model above (it must be able to see images)"
              style={{ width: '100%', padding: '6px 10px' }}
            />
            <datalist id="vision-models">
              {availableModels.map((m) => <option key={m} value={m} />)}
            </datalist>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
              A coding model usually can't read pictures. Load a vision-capable model (e.g. a Qwen-VL or Gemma model in LM Studio, or Claude / GPT-4o) and put its name here — it is used only when you attach an image.
            </span>
          </div>

          {/* API Key */}
          {formData.provider !== 'ollama' && formData.provider !== 'lmstudio' && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                API Key
              </label>
              <input
                type="password"
                value={formData.apiKey}
                onChange={(e) => updateConnectionField({ apiKey: e.target.value })}
                placeholder="sk-..."
                style={{
                  width: '100%',
                  padding: '6px 10px',
                }}
              />
            </div>
          )}

          {/* Base URL */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              API Base URL
            </label>
            <input
              type="text"
              value={formData.apiBaseUrl}
              onChange={(e) => updateConnectionField({ apiBaseUrl: e.target.value })}
              style={{
                width: '100%',
                padding: '6px 10px',
              }}
            />
          </div>

          {/* Test Connection */}
          <div>
            <button
              onClick={handleTestConnection}
              disabled={testing || fetchingModels}
              className="btn btn-secondary btn-sm"
              title="Send a tiny request to the configured model to check it is reachable"
            >
              {testing ? <Loader2 size={13} className="spin" /> : <Plug size={13} />}
              {testing ? ' Testing…' : ' Test Connection'}
            </button>
            {connectionResult && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                marginTop: '8px',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                lineHeight: '1.4',
                wordBreak: 'break-word',
                color: connectionResult.ok ? '#34d399' : '#f87171',
                backgroundColor: connectionResult.ok ? 'rgba(52, 211, 153, 0.08)' : 'rgba(248, 113, 113, 0.08)',
                border: `1px solid ${connectionResult.ok ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
              }}>
                {connectionResult.ok
                  ? <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
                  : <XCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />}
                <span>{connectionResult.message}</span>
              </div>
            )}
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

          {/* Blender Socket Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Blender Host
              </label>
              <input
                type="text"
                value={formData.blenderHost}
                onChange={(e) => setFormData({ ...formData, blenderHost: e.target.value })}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Port
              </label>
              <input
                type="number"
                value={formData.blenderPort}
                onChange={(e) => setFormData({ ...formData, blenderPort: parseInt(e.target.value) || 9876 })}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 16px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
        }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary btn-sm">
            {savedToast ? <Check size={13} /> : <Save size={13} />} Save
          </button>
        </div>
      </div>
    </div>
  );
};
