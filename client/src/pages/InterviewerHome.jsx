// InterviewerHome - dedicated interviewer dashboard.
// Three explicit stacks tailored to the interviewer mental model:
//   1. Slots to suggest          (status: AwaitingInterviewScheduling)
//   2. Feedback you owe          (status: Round1/2/3 or AwaitingFeedback)
//   3. Recent outcomes (read-only post-feedback context)
// Only the assigned interviewer's interviews are returned by the backend
// (server filters by req.user.email when role==='interviewer').

import { useEffect, useMemo, useState } from 'react';
import { interviewsAPI } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import CandidateRow, { Section } from '../components/inbox/CandidateRow';

const ROUND_STATUSES = new Set(['Round1', 'Round2', 'Round3', 'AwaitingFeedback']);

export default function InterviewerHome() {
  const [rows, setRows]    = useState([]);
  const [loading, setLoad] = useState(true);
  const [error, setError]  = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await interviewsAPI.list({ limit: 200 });
        if (!alive) return;
        // De-duplicate by application - keep the most-recent row.
        const map = new Map();
        for (const r of (res.data?.interviews || [])) {
          if (!r.application_record_id) continue;
          const prev = map.get(r.application_record_id);
          const ts   = r.scheduled_at || r.updated_at || r.created_at || 0;
          if (!prev || new Date(ts) > new Date(prev.scheduled_at || prev.updated_at || 0)) {
            map.set(r.application_record_id, r);
          }
        }
        setRows([...map.values()].map(r => ({
          id:              r.application_record_id,
          candidate_name:  r.candidate_name,
          candidate_email: r.candidate_email,
          job_title:       r.job_title,
          ats_job_id:      r.ats_job_id,
          status:          r.app_status,
          updated_at:      r.scheduled_at || r.updated_at,
          scheduled_at:    r.scheduled_at,
          round_number:    r.round_number,
        })));
      } catch (e) {
        if (alive) setError(e?.response?.data?.error || e.message);
      } finally {
        if (alive) setLoad(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const buckets = useMemo(() => {
    const slots = [], feedback = [], done = [];
    for (const a of rows) {
      if (a.status === 'AwaitingInterviewScheduling')      slots.push(a);
      else if (ROUND_STATUSES.has(a.status))               feedback.push(a);
      else                                                  done.push(a); // Selected, OfferInProcess, Joined, etc.
    }
    return { slots, feedback, done };
  }, [rows]);

  if (loading) return <div className="text-sm text-slate-500 p-6">Loading your interviews…</div>;
  if (error)   return <div className="text-sm text-rose-600 p-6">{error}</div>;

  const total       = rows.length;
  const todoCount   = buckets.slots.length + buckets.feedback.length;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <PageHeader
        title="Interviewer Dashboard"
        subtitle="Only candidates assigned to you. Sections are ordered by urgency - propose slots, then submit feedback."
      />

      <div className="grid grid-cols-3 gap-3 my-5">
        <Stat label="Action required" value={todoCount} tone="indigo" />
        <Stat label="Slots to suggest" value={buckets.slots.length} tone="amber" />
        <Stat label="Feedback owed" value={buckets.feedback.length} tone="rose" />
      </div>

      <Section
        title="Slots to suggest"
        count={buckets.slots.length}
        accent="amber"
        hint="Propose 2–3 datetimes; HR will confirm one."
      >
        {buckets.slots.map(a => <CandidateRow key={a.id} app={a} role="interviewer" />)}
      </Section>

      <Section
        title="Feedback you owe"
        count={buckets.feedback.length}
        accent="rose"
        hint="Submit your interview verdict. Required to advance the candidate."
      >
        {buckets.feedback.map(a => (
          <CandidateRow
            key={a.id}
            app={a}
            role="interviewer"
            extra={a.round_number ? <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">Round {a.round_number}</span> : null}
          />
        ))}
      </Section>

      <Section
        title="Recent outcomes"
        count={buckets.done.length}
        accent="emerald"
        hint="Candidates that have moved past the interview stage."
      >
        {buckets.done.slice(0, 20).map(a => <CandidateRow key={a.id} app={a} role="interviewer" dense />)}
      </Section>

      {total === 0 && (
        <div className="text-center py-12 text-slate-500 bg-white rounded-lg border border-slate-200">
          You have no interview assignments yet.
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
    rose:    'bg-rose-50   text-rose-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  }[tone] || 'bg-slate-50 text-slate-700';
  return (
    <div className={`rounded-lg p-4 ${tones} border border-slate-200`}>
      <p className="text-[11px] uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
    </div>
  );
}
