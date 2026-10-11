import React, { useState } from 'react';
import { 
  RotateCcw, 
  Bookmark, 
  Clock 
} from 'lucide-react';
import { CheckpointItem } from '../types';
import { saveSceneCheckpoint, executeBlenderCommand } from '../services/blender';

interface CheckpointsTabProps {
  checkpoints: CheckpointItem[];
  onAddCheckpoint: (item: CheckpointItem) => void;
  onRefreshScene: () => void;
  blenderHost: string;
  blenderPort: number;
}

export const CheckpointsTab: React.FC<CheckpointsTabProps> = ({
  checkpoints,
  onAddCheckpoint,
  onRefreshScene,
  blenderHost,
  blenderPort,
}) => {
  const [customName, setCustomName] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const handleCreateCheckpoint = async () => {
    const name = customName.trim() || `State_${checkpoints.length + 1}`;
    await saveSceneCheckpoint(name, blenderHost, blenderPort);
    onAddCheckpoint({
      id: Math.random().toString(36).substring(7),
      name,
      timestamp: new Date().toLocaleTimeString(),
      action: 'Manual Snapshot',
    });
    setCustomName('');
  };

  const handleRestore = async (cp: CheckpointItem) => {
    setRestoringId(cp.id);
    try {
      // Execute Blender internal undo or load
      await executeBlenderCommand('execute_code', {
        code: 'import bpy\nbpy.ops.ed.undo()\n',
      }, blenderHost, blenderPort);
      onRefreshScene();
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-secondary)',
      padding: '16px',
      gap: '14px',
    }}>
      {/* Create Checkpoint bar */}
      <div style={{
        display: 'flex',
        gap: '8px',
        backgroundColor: 'var(--bg-tertiary)',
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
      }}>
        <input
          type="text"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="Checkpoint name (e.g. Before Lighting Setup)..."
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '13px',
          }}
        />
        <button
          onClick={handleCreateCheckpoint}
          className="btn btn-primary btn-sm"
        >
          <Bookmark size={12} /> Save Checkpoint
        </button>
      </div>

      {/* Checkpoints Timeline List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {checkpoints.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            fontSize: '13px',
            textAlign: 'center',
          }}>
            <Bookmark size={32} color="#64748b" style={{ marginBottom: '8px' }} />
            <p>No checkpoints saved yet.</p>
            <p style={{ fontSize: '11px' }}>Checkpoints are automatically saved before major turn changes or manually above.</p>
          </div>
        ) : (
          checkpoints.map((cp) => (
            <div
              key={cp.id}
              className="glass-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(99, 102, 241, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Bookmark size={16} color="#818cf8" />
                </div>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>
                    {cp.name}
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={11} /> {cp.timestamp}
                    </span>
                    <span>•</span>
                    <span>{cp.action}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleRestore(cp)}
                disabled={restoringId === cp.id}
                className="btn btn-secondary btn-sm"
              >
                <RotateCcw size={12} /> Restore Scene
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
