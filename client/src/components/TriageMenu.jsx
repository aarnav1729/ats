// TriageMenu — single component that exposes the candidate-row actions
// described in the Phase 5 spec: HR reject (reason dropdown), Move to job
// (searchable picker), Move to talent pool, Blacklist (phone ban), Shortlist
// (with optional rounds + interviewers override).

import { useEffect, useState, useRef } from 'react';
import { triageAPI, blacklistAPI } from '../services/api';
import toast from 'react-hot-toast';

const REJECTION_REASONS = [
  'Not meeting experience criteria',
  'Skill mismatch',
  'Compensation expectation mismatch',
  'Location preference mismatch',
  'Notice period concerns',
  'Failed initial screening',
  'Profile better suited for other roles',
  'Candidate withdrew',
  'Other',
];

export default function TriageMenu({ application, onChanged, compact }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'reject' | 'movejob' | 'tp' | 'blacklist' | 'shortlist' | null
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const close = () => { setModal(null); setOpen(false); };
  const done = (msg) => { toast.success(msg); close(); onChanged?.(); };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`v2-btn-ghost ${compact ? 'text-xs' : ''}`}
        style={compact ? { padding: '6px 10px' } : undefined}
      >
        Triage ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl v2-fade-up">
          <Item label="✓ Shortlist" onClick={() => setModal('shortlist')} />
          <Item label="↪ Move to another job" onClick={() => setModal('movejob')} />
          <Item label="🪣 Move to talent pool" onClick={() => setModal('tp')} />
          <Item label="✕ HR reject" tone="danger" onClick={() => setModal('reject')} />
          <Item label="⛔ Blacklist phone" tone="danger" onClick={() => setModal('blacklist')} />
        </div>
      )}

      {modal === 'shortlist' && <ShortlistModal app={application} onClose={close} onDone={() => done('Shortlisted')} />}
      {modal === 'movejob' && <MoveJobModal app={application} onClose={close} onDone={(job) => done(`Moved to ${job.job_title}`)} />}
      {modal === 'tp' && <TalentPoolModal app={application} onClose={close} onDone={() => done('Moved to Talent Pool')} />}
      {modal === 'reject' && <RejectModal app={application} onClose={close} onDone={() => done('Rejected with email sent')} />}
      {modal === 'blacklist' && <BlacklistModal app={application} onClose={close} onDone={() => done('Phone blacklisted, admins notified')} />}
    </div>
  );
}

function Item({ label, onClick, tone }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 transition ${tone === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-800'}`}
    >{label}</button>
  );
}

function ModalShell({ title, children, onClose, footer }) {
  return (
    <div className="app-modal-backdrop" onClick={onClose}>
      <div className="app-modal-panel app-modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-header">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="app-modal-body" style={{ maxHeight: 'calc(90vh - 160px)', overflowY: 'auto' }}>
          {children}
        </div>
        <div className="app-modal-footer flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

// ── Shortlist with rounds + interviewers override ─────────────────────────
function ShortlistModal({ app, onClose, onDone }) {
  const [rounds, setRounds] = useState(app.no_of_rounds || 2);
  const [interviewers, setInterviewers] = useState(() => {
    const seed = Array.isArray(app.interviewers) ? app.interviewers : [];
    return Array.from({ length: 3 }, (_, i) => Array.isArray(seed[i]) ? seed[i].join(', ') : (seed[i] || ''));
  });
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const interviewers_per_round = interviewers.slice(0, rounds).map((s) =>
        s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
      );
      await triageAPI.shortlist(app.application_id || app.id, {
        no_of_rounds: rounds,
        interviewers_per_round,
        comment,
      });
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Shortlist failed');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={`Shortlist ${app.candidate_name}`}
      onClose={onClose}
      footer={(<>
        <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="v2-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Shortlist & notify'}</button>
      </>)}
    >
      <p className="text-sm text-slate-700 mb-4">
        Confirm the interview plan for this specific candidate. The job's defaults are pre-filled - change them if this profile needs different rounds or interviewers.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Rounds</label>
          <select className="input-field mt-1 w-full" value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: rounds }).map((_, i) => (
          <div key={i}>
            <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Round {i + 1} - interviewer emails (comma-separated)</label>
            <input className="input-field mt-1 w-full" value={interviewers[i] || ''} onChange={(e) => {
              const next = [...interviewers]; next[i] = e.target.value; setInterviewers(next);
            }} placeholder="alice@premier… , bob@premier…" />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason for change (optional, audited)</label>
        <input className="input-field mt-1 w-full" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. add a senior reviewer for this profile" />
      </div>
    </ModalShell>
  );
}

// ── Move to another job ───────────────────────────────────────────────────
function MoveJobModal({ app, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    triageAPI.jobsSearchable(q).then((r) => { if (active) setResults(r.data.items || []); });
    return () => { active = false; };
  }, [q]);

  const submit = async () => {
    if (!picked) return;
    setSaving(true);
    try {
      const r = await triageAPI.moveToJob(app.application_id || app.id, picked.job_id);
      onDone(r.data.to_job);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Move failed');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={`Move ${app.candidate_name} to another job`}
      onClose={onClose}
      footer={(<>
        <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="v2-btn-primary" onClick={submit} disabled={!picked || saving}>{saving ? 'Moving…' : 'Move candidate'}</button>
      </>)}
    >
      <input className="input-field w-full" placeholder="Search by job title, ATS ID, or HR One ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-[40vh] overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {results.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-500">No jobs match.</p>
        ) : results.map((j) => (
          <button
            key={j.job_id}
            onClick={() => setPicked(j)}
            className={`block w-full text-left border-b border-slate-100 px-4 py-3 text-sm transition ${picked?.job_id === j.job_id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
          >
            <p className="font-semibold text-slate-900">{j.job_title}</p>
            <p className="text-xs text-slate-500">{j.label}</p>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

// ── Move to talent pool ───────────────────────────────────────────────────
function TalentPoolModal({ app, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await triageAPI.moveToTalentPool(app.application_id || app.id, reason);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Move failed');
    } finally { setSaving(false); }
  };
  return (
    <ModalShell
      title={`Move ${app.candidate_name} to talent pool`}
      onClose={onClose}
      footer={(<>
        <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="v2-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Moving…' : 'Move to pool'}</button>
      </>)}
    >
      <p className="text-sm text-slate-700">The candidate's full history (interviews, documents, comments) is retained. Their card in the talent pool will note that you moved them here from <strong>{app.job_title || app.ats_job_id}</strong>.</p>
      <div className="mt-4">
        <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason (optional)</label>
        <input className="input-field mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stronger match for upcoming requisitions" />
      </div>
    </ModalShell>
  );
}

// ── HR reject ─────────────────────────────────────────────────────────────
function RejectModal({ app, onClose, onDone }) {
  const [reason, setReason] = useState(REJECTION_REASONS[0]);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const final = reason === 'Other' ? custom.trim() : reason;
    if (!final) return toast.error('Reason required');
    setSaving(true);
    try {
      await triageAPI.hrReject(app.application_id || app.id, final);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };
  return (
    <ModalShell
      title={`Reject ${app.candidate_name}`}
      onClose={onClose}
      footer={(<>
        <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="v2-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Reject & email'}</button>
      </>)}
    >
      <p className="text-sm text-slate-700 mb-4">A polite, retention-focused decline email will be sent to the candidate. Their profile stays on file for future roles.</p>
      <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason</label>
      <select className="input-field mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
        {REJECTION_REASONS.map((r) => <option key={r}>{r}</option>)}
      </select>
      {reason === 'Other' && (
        <input className="input-field mt-3 w-full" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Describe the reason" />
      )}
    </ModalShell>
  );
}

// ── Blacklist ─────────────────────────────────────────────────────────────
function BlacklistModal({ app, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return toast.error('Reason required');
    setSaving(true);
    try {
      await blacklistAPI.add(app.application_id || app.id, reason);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };
  return (
    <ModalShell
      title={`Blacklist ${app.candidate_name}`}
      onClose={onClose}
      footer={(<>
        <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="v2-btn-primary" onClick={submit} disabled={saving} style={{ background: 'linear-gradient(135deg,#991b1b 0%,#ef4444 100%)' }}>{saving ? 'Banning…' : 'Confirm blacklist'}</button>
      </>)}
    >
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 mb-4">
        This will ban <strong>{app.candidate_phone || 'this phone'}</strong> from any future application across all jobs. HR admins are notified by email with the candidate's details and resume attached. This action is reversible by an HR admin.
      </div>
      <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason (required, audited)</label>
      <textarea className="input-field mt-1 w-full" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Misrepresented credentials in interview" />
    </ModalShell>
  );
}
