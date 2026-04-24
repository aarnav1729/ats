import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import InfoTip from '../components/InfoTip';
import { candidatesAPI } from '../services/api';

const STAGES = [
  { key: 'before_offer_release', label: 'Before Offer Release' },
  { key: 'after_offer_release', label: 'After Offer Release' },
  { key: 'after_offer_acceptance', label: 'After Offer Acceptance' },
  { key: 'before_joining', label: 'Before Joining' },
  { key: 'joining_day', label: 'Joining Day' },
  { key: 'after_joining', label: 'After Joining' },
];

const STAGE_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.key, stage.label]));

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  uploaded: 'bg-blue-100 text-blue-700 border-blue-200',
  accepted: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_ICONS = {
  pending: (
    <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  uploaded: (
    <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  accepted: (
    <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  rejected: (
    <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  ),
};

function isPreviewableFile(filePath = '') {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(filePath);
}

function renderInlinePreview(filePath, title) {
  if (!filePath || !isPreviewableFile(filePath)) return null;
  if (/\.(png|jpe?g|gif|webp)$/i.test(filePath)) {
    return <img src={filePath} alt={title} className="mt-4 w-full rounded-2xl border border-gray-200 object-contain max-h-[28rem] bg-white" />;
  }
  return <iframe src={filePath} title={title} className="mt-4 h-[28rem] w-full rounded-2xl border border-gray-200 bg-white" />;
}

function normalizeTaskDocuments(payload) {
  if (Array.isArray(payload?.documents)) return payload.documents;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  if (!payload?.tasks || typeof payload.tasks !== 'object') return [];
  return Object.entries(payload.tasks).flatMap(([stage, docs]) =>
    Array.isArray(docs) ? docs.map((doc) => ({ ...doc, stage: doc.stage || stage })) : []
  );
}

export default function CandidatePage() {
  const [tasks, setTasks] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState(STAGES[0].key);
  const [uploading, setUploading] = useState(null);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const res = await candidatesAPI.myTasks();
      const data = res.data;
      setTasks(data);
      setDocuments(normalizeTaskDocuments(data));
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, []);

  const handleUpload = async (doc) => {
    const documentId = doc.id ?? doc._id;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.xls';
    input.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        setUploading(documentId);
        const formData = new FormData();
        formData.append('file', file);
        await candidatesAPI.uploadDocument(doc.application_id || tasks?.application_id, documentId, formData);
        toast.success('Document uploaded');
        loadTasks();
      } catch {
        toast.error('Upload failed');
      } finally {
        setUploading(null);
      }
    };
    input.click();
  };

  const availableStages = useMemo(() => {
    const docStages = new Set(documents.map((d) => d.stage).filter(Boolean));
    return STAGES.map((s) => s.key).filter((key) => docStages.has(key));
  }, [documents]);

  useEffect(() => {
    if (availableStages.length > 0 && !availableStages.includes(activeStage)) {
      setActiveStage(availableStages[0]);
    }
  }, [activeStage, availableStages]);

  const stageDocs = useMemo(() => documents.filter((doc) => doc.stage === activeStage), [activeStage, documents]);
  const completedDocs = documents.filter((doc) => doc.status === 'accepted').length;
  const uploadedDocs = documents.filter((doc) => doc.status === 'uploaded').length;
  const pendingDocs = documents.filter((doc) => doc.status === 'pending' || doc.status === 'rejected').length;
  const progressPercent = documents.length > 0 ? Math.round(((completedDocs + uploadedDocs) / documents.length) * 100) : 0;
  const firstDoc = documents[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!documents.length) {
    return (
      <div className="workspace-shell">
        <section className="workspace-hero animate-fade-in-up">
          <p className="workspace-eyebrow">My Tasks</p>
          <h1 className="page-title mt-2">No tasks assigned yet</h1>
          <p className="mt-4 text-sm text-gray-600">
            Document requests will appear here once a recruiter initiates your onboarding or offer-stage tasks.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      {/* Hero with progress */}
      <section className="aurora-panel animate-fade-in-up">
        <div className="aurora-content">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">My Tasks</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                {firstDoc?.job_title || 'Document Checklist'}
              </h1>
              <p className="mt-2 text-sm text-white/70">{firstDoc?.app_status || 'Upload required documents to proceed'}</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{progressPercent}%</p>
                <p className="text-xs text-cyan-200 mt-1">Complete</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur">
                  <p className="text-xl font-bold text-white">{completedDocs}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-green-300">Accepted</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur">
                  <p className="text-xl font-bold text-white">{uploadedDocs}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-300">In Review</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur">
                  <p className="text-xl font-bold text-white">{pendingDocs}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Pending</p>
                </div>
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-6 h-2 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-green-400 transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* Stage sidebar */}
        <aside className="workspace-card xl:sticky xl:top-6 xl:self-start animate-fade-in-up stagger-1">
          <p className="workspace-kicker">Document Stages</p>
          <div className="mt-4 space-y-2">
            {availableStages.map((stage) => {
              const stageCount = documents.filter((doc) => doc.stage === stage).length;
              const doneCount = documents.filter((doc) => doc.stage === stage && doc.status === 'accepted').length;
              const selected = stage === activeStage;
              const allDone = stageCount > 0 && doneCount === stageCount;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setActiveStage(stage)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200 ${
                    selected
                      ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 break-words">{STAGE_LABELS[stage] || stage}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{doneCount}/{stageCount} done</p>
                    </div>
                    {allDone ? (
                      <span className="flex-shrink-0 h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
                        <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </span>
                    ) : (
                      <span className="glass-chip text-indigo-700 text-xs">{stageCount}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Documents grid */}
        <section className="space-y-4 animate-fade-in-up stagger-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="section-title">{STAGE_LABELS[activeStage] || activeStage}</h2>
              <InfoTip text="Upload the required documents. Accepted formats: PDF, JPG, PNG, DOC, XLSX. Max file size: 10MB." />
            </div>
            <span className="glass-chip text-gray-600">{stageDocs.length} document{stageDocs.length !== 1 ? 's' : ''}</span>
          </div>

          {stageDocs.length === 0 ? (
            <div className="workspace-card">
              <div className="py-12 text-center text-sm text-gray-400">
                No documents required for this stage.
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {stageDocs.map((doc, idx) => (
                <div
                  key={doc.id ?? doc._id}
                  className="workspace-card animate-fade-in-up"
                  style={{ animationDelay: `${(idx + 1) * 80}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {STATUS_ICONS[doc.status] || STATUS_ICONS.pending}
                      <div>
                        <h3 className="text-base font-semibold tracking-[-0.01em] text-gray-950">
                          {doc.document_name || doc.name}
                        </h3>
                        {doc.description && (
                          <p className="mt-1 text-sm text-gray-500">{doc.description}</p>
                        )}
                      </div>
                    </div>
                    <span className={`badge border text-xs ${STATUS_STYLES[doc.status] || STATUS_STYLES.pending}`}>
                      {doc.status}
                    </span>
                  </div>

                  {doc.rejection_reason && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <p className="text-sm font-semibold text-red-700">Re-upload required</p>
                      <p className="mt-1 text-sm text-red-600">{doc.rejection_reason}</p>
                    </div>
                  )}

                  {doc.file_path ? (
                    <div className="mt-4">
                      <a href={doc.file_path} target="_blank" rel="noreferrer" className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">
                        View uploaded file
                      </a>
                      {renderInlinePreview(doc.file_path, doc.file_name || doc.document_name || 'Document')}
                    </div>
                  ) : null}

                  <div className="mt-4">
                    {(doc.status === 'pending' || doc.status === 'rejected') ? (
                      <button
                        onClick={() => handleUpload(doc)}
                        disabled={uploading === (doc.id ?? doc._id)}
                        className="btn-primary w-full disabled:opacity-50"
                      >
                        {uploading === (doc.id ?? doc._id)
                          ? 'Uploading...'
                          : doc.status === 'rejected'
                            ? 'Re-upload Document'
                            : 'Upload Document'}
                      </button>
                    ) : doc.status === 'uploaded' ? (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 text-center">
                        Uploaded — awaiting recruiter review
                      </div>
                    ) : (
                      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700 text-center">
                        Accepted
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
