import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { jobsAPI, applicationsAPI, mastersAPI, candidatesAPI, interviewsAPI } from '../services/api';
import toast from 'react-hot-toast';
import AppModal from '../components/AppModal';
import EmailComposerModal from '../components/EmailComposerModal';
import Timeline from '../components/Timeline';
import { formatDateTime, toDatetimeLocalValue } from '../utils/dateTime';
import {
  getCurrentRoundTask,
  getInterviewHubTarget,
  getNextRoundNumber,
  getWorkflowProgress,
  WORKFLOW_LANES,
} from '../workflow/applicationWorkflow';

const STATUS_COLORS = {
  InQueue: 'bg-gray-100 text-gray-700', Applied: 'bg-blue-100 text-blue-700',
  Shortlisted: 'bg-indigo-100 text-indigo-700', Selected: 'bg-emerald-100 text-emerald-700',
  Offered: 'bg-teal-100 text-teal-700', Joined: 'bg-green-200 text-green-800',
  HRRejected: 'bg-red-100 text-red-700', Withdrawn: 'bg-gray-200 text-gray-600',
  AwaitingHODResponse: 'bg-violet-100 text-violet-700',
  HODRejected: 'bg-rose-100 text-rose-700',
  AwaitingInterviewScheduling: 'bg-amber-100 text-amber-700',
  Round1: 'bg-sky-100 text-sky-700',
  Round2: 'bg-blue-100 text-blue-700',
  Round3: 'bg-indigo-100 text-indigo-700',
  AwaitingFeedback: 'bg-fuchsia-100 text-fuchsia-700',
  OfferInProcess: 'bg-orange-100 text-orange-700',
  OfferAccepted: 'bg-emerald-100 text-emerald-700',
  OfferRejected: 'bg-red-100 text-red-700',
  OfferDropout: 'bg-rose-100 text-rose-700',
  InterviewScheduled: 'bg-purple-100 text-purple-700', DocumentsPending: 'bg-amber-100 text-amber-700',
  review_pending: 'bg-violet-100 text-violet-700',
  awaiting_hr_schedule: 'bg-amber-100 text-amber-700',
};

const JOB_STATUSES = ['draft', 'open', 'on_hold', 'closed', 'archived'];
const STAGE_COLORS = ['bg-gray-400', 'bg-blue-400', 'bg-indigo-400', 'bg-purple-400', 'bg-emerald-400', 'bg-teal-400', 'bg-green-500', 'bg-red-400'];
const ALL_STAGES = [
  'InQueue',
  'Applied',
  'Withdrawn',
  'HRRejected',
  'Shortlisted',
  'AwaitingHODResponse',
  'HODRejected',
  'AwaitingInterviewScheduling',
  'Round1',
  'Round1Rejected',
  'Round2',
  'Round2Rejected',
  'Round3',
  'Round3Rejected',
  'AwaitingFeedback',
  'Selected',
  'OfferInProcess',
  'Offered',
  'OfferAccepted',
  'OfferRejected',
  'OfferDropout',
  'Joined',
];
const STAGE_TRANSITIONS = {
  InQueue: ['Applied', 'HRRejected', 'Withdrawn'],
  Applied: ['Shortlisted', 'HRRejected', 'Withdrawn'],
  Shortlisted: ['AwaitingHODResponse', 'HRRejected'],
  AwaitingHODResponse: ['AwaitingInterviewScheduling', 'HODRejected'],
  AwaitingInterviewScheduling: ['Round1', 'HODRejected'],
  Round1: ['AwaitingFeedback', 'Round1Rejected', 'Round2'],
  Round2: ['AwaitingFeedback', 'Round2Rejected', 'Round3'],
  Round3: ['AwaitingFeedback', 'Round3Rejected', 'Selected'],
  AwaitingFeedback: ['Selected', 'Round1Rejected', 'Round2Rejected', 'Round3Rejected'],
  Selected: ['OfferInProcess', 'OfferRejected'],
  OfferInProcess: ['Offered', 'OfferRejected'],
  Offered: ['OfferAccepted', 'OfferRejected', 'OfferDropout'],
  OfferAccepted: ['Joined', 'OfferDropout'],
};
const DOC_STAGE_OPTIONS = [
  { value: 'before_offer_release', label: 'Before Offer Release' },
  { value: 'after_offer_release', label: 'After Offer Release' },
  { value: 'after_offer_acceptance', label: 'After Offer Acceptance' },
  { value: 'before_joining', label: 'Before Joining' },
  { value: 'joining_day', label: 'Joining Day' },
  { value: 'after_joining', label: 'After Joining' },
];
const DOC_FLOW_STATUSES = new Set(['Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'Joined']);
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

function getSmartStageOptions(status) {
  const recommended = STAGE_TRANSITIONS[status] || [];
  if (recommended.length > 0) return recommended;
  return ALL_STAGES.filter((stage) => stage !== status);
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('applicants');
  const [stageCounts, setStageCounts] = useState({});

  // Applicants table state
  const [applicants, setApplicants] = useState([]);
  const [appTotal, setAppTotal] = useState(0);
  const [appPage, setAppPage] = useState(1);
  const [appSearch, setAppSearch] = useState('');
  const [appStatusFilter, setAppStatusFilter] = useState('');
  const [appSortBy, setAppSortBy] = useState('created_at');
  const [appSortOrder, setAppSortOrder] = useState('desc');
  const [selectedIds, setSelectedIds] = useState([]);
  const [appLoading, setAppLoading] = useState(false);

  // Modals
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [openJobs, setOpenJobs] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [rejectionReasons, setRejectionReasons] = useState([]);
  const [pendingRejection, setPendingRejection] = useState(null);
  const [selectedRejectionReason, setSelectedRejectionReason] = useState('');
  const [candidateDetail, setCandidateDetail] = useState(null);
  const [candidateDetailLoading, setCandidateDetailLoading] = useState(false);
  const [reviewSetupCandidate, setReviewSetupCandidate] = useState(null);
  const [reviewSetupForm, setReviewSetupForm] = useState({
    no_of_rounds: '1',
    interviewers: ['', '', ''],
  });
  const [documentRequest, setDocumentRequest] = useState({
    stage: DOC_STAGE_OPTIONS[0].value,
    document_name: '',
    description: '',
  });
  const [detailActionLoading, setDetailActionLoading] = useState('');
  const [scheduleModal, setScheduleModal] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    datetime: '',
    reason: '',
    source_slot: '',
  });
  const [documentReminderModal, setDocumentReminderModal] = useState(null);
  const [emailSending, setEmailSending] = useState(false);

  const addMenuRef = useRef(null);

  useEffect(() => { loadJob(); }, [id]);
  useEffect(() => { if (job) loadApplicants(); }, [job, appPage, appSearch, appStatusFilter, appSortBy, appSortOrder, activeTab]);
  useEffect(() => { if (job) loadOpenJobs(); }, [job]);
  useEffect(() => {
    mastersAPI.list('rejection-reasons', { limit: 200 }).then((res) => {
      const items = Array.isArray(res.data) ? res.data : res.data?.items || res.data?.data || [];
      setRejectionReasons(items.filter((item) => item.active_flag !== false));
    }).catch(() => setRejectionReasons([]));
  }, []);

  useEffect(() => {
    const handleClick = (e) => { if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setShowAddMenu(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadJob = async () => {
    setLoading(true);
    try {
      const [jobRes, stageRes] = await Promise.all([
        jobsAPI.get(id),
        jobsAPI.stageCounts(id).catch(() => ({ data: {} })),
      ]);
      setJob(jobRes.data);
      setStageCounts(jobRes.data?.stage_counts || stageRes.data?.stage_counts || {});
    } catch (err) {
      toast.error('Failed to load job');
      navigate('/jobs');
    } finally {
      setLoading(false);
    }
  };

  const loadApplicants = async () => {
    setAppLoading(true);
    try {
      const res = await jobsAPI.applicants(id, {
        page: activeTab === 'stages' ? 1 : appPage,
        limit: activeTab === 'stages' ? 200 : 20,
        search: appSearch || undefined,
        status: appStatusFilter || undefined, sort_by: appSortBy, sort_order: appSortOrder,
      });
      setApplicants(res.data?.applicants || res.data || []);
      setAppTotal(res.data?.total || 0);
    } catch { toast.error('Failed to load applicants'); }
    finally { setAppLoading(false); }
  };

  const loadCandidateDetail = async (applicationId) => {
    setCandidateDetailLoading(true);
    try {
      const res = await applicationsAPI.get(applicationId);
      setCandidateDetail(res.data);
      setDocumentRequest({
        stage: DOC_STAGE_OPTIONS[0].value,
        document_name: '',
        description: '',
      });
    } catch {
      toast.error('Failed to load candidate details');
    } finally {
      setCandidateDetailLoading(false);
    }
  };

  const openCandidateDetail = async (applicationId) => {
    navigate(`/applications/${applicationId}/workflow`);
  };

  const refreshWorkflowViews = async (applicationId = null) => {
    await loadApplicants();
    jobsAPI.stageCounts(id).then((r) => setStageCounts(r.data?.stage_counts || {})).catch(() => {});
    if (applicationId) {
      await loadCandidateDetail(applicationId);
    }
  };

  const handleRequestDocument = async () => {
    if (!candidateDetail?.id) return;
    if (!documentRequest.document_name.trim()) {
      toast.error('Document name is required');
      return;
    }
    try {
      setDetailActionLoading('request-doc');
      await candidatesAPI.createDocRequest(candidateDetail.id, {
        stage: documentRequest.stage,
        document_name: documentRequest.document_name.trim(),
        description: documentRequest.description.trim(),
      });
      toast.success('Document request created');
      setDocumentRequest((prev) => ({ ...prev, document_name: '', description: '' }));
      await loadCandidateDetail(candidateDetail.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to request document');
    } finally {
      setDetailActionLoading('');
    }
  };

  const handleReviewDocument = async (document, status) => {
    if (!candidateDetail?.id) return;
    const rejectionReason = status === 'rejected'
      ? window.prompt(`Why is "${document.document_name}" being rejected?`, document.rejection_reason || '')
      : '';
    if (status === 'rejected' && !rejectionReason) return;
    try {
      setDetailActionLoading(`review-${document.id}-${status}`);
      await candidatesAPI.reviewDocument(candidateDetail.id, document.id, {
        status,
        rejection_reason: status === 'rejected' ? rejectionReason : undefined,
      });
      toast.success(`Document ${status}`);
      await loadCandidateDetail(candidateDetail.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to review document');
    } finally {
      setDetailActionLoading('');
    }
  };

  const handleRemindCandidate = async (document) => {
    if (!candidateDetail?.id) return;
    try {
      setDetailActionLoading(`remind-${document.id}`);
      await candidatesAPI.remind(candidateDetail.id, document.id);
      toast.success('Reminder sent');
      await loadCandidateDetail(candidateDetail.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send reminder');
    } finally {
      setDetailActionLoading('');
    }
  };

  const sendDocumentReminder = async ({ subject, html_body }) => {
    if (!candidateDetail?.id || !documentReminderModal?.id) return;
    try {
      setEmailSending(true);
      await candidatesAPI.remind(candidateDetail.id, documentReminderModal.id, {
        subject,
        html_body,
      });
      toast.success('Reminder sent');
      setDocumentReminderModal(null);
      await loadCandidateDetail(candidateDetail.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send reminder');
    } finally {
      setEmailSending(false);
    }
  };

  const openInterviewHub = (application, focus = 'review') => {
    if (!application?.id) {
      navigate('/interviews');
      return;
    }
    navigate(getInterviewHubTarget(application, { focus }));
  };

  const openScheduleModal = (interviewTask, application = candidateDetail) => {
    if (!interviewTask?.id && !interviewTask?._id) return;
    const suggestedSlots = [
      application?.suggested_interview_datetime1,
      application?.suggested_interview_datetime2,
    ].filter(Boolean);
    setScheduleModal({ interviewTask, application, suggestedSlots });
    setScheduleForm({
      datetime: interviewTask.scheduled_datetime
        ? toDatetimeLocalValue(interviewTask.scheduled_datetime)
        : toDatetimeLocalValue(suggestedSlots[0]),
      reason: interviewTask.scheduled_datetime
        ? 'Rescheduled from the job workflow screen'
        : 'Scheduled from the job workflow screen',
      source_slot: '',
    });
  };

  const submitScheduleModal = async () => {
    if (!scheduleModal?.interviewTask) return;
    if (!scheduleForm.datetime) {
      toast.error('Select or enter the confirmed interview date and time');
      return;
    }
    try {
      const taskId = scheduleModal.interviewTask.id || scheduleModal.interviewTask._id;
      setDetailActionLoading(`schedule-${taskId}`);
      const res = await interviewsAPI.reschedule(taskId, {
        new_datetime: scheduleForm.datetime,
        reason: scheduleForm.reason || 'Scheduled from the job workflow screen',
      });
      const sync = res.data?.calendar_sync;
      if (sync?.status === 'synced' || sync?.status === 'synced_fallback') {
        toast.success(sync.message || 'Interview schedule updated');
      } else if (sync?.status === 'partial' || sync?.status === 'failed') {
        toast(sync.message || 'Interview schedule updated locally, but Microsoft calendar sync needs attention');
      } else {
        toast.success('Interview schedule updated');
      }
      const applicationId = scheduleModal.application?.id || candidateDetail?.id;
      setScheduleModal(null);
      await refreshWorkflowViews(applicationId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to schedule interview');
    } finally {
      setDetailActionLoading('');
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      await jobsAPI.update(id, { status: newStatus });
      setJob(prev => ({ ...prev, status: newStatus }));
      toast.success(`Job status updated to ${newStatus}`);
    } catch { toast.error('Failed to update status'); }
  };

  const handleGenerateQR = async () => {
    try {
      const res = await jobsAPI.qrCode(id, {
        url: `${window.location.origin}/careers/${job?.id || id}`,
      });
      setQrData(res.data);
      setShowQR(true);
    } catch { toast.error('Failed to generate QR code'); }
  };

  const handleShareLink = () => {
    const link = `${window.location.origin}/careers/${job?.id || id}`;
    navigator.clipboard.writeText(link);
    toast.success('Application link copied to clipboard');
  };

  const handleArchive = async () => {
    if (!confirm('Archive this job? It will no longer accept new applications.')) return;
    try {
      await jobsAPI.update(id, { status: 'archived' });
      setJob(prev => ({ ...prev, status: 'archived' }));
      toast.success('Job archived');
    } catch { toast.error('Failed to archive job'); }
  };

  const handleExport = async () => {
    try {
      const res = await jobsAPI.export({ job_id: id });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `job-${id}-applicants.json`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported');
    } catch { toast.error('Export failed'); }
  };

  const handleSort = (field) => {
    if (appSortBy === field) setAppSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setAppSortBy(field); setAppSortOrder('asc'); }
  };

  const toggleSelect = (appId) => {
    setSelectedIds(prev => prev.includes(appId) ? prev.filter(x => x !== appId) : [...prev, appId]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === applicants.length) setSelectedIds([]);
    else setSelectedIds(applicants.map(a => a.id));
  };

  const handleBulkStatus = async (status, rejectionReason = null) => {
    if (selectedIds.length === 0) return toast.error('Select at least one applicant');
    if (status === 'HRRejected' && !rejectionReason) {
      setPendingRejection({ mode: 'bulk', status });
      return;
    }
    try {
      await applicationsAPI.bulkStatus({ application_ids: selectedIds, status, rejection_reason: rejectionReason || undefined, comment: rejectionReason || undefined });
      toast.success(`Updated ${selectedIds.length} applicants`);
      setSelectedIds([]);
      await refreshWorkflowViews();
    } catch (err) { toast.error(err.response?.data?.error || 'Bulk update failed'); }
  };

  const handleMoveStage = async (appId, newStage, rejectionReason = null) => {
    if (newStage === 'HRRejected' && !rejectionReason) {
      setPendingRejection({ mode: 'single', applicationId: appId, status: newStage });
      return;
    }
    try {
      await applicationsAPI.moveStage(appId, {
        stage: newStage,
        rejection_reason: rejectionReason || undefined,
        comment: rejectionReason || undefined,
      });
      toast.success('Stage updated');
      await refreshWorkflowViews(candidateDetail?.id === appId ? appId : null);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to move stage'); }
  };

  const handleMoveJob = async (appId, targetJobId) => {
    try {
      await applicationsAPI.moveJob(appId, { target_job_id: targetJobId });
      toast.success('Moved to new job');
      await refreshWorkflowViews(candidateDetail?.id === appId ? appId : null);
    } catch { toast.error('Failed to move to job'); }
  };

  const loadOpenJobs = async () => {
    try {
      const res = await jobsAPI.list({ status: 'open', limit: 100 });
      setOpenJobs((res.data?.jobs || []).filter(j => j.id !== parseInt(id)));
    } catch { setOpenJobs([]); }
  };

  const openReviewSetup = (application) => {
    const existingInterviewers = Array.isArray(application?.interviewers)
      ? application.interviewers
      : [];
    setReviewSetupCandidate(application);
    setReviewSetupForm({
      no_of_rounds: String(application?.no_of_rounds || 1),
      interviewers: [0, 1, 2].map((index) => {
        const roundOwners = Array.isArray(existingInterviewers[index]) ? existingInterviewers[index] : [];
        return roundOwners.join(', ');
      }),
    });
  };

  const updateReviewSetupRound = (roundIndex, value) => {
    setReviewSetupForm((prev) => ({
      ...prev,
      interviewers: prev.interviewers.map((item, index) => (
        index === roundIndex ? value : item
      )),
    }));
  };

  const submitReviewSetup = async () => {
    if (!reviewSetupCandidate) return;
    const roundCount = Number(reviewSetupForm.no_of_rounds || 0);
    if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > 3) {
      toast.error('Set the number of rounds between 1 and 3');
      return;
    }

    const interviewers = reviewSetupForm.interviewers
      .slice(0, roundCount)
      .map((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

    if (!interviewers[0]?.length) {
      toast.error('Assign at least one round 1 reviewer');
      return;
    }

    try {
      setDetailActionLoading(`assign-${reviewSetupCandidate.id}`);
      await applicationsAPI.moveStage(reviewSetupCandidate.id, {
        stage: 'AwaitingHODResponse',
        no_of_rounds: roundCount,
        interviewers,
        comment: 'Candidate shortlisted and routed for HOD review from the workflow screen',
      });
      toast.success('Candidate routed to HOD review');
      setReviewSetupCandidate(null);
      await refreshWorkflowViews(candidateDetail?.id === reviewSetupCandidate.id ? reviewSetupCandidate.id : null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to assign HOD review');
    } finally {
      setDetailActionLoading('');
    }
  };

  const handleBulkUploadExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('job_id', id);
    try {
      const res = await applicationsAPI.bulkUploadExcel(formData);
      toast.success(`Uploaded ${res.data?.count || 0} candidates`);
      loadApplicants();
    } catch { toast.error('Bulk upload failed'); }
    e.target.value = '';
  };

  const handleBulkUploadResumes = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('resumes', f));
    formData.append('job_id', id);
    try {
      const res = await applicationsAPI.bulkUploadResumes(formData);
      toast.success(`Processed ${res.data?.count || 0} resumes`);
      loadApplicants();
    } catch { toast.error('Resume upload failed'); }
    e.target.value = '';
  };

  const daysSince = (dateStr) => {
    if (!dateStr) return '-';
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  };

  const jobTitle = job
    ? [
        job.bu_short_name || job.bu_name,
        job.location_name,
        job.phase_name,
        job.department_name,
        job.job_title,
      ].filter(Boolean).join(' - ')
    : '';
  const totalApplicants = Object.values(stageCounts).reduce((a, b) => a + (b || 0), 0);
  const appTotalPages = Math.ceil(appTotal / 20);
  const daysToTarget = job?.target_hire_date
    ? Math.max(0, Math.floor((new Date(job.target_hire_date).getTime() - Date.now()) / 86400000))
    : '-';
  const positionsRemaining = Math.max(0, Number(job?.total_positions || 0) - Number(job?.filled_positions || 0));

  const submitPendingRejection = async () => {
    if (!selectedRejectionReason) {
      toast.error('Select an HR rejection reason');
      return;
    }
    const pending = pendingRejection;
    setPendingRejection(null);
    setSelectedRejectionReason('');
    if (!pending) return;
    if (pending.mode === 'bulk') {
      await handleBulkStatus(pending.status, selectedRejectionReason);
      return;
    }
    await handleMoveStage(pending.applicationId, pending.status, selectedRejectionReason);
  };

  const renderQueueActions = (application) => {
    const currentTask = getCurrentRoundTask(application);
    const shouldShowSchedule = application.status === 'AwaitingInterviewScheduling' || /^Round\d+$/.test(String(application.status || ''));
    const reviewLabel = application.status === 'AwaitingHODResponse' ? 'Open Review' : 'Open Workflow';

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(`/applications/${application.id}/workflow`)}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          {reviewLabel}
        </button>
        {shouldShowSchedule && (
          <button
            type="button"
            onClick={() => navigate(`/applications/${application.id}/schedule`)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Scheduling
          </button>
        )}
        {currentTask?.id && application.status === 'AwaitingHODResponse' && (
          <button
            type="button"
            onClick={() => navigate(`/interviews/${currentTask.id}/workspace`)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Reviewer Workspace
          </button>
        )}
      </div>
    );
  };

  const renderWorkflowActionButtons = (application) => renderQueueActions(application);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>;
  if (!job) return <div className="text-center py-12 text-gray-500">Job not found</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div>
          <button onClick={() => navigate('/jobs')} className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-flex items-center gap-1">&larr; Back to Jobs</button>
          <h1 className="text-xl font-bold text-gray-900">{jobTitle || `Job #${id}`}</h1>
          <p className="text-sm text-gray-500 mt-1">
            ID: {job.job_id || id} | Created: {job.created_at ? new Date(job.created_at).toLocaleDateString() : 'Not available'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`badge ${job.status === 'open' ? 'bg-emerald-100 text-emerald-700' : job.status === 'closed' ? 'bg-red-100 text-red-700' : job.status === 'draft' ? 'bg-gray-100 text-gray-700' : job.status === 'on_hold' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'}`}>
            {job.status}
          </span>
          <select value={job.status} onChange={e => handleStatusChange(e.target.value)} className="input-field text-sm py-1 w-auto">
            {JOB_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900">{totalApplicants}</p>
          <p className="text-xs text-gray-500">Total Applicants</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-2">By Stage</p>
          <div className="flex gap-0.5 h-4 rounded overflow-hidden">
            {ALL_STAGES.map((stage, i) => {
              const count = stageCounts[stage] || 0;
              if (count === 0) return null;
              const pct = totalApplicants ? (count / totalApplicants) * 100 : 0;
              return <div key={stage} className={`${STAGE_COLORS[i % STAGE_COLORS.length]} relative group`} style={{ width: `${pct}%`, minWidth: count > 0 ? '4px' : 0 }} title={`${stage}: ${count}`}>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">{stage}: {count}</span>
              </div>;
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {ALL_STAGES.map((stage, i) => stageCounts[stage] ? <span key={stage} className="text-xs text-gray-500"><span className={`inline-block w-2 h-2 rounded-full ${STAGE_COLORS[i % STAGE_COLORS.length]} mr-1`}></span>{stage}: {stageCounts[stage]}</span> : null)}
          </div>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900">{daysSince(job.created_at)}</p>
          <p className="text-xs text-gray-500">Days Since Created</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-gray-900">{job.target_hire_date ? daysToTarget : positionsRemaining}</p>
          <p className="text-xs text-gray-500">{job.target_hire_date ? 'Days to Target' : 'Positions Remaining'}</p>
        </div>
      </div>

      <div className="card mb-6 border-indigo-200 bg-indigo-50/70">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="section-title text-indigo-950">How Candidate Movement Works</h3>
            <p className="mt-1 text-sm text-indigo-900">
              Use this page as the hiring control room. HR can only move candidates through the next valid HR step. HOD review, slot suggestion, Teams scheduling, and interviewer feedback happen from Interview Hub.
            </p>
          </div>
          <button onClick={() => navigate('/interviews')} className="btn-secondary whitespace-nowrap">
            Open Interview Hub
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-5">
          {[
            ['1. Screen', 'Move candidates from InQueue or Applied into Shortlisted, or reject with a reason.'],
            ['2. Assign Review', 'From Shortlisted, assign round count and round 1 reviewers to route the candidate to HOD review.'],
            ['3. Suggest Slots', 'HODs or interviewers review the profile in Interview Hub and suggest time slots or reject before the interview.'],
            ['4. Schedule & Teams', 'HR confirms the interview from Interview Hub or the candidate workflow panel, which blocks the calendar and adds the Teams link when Microsoft sync is available.'],
            ['5. Offer & Join', 'After final selection, request documents, start the offer, and move the candidate into accepted, dropout, or joined states.'],
          ].map(([title, text]) => (
            <div key={title} className="rounded-xl border border-indigo-100 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-indigo-950">{title}</p>
              <p className="mt-2 text-sm text-gray-600">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative" ref={addMenuRef}>
          <button onClick={() => setShowAddMenu(!showAddMenu)} className="btn-primary">+ Add Candidate</button>
          {showAddMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 w-56">
              <button onClick={() => { setShowAddMenu(false); navigate(`/jobs/${id}/add-candidate`); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">Single Candidate</button>
              <button onClick={() => { setShowAddMenu(false); navigate(`/jobs/${id}/bulk-upload?type=excel`); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">
                Bulk from Excel
              </button>
              <button onClick={() => { setShowAddMenu(false); navigate(`/jobs/${id}/bulk-upload?type=resumes`); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">
                Bulk from Resumes
              </button>
              <button onClick={() => { setShowAddMenu(false); navigate(`/talent-pool?target_job_id=${id}`); }} className="block w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">Import from Talent Pool</button>
            </div>
          )}
        </div>
        <button onClick={handleGenerateQR} className="btn-secondary">QR Code</button>
        <button onClick={handleShareLink} className="btn-secondary">Share Link</button>
        <button onClick={handleExport} className="btn-secondary">Export</button>
        <button onClick={() => navigate(`/jobs/${id}/edit`)} className="btn-secondary">Edit</button>
        <button onClick={handleArchive} className="btn-secondary text-red-600 hover:text-red-700">Archive</button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {[['applicants', 'Workflow Queue'], ['stages', 'Pipeline View'], ['settings', 'Job Settings']].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
          ))}
        </nav>
      </div>

      {/* All Applicants Tab */}
      {activeTab === 'applicants' && (
        <div>
          <div className="flex flex-col md:flex-row gap-3 mb-4">
            <input type="text" placeholder="Search by name, email, phone..." value={appSearch} onChange={e => { setAppSearch(e.target.value); setAppPage(1); }} className="input-field flex-1" />
            <select value={appStatusFilter} onChange={e => { setAppStatusFilter(e.target.value); setAppPage(1); }} className="input-field w-auto">
              <option value="">All Statuses</option>
              {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{selectedIds.length} selected</span>
                <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  Open candidates in the guided workflow to move them through the hiring journey.
                </span>
              </div>
            )}
          </div>
          <div className="card overflow-visible">
            {appLoading ? (
              <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div></div>
            ) : applicants.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">No applicants found</p>
            ) : (
              <div className="table-container">
                <table className="w-full">
                  <thead>
                    <tr className="table-header">
                      <th className="px-3 py-3 w-10"><input type="checkbox" checked={selectedIds.length === applicants.length && applicants.length > 0} onChange={toggleSelectAll} className="rounded" /></th>
                      <th className="px-3 py-3 cursor-pointer" onClick={() => handleSort('candidate_name')}>Name {appSortBy === 'candidate_name' && (appSortOrder === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-3 py-3">Email</th>
                      <th className="px-3 py-3">Phone</th>
                      <th className="px-3 py-3 cursor-pointer" onClick={() => handleSort('status')}>Status {appSortBy === 'status' && (appSortOrder === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-3 py-3">Source</th>
                      <th className="px-3 py-3 cursor-pointer" onClick={() => handleSort('created_at')}>Applied {appSortBy === 'created_at' && (appSortOrder === 'asc' ? '↑' : '↓')}</th>
                      <th className="px-3 py-3">Recruiter</th>
                      <th className="px-3 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applicants.map(app => (
                      <tr key={app.id} className="table-row">
                        <td className="px-3 py-3"><input type="checkbox" checked={selectedIds.includes(app.id)} onChange={() => toggleSelect(app.id)} className="rounded" /></td>
                        <td className="px-3 py-3 font-medium text-sm text-gray-900">{app.candidate_name}</td>
                        <td className="px-3 py-3 text-sm text-gray-600">{app.candidate_email}</td>
                        <td className="px-3 py-3 text-sm text-gray-600">{app.candidate_phone || '-'}</td>
                        <td className="px-3 py-3">
                          <div className="space-y-1">
                            <span className={`badge ${STATUS_COLORS[app.status] || 'bg-gray-100 text-gray-700'}`}>{app.status}</span>
                            {app.rejection_reason && (
                              <p className="text-xs text-red-600">{app.rejection_reason}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600">{app.source || '-'}</td>
                        <td className="px-3 py-3 text-sm text-gray-500">{new Date(app.created_at).toLocaleDateString()}</td>
                        <td className="px-3 py-3 text-sm text-gray-600">{app.recruiter_email || '-'}</td>
                        <td className="px-3 py-3 relative overflow-visible">
                          <div className="space-y-2">
                            {renderQueueActions(app)}
                            <button onClick={() => navigate(`/jobs/${id}/candidates/${app.id}/edit`)} className="text-xs text-gray-600 hover:text-gray-800">Edit Candidate</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {appTotalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">Showing {(appPage - 1) * 20 + 1}-{Math.min(appPage * 20, appTotal)} of {appTotal}</p>
              <div className="flex gap-2">
                <button onClick={() => setAppPage(p => Math.max(1, p - 1))} disabled={appPage === 1} className="btn-secondary text-sm py-1 disabled:opacity-50">Previous</button>
                <span className="text-sm text-gray-500 py-1">Page {appPage} / {appTotalPages}</span>
                <button onClick={() => setAppPage(p => Math.min(appTotalPages, p + 1))} disabled={appPage === appTotalPages} className="btn-secondary text-sm py-1 disabled:opacity-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stage View Tab (Kanban) */}
      {activeTab === 'stages' && (
        <div className="grid gap-4 pb-4 md:grid-cols-2 2xl:grid-cols-3">
          {WORKFLOW_LANES.map((lane, idx) => {
            const stageApps = applicants.filter(a => lane.statuses.includes(a.status));
            const count = stageApps.length;
            return (
              <div key={lane.key} className="min-w-0">
                <div className={`rounded-t-lg px-3 py-2 ${STAGE_COLORS[idx % STAGE_COLORS.length]} bg-opacity-20`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">{lane.label}</h3>
                    <span className="text-xs font-bold text-gray-600 bg-white bg-opacity-60 rounded-full px-2 py-0.5">{count}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{lane.description}</p>
                </div>
                <div className="bg-gray-50 rounded-b-lg min-h-[200px] p-2 space-y-2 border border-gray-200 border-t-0">
                  {stageApps.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">No candidates</p>
                  ) : (
                    stageApps.map(app => (
                      <div key={app.id} className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer" onClick={() => openCandidateDetail(app.id)}>
                        <p className="text-sm font-medium text-gray-900 break-words">{app.candidate_name}</p>
                        <p className="text-xs text-gray-500 break-all">{app.candidate_email}</p>
                        <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[app.status] || 'bg-gray-100 text-gray-700'}`}>
                          {app.status}
                        </span>
                        {app.rejection_reason && (
                          <p className="mt-1 text-xs text-red-600 whitespace-normal break-words">{app.rejection_reason}</p>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-gray-400">{app.source || '-'}</span>
                          <span className="text-xs text-gray-400">{new Date(app.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">{renderQueueActions(app)}</div>
                          <button
                            onClick={e => { e.stopPropagation(); openCandidateDetail(app.id); }}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            Open Workflow
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="card max-w-2xl">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Job Settings</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Designation</label><p className="text-sm text-gray-900">{job.job_title || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Department</label><p className="text-sm text-gray-900">{job.department_name || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Location</label><p className="text-sm text-gray-900">{job.location_name || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Business Unit</label><p className="text-sm text-gray-900">{job.bu_name || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Grade</label><p className="text-sm text-gray-900">{job.grade || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Job Type</label><p className="text-sm text-gray-900">{job.job_type || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Sub Department</label><p className="text-sm text-gray-900">{job.sub_department_name || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Phase</label><p className="text-sm text-gray-900">{job.phase_name || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Recruiter</label><p className="text-sm text-gray-900">{job.recruiter_email || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Secondary Recruiter</label><p className="text-sm text-gray-900">{job.secondary_recruiter_email || '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Total Positions</label><p className="text-sm text-gray-900">{job.total_positions || 0}</p></div>
            </div>
            <hr className="border-gray-200" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Description</label>
              <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">{job.job_description || 'No description'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Min Compensation</label><p className="text-sm text-gray-900">{job.compensation_min != null ? `${job.compensation_currency || 'INR'} ${job.compensation_min}` : '-'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Compensation</label><p className="text-sm text-gray-900">{job.compensation_max != null ? `${job.compensation_currency || 'INR'} ${job.compensation_max}` : '-'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label><p className="text-sm text-gray-900">{job.publish_to_careers ? 'Public careers page' : 'Internal only'}</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Positions Remaining</label><p className="text-sm text-gray-900">{positionsRemaining}</p></div>
            </div>
            <div className="pt-2">
              <button onClick={() => navigate(`/jobs/${id}/edit`)} className="btn-primary">Edit Job Details</button>
            </div>
          </div>
        </div>
      )}

      {candidateDetail && (
        <div className="app-modal-backdrop" onClick={() => setCandidateDetail(null)}>
          <div className="app-modal-panel app-modal-panel-full" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-header">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">
                    {candidateDetail.candidate_name || 'Candidate Review'}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {candidateDetail.application_id || candidateDetail.id} {candidateDetail.job_title ? `| ${candidateDetail.job_title}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {candidateDetail.status && (
                    <span className={`badge ${STATUS_COLORS[candidateDetail.status] || 'bg-gray-100 text-gray-700'}`}>
                      {candidateDetail.status}
                    </span>
                  )}
                  <button onClick={() => setCandidateDetail(null)} className="btn-secondary text-sm">Close</button>
                </div>
              </div>
            </div>

            <div className="app-modal-body overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
              {candidateDetailLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">Workflow Tracker</h4>
                        <p className="mt-1 text-sm text-gray-500">
                          The candidate is currently in <strong>{candidateDetail.status}</strong>. Move them using the next valid action instead of jumping across stages.
                        </p>
                      </div>
                      <button onClick={() => openInterviewHub(candidateDetail, 'review')} className="btn-secondary text-sm">
                        Interview Hub
                      </button>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-5">
                      {getWorkflowProgress(candidateDetail.status).map((lane) => (
                        <div
                          key={lane.key}
                          className={`rounded-xl border px-4 py-3 ${
                            lane.state === 'active'
                              ? 'border-indigo-300 bg-indigo-50'
                              : lane.state === 'done'
                                ? 'border-emerald-200 bg-emerald-50'
                                : 'border-gray-200 bg-white'
                          }`}
                        >
                          <p className="text-sm font-semibold text-gray-900">{lane.label}</p>
                          <p className="mt-1 text-sm text-gray-600">{lane.description}</p>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                            {lane.state === 'active' ? lane.currentStatus : lane.state}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr,0.9fr]">
                    <div className="space-y-6">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">Candidate Snapshot</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {[
                            ['Email', candidateDetail.candidate_email],
                            ['Phone', candidateDetail.candidate_phone],
                            ['Source', candidateDetail.source],
                            ['Added By', candidateDetail.created_by],
                            ['Recruiter', candidateDetail.recruiter_email],
                            ['Experience', candidateDetail.candidate_years_of_experience != null ? `${candidateDetail.candidate_years_of_experience} years` : '-'],
                            ['Current Organization', candidateDetail.current_organization],
                            ['Current Location', candidateDetail.current_location],
                            ['Current CTC', candidateDetail.current_ctc != null ? `INR ${candidateDetail.current_ctc}` : '-'],
                            ['Education', candidateDetail.education_level || candidateDetail.education_other || '-'],
                            ['Gender', candidateDetail.candidate_gender || '-'],
                            ['No. of Rounds', candidateDetail.no_of_rounds || '-'],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
                              <p className="mt-1 text-sm text-gray-800">{value || '-'}</p>
                            </div>
                          ))}
                        </div>
                        {candidateDetail.rejection_reason && (
                          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">Rejection Reason</p>
                            <p className="mt-1 text-sm text-red-700">{candidateDetail.rejection_reason}</p>
                          </div>
                        )}
                        {(candidateDetail.suggested_interview_datetime1 || candidateDetail.suggested_interview_datetime2) && (
                          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Suggested Slots</p>
                            <div className="mt-1 space-y-1 text-sm text-amber-800">
                              {candidateDetail.suggested_interview_datetime1 && <p>{new Date(candidateDetail.suggested_interview_datetime1).toLocaleString()}</p>}
                              {candidateDetail.suggested_interview_datetime2 && <p>{new Date(candidateDetail.suggested_interview_datetime2).toLocaleString()}</p>}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <h4 className="text-sm font-semibold text-gray-900">Resume</h4>
                          {candidateDetail.resume_path && (
                            <a href={candidateDetail.resume_path} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:text-indigo-800">
                              Open Resume
                            </a>
                          )}
                        </div>
                        {candidateDetail.resume_path ? (
                          renderInlinePreview(candidateDetail.resume_path, candidateDetail.resume_file_name || candidateDetail.candidate_name || 'Resume') || (
                            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                              Inline preview is available for PDF and image resumes. Open the resume in a new tab for this file type.
                            </div>
                          )
                        ) : (
                          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                            No resume uploaded yet.
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <h4 className="text-sm font-semibold text-gray-900">Interview Workflow</h4>
                          <span className="text-xs text-gray-500">{candidateDetail.interview_feedback?.length || 0} task(s)</span>
                        </div>
                        {!candidateDetail.interview_feedback?.length ? (
                          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                            Interview tasks will appear here as soon as the candidate is moved into a round with task assignees.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {candidateDetail.interview_feedback.map((task) => (
                              <div key={task.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">Round {task.round_number}</p>
                                    <p className="text-xs text-gray-500">{task.interviewer_email}</p>
                                  </div>
                                  <span className={`badge ${STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-700'}`}>
                                    {String(task.status || 'scheduled').replace(/_/g, ' ')}
                                  </span>
                                </div>
                                <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-2">
                                  <p>Scheduled: {task.scheduled_datetime ? new Date(task.scheduled_datetime).toLocaleString() : 'Not scheduled yet'}</p>
                                  <p>Decision: {task.decision || 'Pending'}</p>
                                </div>
                                {task.calendar_sync_status && (
                                  <p className="mt-2 text-xs text-gray-500">
                                    Calendar sync: {String(task.calendar_sync_status).replace(/_/g, ' ')}
                                  </p>
                                )}
                                {task.meeting_join_url && (
                                  <a
                                    href={task.meeting_join_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex text-sm font-medium text-emerald-700 hover:text-emerald-800"
                                  >
                                    Join Teams meeting
                                  </a>
                                )}
                                {task.remarks && <p className="mt-2 text-sm text-gray-600">{task.remarks}</p>}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => openScheduleModal(task, candidateDetail)}
                                    disabled={detailActionLoading === `schedule-${task.id || task._id}`}
                                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                                  >
                                    {task.scheduled_datetime ? 'Reschedule & Teams' : 'Confirm Schedule & Teams'}
                                  </button>
                                  <button
                                    onClick={() => openInterviewHub(candidateDetail, 'review')}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                  >
                                    Open in Interview Hub
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                        <h4 className="text-sm font-semibold text-indigo-950">Next Valid Actions</h4>
                        <p className="mt-1 text-sm text-indigo-900">
                          This is the operational guide for the current stage. Use these actions in order so the next owner sees the right task in the right page.
                        </p>
                        <div className="mt-4 space-y-3">
                          {renderWorkflowActionButtons(candidateDetail)}
                          {candidateDetail.status === 'AwaitingInterviewScheduling' && (
                            <div className="rounded-lg border border-indigo-100 bg-white px-3 py-3">
                              <p className="text-sm font-semibold text-gray-900">Next scheduling step</p>
                              <p className="mt-1 text-sm text-gray-600">
                                Round {getNextRoundNumber(candidateDetail)} is waiting for HR confirmation. Open the Interview Workflow card below or use Interview Hub to block the calendar and create the Teams meeting.
                              </p>
                            </div>
                          )}
                          {candidateDetail.status === 'AwaitingHODResponse' && (
                            <div className="rounded-lg border border-indigo-100 bg-white px-3 py-3">
                              <p className="text-sm font-semibold text-gray-900">Awaiting HOD action</p>
                              <p className="mt-1 text-sm text-gray-600">
                                The assigned HOD or interviewer should open Interview Hub, review the candidate, and either suggest two time slots or reject with reasons before the interview.
                              </p>
                            </div>
                          )}
                          {candidateDetail.status === 'Selected' && (
                            <div className="rounded-lg border border-indigo-100 bg-white px-3 py-3">
                              <p className="text-sm font-semibold text-gray-900">Selection completed</p>
                              <p className="mt-1 text-sm text-gray-600">
                                Start offer processing, request the required documents, and keep the candidate inside the document workflow on this page.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <h4 className="text-sm font-semibold text-gray-900">Candidate Documents</h4>
                          <span className="text-xs text-gray-500">{candidateDetail.candidate_documents?.length || 0} item(s)</span>
                        </div>

                        {DOC_FLOW_STATUSES.has(candidateDetail.status) && (
                          <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                            <p className="text-sm font-semibold text-indigo-900">Request documents from this screen</p>
                            <div className="mt-3 space-y-3">
                              <select
                                value={documentRequest.stage}
                                onChange={(e) => setDocumentRequest((prev) => ({ ...prev, stage: e.target.value }))}
                                className="input-field w-full text-sm"
                              >
                                {DOC_STAGE_OPTIONS.map((stage) => (
                                  <option key={stage.value} value={stage.value}>{stage.label}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={documentRequest.document_name}
                                onChange={(e) => setDocumentRequest((prev) => ({ ...prev, document_name: e.target.value }))}
                                className="input-field w-full text-sm"
                                placeholder="Document name"
                              />
                              <textarea
                                value={documentRequest.description}
                                onChange={(e) => setDocumentRequest((prev) => ({ ...prev, description: e.target.value }))}
                                className="input-field w-full text-sm"
                                rows={3}
                                placeholder="Describe what the candidate should upload"
                              />
                              <button
                                onClick={handleRequestDocument}
                                disabled={detailActionLoading === 'request-doc'}
                                className="btn-primary w-full text-sm disabled:opacity-50"
                              >
                                {detailActionLoading === 'request-doc' ? 'Requesting...' : 'Request Document'}
                              </button>
                            </div>
                          </div>
                        )}

                        {!candidateDetail.candidate_documents?.length ? (
                          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                            No documents have been requested yet.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {candidateDetail.candidate_documents.map((document) => (
                              <div key={document.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">{document.document_name}</p>
                                    <p className="text-xs text-gray-500">
                                      {String(document.stage || '').replace(/_/g, ' ')} | {document.status}
                                    </p>
                                  </div>
                                  {document.file_path && (
                                    <a href={document.file_path} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:text-indigo-800">
                                      Open File
                                    </a>
                                  )}
                                </div>
                                {document.description && <p className="mt-2 text-sm text-gray-600">{document.description}</p>}
                                {document.rejection_reason && (
                                  <p className="mt-2 text-sm text-red-600">{document.rejection_reason}</p>
                                )}
                                {document.file_path && (
                                  <div className="mt-3">
                                    {renderInlinePreview(document.file_path, document.file_name || document.document_name) || (
                                      <div className="rounded-lg border border-dashed border-gray-300 px-3 py-5 text-sm text-gray-500">
                                        Inline preview is available for PDF and image files. Open the file in a new tab for this file type.
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {document.status === 'uploaded' && (
                                    <>
                                      <button
                                        onClick={() => handleReviewDocument(document, 'accepted')}
                                        disabled={detailActionLoading === `review-${document.id}-accepted`}
                                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                      >
                                        Accept
                                      </button>
                                      <button
                                        onClick={() => handleReviewDocument(document, 'rejected')}
                                        disabled={detailActionLoading === `review-${document.id}-rejected`}
                                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}
                                  {(document.status === 'pending' || document.status === 'rejected') && (
                                    <>
                                      <button
                                        onClick={() => handleRemindCandidate(document)}
                                        disabled={detailActionLoading === `remind-${document.id}`}
                                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                                      >
                                        Quick Reminder
                                      </button>
                                      <button
                                        onClick={() => setDocumentReminderModal(document)}
                                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                      >
                                        AI Reminder
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {scheduleModal && (
        <AppModal
          open={!!scheduleModal}
          onClose={() => setScheduleModal(null)}
          title="Confirm Interview Schedule"
          subtitle={`Finalize the confirmed slot for Round ${scheduleModal.interviewTask.round_number}. This updates the ATS stage and attempts Microsoft calendar and Teams sync.`}
          footer={(
            <>
              <button onClick={() => setScheduleModal(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={submitScheduleModal}
                disabled={detailActionLoading === `schedule-${scheduleModal.interviewTask.id || scheduleModal.interviewTask._id}`}
                className="btn-primary disabled:opacity-50"
              >
                {detailActionLoading === `schedule-${scheduleModal.interviewTask.id || scheduleModal.interviewTask._id}`
                  ? 'Scheduling...'
                  : 'Confirm Schedule & Teams'}
              </button>
            </>
          )}
          width="wide"
        >
          <div className="space-y-5">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{scheduleModal.application?.candidate_name || candidateDetail?.candidate_name}</p>
                <p className="mt-1 text-sm text-gray-500">{scheduleModal.interviewTask.interviewer_email}</p>
              </div>

              {scheduleModal.suggestedSlots?.length > 0 && (
                <div>
                  <div className="mb-3">
                    <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                      Pick from reviewer suggestions
                      <InfoTip text="Choosing a suggestion fills the final confirmation field below. You can still override it manually before sending the invite." />
                    </label>
                    <select
                      value={scheduleForm.source_slot}
                      onChange={(event) => {
                        const slot = scheduleModal.suggestedSlots.find((_, index) => String(index + 1) === event.target.value);
                        if (!slot) {
                          setScheduleForm((prev) => ({ ...prev, source_slot: '' }));
                          return;
                        }
                        setScheduleForm((prev) => ({
                          ...prev,
                          source_slot: event.target.value,
                          datetime: toDatetimeLocalValue(slot),
                          reason: prev.reason || 'Confirmed from reviewer-suggested slot.',
                        }));
                      }}
                      className="input-field"
                    >
                      <option value="">Select a suggested slot</option>
                      {scheduleModal.suggestedSlots.map((slot, index) => (
                        <option key={`${slot}-${index}`} value={String(index + 1)}>
                          {`Suggested slot ${index + 1} · ${formatDateTime(slot)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Suggested slots from reviewer</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {scheduleModal.suggestedSlots.map((slot, index) => (
                      <button
                        key={`${slot}-${index}`}
                        type="button"
                        onClick={() => setScheduleForm((prev) => ({ ...prev, datetime: toDatetimeLocalValue(slot), source_slot: String(index + 1) }))}
                        className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                          scheduleForm.datetime === toDatetimeLocalValue(slot)
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-200 hover:bg-indigo-50/50'
                        }`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Suggested</p>
                        <p className="mt-1 text-sm font-medium">{formatDateTime(slot)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Confirmed interview date & time</label>
                <input
                  type="datetime-local"
                  value={scheduleForm.datetime}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, datetime: e.target.value, source_slot: '' }))}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Scheduling note</label>
                <textarea
                  rows={3}
                  value={scheduleForm.reason}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, reason: e.target.value }))}
                  className="input-field w-full"
                  placeholder="Add a note for the schedule update"
                />
              </div>
            </div>
        </AppModal>
      )}

      {/* QR Code Modal */}
      {showQR && (
        <AppModal
          open={showQR}
          onClose={() => setShowQR(false)}
          title="QR Code"
          subtitle="Share or download the live public job-opening link for this role."
          width="compact"
        >
          <div className="text-center">
            {qrData?.qr_code ? (
              <div className="text-center">
                <img src={qrData.qr_code} alt="QR Code" className="mx-auto w-48 h-48 border rounded-lg" />
                <p className="text-sm text-gray-500 mt-3">Scan to apply for this job</p>
                <a href={qrData.qr_code} download={`qr-job-${id}.png`} className="btn-primary mt-4 inline-block">Download QR Code</a>
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">QR code generated. Share the application link below:</p>
            )}
            <div className="mt-4 flex items-center gap-2">
              <input type="text" readOnly value={qrData?.url || `${window.location.origin}/careers/${job?.id || id}`} className="input-field text-xs flex-1" />
              <button onClick={() => { navigator.clipboard.writeText(qrData?.url || `${window.location.origin}/careers/${job?.id || id}`); toast.success('Copied'); }} className="btn-secondary text-sm py-1">Copy</button>
            </div>
            <button
              type="button"
              onClick={() => window.open(qrData?.url || `${window.location.origin}/careers/${job?.id || id}`, '_blank', 'noopener,noreferrer')}
              className="btn-secondary mt-4"
            >
              Open Public Job Page
            </button>
          </div>
        </AppModal>
      )}

      {pendingRejection && (
        <AppModal
          open={!!pendingRejection}
          onClose={() => { setPendingRejection(null); setSelectedRejectionReason(''); }}
          title="HR Rejection Reason"
          subtitle="Choose a rejection reason before moving the candidate to HRRejected."
          width="wide"
          footer={(
            <>
              <button onClick={() => { setPendingRejection(null); setSelectedRejectionReason(''); }} className="btn-secondary">Cancel</button>
              <button onClick={submitPendingRejection} className="btn-primary">Confirm Rejection</button>
            </>
          )}
        >
          <select
            value={selectedRejectionReason}
            onChange={(e) => setSelectedRejectionReason(e.target.value)}
            className="input-field w-full"
          >
            <option value="">Select rejection reason</option>
            {rejectionReasons.map((reason) => (
              <option key={reason.id} value={reason.reason}>{reason.reason}</option>
            ))}
          </select>
        </AppModal>
      )}

      {reviewSetupCandidate && (
        <AppModal
          open={!!reviewSetupCandidate}
          onClose={() => setReviewSetupCandidate(null)}
          title="Assign HOD Review & Interview Rounds"
          subtitle="This is the handoff from HR screening to HOD review. The assigned round 1 owners will see the candidate in Interview Hub and can suggest slots or reject before the interview."
          width="wide"
          footer={(
            <>
              <button onClick={() => setReviewSetupCandidate(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={submitReviewSetup}
                disabled={detailActionLoading === `assign-${reviewSetupCandidate.id}`}
                className="btn-primary disabled:opacity-50"
              >
                {detailActionLoading === `assign-${reviewSetupCandidate.id}` ? 'Routing...' : 'Route to HOD Review'}
              </button>
            </>
          )}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">{reviewSetupCandidate.candidate_name}</p>
              <p className="mt-1 text-sm text-gray-500">{reviewSetupCandidate.candidate_email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Number of Rounds</label>
              <select
                value={reviewSetupForm.no_of_rounds}
                onChange={(e) => setReviewSetupForm((prev) => ({ ...prev, no_of_rounds: e.target.value }))}
                className="input-field w-full"
              >
                {[1, 2, 3].map((round) => (
                  <option key={round} value={round}>{round} round{round > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              {Array.from({ length: Number(reviewSetupForm.no_of_rounds || 1) }).map((_, index) => (
                <div key={index}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Round {index + 1} owners
                  </label>
                  <input
                    type="text"
                    value={reviewSetupForm.interviewers[index] || ''}
                    onChange={(e) => updateReviewSetupRound(index, e.target.value)}
                    className="input-field w-full"
                    placeholder="hod1@premierenergies.com, interviewer2@premierenergies.com"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Separate multiple owners with commas. Round 1 owners are mandatory.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </AppModal>
      )}

      <EmailComposerModal
        open={!!documentReminderModal}
        onClose={() => setDocumentReminderModal(null)}
        title="Draft Document Reminder"
        subtitle="Draft and send a richer reminder for the requested document without leaving the candidate workflow."
        recipients={[candidateDetail?.candidate_email].filter(Boolean)}
        draftContext={{
          purpose: 'documents',
          context: {
            candidate_name: candidateDetail?.candidate_name,
            document_name: documentReminderModal?.document_name,
            recruiter_email: candidateDetail?.recruiter_email,
            job_title: candidateDetail?.job_title,
            requested_by: documentReminderModal?.requested_by,
          },
          defaultPrompt: documentReminderModal
            ? `Draft a polished reminder asking ${candidateDetail?.candidate_name || 'the candidate'} to upload ${documentReminderModal.document_name}. Mention why it is needed and ask them to complete it promptly in the ATS.`
            : '',
        }}
        onSend={sendDocumentReminder}
        sending={emailSending}
      />

      {id && (
        <section className="mt-6 rounded-[28px] border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="section-title mb-4">Job Timeline & TAT</h2>
          <Timeline entityType="job" entityId={id} />
        </section>
      )}
    </div>
  );
}
