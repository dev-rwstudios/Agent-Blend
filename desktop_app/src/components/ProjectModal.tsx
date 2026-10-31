import React, { useEffect, useState } from 'react';
import { X, FolderPlus, Folder, Plus, Trash2, Loader2, CheckCircle2, XCircle, ScanSearch } from 'lucide-react';
import { AssetSource, ProjectMeta } from '../types';
import { scanAssetDirectory } from '../services/blender';
import { defaultAssetLibrary, newId } from '../services/storage';

export interface ProjectFormResult {
  name: string;
  description: string;
  assetSources: AssetSource[];
  /** Existing .blend to start from (create only); empty = empty scene. */
  startFrom: string;
}

interface ProjectModalProps {
  isOpen: boolean;
  /** Project being edited, or null to create a new one. */
  project: ProjectMeta | null;
  /** Pre-fills the first asset source of a new project. */
  defaultAssetsPath: string;
  onClose: () => void;
  onSubmit: (result: ProjectFormResult) => Promise<void>;
}

type ScanState = { status: 'idle' | 'scanning' | 'ok' | 'error'; message?: string };

const label: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: '4px',
};
const hint: React.CSSProperties = { fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' };

export const ProjectModal: React.FC<ProjectModalProps> = ({ isOpen, project, defaultAssetsPath, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sources, setSources] = useState<AssetSource[]>([]);
  const [scans, setScans] = useState<Record<string, ScanState>>({});
  const [startMode, setStartMode] = useState<'empty' | 'existing'>('empty');
  const [startFrom, setStartFrom] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSubmitting(false);
    setScans({});
    setStartMode('empty');
    setStartFrom('');
    if (project) {
      setName(project.name);
      setDescription(project.description);
      setSources(project.assetSources);
      return;
    }
    setName('');
    setDescription('');
    setSources([]);
    (async () => {
      const path = defaultAssetsPath.trim() || (await defaultAssetLibrary()) || '';
      if (path) setSources([{ id: newId(), path }]);
    })();
  }, [isOpen, project, defaultAssetsPath]);

  if (!isOpen) return null;

  const scan = async (source: AssetSource) => {
    if (!source.path.trim()) return;
    setScans((s) => ({ ...s, [source.id]: { status: 'scanning' } }));
    const res = await scanAssetDirectory(source.path);
    setScans((s) => ({
      ...s,
      [source.id]: res.valid
        ? { status: 'ok', message: `${res.total} assets in ${res.categories.length} categories` }
        : { status: 'error', message: res.message || 'Folder not found or not readable' },
    }));
  };

  const updateSource = (id: string, path: string) => {
    setSources((list) => list.map((s) => (s.id === id ? { ...s, path } : s)));
    setScans((s) => ({ ...s, [id]: { status: 'idle' } }));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Give the project a name.');
      return;
    }
    if (startMode === 'existing' && !startFrom.trim().toLowerCase().endsWith('.blend')) {
      setError('Enter the full path to an existing .blend file, or start from an empty scene.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        assetSources: sources.filter((s) => s.path.trim()).map((s) => ({ ...s, path: s.path.trim() })),
        startFrom: startMode === 'existing' ? startFrom.trim() : '',
      });
    } catch (e: any) {
      setError(e?.message || String(e));
      setSubmitting(false);
    }
  };

  const isEdit = project != null;

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        width: '560px', maxHeight: '88vh', backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-medium)', borderRadius: 'var(--radius-lg)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-md)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderPlus size={15} color="var(--text-secondary)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isEdit ? 'Project Settings' : 'New Project'}
            </span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ padding: '3px' }} disabled={submitting}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={label}>Project name *</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Scandinavian Master Bedroom"
              style={{ width: '100%', padding: '6px 10px' }}
            />
          </div>

          <div>
            <label style={label}>Description / brief</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What is this scene? Room type, style, mood, dimensions, must-have furniture, client notes…"
              style={{ width: '100%', padding: '6px 10px', resize: 'vertical', fontFamily: 'inherit', fontSize: '12px' }}
            />
            <span style={hint}>The AI reads this brief in every chat of this project.</span>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

          {/* Asset sources */}
          <div>
            <label style={label}>Asset sources</label>
            <span style={{ ...hint, marginTop: 0, marginBottom: '8px' }}>
              Folders this project pulls 3D models from (.glb, .fbx, .obj, .blend… with optional metadata.json).
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sources.map((source) => {
                const st = scans[source.id] ?? { status: 'idle' };
                return (
                  <div key={source.id}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <Folder size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                      <input
                        type="text"
                        value={source.path}
                        onChange={(e) => updateSource(source.id, e.target.value)}
                        onBlur={() => scan(source)}
                        placeholder="/path/to/asset/folder"
                        style={{ flex: 1, minWidth: 0, padding: '6px 10px' }}
                      />
                      <button
                        onClick={() => scan(source)}
                        className="btn btn-secondary btn-sm"
                        disabled={st.status === 'scanning' || !source.path.trim()}
                        title="Scan this folder"
                      >
                        {st.status === 'scanning' ? <Loader2 size={12} className="spin" /> : <ScanSearch size={12} />}
                      </button>
                      <button
                        onClick={() => setSources((list) => list.filter((s) => s.id !== source.id))}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '4px' }}
                        title="Remove source"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {(st.status === 'ok' || st.status === 'error') && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px', marginLeft: '19px',
                        fontSize: '10px', color: st.status === 'ok' ? '#34d399' : '#f87171',
                      }}>
                        {st.status === 'ok' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                        {st.message}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                onClick={() => setSources((list) => [...list, { id: newId(), path: '' }])}
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start', fontSize: '11px' }}
              >
                <Plus size={12} /> Add asset folder
              </button>
            </div>
          </div>

          {/* Starting scene (create only) */}
          {!isEdit && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />
              <div>
                <label style={label}>Starting scene</label>
                <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: 'var(--text-primary)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input type="radio" checked={startMode === 'empty'} onChange={() => setStartMode('empty')} />
                    Empty scene
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                    <input type="radio" checked={startMode === 'existing'} onChange={() => setStartMode('existing')} />
                    Copy an existing .blend file
                  </label>
                </div>
                {startMode === 'existing' && (
                  <input
                    type="text"
                    value={startFrom}
                    onChange={(e) => setStartFrom(e.target.value)}
                    placeholder="/path/to/existing_scene.blend"
                    style={{ width: '100%', padding: '6px 10px', marginTop: '8px' }}
                  />
                )}
                <span style={hint}>
                  The project keeps its own copy of the scene in its project folder — the original file is not modified.
                </span>
              </div>
            </>
          )}

          {error && (
            <div style={{
              fontSize: '11px', color: '#f87171', padding: '7px 10px', borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.3)',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '10px 16px',
          borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-secondary)',
        }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm" disabled={submitting}>
            Cancel
          </button>
          <button onClick={handleSubmit} className="btn btn-primary btn-sm" disabled={submitting}>
            {submitting ? <Loader2 size={13} className="spin" /> : <FolderPlus size={13} />}
            {isEdit ? ' Save' : ' Create project'}
          </button>
        </div>
      </div>
    </div>
  );
};
