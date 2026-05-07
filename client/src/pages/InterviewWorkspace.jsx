import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { interviewsAPI, mastersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import InfoTip from '../components/InfoTip';
import EmailAutocompleteTags from '../components/EmailAutocompleteTags';
import haptic from '../utils/haptic';
import { canMarkNoShow, formatDateTime, toDatetimeLocalValue } from '../utils/dateTime';

const SCORE_OPTIONS = [1, 2, 3, 4, 5];

// ── RBAC view selector ───────────────────────────────────────────────────
// HR Admin sees a dropdown of Admin / Recruiter / Interviewer perspectives so
// they can demo the lifecycle from any seat. Non-admins are locked to the
// view that matches their actual role.
const RBAC_LABELS = {
  admin:       { label: 'Admin · all actions',     description: 'Full visibility + every action' },
  recruiter:   { label: 'Recruiter · sourcing',    description: 'Schedule, confirm, reject pre-screen' },
  interviewer: { label: 'Interviewer · panel',     description: 'Suggest slots, give feedback' },
};

function RbacViewSwitcher({ current, onChange, allowed }) {
  if (allowed.length <= 1) {
    const only = allowed[0];
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {RBAC_LABELS[only].label}
      </span>
    );
  }
  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-1 py-1 shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">View as</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border-0 pr-2 py-1 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-0 cursor-pointer"
      >
        {allowed.map((v) => (
          <option key={v} value={v}>{RBAC_LABELS[v].label}</option>
        ))}
      </select>
    </label>
  );
}

// Compact stat cell used in the redesigned hero strip.
function FactTile({ label, value, sub, tone }) {
  const toneRing = {
    success: 'before:bg-emerald-500',
    warn: 'before:bg-amber-500',
    danger: 'before:bg-rose-500',
    info: 'before:bg-indigo-500',
  }[tone] || 'before:bg-slate-300';
  return (
    <div className={`relative px-5 py-4 transition hover:bg-slate-50 before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r-full ${toneRing}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900 break-words leading-tight">{value || '-'}</p>
      {sub && <p className="mt-0.5 text-[12px] text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

const STATE_LABEL = {
  slots:    { label: 'Slots needed',    stage: 'shortlisted', tone: 'warn' },
  feedback: { label: 'Feedback ready',  stage: 'interview',   tone: 'success' },
  waiting:  { label: 'Awaiting schedule', stage: 'queue',     tone: 'info' },
};

function isPreviewableFile(filePath = '') {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(filePath);
}

function renderInlinePreview(filePath, title) {
  if (!filePath || !isPreviewableFile(filePath)) return null;
  if (/\.(png|jpe?g|gif|webp)$/i.test(filePath)) {
    return <img src={filePath} alt={title} className="max-h-[28rem] w-full rounded-2xl border border-gray-200 object-contain bg-white" />;
  }
  return <iframe src={filePath} title={title} className="h-[28rem] w-full rounded-2xl border border-gray-200 bg-white" />;
}

export default function InterviewWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const [interview, setInterview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState([]);
  const [slotForm, setSlotForm] = useState({
    slot1: '',
    slot2: '',
  });
  const [feedbackForm, setFeedbackForm] = useState({
    decision: 'shortlist',
    technical_score: '4',
    behavioral_score: '4',
    company_fit_score: '4',
    remarks: '',
    rejection_reasons: [],
  });
  const [roundRequest, setRoundRequest] = useState({
    additional_rounds: '1',
    remarks: '',
    suggested_panels: [[], []],
  });
  const [noShowReason, setNoShowReason] = useState('');
  const [preScreenRejectReason, setPreScreenRejectReason] = useState('');
  const [preScreenRejectRemarks, setPreScreenRejectRemarks] = useState('');

  // RBAC view state - admin can switch perspective; others are locked.
  const initialView = hasRole('hr_admin') ? 'admin' : hasRole('hr_recruiter') ? 'recruiter' : 'interviewer';
  const [viewAs, setViewAs] = useState(initialView);

  const canCoordinate = (viewAs === 'admin' || viewAs === 'recruiter');
  const canReview = (viewAs === 'admin' || viewAs === 'interviewer');
  const needsSlotSuggestion = useMemo(
    () => {
      // Only show slot suggestion when truly needs to suggest (not waiting for HR to confirm)
      // If slots are already suggested (AwaitingInterviewScheduling), don't show - wait for HR
      const status = interview?.app_status;
      return status === 'AwaitingHODResponse' || interview?.status === 'review_pending';
    },
    [interview?.app_status, interview?.status]
  );
  const canGiveFeedback = useMemo(
    () => {
      // Can give feedback when: scheduled OR in a round OR AwaitingFeedback
      // But NOT when just waiting for HR to confirm slots
      const status = interview?.app_status;
      const hasScheduled = !!interview?.scheduled_datetime;
      const isInRound = /^Round\d+$/.test(String(status || ''));
      const isAwaitingFeedback = status === 'AwaitingFeedback';
      return (hasScheduled || isInRound || isAwaitingFeedback) && status !== 'AwaitingInterviewScheduling';
    },
    [interview?.app_status, interview?.scheduled_datetime]
  );
  const noShowEnabled = useMemo(() => canMarkNoShow(interview?.scheduled_datetime), [interview?.scheduled_datetime]);
  const stateLabel = needsSlotSuggestion ? 'slots' : canGiveFeedback ? 'feedback' : 'waiting';
  const currentRoundNumber = useMemo(
    () => Number(interview?.round || interview?.round_number || 1),
    [interview?.round, interview?.round_number]
  );
  const maxAdditionalRounds = Math.max(0, 3 - currentRoundNumber);
  const requestedAdditionalRounds = Math.min(
    Number(roundRequest.additional_rounds || 1),
    Math.max(1, maxAdditionalRounds || 1)
  );
  const suggestedAdditionalRoundPanels = useMemo(
    () => Array.from({ length: requestedAdditionalRounds }, (_, index) => ({
      roundNumber: currentRoundNumber + index + 1,
      interviewers: roundRequest.suggested_panels[index] || [],
    })),
    [currentRoundNumber, requestedAdditionalRounds, roundRequest.suggested_panels]
  );

  const loadInterview = async () => {
    const res = await interviewsAPI.get(id);
    setInterview(res.data);
    setSlotForm({
      slot1: toDatetimeLocalValue(res.data?.suggested_interview_datetime1),
      slot2: toDatetimeLocalValue(res.data?.suggested_interview_datetime2),
    });
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [interviewRes, reasonsRes] = await Promise.all([
          interviewsAPI.get(id),
          mastersAPI.list('rejection-reasons', { limit: 200 }).catch(() => []),
        ]);
        setInterview(interviewRes.data);
        setSlotForm({
          slot1: toDatetimeLocalValue(interviewRes.data?.suggested_interview_datetime1),
          slot2: toDatetimeLocalValue(interviewRes.data?.suggested_interview_datetime2),
        });
        const items = Array.isArray(reasonsRes) ? reasonsRes : reasonsRes?.data || reasonsRes?.items || [];
        setRejectionReasons(items.filter((item) => item.active_flag !== false));
      } catch {
        toast.error('Failed to load reviewer workspace');
        navigate('/interviews');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, navigate]);

  const suggestSlots = async () => {
    if (!slotForm.slot1 || !slotForm.slot2) {
      haptic.warning();
      toast.error('Suggest both time slots');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.suggestSlots(interview.id, {
        suggested_datetime1: slotForm.slot1,
        suggested_datetime2: slotForm.slot2,
      });
      haptic.success();
      toast.success('Slots shared with recruiter');
      await loadInterview();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to suggest slots');
    } finally {
      setSubmitting(false);
    }
  };


  const rejectBeforeScheduling = async () => {
    if (!preScreenRejectReason) {
      haptic.warning();
      toast.error('Select a rejection reason');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.feedback(interview.id, {
        decision: 'reject',
        technical_score: Number(feedbackForm.technical_score),
        behavioral_score: Number(feedbackForm.behavioral_score),
        company_fit_score: Number(feedbackForm.company_fit_score),
        remarks: preScreenRejectRemarks || 'Rejected during pre-screen review before slot suggestion.',
        rejection_reasons: [preScreenRejectReason],
      });
      haptic.success();
      toast.success('Candidate marked as HOD Rejected');
      setPreScreenRejectReason('');
      setPreScreenRejectRemarks('');
      await loadInterview();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to reject candidate');
    } finally {
      setSubmitting(false);
    }
  };

  const submitFeedback = async () => {
    if (feedbackForm.decision === 'reject' && feedbackForm.rejection_reasons.length === 0) {
      haptic.warning();
      toast.error('Select at least one rejection reason');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.feedback(interview.id, {
        decision: feedbackForm.decision,
        technical_score: Number(feedbackForm.technical_score),
        behavioral_score: Number(feedbackForm.behavioral_score),
        company_fit_score: Number(feedbackForm.company_fit_score),
        remarks: feedbackForm.remarks,
        rejection_reasons: feedbackForm.decision === 'reject' ? feedbackForm.rejection_reasons : [],
      });
      haptic.success();
      toast.success('Feedback submitted');
      await loadInterview();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const markNoShow = async () => {
    const reason = noShowReason.trim();
    if (!reason) {
      haptic.warning();
      toast.error('Add a no-show reason before submitting');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.markNoShow(interview.id, {
        party: 'candidate',
        reason,
      });
      setNoShowReason('');
      haptic.success();
      toast.success('No-show recorded');
      await loadInterview();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to record no-show');
    } finally {
      setSubmitting(false);
    }
  };

  const requestAnotherRound = async () => {
    if (maxAdditionalRounds <= 0) {
      haptic.warning();
      toast.error('The candidate is already configured for the maximum number of rounds');
      return;
    }
    if (!roundRequest.remarks.trim()) {
      haptic.warning();
      toast.error('Explain why another round is required');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.requestAdditionalRounds(interview.id, {
        additional_rounds: requestedAdditionalRounds,
        remarks: roundRequest.remarks.trim(),
        suggested_interviewers: suggestedAdditionalRoundPanels.map((panel) => ({
          round_number: panel.roundNumber,
          interviewers: panel.interviewers.map((item) => item.email).filter(Boolean),
        })),
      });
      haptic.success();
      toast.success('Additional round request sent to recruiter');
      await loadInterview();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to request another round');
    } finally {
      setSubmitting(false);
    }
  };

  const sendReminder = async (recipientType) => {
    try {
      setSubmitting(true);
      await interviewsAPI.remind(interview.id, {
        recipient_type: recipientType,
        note: `Reminder from reviewer workspace for ${interview.candidate_name}.`,
      });
      haptic.notify();
      toast.success('Reminder sent');
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to send reminder');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!interview) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500">Interview workspace not found.</div>;
  }

  return (
    <div className="workspace-shell">
      {/* Top bar: back + RBAC view selector + cross-links */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => { haptic.light(); navigate(-1); }} className="v2-btn-ghost">← Back</button>
        <div className="flex flex-wrap items-center gap-2">
          {/* RBAC view selector - admin can switch between Recruiter / Interviewer / Admin perspectives.
              For non-admin users the selector locks to their role so they never see anything they shouldn't. */}
          <RbacViewSwitcher
            current={viewAs}
            onChange={setViewAs}
            allowed={hasRole('hr_admin') ? ['admin', 'recruiter', 'interviewer'] : hasRole('hr_recruiter') ? ['recruiter'] : ['interviewer']}
          />
          {(viewAs === 'admin' || viewAs === 'recruiter') && (
            <button onClick={() => { haptic.light(); navigate(`/applications/${interview.application_record_id}/workflow?tab=schedule`); }} className="v2-btn-ghost">
              Scheduling
            </button>
          )}
          <button onClick={() => { haptic.light(); navigate(`/applications/${interview.application_record_id}/workflow`); }} className="v2-btn-primary">
            Workflow →
          </button>
        </div>
      </div>

      {/* COMPACT HERO ─────────────────────────────────────────────────────
         Single horizontal strip. Left: identity + breadcrumb chips. Right:
         four small fact tiles in one row on desktop, two columns on mobile.
         Replaces the 50/50 hero that wasted vertical space and put the same
         label twice. */}
      <header className="rounded-2xl border border-slate-200 bg-white shadow-sm v2-fade-up">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="v2-pill" data-stage="interview">Round {interview.round || interview.round_number || 1}</span>
              <span className="v2-pill">{(interview.status || 'review pending').replace(/_/g, ' ')}</span>
              <span className="v2-pill" data-stage={STATE_LABEL[stateLabel].stage}>{STATE_LABEL[stateLabel].label}</span>
            </div>
            <h1 className="mt-2 text-[22px] font-bold tracking-tight text-slate-900 leading-tight">
              {interview.candidate_name}
              <span className="ml-2 text-sm font-normal text-slate-500">· {interview.job_title || 'Reviewer Workspace'}</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500 leading-snug max-w-3xl">
              Review the dossier, suggest slots, and close the round - all from one dense board. Switch view above to demo other roles.
            </p>
          </div>
        </div>

        {/* Compact fact strip - equal columns, never wraps to multiple rows on desktop */}
        <dl className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-100">
          <FactTile label="Candidate"
            value={interview.candidate_email}
            sub={interview.candidate_phone || '-'} />
          <FactTile label="Round"
            value={`Round ${interview.round || interview.round_number || 1} of ${interview.no_of_rounds || '?'}`}
            sub={interview.app_status || '-'} />
          <FactTile label="Assigned to"
            value={interview.interviewer_email}
            sub={formatDateTime(interview.scheduled_datetime) || 'Not yet scheduled'} />
          <FactTile label="Action state"
            value={STATE_LABEL[stateLabel].label}
            sub={noShowEnabled ? 'No-show capture available' : 'No-show locked until interview time'}
            tone={STATE_LABEL[stateLabel].tone} />
        </dl>
      </header>

      <div className="workboard-layout">
        <aside className="workboard-lane workboard-lane-primary">
          {/* Enhanced Candidate Details Header */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-2xl p-5 mb-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">{interview.candidate_name || 'Candidate'}</h2>
                <p className="text-slate-300 text-sm mt-1">{interview.job_title}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {interview.app_status || 'Pending'}
                </span>
              </div>
            </div>
          </div>

          <div className="workspace-card panel-hover">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="section-title">Profile Details</h2>
                <p className="mt-1 text-sm text-gray-500">Key information at a glance</p>
              </div>
              {interview.resume_path && (
                <a href={interview.resume_path} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
                  View Resume
                </a>
              )}
            </div>
            
            {/* Organized info grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Application</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{interview.application_code || '-'}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Source</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{interview.source || '-'}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Experience</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {interview.candidate_years_of_experience != null ? `${interview.candidate_years_of_experience} yrs` : '-'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Location</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{interview.current_location || '-'}</p>
              </div>
            </div>

            {/* Contact info */}
            <div className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-3">Contact Information</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                  <span className="text-sm text-slate-700">{interview.candidate_email || '-'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                  </svg>
                  <span className="text-sm text-slate-700">{interview.candidate_phone || '-'}</span>
                </div>
              </div>
            </div>

            {/* Current Organization */}
            {interview.current_organization && (
              <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Current Organization</p>
                <p className="text-sm font-medium text-slate-800">{interview.current_organization}</p>
              </div>
            )}

            {/* Resume Section */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <h3 className="text-sm font-semibold text-slate-800">Resume</h3>
              </div>
              {interview.resume_path ? (
                <div className="preview-surface">
                  {renderInlinePreview(interview.resume_path, interview.resume_file_name || interview.candidate_name || 'Resume') || (
                    <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                      Inline preview works for PDFs and image resumes. Open the file directly for other types.
                    </div>
                  )}
                </div>
              ) : (
                <div className="preview-surface">
                  <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                    No resume uploaded yet.
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="workboard-lane">
          {/* SEQUENTIAL RENDERING: Show only relevant section based on candidate state */}

          {/* Waiting for HR to confirm slots */}
          {interview?.app_status === 'AwaitingInterviewScheduling' && (
            <div className="workspace-card panel-hover border-l-4 border-amber-500 bg-amber-50/50">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="section-title text-amber-900">Slots Submitted - Waiting for HR</h2>
                  <p className="text-sm text-amber-700">HR will confirm the final interview schedule</p>
                </div>
              </div>
              <div className="bg-white rounded-xl p-4 border border-amber-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-2">Suggested Slots</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {interview.suggested_interview_datetime1 && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      {new Date(interview.suggested_interview_datetime1).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  )}
                  {interview.suggested_interview_datetime2 && (
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      {new Date(interview.suggested_interview_datetime2).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                You can suggest new slots by contacting the recruiter, or the candidate will be moved to the next step once HR confirms the schedule.
              </p>
            </div>
          )}

          {/* PHASE 1: Pre-interview - Decision to Shortlist or Reject */}
          {needsSlotSuggestion && (
            <div className="workspace-card panel-hover border-l-4 border-indigo-500">
              <h2 className="section-title">Your Decision</h2>
              <p className="mt-1 text-sm text-gray-500">
                After reviewing the candidate profile, let us know if you'd like to proceed with scheduling or decline the profile.
              </p>
              
              <div className="mt-5">
                {/* Quick Reject Section */}
                <div className="rounded-xl border border-red-100 bg-red-50/50 p-4 mb-4">
                  <p className="text-sm font-semibold text-red-900 mb-3">Decline this candidate</p>
                  <select
                    value={preScreenRejectReason}
                    onChange={(event) => setPreScreenRejectReason(event.target.value)}
                    className="input-field"
                  >
                    <option value="">Select rejection reason</option>
                    {rejectionReasons.map((reason) => (
                      <option key={`prescreen-${reason.id}`} value={reason.reason}>{reason.reason}</option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    value={preScreenRejectRemarks}
                    onChange={(event) => setPreScreenRejectRemarks(event.target.value)}
                    className="input-field mt-3"
                    placeholder="Optional remarks"
                  />
                  <button
                    type="button"
                    onClick={rejectBeforeScheduling}
                    disabled={submitting || !preScreenRejectReason}
                    className="mt-3 w-full rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Decline Candidate
                  </button>
                </div>

                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-gray-200"></div>
                  <span className="flex-shrink-0 mx-4 text-gray-400 text-xs uppercase tracking-wider">or</span>
                  <div className="flex-grow border-t border-gray-200"></div>
                </div>

                {/* Shortlist + Suggest Slots */}
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <p className="text-sm font-semibold text-emerald-900 mb-4">Proceed with scheduling</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Suggested Slot 1</label>
                      <input
                        type="datetime-local"
                        value={slotForm.slot1}
                        onChange={(event) => setSlotForm((prev) => ({ ...prev, slot1: event.target.value }))}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Suggested Slot 2</label>
                      <input
                        type="datetime-local"
                        value={slotForm.slot2}
                        onChange={(event) => setSlotForm((prev) => ({ ...prev, slot2: event.target.value }))}
                        className="input-field"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={suggestSlots} 
                    disabled={submitting || !slotForm.slot1 || !slotForm.slot2} 
                    className="btn-primary mt-4 w-full disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Shortlist & Share Slots'}
                  </button>
                  {!slotForm.slot1 || !slotForm.slot2 ? (
                    <p className="mt-2 text-xs text-gray-500 text-center">Both slots are required to shortlist</p>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* PHASE 2: Post-interview - Feedback */}
          {canGiveFeedback && !needsSlotSuggestion && (
            <div className="workspace-card panel-hover">
              <div className="flex items-center gap-2">
                <h2 className="section-title">Interview Feedback</h2>
                <InfoTip text="Submit your evaluation after the interview. Use the scores and remarks to help the hiring team make their decision." />
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Interview: {formatDateTime(interview.scheduled_datetime)} · Round {currentRoundNumber}
              </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ['Technical', 'technical_score'],
                ['Behavioral', 'behavioral_score'],
                ['Company Fit', 'company_fit_score'],
              ].map(([label, field]) => (
                <div key={field}>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">{label}</label>
                  <select
                    value={feedbackForm[field]}
                    onChange={(event) => setFeedbackForm((prev) => ({ ...prev, [field]: event.target.value }))}
                    className="input-field"
                    disabled={!canGiveFeedback}
                  >
                    {SCORE_OPTIONS.map((score) => (
                      <option key={score} value={score}>{score}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="block text-sm font-semibold text-gray-900 mb-2">Decision</label>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ['shortlist', 'Shortlist'],
                  ['reject', 'Reject'],
                  ['no_show', 'No Show'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { haptic.light(); setFeedbackForm((prev) => ({ ...prev, decision: value })); }}
                    className={`review-choice ${feedbackForm.decision === value ? 'is-active' : ''}`}
                  >
                    <p className="text-sm font-semibold">{label}</p>
                  </button>
                ))}
              </div>
            </div>

            {feedbackForm.decision === 'reject' && (
              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-900 mb-2">Rejection reasons</label>
                <div className="grid gap-2">
                  {rejectionReasons.map((reason) => {
                    const selected = feedbackForm.rejection_reasons.includes(reason.reason);
                    return (
                      <label key={reason.id} className={`review-choice flex items-center gap-3 ${selected ? 'is-active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => {
                            haptic.light();
                            setFeedbackForm((prev) => ({
                              ...prev,
                              rejection_reasons: event.target.checked
                                ? [...prev.rejection_reasons, reason.reason]
                                : prev.rejection_reasons.filter((item) => item !== reason.reason),
                            }));
                          }}
                        />
                        <span className="text-sm text-gray-800">{reason.reason}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="block text-sm font-semibold text-gray-900 mb-2">Remarks</label>
              <textarea
                rows={4}
                value={feedbackForm.remarks}
                onChange={(event) => setFeedbackForm((prev) => ({ ...prev, remarks: event.target.value }))}
                className="input-field"
                placeholder="Share concise, specific observations for the recruiter and hiring team."
              />
            </div>

            <div className="decision-card decision-card-warn mt-4">
              <p className="text-sm font-semibold text-red-800">No-show capture</p>
              <p className="mt-1 text-sm text-red-700">
                Use this if the candidate did not attend. The ATS will return the profile to scheduling so HR can coordinate the next step.
              </p>
              <textarea
                rows={3}
                value={noShowReason}
                onChange={(event) => setNoShowReason(event.target.value)}
                className="input-field mt-3 bg-white"
                disabled={!noShowEnabled}
                placeholder="Capture what happened and any communication already attempted."
              />
              {!noShowEnabled ? (
                <p className="mt-3 text-xs text-red-700">
                  This becomes available only after the scheduled interview time has started or passed.
                </p>
              ) : null}
            </div>

<div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={submitFeedback} disabled={submitting || !canReview} className="btn-primary w-full disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Submit Interview Feedback'}
              </button>
              <button onClick={markNoShow} disabled={submitting || !noShowEnabled} className="btn-secondary w-full disabled:opacity-50">
                Mark Candidate No-Show
              </button>
            </div>

            {/* Request additional rounds - only show for post-interview */}
            {canGiveFeedback && maxAdditionalRounds > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Request Another Round</h3>
                  <InfoTip text="If this round is insufficient, request additional rounds with remarks." />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[0.4fr,1fr]">
                  <select
                    value={roundRequest.additional_rounds}
                    onChange={(event) => setRoundRequest((prev) => ({ ...prev, additional_rounds: event.target.value }))}
                    className="input-field"
                  >
                    {Array.from({ length: Math.max(1, Math.min(2, maxAdditionalRounds || 1)) }, (_, index) => index + 1).map((value) => (
                      <option key={value} value={value}>{value} round{value > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    value={roundRequest.remarks}
                    onChange={(event) => setRoundRequest((prev) => ({ ...prev, remarks: event.target.value }))}
                    className="input-field"
                    placeholder="Explain what still needs to be assessed"
                  />
                </div>
                <button
                  type="button"
                  onClick={requestAnotherRound}
                  disabled={submitting || !roundRequest.remarks.trim()}
                  className="btn-secondary mt-3 w-full disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Request Additional Round'}
                </button>
              </div>
            )}
          </div>
          )}

          {/* Waiting state - neither slots needed nor feedback available */}
          {!needsSlotSuggestion && !canGiveFeedback && (
            <div className="workspace-card panel-hover">
              <div className="text-center py-8">
                <p className="text-sm font-semibold text-gray-900">Waiting for next step</p>
                <p className="mt-2 text-sm text-gray-500">
                  The interview hasn't been scheduled yet. You'll be able to provide feedback once an interview is scheduled.
                </p>
              </div>
            </div>
          )}
        </div>

        <aside className="workboard-lane workboard-lane-aside">
          {/* Show Teams link if available */}
          {interview.meeting_join_url && (
            <div className="workspace-card panel-hover bg-indigo-50 border-indigo-200">
              <div className="flex items-center gap-2">
                <h2 className="section-title">Interview Meeting</h2>
              </div>
              <a 
                href={interview.meeting_join_url} 
                target="_blank" 
                rel="noreferrer" 
                className="mt-3 inline-flex items-center justify-center w-full btn-primary"
              >
                Join Teams Meeting
              </a>
            </div>
          )}

          <div className="workspace-card panel-hover">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Quick Actions</h2>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={() => sendReminder('recruiter')} disabled={submitting} className="btn-secondary w-full disabled:opacity-50">
                Remind Recruiter
              </button>
              {canCoordinate && (
                <button
                  onClick={() => navigate(`/applications/${application.id}/workflow`)}
                  disabled={submitting}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  Open Scheduling Workspace
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
