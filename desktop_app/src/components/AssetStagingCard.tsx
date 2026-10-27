import React, { useState, useRef } from 'react';
import {
  Check,
  Trash2,
  RefreshCw,
  Upload,
  AlertTriangle,
  Plus,
  CheckCircle2,
  Play,
  FileBox,
  FolderOpen,
  Search,
  X,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { StagingManifest, StagingItem } from '../types';
import { searchCatalog } from '../services/curator';

interface AssetStagingCardProps {
  manifest: StagingManifest;
  onExecute: (manifest: StagingManifest) => void;
  onUpdateManifest?: (manifest: StagingManifest) => void;
}

export const AssetStagingCard: React.FC<AssetStagingCardProps> = ({
  manifest: initialManifest,
  onExecute,
  onUpdateManifest,
}) => {
  const [manifest, setManifest] = useState<StagingManifest>(initialManifest);
  const [activeSwapItemId, setActiveSwapItemId] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [showCatalogSearch, setShowCatalogSearch] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');

  // Custom asset form state
  const [customName, setCustomName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const missingFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const updateManifest = (newManifest: StagingManifest) => {
    setManifest(newManifest);
    onUpdateManifest?.(newManifest);
  };

  // Toggle selection checkbox
  const handleToggleSelect = (itemId: string) => {
    const updated = {
      ...manifest,
      items: manifest.items.map((it) =>
        it.id === itemId ? { ...it, selected: !it.selected } : it
      ),
    };
    updateManifest(updated);
  };

  // Remove an item from the staging list
  const handleDeleteItem = (itemId: string) => {
    const updated = {
      ...manifest,
      items: manifest.items.filter((it) => it.id !== itemId),
    };
    updateManifest(updated);
  };

  // Swap with an alternative asset
  const handleSwapAlternative = (
    itemId: string,
    alt: {
      name: string;
      assetId: string;
      category: string;
      dimensions?: { width: number; depth: number; height: number };
      modelPath?: string;
    }
  ) => {
    const updated = {
      ...manifest,
      items: manifest.items.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          name: alt.name,
          assetId: alt.assetId,
          category: alt.category,
          dimensions: alt.dimensions,
          modelPath: alt.modelPath,
          status: 'available' as const,
        };
      }),
    };
    updateManifest(updated);
    setActiveSwapItemId(null);
  };

  // Fulfill a missing item with user's custom file
  const handleFulfillMissing = (itemId: string, filePath: string) => {
    if (!filePath.trim()) return;
    const cleanPath = filePath.trim().replace(/^["']|["']$/g, '');
    const updated = {
      ...manifest,
      items: manifest.items.map((it) => {
        if (it.id !== itemId) return it;
        return {
          ...it,
          status: 'custom' as const,
          selected: true,
          customPath: cleanPath,
          modelPath: cleanPath,
          note: `Custom user asset: ${cleanPath}`,
        };
      }),
    };
    updateManifest(updated);
  };

  // File upload for a missing item
  const handleMissingFileSelect = (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // In web/desktop, webkitRelativePath or path might be present in Tauri/Electron
      const path = (file as any).path || file.name;
      handleFulfillMissing(itemId, path);
    }
  };

  // Add custom asset from hybrid bar
  const handleAddCustomAsset = () => {
    if (!customName.trim() || !customPath.trim()) return;
    const cleanPath = customPath.trim().replace(/^["']|["']$/g, '');
    const newItem: StagingItem = {
      id: Math.random().toString(36).substring(7),
      slot: 'custom',
      name: customName.trim(),
      status: 'custom',
      selected: true,
      customPath: cleanPath,
      modelPath: cleanPath,
      suggestedLocation: [0, 0, 0],
    };
    updateManifest({
      ...manifest,
      items: [...manifest.items, newItem],
    });
    setCustomName('');
    setCustomPath('');
    setShowAddCustom(false);
  };

  // Add item directly from catalog search
  const handleAddFromCatalog = (asset: any) => {
    const newItem: StagingItem = {
      id: Math.random().toString(36).substring(7),
      slot: asset.category,
      name: asset.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      assetId: asset.id,
      category: asset.category,
      subcategory: asset.subcategory,
      dimensions: asset.dimensions_m,
      modelPath: asset.model_path,
      status: 'available',
      selected: true,
      suggestedLocation: [0, 0, 0],
    };
    updateManifest({
      ...manifest,
      items: [...manifest.items, newItem],
    });
    setShowCatalogSearch(false);
    setCatalogQuery('');
  };

  const availableItems = manifest.items.filter((it) => it.status !== 'missing');
  const missingItems = manifest.items.filter((it) => it.status === 'missing');
  const selectedCount = manifest.items.filter((it) => it.selected).length;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-md, 8px)',
        overflow: 'hidden',
        marginTop: '8px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary, #1f232b)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              padding: '6px',
              borderRadius: '6px',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              color: '#818cf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
              {manifest.title}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Asset Curator Staging • Review, customize, or add your own models
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            className="badge badge-zinc"
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            {selectedCount} Selected
          </span>
          {missingItems.length > 0 && (
            <span
              className="badge"
              style={{
                fontSize: '11px',
                padding: '3px 8px',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              {missingItems.length} Missing
            </span>
          )}
        </div>
      </div>

      {/* Item Staging List */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Available / Staged Assets */}
        {availableItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '2px',
              }}
            >
              Curated Assets ({availableItems.length})
            </div>

            {availableItems.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  backgroundColor: item.selected ? 'var(--bg-primary)' : 'rgba(255, 255, 255, 0.02)',
                  border: item.selected
                    ? '1px solid var(--border-medium)'
                    : '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  transition: 'all 0.15s ease',
                  opacity: item.selected ? 1 : 0.6,
                }}
              >
                {/* Left: Checkbox + Info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => handleToggleSelect(item.id)}
                    style={{
                      cursor: 'pointer',
                      accentColor: 'var(--accent, #6366f1)',
                      width: '15px',
                      height: '15px',
                    }}
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: '500',
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.name}
                      </span>
                      {item.status === 'custom' ? (
                        <span
                          className="badge"
                          style={{
                            fontSize: '9px',
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                          }}
                        >
                          Custom Model
                        </span>
                      ) : (
                        <span className="badge badge-zinc" style={{ fontSize: '9px' }}>
                          {item.category || item.slot}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {item.dimensions
                        ? `${item.dimensions.width}m × ${item.dimensions.depth}m × ${item.dimensions.height}m`
                        : item.customPath || item.assetId || ''}
                    </div>
                  </div>
                </div>

                {/* Right: Actions (Swap & Delete) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px' }}>
                  {item.alternatives && item.alternatives.length > 0 && (
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() =>
                          setActiveSwapItemId(activeSwapItemId === item.id ? null : item.id)
                        }
                        className="btn btn-secondary btn-sm"
                        style={{
                          fontSize: '11px',
                          padding: '3px 7px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                        title="Swap with alternative from catalog"
                      >
                        <RefreshCw size={11} />
                        <span>Swap</span>
                        <ChevronDown size={10} />
                      </button>

                      {/* Alternatives Dropdown */}
                      {activeSwapItemId === item.id && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            marginTop: '4px',
                            backgroundColor: 'var(--bg-tertiary, #1f232b)',
                            border: '1px solid var(--border-medium)',
                            borderRadius: '6px',
                            padding: '4px',
                            zIndex: 100,
                            width: '220px',
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '10px',
                              fontWeight: '600',
                              color: 'var(--text-muted)',
                              padding: '4px 6px',
                            }}
                          >
                            SELECT ALTERNATIVE:
                          </div>
                          {item.alternatives.map((alt) => (
                            <button
                              key={alt.id}
                              onClick={() => handleSwapAlternative(item.id, alt)}
                              style={{
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: '11px',
                                color: 'var(--text-primary)',
                                backgroundColor: 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                              }}
                              className="glass-card-hover"
                            >
                              <span style={{ fontWeight: '500' }}>{alt.name}</span>
                              {alt.dimensions && (
                                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                                  {alt.dimensions.width}m × {alt.dimensions.depth}m × {alt.dimensions.height}m
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Remove from staging"
                    className="hover-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Missing Items Section with Explicit Prompts & Upload Options */}
        {missingItems.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              backgroundColor: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: '6px',
              padding: '12px',
              marginTop: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fbbf24' }}>
              <AlertTriangle size={14} />
              <span style={{ fontSize: '11px', fontWeight: '600' }}>
                Unmatched Requests ({missingItems.length}) — Can't find relevant assets in the local library
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              The items below were requested but don't exist in the local library. You can upload or link your own 3D model, or skip them:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {missingItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px 10px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileBox size={13} color="#fbbf24" />
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {item.name}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="btn btn-sm"
                      style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--text-muted)' }}
                    >
                      Skip
                    </button>
                  </div>

                  {/* Dual Upload / Path options */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {/* Native File Input button */}
                    <input
                      type="file"
                      accept=".glb,.gltf,.fbx,.obj,.stl,.usd,.blend"
                      style={{ display: 'none' }}
                      ref={(el) => {
                        missingFileInputRefs.current[item.id] = el;
                      }}
                      onChange={(e) => handleMissingFileSelect(item.id, e)}
                    />
                    <button
                      onClick={() => missingFileInputRefs.current[item.id]?.click()}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '11px', padding: '4px 8px', gap: '4px' }}
                    >
                      <Upload size={12} />
                      Upload 3D Model
                    </button>

                    {/* Path manual input */}
                    <input
                      type="text"
                      placeholder="Or paste local path (.glb, .obj, .fbx)..."
                      className="input"
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '4px 8px',
                        backgroundColor: 'var(--bg-secondary)',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleFulfillMissing(item.id, (e.target as HTMLInputElement).value);
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value.trim()) {
                          handleFulfillMissing(item.id, e.target.value);
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hybrid & Library Ingestion Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <button
            onClick={() => setShowAddCustom(!showAddCustom)}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '11px', gap: '5px' }}
          >
            <Upload size={12} />
            <span>Add Custom Model (Hybrid)</span>
          </button>

          <button
            onClick={() => setShowCatalogSearch(!showCatalogSearch)}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '11px', gap: '5px' }}
          >
            <Search size={12} />
            <span>Add from Catalog</span>
          </button>
        </div>

        {/* Expandable Add Custom Model Form */}
        {showAddCustom && (
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)' }}>
              Add Your Own 3D Asset (Hybrid Mode)
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Model Name (e.g. Modern Fireplace)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="input"
                style={{ flex: 1, fontSize: '11px', padding: '5px 8px' }}
              />

              <div style={{ display: 'flex', gap: '4px', flex: 2 }}>
                <input
                  type="text"
                  placeholder="Local File Path (e.g. C:/models/fireplace.glb)"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  className="input"
                  style={{ flex: 1, fontSize: '11px', padding: '5px 8px' }}
                />

                <input
                  type="file"
                  accept=".glb,.gltf,.fbx,.obj,.stl,.usd,.blend"
                  style={{ display: 'none' }}
                  ref={fileInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const path = (f as any).path || f.name;
                      setCustomPath(path);
                      if (!customName) setCustomName(f.name.replace(/\.[^/.]+$/, ''));
                    }
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '4px 8px' }}
                  title="Browse local file"
                >
                  <FolderOpen size={13} />
                </button>
              </div>

              <button
                onClick={handleAddCustomAsset}
                disabled={!customName.trim() || !customPath.trim()}
                className="btn btn-primary btn-sm"
                style={{ fontSize: '11px', padding: '4px 10px', gap: '4px' }}
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>
        )}

        {/* Expandable Catalog Search */}
        {showCatalogSearch && (
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Search Asset Library
              </span>
              <button
                onClick={() => setShowCatalogSearch(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={12} />
              </button>
            </div>

            <input
              type="text"
              placeholder="Filter by name, category, or style (e.g. table, lamp, sofa, scandinavian)..."
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              className="input"
              style={{ fontSize: '11px', padding: '5px 8px' }}
              autoFocus
            />

            <div
              style={{
                maxHeight: '160px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              {searchCatalog(catalogQuery, 8).map((a) => (
                <div
                  key={a.id}
                  onClick={() => handleAddFromCatalog(a)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                  className="glass-card-hover"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                      {a.name.replace(/_/g, ' ')}
                    </span>
                    <span className="badge badge-zinc" style={{ fontSize: '9px' }}>
                      {a.category}
                    </span>
                  </div>
                  <Plus size={12} color="var(--accent, #6366f1)" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer / Execution Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary, #1f232b)',
        }}
      >
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {manifest.isExecuted ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#34d399' }}>
              <CheckCircle2 size={13} /> Staged models placed into Blender
            </span>
          ) : (
            <span>Ready to place {selectedCount} objects into Blender</span>
          )}
        </div>

        {!manifest.isExecuted ? (
          <button
            onClick={() => onExecute(manifest)}
            disabled={selectedCount === 0}
            className="btn btn-primary btn-sm"
            style={{ gap: '6px', padding: '6px 14px', fontSize: '12px' }}
          >
            <Play size={12} fill="currentColor" />
            <span>Approve & Build Scene in Blender ({selectedCount})</span>
          </button>
        ) : (
          <span
            className="badge badge-success"
            style={{ fontSize: '11px', padding: '4px 10px', gap: '5px' }}
          >
            <Check size={12} /> Placed into Scene
          </span>
        )}
      </div>
    </div>
  );
};
