// HR Admin "all-view" decision modal for the CTC flow.
//
// Shows everything in one place:
//   - Active breakup (HTML preview + attachment + candidate signature/decision)
//   - Latest comparison (HTML preview + attachment + R2 decision)
//   - Approver list (if forwarded already)
//   - Decision panel: approve / reject (autoselects "CTC too high") /
//     renegotiate / forward to approvers (multi-email picker)
//
// All four decisions hit /api/ctc-breakup/:id/admin-decide so the server
// keeps a single source of truth.

import { useEffect, useMemo, useState } from 'react';
import { ctcBreakupAPI, mastersAPI } from '../services/api';
import { fmtIST } from './ui/v2';
import toast from 'react-hot-toast';

export default function CtcAdminReviewModal({ application, onClose, onChanged }) {
  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState('approved');
  const [notes, setNotes] = useState('');
  const [reasons, setReasons] = useState([]);
  const [pickedReason, setPickedReason] = useState('CTC too high');
  const [approverEmails, setApproverEmails] = useState('');
  const [skipDocRecheck, setSkipDocRecheck] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await ctcBreakupAPI.all(application.application_id || application.id);
      setPkg(r.data);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to load CTC'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Pull seeded "CTC too high" + sibling reasons so we can show a tidy dropdown.
  useEffect(() => {
    mastersAPI.list('rejection-reasons').then((r) => {
      const items = Array.isArray(r.data) ? r.data : (r.data?.items || []);
      setReasons(items.filter((i) => i.active_flag !== false).map((i) => i.reason || i.reason_preview).filter(Boolean));
    }).catch(() => setReasons(['CTC too high', 'Budget mismatch', 'Internal equity concern']));
  }, []);

  // Sync notes with picked reason when decision is "rejected" so the audit
  // log gets the canonical phrasing.
  useEffect(() => {
    if (decision === 'rejected') setNotes(pickedReason);
  }, [decision, pickedReason]);

  const submit = async () => {
    if (decision === 'rejected' && !notes.trim()) return toast.error('Pick a reason');
    if (decision === 'forward') {
      const list = approverEmails.split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (!list.length) return toast.error('Add at least one approver email');
      setBusy(true);
      try {
        await ctcBreakupAPI.adminDecide(application.application_id || application.id, {
          decision: 'forward', approver_emails: list, notes,
        });
        toast.success(`Forwarded to ${list.length} approver${list.length === 1 ? '' : 's'}`);
        onChanged?.(); onClose?.();
      } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      await ctcBreakupAPI.adminDecide(application.application_id || application.id, {
        decision, notes,
        skip_doc_recheck: decision === 'renegotiate' ? skipDocRecheck : false,
      });
      toast.success(`Recorded: ${decision}`);
      onChanged?.(); onClose?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };

  const breakup = pkg?.active_breakup;
  const comparison = pkg?.comparisons?.[0];
  const approvers = pkg?.approvers || [];
  const candidateAccepted = breakup?.candidate_decision === 'accepted';
  const r2Cleared = breakup?.r2_decision === 'approved';

  return (
    <div className="app-modal-backdrop" onClick={onClose}>
      <div className="app-modal-panel app-modal-panel-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920 }}>
        <div className="app-modal-header">
          <h3 className="text-lg font-semibold text-slate-900">CTC review · {application.candidate_name}</h3>
        </div>
        <div className="app-modal-body" style={{ maxHeight: 'calc(90vh - 160px)', overflowY: 'auto' }}>
          {loading ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" /></div>
          ) : (
            <div className="space-y-5">
              {/* Stage chips */}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <Chip ok={!!breakup} label="Breakup sent" />
                <Chip ok={candidateAccepted} label="Candidate accepted" />
                <Chip ok={!!comparison} label="Comparison added" />
                <Chip ok={r2Cleared} label="Recruiter 2 cleared" />
                <Chip ok={!!breakup?.admin_decision} label="HR Admin acted" />
                {approvers.length > 0 && (
                  <Chip ok={approvers.every((a) => a.status === 'approved')} label={`${approvers.filter((a) => a.status === 'approved').length}/${approvers.length} approvers`} />
                )}
              </div>

              {/* Breakup */}
              <Section title="CTC breakup table" subtitle={breakup ? `Version ${breakup.version} · created ${fmtIST(breakup.created_at)} by ${breakup.created_by_email}` : 'Not yet drafted'}>
                {breakup ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-72 overflow-auto" dangerouslySetInnerHTML={{ __html: breakup.breakup_html || `<pre>${breakup.breakup_text || ''}</pre>` }} />
                    {breakup.attachment_path && (
                      <a href={breakup.attachment_path} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">📎 {breakup.attachment_name || 'attachment'}</a>
                    )}
                    {breakup.candidate_decision && (
                      <div className={`text-xs rounded-md border px-3 py-2 ${candidateAccepted ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                        Candidate: <strong>{breakup.candidate_decision}</strong> · {fmtIST(breakup.decision_at)}
                        {breakup.candidate_decision_notes && <p className="italic mt-1">"{breakup.candidate_decision_notes}"</p>}
                      </div>
                    )}
                  </div>
                ) : <p className="text-sm text-slate-500">Recruiter has not sent a breakup yet.</p>}
              </Section>

              {/* Comparison */}
              <Section title="CTC comparison table" subtitle={comparison ? `Created ${fmtIST(comparison.created_at)} by ${comparison.created_by_email}` : 'Not yet added'}>
                {comparison ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-72 overflow-auto" dangerouslySetInnerHTML={{ __html: comparison.comparison_html || `<pre>${comparison.comparison_text || ''}</pre>` }} />
                    {comparison.attachment_path && (
                      <a href={comparison.attachment_path} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">📎 {comparison.attachment_name || 'attachment'}</a>
                    )}
                  </div>
                ) : <p className="text-sm text-slate-500">Recruiter has not added a comparison yet.</p>}
              </Section>

              {/* R2 status */}
              {breakup?.r2_decision && (
                <Section title="Recruiter 2 review" subtitle={fmtIST(breakup.r2_acted_at)}>
                  <p className="text-sm">
                    <span className="font-semibold">{breakup.r2_email}</span>
                    {' '}
                    <span className={breakup.r2_decision === 'approved' ? 'text-emerald-700' : 'text-rose-700'}>
                      {breakup.r2_decision === 'approved' ? 'approved & forwarded' : 'sent back'}
                    </span>
                  </p>
                  {breakup.r2_notes && <p className="mt-1 italic text-slate-600 text-sm">"{breakup.r2_notes}"</p>}
                </Section>
              )}

              {/* Approvers (if previously forwarded) */}
              {approvers.length > 0 && (
                <Section title="Approver chain" subtitle={`${approvers.length} approver${approvers.length === 1 ? '' : 's'}, all must approve`}>
                  <div className="space-y-2">
                    {approvers.map((a) => (
                      <div key={a.id} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${a.status === 'approved' ? 'border-emerald-200 bg-emerald-50' : a.status === 'rejected' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                        <span className="font-medium">{a.assignee_email}</span>
                        <span className="text-xs">
                          <strong className="capitalize">{a.status}</strong>
                          {a.acted_at && ` · ${fmtIST(a.acted_at)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Decision panel */}
              <Section title="Your decision" subtitle="Pick one. All choices are audited.">
                <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
                  {[
                    ['approved', 'Approve & release offer', 'emerald'],
                    ['rejected', 'Reject - CTC too high', 'rose'],
                    ['renegotiate', 'Send back for renegotiation', 'amber'],
                    ['forward', 'Forward to approvers', 'indigo'],
                  ].map(([d, label, tone]) => (
                    <button
                      key={d}
                      onClick={() => setDecision(d)}
                      className={`rounded-xl border px-3 py-3 text-xs font-semibold transition text-left ${decision === d ? `border-${tone}-400 bg-${tone}-50 text-${tone}-800 shadow-sm` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                    >{label}</button>
                  ))}
                </div>

                {/* Decision-specific extras */}
                {decision === 'rejected' && (
                  <div className="mt-3 space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Reason (auto-selected: CTC too high)</label>
                    <select className="input-field w-full" value={pickedReason} onChange={(e) => setPickedReason(e.target.value)}>
                      {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                      Candidate will be parked in the talent pool. Their full historical timeline stays visible there.
                    </p>
                  </div>
                )}
                {decision === 'renegotiate' && (
                  <div className="mt-3 space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Comments to recruiter 1</label>
                    <textarea className="input-field w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What needs to change?" />
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={skipDocRecheck} onChange={(e) => setSkipDocRecheck(e.target.checked)} />
                      Skip document re-clearance (no new docs requested)
                    </label>
                  </div>
                )}
                {decision === 'forward' && (
                  <div className="mt-3 space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Approver emails (one per line or comma-separated)</label>
                    <textarea className="input-field w-full" rows={3} value={approverEmails} onChange={(e) => setApproverEmails(e.target.value)} placeholder="cxo@premier… , vp.finance@premier…" />
                    <p className="text-xs text-slate-500">All approvers must approve before the candidate moves to OfferInProcess. A single rejection sends them to talent pool.</p>
                    <textarea className="input-field w-full mt-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional context for approvers" />
                  </div>
                )}
                {decision === 'approved' && (
                  <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                    Status moves to <strong>OfferInProcess</strong>. Recruiter can then upload the offer letter PDF and set tentative joining date.
                  </p>
                )}
              </Section>
            </div>
          )}
        </div>
        <div className="app-modal-footer flex justify-end gap-2">
          <button className="v2-btn-ghost" onClick={onClose}>Close</button>
          {!loading && (
            <button className="v2-btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : `Confirm ${decision}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-500 font-mono">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Chip({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {label}
    </span>
  );
}
