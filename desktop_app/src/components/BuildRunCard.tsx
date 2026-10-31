import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  MinusCircle,
  AlertTriangle,
  Box,
  Square,
  Play,
  Undo2,
  ChevronDown,
  ChevronRight,
  Brain,
  ListChecks,
} from 'lucide-react';
import type { BuildRun, StepStatus } from '../agent/buildAgent';

interface BuildRunCardProps {
  run: BuildRun;
  onStop?: () => void;
  onRunPlan?: () => void;
  onUndo?: () => void;
  busy?: boolean;
}

const stepIcon = (status: StepStatus) => {
  switch (status) {
    case 'done': return <CheckCircle2 size={13} color="#34d399" />;
    case 'running': return <Loader2 size={13} className="spin" color="#60a5fa" />;
    case 'failed': return <XCircle size={13} color="#f87171" />;
    case 'skipped': return <MinusCircle size={13} color="var(--text-muted)" />;
    default: return <Circle size={13} color="var(--text-disabled)" />;
  }
};

const CHECK_STYLE = {
  ok: { color: '#34d399', label: 'Placed' },
  placeholder: { color: '#fb923c', label: 'Placeholder' },
  issue: { color: '#fbbf24', label: 'Issue' },
  missing: { color: '#f87171', label: 'Missing' },
} as const;

export const BuildRunCard: React.FC<BuildRunCardProps> = ({ run, onStop, onRunPlan, onUndo, busy }) => {
  const [showLog, setShowLog] = useState(false);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const running = run.status === 'running';

  // Cards saved by earlier versions have no thinking/criteria/verdicts.
  // A reasoning model streams its chain of thought first; show that until the written answer arrives.
  const thinking = (run.thinking ?? '').trim() ? run.thinking ?? '' : run.reasoning ?? '';
  const criteria = run.criteria ?? [];

  // The thinking panel is open while the model is writing, then folds away unless the user opened it.
  const thinkStep = run.steps.find((s) => s.key === 'think');
  const thinkingNow = thinkStep?.status === 'running';
  const [thinkingOpen, setThinkingOpen] = useState<boolean | null>(null);
  const isThinkingOpen = thinkingOpen ?? (thinkingNow || run.status === 'awaiting_approval');
  const thinkingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thinkingNow && thinkingRef.current) thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
  }, [thinking, thinkingNow]);
  const verdictFor = (text: string) => run.verdicts?.find((v) => v.text === text);
  const title =
    run.status === 'running' ? 'Building…'
    : run.status === 'awaiting_approval' ? 'Plan ready — review before building'
    : run.status === 'done' ? 'Build finished'
    : run.status === 'stopped' ? 'Build stopped'
    : 'Build failed';

  return (
    <div style={{
      backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          <Box size={14} color="#60a5fa" />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
          {(run.summary ?? run.plan?.summary) && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              — {run.summary ?? run.plan?.summary}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {running && onStop && (
            <button className="btn btn-secondary btn-sm" onClick={onStop}><Square size={11} /> Stop</button>
          )}
          {run.status === 'awaiting_approval' && onRunPlan && (
            <button className="btn btn-primary btn-sm" onClick={onRunPlan} disabled={busy}><Play size={11} /> Build this plan</button>
          )}
          {!running && run.checkpoint && onUndo && run.status !== 'awaiting_approval' && (
            <button className="btn btn-secondary btn-sm" onClick={onUndo} disabled={busy} title="Restore the scene to how it was before this build">
              <Undo2 size={11} /> Undo build
            </button>
          )}
        </div>
      </div>

      {/* Reference image: what was attached, what the model read from it, and how the result compared */}
      {run.reference && (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-primary)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {run.reference.images.map((src, n) => (
              <img key={n} src={src} alt={`Reference ${n + 1}`} style={{ height: '58px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-medium)' }} />
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Reference image{run.steps.find((s) => s.key === 'reference')?.status === 'running' ? ' — reading it…' : ''}
              </span>
              {run.reference.similarity !== undefined && (
                <span>Result vs reference: <strong style={{ color: run.reference.similarity >= 7 ? '#34d399' : run.reference.similarity >= 4 ? '#fbbf24' : '#f87171' }}>{run.reference.similarity.toFixed(1)}/10</strong></span>
              )}
            </div>
          </div>
          {run.reference.error && <div style={{ fontSize: '11.5px', color: '#f87171' }}>{run.reference.error}</div>}
          {run.reference.text.trim() && (
            <details open={run.steps.find((s) => s.key === 'reference')?.status === 'running' || undefined}>
              <summary style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)' }}>What the model saw in it</summary>
              <div style={{ marginTop: '4px', maxHeight: '170px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                {run.reference.text.trim()}
              </div>
            </details>
          )}
          {(run.reference.differences ?? []).length > 0 && (
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>Still different from the reference:</div>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                {(run.reference.differences ?? []).map((d, n) => <li key={n}>{d}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Thinking — the model's own words, streamed as it writes them */}
      {thinking.trim() && (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-primary)' }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', justifyContent: 'flex-start', gap: '6px', padding: '6px 8px', fontSize: '11.5px', color: 'var(--text-secondary)' }}
            onClick={() => setThinkingOpen(!isThinkingOpen)}
          >
            {isThinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Brain size={12} color="#a78bfa" />
            {thinkingNow ? 'Thinking…' : 'How it thought about this'}
            {thinkingNow && <Loader2 size={11} className="spin" color="#a78bfa" />}
          </button>
          {isThinkingOpen && (
            <div
              ref={thinkingRef}
              style={{
                padding: '2px 12px 10px', maxHeight: '190px', overflowY: 'auto', whiteSpace: 'pre-wrap',
                fontSize: '11.5px', lineHeight: 1.55, color: 'var(--text-secondary)',
              }}
            >
              {thinking.replace(/\n?\s*SUCCESS CRITERIA:[\s\S]*$/i, '').trim()}
            </div>
          )}
        </div>
      )}

      {/* Success criteria — written before planning, judged by the reviewer at the end */}
      {criteria.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            <ListChecks size={12} /> Success criteria
          </div>
          {criteria.map((text, n) => {
            const v = verdictFor(text);
            return (
              <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                {v?.met === true ? <CheckCircle2 size={12} color="#34d399" style={{ marginTop: '2px', flexShrink: 0 }} />
                  : v?.met === false ? <XCircle size={12} color="#f87171" style={{ marginTop: '2px', flexShrink: 0 }} />
                  : <MinusCircle size={12} color={v ? '#fbbf24' : 'var(--text-disabled)'} style={{ marginTop: '2px', flexShrink: 0 }} />}
                <span>
                  {text}
                  {v?.met === null && <span style={{ color: '#fbbf24' }}> — can't be judged from the plan alone</span>}
                  {v?.note && v.met !== null && <span style={{ color: 'var(--text-muted)' }}> — {v.note}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* The general pipeline's step list: status, attempts, and the code the agent wrote */}
      {(run.work ?? []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Build steps</div>
          {(run.work ?? []).map((w) => (
            <details key={w.id} style={{ fontSize: '11.5px' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px', listStyle: 'none' }}>
                {w.status === 'passed' ? <CheckCircle2 size={12} color="#34d399" />
                  : w.status === 'running' ? <Loader2 size={12} className="spin" color="#60a5fa" />
                  : w.status === 'failed' ? <XCircle size={12} color="#f87171" />
                  : w.status === 'unmet' ? <AlertTriangle size={12} color="#fbbf24" />
                  : w.status === 'unchecked' ? <MinusCircle size={12} color="#fbbf24" />
                  : <Circle size={12} color="var(--text-disabled)" />}
                <span style={{ color: 'var(--text-primary)' }}>{w.title}</span>
                {w.attempts > 1 && <span style={{ color: 'var(--text-muted)' }}>· attempt {w.attempts}</span>}
                {w.created > 0 && <span style={{ color: 'var(--text-muted)' }}>· {w.created} object(s)</span>}
              </summary>
              <div style={{ margin: '4px 0 6px 19px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <div>{w.goal}</div>
                {w.note && <div style={{ color: '#fbbf24' }}>{w.note}</div>}
                {w.code && <pre style={{ margin: '4px 0 0', padding: '6px 8px', maxHeight: '160px', overflow: 'auto', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-xs)', fontSize: '10.5px' }}>{w.code}</pre>}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Steps */}
      {run.status !== 'awaiting_approval' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {run.steps.filter((s) => s.status !== 'pending' || running).map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' }}>
              {stepIcon(s.status)}
              <span style={{ color: s.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{s.label}</span>
              {s.detail && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>· {s.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Plan preview (Plan mode) */}
      {run.status === 'awaiting_approval' && run.plan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
          {run.plan.rooms.map((room) => (
            <div key={room.id}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {room.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {room.width}×{room.depth} m</span>
              </div>
              <ul style={{ margin: '3px 0 0 16px', padding: 0, color: 'var(--text-secondary)' }}>
                {run.plan!.items.filter((i) => i.room === room.id).map((i) => (
                  <li key={i.id}>
                    {i.what}
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' '}— {i.placement.replace(/_/g, ' ')}{i.wall ? ` (${i.wall})` : ''}{i.corner ? ` (${i.corner})` : ''}{i.target ? ` ${i.target}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {run.error && (
        <div style={{ fontSize: '12px', color: run.status === 'stopped' ? '#fbbf24' : '#f87171' }}>{run.error}</div>
      )}

      {/* Checklist */}
      {run.checklist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '2px' }}>
            Checklist{run.structure ? ` · ${run.structure.rooms} room(s), ${run.structure.doors} door(s), ${run.structure.windows} window(s)` : ''}
          </div>
          {run.checklist.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: '7px', fontSize: '11.5px' }}>
              <span style={{ color: CHECK_STYLE[c.status].color, fontWeight: 600, minWidth: '74px' }}>{CHECK_STYLE[c.status].label}</span>
              <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
              <span style={{ color: 'var(--text-muted)' }}>· {c.room}</span>
              {c.note && c.status !== 'ok' && <span style={{ color: 'var(--text-muted)' }}>— {c.note}</span>}
            </div>
          ))}
        </div>
      )}

      {run.issues.filter((i) => i.severity === 'warning').length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {run.issues.filter((i) => i.severity === 'warning').map((i, n) => (
            <div key={n} style={{ display: 'flex', gap: '6px', fontSize: '11.5px', color: '#fbbf24' }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '1px' }} /> {i.message}
            </div>
          ))}
        </div>
      )}

      {/* Review renders */}
      {run.images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: zoomed === null ? `repeat(${Math.min(run.images.length, 3)}, 1fr)` : '1fr', gap: '6px' }}>
          {run.images.map((img, n) => (zoomed === null || zoomed === n) && (
            <figure key={n} style={{ margin: 0, cursor: 'zoom-in' }} onClick={() => setZoomed(zoomed === n ? null : n)}>
              <img src={img.data} alt={img.label} style={{ width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', display: 'block' }} />
              <figcaption style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{img.label}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* Activity log */}
      {run.log.length > 0 && (
        <div>
          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 0', fontSize: '11px', color: 'var(--text-muted)' }} onClick={() => setShowLog(!showLog)}>
            {showLog ? <ChevronDown size={11} /> : <ChevronRight size={11} />} What the agent did ({run.log.length})
          </button>
          {showLog && (
            <ol style={{ margin: '4px 0 0 18px', padding: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {run.log.map((line, n) => <li key={n}>{line}</li>)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};
