// CTC Approver Inbox - assigned approvers see candidates HR Admin has
// forwarded to them. Each row shows the package (breakup HTML + attachment +
// candidate name + job) with two actions: Approve / Reject (reason required).
// All approvers must approve for the candidate to advance to OfferInProcess;
// a single rejection sends the candidate to talent pool.

import { useEffect, useState } from 'react';
import { ctcBreakupAPI } from '../services/api';
import { Hero, fmtIST, PrimaryCTA, GhostBtn } from '../components/ui/v2';
import toast from 'react-hot-toast';

export default function ApproverInbox() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null); // { task, decision }
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await ctcBreakupAPI.approverTasks();
      setTasks(r.data?.tasks || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load tasks');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (acting.decision === 'rejected' && !comments.trim()) return toast.error('Comments required');
    setBusy(true);
    try {
      const res = await ctcBreakupAPI.approverAct(acting.task.application_id, {
        decision: acting.decision,
        comments,
      });
      toast.success(res.data.allApproved ? 'All approvers cleared - candidate moved to OfferInProcess' : `Recorded: ${acting.decision}`);
      setActing(null); setComments('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setBusy(false); }
  };

  const pending = tasks.filter((t) => t.status === 'pending');
  const acted = tasks.filter((t) => t.status !== 'pending');

  return (
    <div className="page-container space-y-5">
      <Hero
        eyebrow="CTC Approvals"
        title="Approver inbox"
        subtitle="Compensation packages forwarded to you by HR Admin. All assigned approvers must approve for the candidate to move forward - a single rejection returns them to the talent pool."
        actions={(<><PrimaryCTA onClick={load}>↻ Refresh</PrimaryCTA></>)}
      />

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" /></div>
      ) : (
        <>
          <Section title={`Awaiting your decision (${pending.length})`} accent="indigo">
            {pending.length === 0
              ? <Empty>No pending CTC approvals.</Empty>
              : pending.map((t) => (
                <Card
                  key={t.id} task={t}
                  onApprove={() => { setActing({ task: t, decision: 'approved' }); setComments(''); }}
                  onReject={() => { setActing({ task: t, decision: 'rejected' }); setComments(''); }}
                />))}
          </Section>

          {acted.length > 0 && (
            <Section title={`Already acted (${acted.length})`} accent="slate">
              {acted.map((t) => <Card key={t.id} task={t} readOnly />)}
            </Section>
          )}
        </>
      )}

      {acting && (
        <div className="app-modal-backdrop" onClick={() => setActing(null)}>
          <div className="app-modal-panel app-modal-panel-wide" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-header">
              <h3 className="text-lg font-semibold text-slate-900">
                {acting.decision === 'approved' ? 'Approve CTC' : 'Reject CTC'} · {acting.task.candidate_name}
              </h3>
            </div>
            <div className="app-modal-body" style={{ maxHeight: 'calc(90vh - 160px)', overflowY: 'auto' }}>
              <p className="text-sm text-slate-700 mb-3">
                {acting.decision === 'approved'
                  ? 'Optional comments. Once all approvers approve, the candidate moves to Offer In Process.'
                  : 'Reason is required. Rejecting will send the candidate to the talent pool with full historical timeline preserved.'}
              </p>
              <textarea
                className="input-field w-full"
                rows={4}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder={acting.decision === 'rejected' ? 'Reason (required)…' : 'Optional comments…'}
              />
            </div>
            <div className="app-modal-footer flex justify-end gap-2">
              <GhostBtn onClick={() => setActing(null)}>Cancel</GhostBtn>
              <PrimaryCTA onClick={submit} disabled={busy}>
                {busy ? 'Submitting…' : `Confirm ${acting.decision}`}
              </PrimaryCTA>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, accent, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`h-1.5 w-1.5 rounded-full ${accent === 'indigo' ? 'bg-indigo-500' : 'bg-slate-400'}`} />
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">{children}</div>;
}

function Card({ task, onApprove, onReject, readOnly }) {
  const tone = task.status === 'approved' ? 'emerald' : task.status === 'rejected' ? 'rose' : 'amber';
  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${tone === 'emerald' ? 'border-emerald-200' : tone === 'rose' ? 'border-rose-200' : 'border-amber-200'}`}>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{task.application_id}</p>
          <p className="mt-1 text-base font-semibold text-slate-900">{task.candidate_name}</p>
          <p className="text-xs text-slate-500">{task.job_title || '-'} · {task.candidate_email}</p>
        </div>
        <div className="text-right">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone === 'emerald' ? 'bg-emerald-100 text-emerald-800' : tone === 'rose' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500'}`} />
            {task.status === 'pending' ? 'Awaiting your action' : `${task.status} · ${fmtIST(task.acted_at)}`}
          </span>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        {task.breakup_html ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-56 overflow-auto" dangerouslySetInnerHTML={{ __html: task.breakup_html }} />
        ) : task.breakup_text ? (
          <pre className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap font-mono">{task.breakup_text}</pre>
        ) : <p className="text-xs text-slate-500 italic">No breakup attached.</p>}
        {task.attachment_path && (
          <a href={task.attachment_path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
            📎 {task.attachment_name || 'attachment'}
          </a>
        )}
        {task.comments && task.status !== 'pending' && (
          <div className={`rounded-md border px-3 py-2 text-xs italic ${tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            "{task.comments}"
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-end gap-2">
          <button className="v2-btn-ghost" onClick={onReject} style={{ color: '#b91c1c' }}>Reject…</button>
          <button className="v2-btn-primary" onClick={onApprove}>Approve</button>
        </div>
      )}
    </div>
  );
}
