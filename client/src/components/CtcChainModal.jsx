// HR-side CTC chain modal. Recruiter 1 drafts the package and sends it through
// recruiter 2 → HR admin → optional approver. Each step can approve / reject /
// renegotiate. The current user can act if their role + email match the
// pending step.

import { useEffect, useState } from 'react';
import { ctcChainAPI } from '../services/api';
import { fmtIST } from './ui/v2';
import toast from 'react-hot-toast';

export default function CtcChainModal({ application, currentUser, onClose, onChanged }) {
  const [steps, setSteps] = useState([]);
  const [mode, setMode] = useState('view'); // 'view' | 'draft' | 'act'
  const [ctcText, setCtcText] = useState('');
  const [secondary, setSecondary] = useState('');
  const [approver, setApprover] = useState('');
  const [decision, setDecision] = useState('approved');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await ctcChainAPI.chain(application.application_id || application.id);
      setSteps(r.data.steps || []);
      setMode(r.data.steps?.length ? 'view' : 'draft');
    } catch { setMode('draft'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const startDraft = async () => {
    if (!ctcText.trim()) return toast.error('Paste the CTC structure');
    setBusy(true);
    try {
      await ctcChainAPI.start(application.application_id || application.id, {
        ctc_text: ctcText,
        secondary_recruiter_email: secondary || null,
        approver_email: approver || null,
      });
      toast.success('CTC sent for review');
      onChanged?.();
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setBusy(false); }
  };

  const act = async () => {
    setBusy(true);
    try {
      await ctcChainAPI.act(application.application_id || application.id, { decision, comments });
      toast.success(`Recorded: ${decision}`);
      onChanged?.();
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setBusy(false); }
  };

  const pending = steps.find((s) => s.status === 'pending');
  const canAct = pending && (
    (pending.assignee_email && pending.assignee_email.toLowerCase() === currentUser.email.toLowerCase())
    || (!pending.assignee_email && (pending.role_required === currentUser.role || (pending.role_required === 'approver' && currentUser.role === 'hr_admin')))
  );

  return (
    <div className="app-modal-backdrop" onClick={onClose}>
      <div className="app-modal-panel app-modal-panel-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="app-modal-header">
          <h3 className="text-lg font-semibold text-slate-900">CTC review chain - {application.candidate_name}</h3>
        </div>
        <div className="app-modal-body" style={{ maxHeight: 'calc(90vh - 160px)', overflowY: 'auto' }}>

          {/* Visual chain */}
          {steps.length > 0 && (
            <div className="mb-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Approval chain</p>
              <div className="flex items-center gap-2 flex-wrap">
                {steps.map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className={`rounded-xl border px-3 py-2 ${s.status === 'pending' ? 'border-indigo-300 bg-indigo-50' : s.status === 'approved' ? 'border-emerald-200 bg-emerald-50' : s.status === 'rejected' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Step {idx + 1}</p>
                      <p className="text-sm font-semibold text-slate-900 capitalize">{s.role_required.replace('_', ' ')}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{s.assignee_email || 'any'}</p>
                      <p className={`mt-1 text-[10px] font-bold uppercase tracking-[0.12em] ${s.status === 'pending' ? 'text-indigo-600' : s.status === 'approved' ? 'text-emerald-700' : s.status === 'rejected' ? 'text-rose-700' : 'text-slate-500'}`}>{s.status}</p>
                      {s.acted_at && <p className="text-[10px] text-slate-400 font-mono">{fmtIST(s.acted_at)}</p>}
                    </div>
                    {idx < steps.length - 1 && <span className="text-slate-300">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTC text */}
          {steps[0]?.ctc_text && (
            <div className="mb-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Compensation package</p>
              <pre className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap font-mono">{steps[0].ctc_text}</pre>
            </div>
          )}

          {mode === 'draft' || steps.length === 0 ? (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Compensation table (paste from Excel)</label>
                <textarea className="input-field mt-1 w-full font-mono text-xs" rows={9} value={ctcText} onChange={(e) => setCtcText(e.target.value)} placeholder="Component\tAmount\nBasic\t…" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Secondary recruiter (optional)</label>
                  <input className="input-field mt-1 w-full" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="recruiter2@…" />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Final approver (optional)</label>
                  <input className="input-field mt-1 w-full" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="cxo@…" />
                </div>
              </div>
              <p className="text-xs text-slate-500">After your draft, the chain will route automatically. HR admin always reviews. Add a final approver only if your policy requires CXO sign-off.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
                <button className="v2-btn-primary" onClick={startDraft} disabled={busy}>{busy ? 'Sending…' : 'Send for review'}</button>
              </div>
            </div>
          ) : pending && canAct ? (
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <p className="text-sm font-semibold text-slate-900">Your action on this step:</p>
              <div className="flex gap-2">
                {[
                  ['approved', 'Approve & forward', 'emerald'],
                  ['renegotiate', 'Renegotiate', 'amber'],
                  ['rejected', 'Reject CTC', 'rose'],
                ].map(([d, label, tone]) => (
                  <button
                    key={d}
                    onClick={() => setDecision(d)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition ${decision === d ? `border-${tone}-400 bg-${tone}-50 text-${tone}-800` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                  >{label}</button>
                ))}
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Comments {decision !== 'approved' && <span className="text-rose-500">*</span>}</label>
                <textarea className="input-field mt-1 w-full" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="v2-btn-ghost" onClick={onClose}>Cancel</button>
                <button className="v2-btn-primary" onClick={act} disabled={busy || (decision !== 'approved' && !comments.trim())}>{busy ? 'Submitting…' : `Submit decision`}</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">{pending ? 'You are not the assigned reviewer for the current step.' : 'No pending step.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
