import React, { useState } from 'react';
import { 
  Search, 
  Plus, 
  Check, 
  Ruler, 
  Loader2 
} from 'lucide-react';
import assetData from '../assets/asset_catalog.json';
import { AssetSummary } from '../types';
import { importAssetToScene } from '../services/blender';

interface AssetLibraryTabProps {
  onRefreshScene: () => void;
  blenderHost: string;
  blenderPort: number;
}

export const AssetLibraryTab: React.FC<AssetLibraryTabProps> = ({
  onRefreshScene,
  blenderHost,
  blenderPort,
}) => {
  const assets: AssetSummary[] = assetData as any[];
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const categories = [
    'all',
    'seating',
    'table',
    'lighting',
    'storage',
    'decor',
    'soft_furnishing',
    'electronics',
    'bed',
    'sanitary',
    'rug',
  ];

  const filteredAssets = assets.filter((asset) => {
    const matchesCategory = selectedCategory === 'all' || asset.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.subcategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleAddAsset = async (asset: AssetSummary) => {
    setImportingId(asset.id);
    try {
      await importAssetToScene(asset.id, asset.name, [0, 0, 0], blenderHost, blenderPort);
      setSuccessId(asset.id);
      setTimeout(() => setSuccessId(null), 2500);
      onRefreshScene();
    } catch (e) {
      console.error('Failed to import asset:', e);
    } finally {
      setImportingId(null);
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
      {/* Search and Category Filter Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '8px 12px',
        }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 88 production 3D assets (sofas, tables, lamps, decor)..."
            style={{
              flex: 1,
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '13px',
            }}
          />
          <span className="badge badge-indigo">
            {filteredAssets.length} models
          </span>
        </div>

        {/* Category Filter Pills */}
        <div style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className="btn btn-sm"
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '999px',
                backgroundColor: selectedCategory === cat ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: selectedCategory === cat ? '#ffffff' : 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                whiteSpace: 'nowrap',
              }}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1).replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Asset Grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '12px',
        alignContent: 'start',
        paddingRight: '4px',
      }}>
        {filteredAssets.map((asset) => (
          <div
            key={asset.id}
            className="glass-card"
            style={{
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '10px',
              backgroundColor: 'var(--bg-card)',
            }}
          >
            <div>
              {/* Category & Surface tags */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span className="badge badge-indigo" style={{ fontSize: '10px' }}>
                  {asset.category}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  Snap: {asset.surface || 'floor'}
                </span>
              </div>

              {/* Asset Name */}
              <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#f8fafc', marginBottom: '4px' }}>
                {asset.name}
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {asset.subcategory}
              </p>

              {/* Real World Dimensions Chip */}
              {asset.dimensions_m && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '8px',
                }}>
                  <Ruler size={12} color="#06b6d4" />
                  <span>
                    {asset.dimensions_m.width}m × {asset.dimensions_m.depth}m × {asset.dimensions_m.height}m
                  </span>
                </div>
              )}
            </div>

            {/* Action Button: Add to Scene */}
            <button
              onClick={() => handleAddAsset(asset)}
              disabled={importingId === asset.id}
              className={`btn btn-sm ${successId === asset.id ? 'btn-secondary' : 'btn-primary'}`}
              style={{
                width: '100%',
                backgroundColor: successId === asset.id ? '#10b981' : undefined,
                color: '#ffffff',
              }}
            >
              {importingId === asset.id ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Adding to Scene...
                </>
              ) : successId === asset.id ? (
                <>
                  <Check size={12} /> Placed on Floor!
                </>
              ) : (
                <>
                  <Plus size={12} /> Add to Scene
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
