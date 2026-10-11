import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  RefreshCw, 
  Eye 
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
      backgroundColor: 'var(--bg-secondary)',
      padding: '16px',
      gap: '14px',
    }}>
      {/* Viewport Control Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        backgroundColor: 'var(--bg-tertiary)',
        padding: '8px 12px',
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
      }}>
        {/* Shading mode selector */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['SOLID', 'MATERIAL', 'RENDERED', 'WIREFRAME'] as const).map((m) => (
            <button
              key={m}
              onClick={() => changeShading(m)}
              className="btn btn-sm"
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                backgroundColor: shadingMode === m ? 'var(--accent-primary)' : 'transparent',
                color: shadingMode === m ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* View Angles & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="btn btn-sm"
            style={{
              fontSize: '11px',
              backgroundColor: autoRefresh ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-hover)',
              color: autoRefresh ? '#34d399' : 'var(--text-secondary)',
              border: `1px solid ${autoRefresh ? 'rgba(16, 185, 129, 0.4)' : 'transparent'}`,
            }}
          >
            <Eye size={12} /> Auto-Sync {autoRefresh ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={fetchScreenshot}
            disabled={loading || !blenderConnected}
            className="btn btn-secondary btn-sm"
            title="Capture Viewport Screenshot"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Snapshot
          </button>
        </div>
      </div>

      {/* Main Viewport Display Canvas */}
      <div 
        className="glass-card"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: '#05070a',
          position: 'relative',
          borderRadius: '12px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8)',
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
              borderRadius: '8px',
            }}
          />
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '24px',
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
            }}>
              <Camera size={28} color="#64748b" />
            </div>
            <div>
              <h4 style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {blenderConnected ? 'No Viewport Snapshot Yet' : 'Blender Not Connected'}
              </h4>
              <p style={{ fontSize: '12px', maxWidth: '300px' }}>
                {blenderConnected
                  ? 'Click "Snapshot" above or enable Auto-Sync to stream real-time OpenGL renders from Blender.'
                  : 'Start the blend-ai server in Blender (Port 9876) to view the live 3D scene.'}
              </p>
            </div>
            {blenderConnected && (
              <button onClick={fetchScreenshot} className="btn btn-primary btn-sm">
                <RefreshCw size={12} /> Capture Viewport
              </button>
            )}
          </div>
        )}

        {/* Viewport Overlay Badges */}
        {screenshotUrl && (
          <div style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            display: 'flex',
            gap: '6px',
          }}>
            <span className="badge badge-indigo" style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(15,20,32,0.8)' }}>
              OpenGL Viewport
            </span>
            <span className="badge badge-cyan" style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(15,20,32,0.8)' }}>
              {shadingMode}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
