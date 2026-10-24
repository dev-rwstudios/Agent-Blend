import React, { useState } from 'react';
import { 
  X, 
  Settings, 
  Save, 
  Check,
  Folder
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
          width: '500px',
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
            <input
              type="text"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              placeholder="e.g. gpt-4o, llama3.1, claude-3-5-sonnet..."
              style={{
                width: '100%',
                padding: '6px 10px',
              }}
            />
          </div>

          {/* API Key */}
          {formData.provider !== 'ollama' && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                API Key
              </label>
              <input
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
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
              onChange={(e) => setFormData({ ...formData, apiBaseUrl: e.target.value })}
              style={{
                width: '100%',
                padding: '6px 10px',
              }}
            />
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
