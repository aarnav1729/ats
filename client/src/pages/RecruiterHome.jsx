// RecruiterHome - dedicated screen for hr_recruiter.
// Shows ONLY candidates this recruiter owns (recruiter_email = me), grouped
// by lifecycle stage so the recruiter can clear queues left-to-right:
//   1. Triage          (resume just landed)
//   2. Interviews      (waiting on HOD/scheduling/feedback)
//   3. Documents & CTC (post-selection clearance)
//   4. Offer in flight (offer letter / signature / acceptance)
//   5. Joining track   (offer accepted, awaiting joining)
// Each candidate card shows ONE next-action CTA.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { applicationsAPI } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import CandidateRow, { Section } from '../components/inbox/CandidateRow';

const BUCKETS = [
  {
    id: 'triage', title: 'Triage queue', accent: 'indigo',
    hint: 'New resumes - shortlist or reject.',
    statuses: ['InQueue', 'Applied'],
  },
  {
    id: 'interview', title: 'Interview coordination', accent: 'amber',
    hint: 'Waiting on HOD, scheduling, or interviewer feedback.',
    statuses: ['Shortlisted', 'AwaitingHODResponse', 'AwaitingInterviewScheduling',
               'Round1', 'Round2', 'Round3', 'AwaitingFeedback'],
  },
  {
    id: 'docs_ctc', title: 'Documents & CTC', accent: 'sky',
    hint: 'Post-selection: collect documents and run the CTC chain.',
    statuses: ['Selected', 'DocumentsInProgress', 'DocumentsCleared',
               'CTCSent', 'CTCAcceptance', 'CTCAccepted', 'SalaryRejected'],
  },
  {
    id: 'offer', title: 'Offer in flight', accent: 'rose',
    hint: 'Offer letter generation, signature, acceptance.',
    statuses: ['OfferInProcess', 'SignaturePending', 'Offered'],
  },
  {
    id: 'joining', title: 'Joining track', accent: 'emerald',
    hint: 'Offer accepted - confirm joining or postponement.',
    statuses: ['OfferAccepted', 'Postponed'],
  },
];

export default function RecruiterHome() {
  const { user } = useAuth();
  const [apps, setApps]    = useState([]);
  const [loading, setLoad] = useState(true);
  const [error, setError]  = useState(null);

  useEffect(() => {
    if (!user?.email) return;
    let alive = true;
    (async () => {
      try {
        const res = await applicationsAPI.list({
          recruiter_email: user.email,
          limit: 300,
          sort_by: 'a.updated_at',
          sort_order: 'DESC',
        });
        if (!alive) return;
        setApps(res.data?.data || []);
      } catch (e) {
        if (alive) setError(e?.response?.data?.error || e.message);
      } finally {
        if (alive) setLoad(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.email]);

  const buckets = useMemo(() => {
    const out = Object.fromEntries(BUCKETS.map(b => [b.id, []]));
    for (const a of apps) {
      const b = BUCKETS.find(x => x.statuses.includes(a.status));
      if (b) out[b.id].push(a);
    }
    return out;
  }, [apps]);

  const total       = apps.length;
  const triageCount = buckets.triage.length;
  const interviewCount = buckets.interview.length;
  const offerCount  = buckets.offer.length + buckets.joining.length;

  if (loading) return <div className="text-sm text-slate-500 p-6">Loading your candidates…</div>;
  if (error)   return <div className="text-sm text-rose-600 p-6">{error}</div>;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
      <PageHeader
        title="Recruiter Dashboard"
        subtitle="Your owned candidates only. Each card surfaces the single next action - no menus, no clutter."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        <Stat label="Total candidates" value={total} tone="slate" />
        <Stat label="In triage" value={triageCount} tone="indigo" />
        <Stat label="Mid-interview" value={interviewCount} tone="amber" />
        <Stat label="Offer / joining" value={offerCount} tone="emerald" />
      </div>

      {BUCKETS.map(b => (
        <Section
          key={b.id}
          title={b.title}
          count={buckets[b.id].length}
          accent={b.accent}
          hint={b.hint}
        >
          {buckets[b.id].map(a => <CandidateRow key={a.id} app={a} role="hr_recruiter" />)}
        </Section>
      ))}

      {total === 0 && (
        <div className="text-center py-12 text-slate-500 bg-white rounded-lg border border-slate-200">
          You don't own any candidates yet.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate:   'bg-slate-50  text-slate-700',
    indigo:  'bg-indigo-50 text-indigo-700',
    amber:   'bg-amber-50  text-amber-700',
    sky:     'bg-sky-50    text-sky-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  }[tone] || 'bg-slate-50 text-slate-700';
  return (
    <div className={`rounded-lg p-4 ${tones} border border-slate-200`}>
      <p className="text-[11px] uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  );
}
