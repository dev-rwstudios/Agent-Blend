import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, CheckCheck, MessageSquarePlus, ShieldAlert, X } from 'lucide-react';

function Call({ call }) {
  const [open, setOpen] = useState(false);
  const args = Object.entries(call.args || {});
  return (
    <li className="ab-call">
      <button className="ab-call-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="ab-call-name">{call.label}</span>
        {call.readOnly && <span className="ab-chip">read-only</span>}
        {!open && args.length > 0 && <span className="ab-muted ab-small ab-ellipsis">{call.summary}</span>}
      </button>
      {open && (
        <pre className="ab-args">{args.length ? JSON.stringify(call.args, null, 2) : 'No arguments'}</pre>
      )}
    </li>
  );
}

export default function ApprovalCard() {
  const [suggesting, setSuggesting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const calls = props.calls || [];

  const submit = (decision) => submitElement({ decision, feedback: feedback.trim() });

  return (
    <div className="ab-card">
      <div className="ab-card-head">
        <ShieldAlert size={16} className="ab-accent" />
        <span>Approve {calls.length === 1 ? 'this action' : `these ${calls.length} actions`}?</span>
      </div>
      <ul className="ab-calls">
        {calls.map((c, i) => <Call key={i} call={c} />)}
      </ul>
      {suggesting && (
        <textarea
          className="ab-textarea"
          autoFocus
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What should it do instead?"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && feedback.trim()) submit('suggest');
          }}
        />
      )}
      <div className="ab-actions">
        {suggesting ? (
          <>
            <button className="ab-btn primary" disabled={!feedback.trim()} onClick={() => submit('suggest')}>
              <MessageSquarePlus size={14} /> Send suggestion
            </button>
            <button className="ab-btn" onClick={() => setSuggesting(false)}>Back</button>
          </>
        ) : (
          <>
            <button className="ab-btn primary" onClick={() => submit('approve')}>
              <Check size={14} /> Approve
            </button>
            <button className="ab-btn" onClick={() => submit('approve_all')} title="Approve everything else in this turn too">
              <CheckCheck size={14} /> Approve all this turn
            </button>
            <button className="ab-btn" onClick={() => setSuggesting(true)}>
              <MessageSquarePlus size={14} /> Suggest changes
            </button>
            <button className="ab-btn danger" onClick={() => submit('reject')}>
              <X size={14} /> Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
