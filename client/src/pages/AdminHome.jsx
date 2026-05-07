// AdminHome - dedicated screen for hr_admin.
// Admin sees the WHOLE pipeline + has special CTC approval inbox at top.
// Sections (in priority order):
//   1. Awaiting your approval     (CTC chain stuck on admin_decision = pending)
//   2. Stalled                    (>5 days in same status, non-terminal)
//   3. Active pipeline            (everything else, organized by stage)
// KPI tiles up top show the operational picture.

import { useEffect, useMemo, useState } from 'react';
import { applicationsAPI } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import CandidateRow, { Section } from '../components/inbox/CandidateRow';

const TERMINAL = new Set(['Joined', 'HRRejected', 'HODRejected', 'Round1Rejected',
                           'Round2Rejected', 'Round3Rejected', 'OfferRejected',
                           'OfferDropout', 'Withdrawn', 'Blacklisted']);

const STAGE_GROUPS = [
  { id: 'sourcing',  title: 'Sourcing',           statuses: ['InQueue', 'Applied', 'Shortlisted'], accent: 'indigo' },
  { id: 'interview', title: 'Interview track',     statuses: ['AwaitingHODResponse', 'AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3', 'AwaitingFeedback'], accent: 'amber' },
  { id: 'clearance', title: 'Clearance & CTC',     statuses: ['Selected', 'DocumentsInProgress', 'DocumentsCleared', 'CTCSent', 'CTCAcceptance', 'CTCAccepted', 'SalaryRejected'], accent: 'sky' },
  { id: 'offer',     title: 'Offer & joining',     statuses: ['OfferInProcess', 'SignaturePending', 'Offered', 'OfferAccepted', 'Postponed'], accent: 'emerald' },
  { id: 'parked',    title: 'Talent pool',         statuses: ['TalentPool'], accent: 'slate' },
];

const STALL_DAYS = 5;

function isStalled(app) {
  if (TERMINAL.has(app.status)) return false;
  const ts = app.updated_at || app.created_at;
  if (!ts) return false;
  const ageDays = (Date.now() - new Date(ts).getTime()) / 86400000;
  return ageDays > STALL_DAYS;
}

export default function AdminHome() {
  const [apps, setApps]            = useState([]);
  const [approvalApps, setApprovalApps] = useState([]); // CTC pending admin decision
  const [duplicateUploads, setDuplicateUploads] = useState([]);
  const [loading, setLoad]         = useState(true);
  const [error, setError]          = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, approvals, duplicateAudit] = await Promise.all([
          applicationsAPI.list({ limit: 500, sort_by: 'a.updated_at', sort_order: 'DESC' }),
          // CTCAccepted is the gate where admin decision is required.
          // Server-side we just filter status; admin_decision flag is in row.
          applicationsAPI.list({ status: 'CTCAccepted', limit: 200 }),
          applicationsAPI.duplicateAudit({ limit: 25 }).catch(() => ({ data: { data: [] } })),
        ]);
        if (!alive) return;
        setApps(list.data?.data || []);
        setApprovalApps((approvals.data?.data || []).filter(a => !a.admin_decision || a.admin_decision === 'pending'));
        setDuplicateUploads(duplicateAudit.data?.data || []);
      } catch (e) {
        if (alive) setError(e?.response?.data?.error || e.message);
      } finally {
        if (alive) setLoad(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    const out = Object.fromEntries(STAGE_GROUPS.map(g => [g.id, []]));
    const stalled = [];
    for (const a of apps) {
      if (isStalled(a)) stalled.push(a);
      const g = STAGE_GROUPS.find(x => x.statuses.includes(a.status));
      if (g) out[g.id].push(a);
    }
    return { ...out, stalled };
  }, [apps]);

  if (loading) return <div className="text-sm text-slate-500 p-6">Loading admin pipeline…</div>;
  if (error)   return <div className="text-sm text-rose-600 p-6">{error}</div>;

  const totalActive = apps.filter(a => !TERMINAL.has(a.status) && a.status !== 'TalentPool').length;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
      <PageHeader
        title="Admin Dashboard"
        subtitle="Full-pipeline visibility. Items needing your approval surface at the top."
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 my-5">
        <Stat label="Active candidates" value={totalActive} tone="indigo" />
        <Stat label="Awaiting your approval" value={approvalApps.length} tone="rose" />
        <Stat label="Stalled >5d" value={groups.stalled.length} tone="amber" />
        <Stat label="In offer / joining" value={(groups.offer || []).length} tone="emerald" />
        <Stat label="Duplicate uploads" value={duplicateUploads.length} tone="amber" />
      </div>

      <Section
        title="Awaiting your approval"
        count={approvalApps.length}
        accent="rose"
        hint="CTC chain has reached HR Admin - approve, reject, renegotiate, or forward."
      >
        {approvalApps.map(a => <CandidateRow key={a.id} app={{ ...a, admin_decision: 'pending' }} role="hr_admin" />)}
      </Section>

      <Section
        title="Duplicate uploads"
        count={duplicateUploads.length}
        accent="amber"
        hint="Shows who uploaded the original record and who continued with the duplicate."
      >
        {duplicateUploads.map((item) => (
          <div key={item.id} className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">{item.duplicate_candidate_name || item.original_candidate_name || 'Candidate'}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Original: {item.original_application_code || item.original_application_id || '-'} by {item.original_uploaded_by || item.original_created_by || '-'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Duplicate: {item.duplicate_application_code || item.duplicate_application_id || '-'} by {item.duplicate_uploaded_by || item.duplicate_created_by || '-'}
                </p>
              </div>
              <div className="text-xs text-slate-500 sm:text-right">
                <p>{item.match_type || 'duplicate'}</p>
                <p>{item.match_value || '-'}</p>
              </div>
            </div>
          </div>
        ))}
      </Section>

      <Section
        title={`Stalled (>${STALL_DAYS} days)`}
        count={groups.stalled.length}
        accent="amber"
        hint="Candidates that haven't moved for several days. Nudge the owner or unblock manually."
      >
        {groups.stalled.map(a => <CandidateRow key={a.id} app={a} role="hr_admin" />)}
      </Section>

      {STAGE_GROUPS.map(g => (
        <Section
          key={g.id}
          title={g.title}
          count={(groups[g.id] || []).length}
          accent={g.accent}
        >
          {(groups[g.id] || []).slice(0, 50).map(a => <CandidateRow key={a.id} app={a} role="hr_admin" dense />)}
        </Section>
      ))}
    </div>
  );
}

function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate:   'bg-slate-50   text-slate-700',
    indigo:  'bg-indigo-50  text-indigo-700',
    amber:   'bg-amber-50   text-amber-700',
    rose:    'bg-rose-50    text-rose-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  }[tone] || 'bg-slate-50 text-slate-700';
  return (
    <div className={`rounded-lg p-4 ${tones} border border-slate-200`}>
      <p className="text-[11px] uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  );
}
