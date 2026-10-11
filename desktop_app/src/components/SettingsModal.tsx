import React, { useState } from 'react';
import { 
  X, 
  Settings, 
  Save, 
  Check 
} from 'lucide-react';
import { AppSettings, LLMProvider } from '../types';

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

  const handleProviderChange = (prov: LLMProvider) => {
    const found = providers.find((p) => p.id === prov);
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
    }, 800);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div 
        className="glass-panel"
        style={{
          width: '540px',
          maxHeight: '90vh',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={18} color="#818cf8" />
            <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#f8fafc' }}>
              Agent-Blend Studio Settings
            </h3>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ padding: '4px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{
          padding: '20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          {/* Provider Selection */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
              AI LLM Provider
            </label>
            <select
              value={formData.provider}
              onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} style={{ backgroundColor: '#0f1420' }}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model Name */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Model Identifier
            </label>
            <input
              type="text"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              placeholder="e.g. gpt-4o, llama3.1, claude-3-5-sonnet..."
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          {/* API Key */}
          {formData.provider !== 'ollama' && (
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                API Key (Stored locally in memory)
              </label>
              <input
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="sk-..."
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {/* Base URL */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              API Base URL / Endpoint
            </label>
            <input
              type="text"
              value={formData.apiBaseUrl}
              onChange={(e) => setFormData({ ...formData, apiBaseUrl: e.target.value })}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          {/* Blender Socket Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Blender Host
              </label>
              <input
                type="text"
                value={formData.blenderHost}
                onChange={(e) => setFormData({ ...formData, blenderHost: e.target.value })}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Port
              </label>
              <input
                type="number"
                value={formData.blenderPort}
                onChange={(e) => setFormData({ ...formData, blenderPort: parseInt(e.target.value) || 9876 })}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
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
          gap: '10px',
          padding: '16px 20px',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary btn-sm">
            {savedToast ? <Check size={14} /> : <Save size={14} />} Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
