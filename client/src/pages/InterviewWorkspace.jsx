import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { interviewsAPI, mastersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import InfoTip from '../components/InfoTip';
import { canMarkNoShow, formatDateTime, toDatetimeLocalValue } from '../utils/dateTime';

const SCORE_OPTIONS = [1, 2, 3, 4, 5];

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
  });
  const [noShowReason, setNoShowReason] = useState('');

  const canCoordinate = hasRole('hr_admin') || hasRole('hr_recruiter');
  const canReview = hasRole('interviewer') || hasRole('hod') || hasRole('hr_admin');
  const needsSlotSuggestion = useMemo(
    () => ['AwaitingHODResponse', 'AwaitingInterviewScheduling'].includes(interview?.app_status) || interview?.status === 'review_pending',
    [interview?.app_status, interview?.status]
  );
  const canGiveFeedback = useMemo(
    () => interview?.scheduled_datetime || /^Round\d+$/.test(String(interview?.app_status || '')) || interview?.app_status === 'AwaitingFeedback',
    [interview?.app_status, interview?.scheduled_datetime]
  );
  const noShowEnabled = useMemo(() => canMarkNoShow(interview?.scheduled_datetime), [interview?.scheduled_datetime]);

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
          mastersAPI.list('rejection-reasons', { limit: 200 }).catch(() => ({ data: [] })),
        ]);
        setInterview(interviewRes.data);
        setSlotForm({
          slot1: toDatetimeLocalValue(interviewRes.data?.suggested_interview_datetime1),
          slot2: toDatetimeLocalValue(interviewRes.data?.suggested_interview_datetime2),
        });
        const items = Array.isArray(reasonsRes.data) ? reasonsRes.data : reasonsRes.data?.items || reasonsRes.data?.data || [];
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
      toast.error('Suggest both time slots');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.suggestSlots(interview.id, {
        suggested_datetime1: slotForm.slot1,
        suggested_datetime2: slotForm.slot2,
      });
      toast.success('Slots shared with recruiter');
      await loadInterview();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to suggest slots');
    } finally {
      setSubmitting(false);
    }
  };

  const submitFeedback = async () => {
    if (feedbackForm.decision === 'reject' && feedbackForm.rejection_reasons.length === 0) {
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
      toast.success('Feedback submitted');
      await loadInterview();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const markNoShow = async () => {
    const reason = noShowReason.trim();
    if (!reason) {
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
      toast.success('No-show recorded');
      await loadInterview();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to record no-show');
    } finally {
      setSubmitting(false);
    }
  };

  const requestAnotherRound = async () => {
    if (!roundRequest.remarks.trim()) {
      toast.error('Explain why another round is required');
      return;
    }
    try {
      setSubmitting(true);
      await interviewsAPI.requestAdditionalRounds(interview.id, {
        additional_rounds: Number(roundRequest.additional_rounds || 1),
        remarks: roundRequest.remarks.trim(),
      });
      toast.success('Additional round request sent to recruiter');
      await loadInterview();
    } catch (err) {
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
      toast.success('Reminder sent');
    } catch (err) {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary">Back</button>
        <div className="flex flex-wrap gap-2">
          {canCoordinate && (
            <button onClick={() => navigate(`/applications/${interview.application_record_id}/schedule`)} className="btn-secondary">
              Open Scheduling Workspace
            </button>
          )}
          <button onClick={() => navigate(`/applications/${interview.application_record_id}/workflow`)} className="btn-primary">
            Open Candidate Workflow
          </button>
        </div>
      </div>

      <div className="workspace-hero">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-['Fraunces'] text-4xl leading-tight text-gray-950">Reviewer Workspace</h1>
              <InfoTip text="This page is for pre-interview review, slot suggestion, no-show handling, and structured feedback. It replaces cramped row actions and small modal hopping." />
            </div>
            <p className="mt-3 text-base text-gray-600">
              Review the candidate dossier, suggest two workable slots before the interview, and close the round with structured feedback after the interview.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="workspace-stat min-w-[180px]">
              <p className="workspace-kicker">Candidate</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">{interview.candidate_name}</p>
              <p className="mt-1 text-xs text-gray-500">{interview.candidate_email}</p>
            </div>
            <div className="workspace-stat min-w-[180px]">
              <p className="workspace-kicker">Round</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">Round {interview.round || interview.round_number}</p>
              <p className="mt-1 text-xs text-gray-500">{interview.status || 'review pending'}</p>
            </div>
            <div className="workspace-stat min-w-[180px]">
              <p className="workspace-kicker">Assigned To</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">{interview.interviewer_email}</p>
              <p className="mt-1 text-xs text-gray-500">{formatDateTime(interview.scheduled_datetime)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="workspace-grid">
        <section className="workspace-main">
          <div className="workspace-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Candidate Dossier</h2>
                <p className="mt-1 text-sm text-gray-500">Review the full candidate packet before proposing time slots or rejecting the profile.</p>
              </div>
              {interview.resume_path && (
                <a href={interview.resume_path} target="_blank" rel="noreferrer" className="btn-secondary">
                  Open Resume
                </a>
              )}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ['Application', interview.application_code],
                ['Job', interview.job_title],
                ['Source', interview.source],
                ['Experience', interview.candidate_years_of_experience != null ? `${interview.candidate_years_of_experience} years` : '-'],
                ['Current Organization', interview.current_organization],
                ['Location', interview.current_location],
                ['Recruiter', interview.recruiter_email],
                ['Phone', interview.candidate_phone],
                ['Email', interview.candidate_email],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</p>
                  <p className="mt-2 text-sm font-medium text-gray-900">{value || '-'}</p>
                </div>
              ))}
            </div>
            <div className="mt-6">
              {interview.resume_path ? (
                renderInlinePreview(interview.resume_path, interview.resume_file_name || interview.candidate_name || 'Resume') || (
                  <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                    Inline preview works for PDFs and image resumes. Open the file directly for other types.
                  </div>
                )
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                  No resume uploaded yet.
                </div>
              )}
            </div>
          </div>

          <div className="workspace-card">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Candidate Documents</h2>
              <InfoTip text="HODs and interviewers can review the same inline candidate documents HR sees, so pre-interview screening decisions can be made with the full dossier in view." />
            </div>
            {!interview.candidate_documents?.length ? (
              <div className="mt-5 rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                No candidate documents are available yet.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {interview.candidate_documents.map((document) => (
                  <div key={document.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{document.document_name}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {String(document.stage || '').replace(/_/g, ' ')} · {document.status}
                        </p>
                      </div>
                      {document.file_path && (
                        <a href={document.file_path} target="_blank" rel="noreferrer" className="btn-secondary">
                          Open File
                        </a>
                      )}
                    </div>
                    {document.description && <p className="mt-3 text-sm text-gray-700">{document.description}</p>}
                    {document.file_path && (
                      <div className="mt-4">
                        {renderInlinePreview(document.file_path, document.file_name || document.document_name) || (
                          <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                            Inline preview works for PDFs and image files. Open the file directly for other formats.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="workspace-rail">
          {needsSlotSuggestion && canReview && (
            <div className="focus-panel">
              <div className="flex items-center gap-2">
                <h2 className="section-title">1. Suggest Two Interview Slots</h2>
                <InfoTip text="The interviewer or HOD starts the scheduling loop by suggesting two workable options. HR then confirms the final slot from the scheduling workspace." />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Suggested slot 1</label>
                  <input
                    type="datetime-local"
                    value={slotForm.slot1}
                    onChange={(event) => setSlotForm((prev) => ({ ...prev, slot1: event.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Suggested slot 2</label>
                  <input
                    type="datetime-local"
                    value={slotForm.slot2}
                    onChange={(event) => setSlotForm((prev) => ({ ...prev, slot2: event.target.value }))}
                    className="input-field"
                  />
                </div>
              </div>
              <button onClick={suggestSlots} disabled={submitting} className="btn-primary mt-4 w-full disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Share Slots with Recruiter'}
              </button>
            </div>
          )}

          <div className="workspace-card">
            <div className="flex items-center gap-2">
              <h2 className="section-title">2. Feedback & Outcome</h2>
              <InfoTip text="Once the interview is complete, use this panel for structured scoring, rejection reasons, shortlist decisions, no-show handling, or another-round requests." />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Current schedule: {formatDateTime(interview.scheduled_datetime)}.
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
                    onClick={() => setFeedbackForm((prev) => ({ ...prev, decision: value }))}
                    className={`rounded-2xl border px-4 py-3 text-left ${
                      feedbackForm.decision === value
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-950'
                        : 'border-gray-200 bg-gray-50 text-gray-700'
                    }`}
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
                      <label key={reason.id} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => setFeedbackForm((prev) => ({
                            ...prev,
                            rejection_reasons: event.target.checked
                              ? [...prev.rejection_reasons, reason.reason]
                              : prev.rejection_reasons.filter((item) => item !== reason.reason),
                          }))}
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

            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
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
          </div>

          <div className="workspace-card">
            <div className="flex items-center gap-2">
              <h2 className="section-title">3. Request Another Round or Send Reminder</h2>
              <InfoTip text="If this round is insufficient, request one or more additional rounds with remarks. Recruiters will see the request in the workflow and can increase the round plan." />
            </div>
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-[0.32fr,1fr]">
                <select
                  value={roundRequest.additional_rounds}
                  onChange={(event) => setRoundRequest((prev) => ({ ...prev, additional_rounds: event.target.value }))}
                  className="input-field"
                >
                  {[1, 2].map((value) => (
                    <option key={value} value={value}>{value} additional round{value > 1 ? 's' : ''}</option>
                  ))}
                </select>
                <textarea
                  rows={3}
                  value={roundRequest.remarks}
                  onChange={(event) => setRoundRequest((prev) => ({ ...prev, remarks: event.target.value }))}
                  className="input-field"
                  placeholder="Explain what still needs to be assessed before the candidate can move forward."
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button onClick={requestAnotherRound} disabled={submitting} className="btn-secondary w-full disabled:opacity-50">
                  Request Additional Round(s)
                </button>
                <button onClick={() => sendReminder('recruiter')} disabled={submitting} className="btn-secondary w-full disabled:opacity-50">
                  Remind Recruiter
                </button>
              </div>
              {(interview.meeting_join_url || canCoordinate) && (
                <button
                  onClick={() => canCoordinate ? navigate(`/applications/${interview.application_record_id}/schedule`) : sendReminder('candidate')}
                  disabled={submitting}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {canCoordinate ? 'Open Scheduling Workspace' : 'Remind Candidate'}
                </button>
              )}
            </div>
          </div>

          <div className="workspace-card">
            <h2 className="section-title">Live Context</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Reviewer</p>
                <p className="mt-1 text-sm font-medium text-gray-900">{user?.email}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Current ATS status</p>
                <p className="mt-1 text-sm font-medium text-gray-900">{interview.app_status}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Teams / calendar</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {interview.meeting_join_url ? 'Meeting link is available.' : 'Meeting link has not been generated yet.'}
                </p>
                {interview.meeting_join_url && (
                  <a href={interview.meeting_join_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-indigo-700 hover:text-indigo-900">
                    Open Teams meeting
                  </a>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
