import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { candidatePortalAPI } from '../services/api';

const STAGE_LABELS = {
  post_selection: 'After Selection',
  before_offer_release: 'Before Offer Release',
  after_offer_release: 'After Offer Release',
  after_offer_acceptance: 'After Offer Acceptance',
  before_joining: 'Before Joining',
  joining_day: 'Joining Day',
  after_joining: 'After Joining',
  ctc_acceptance: 'CTC Acceptance',
};

const STAGE_ORDER = [
  'post_selection',
  'before_offer_release',
  'after_offer_release',
  'after_offer_acceptance',
  'before_joining',
  'joining_day',
  'after_joining',
];

const STATUS_STYLE = {
  pending: { bg: 'var(--warning-soft, #fef3c7)', fg: 'var(--warning-text)', label: 'Awaiting upload' },
  uploaded: { bg: 'var(--accent-blue-soft)', fg: 'var(--accent-blue)', label: 'Under review' },
  accepted: { bg: 'var(--success-soft, #dcfce7)', fg: 'var(--success-text)', label: 'Approved' },
  rejected: { bg: 'var(--danger-soft, #fee2e2)', fg: 'var(--danger-text)', label: 'Needs resubmission' },
};

function DocumentCard({ doc, onUpload }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const style = STATUS_STYLE[doc.status] || STATUS_STYLE.pending;

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await candidatePortalAPI.uploadDocument(doc.id, fd);
      toast.success(`${doc.title || doc.kind} uploaded`);
      onUpload?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div className="flex flex-wrap items-start gap-2" style={{ justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: 14, wordBreak: 'break-word' }}>
            {doc.title || doc.kind || 'Document'}
          </div>
          {doc.description && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{doc.description}</div>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: 999,
            background: style.bg,
            color: style.fg,
            whiteSpace: 'nowrap',
          }}
        >
          {style.label}
        </span>
      </div>

      {doc.status === 'rejected' && doc.review_notes && (
        <div
          style={{
            fontSize: 12,
            padding: 10,
            borderRadius: 8,
            background: 'var(--danger-soft, #fee2e2)',
            color: 'var(--danger-text)',
            border: '1px solid var(--danger-text)',
          }}
        >
          <strong>Reviewer feedback:</strong> {doc.review_notes}
        </div>
      )}

      {doc.file_path && (
        <a
          href={doc.file_path}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'underline', wordBreak: 'break-all' }}
        >
          View uploaded file (v{doc.version || 1})
        </a>
      )}

      {doc.status !== 'accepted' && (
        <div>
          <input ref={fileRef} type="file" onChange={handleFile} disabled={busy} style={{ fontSize: 12 }} />
          {busy && <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>Uploading…</span>}
        </div>
      )}
    </div>
  );
}

function CtcRequestCard({ req, onRespond }) {
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(choice) {
    if (!choice) return;
    if (choice !== 'accepted' && !notes.trim()) {
      toast.error('Please add a note explaining your decision');
      return;
    }
    setBusy(true);
    try {
      await candidatePortalAPI.respondCtc(req.id, { decision: choice, response_notes: notes });
      toast.success('Response recorded');
      onRespond?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit');
    } finally {
      setBusy(false);
    }
  }

  const pending = !req.candidate_response || req.candidate_response === 'pending';

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: 16,
        background: 'var(--surface)',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 8 }}>
        Requested by {req.requested_by} on {new Date(req.created_at).toLocaleString()}
      </div>
      {req.ctc_text && (
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: 'var(--surface-muted)',
            borderRadius: 8,
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
            border: '1px solid var(--line)',
          }}
        >
          {req.ctc_text}
        </pre>
      )}
      {req.message && (
        <p style={{ fontSize: 13, color: 'var(--text-body)', marginTop: 10 }}>{req.message}</p>
      )}

      {pending ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note (required if declining or renegotiating)"
            rows={3}
            style={{
              width: '100%',
              padding: 10,
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontSize: 13,
              resize: 'vertical',
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('accepted')}
              style={{
                padding: '8px 16px',
                background: 'var(--success-text)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Accept CTC
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('renegotiated')}
              style={{
                padding: '8px 16px',
                background: 'var(--warning-text)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Request renegotiation
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit('declined')}
              style={{
                padding: '8px 16px',
                background: 'var(--danger-text)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-body)' }}>
          <strong>Your response:</strong> {req.candidate_response}
          {req.response_notes && <div style={{ marginTop: 6, color: 'var(--text-faint)' }}>"{req.response_notes}"</div>}
        </div>
      )}
    </div>
  );
}

export default function CandidatePortal() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const res = await candidatePortalAPI.me();
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const docs = data?.documents || [];
    const byStage = {};
    for (const d of docs) {
      const key = d.stage || 'post_selection';
      (byStage[key] = byStage[key] || []).push(d);
    }
    return byStage;
  }, [data]);

  const progress = useMemo(() => {
    const docs = data?.documents || [];
    if (!docs.length) return { done: 0, total: 0, pct: 0 };
    const done = docs.filter((d) => d.status === 'accepted').length;
    return { done, total: docs.length, pct: Math.round((done / docs.length) * 100) };
  }, [data]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}>Loading your portal…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            padding: 16,
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger-soft, #fee2e2)',
            color: 'var(--danger-text)',
            border: '1px solid var(--danger-text)',
          }}
        >
          We couldn't load your portal: {error}
        </div>
      </div>
    );
  }

  const app = data?.application;
  const ctcRequests = data?.ctc_requests || [];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      {/* Hero */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0a1d30 0%, #0c8da3 100%)',
          color: '#fff',
          borderRadius: 'var(--radius-lg, 16px)',
          padding: '28px 24px',
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.8 }}>
          Candidate Portal
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '6px 0 4px', wordBreak: 'break-word' }}>
          Welcome, {app?.candidate_name || 'candidate'}
        </h1>
        <div style={{ fontSize: 14, opacity: 0.9, wordBreak: 'break-word' }}>
          {app?.job_title ? <>Offer pipeline for <strong>{app.job_title}</strong></> : 'Your onboarding checklist is below'}
        </div>
        {progress.total > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.9 }}>
              {progress.done} of {progress.total} documents approved · {progress.pct}%
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.2)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progress.pct}%`,
                  height: '100%',
                  background: '#10b981',
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* CTC Requests */}
      {ctcRequests.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
            Compensation confirmation
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ctcRequests.map((r) => (
              <CtcRequestCard key={r.id} req={r} onRespond={load} />
            ))}
          </div>
        </section>
      )}

      {/* Documents by stage */}
      {STAGE_ORDER.map((stageKey) => {
        const docs = grouped[stageKey];
        if (!docs || docs.length === 0) return null;
        return (
          <section key={stageKey} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
              {STAGE_LABELS[stageKey] || stageKey}
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
              }}
            >
              {docs.map((d) => (
                <DocumentCard key={d.id} doc={d} onUpload={load} />
              ))}
            </div>
          </section>
        );
      })}

      {(!data?.documents || data.documents.length === 0) && ctcRequests.length === 0 && (
        <div
          style={{
            padding: 32,
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-muted)',
            border: '1px dashed var(--line-strong)',
            textAlign: 'center',
            color: 'var(--text-faint)',
          }}
        >
          No action items yet. You'll be notified when HR requests documents or CTC acceptance.
        </div>
      )}
    </div>
  );
}
