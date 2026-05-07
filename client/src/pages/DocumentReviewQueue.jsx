import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { candidatePortalAPI } from '../services/api';

function renderInlinePreview(filePath, title) {
  if (!filePath) return null;
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(filePath);
  const isPdf = /\.pdf$/i.test(filePath);
  if (isImage) {
    return <img src={filePath} alt={title} className="max-h-[20rem] w-full rounded-lg border border-gray-200 object-contain bg-white" />;
  }
  if (isPdf) {
    return <iframe src={filePath} title={title} className="h-[20rem] w-full rounded-lg border border-gray-200 bg-white" />;
  }
  return null;
}

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

  const statusColors = {
    accepted: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    uploaded: 'bg-blue-100 text-blue-800',
    pending: 'bg-amber-100 text-amber-800',
  };

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
            {doc.job_title || ''} · Uploaded {new Date(doc.updated_at || doc.created_at).toLocaleString()} · v{doc.version || 1}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors[doc.status] || 'bg-gray-100 text-gray-700'}`}>
            {doc.status}
          </span>
          {doc.file_path && (
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
              Open ↗
            </a>
          )}
        </div>
      </div>

      {doc.rejection_reason && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <p className="text-xs font-semibold text-red-700">Rejection reason:</p>
          <p className="text-sm text-red-800 mt-1">{doc.rejection_reason}</p>
        </div>
      )}

      {doc.review_notes && (
        <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-xs font-semibold text-blue-700">Review notes:</p>
          <p className="text-sm text-blue-800 mt-1">{doc.review_notes}</p>
        </div>
      )}

      {doc.file_path && (
        <div className="mt-4">
          {renderInlinePreview(doc.file_path, doc.file_name || doc.document_name) || (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 text-center">
              Preview not available. Click "Open" to view.
            </div>
          )}
        </div>
      )}

      {doc.status === 'uploaded' && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              marginTop: 12,
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
                    background: '#059669',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => review('rejected')}
                  style={{
                    padding: '8px 16px',
                    background: '#dc2626',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Reject & Request Reupload
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Upload on candidate's behalf - surfaces as a thin row when the doc
          is still 'pending'. Recruiter can scan a hard copy at the desk
          without making the candidate log in. The audit trail records this
          as document.uploaded_by_hr so the provenance is unambiguous. */}
      {(doc.status === 'pending' || doc.status === 'rejected') && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'var(--surface-muted, #f8fafc)', border: '1px dashed var(--line, #e2e8f0)' }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint, #64748b)', marginBottom: 6 }}>
            Upload on candidate's behalf
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted, #475569)', marginBottom: 8 }}>
            Use this only when the candidate has handed over the file in person. The action is logged as <code>document.uploaded_by_hr</code>.
          </p>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.doc"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append('file', f);
              setBusy(true);
              try {
                const { candidatePortalAPI } = await import('../services/api');
                await candidatePortalAPI.uploadDocumentAsHr(doc.application_id, doc.id, fd);
                onReviewed?.();
              } catch (err) {
                console.error(err);
                e.target.value = '';
              } finally { setBusy(false); }
            }}
            style={{ fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({ title, documents, onReviewed, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const count = documents.length;
  const statusColors = {
    pending: 'bg-amber-500',
    uploaded: 'bg-blue-500',
    accepted: 'bg-green-500',
    rejected: 'bg-red-500',
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${statusColors[title.toLowerCase().replace(' ', '_')] || 'bg-gray-400'}`} />
          <span className="font-semibold text-gray-900">{title}</span>
          <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-sm">{count}</span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="p-4 bg-white">
          {count === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No documents in this category</p>
          ) : (
            documents.map((doc) => (
              <ReviewRow key={doc.id} doc={doc} onReviewed={onReviewed} />
            ))
          )}
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

  // Group documents by status
  const pendingUpload = filtered.filter(d => d.status === 'pending');
  const pendingReview = filtered.filter(d => d.status === 'uploaded');
  const reviewed = filtered.filter(d => ['accepted', 'rejected'].includes(d.status));

  // Sort by most recent first within each group
  const sortByDate = (arr) => arr.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 20, justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
            Document Review Queue
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 4 }}>
            {docs.length} total documents · {pendingUpload.length} pending upload · {pendingReview.length} pending review · {reviewed.length} reviewed
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
            background: '#fee2e2',
            color: '#b91c1c',
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

      {!loading && !error && filtered.length > 0 && (
        <>
          <CollapsibleSection
            title="Pending Upload"
            documents={sortByDate(pendingUpload)}
            onReviewed={load}
            defaultOpen={pendingUpload.length > 0}
          />
          <CollapsibleSection
            title="Pending Review"
            documents={sortByDate(pendingReview)}
            onReviewed={load}
            defaultOpen={pendingReview.length > 0}
          />
          <CollapsibleSection
            title="Reviewed"
            documents={sortByDate(reviewed)}
            onReviewed={load}
            defaultOpen={false}
          />
        </>
      )}
    </div>
  );
}