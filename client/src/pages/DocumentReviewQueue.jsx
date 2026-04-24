import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { candidatePortalAPI } from '../services/api';

function ReviewRow({ doc, onReviewed }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function review(decision) {
    if (decision === 'rejected' && !notes.trim()) {
      toast.error('Rejection requires review notes');
      return;
    }
    setBusy(true);
    try {
      await candidatePortalAPI.reviewDocument(doc.id, { decision, review_notes: notes });
      toast.success(`Document ${decision}`);
      onReviewed?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: 16,
        background: 'var(--surface)',
        marginBottom: 12,
      }}
    >
      <div className="flex flex-wrap items-start gap-3" style={{ justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: 14, wordBreak: 'break-word' }}>
            {doc.candidate_name} · {doc.title || doc.kind}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
            {doc.job_title || '—'} · Uploaded {new Date(doc.updated_at || doc.created_at).toLocaleString()} · v{doc.version || 1}
          </div>
        </div>
        <a
          href={doc.file_path}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 12,
            padding: '6px 12px',
            background: 'var(--accent-blue-soft)',
            color: 'var(--accent-blue)',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Open file ↗
        </a>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          marginTop: 10,
          fontSize: 12,
          color: 'var(--accent-blue)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline',
        }}
      >
        {expanded ? 'Hide review form' : 'Review this document'}
      </button>

      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (required for rejection)"
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
              onClick={() => review('accepted')}
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
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => review('rejected')}
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
              Reject & request reupload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DocumentReviewQueue() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  async function load() {
    try {
      setLoading(true);
      const res = await candidatePortalAPI.reviewQueue();
      setDocs(res.data?.documents || []);
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

  const filtered = docs.filter((d) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      (d.candidate_name || '').toLowerCase().includes(q) ||
      (d.title || '').toLowerCase().includes(q) ||
      (d.kind || '').toLowerCase().includes(q) ||
      (d.job_title || '').toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 20, justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
            Document review queue
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 4 }}>
            {docs.length} document{docs.length === 1 ? '' : 's'} awaiting your review
          </div>
        </div>
        <input
          type="search"
          placeholder="Filter by candidate, job, document…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--line)',
            borderRadius: 8,
            fontSize: 13,
            minWidth: 240,
          }}
        />
      </div>

      {loading && <div style={{ color: 'var(--text-faint)' }}>Loading…</div>}
      {error && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: 'var(--danger-soft, #fee2e2)',
            color: 'var(--danger-text)',
          }}
        >
          {error}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div
          style={{
            padding: 40,
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-muted)',
            border: '1px dashed var(--line-strong)',
            textAlign: 'center',
            color: 'var(--text-faint)',
          }}
        >
          Nothing pending. All caught up.
        </div>
      )}

      {filtered.map((d) => (
        <ReviewRow key={d.id} doc={d} onReviewed={load} />
      ))}
    </div>
  );
}
