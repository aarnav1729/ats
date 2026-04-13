import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { interviewsAPI, mastersAPI } from '../services/api';
import toast from 'react-hot-toast';
import AppModal from '../components/AppModal';
import DataTable from '../components/DataTable';
import { formatDateTime, toDatetimeLocalValue } from '../utils/dateTime';

const STATUS_COLORS = {
  review_pending: 'bg-violet-100 text-violet-700',
  awaiting_hr_schedule: 'bg-amber-100 text-amber-700',
  scheduled: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
  no_show: 'bg-red-100 text-red-700',
};

const CALENDAR_SYNC_COLORS = {
  synced: 'bg-emerald-100 text-emerald-700',
  synced_fallback: 'bg-teal-100 text-teal-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
};

const TABS = ['All', 'Needs Review', 'Needs Scheduling', 'Scheduled', 'Completed'];

const REJECTION_REASONS = [
  'Insufficient technical skills',
  'Poor communication',
  'Lack of relevant experience',
  'Cultural misfit',
  'Salary expectations too high',
  'Overqualified',
  'Other',
];

function isPreviewableFile(filePath = '') {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(filePath);
}

function renderInlinePreview(filePath, title) {
  if (!filePath || !isPreviewableFile(filePath)) return null;
  if (/\.(png|jpe?g|gif|webp)$/i.test(filePath)) {
    return <img src={filePath} alt={title} className="w-full rounded-lg border border-gray-200 object-contain max-h-80 bg-white" />;
  }
  return <iframe src={filePath} title={title} className="w-full h-80 rounded-lg border border-gray-200 bg-white" />;
}

function StarRating({ value, onChange, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-700 w-28">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className={`w-8 h-8 rounded-full text-sm font-bold transition-colors ${
              star <= value
                ? 'bg-yellow-400 text-white'
                : 'bg-gray-200 text-gray-500 hover:bg-yellow-200'
            }`}
          >
            {star}
          </button>
        ))}
      </div>
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  return (
    <AppModal open={open} onClose={onClose} title={title} width="wide">
      {children}
    </AppModal>
  );
}

export default function InterviewerPage() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCoordinate = hasRole('hr_admin') || hasRole('hr_recruiter');
  const canSubmitFeedback = hasRole('hr_admin') || hasRole('hod') || hasRole('interviewer');
  const requestedTab = searchParams.get('tab');
  const focusedApplicationId = searchParams.get('application_id');
  const focusMode = searchParams.get('focus') || 'review';
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(TABS.includes(requestedTab) ? requestedTab : 'All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modals
  const [feedbackModal, setFeedbackModal] = useState(null);
  const [slotsModal, setSlotsModal] = useState(null);
  const [chatModal, setChatModal] = useState(null);

  // Feedback form
  const [fbTechnical, setFbTechnical] = useState(0);
  const [fbBehavioral, setFbBehavioral] = useState(0);
  const [fbFit, setFbFit] = useState(0);
  const [fbRemarks, setFbRemarks] = useState('');
  const [fbDecision, setFbDecision] = useState('');
  const [fbRejectReasons, setFbRejectReasons] = useState([]);
  const [fbSubmitting, setFbSubmitting] = useState(false);

  // Slots form
  const [slot1, setSlot1] = useState('');
  const [slot2, setSlot2] = useState('');
  const [slotsSubmitting, setSlotsSubmitting] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(null);
  const [scheduleDatetime, setScheduleDatetime] = useState('');
  const [scheduleReason, setScheduleReason] = useState('');

  // Chat
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [reviewModal, setReviewModal] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [rejectionReasonOptions, setRejectionReasonOptions] = useState(REJECTION_REASONS);
  const [focusedRecordHandled, setFocusedRecordHandled] = useState(false);

  useEffect(() => {
    loadInterviews();
  }, [dateFrom, dateTo, focusedApplicationId]);

  useEffect(() => {
    if (TABS.includes(requestedTab) && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
    }
  }, [activeTab, requestedTab]);

  useEffect(() => {
    setFocusedRecordHandled(false);
  }, [focusedApplicationId]);

  useEffect(() => {
    mastersAPI.list('rejection-reasons', { limit: 200 })
      .then((res) => {
        const items = Array.isArray(res.data) ? res.data : res.data?.items || res.data?.data || [];
        const reasons = items.filter((item) => item.active_flag !== false).map((item) => item.reason).filter(Boolean);
        if (reasons.length > 0) setRejectionReasonOptions(reasons);
      })
      .catch(() => {});
  }, []);

  const loadInterviews = async () => {
    try {
      setLoading(true);
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (focusedApplicationId) params.application_id = focusedApplicationId;
      const res = await interviewsAPI.list(params);
      setInterviews(res.data?.interviews || res.data || []);
    } catch {
      toast.error('Failed to load interviews');
    } finally {
      setLoading(false);
    }
  };

  // Feedback
  const openFeedback = (iv) => {
    setFeedbackModal(iv);
    setFbTechnical(0);
    setFbBehavioral(0);
    setFbFit(0);
    setFbRemarks('');
    setFbDecision('');
    setFbRejectReasons([]);
  };

  const openRejectBeforeInterview = (iv) => {
    setReviewModal(null);
    openFeedback(iv);
    setFbDecision('reject');
  };

  const submitFeedback = async () => {
    if (!fbDecision) return toast.error('Please select a decision');
    if (fbDecision === 'reject' && fbRejectReasons.length === 0) return toast.error('Please select at least one rejection reason');
    try {
      setFbSubmitting(true);
      await interviewsAPI.feedback(feedbackModal.id || feedbackModal._id, {
        technical_score: fbTechnical,
        behavioral_score: fbBehavioral,
        company_fit_score: fbFit,
        remarks: fbRemarks,
        decision: fbDecision,
        rejection_reasons: fbDecision === 'reject' ? fbRejectReasons : [],
      });
      toast.success('Feedback submitted');
      setFeedbackModal(null);
      loadInterviews();
    } catch {
      toast.error('Failed to submit feedback');
    } finally {
      setFbSubmitting(false);
    }
  };

  const toggleRejectReason = (reason) => {
    setFbRejectReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
  };

  // Suggest slots
  const openSlots = (iv) => {
    setSlotsModal(iv);
    setSlot1('');
    setSlot2('');
  };

  const submitSlots = async () => {
    if (!slot1 || !slot2) return toast.error('Please fill both slots');
    try {
      setSlotsSubmitting(true);
      await interviewsAPI.suggestSlots(slotsModal.id || slotsModal._id, {
        suggested_datetime1: slot1,
        suggested_datetime2: slot2,
      });
      toast.success('Slots suggested');
      setSlotsModal(null);
      loadInterviews();
    } catch {
      toast.error('Failed to suggest slots');
    } finally {
      setSlotsSubmitting(false);
    }
  };

  // Chat
  const openChat = async (iv) => {
      setChatModal(iv);
      setNewMessage('');
      try {
      const res = await interviewsAPI.messages(iv.id || iv._id);
      setMessages(res.data?.messages || res.data || []);
    } catch {
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    try {
      setChatSending(true);
      await interviewsAPI.sendMessage(chatModal.id || chatModal._id, { message: newMessage.trim() });
      setNewMessage('');
      const res = await interviewsAPI.messages(chatModal.id || chatModal._id);
      setMessages(res.data?.messages || res.data || []);
    } catch {
      toast.error('Failed to send message');
    } finally {
      setChatSending(false);
    }
  };

  // Reschedule
  const handleReschedule = async (iv) => {
    setScheduleModal(iv);
    setScheduleDatetime(
      iv.scheduled_datetime
        ? toDatetimeLocalValue(iv.scheduled_datetime)
        : toDatetimeLocalValue(iv.suggested_interview_datetime1)
    );
    setScheduleReason(
      iv.scheduled_datetime
        ? 'Rescheduled from Interview Hub'
        : 'Confirmed from Interview Hub'
    );
  };

  const submitSchedule = async () => {
    if (!scheduleModal) return;
    if (!scheduleDatetime) {
      toast.error('Select the confirmed interview date and time');
      return;
    }
    try {
      const res = await interviewsAPI.reschedule(scheduleModal.id || scheduleModal._id, {
        new_datetime: scheduleDatetime,
        reason: scheduleReason || 'Confirmed from Interview Hub',
      });
      const sync = res.data?.calendar_sync;
      if (sync?.status === 'synced' || sync?.status === 'synced_fallback') {
        toast.success(sync.message || 'Interview rescheduled and calendar blocked');
      } else if (sync?.status === 'partial') {
        toast(sync.message || 'Interview rescheduled, but Teams linking needs extra Microsoft permissions');
      } else if (sync?.status === 'failed') {
        toast(sync.message || 'Interview rescheduled locally, but Microsoft calendar sync failed');
      } else {
        toast.success('Interview rescheduled');
      }
      setScheduleModal(null);
      loadInterviews();
    } catch {
      toast.error('Failed to reschedule');
    }
  };

  const formatDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const getWorkBucket = (interview) => {
    if (interview.status === 'completed' || interview.status === 'no_show') return 'Completed';
    if (interview.app_status === 'AwaitingHODResponse' || interview.status === 'review_pending') return 'Needs Review';
    if (interview.app_status === 'AwaitingInterviewScheduling' || interview.status === 'awaiting_hr_schedule') return 'Needs Scheduling';
    if (interview.scheduled_at || interview.scheduled_datetime || /^Round\d+/.test(String(interview.app_status || ''))) return 'Scheduled';
    return 'All';
  };

  const filteredInterviews = useMemo(() => (
    activeTab === 'All'
      ? interviews
      : interviews.filter((interview) => getWorkBucket(interview) === activeTab)
  ), [activeTab, interviews]);

  const queueBuckets = useMemo(() => ({
    needsReview: interviews.filter((interview) => getWorkBucket(interview) === 'Needs Review'),
    needsScheduling: interviews.filter((interview) => getWorkBucket(interview) === 'Needs Scheduling'),
    scheduled: interviews.filter((interview) => getWorkBucket(interview) === 'Scheduled'),
    completed: interviews.filter((interview) => getWorkBucket(interview) === 'Completed'),
  }), [interviews]);

  useEffect(() => {
    if (!focusedApplicationId || focusedRecordHandled || loading) return;
    const match = interviews.find((interview) => String(interview.application_record_id) === String(focusedApplicationId));
    if (!match) return;
    if (focusMode === 'review') {
      openReview(match);
    } else if (focusMode === 'schedule') {
      handleReschedule(match);
    }
    setFocusedRecordHandled(true);
  }, [focusMode, focusedApplicationId, focusedRecordHandled, interviews, loading]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const getNextStep = (interview) => {
    if (interview.app_status === 'AwaitingHODResponse') {
      return 'Reviewer should inspect the profile and suggest two slots or reject before interview.';
    }
    if (interview.app_status === 'AwaitingInterviewScheduling') {
      return canCoordinate
        ? 'Confirm the final slot and let the ATS attempt Teams calendar sync.'
        : 'Waiting for HR to confirm the final schedule and Teams link.';
    }
    if (/^Round\d+$/.test(String(interview.app_status || ''))) {
      return canCoordinate
        ? 'Keep the schedule current and redirect reviewers here if they need to reschedule.'
        : 'Conduct the interview, then submit structured feedback from this page.';
    }
    if (interview.app_status === 'AwaitingFeedback') {
      return 'Feedback is pending from the assigned HOD or interviewer.';
    }
    return 'Open the dedicated workspace to inspect the candidate dossier and continue the workflow.';
  };

  const openReview = async (iv) => {
    setReviewLoading(true);
    try {
      const res = await interviewsAPI.get(iv.id || iv._id);
      setReviewModal(res.data);
    } catch {
      toast.error('Failed to load candidate details');
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        Interview Hub
      </h1>

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 mb-6">
        <p className="text-sm font-semibold text-indigo-950">
          {canCoordinate
            ? 'Use this page as the queue for scheduling work, then open the dedicated scheduling or reviewer workspace for the actual task.'
            : 'Use this page as your task inbox. Open the reviewer workspace for pre-interview review, slot suggestions, inline document checks, and feedback.'}
        </p>
        <p className="mt-2 text-sm text-indigo-900">
          {canCoordinate
            ? 'Needs Review means the reviewer still has to inspect the candidate. Needs Scheduling means the reviewer has already suggested two slots and the recruiter should now confirm the final time.'
            : 'Needs Review means the candidate still requires dossier review. Scheduled means the recruiter has already confirmed the slot and you can move into the actual interview and feedback steps.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4 mb-6">
        {[
          ['Needs Review', queueBuckets.needsReview.length],
          ['Needs Scheduling', queueBuckets.needsScheduling.length],
          ['Scheduled', queueBuckets.scheduled.length],
          ['Completed', queueBuckets.completed.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-gray-950">{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex bg-gray-100 rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab ? 'bg-white shadow text-indigo-600' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm" />
          <span className="text-gray-400">to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm" />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" /></div>
      ) : (
        <DataTable
          title="Interview Hub"
          data={filteredInterviews}
          exportFileName="interviews"
          emptyMessage="No interviews found."
          onRowClick={(row) => navigate(`/interviews/${row.id || row._id}/workspace`)}
          columns={[
            { key: 'candidate_name', label: 'Candidate', render: (row) => (
              <div>
                <p className="font-medium text-gray-800">{row.candidate_name || row.application?.candidate_name || '-'}</p>
                <p className="text-xs text-gray-500">{row.candidate_email || '-'}</p>
              </div>
            )},
            { key: 'job_title', label: 'Job & Round', render: (row) => (
              <div>
                <p className="font-medium text-gray-800">{row.job_title || row.application?.job_title || '-'}</p>
                <p className="text-xs text-gray-500">Round {row.round || row.round_number || '-'}</p>
              </div>
            )},
            { key: 'scheduled_datetime', label: 'Schedule', render: (row) => (
              <div className="space-y-1">
                <p>{formatDate(row.scheduled_at || row.scheduled_datetime)}</p>
                {row.suggested_interview_datetime1 && <p className="text-xs text-indigo-600">Slot 1: {formatDate(row.suggested_interview_datetime1)}</p>}
                {row.suggested_interview_datetime2 && <p className="text-xs text-indigo-600">Slot 2: {formatDate(row.suggested_interview_datetime2)}</p>}
              </div>
            )},
            { key: 'status', label: 'Status', render: (row) => (
              <div className="space-y-1">
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-600'}`}>{row.status?.replace(/_/g, ' ') || '-'}</span>
                {row.app_status && <span className="block px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 w-fit">{row.app_status}</span>}
              </div>
            )},
            { key: 'next_step', label: 'Next Step', render: (row) => <p className="text-gray-600 max-w-xs">{getNextStep(row)}</p> },
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <div className="flex gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                {row.meeting_join_url && <a href={row.meeting_join_url} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium">Teams</a>}
                <button onClick={() => navigate(`/interviews/${row.id || row._id}/workspace`)} className="text-xs px-2.5 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium">Workspace</button>
                {canCoordinate && row.application_record_id && <button onClick={() => navigate(`/applications/${row.application_record_id}/schedule`)} className="text-xs px-2.5 py-1 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium">Schedule</button>}
              </div>
            )},
          ]}
        />
      )}

      {/* Feedback Modal */}
      <Modal open={!!feedbackModal} onClose={() => setFeedbackModal(null)} title="Give Feedback">
        <div className="space-y-4">
          <StarRating label="Technical" value={fbTechnical} onChange={setFbTechnical} />
          <StarRating label="Behavioral" value={fbBehavioral} onChange={setFbBehavioral} />
          <StarRating label="Company Fit" value={fbFit} onChange={setFbFit} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea rows={3} value={fbRemarks} onChange={(e) => setFbRemarks(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Your remarks..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Decision</label>
            <div className="flex gap-4">
              {[
                { value: 'shortlist', label: 'Shortlist', color: 'text-green-600' },
                { value: 'reject', label: 'Reject', color: 'text-red-600' },
                { value: 'no_show', label: 'No Show', color: 'text-gray-600' },
              ].map((opt) => (
                <label key={opt.value} className={`flex items-center gap-1.5 cursor-pointer text-sm font-medium ${opt.color}`}>
                  <input type="radio" name="decision" value={opt.value} checked={fbDecision === opt.value} onChange={(e) => setFbDecision(e.target.value)} className="accent-indigo-600" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {fbDecision === 'reject' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rejection Reasons</label>
              <div className="flex flex-wrap gap-2">
                {rejectionReasonOptions.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => toggleRejectReason(reason)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      fbRejectReasons.includes(reason)
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={submitFeedback}
            disabled={fbSubmitting}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {fbSubmitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </div>
      </Modal>

      <Modal open={!!reviewModal} onClose={() => setReviewModal(null)} title={reviewLoading ? 'Loading Candidate' : `Candidate Review${reviewModal?.candidate_name ? ` - ${reviewModal.candidate_name}` : ''}`}>
        {reviewLoading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : reviewModal ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ['Application ID', reviewModal.application_code],
                ['Job', reviewModal.job_title],
                ['Current Stage', reviewModal.app_status],
                ['Round', reviewModal.round || reviewModal.round_number],
                ['Calendar Sync', reviewModal.calendar_sync_status ? String(reviewModal.calendar_sync_status).replace(/_/g, ' ') : '-'],
                ['Email', reviewModal.candidate_email],
                ['Phone', reviewModal.candidate_phone],
                ['Experience', reviewModal.candidate_years_of_experience != null ? `${reviewModal.candidate_years_of_experience} years` : '-'],
                ['Current Organization', reviewModal.current_organization],
                ['Current Location', reviewModal.current_location],
                ['Current CTC', reviewModal.current_ctc != null ? `INR ${reviewModal.current_ctc}` : '-'],
                ['Education', reviewModal.education_level || reviewModal.education_other || '-'],
                ['Source', reviewModal.source || '-'],
                ['Aadhaar', reviewModal.candidate_aadhar || '-'],
                ['PAN', reviewModal.candidate_pan || '-'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">{label}</p>
                  <p className="text-sm text-gray-800 mt-1">{value || '-'}</p>
                </div>
              ))}
            </div>

            {(reviewModal.meeting_join_url || reviewModal.calendar_sync_error) && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">Meeting Link</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {reviewModal.meeting_provider || 'Microsoft Teams'}
                    </p>
                  </div>
                  {reviewModal.meeting_join_url && (
                    <a
                      href={reviewModal.meeting_join_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary"
                    >
                      Join Teams
                    </a>
                  )}
                </div>
                {reviewModal.calendar_sync_error && (
                  <p className="text-sm text-amber-700 mt-3">{reviewModal.calendar_sync_error}</p>
                )}
              </div>
            )}

            {reviewModal.resume_path && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-800">Resume</h4>
                  <a href={reviewModal.resume_path} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:text-indigo-800">
                    Open Resume
                  </a>
                </div>
                {renderInlinePreview(reviewModal.resume_path, reviewModal.resume_file_name || reviewModal.candidate_name || 'Resume') || (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                    Inline preview is available for PDF and image resumes. This file can still be opened in a new tab.
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800">Candidate Documents</h4>
                <span className="text-xs text-gray-500">{reviewModal.candidate_documents?.length || 0} item(s)</span>
              </div>
              {!reviewModal.candidate_documents?.length ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                  No candidate documents have been requested or uploaded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {reviewModal.candidate_documents.map((document) => (
                    <div key={document.id} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{document.document_name}</p>
                          <p className="text-xs text-gray-500">
                            Stage: {String(document.stage || '').replace(/_/g, ' ')} | Status: {document.status}
                          </p>
                        </div>
                        {document.file_path && (
                          <a href={document.file_path} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:text-indigo-800">
                            Open File
                          </a>
                        )}
                      </div>
                      {document.description && (
                        <p className="text-sm text-gray-600 mb-2">{document.description}</p>
                      )}
                      {document.file_path && renderInlinePreview(document.file_path, document.file_name || document.document_name)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {!canCoordinate && ['AwaitingHODResponse', 'AwaitingInterviewScheduling'].includes(reviewModal.app_status) ? (
                <>
                  <button onClick={() => openSlots(reviewModal)} className="btn-primary">
                    Suggest 2 Slots
                  </button>
                  <button onClick={() => openRejectBeforeInterview(reviewModal)} className="btn-secondary text-red-600 hover:text-red-700">
                    Reject Before Interview
                  </button>
                </>
              ) : canCoordinate && reviewModal.app_status === 'AwaitingInterviewScheduling' ? (
                <button onClick={() => handleReschedule(reviewModal)} className="btn-primary">
                  Confirm Schedule
                </button>
              ) : canCoordinate && reviewModal.job_record_id ? (
                <button onClick={() => navigate(`/jobs/${reviewModal.job_record_id}`)} className="btn-primary">
                  Open Job Workflow
                </button>
              ) : (
                <button onClick={() => openFeedback(reviewModal)} className="btn-primary">
                  Open Feedback Form
                </button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Suggest Slots Modal */}
      <Modal open={!!slotsModal} onClose={() => setSlotsModal(null)} title="Suggest Interview Slots">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slot 1</label>
            <input type="datetime-local" value={slot1} onChange={(e) => setSlot1(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slot 2</label>
            <input type="datetime-local" value={slot2} onChange={(e) => setSlot2(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <button
            onClick={submitSlots}
            disabled={slotsSubmitting}
            className="w-full bg-teal-600 text-white py-2 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {slotsSubmitting ? 'Submitting...' : 'Suggest Slots'}
          </button>
        </div>
      </Modal>

      <Modal open={!!scheduleModal} onClose={() => setScheduleModal(null)} title="Confirm Interview Schedule">
        <div className="space-y-4">
          {scheduleModal && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm font-semibold text-gray-800">{scheduleModal.candidate_name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {scheduleModal.job_title} | Round {scheduleModal.round || scheduleModal.round_number}
              </p>
            </div>
          )}
          {(scheduleModal?.suggested_interview_datetime1 || scheduleModal?.suggested_interview_datetime2) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Suggested slots</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {[scheduleModal?.suggested_interview_datetime1, scheduleModal?.suggested_interview_datetime2].filter(Boolean).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setScheduleDatetime(toDatetimeLocalValue(slot))}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      scheduleDatetime === toDatetimeLocalValue(slot)
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-200 hover:bg-indigo-50/40'
                    }`}
                  >
                    {formatDateTime(slot)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmed schedule</label>
            <input type="datetime-local" value={scheduleDatetime} onChange={(e) => setScheduleDatetime(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scheduling note</label>
            <textarea rows={3} value={scheduleReason} onChange={(e) => setScheduleReason(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" placeholder="Add a note for the schedule update" />
          </div>
          <button
            onClick={submitSchedule}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            Confirm Schedule & Teams
          </button>
        </div>
      </Modal>

      {/* Chat Modal */}
      <Modal open={!!chatModal} onClose={() => setChatModal(null)} title={`Chat - ${chatModal?.candidate_name || 'Interview'}`}>
        <div className="flex flex-col h-80">
          <div className="flex-1 overflow-y-auto space-y-3 mb-4 border rounded-lg p-3 bg-gray-50">
            {messages.length === 0 ? (
              <p className="text-sm text-gray-400 text-center mt-8">No messages yet.</p>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.sender_email === user?.email ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                    msg.sender_email === user?.email
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border text-gray-700'
                  }`}>
                    <p>{msg.message || msg.text}</p>
                    <p className="text-[10px] mt-1 opacity-60">{msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : ''}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              onClick={sendMessage}
              disabled={chatSending || !newMessage.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {chatSending ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
