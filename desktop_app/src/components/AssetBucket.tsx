import React, { useState, useRef } from 'react';
import {
  Package,
  Plus,
  Search,
  Trash2,
  Check,
  X,
  Upload,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Hammer,
  CheckCircle2,
} from 'lucide-react';
import { BucketAsset } from '../types';
import { AssetThumbnail } from './AssetThumbnail';
import { searchCatalog } from '../services/curator';

interface AssetBucketProps {
  assets: BucketAsset[];
  onAddAsset: (asset: BucketAsset) => void;
  onRemoveAsset: (id: string) => void;
  onApproveAsset: (id: string) => void;
  onClearAll: () => void;
  onBuildScene: () => void;
  isBuilding?: boolean;
}

export const AssetBucket: React.FC<AssetBucketProps> = ({
  assets,
  onAddAsset,
  onRemoveAsset,
  onApproveAsset,
  onClearAll,
  onBuildScene,
  isBuilding = false,
}) => {
  // Starts folded when empty — an empty bucket shouldn't take a third of the chat's height.
  const [isExpanded, setIsExpanded] = useState(assets.length > 0);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');

  // Custom model form state
  const [customName, setCustomName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const approvedAssets = assets.filter((a) => a.status === 'approved');
  const pendingAssets = assets.filter((a) => a.status === 'pending');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const path = (file as any).path || file.name;
      const ext = path.split('.').pop()?.toUpperCase() || 'GLB';
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      const newAsset: BucketAsset = {
        id: Math.random().toString(36).substring(7),
        name: cleanName,
        category: 'custom',
        format: ext,
        source: 'user',
        modelPath: path,
        status: 'approved',
      };
      onAddAsset(newAsset);
      setShowCustomModal(false);
      setCustomName('');
      setCustomPath('');
    }
  };

  const handleAddCustomByPath = () => {
    if (!customPath.trim()) return;
    const cleanPath = customPath.trim().replace(/^["']|["']$/g, '');
    const ext = cleanPath.split('.').pop()?.toUpperCase() || 'GLB';
    const fallbackName = cleanPath.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') || 'Custom Asset';
    const newAsset: BucketAsset = {
      id: Math.random().toString(36).substring(7),
      name: customName.trim() || fallbackName,
      category: 'custom',
      format: ext,
      source: 'user',
      modelPath: cleanPath,
      status: 'approved',
    };
    onAddAsset(newAsset);
    setShowCustomModal(false);
    setCustomName('');
    setCustomPath('');
  };

  const handleAddCatalogAsset = (catAsset: any) => {
    const ext = (catAsset.model_path || '').split('.').pop()?.toUpperCase() || 'GLB';
    const newAsset: BucketAsset = {
      id: Math.random().toString(36).substring(7),
      name: catAsset.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      category: catAsset.category,
      subcategory: catAsset.subcategory,
      format: ext,
      source: 'user',
      assetId: catAsset.id,
      modelPath: catAsset.model_path || '',
      dimensions_m: catAsset.dimensions_m,
      status: 'approved',
    };
    onAddAsset(newAsset);
    setShowCatalogModal(false);
    setCatalogQuery('');
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-md, 8px)',
        marginBottom: '10px',
        overflow: 'hidden',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 1. Bucket Header Deck */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: isExpanded ? '1px solid var(--border-subtle)' : 'none',
        }}
      >
        {/* Left Title & Status */}
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
            <Package size={15} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Scene Asset Bucket
              </span>
              <span className="badge badge-zinc" style={{ fontSize: '10px', padding: '1px 6px' }}>
                {assets.length} {assets.length === 1 ? 'Model' : 'Models'}
              </span>
              {pendingAssets.length > 0 && (
                <span
                  className="badge"
                  style={{
                    fontSize: '9px',
                    padding: '1px 6px',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                  }}
                >
                  {pendingAssets.length} Needs Permission
                </span>
              )}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>
              The agent builds your scene using <b>ONLY</b> the approved assets staged in this bucket
            </div>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setShowCustomModal(true)}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '11px', padding: '4px 8px', gap: '4px' }}
            title="Import custom 3D model into bucket"
          >
            <Upload size={12} />
            <span>+ Import Model</span>
          </button>

          <button
            onClick={() => setShowCatalogModal(true)}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '11px', padding: '4px 8px', gap: '4px' }}
            title="Add models from local asset library"
          >
            <Search size={12} />
            <span>Browse Library</span>
          </button>

          {assets.length > 0 && (
            <button
              onClick={onClearAll}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px 6px', color: 'var(--text-muted)' }}
              title="Clear all assets from bucket"
            >
              <Trash2 size={12} />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="btn btn-ghost btn-sm"
            style={{ padding: '4px', color: 'var(--text-muted)' }}
            title={isExpanded ? 'Minimize Bucket' : 'Expand Bucket'}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* 2. Bucket Content: Thumbnail Cards Grid */}
      {isExpanded && (
        <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-primary)' }}>
          {assets.length === 0 ? (
            /* Empty State Dropzone */
            <div
              style={{
                border: '1.5px dashed var(--border-medium)',
                borderRadius: '8px',
                padding: '24px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.01)',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                <Package size={20} />
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Your Asset Bucket is Empty
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '420px', marginTop: '2px' }}>
                  Add your own 3D models (`.glb, .fbx, .obj, .blend`) or let the AI recommend assets. The agent will construct the scene using <b>only</b> the models inside this card.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  onClick={() => setShowCustomModal(true)}
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: '11px', gap: '4px', padding: '4px 10px' }}
                >
                  <Upload size={12} />
                  <span>Import Your 3D Model</span>
                </button>
                <button
                  onClick={() => setShowCatalogModal(true)}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '11px', gap: '4px', padding: '4px 10px' }}
                >
                  <Search size={12} />
                  <span>Pick from Library</span>
                </button>
              </div>
            </div>
          ) : (
            /* Grid of Visual Thumbnail Asset Cards */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '10px',
                maxHeight: '260px',
                overflowY: 'auto',
                paddingRight: '4px',
              }}
            >
              {assets.map((asset) => {
                const isPending = asset.status === 'pending';
                const dims = asset.dimensions_m;

                return (
                  <div
                    key={asset.id}
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: isPending
                        ? '1px solid rgba(245, 158, 11, 0.4)'
                        : '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                    }}
                  >
                    {/* Top Thumbnail Image / 3D Canvas Box */}
                    <div style={{ position: 'relative', width: '100%', height: '90px' }}>
                      <AssetThumbnail
                        category={asset.category}
                        name={asset.name}
                        format={asset.format}
                        imageUrl={asset.thumbnailUrl}
                        size="fill"
                      />

                      {/* Origin Badge (Top Left) */}
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          left: '6px',
                          backgroundColor:
                            asset.source === 'user'
                              ? 'rgba(16, 185, 129, 0.85)'
                              : 'rgba(99, 102, 241, 0.85)',
                          color: '#ffffff',
                          fontSize: '8px',
                          fontWeight: '700',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {asset.source === 'user' ? '👤 YOU' : '🤖 AGENT'}
                      </span>

                      {/* Remove Button (Top Right) */}
                      <button
                        onClick={() => onRemoveAsset(asset.id)}
                        style={{
                          position: 'absolute',
                          top: '5px',
                          right: '5px',
                          backgroundColor: 'rgba(0, 0, 0, 0.65)',
                          border: 'none',
                          borderRadius: '50%',
                          width: '18px',
                          height: '18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: '#f87171',
                        }}
                        title="Remove from bucket"
                      >
                        <X size={11} />
                      </button>
                    </div>

                    {/* Metadata Body */}
                    <div
                      style={{
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        flex: 1,
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={asset.name}
                        >
                          {asset.name}
                        </div>

                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {dims
                            ? `${dims.width}m × ${dims.depth}m × ${dims.height}m`
                            : asset.category}
                        </div>
                      </div>

                      {/* Permission Gate for Agent Added Assets */}
                      {isPending ? (
                        <div
                          style={{
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.25)',
                            borderRadius: '4px',
                            padding: '4px 6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            marginTop: '4px',
                          }}
                        >
                          <span style={{ fontSize: '9px', fontWeight: '600', color: '#fbbf24' }}>
                            Agent proposes this asset:
                          </span>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={() => onApproveAsset(asset.id)}
                              className="btn btn-primary btn-sm"
                              style={{
                                flex: 1,
                                fontSize: '10px',
                                padding: '2px 4px',
                                height: '20px',
                                gap: '3px',
                              }}
                            >
                              <Check size={10} /> Approve
                            </button>
                            <button
                              onClick={() => onRemoveAsset(asset.id)}
                              className="btn btn-secondary btn-sm"
                              style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                height: '20px',
                                color: '#f87171',
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: '#34d399',
                            fontSize: '9px',
                            fontWeight: '500',
                            marginTop: '2px',
                          }}
                        >
                          <CheckCircle2 size={11} />
                          <span>Approved & Staged</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 3. Bucket Footer & 1-Click Build Action */}
          {assets.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '10px',
                marginTop: '10px',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>
                  {approvedAssets.length} of {assets.length} approved for build
                </span>
                {pendingAssets.length > 0 && (
                  <span style={{ color: '#fbbf24', marginLeft: '6px' }}>
                    ({pendingAssets.length} awaiting your permission)
                  </span>
                )}
              </div>

              <button
                onClick={onBuildScene}
                disabled={approvedAssets.length === 0 || isBuilding}
                className="btn btn-primary btn-sm"
                style={{
                  gap: '6px',
                  padding: '5px 14px',
                  fontSize: '11px',
                  fontWeight: '600',
                }}
              >
                <Hammer size={12} />
                <span>
                  {isBuilding
                    ? 'Building in Blender...'
                    : `Build Scene with Staged Assets (${approvedAssets.length})`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: Import Custom Model Modal */}
      {showCustomModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
          onClick={() => setShowCustomModal(false)}
        >
          <div
            style={{
              width: '440px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Upload size={16} color="var(--accent, #6366f1)" />
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Add Your 3D Model to Bucket
                </span>
              </div>
              <button
                onClick={() => setShowCustomModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              Import any 3D asset from your computer into the bucket. The agent will build the scene using this asset alongside your other approved models.
            </div>

            {/* Quick File Picker */}
            <input
              type="file"
              accept=".glb,.gltf,.fbx,.obj,.stl,.usd,.blend"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileSelect}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary"
              style={{
                padding: '12px',
                border: '1.5px dashed var(--border-medium)',
                borderRadius: '6px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <FolderOpen size={20} color="var(--accent, #6366f1)" />
              <span style={{ fontSize: '12px', fontWeight: '500' }}>Choose 3D File from Disk</span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Supports .GLB, .FBX, .OBJ, .STL, .USD, .BLEND
              </span>
            </button>

            {/* Or Paste Path */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
                OR ENTER LOCAL ABSOLUTE PATH:
              </label>
              <input
                type="text"
                placeholder="e.g. C:\MyProjects\models\custom_couch.glb"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                className="input"
                style={{ fontSize: '11px', padding: '6px 10px' }}
              />
              <input
                type="text"
                placeholder="Model Name (Optional)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="input"
                style={{ fontSize: '11px', padding: '6px 10px' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button onClick={() => setShowCustomModal(false)} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button
                onClick={handleAddCustomByPath}
                disabled={!customPath.trim()}
                className="btn btn-primary btn-sm"
              >
                + Add to Bucket
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Browse Library Catalog Modal */}
      {showCatalogModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
          onClick={() => setShowCatalogModal(false)}
        >
          <div
            style={{
              width: '540px',
              maxHeight: '480px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Search size={16} color="var(--accent, #6366f1)" />
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Add Models from Library to Bucket
                </span>
              </div>
              <button
                onClick={() => setShowCatalogModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={15} />
              </button>
            </div>

            <input
              type="text"
              placeholder="Search by name, category, or style (e.g. sofa, bed, lamp, coffee table)..."
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              className="input"
              style={{ fontSize: '11px', padding: '6px 10px' }}
              autoFocus
            />

            {/* Catalog Grid with 3D Thumbnails */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                maxHeight: '340px',
                paddingRight: '4px',
              }}
            >
              {searchCatalog(catalogQuery, 16).map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => handleAddCatalogAsset(asset)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  className="glass-card-hover"
                >
                  <AssetThumbnail
                    category={asset.category}
                    name={asset.name}
                    format="GLB"
                    size="sm"
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {asset.name.replace(/_/g, ' ')}
                    </span>
                    <span className="badge badge-zinc" style={{ fontSize: '8px', alignSelf: 'flex-start' }}>
                      {asset.category}
                    </span>
                    {asset.dimensions_m && (
                      <span style={{ fontSize: '8px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {asset.dimensions_m.width}m × {asset.dimensions_m.depth}m
                      </span>
                    )}
                  </div>
                  <Plus size={14} color="var(--accent, #6366f1)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
