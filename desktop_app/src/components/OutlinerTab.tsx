import React, { useState } from 'react';
import { 
  Box, 
  Sun, 
  Camera, 
  Eye, 
  EyeOff, 
  Trash2, 
  Target, 
  Search, 
  Layers
} from 'lucide-react';
import { SceneObject } from '../types';
import { setObjectVisibility, deleteObject, focusObject } from '../services/blender';

interface OutlinerTabProps {
  objects: SceneObject[];
  onRefresh: () => void;
  blenderHost: string;
  blenderPort: number;
}

export const OutlinerTab: React.FC<OutlinerTabProps> = ({
  objects,
  onRefresh,
  blenderHost,
  blenderPort,
}) => {
  const [search, setSearch] = useState('');
  const [selectedObj, setSelectedObj] = useState<SceneObject | null>(null);

  const getObjectIcon = (type: string) => {
    switch (type.toUpperCase()) {
      case 'LIGHT':
        return <Sun size={14} color="#f59e0b" />;
      case 'CAMERA':
        return <Camera size={14} color="#06b6d4" />;
      case 'MESH':
        return <Box size={14} color="#818cf8" />;
      default:
        return <Layers size={14} color="#94a3b8" />;
    }
  };

  const handleToggleVisibility = async (obj: SceneObject, e: React.MouseEvent) => {
    e.stopPropagation();
    await setObjectVisibility(obj.name, !obj.visible, blenderHost, blenderPort);
    onRefresh();
  };

  const handleDelete = async (obj: SceneObject, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete object "${obj.name}" from Blender scene?`)) {
      await deleteObject(obj.name, blenderHost, blenderPort);
      onRefresh();
    }
  };

  const handleFocus = async (obj: SceneObject, e: React.MouseEvent) => {
    e.stopPropagation();
    await focusObject(obj.name, blenderHost, blenderPort);
  };

  const filtered = objects.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-secondary)',
      padding: '16px',
      gap: '12px',
    }}>
      {/* Search Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '6px 12px',
      }}>
        <Search size={14} color="var(--text-muted)" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter scene objects..."
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '12px',
          }}
        />
        <span className="badge badge-indigo" style={{ fontSize: '10px' }}>
          {filtered.length}
        </span>
      </div>

      {/* Split view: Object List & Inspector */}
      <div style={{ display: 'flex', gap: '12px', flex: 1, overflow: 'hidden' }}>
        {/* Objects Tree */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          paddingRight: '4px',
        }}>
          {filtered.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
              fontSize: '12px',
            }}>
              No objects found in active scene.
            </div>
          ) : (
            filtered.map((obj) => (
              <div
                key={obj.name}
                onClick={() => setSelectedObj(obj)}
                className="glass-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: selectedObj?.name === obj.name ? 'var(--bg-active)' : 'var(--bg-card)',
                  borderColor: selectedObj?.name === obj.name ? 'var(--accent-primary)' : 'var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {getObjectIcon(obj.type)}
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>
                    {obj.name}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    [{obj.type}]
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={(e) => handleFocus(obj, e)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '3px 6px' }}
                    title="Frame / Focus in Viewport"
                  >
                    <Target size={12} />
                  </button>
                  <button
                    onClick={(e) => handleToggleVisibility(obj, e)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '3px 6px', color: obj.visible ? '#34d399' : '#64748b' }}
                    title="Toggle Visibility"
                  >
                    {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    onClick={(e) => handleDelete(obj, e)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '3px 6px', color: '#fb7185' }}
                    title="Delete Object"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Selected Object Details Inspector */}
        {selectedObj && (
          <div 
            className="glass-panel"
            style={{
              width: '280px',
              padding: '14px',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
              {getObjectIcon(selectedObj.type)}
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#ffffff' }}>
                  {selectedObj.name}
                </h4>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Type: {selectedObj.type}
                </p>
              </div>
            </div>

            {/* Transform coordinates */}
            <div>
              <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                World Location (Meters)
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px' }}>
                {['X', 'Y', 'Z'].map((axis, i) => (
                  <div key={axis} style={{
                    backgroundColor: 'rgba(0,0,0,0.3)',
                    padding: '6px',
                    borderRadius: '6px',
                    textAlign: 'center',
                    border: '1px solid var(--border-subtle)',
                  }}>
                    <span style={{ fontSize: '10px', color: i === 0 ? '#fb7185' : i === 1 ? '#34d399' : '#60a5fa', fontWeight: 'bold' }}>
                      {axis}:
                    </span>
                    <div style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                      {selectedObj.location ? selectedObj.location[i]?.toFixed(2) : '0.00'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'auto' }}>
              <button
                onClick={(e) => handleFocus(selectedObj, e)}
                className="btn btn-primary btn-sm"
              >
                <Target size={12} /> Focus Object
              </button>
              <button
                onClick={(e) => handleDelete(selectedObj, e)}
                className="btn btn-secondary btn-sm"
                style={{ color: '#fb7185' }}
              >
                <Trash2 size={12} /> Delete from Scene
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
