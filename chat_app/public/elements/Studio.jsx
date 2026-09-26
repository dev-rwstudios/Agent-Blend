import { useMemo, useState } from 'react';
import {
  Box, Camera, ChevronDown, ChevronRight, Crosshair, History, Library, Lightbulb,
  MessageSquareQuote, Monitor, Plus, RefreshCw, RotateCcw, Search, Shapes, Activity, Undo2, X
} from 'lucide-react';

const TABS = [
  { id: 'viewport', label: 'Viewport', icon: Monitor },
  { id: 'scene', label: 'Scene', icon: Shapes },
  { id: 'assets', label: 'Assets', icon: Library },
  { id: 'history', label: 'History', icon: History },
  { id: 'status', label: 'Status', icon: Activity },
];

const TYPE_ICONS = { MESH: Box, LIGHT: Lightbulb, CAMERA: Camera };

function timeAgo(seconds) {
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n || 0}`;
}

function IconButton({ title, onClick, children, disabled }) {
  return (
    <button className="ab-icon-btn" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div className="ab-empty">{children}</div>;
}

export default function Studio() {
  // The panel remounts whenever the server sends new props, so the open
  // tab is kept in sessionStorage to survive that.
  const [tab, setTabState] = useState(() => {
    try { return sessionStorage.getItem('ab-panel-tab') || 'viewport'; } catch { return 'viewport'; }
  });
  const setTab = (id) => {
    setTabState(id);
    try { sessionStorage.setItem('ab-panel-tab', id); } catch { /* storage unavailable */ }
  };
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [pending, setPending] = useState(null);
  const [expanded, setExpanded] = useState({});

  const run = async (name, payload = {}, key = name) => {
    setPending(key);
    try {
      await callAction({ name, payload });
    } finally {
      setPending(null);
    }
  };

  const status = props.status || {};
  const usage = props.usage || {};
  const scene = props.scene || null;
  const assets = props.assets || [];
  const checkpoints = props.checkpoints || [];

  // Hide children of collapsed parents (objects arrive depth-first).
  const visibleObjects = useMemo(() => {
    const out = [];
    let hideBelow = null;
    for (const o of scene?.objects || []) {
      if (hideBelow !== null && o.depth > hideBelow) continue;
      hideBelow = null;
      out.push(o);
      if (o.children > 0 && !expanded[o.name]) hideBelow = o.depth;
    }
    return out;
  }, [scene, expanded]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(assets.map((a) => a.category)))],
    [assets]
  );
  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inCategory = assets.filter((a) => category === 'all' || a.category === category);
    if (!q) return inCategory;
    // Name/category matches first, then tag matches (style, room type).
    const direct = inCategory.filter((a) => a.label.toLowerCase().includes(q) || a.category.includes(q));
    const byTag = inCategory.filter((a) => !direct.includes(a) && a.tags.some((t) => t.toLowerCase().includes(q)));
    return [...direct, ...byTag];
  }, [assets, query, category]);

  return (
    <div className="ab-panel">
      <div className="ab-conn">
        <span className={`ab-dot ${status.connected ? 'ok' : 'bad'}`} />
        <span className="ab-conn-text">
          {status.connected ? `Blender · ${status.host}:${status.port}` : 'Blender not connected'}
        </span>
        {status.model && <span className="ab-chip" title={status.provider}>{status.model}</span>}
      </div>
      {!status.ready && (
        <div className="ab-notice">
          {!status.connected
            ? (status.error || 'Start the blend-ai server in Blender (N-panel › blend-ai › Start Server).')
            : `No model selected${status.error ? ` — ${status.error}` : ''}. Open chat settings (the gear in the message box) to pick a provider and model.`}
        </div>
      )}

      <div className="ab-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`ab-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
            title={label}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'viewport' && (
        <div className="ab-section">
          <div className="ab-row-between">
            <span className="ab-muted">
              {props.viewport?.updated ? `Updated ${timeAgo(props.viewport.updated)}` : 'No capture yet'}
            </span>
            <IconButton title="Capture viewport" onClick={() => run('refresh_viewport')} disabled={pending === 'refresh_viewport'}>
              <RefreshCw size={15} className={pending === 'refresh_viewport' ? 'ab-spin' : ''} />
            </IconButton>
          </div>
          {props.viewport?.image ? (
            <img className="ab-viewport" src={props.viewport.image} alt="Blender viewport" />
          ) : (
            <Empty>The viewport updates after each turn that changes the scene.</Empty>
          )}
        </div>
      )}

      {tab === 'scene' && (
        <div className="ab-section">
          <div className="ab-row-between">
            <span className="ab-muted">
              {scene ? `${scene.scene} · ${scene.objects.filter((o) => o.depth === 0).length} top-level · ${scene.objects.length} total` : 'Scene not loaded'}
            </span>
            <IconButton title="Refresh scene" onClick={() => run('refresh_scene')} disabled={pending === 'refresh_scene'}>
              <RefreshCw size={15} className={pending === 'refresh_scene' ? 'ab-spin' : ''} />
            </IconButton>
          </div>
          {props.focus && (
            <div className="ab-focus">
              <MessageSquareQuote size={14} />
              <span>Next message refers to <b>{props.focus}</b></span>
              <IconButton title="Clear reference" onClick={() => run('reference_object', { name: null })}>
                <X size={14} />
              </IconButton>
            </div>
          )}
          {scene && scene.objects.length === 0 && <Empty>The scene is empty.</Empty>}
          <ul className="ab-list">
            {visibleObjects.map((o) => {
              const Icon = TYPE_ICONS[o.type] || Shapes;
              const open = !!expanded[o.name];
              return (
                <li key={o.name} className={`ab-item ${o.visible ? '' : 'hidden'}`} style={{ paddingLeft: 4 + o.depth * 16 }}>
                  {o.children > 0 ? (
                    <button
                      className="ab-twisty"
                      aria-label={open ? `Collapse ${o.name}` : `Expand ${o.name}`}
                      aria-expanded={open}
                      onClick={() => setExpanded({ ...expanded, [o.name]: !open })}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  ) : <span className="ab-twisty-space" />}
                  <Icon size={14} className="ab-muted" />
                  <span className="ab-item-name" title={`${o.name} (${o.type})`}>{o.name}</span>
                  {o.children > 0 && !open && <span className="ab-muted ab-small">{o.children}</span>}
                  <IconButton title="Frame in viewport" onClick={() => run('focus_object', { name: o.name }, `f-${o.name}`)}>
                    <Crosshair size={14} />
                  </IconButton>
                  <IconButton title="Refer to this in my next message" onClick={() => run('reference_object', { name: o.name })}>
                    <MessageSquareQuote size={14} />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'assets' && (
        <div className="ab-section">
          <div className="ab-search">
            <Search size={14} className="ab-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${assets.length} assets`}
              aria-label="Search assets"
            />
          </div>
          <select
            className="ab-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Asset category"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? `All categories (${assets.length})` : c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {filteredAssets.length === 0 && <Empty>No assets match.</Empty>}
          <div className="ab-assets">
            {filteredAssets.map((a) => (
              <div key={a.id} className="ab-asset">
                <div className="ab-asset-name" title={a.label}>{a.label}</div>
                <div className="ab-muted ab-dims" title="Width × depth × height">
                  {a.dims.width.toFixed(2)}×{a.dims.depth.toFixed(2)}×{a.dims.height.toFixed(2)} m
                </div>
                <button
                  className="ab-add"
                  onClick={() => run('add_asset', { id: a.id }, `a-${a.id}`)}
                  disabled={pending === `a-${a.id}`}
                >
                  {pending === `a-${a.id}` ? <RefreshCw size={13} className="ab-spin" /> : <Plus size={13} />}
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="ab-section">
          <div className="ab-row-between">
            <span className="ab-muted">
              {status.checkpoints ? 'A checkpoint is saved after each turn that changes the scene.' : 'Checkpoints are off (chat settings).'}
            </span>
            <IconButton title="Save a checkpoint now" onClick={() => run('create_checkpoint')} disabled={pending === 'create_checkpoint'}>
              <Plus size={15} />
            </IconButton>
          </div>
          {checkpoints.length > 1 && (
            <button className="ab-btn" onClick={() => run('undo_last')} disabled={pending === 'undo_last'}>
              <Undo2 size={14} /> Undo last change
            </button>
          )}
          {checkpoints.length === 0 && <Empty>No checkpoints yet.</Empty>}
          <ul className="ab-list">
            {checkpoints.map((c) => (
              <li key={c.id} className={`ab-checkpoint ${c.current ? 'current' : ''}`}>
                {c.thumb ? <img src={c.thumb} alt="" /> : <div className="ab-thumb-empty" />}
                <div className="ab-cp-text">
                  <div className="ab-cp-label" title={c.label}>{c.label}</div>
                  <div className="ab-muted ab-small">{c.current ? 'Current · ' : ''}{timeAgo(c.created)}</div>
                </div>
                {!c.current && (
                  <IconButton title="Restore this checkpoint" onClick={() => run('restore_checkpoint', { id: c.id }, `c-${c.id}`)} disabled={pending === `c-${c.id}`}>
                    <RotateCcw size={14} className={pending === `c-${c.id}` ? 'ab-spin' : ''} />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'status' && (
        <div className="ab-section">
          <dl className="ab-stats">
            <dt>Provider</dt><dd>{status.provider || '—'}</dd>
            <dt>Model</dt><dd>{status.model || '—'}</dd>
            <dt>Tools</dt><dd>{status.toolCount ? `${status.toolCount} (${status.toolset})` : '—'}</dd>
            <dt>Approvals</dt><dd>{status.approvals ? 'Ask before changes' : 'Off'}</dd>
            <dt>Last turn</dt><dd>{fmt(usage.turnIn)} in · {fmt(usage.turnOut)} out</dd>
            <dt>This chat</dt><dd>{fmt(usage.totalIn)} in · {fmt(usage.totalOut)} out</dd>
          </dl>
          {(props.modules || []).length > 0 && (
            <>
              <div className="ab-subhead">Toolset</div>
              <div className="ab-chips">
                {props.modules.map((m) => (
                  <span key={m.name} className="ab-chip" title={m.tools.join(', ')}>{m.label} · {m.tools.length}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
