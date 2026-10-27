import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Search,
  Plus,
  Upload,
  FolderOpen,
  Check,
  RefreshCw,
  AlertTriangle,
  FolderCheck,
  Settings2,
} from 'lucide-react';
import {
  scanAssetDirectory,
  ScannedAssetItem,
  ScanAssetResult,
  executeBlenderCommand,
} from '../services/blender';

interface AssetsTabProps {
  onRefresh: () => void;
  blenderHost: string;
  blenderPort: number;
  assetsPath?: string;
  onSaveAssetsPath?: (newPath: string) => void;
}

export const AssetsTab: React.FC<AssetsTabProps> = ({
  onRefresh,
  blenderHost,
  blenderPort,
  assetsPath = '',
  onSaveAssetsPath,
}) => {
  const [currentPath, setCurrentPath] = useState(assetsPath);
  const [inputPath, setInputPath] = useState(assetsPath);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanAssetResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isConfiguringPath, setIsConfiguringPath] = useState(!assetsPath);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importSuccessId, setImportSuccessId] = useState<string | null>(null);

  // Custom single file import state
  const [customName, setCustomName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [customImporting, setCustomImporting] = useState(false);
  const filePickerRef = useRef<HTMLInputElement>(null);

  // Default candidate path in this project
  const defaultProjectPath = 'C:\\Users\\admin\\Desktop\\Agent-Blend\\Agent-Blend\\asset_library';

  const performScan = useCallback(async (pathToScan: string) => {
    if (!pathToScan.trim()) return;
    setIsScanning(true);
    setScanError(null);

    try {
      const result = await scanAssetDirectory(pathToScan, blenderHost, blenderPort);
      if (result.valid && result.total > 0) {
        setScanResult(result);
        setCurrentPath(pathToScan);
        setIsConfiguringPath(false);
        onSaveAssetsPath?.(pathToScan);
      } else {
        setScanResult(null);
        setScanError(
          result.message ||
            `No compatible 3D models (.glb, .gltf, .fbx, .obj, .blend) found in "${pathToScan}". Please verify the folder path.`
        );
      }
    } catch (err: any) {
      setScanResult(null);
      setScanError(err.message || 'Failed to scan asset directory.');
    } finally {
      setIsScanning(false);
    }
  }, [blenderHost, blenderPort, onSaveAssetsPath]);

  // Scan on mount if assetsPath is present
  useEffect(() => {
    if (assetsPath && assetsPath.trim()) {
      setInputPath(assetsPath);
      performScan(assetsPath);
    } else {
      setIsConfiguringPath(true);
    }
  }, [assetsPath, performScan]);

  const handleConnectPath = () => {
    if (!inputPath.trim()) return;
    performScan(inputPath.trim());
  };

  const handleImportAsset = async (asset: ScannedAssetItem) => {
    setImportingId(asset.id);
    try {
      const args: any = {
        name: asset.name,
        asset_id: asset.id,
        model_path: asset.model_path,
        filepath: asset.model_path,
        location: [0, 0, 0],
        snap_to_floor: true,
      };

      const res = await executeBlenderCommand('import_asset', args, blenderHost, blenderPort);
      if (res.status === 'ok') {
        setImportSuccessId(asset.id);
        setTimeout(() => setImportSuccessId(null), 2000);
        onRefresh();
      }
    } catch (err) {
      console.error('Failed to import asset:', err);
    } finally {
      setImportingId(null);
    }
  };

  const handleImportCustom = async () => {
    if (!customPath.trim()) return;
    setCustomImporting(true);
    try {
      const cleanPath = customPath.trim().replace(/^["']|["']$/g, '');
      const name =
        customName.trim() ||
        cleanPath.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') ||
        'Custom Model';

      const args = {
        name,
        filepath: cleanPath,
        model_path: cleanPath,
        location: [0, 0, 0],
        snap_to_floor: true,
      };

      const res = await executeBlenderCommand('import_asset', args, blenderHost, blenderPort);
      if (res.status === 'ok') {
        setCustomPath('');
        setCustomName('');
        onRefresh();
      }
    } catch (err) {
      console.error('Failed to import custom model:', err);
    } finally {
      setCustomImporting(false);
    }
  };

  const categories = scanResult
    ? ['all', ...scanResult.categories, 'custom']
    : ['custom'];

  const filteredAssets = (scanResult?.assets || []).filter((a) => {
    const matchesCat = selectedCategory === 'all' || a.category === selectedCategory;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      a.id.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      (a.subcategory && a.subcategory.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
        padding: '12px',
        gap: '10px',
        overflow: 'hidden',
      }}
    >
      {/* 1. Path Configuration Screen (Shown if no library connected or when changing path) */}
      {isConfiguringPath ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm, 6px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FolderOpen size={18} color="var(--accent, #6366f1)" />
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Connect Your 3D Asset Library
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Enter the folder path where your 3D assets (.glb, .obj, .fbx, .blend) are stored.
              </div>
            </div>
          </div>

          {/* Quick Preset */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
              QUICK DETECT:
            </span>
            <button
              onClick={() => {
                setInputPath(defaultProjectPath);
                performScan(defaultProjectPath);
              }}
              disabled={isScanning}
              className="btn btn-secondary btn-sm"
              style={{
                fontSize: '11px',
                padding: '6px 10px',
                justifyContent: 'flex-start',
                gap: '6px',
              }}
            >
              <Box size={13} color="var(--accent, #6366f1)" />
              <span>Use Project Library ({defaultProjectPath})</span>
            </button>
          </div>

          {/* Manual Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
              OR ENTER DIRECTORY PATH:
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="e.g. D:\3D_Assets\Library"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnectPath();
                }}
                className="input"
                style={{ flex: 1, fontSize: '11px', padding: '6px 10px' }}
              />

              <button
                onClick={handleConnectPath}
                disabled={!inputPath.trim() || isScanning}
                className="btn btn-primary btn-sm"
                style={{ gap: '5px', padding: '6px 12px', fontSize: '11px' }}
              >
                {isScanning ? <RefreshCw size={12} className="spin" /> : <FolderCheck size={13} />}
                <span>{isScanning ? 'Scanning...' : 'Connect'}</span>
              </button>
            </div>
          </div>

          {/* Error notice if path is invalid */}
          {scanError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '8px 10px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '4px',
                color: '#f87171',
                fontSize: '11px',
                lineHeight: '1.4',
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{scanError}</div>
            </div>
          )}

          {scanResult && (
            <button
              onClick={() => setIsConfiguringPath(false)}
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: 'flex-start', fontSize: '11px' }}
            >
              Cancel & Keep Current Library
            </button>
          )}
        </div>
      ) : (
        /* 2. Connected Library Status Bar */
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm, 6px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            <FolderCheck size={14} color="#10b981" />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={currentPath}
              >
                {currentPath.split(/[/\\]/).filter(Boolean).pop() || currentPath}
              </span>
              <span style={{ fontSize: '9px', color: '#34d399' }}>
                {scanResult?.total || 0} real assets indexed
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => performScan(currentPath)}
              disabled={isScanning}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px', color: 'var(--text-muted)' }}
              title="Rescan Directory"
            >
              <RefreshCw size={12} className={isScanning ? 'spin' : ''} />
            </button>

            <button
              onClick={() => setIsConfiguringPath(true)}
              className="btn btn-ghost btn-sm"
              style={{ padding: '4px', color: 'var(--text-muted)' }}
              title="Change Asset Library Path"
            >
              <Settings2 size={13} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Category Filter Tabs */}
      {!isConfiguringPath && (
        <>
          <div
            style={{
              display: 'flex',
              gap: '4px',
              overflowX: 'auto',
              paddingBottom: '4px',
              scrollbarWidth: 'none',
            }}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="btn btn-sm"
                style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  textTransform: 'capitalize',
                  backgroundColor:
                    selectedCategory === cat ? 'var(--accent, #6366f1)' : 'var(--bg-secondary)',
                  color: selectedCategory === cat ? '#ffffff' : 'var(--text-secondary)',
                  border:
                    selectedCategory === cat
                      ? '1px solid transparent'
                      : '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  flexShrink: 0,
                }}
              >
                {cat === 'all'
                  ? `All (${scanResult?.total || 0})`
                  : cat === 'custom'
                  ? '+ Custom Import'
                  : cat}
              </button>
            ))}
          </div>

          {selectedCategory === 'custom' ? (
            /* Custom Model Ingestion */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '12px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Upload size={14} color="var(--accent, #6366f1)" />
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Import Custom 3D Model (Hybrid)
                </span>
              </div>

              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Bring any model into the active Blender scene. Supports GLB, FBX, OBJ, STL, USD, and BLEND.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
                    MODEL NAME (OPTIONAL)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Modern Fireplace"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="input"
                    style={{ width: '100%', fontSize: '11px', padding: '5px 8px', marginTop: '2px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)' }}>
                    LOCAL FILE PATH (.GLB, .OBJ, .FBX)
                  </label>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                    <input
                      type="text"
                      placeholder="e.g. C:/3D_Assets/fireplace.glb"
                      value={customPath}
                      onChange={(e) => setCustomPath(e.target.value)}
                      className="input"
                      style={{ flex: 1, fontSize: '11px', padding: '5px 8px' }}
                    />

                    <input
                      type="file"
                      accept=".glb,.gltf,.fbx,.obj,.stl,.usd,.blend"
                      style={{ display: 'none' }}
                      ref={filePickerRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const path = (file as any).path || file.name;
                          setCustomPath(path);
                          if (!customName) {
                            setCustomName(file.name.replace(/\.[^/.]+$/, ''));
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => filePickerRef.current?.click()}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 8px' }}
                      title="Browse local files"
                    >
                      <FolderOpen size={13} />
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleImportCustom}
                  disabled={!customPath.trim() || customImporting}
                  className="btn btn-primary btn-sm"
                  style={{ gap: '6px', marginTop: '4px' }}
                >
                  <Plus size={12} />
                  {customImporting ? 'Importing into Blender...' : 'Add to Scene (Floor-Snapped)'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Search bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 10px',
                }}
              >
                <Search size={13} color="var(--text-muted)" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${filteredAssets.length} verified models...`}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Asset List of Scanned Working Assets */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {filteredAssets.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '24px 12px',
                      color: 'var(--text-muted)',
                      fontSize: '12px',
                    }}
                  >
                    No assets matched "{search}" in category "{selectedCategory}".
                  </div>
                ) : (
                  filteredAssets.map((asset) => {
                    const dims = asset.dimensions_m;
                    const isImporting = importingId === asset.id;
                    const isSuccess = importSuccessId === asset.id;

                    return (
                      <div
                        key={asset.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          gap: '8px',
                        }}
                        className="glass-card-hover"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--bg-tertiary, #1f232b)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Box size={14} color="var(--text-secondary)" />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={asset.model_path}
                              >
                                {asset.name}
                              </span>
                              <span className="badge badge-zinc" style={{ fontSize: '8px', padding: '1px 4px' }}>
                                {asset.category}
                              </span>
                              {asset.format && (
                                <span
                                  style={{
                                    fontSize: '8px',
                                    color: 'var(--text-muted)',
                                    fontWeight: '500',
                                  }}
                                >
                                  {asset.format}
                                </span>
                              )}
                            </div>

                            {dims && (
                              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                                {dims.width}m × {dims.depth}m × {dims.height}m
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => handleImportAsset(asset)}
                          disabled={isImporting}
                          className="btn btn-secondary btn-sm"
                          style={{
                            fontSize: '10px',
                            padding: '3px 8px',
                            gap: '4px',
                            flexShrink: 0,
                          }}
                          title="Import into Blender snapped to floor"
                        >
                          {isSuccess ? (
                            <>
                              <Check size={11} color="#10b981" />
                              <span style={{ color: '#10b981' }}>Added</span>
                            </>
                          ) : (
                            <>
                              <Plus size={11} />
                              <span>{isImporting ? 'Adding...' : 'Add'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
