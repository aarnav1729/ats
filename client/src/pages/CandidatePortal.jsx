import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { candidatePortalAPI, ctcBreakupAPI } from '../services/api';
import CandidateChatPanel from '../components/CandidateChatPanel';
import OfferSignaturePanel from '../components/OfferSignaturePanel';
import SignaturePad from '../components/SignaturePad';

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

function CtcBreakupResponseCard({ breakup, onRespond, loading }) {
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState(null);

  return (
    <div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3">
        <p className="text-xs font-semibold text-amber-800 mb-2">Sign to Accept or Decline</p>
        <SignaturePad onChange={setSignature} height={100} />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add a note (required if declining)"
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--line)',
          fontSize: 13,
          marginBottom: 12,
          minHeight: 60,
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          onClick={() => onRespond('accepted', signature, null)}
          disabled={loading || !signature}
          style={{
            flex: 1,
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #10b981, #34d399)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading || !signature ? 0.6 : 1,
          }}
        >
          {loading ? 'Submitting...' : 'Accept & Sign'}
        </button>
        <button
          type="button"
          onClick={() => onRespond('rejected', null, notes)}
          disabled={loading || !notes.trim()}
          style={{
            flex: 1,
            padding: '10px 16px',
            background: '#fff',
            color: '#ef4444',
            border: '1px solid #ef4444',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13,
            cursor: loading || !notes.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !notes.trim() ? 0.6 : 1,
          }}
        >
          Decline with Reason
        </button>
      </div>
    </div>
  );
}

function CtcRequestCard({ req, onRespond }) {
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState(null);

  async function submit(choice) {
    if (!choice) return;
    if (choice !== 'accepted' && !notes.trim()) {
      toast.error('Please add a note explaining your decision');
      return;
    }
    if (choice === 'accepted' && !signature) {
      toast.error('Please sign to accept the CTC');
      return;
    }
    setBusy(true);
    try {
      await candidatePortalAPI.respondCtc(req.id, { 
        decision: choice, 
        response_notes: notes,
        signature_data: signature,
      });
      toast.success('Response recorded');
      setSignature(null);
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
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-2">CTC Acceptance Signature</p>
            <SignaturePad onChange={setSignature} height={120} />
          </div>
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
  const [ctcBreakup, setCtcBreakup] = useState(null);
  const [ctcBreakupLoading, setCtcBreakupLoading] = useState(false);

  async function loadCtcBreakup() {
    try {
      const res = await ctcBreakupAPI.myBreakup();
      setCtcBreakup(res.data?.breakup || null);
    } catch { setCtcBreakup(null); }
  }

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

  async function handleCtcBreakupResponse(decision, signature, notes) {
    if (!ctcBreakup) return;
    if (decision === 'accepted' && !signature) {
      toast.error('Please sign to accept the CTC breakup');
      return;
    }
    if (decision === 'rejected' && !notes?.trim()) {
      toast.error('Please add a note explaining your decision');
      return;
    }
    setCtcBreakupLoading(true);
    try {
      await ctcBreakupAPI.myRespond(ctcBreakup.id, {
        decision,
        signature_data: signature,
        notes,
      });
      toast.success(decision === 'accepted' ? 'CTC breakup accepted' : 'CTC breakup rejected');
      loadCtcBreakup();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit response');
    } finally {
      setCtcBreakupLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadCtcBreakup();
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
      {/* Hero  explicit white text on guaranteed dark gradient. !important defeats
          any tailwind/preflight color reset that was bleeding into the inline styles. */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0a1d30 0%, #143464 50%, #0c8da3 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '32px 28px',
          marginBottom: 24,
          boxShadow: '0 12px 28px rgba(11,29,54,0.18)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>
          Premier Energies · Candidate Portal
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '8px 0 6px', color: '#ffffff', letterSpacing: '-0.01em', lineHeight: 1.15 }}>
          Welcome, {app?.candidate_name || 'candidate'}
        </h1>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.92)', wordBreak: 'break-word', lineHeight: 1.5 }}>
          {app?.job_title ? <>Tracking your application for <strong style={{ color: '#fff' }}>{app.job_title}</strong></> : 'Your onboarding checklist is below'}
        </div>
        {progress.total > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'rgba(255,255,255,0.95)' }}>
              {progress.done} of {progress.total} documents approved · {progress.pct}%
            </div>
            <div style={{ height: 10, background: 'rgba(255,255,255,0.18)', borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div
                style={{
                  width: `${progress.pct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #10b981, #34d399)',
                  transition: 'width 0.4s cubic-bezier(.34,1.2,.64,1)',
                  boxShadow: '0 0 12px rgba(16,185,129,0.5)',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Active offer letter  premium signature flow */}
      <div style={{ marginBottom: 24 }}>
        <OfferSignaturePanel />
      </div>

      {/* Live conversation with the recruiting team */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
          Talk to your recruiter
        </h2>
        <CandidateChatPanel side="candidate" />
      </section>

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

      {/* CTC Breakup - New Flow */}
      {ctcBreakup && !ctcBreakup.candidate_decision && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
            Your Compensation Breakup
          </h2>
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              background: 'var(--surface)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12 }}>
              Sent by {ctcBreakup.created_by_email} on {new Date(ctcBreakup.created_at).toLocaleString()} · Version {ctcBreakup.version}
            </div>
            {ctcBreakup.breakup_html && (
              <div
                style={{
                  padding: 12,
                  background: 'var(--surface-muted)',
                  borderRadius: 8,
                  overflow: 'auto',
                  marginBottom: 16,
                }}
                dangerouslySetInnerHTML={{ __html: ctcBreakup.breakup_html }}
              />
            )}
            {ctcBreakup.attachment_path && (
              <a
                href={ctcBreakup.attachment_path}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  marginBottom: 16,
                  fontSize: 13,
                  color: 'var(--accent-blue)',
                  textDecoration: 'underline',
                }}
              >
                View attached CTC file{ctcBreakup.attachment_name ? `: ${ctcBreakup.attachment_name}` : ''}
              </a>
            )}
            <CtcBreakupResponseCard breakup={ctcBreakup} onRespond={handleCtcBreakupResponse} loading={ctcBreakupLoading} />
          </div>
        </section>
      )}

      {ctcBreakup?.candidate_decision === 'accepted' && (
        <section style={{ marginBottom: 32 }}>
          <div
            style={{
              border: '1px solid #10b981',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              background: '#ecfdf5',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#065f46' }}>
              ✓ You have accepted the compensation breakup
            </div>
            <div style={{ fontSize: 12, color: '#047857', marginTop: 4 }}>
              Accepted on {new Date(ctcBreakup.candidate_signed_at).toLocaleString()}
            </div>
          </div>
        </section>
      )}

      {ctcBreakup?.candidate_decision === 'rejected' && (
        <section style={{ marginBottom: 32 }}>
          <div
            style={{
              border: '1px solid #ef4444',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              background: '#fef2f2',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#991b1b' }}>
              ✗ You have rejected the compensation breakup
            </div>
            {ctcBreakup.candidate_decision_notes && (
              <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 4 }}>
                Reason: {ctcBreakup.candidate_decision_notes}
              </div>
            )}
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
