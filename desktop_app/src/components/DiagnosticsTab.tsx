import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Terminal, 
  Play, 
  CheckCircle2, 
  Loader2 
} from 'lucide-react';
import { analyzeMeshQuality, runBlenderCode } from '../services/blender';

interface DiagnosticsTabProps {
  blenderHost: string;
  blenderPort: number;
}

export const DiagnosticsTab: React.FC<DiagnosticsTabProps> = ({
  blenderHost,
  blenderPort,
}) => {
  const [targetObject, setTargetObject] = useState('Cube');
  const [meshReport, setMeshReport] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [pythonCode, setPythonCode] = useState(
    'import bpy\n\n# Query scene object count\nprint("Active objects:", len(bpy.context.scene.objects))\n'
  );
  const [codeOutput, setCodeOutput] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const handleAnalyze = async () => {
    if (!targetObject.trim()) return;
    setAnalyzing(true);
    try {
      const res = await analyzeMeshQuality(targetObject.trim(), blenderHost, blenderPort);
      setMeshReport(res.result || res);
    } catch (e: any) {
      setMeshReport({ error: e.message || String(e) });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRunCode = async () => {
    setExecuting(true);
    try {
      const res = await runBlenderCode(pythonCode, blenderHost, blenderPort);
      setCodeOutput(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setCodeOutput(`Error: ${e.message || String(e)}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-secondary)',
      padding: '16px',
      gap: '16px',
      overflowY: 'auto',
    }}>
      {/* Mesh Quality Analyzer Section */}
      <div className="glass-card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <ShieldAlert size={18} color="#818cf8" />
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#f8fafc' }}>
            Mesh Quality & Defect Analyzer
          </h3>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Validates 3D topology against 3D printing and game engine standards (non-manifold edges, loose vertices, zero-area faces).
        </p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <input
            type="text"
            value={targetObject}
            onChange={(e) => setTargetObject(e.target.value)}
            placeholder="Mesh object name (e.g. Cube)..."
            style={{
              flex: 1,
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '6px 12px',
              color: 'var(--text-primary)',
              fontSize: '12px',
            }}
          />
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="btn btn-primary btn-sm"
          >
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Inspect Mesh
          </button>
        </div>

        {meshReport && (
          <div style={{
            backgroundColor: 'rgba(0,0,0,0.3)',
            borderRadius: '8px',
            padding: '12px',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
          }}>
            {meshReport.error ? (
              <div style={{ color: '#fb7185' }}>Error: {meshReport.error}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>Non-Manifold Edges: <strong>{meshReport.non_manifold_edges ?? 0}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>Loose Vertices: <strong>{meshReport.loose_vertices ?? 0}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>Zero-Area Faces: <strong>{meshReport.zero_area_faces ?? 0}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>Duplicate Verts: <strong>{meshReport.duplicate_vertices ?? 0}</strong></span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Safe Python Code Runner Section */}
      <div className="glass-card" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Terminal size={18} color="#06b6d4" />
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#f8fafc' }}>
              Blender Python (bpy) Runner
            </h3>
          </div>
          <button
            onClick={handleRunCode}
            disabled={executing}
            className="btn btn-primary btn-sm"
          >
            {executing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Execute
          </button>
        </div>

        <textarea
          value={pythonCode}
          onChange={(e) => setPythonCode(e.target.value)}
          rows={6}
          className="font-mono"
          style={{
            width: '100%',
            backgroundColor: 'rgba(0,0,0,0.4)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '10px',
            color: '#38bdf8',
            fontSize: '12px',
            resize: 'vertical',
            outline: 'none',
          }}
        />

        {codeOutput && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Output Result:
            </div>
            <pre className="font-mono" style={{
              backgroundColor: 'rgba(0,0,0,0.6)',
              padding: '10px',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#a7f3d0',
              overflowX: 'auto',
              maxHeight: '160px',
            }}>
              {codeOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
