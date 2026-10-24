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
  Layers,
  X
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
        return <Sun size={13} color="#f59e0b" />;
      case 'CAMERA':
        return <Camera size={13} color="#06b6d4" />;
      case 'MESH':
        return <Box size={13} color="var(--text-primary)" />;
      default:
        return <Layers size={13} color="var(--text-muted)" />;
    }
  };

  const handleToggleVisibility = async (obj: SceneObject, e: React.MouseEvent) => {
    e.stopPropagation();
    await setObjectVisibility(obj.name, !obj.visible, blenderHost, blenderPort);
    onRefresh();
  };

  const handleDelete = async (obj: SceneObject, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete "${obj.name}" from Blender scene?`)) {
      if (selectedObj?.name === obj.name) {
        setSelectedObj(null);
      }
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
      backgroundColor: 'var(--bg-primary)',
      padding: '12px',
      gap: '10px',
    }}>
      {/* Search Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        padding: '5px 10px',
      }}>
        <Search size={13} color="var(--text-muted)" />
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
            padding: 0,
          }}
        />
        <span className="badge badge-zinc" style={{ fontSize: '10px', padding: '1px 5px' }}>
          {filtered.length}
        </span>
      </div>

      {/* Objects Tree List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
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
            textAlign: 'center',
            padding: '24px 0',
          }}>
            <Box size={24} color="var(--text-disabled)" style={{ marginBottom: '8px' }} />
            <span>{search ? 'No matching objects' : 'Scene is empty'}</span>
          </div>
        ) : (
          filtered.map((obj) => {
            const isSelected = selectedObj?.name === obj.name;
            return (
              <div
                key={obj.name}
                onClick={() => setSelectedObj(isSelected ? null : obj)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--bg-active)' : 'var(--bg-secondary)',
                  border: `1px solid ${isSelected ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                  transition: 'background-color 0.1s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  {getObjectIcon(obj.type)}
                  <span style={{
                    fontSize: '12px',
                    fontWeight: isSelected ? '600' : '500',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                  }}>
                    {obj.name}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    [{obj.type}]
                  </span>
                  {obj.materials && obj.materials.length > 0 && (
                    <span className="badge badge-zinc" style={{ fontSize: '9px', padding: '1px 4px', color: '#60a5fa' }}>
                      {obj.materials[0]}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                  <button
                    onClick={(e) => handleFocus(obj, e)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '3px', color: 'var(--text-muted)' }}
                    title="Frame in Viewport"
                  >
                    <Target size={12} />
                  </button>
                  <button
                    onClick={(e) => handleToggleVisibility(obj, e)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '3px', color: obj.visible ? '#34d399' : 'var(--text-disabled)' }}
                    title={obj.visible ? 'Hide Object' : 'Show Object'}
                  >
                    {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    onClick={(e) => handleDelete(obj, e)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '3px', color: 'var(--text-muted)' }}
                    title="Delete Object"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Selected Object Detail Inspector Drawer */}
      {selectedObj && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {getObjectIcon(selectedObj.type)}
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                {selectedObj.name}
              </span>
              <span className="badge badge-zinc" style={{ fontSize: '9px', padding: '1px 4px' }}>
                {selectedObj.type}
              </span>
              {selectedObj.materials && selectedObj.materials.length > 0 && (
                <span className="badge badge-zinc" style={{ fontSize: '9px', padding: '1px 4px', color: '#60a5fa' }}>
                  {selectedObj.materials.join(', ')}
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedObj(null)}
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px', color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </button>
          </div>

          {/* Transform World Coordinates */}
          <div>
            <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Location (Meters)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginTop: '4px' }}>
              {['X', 'Y', 'Z'].map((axis, i) => (
                <div key={axis} style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  padding: '4px 6px',
                  borderRadius: 'var(--radius-xs)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: '700',
                    color: i === 0 ? '#f87171' : i === 1 ? '#34d399' : '#60a5fa'
                  }}>
                    {axis}
                  </span>
                  <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                    {selectedObj.location ? selectedObj.location[i]?.toFixed(2) : '0.00'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Dimensions if available */}
          {selectedObj.dimensions && (
            <div>
              <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Dimensions (W x D x H)
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginTop: '4px' }}>
                {['W', 'D', 'H'].map((dim, i) => (
                  <div key={dim} style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    padding: '4px 6px',
                    borderRadius: 'var(--radius-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    border: '1px solid var(--border-subtle)',
                  }}>
                    <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
                      {dim}
                    </span>
                    <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                      {selectedObj.dimensions ? selectedObj.dimensions[i]?.toFixed(2) : '0.00'}m
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
            <button
              onClick={(e) => handleFocus(selectedObj, e)}
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: '11px', gap: '4px' }}
            >
              <Target size={11} /> Focus
            </button>
            <button
              onClick={(e) => handleDelete(selectedObj, e)}
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: '11px', color: '#f87171', gap: '4px' }}
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
