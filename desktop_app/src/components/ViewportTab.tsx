import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  RefreshCw, 
  Radio
} from 'lucide-react';
import { captureViewportScreenshot, executeBlenderCommand } from '../services/blender';

interface ViewportTabProps {
  blenderConnected: boolean;
  blenderHost: string;
  blenderPort: number;
}

export const ViewportTab: React.FC<ViewportTabProps> = ({
  blenderConnected,
  blenderHost,
  blenderPort,
}) => {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [shadingMode, setShadingMode] = useState<'SOLID' | 'MATERIAL' | 'RENDERED' | 'WIREFRAME'>('SOLID');

  const fetchScreenshot = async () => {
    if (!blenderConnected) return;
    setLoading(true);
    try {
      const img = await captureViewportScreenshot(blenderHost, blenderPort);
      if (img) setScreenshotUrl(img);
    } catch (e) {
      console.error('Failed to capture viewport screenshot:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (blenderConnected) {
      fetchScreenshot();
    }
  }, [blenderConnected]);

  // Auto-refresh interval if enabled
  useEffect(() => {
    if (!autoRefresh || !blenderConnected) return;
    const interval = setInterval(() => {
      fetchScreenshot();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, blenderConnected]);

  const changeShading = async (mode: 'SOLID' | 'MATERIAL' | 'RENDERED' | 'WIREFRAME') => {
    setShadingMode(mode);
    await executeBlenderCommand('set_viewport_shading', { type: mode }, blenderHost, blenderPort);
    await fetchScreenshot();
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      padding: '12px',
      gap: '10px',
    }}>
      {/* Viewport Control Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '6px',
        backgroundColor: 'var(--bg-secondary)',
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
      }}>
        {/* Shading mode selector */}
        <div style={{
          display: 'flex',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-xs)',
          padding: '2px',
          gap: '2px',
        }}>
          {(['SOLID', 'MATERIAL', 'RENDERED', 'WIREFRAME'] as const).map((m) => (
            <button
              key={m}
              onClick={() => changeShading(m)}
              className="btn btn-sm"
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                fontWeight: shadingMode === m ? '600' : '400',
                backgroundColor: shadingMode === m ? 'var(--bg-elevated)' : 'transparent',
                color: shadingMode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: shadingMode === m ? '1px solid var(--border-medium)' : '1px solid transparent',
                borderRadius: 'var(--radius-xs)',
              }}
            >
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* View Angles & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="btn btn-sm"
            style={{
              fontSize: '10px',
              padding: '2px 7px',
              gap: '4px',
              backgroundColor: autoRefresh ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-tertiary)',
              color: autoRefresh ? '#34d399' : 'var(--text-secondary)',
              border: `1px solid ${autoRefresh ? 'rgba(16, 185, 129, 0.25)' : 'var(--border-subtle)'}`,
            }}
          >
            <Radio size={11} className={autoRefresh ? 'pulse-dot' : ''} />
            <span>{autoRefresh ? 'Live Syncing' : 'Live Sync'}</span>
          </button>

          <button
            onClick={fetchScreenshot}
            disabled={loading || !blenderConnected}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '10px', padding: '2px 7px', gap: '4px' }}
            title="Capture Viewport Screenshot"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            <span>Snapshot</span>
          </button>
        </div>
      </div>

      {/* Main Viewport Display Canvas */}
      <div 
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: '#0c0c0f',
          position: 'relative',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt="Blender 3D Viewport"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              userSelect: 'none',
            }}
          />
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '20px',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
            }}>
              <Camera size={20} color="var(--text-secondary)" />
            </div>
            <div>
              <h4 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '3px' }}>
                {blenderConnected ? 'Viewport Preview' : 'Blender Offline'}
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '260px', lineHeight: '1.4' }}>
                {blenderConnected
                  ? 'Click Snapshot or enable Live Sync to view the active Blender scene.'
                  : 'Start Blender and connect to port 9876 to stream live 3D viewports.'}
              </p>
            </div>
            {blenderConnected && (
              <button 
                onClick={fetchScreenshot} 
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '11px', marginTop: '4px' }}
              >
                <RefreshCw size={11} /> Capture Viewport
              </button>
            )}
          </div>
        )}

        {/* Viewport Overlay Badges */}
        {screenshotUrl && (
          <div style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            display: 'flex',
            gap: '4px',
          }}>
            <span className="badge badge-zinc" style={{ fontSize: '10px' }}>
              OpenGL Viewport
            </span>
            <span className="badge badge-zinc" style={{ fontSize: '10px' }}>
              {shadingMode}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
