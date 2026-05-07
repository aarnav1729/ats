import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { applicationsAPI, candidatesAPI, interviewsAPI, jobsAPI, mastersAPI, orgAPI, candidatePortalAPI, ctcBreakupAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import EmailAutocompleteTags from '../components/EmailAutocompleteTags';
import InfoTip from '../components/InfoTip';
import CTCPasteTable from '../components/CTCPasteTable';
import RichClipboardEditor from '../components/RichClipboardEditor';
import CtcAdminReviewModal from '../components/CtcAdminReviewModal';
import Timeline from '../components/Timeline';
import haptic from '../utils/haptic';

const CLEARANCE_STATUS_LABELS = {
  pending: 'Pending Primary Review',
  secondary_review: 'Awaiting Secondary Recruiter',
  hr_review: 'Awaiting HR Admin Review',
  approved: 'Approved',
  rejected: 'Rejected',
  renegotiation: 'Renegotiation Required',
  cxo_review: 'Awaiting CXO Approval',
};

const CLEARANCE_STATUS_STYLES = {
  pending: 'bg-gray-100 text-gray-700',
  secondary_review: 'bg-blue-100 text-blue-700',
  hr_review: 'bg-violet-100 text-violet-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  renegotiation: 'bg-amber-100 text-amber-700',
  cxo_review: 'bg-orange-100 text-orange-700',
};
import {
  REJECTED_STATUSES,
  getCurrentRoundTask,
  getPrimaryWorkflowAction,
  getSecondaryWorkflowActions,
  getStatusMeta,
  getWorkflowProgress,
} from '../workflow/applicationWorkflow';

const STATUS_BADGES = {
  InQueue: 'bg-gray-100 text-gray-700',
  Applied: 'bg-blue-100 text-blue-700',
  Shortlisted: 'bg-indigo-100 text-indigo-700',
  AwaitingHODResponse: 'bg-violet-100 text-violet-700',
  AwaitingInterviewScheduling: 'bg-amber-100 text-amber-700',
  Round1: 'bg-sky-100 text-sky-700',
  Round2: 'bg-blue-100 text-blue-700',
  Round3: 'bg-indigo-100 text-indigo-700',
  AwaitingFeedback: 'bg-fuchsia-100 text-fuchsia-700',
  Selected: 'bg-emerald-100 text-emerald-700',
  OfferInProcess: 'bg-orange-100 text-orange-700',
  Offered: 'bg-teal-100 text-teal-700',
  OfferAccepted: 'bg-green-100 text-green-700',
  OfferRejected: 'bg-red-100 text-red-700',
  OfferDropout: 'bg-rose-100 text-rose-700',
  Joined: 'bg-green-200 text-green-800',
  HRRejected: 'bg-red-100 text-red-700',
  HODRejected: 'bg-red-100 text-red-700',
  Round1Rejected: 'bg-red-100 text-red-700',
  Round2Rejected: 'bg-red-100 text-red-700',
  Round3Rejected: 'bg-red-100 text-red-700',
};

const DOCUMENT_STAGES = [
  { value: 'before_offer_release', label: 'Before Offer Release' },
  { value: 'after_offer_release', label: 'After Offer Release' },
  { value: 'after_offer_acceptance', label: 'After Offer Acceptance' },
  { value: 'before_joining', label: 'Before Joining' },
  { value: 'joining_day', label: 'Joining Day' },
  { value: 'after_joining', label: 'After Joining' },
];

function formatDateTime(value) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

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

function normalizeJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getJobRoundDefaults(application) {
  const assignments = normalizeJsonObject(application?.job_interviewer_emails);
  const flow = normalizeJsonArray(application?.job_hiring_flow);
  const assignmentRoundCount = Object.keys(assignments).reduce((max, key) => {
    const number = Number(String(key).replace(/^Round/i, ''));
    return Number.isInteger(number) && number > 0 ? Math.max(max, number) : max;
  }, 0);
  const flowRoundCount = flow.filter((stage) => /interview|round/i.test(String(stage || ''))).length;
  const roundCount = Math.max(assignmentRoundCount, flowRoundCount, 1);
  const interviewers = Array.from({ length: 3 }, (_, index) => {
    const roundNumber = index + 1;
    const raw = assignments[roundNumber]
      ?? assignments[String(roundNumber)]
      ?? assignments[`Round${roundNumber}`]
      ?? [];
    return (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map((email) => ({ label: email, email, source: 'job' }));
  });
  return { roundCount, interviewers };
}

function buildRoundPlanFromApplication(application) {
  const normalized = Array.from({ length: 3 }, () => []);
  const storedRounds = Array.isArray(application?.interviewers) ? application.interviewers : [];
  const hasStoredRounds = storedRounds.some((round) => Array.isArray(round) && round.length > 0);

  if (hasStoredRounds) {
    return {
      no_of_rounds: String(Math.max(Number(application?.no_of_rounds || 1), 1)),
      interviewers: normalized.map((_, index) => {
        const raw = Array.isArray(storedRounds[index]) ? storedRounds[index] : [];
        return raw.map((email) => ({ label: email, email, source: 'manual' }));
      }),
    };
  }

  const jobDefaults = getJobRoundDefaults(application);
  jobDefaults.interviewers.forEach((items, index) => {
    normalized[index] = items;
  });

  const tasks = Array.isArray(application?.interview_feedback) ? application.interview_feedback : [];
  let highestRound = 0;
  tasks.forEach((task) => {
    const round = Math.max(1, Math.min(3, Number(task?.round_number || 1)));
    if (!task?.interviewer_email) return;
    highestRound = Math.max(highestRound, round);
    const exists = normalized[round - 1].some((item) => item.email === task.interviewer_email);
    if (!exists) {
      normalized[round - 1].push({
        label: task.interviewer_email,
        email: task.interviewer_email,
        source: 'manual',
      });
    }
  });

  return {
    no_of_rounds: String(Math.max(Number(application?.no_of_rounds || highestRound || jobDefaults.roundCount || 1), 1)),
    interviewers: normalized,
  };
}

function WorkflowHero({ application, nextOwner, primaryAction }) {
  const meta = getStatusMeta(application?.status);
  return (
    <div className="workspace-hero animate-fade-in-up">
      <div className="grid gap-6 xl:grid-cols-[1.12fr,0.88fr] xl:items-start">
        <div>
          <div className="utility-strip">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${STATUS_BADGES[application?.status] || 'bg-gray-100 text-gray-700'}`}>
              {application?.status || 'Unknown'}
            </span>
            <span className="utility-chip">Owner · {nextOwner || meta.owner}</span>
            {primaryAction?.label ? <span className="action-required-badge">Action ready</span> : null}
          </div>
          <h1 className="page-title mt-4">{application?.candidate_name || 'Candidate Workflow'}</h1>
          <p className="page-subtitle mt-3 max-w-3xl">
            {meta.summary}
          </p>
          <div className="mt-6 fact-grid">
            {[
              ['Application', application?.application_id || application?.id],
              ['Role', application?.job_title || application?.ats_job_id || 'Role not linked'],
              ['Source', application?.source || 'Not captured'],
              ['Interview Plan', `${application?.no_of_rounds || 0} round(s)`],
            ].map(([label, value]) => (
              <div key={label} className="fact-card">
                <p className="workspace-kicker">{label}</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="focus-panel">
          <p className="workspace-kicker">Current routing</p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{nextOwner || meta.owner}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Keep the record moving from one accountable desk to the next without modal-hopping or hidden row actions.
              </p>
            </div>
            <div className="rounded-[22px] border border-[rgba(29,33,41,0.08)] bg-white/80 px-4 py-3 shadow-sm">
              <p className="workspace-kicker">Recommended</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{primaryAction?.label || 'Monitor current owner activity'}</p>
            </div>
          </div>

          <div className="mt-5 fact-grid">
            <div className="fact-card">
              <p className="workspace-kicker">Candidate Contact</p>
              <a href={`mailto:${application?.candidate_email}`} className="mt-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 block">{application?.candidate_email || 'Email not captured'}</a>
              <a href={`tel:${application?.candidate_phone}`} className="mt-1 text-sm text-slate-500 hover:text-slate-700 block">{application?.candidate_phone || 'Phone not captured'}</a>
            </div>
            <div className="fact-card">
              <p className="workspace-kicker">Recruiter Owner</p>
              <a href={`mailto:${application?.recruiter_email}`} className="mt-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 block">{application?.recruiter_email || 'Unassigned'}</a>
              <p className="mt-1 text-sm text-slate-500">{application?.created_by || 'Creator not captured'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageRail({ status }) {
  const progress = getWorkflowProgress(status);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Pipeline</p>
        <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{status || 'Unknown'}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {progress.map((lane) => (
          <div
            key={lane.key}
            className={`flex-shrink-0 px-3 py-2 rounded-lg border ${
              lane.state === 'active'
                ? 'border-indigo-300 bg-indigo-50'
                : lane.state === 'done'
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-200 bg-gray-50'
            }`}
          >
            <p className={`text-[10px] font-semibold uppercase ${
              lane.state === 'active' ? 'text-indigo-600' : lane.state === 'done' ? 'text-green-600' : 'text-gray-500'
            }`}>
              {lane.state === 'active' ? '● Active' : lane.state === 'done' ? '✓ Done' : '○'}
            </p>
            <p className="mt-1 text-xs font-medium text-gray-900 whitespace-nowrap">{lane.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ApplicationWorkflow() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejectionReasons, setRejectionReasons] = useState([]);
  const [openJobs, setOpenJobs] = useState([]);
  const [actionLoading, setActionLoading] = useState('');
  const [roundPlan, setRoundPlan] = useState({
    no_of_rounds: '1',
    interviewers: [[/* round 1 */], [], []],
  });
  const [screeningDecision, setScreeningDecision] = useState({
    rejection_reason: '',
  });
  const [documentRequest, setDocumentRequest] = useState({
    stage: DOCUMENT_STAGES[0].value,
    document_name: '',
    description: '',
  });
  const [documentReviewNotes, setDocumentReviewNotes] = useState({});
  const [clearance, setClearance] = useState(null);
  const [clearanceLoading, setClearanceLoading] = useState(false);
  const [ctcTable, setCtcTable] = useState({ rows: [] });
  const [aopInline, setAopInline] = useState(true);
  const [aopExceededAmount, setAopExceededAmount] = useState('');
  const [clearanceComments, setClearanceComments] = useState('');
  const [cxoEmail, setCxoEmail] = useState('');
  const [ctcEmailBody, setCtcEmailBody] = useState('');
  const [secondaryRecruiterEmail, setSecondaryRecruiterEmail] = useState('');
  const [ctcBreakups, setCtcBreakups] = useState([]);
  const [ctcComparisons, setCtcComparisons] = useState([]);
  // CTC review state - R2 clearance + HR admin all-view modal trigger.
  const [ctcAdminModalOpen, setCtcAdminModalOpen] = useState(false);
  const [r2Notes, setR2Notes] = useState('');
  const [r2Busy, setR2Busy] = useState(false);
  const [ctcBreakupLoading, setCtcBreakupLoading] = useState(false);
  const [ctcBreakupHtml, setCtcBreakupHtml] = useState('');
  const [ctcBreakupText, setCtcBreakupText] = useState('');
  const [ctcBreakupAttachment, setCtcBreakupAttachment] = useState(null);
  const [ctcComparisonHtml, setCtcComparisonHtml] = useState('');
  const [ctcComparisonText, setCtcComparisonText] = useState('');
  const [ctcComparisonAttachment, setCtcComparisonAttachment] = useState(null);
  const [disposition, setDisposition] = useState({
    target_job_id: '',
    ban_scope: 'global',
    ban_role: '',
    ban_reason: '',
  });
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'schedule' ? 'schedule' : 'workflow');
  const [scheduleForm, setScheduleForm] = useState({ datetime: '', note: '', meeting_link: '' });
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  const handleScheduleSlot = async (slotDatetime) => {
    if (!slotDatetime) return;
    const roundNum = getCurrentRoundTask(application)?.round_number || 1;
    setScheduleSubmitting(true);
    try {
      await applicationsAPI.moveStage(id, {
        stage: `Round${roundNum}`,
        scheduled_datetime: new Date(slotDatetime).toISOString(),
        meeting_link: scheduleForm.meeting_link || null,
        note: scheduleForm.note || null,
      });
      toast.success('Interview scheduled successfully');
      setScheduleForm({ datetime: '', note: '', meeting_link: '' });
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to schedule');
    } finally {
      setScheduleSubmitting(false);
    }
  };

  const handleQuickSchedule = async () => {
    if (!scheduleForm.datetime) return;
    const roundNum = getCurrentRoundTask(application)?.round_number || 1;
    setScheduleSubmitting(true);
    try {
      await applicationsAPI.moveStage(id, {
        stage: `Round${roundNum}`,
        scheduled_datetime: new Date(scheduleForm.datetime).toISOString(),
        meeting_link: scheduleForm.meeting_link || null,
        note: scheduleForm.note || null,
      });
      toast.success('Interview scheduled');
      setScheduleForm({ datetime: '', note: '', meeting_link: '' });
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to schedule');
    } finally {
      setScheduleSubmitting(false);
    }
  };

  const activeInterviewTask = useMemo(() => getCurrentRoundTask(application), [application]);
  const requestedRoundExtension = useMemo(() => {
    const tasks = Array.isArray(application?.interview_feedback) ? application.interview_feedback : [];
    return tasks.find((task) => Number(task.requested_additional_rounds || 0) > 0) || null;
  }, [application?.interview_feedback]);
  const effectiveSecondaryRecruiterEmail = secondaryRecruiterEmail
    || application?.secondary_recruiter_email
    || application?.job_secondary_recruiter_email
    || '';
  const primaryAction = useMemo(() => getPrimaryWorkflowAction(application), [application]);
  const secondaryActions = useMemo(() => getSecondaryWorkflowActions(application), [application]);
  const needsInterviewPlanning = useMemo(
    () => Boolean(
      application
      && (
        application.status === 'Shortlisted'
        || (application.status === 'AwaitingHODResponse' && !activeInterviewTask)
        || requestedRoundExtension
      )
    ),
    [activeInterviewTask, application, requestedRoundExtension]
  );
  const nextOwner = useMemo(() => {
    if (!application) return '';
    if (application.status === 'AwaitingHODResponse') return 'Assigned HOD / interviewer';
    if (application.status === 'AwaitingInterviewScheduling') return 'Recruiter scheduling desk';
    if (/^Round\d+$/.test(String(application.status || ''))) return 'Recruiter and assigned interviewer';
    if (application.status === 'Selected') return 'Recruiter offer desk';
    return getStatusMeta(application.status).owner;
  }, [application]);

  const loadClearance = async (appId) => {
    try {
      const res = await candidatesAPI.getClearance(appId || id);
      const c = res.data?.clearance;
      setClearance(c);
      if (c?.ctc_data) {
        const parsed = typeof c.ctc_data === 'string' ? JSON.parse(c.ctc_data) : c.ctc_data;
        // Accept both new shape { rows: [[]] } and legacy flat object
        if (parsed && Array.isArray(parsed.rows)) {
          setCtcTable(parsed);
        } else if (parsed && typeof parsed === 'object') {
          // Migrate legacy flat object -> two-column rows (label / value)
          const rows = Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]);
          setCtcTable({ rows: rows.length ? [['Field', 'Value'], ...rows] : [] });
        }
      }
      if (c) {
        setAopInline(c.aop_inline !== false);
        setAopExceededAmount(c.aop_exceeded_amount || '');
      }
    } catch { /* clearance may not exist yet */ }
  };

  const loadCtcBreakups = async (appId) => {
    try {
      const res = await ctcBreakupAPI.all(appId || id);
      setCtcBreakups(res.data?.breakups || []);
      setCtcComparisons(res.data?.comparisons || []);
    } catch { /* breakups may not exist yet */ }
  };

  const handleSendCtcBreakup = async () => {
    if (!ctcBreakupHtml.trim()) {
      toast.error('Please enter the CTC breakup HTML table');
      return;
    }
    try {
      setCtcBreakupLoading(true);
      const formData = new FormData();
      formData.append('breakup_html', ctcBreakupHtml);
      formData.append('breakup_text', ctcBreakupText || ctcBreakupHtml.replace(/<[^>]*>/g, '').trim());
      if (ctcBreakupAttachment) formData.append('attachment', ctcBreakupAttachment);
      await ctcBreakupAPI.setBreakup(application.id, formData);
      toast.success('CTC breakup sent to candidate for signature');
      setCtcBreakupAttachment(null);
      loadCtcBreakups(application.id);
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send CTC breakup');
    } finally {
      setCtcBreakupLoading(false);
    }
  };

  const handleSendCtcComparison = async () => {
    if (!ctcComparisonHtml.trim()) {
      toast.error('Please enter the CTC comparison HTML table');
      return;
    }
    if (!effectiveSecondaryRecruiterEmail.trim()) {
      toast.error('Assign or enter recruiter 2 before sending');
      return;
    }
    try {
      setCtcBreakupLoading(true);
      const formData = new FormData();
      formData.append('comparison_html', ctcComparisonHtml);
      formData.append('comparison_text', ctcComparisonText || ctcComparisonHtml.replace(/<[^>]*>/g, '').trim());
      formData.append('secondary_recruiter_email', effectiveSecondaryRecruiterEmail);
      if (ctcComparisonAttachment) formData.append('attachment', ctcComparisonAttachment);
      await ctcBreakupAPI.setComparison(application.id, formData);
      toast.success('CTC comparison sent to recruiter 2');
      setCtcComparisonAttachment(null);
      loadCtcBreakups(application.id);
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send CTC comparison');
    } finally {
      setCtcBreakupLoading(false);
    }
  };

  const refresh = async () => {
    const res = await applicationsAPI.get(id);
    setApplication(res.data);
    setRoundPlan(buildRoundPlanFromApplication(res.data));
    loadClearance(id);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [appRes, reasonsRes, jobsRes] = await Promise.all([
          applicationsAPI.get(id),
          mastersAPI.list('rejection-reasons', { limit: 200 }).catch(() => ({ data: [] })),
          jobsAPI.list({ status: 'open', limit: 200 }).catch(() => ({ data: { jobs: [] } })),
        ]);
        setApplication(appRes.data);
        setRoundPlan(buildRoundPlanFromApplication(appRes.data));
        const items = Array.isArray(reasonsRes.data) ? reasonsRes.data : reasonsRes.data?.items || reasonsRes.data?.data || [];
        setRejectionReasons(items.filter((item) => item.active_flag !== false));
        setOpenJobs((jobsRes.data?.jobs || []).filter((job) => String(job.job_id) !== String(appRes.data?.ats_job_id)));
        setSecondaryRecruiterEmail(appRes.data?.secondary_recruiter_email || appRes.data?.job_secondary_recruiter_email || '');
        loadClearance(id);
        loadCtcBreakups(id);
      } catch (err) {
        const detail = err?.response?.data?.error || err?.message || 'Unknown error';
        console.error('Candidate workflow load error:', err);
        toast.error(`Failed to load candidate workflow: ${detail}`);
        // Don't force-navigate - let the user see the error and try again.
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, navigate]);

  const handleTransition = async (nextStatus, extra = {}) => {
    if (!application) return;
    try {
      setActionLoading(nextStatus);
      await applicationsAPI.moveStage(application.id, {
        stage: nextStatus,
        ...extra,
      });
      haptic.success();
      toast.success(`Candidate moved to ${nextStatus}`);
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to update candidate stage');
    } finally {
      setActionLoading('');
    }
  };

  const handleRouteToReview = async () => {
    const roundCount = Number(roundPlan.no_of_rounds || 0);
    const interviewers = roundPlan.interviewers
      .slice(0, roundCount)
      .map((items) => items.map((item) => item.email).filter(Boolean));

    if (!interviewers[0]?.length) {
      haptic.warning();
      toast.error('Assign at least one reviewer for round 1');
      return;
    }

    await handleTransition('AwaitingHODResponse', {
      no_of_rounds: roundCount,
      interviewers,
      comment: 'Candidate routed for reviewer pre-screening from the workflow page',
    });
  };

  const handleApproveAdditionalRounds = async () => {
    const roundCount = Number(roundPlan.no_of_rounds || 0);
    const interviewers = roundPlan.interviewers
      .slice(0, roundCount)
      .map((items) => items.map((item) => item.email).filter(Boolean));
    if (!interviewers[0]?.length) {
      haptic.warning();
      toast.error('Assign at least one reviewer for round 1');
      return;
    }

    try {
      setActionLoading('approve-round-request');
      await applicationsAPI.updateInterviewPlan(application.id, {
        no_of_rounds: roundCount,
        interviewers,
      });
      haptic.success();
      toast.success('Interview plan updated');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to update the interview plan');
    } finally {
      setActionLoading('');
    }
  };

  const handleRequestDocument = async () => {
    if (!application?.id || !documentRequest.document_name.trim()) {
      haptic.warning();
      toast.error('Document name is required');
      return;
    }

    try {
      setActionLoading('request-document');
      await candidatesAPI.createDocRequest(application.id, {
        stage: documentRequest.stage,
        document_name: documentRequest.document_name.trim(),
        description: documentRequest.description.trim(),
      });
      haptic.success();
      toast.success('Document request sent to candidate');
      setDocumentRequest((prev) => ({ ...prev, document_name: '', description: '' }));
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to request document');
    } finally {
      setActionLoading('');
    }
  };

  const handleInviteToPortal = async () => {
    if (!application?.id) return;
    try {
      setActionLoading('invite-portal');
      await candidatePortalAPI.invite(application.id);
      haptic.success();
      toast.success('Portal invite emailed to candidate');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to invite candidate');
    } finally {
      setActionLoading('');
    }
  };

  const handleRequestCtc = async () => {
    if (!application?.id) return;
    const ctcText = ctcTable?.text || '';
    if (!ctcText.trim()) {
      toast.error('Populate the CTC table before requesting acceptance');
      return;
    }
    const message = window.prompt('Optional message to candidate (context for the CTC):', '') || '';
    try {
      setActionLoading('request-ctc');
      await candidatePortalAPI.requestCtc(application.id, { ctc_text: ctcText, message });
      haptic.success();
      toast.success('CTC acceptance request sent to candidate');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to request CTC acceptance');
    } finally {
      setActionLoading('');
    }
  };

  const handleReviewDocument = async (document, status) => {
    const rejectionReason = status === 'rejected'
      ? String(documentReviewNotes[document.id] || '').trim()
      : '';
    if (status === 'rejected' && !rejectionReason) {
      haptic.warning();
      toast.error(`Add a rejection note for ${document.document_name}`);
      return;
    }

    try {
      setActionLoading(`document-${document.id}-${status}`);
      await candidatesAPI.reviewDocument(application.id, document.id, {
        status,
        rejection_reason: status === 'rejected' ? rejectionReason : undefined,
      });
      setDocumentReviewNotes((prev) => ({ ...prev, [document.id]: '' }));
      haptic.success();
      toast.success(`Document ${status}`);
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to review document');
    } finally {
      setActionLoading('');
    }
  };

  const handleRemindCandidate = async (document) => {
    try {
      setActionLoading(`remind-document-${document.id}`);
      await candidatesAPI.remind(application.id, document.id);
      haptic.notify();
      toast.success('Reminder sent');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to send reminder');
    } finally {
      setActionLoading('');
    }
  };

  const handleKeepInTalentPool = async () => {
    try {
      setActionLoading('keep-pool');
      await applicationsAPI.keepInTalentPool(application.id);
      haptic.success();
      toast.success('Candidate moved back into the reusable talent pool');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to keep candidate in talent pool');
    } finally {
      setActionLoading('');
    }
  };

  const handleDeleteProfile = async () => {
    if (!window.confirm('Remove this candidate from active workflows?')) return;
    try {
      setActionLoading('delete-profile');
      await applicationsAPI.delete(application.id);
      haptic.success();
      toast.success('Candidate removed from active workflows');
      navigate('/talent-pool');
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to remove candidate');
    } finally {
      setActionLoading('');
    }
  };

  const handleBanProfile = async () => {
    if (!disposition.ban_reason.trim()) {
      haptic.warning();
      toast.error('Ban reason is required');
      return;
    }

    try {
      setActionLoading('ban-profile');
      await applicationsAPI.ban(application.id, {
        scope: disposition.ban_scope,
        role_name: disposition.ban_scope === 'role' ? disposition.ban_role : undefined,
        reason: disposition.ban_reason.trim(),
      });
      haptic.success();
      toast.success('Candidate ban saved');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to ban candidate');
    } finally {
      setActionLoading('');
    }
  };

  const handleSubmitClearance = async () => {
    try {
      setClearanceLoading(true);
      await candidatesAPI.submitClearance(application.id, {
        ctc_data: ctcTable,
        ctc_text: ctcTable?.text || '',
        aop_inline: aopInline,
        aop_exceeded_amount: aopInline ? 0 : Number(aopExceededAmount) || 0,
        secondary_recruiter_email: effectiveSecondaryRecruiterEmail || undefined,
      });
      haptic.success();
      toast.success('Clearance submitted for secondary review');
      await refresh();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to submit clearance';
      haptic.error();
      if (err.response?.data?.needs_secondary_recruiter) {
        toast.error('Assign a secondary recruiter first');
      } else {
        toast.error(msg);
      }
    } finally {
      setClearanceLoading(false);
    }
  };

  const handleClearanceAction = async (action, extra = {}) => {
    try {
      setClearanceLoading(true);
      const finalComments = [clearanceComments, action === 'hr_send_to_cxo' ? ctcEmailBody : '']
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join('\n\n');

      await candidatesAPI.clearanceAction(application.id, {
        action,
        comments: finalComments,
        cxo_email: cxoEmail,
        ctc_data: ctcTable,
        ctc_text: ctcTable?.text || '',
        ...extra,
      });
      haptic.success();
      toast.success(`Clearance action '${action.replace(/_/g, ' ')}' completed`);
      setClearanceComments('');
      if (action === 'hr_send_to_cxo') setCtcEmailBody('');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to perform clearance action');
    } finally {
      setClearanceLoading(false);
    }
  };

  const handleAssignSecondaryRecruiter = async () => {
    if (!secondaryRecruiterEmail.trim()) {
      haptic.warning();
      toast.error('Enter the secondary recruiter email');
      return;
    }
    try {
      setClearanceLoading(true);
      await applicationsAPI.update(application.id, { secondary_recruiter_email: secondaryRecruiterEmail.trim() });
      haptic.success();
      toast.success('Secondary recruiter assigned');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to assign secondary recruiter');
    } finally {
      setClearanceLoading(false);
    }
  };

  const handleMoveToJob = async () => {
    if (!disposition.target_job_id) {
      haptic.warning();
      toast.error('Select the destination job');
      return;
    }

    try {
      setActionLoading('move-job');
      await applicationsAPI.moveJob(application.id, { target_job_id: disposition.target_job_id });
      haptic.success();
      toast.success('Candidate moved to the selected job');
      await refresh();
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to move candidate to another job');
    } finally {
      setActionLoading('');
    }
  };

  const handleInterviewReminder = async (recipientType) => {
    if (!activeInterviewTask?.id) return;
    try {
      setActionLoading(`reminder-${recipientType}`);
      await interviewsAPI.remind(activeInterviewTask.id, {
        recipient_type: recipientType,
        note: `Reminder sent from the candidate workflow for ${application.candidate_name}.`,
      });
      haptic.notify();
      toast.success('Reminder sent');
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to send reminder');
    } finally {
      setActionLoading('');
    }
  };

  const openInterviewWorkspace = () => {
    haptic.light();
    if (!activeInterviewTask?.id) {
      navigate('/interviews');
      return;
    }
    navigate(`/interviews/${activeInterviewTask.id}/workspace`);
  };

  const openSchedulingWorkspace = () => {
    haptic.light();
    navigate(`/applications/${application.id}/workflow`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!application) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500">Candidate workflow not found.</div>;
  }

  return (
    <div className="workspace-shell">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => { haptic.light(); navigate(-1); }} className="btn-secondary">
          Back
        </button>
        <div className="flex flex-wrap gap-2">
          {activeInterviewTask && (
            <button onClick={openInterviewWorkspace} className="btn-secondary">
              Open Reviewer Workspace
            </button>
          )}
          {(application.status === 'AwaitingInterviewScheduling' || /^Round\d+$/.test(String(application.status || ''))) && (
            <button onClick={openSchedulingWorkspace} className="btn-primary">
              Open Scheduling Workspace
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('workflow')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'workflow'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Workflow
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'schedule'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Schedule & Interview
        </button>
      </div>

      {activeTab === 'workflow' && (
      <>
      <WorkflowHero application={application} nextOwner={nextOwner} primaryAction={primaryAction} />
      <StageRail status={application.status} />

      {/* Action Center - Shows primary action based on status */}
      <div className="mt-6 mb-4">
        {application.status === 'OfferInProcess' && (
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl border border-indigo-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Next Step</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Finalize salary, send offer letter</p>
                <p className="mt-1 text-sm text-gray-500">Mark as "Offer Released" when candidate has verbally accepted</p>
              </div>
              <div className="flex flex-col gap-2">
                <button type="button" onClick={() => handleTransition('Offered')} disabled={actionLoading === 'Offered'} className="btn-primary whitespace-nowrap">
                  {actionLoading === 'Offered' ? 'Processing...' : 'Mark Offer Released'}
                </button>
                <button type="button" onClick={() => handleTransition('OfferRejected')} disabled={actionLoading === 'OfferRejected'} className="text-xs text-red-600 hover:text-red-800 font-medium">
                  Not Moving Forward
                </button>
              </div>
            </div>
          </div>
        )}
        {application.status === 'Selected' && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Start Offer Process</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Collect documents, prepare CTC</p>
                <p className="mt-1 text-sm text-gray-500">Documents needed before creating offer letter</p>
              </div>
              <button type="button" onClick={() => handleTransition('DocumentsInProgress')} className="btn-primary whitespace-nowrap">
                Start Document Collection
              </button>
            </div>
          </div>
        )}
        {application.status === 'DocumentsInProgress' && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Document Collection</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{application.candidate_documents?.filter(d => d.status === 'accepted').length || 0} of {application.candidate_documents?.length || 0} documents cleared</p>
                <p className="mt-1 text-sm text-gray-500">Upload accepted documents to candidate portal</p>
              </div>
              <button type="button" onClick={() => handleTransition('DocumentsCleared')} className="btn-primary whitespace-nowrap">
                Mark Documents Cleared
              </button>
            </div>
          </div>
        )}
        {['InQueue', 'Applied'].includes(application.status) && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-amber-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-amber-600">HR Screening</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Review profile, decide on next steps</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => handleTransition(application.status === 'InQueue' ? 'Applied' : 'Shortlisted')} className="btn-primary whitespace-nowrap">
                  {application.status === 'InQueue' ? 'Start Screening' : 'Shortlist'}
                </button>
                <button type="button" onClick={() => setShowRejectModal(true)} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
        {application.status === 'Shortlisted' && application.no_of_rounds == 0 && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Plan Interview</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Set rounds, assign interviewers</p>
              </div>
              <button type="button" onClick={() => setShowPlanRounds(true)} className="btn-primary whitespace-nowrap">
                Plan Interview Process
              </button>
            </div>
          </div>
        )}
        {application.status === 'AwaitingHODResponse' && (
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl border border-purple-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-purple-600">HOD Review</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Waiting for HOD approval</p>
                <p className="mt-1 text-sm text-gray-500">HOD needs to review and approve scheduling</p>
              </div>
              <button type="button" onClick={() => setShowAssignHod(true)} className="btn-primary whitespace-nowrap">
                {application.hod_email ? 'Remind HOD' : 'Assign HOD'}
              </button>
            </div>
          </div>
        )}
        {application.status === 'AwaitingInterviewScheduling' && (
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-2xl border border-cyan-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-cyan-600">Scheduling</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Propose time slots to candidate</p>
              </div>
              <button type="button" onClick={() => navigate(`/interviews?application_id=${application.id}&tab=Needs%20Scheduling`)} className="btn-primary whitespace-nowrap">
                Open Scheduler
              </button>
            </div>
          </div>
        )}
        {['Round1', 'Round2', 'Round3'].includes(application.status) && (
          <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-2xl border border-violet-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-violet-600">Interview {application.status}</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Collect feedback, manage schedule</p>
              </div>
              <button type="button" onClick={() => navigate(`/interviews?application_id=${application.id}&tab=Scheduled`)} className="btn-primary whitespace-nowrap">
                Open Interview Panel
              </button>
            </div>
          </div>
        )}
        {application.status === 'AwaitingFeedback' && (
          <div className="bg-gradient-to-r from-rose-50 to-pink-50 rounded-2xl border border-rose-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-rose-600">Pending Feedback</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Interviewer feedback not yet submitted</p>
              </div>
              <button type="button" onClick={() => navigate(`/interviews?application_id=${application.id}&tab=Scheduled`)} className="btn-primary whitespace-nowrap">
                Remind Interviewer
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="workboard-layout">
        <aside className="workboard-lane workboard-lane-primary">
          <section className="workspace-card panel-hover">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Candidate Dossier</h2>
              </div>
              {application.resume_path && (
                <a href={application.resume_path} target="_blank" rel="noreferrer" className="btn-secondary">
                  Resume
                </a>
              )}
            </div>

            <div className="mt-5 fact-grid">
              {[
                ['Email', application.candidate_email],
                ['Phone', application.candidate_phone],
                ['Source', application.source],
                ['Added By', application.created_by],
                ['Recruiter', application.recruiter_email],
                ['Current Organization', application.current_organization],
                ['Experience', application.candidate_years_of_experience != null ? `${application.candidate_years_of_experience} years` : '-'],
                ['Current Location', application.current_location],
                ['Current CTC', application.current_ctc != null ? `INR ${application.current_ctc}` : '-'],
                ['Education', application.education_level || application.education_other || '-'],
                ['Application Status', application.status],
                ['No. of Rounds', application.no_of_rounds || '-'],
              ].map(([label, value]) => {
                const isEmail = label === 'Email' && value;
                const isPhone = label === 'Phone' && value;
                return (
                  <div key={label} className="fact-card">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</p>
                    {isEmail ? (
                      <a href={`mailto:${value}`} className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800">{value || '-'}</a>
                    ) : isPhone ? (
                      <a href={`tel:${value}`} className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-800">{value || '-'}</a>
                    ) : (
                      <p className="mt-2 text-sm font-medium text-gray-900">{value || '-'}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Resume & Attachments</h3>
                <InfoTip text="Recruiters, HODs, and interviewers should always review the candidate dossier here before scheduling or rejecting." />
              </div>
              {application.resume_path ? (
                <div className="preview-surface">
                  {renderInlinePreview(application.resume_path, application.resume_file_name || application.candidate_name || 'Resume') || (
                    <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                      Inline preview works for PDFs and image resumes. Open the resume in a new tab for other file types.
                    </div>
                  )}
                </div>
              ) : (
                <div className="preview-surface">
                  <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                    No resume is attached yet.
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="bg-gray-50 rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Owner</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{nextOwner || getStatusMeta(application.status).owner}</p>
              </div>
              {application.secondary_recruiter_email && (
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">2nd Recruiter</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{application.secondary_recruiter_email}</p>
                </div>
              )}
            </div>
          </section>
        </aside>

        <div className="workboard-lane">
          <section className="workspace-card panel-hover">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Interview Trail</h2>
                <p className="mt-1 text-sm text-gray-500">Panel progression, calendar sync, round outcomes, and reviewer notes stay centralized here.</p>
              </div>
              {activeInterviewTask?.meeting_join_url && (
                <a href={activeInterviewTask.meeting_join_url} target="_blank" rel="noreferrer" className="btn-secondary">
                  Open Teams Link
                </a>
              )}
            </div>

            {!application.interview_feedback?.length ? (
              <div className="mt-5 rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                Interview tasks will appear here once the candidate is routed into reviewer planning or an active round.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {application.interview_feedback.map((task) => (
                  <div key={task.id} className="decision-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Round {task.round_number}</p>
                        <p className="mt-1 text-sm text-gray-500">{task.interviewer_email}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGES[task.status] || 'bg-gray-100 text-gray-700'}`}>
                        {String(task.status || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Scheduled</p>
                        <p className="mt-1 text-sm text-gray-800">{formatDateTime(task.scheduled_datetime)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Decision</p>
                        <p className="mt-1 text-sm text-gray-800">{task.decision || 'Pending'}</p>
                      </div>
                    </div>
                    {(task.remarks || task.calendar_sync_status) && (
                      <div className="mt-3 rounded-2xl border border-white bg-white px-4 py-3">
                        {task.remarks && <p className="text-sm text-gray-700">{task.remarks}</p>}
                        {task.calendar_sync_status && (
                          <p className="mt-2 text-xs font-medium text-gray-500">
                            Calendar sync: {String(task.calendar_sync_status).replace(/_/g, ' ')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Interview Scheduling - moved up for better flow */}
          {['AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3'].includes(application.status) && (
            <section className="workspace-card panel-hover border-l-4 border-blue-500">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="section-title">Interview Scheduling</h2>
                  <InfoTip text="Confirm a suggested slot or schedule manually" />
                </div>
                {hasRole(['hr_admin', 'hr_recruiter']) && (
                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    Recruiter Action Required
                  </span>
                )}
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {application.suggested_interview_datetime1 && (
                  <button
                    onClick={() => handleScheduleSlot(application.suggested_interview_datetime1)}
                    className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 text-left hover:border-blue-400 hover:bg-blue-100 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded-full bg-blue-600 text-white text-xs px-2 py-0.5">Slot 1</span>
                    </div>
                    <p className="font-semibold text-gray-900">{formatDateTime(application.suggested_interview_datetime1)}</p>
                    <p className="text-sm text-gray-500 mt-1">Click to confirm</p>
                  </button>
                )}
                {application.suggested_interview_datetime2 && (
                  <button
                    onClick={() => handleScheduleSlot(application.suggested_interview_datetime2)}
                    className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 text-left hover:border-blue-400 hover:bg-blue-100 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="rounded-full bg-blue-600 text-white text-xs px-2 py-0.5">Slot 2</span>
                    </div>
                    <p className="font-semibold text-gray-900">{formatDateTime(application.suggested_interview_datetime2)}</p>
                    <p className="text-sm text-gray-500 mt-1">Click to confirm</p>
                  </button>
                )}
                <button
                  onClick={openSchedulingWorkspace}
                  className="rounded-xl border-2 border-dashed border-gray-300 p-4 text-left hover:border-gray-400 hover:bg-gray-50 transition-all"
                >
                  <p className="font-semibold text-gray-700">Add Custom Slot</p>
                  <p className="text-sm text-gray-500 mt-1">Schedule manually</p>
                </button>
              </div>
            </section>
          )}

          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Documents ({application.candidate_documents?.length || 0})</h2>
            </div>

            {['Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'Joined'].includes(application.status) && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-950">Candidate self-service portal</p>
                  <p className="text-xs text-emerald-800 mt-1">
                    {application.portal_user_id
                      ? `Portal account active${application.portal_first_login_at ? ' · candidate has logged in' : ' · awaiting first login'}`
                      : 'Invite the candidate to log in and upload their documents themselves.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleInviteToPortal}
                  disabled={actionLoading === 'invite-portal'}
                  className="btn-secondary whitespace-nowrap disabled:opacity-50"
                >
                  {actionLoading === 'invite-portal'
                    ? 'Sending…'
                    : application.portal_user_id ? 'Resend portal invite' : 'Invite to candidate portal'}
                </button>
              </div>
            )}

            {['Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'Joined'].includes(application.status) && (
              <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-indigo-950">Request a document from this page</p>
                  <InfoTip text="Document requests created here immediately appear on the candidate task page and stay reviewable for HR throughout the journey." />
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[0.26fr,0.32fr,1fr,auto]">
                  <select
                    value={documentRequest.stage}
                    onChange={(event) => setDocumentRequest((prev) => ({ ...prev, stage: event.target.value }))}
                    className="input-field"
                  >
                    {DOCUMENT_STAGES.map((stage) => (
                      <option key={stage.value} value={stage.value}>{stage.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={documentRequest.document_name}
                    onChange={(event) => setDocumentRequest((prev) => ({ ...prev, document_name: event.target.value }))}
                    className="input-field"
                    placeholder="Document name"
                  />
                  <input
                    type="text"
                    value={documentRequest.description}
                    onChange={(event) => setDocumentRequest((prev) => ({ ...prev, description: event.target.value }))}
                    className="input-field"
                    placeholder="Explain what should be uploaded"
                  />
                  <button
                    type="button"
                    onClick={handleRequestDocument}
                    disabled={actionLoading === 'request-document'}
                    className="btn-primary whitespace-nowrap disabled:opacity-50"
                  >
                    {actionLoading === 'request-document' ? 'Requesting...' : 'Request'}
                  </button>
                </div>
              </div>
            )}

            {!application.candidate_documents?.length ? (
              <div className="mt-5 rounded-2xl border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                No documents have been requested yet.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {application.candidate_documents.map((document) => (
                  <div key={document.id} className="decision-card">
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
                    {document.rejection_reason && <p className="mt-2 text-sm text-red-600">{document.rejection_reason}</p>}
                    {document.file_path && (
                      <div className="preview-surface mt-4">
                        {renderInlinePreview(document.file_path, document.file_name || document.document_name) || (
                          <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500">
                            Inline preview works for PDFs and image files. Open the file in a new tab for other formats.
                          </div>
                        )}
                      </div>
                    )}
                    {document.status === 'uploaded' && (
                      <div className="mt-4">
                        <label className="block text-sm font-semibold text-gray-900 mb-2">Rejection note</label>
                        <textarea
                          rows={2}
                          value={documentReviewNotes[document.id] || ''}
                          onChange={(event) => setDocumentReviewNotes((prev) => ({ ...prev, [document.id]: event.target.value }))}
                          className="input-field"
                          placeholder="Only needed if this document should be rejected."
                        />
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {document.status === 'uploaded' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReviewDocument(document, 'accepted')}
                            disabled={actionLoading === `document-${document.id}-accepted`}
                            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewDocument(document, 'rejected')}
                            disabled={actionLoading === `document-${document.id}-rejected`}
                            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(document.status === 'pending' || document.status === 'rejected') && (
                        <button
                          type="button"
                          onClick={() => handleRemindCandidate(document)}
                          disabled={actionLoading === `remind-document-${document.id}`}
                          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                        >
                          Remind Candidate
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Post-Document Clearance Flow */}
          {['Selected', 'DocumentsCleared', 'CTCSent', 'CTCAcceptance', 'CTCAccepted', 'OfferInProcess', 'Offered', 'OfferAccepted', 'Joined'].includes(application.status) && (
            <section className="workspace-card animate-fade-in-up">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="section-title">Document Clearance & CTC Approval</h2>
                  <InfoTip text="Primary recruiter fills the CTC table and clears docs → secondary recruiter verifies → HR admin approves/rejects/renegotiates/sends to CXO." />
                </div>
                {clearance?.status && (
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${CLEARANCE_STATUS_STYLES[clearance.status] || 'bg-gray-100 text-gray-700'}`}>
                    {CLEARANCE_STATUS_LABELS[clearance.status] || clearance.status}
                  </span>
                )}
              </div>

              {/* CTC Breakup - Send to Candidate for Signature
                  Includes SalaryRejected so a rejected version can be edited
                  and resent without re-walking the full CTC chain. */}
              {['Selected', 'DocumentsCleared', 'CTCSent', 'SalaryRejected'].includes(application.status) && hasRole('hr_admin', 'hr_recruiter') && (
                <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-indigo-900">
                      {application.status === 'SalaryRejected' ? 'Resend CTC breakup table' : 'CTC breakup table'}
                    </h3>
                    <InfoTip text="Paste your CTC breakup table directly from Excel - the formatting (cells, colours, alignment) is kept. Candidate signs electronically before we proceed to recruiter 2." />
                  </div>
                  <RichClipboardEditor
                    initialHtml={ctcBreakupHtml}
                    onChange={({ html, text }) => {
                      setCtcBreakupHtml(html);
                      setCtcBreakupText(text);
                    }}
                    placeholder="Copy your breakup from Excel and paste here. Tables, bold, colours and alignment are preserved."
                  />
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-indigo-900 mb-1">Optional attachment</label>
                    <input
                      type="file"
                      onChange={(event) => setCtcBreakupAttachment(event.target.files?.[0] || null)}
                      className="block w-full text-xs text-indigo-900"
                    />
                  </div>
                  {ctcBreakups.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-indigo-900">Version history</p>
                      {ctcBreakups.slice(0, 3).map((b) => (
                        <div key={b.id} className={`rounded-lg border px-3 py-2 text-xs ${b.candidate_decision === 'accepted' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : b.candidate_decision === 'rejected' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                          <span className="font-semibold">v{b.version}</span>
                          <span className="ml-2">{b.candidate_decision || 'Awaiting candidate response'}</span>
                          {b.decision_at && <span className="ml-2 opacity-70">{new Date(b.decision_at).toLocaleString()}</span>}
                          {b.attachment_name && <span className="ml-2 opacity-70">Attachment: {b.attachment_name}</span>}
                          {b.candidate_decision_notes && <p className="mt-1 italic opacity-90">"{b.candidate_decision_notes}"</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleSendCtcBreakup}
                    disabled={ctcBreakupLoading || !ctcBreakupHtml.trim()}
                    className="btn-primary mt-3 disabled:opacity-50"
                  >
                    {ctcBreakupLoading ? 'Sending…' : application.status === 'SalaryRejected' ? 'Resend updated breakup' : 'Send to candidate for signature'}
                  </button>
                </div>
              )}

              {/* Show candidate response if in CTCAcceptance status */}
              {['CTCAcceptance', 'CTCAccepted'].includes(application.status) && ctcBreakups.length > 0 && (
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <h3 className="text-sm font-semibold text-gray-900">CTC Breakup Status</h3>
	                  {ctcBreakups[0]?.candidate_decision === 'accepted' && (
	                    <div className="mt-2 text-sm text-green-700">✓ Candidate has accepted the CTC breakup</div>
	                  )}
                  {ctcBreakups[0]?.candidate_decision === 'rejected' && (
                    <div className="mt-2 text-sm text-red-700">
                      ✗ Candidate has rejected the CTC breakup
                      {ctcBreakups[0]?.candidate_notes && <span className="block mt-1 text-gray-600">Reason: {ctcBreakups[0].candidate_notes}</span>}
	                </div>
	              )}

              {application.status === 'CTCAccepted' && hasRole('hr_admin', 'hr_recruiter') && (
                <div className="mt-5 rounded-2xl border border-teal-200 bg-teal-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-teal-900">CTC comparison table</h3>
                    <InfoTip text="After candidate acceptance, paste the CTC comparison table from Excel and send it to recruiter 2 with an optional attachment." />
                  </div>
                  <RichClipboardEditor
                    initialHtml={ctcComparisonHtml}
                    onChange={({ html, text }) => {
                      setCtcComparisonHtml(html);
                      setCtcComparisonText(text);
                    }}
                    placeholder="Paste the CTC comparison table from Excel. Formatting is preserved."
                  />
                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
                    <div>
                      <label className="block text-xs font-semibold text-teal-900 mb-1">Recruiter 2</label>
                      <EmailAutocompleteTags
                        value={effectiveSecondaryRecruiterEmail
                          ? [{ label: effectiveSecondaryRecruiterEmail, email: effectiveSecondaryRecruiterEmail, source: 'manual' }]
                          : []}
                        onChange={(items) => setSecondaryRecruiterEmail(items[0]?.email || '')}
                        max={1}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-teal-900 mb-1">Optional attachment</label>
                      <input
                        type="file"
                        onChange={(event) => setCtcComparisonAttachment(event.target.files?.[0] || null)}
                        className="block w-full text-xs text-teal-900"
                      />
                    </div>
                  </div>
                  {ctcComparisons.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-teal-900">Comparison history</p>
                      {ctcComparisons.slice(0, 3).map((comparison) => (
                        <div key={comparison.id} className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs text-teal-900">
                          <span className="font-semibold">{new Date(comparison.created_at).toLocaleString()}</span>
                          <span className="ml-2">by {comparison.created_by_email}</span>
                          {comparison.attachment_name && <span className="ml-2 opacity-70">Attachment: {comparison.attachment_name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleSendCtcComparison}
                    disabled={ctcBreakupLoading || !ctcComparisonHtml.trim()}
                    className="btn-primary mt-3 disabled:opacity-50"
                  >
                    {ctcBreakupLoading ? 'Sending…' : 'Send comparison to recruiter 2'}
                  </button>
                </div>
              )}
                  {ctcBreakups[0]?.candidate_decision === null && (
                    <div className="mt-2 text-sm text-amber-700">Waiting for candidate to respond to CTC breakup</div>
                  )}
                </div>
              )}

              {/* ── Recruiter 2 clearance ───────────────────────────────────────
                  Surfaces only when:
                    - candidate has accepted the breakup
                    - a comparison exists (R1 has done their second-table step)
                    - no R2 decision yet
                    - the current user is the secondary recruiter (or hr_admin
                      acting on their behalf)
                  Recruiter 2 can clear → forwards to HR admin, or send back. */}
              {ctcBreakups[0]?.candidate_decision === 'accepted'
                && ctcComparisons.length > 0
                && !ctcBreakups[0]?.r2_decision
                && (hasRole('hr_admin') || (effectiveSecondaryRecruiterEmail && user?.email?.toLowerCase() === effectiveSecondaryRecruiterEmail.toLowerCase())) && (
                <div className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-cyan-900">Recruiter 2 · clear & forward to HR Admin</h3>
                    <InfoTip text="Review the breakup, candidate signature, and comparison table above. Approve to forward to HR Admin, or send back to recruiter 1 with notes." />
                  </div>
                  <p className="text-xs text-cyan-800 mb-3">
                    Confirm the package is consistent (breakup matches comparison, candidate has signed, no missing docs). Approving forwards to HR Admin for final decision.
                  </p>
                  <textarea
                    className="input-field w-full"
                    rows={2}
                    value={r2Notes}
                    onChange={(e) => setR2Notes(e.target.value)}
                    placeholder="Notes (required when sending back)…"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={r2Busy}
                      className="btn-primary disabled:opacity-50"
                      onClick={async () => {
                        setR2Busy(true);
                        try {
                          const { ctcBreakupAPI } = await import('../services/api');
                          await ctcBreakupAPI.r2Clear(application.application_id || id, { decision: 'approved', notes: r2Notes });
                          toast.success('Cleared and forwarded to HR Admin');
                          setR2Notes('');
                          loadCtcBreakups();
                        } catch (err) {
                          toast.error(err.response?.data?.error || 'Failed');
                        } finally { setR2Busy(false); }
                      }}
                    >Clear & forward to HR Admin</button>
                    <button
                      type="button"
                      disabled={r2Busy || !r2Notes.trim()}
                      className="btn-secondary text-rose-700 disabled:opacity-50"
                      onClick={async () => {
                        setR2Busy(true);
                        try {
                          const { ctcBreakupAPI } = await import('../services/api');
                          await ctcBreakupAPI.r2Clear(application.application_id || id, { decision: 'rejected', notes: r2Notes });
                          toast.success('Sent back to recruiter 1');
                          setR2Notes('');
                          loadCtcBreakups();
                        } catch (err) {
                          toast.error(err.response?.data?.error || 'Failed');
                        } finally { setR2Busy(false); }
                      }}
                    >Send back to recruiter 1</button>
                  </div>
                </div>
              )}

              {/* ── HR Admin all-view CTA ──────────────────────────────────────
                  Shows when R2 has cleared and HR admin hasn't decided yet.
                  Opens the comprehensive review modal with approve / reject /
                  renegotiate / forward-to-approvers in one place. */}
              {hasRole('hr_admin')
                && ctcBreakups[0]?.r2_decision === 'approved'
                && !ctcBreakups[0]?.admin_decision && (
                <div className="mt-5 rounded-2xl border border-indigo-300 bg-gradient-to-r from-indigo-50 via-white to-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-indigo-900">CTC awaiting your final decision</h3>
                      <p className="text-xs text-indigo-700 mt-1">
                        Recruiter 2 has cleared this package. Open the review to approve, reject, send back, or forward to approvers.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCtcAdminModalOpen(true)}
                      className="btn-primary whitespace-nowrap"
                    >Open CTC review →</button>
                  </div>
                </div>
              )}

              {/* HR Admin: any time after R2 has cleared - let admin re-open the
                  modal to view history (e.g. after they've already decided). */}
              {hasRole('hr_admin') && ctcBreakups[0]?.admin_decision && (
                <div className="mt-3">
                  <button type="button" className="btn-secondary text-xs" onClick={() => setCtcAdminModalOpen(true)}>
                    View CTC review history ({ctcBreakups[0].admin_decision})
                  </button>
                </div>
              )}

              {ctcAdminModalOpen && (
                <CtcAdminReviewModal
                  application={application}
                  onClose={() => setCtcAdminModalOpen(false)}
                  onChanged={() => { loadCtcBreakups(); loadApplication(); }}
                />
              )}

              {/* Secondary recruiter assignment */}
              {!effectiveSecondaryRecruiterEmail && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">Secondary recruiter required before clearance</p>
                  <div className="mt-3 flex gap-3">
                    <div className="flex-1">
                      <EmailAutocompleteTags
                        value={secondaryRecruiterEmail ? [{ label: secondaryRecruiterEmail, email: secondaryRecruiterEmail, source: 'manual' }] : []}
                        onChange={(items) => setSecondaryRecruiterEmail(items[0]?.email || '')}
                        max={1}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAssignSecondaryRecruiter}
                      disabled={clearanceLoading}
                      className="btn-primary whitespace-nowrap disabled:opacity-50"
                    >
                      Assign
                    </button>
                  </div>
                </div>
              )}

              {effectiveSecondaryRecruiterEmail && (
                <p className="mt-3 text-sm text-gray-500">
                  Secondary recruiter: <span className="font-semibold text-gray-800">{effectiveSecondaryRecruiterEmail}</span>
                </p>
              )}

              {/* Clearance timeline */}
              {clearance && (
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className={`rounded-xl border px-3 py-2 text-center ${clearance.primary_cleared ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Primary</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{clearance.primary_cleared ? 'Cleared' : 'Pending'}</p>
                    {clearance.primary_cleared_by && <p className="text-xs text-gray-500 break-all">{clearance.primary_cleared_by}</p>}
                  </div>
                  <div className={`rounded-xl border px-3 py-2 text-center ${clearance.secondary_cleared ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Secondary</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{clearance.secondary_cleared ? 'Cleared' : 'Pending'}</p>
                    {clearance.secondary_cleared_by && <p className="text-xs text-gray-500 break-all">{clearance.secondary_cleared_by}</p>}
                  </div>
                  <div className={`rounded-xl border px-3 py-2 text-center ${clearance.status === 'approved' ? 'border-green-200 bg-green-50' : clearance.status === 'rejected' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">HR / CXO</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {clearance.status === 'approved' ? 'Approved' : clearance.status === 'rejected' ? 'Rejected' : clearance.status === 'cxo_review' ? 'CXO Review' : 'Pending'}
                    </p>
                    {(clearance.hr_action_by || clearance.cxo_email) && <p className="text-xs text-gray-500 break-all">{clearance.hr_action_by || clearance.cxo_email}</p>}
                  </div>
                </div>
              )}

              {/* HR/CXO comments */}
              {clearance?.hr_comments && (
                <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">HR Comments</p>
                  <p className="mt-1 text-sm text-indigo-900">{clearance.hr_comments}</p>
                </div>
              )}
              {clearance?.cxo_comments && (
                <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">CXO Comments</p>
                  <p className="mt-1 text-sm text-orange-900">{clearance.cxo_comments}</p>
                </div>
              )}

              {/* CTC Table - editable by primary recruiter before clearance or during renegotiation */}
              {(!clearance || clearance.status === 'pending' || clearance.status === 'renegotiation') && hasRole('hr_admin', 'hr_recruiter') && (
                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">CTC Breakup Table</h3>
                    <InfoTip text="Paste the CTC breakup table directly from your Excel sheet - rows and columns are preserved exactly as pasted. Format persists on copy-paste." />
                  </div>
                  <CTCPasteTable
                    value={ctcTable}
                    onChange={setCtcTable}
                    placeholder="Paste the full CTC comparison table from your Excel template - headers, values, all preserved."
                  />

                  <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="aop_flag"
                          checked={aopInline}
                          onChange={() => setAopInline(true)}
                          className="h-4 w-4 text-indigo-600"
                        />
                        <span className="text-sm font-semibold text-gray-900">AOP Inline</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="aop_flag"
                          checked={!aopInline}
                          onChange={() => setAopInline(false)}
                          className="h-4 w-4 text-amber-600"
                        />
                        <span className="text-sm font-semibold text-gray-900">AOP Exceeded</span>
                      </label>
                    </div>
                    {!aopInline && (
                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Exceeded Amount (INR)</label>
                        <input
                          type="number"
                          value={aopExceededAmount}
                          onChange={(e) => setAopExceededAmount(e.target.value)}
                          className="input-field text-sm max-w-xs"
                          placeholder="Amount exceeded"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSubmitClearance}
                    disabled={clearanceLoading || !effectiveSecondaryRecruiterEmail}
                    className="btn-primary mt-4 w-full disabled:opacity-50"
                  >
                    {clearanceLoading ? 'Submitting...' : clearance?.status === 'renegotiation' ? 'Resubmit After Renegotiation' : 'Submit for Secondary Review'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestCtc}
                    disabled={actionLoading === 'request-ctc' || !ctcTable?.text}
                    className="btn-secondary mt-2 w-full disabled:opacity-50"
                    title="Send this CTC table to the candidate for acceptance via their portal"
                  >
                    {actionLoading === 'request-ctc' ? 'Sending…' : 'Send to candidate for CTC acceptance'}
                  </button>
                </div>
              )}

              {/* Read-only CTC display for non-editors or post-submission */}
              {clearance && !['pending', 'renegotiation'].includes(clearance.status) && clearance.ctc_data && (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">CTC Breakup Table (Submitted)</h3>
                  <CTCPasteTable value={ctcTable} readOnly />
                  {!aopInline && clearance.aop_exceeded_amount > 0 && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
                      <p className="text-sm font-semibold text-amber-900">AOP Exceeded by INR {clearance.aop_exceeded_amount}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Secondary Recruiter Action */}
              {clearance?.status === 'secondary_review' && hasRole('hr_admin', 'hr_recruiter') && (
                <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-blue-900">Secondary recruiter: verify documents and CTC table above, then clear</p>
                  <button
                    type="button"
                    onClick={() => handleClearanceAction('secondary_clear')}
                    disabled={clearanceLoading}
                    className="btn-primary mt-3 w-full disabled:opacity-50"
                  >
                    {clearanceLoading ? 'Processing...' : 'Clear as Secondary Recruiter'}
                  </button>
                </div>
              )}

              {/* HR Admin Actions */}
              {clearance?.status === 'hr_review' && hasRole('hr_admin') && (
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                    <p className="text-sm font-semibold text-violet-900 mb-3">HR Admin Decision</p>
                    <textarea
                      rows={3}
                      value={clearanceComments}
                      onChange={(e) => setClearanceComments(e.target.value)}
                      className="input-field text-sm"
                      placeholder="Add comments for your decision..."
                    />
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => handleClearanceAction('hr_approve')}
                        disabled={clearanceLoading}
                        className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleClearanceAction('hr_reject')}
                        disabled={clearanceLoading}
                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => handleClearanceAction('hr_renegotiate')}
                        disabled={clearanceLoading}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Send for Renegotiation
                      </button>
                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          value={ctcEmailBody}
                          onChange={(e) => setCtcEmailBody(e.target.value)}
                          className="input-field text-sm"
                          placeholder="Simple email body for CTC comparison context (will be appended in the CXO escalation message)"
                        />
                        <input
                          type="email"
                          value={cxoEmail}
                          onChange={(e) => setCxoEmail(e.target.value)}
                          className="input-field text-sm"
                          placeholder="CXO email for escalation"
                        />
                        <button
                          type="button"
                          onClick={() => handleClearanceAction('hr_send_to_cxo')}
                          disabled={clearanceLoading || !cxoEmail}
                          className="w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                        >
                          Send to CXO
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* CXO Actions */}
              {clearance?.status === 'cxo_review' && (
                <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <p className="text-sm font-semibold text-orange-900 mb-3">CXO Decision Required</p>
                  <p className="text-sm text-orange-700 mb-3">Sent to: {clearance.cxo_email}</p>
                  <textarea
                    rows={3}
                    value={clearanceComments}
                    onChange={(e) => setClearanceComments(e.target.value)}
                    className="input-field text-sm"
                    placeholder="CXO comments..."
                  />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => handleClearanceAction('cxo_approve')}
                      disabled={clearanceLoading}
                      className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                    >
                      CXO Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClearanceAction('cxo_reject')}
                      disabled={clearanceLoading}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      CXO Reject
                    </button>
                  </div>
                </div>
              )}

              {/* Renegotiation count */}
              {clearance?.renegotiation_count > 0 && (
                <p className="mt-3 text-xs text-gray-500">Renegotiation rounds: {clearance.renegotiation_count}</p>
              )}
            </section>
          )}
        </div>

        <aside className="workboard-lane workboard-lane-aside">
          <section className="focus-panel">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Your Action Item</h2>
              <InfoTip text="Only the next operationally valid step is highlighted here so recruiters do not have to infer the process from row buttons or guesswork." />
            </div>

            <div className={`decision-card decision-card-strong mt-5 ${
              ['InQueue', 'Applied', 'Shortlisted'].includes(application.status) ? 'border-amber-300 bg-amber-50' :
              ['AwaitingHODResponse', 'AwaitingInterviewScheduling'].includes(application.status) ? 'border-blue-300 bg-blue-50' :
              ['Round1', 'Round2', 'Round3', 'AwaitingFeedback'].includes(application.status) ? 'border-purple-300 bg-purple-50' :
              ['Selected', 'DocumentsCleared', 'CTCSent', 'CTCAcceptance', 'CTCAccepted', 'OfferInProcess', 'Offered'].includes(application.status) ? 'border-green-300 bg-green-50' :
              'border-indigo-300 bg-indigo-50'
            }`}>
              <p className={`workspace-kicker ${
                ['InQueue', 'Applied', 'Shortlisted'].includes(application.status) ? 'text-amber-600' :
                ['AwaitingHODResponse', 'AwaitingInterviewScheduling'].includes(application.status) ? 'text-blue-600' :
                ['Round1', 'Round2', 'Round3', 'AwaitingFeedback'].includes(application.status) ? 'text-purple-600' :
                ['Selected', 'DocumentsCleared', 'CTCSent', 'CTCAcceptance', 'CTCAccepted', 'OfferInProcess', 'Offered'].includes(application.status) ? 'text-green-600' :
                'text-indigo-600'
              }`}>
                {['InQueue', 'Applied'].includes(application.status) ? 'HR Screening Stage' :
                 application.status === 'Shortlisted' ? 'Interview Planning Stage' :
                 ['AwaitingHODResponse'].includes(application.status) ? 'HOD Review Stage' :
                 ['AwaitingInterviewScheduling'].includes(application.status) ? 'Scheduling Stage' :
                 ['Round1', 'Round2', 'Round3'].includes(application.status) ? `Interview Round ${application.status.replace('Round', '')}` :
                 application.status === 'AwaitingFeedback' ? 'Feedback Pending' :
                 ['Selected', 'DocumentsCleared'].includes(application.status) ? 'Document Collection' :
                 ['CTCSent', 'CTCAcceptance', 'CTCAccepted'].includes(application.status) ? 'CTC Negotiation' :
                 ['OfferInProcess', 'Offered'].includes(application.status) ? 'Offer Processing' :
                 application.status === 'OfferAccepted' ? 'Joining Process' :
                 'Current Stage'}
              </p>
              <p className="mt-2 text-lg font-semibold text-gray-950">{primaryAction?.label || 'Monitor current owner activity'}</p>
              <p className="mt-2 text-sm text-gray-600">{getStatusMeta(application.status).summary}</p>
            </div>

            <div className="decision-stack mt-5">
              {(application.status === 'InQueue' || application.status === 'Applied') && (
                <>
                  {application.status === 'InQueue' && (
                    <button
                      type="button"
                      onClick={() => handleTransition('Applied')}
                      disabled={actionLoading === 'Applied'}
                      className="btn-primary w-full disabled:opacity-50"
                    >
                      {actionLoading === 'Applied' ? 'Updating...' : 'Start Screening'}
                    </button>
                  )}
                  {application.status === 'Applied' && (
                    <button
                      type="button"
                      onClick={() => handleTransition('Shortlisted')}
                      disabled={actionLoading === 'Shortlisted'}
                      className="btn-primary w-full disabled:opacity-50"
                    >
                      {actionLoading === 'Shortlisted' ? 'Updating...' : 'Shortlist Candidate'}
                    </button>
                  )}
                  <div className="decision-card">
                    <p className="text-sm font-semibold text-gray-900">Alternate decision: reject with reason</p>
                    <select
                      value={screeningDecision.rejection_reason}
                      onChange={(event) => setScreeningDecision({ rejection_reason: event.target.value })}
                      className="input-field mt-3"
                    >
                      <option value="">Select HR rejection reason</option>
                      {rejectionReasons.map((reason) => (
                        <option key={reason.id} value={reason.reason}>{reason.reason}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleTransition('HRRejected', { rejection_reason: screeningDecision.rejection_reason, comment: screeningDecision.rejection_reason })}
                      disabled={actionLoading === 'HRRejected'}
                      className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {actionLoading === 'HRRejected' ? 'Rejecting...' : 'Reject Candidate'}
                    </button>
                  </div>
                </>
              )}

              {needsInterviewPlanning && (
                <div className="decision-card decision-card-strong space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {requestedRoundExtension
                        ? 'Another round was requested'
                        : application.status === 'AwaitingHODResponse'
                          ? 'Assign reviewers before review starts'
                          : 'Plan the interview process'}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      {requestedRoundExtension
                        ? 'Increase the round plan and assign the next reviewers so the candidate can continue without back-and-forth.'
                        : 'Choose the number of rounds and assign reviewers with the same autocomplete behavior recruiters expect in Outlook.'}
                    </p>
                  </div>
                  {requestedRoundExtension && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-amber-950">
                        Reviewer request: {requestedRoundExtension.requested_additional_rounds} more round(s)
                      </p>
                      {requestedRoundExtension.additional_round_request_remarks && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{requestedRoundExtension.additional_round_request_remarks}</p>
                      )}
                    </div>
                  )}
                  <select
                    value={roundPlan.no_of_rounds}
                    onChange={(event) => setRoundPlan((prev) => ({ ...prev, no_of_rounds: event.target.value }))}
                    className="input-field"
                  >
                    {[1, 2, 3].map((round) => (
                      <option key={round} value={round}>{round} round{round > 1 ? 's' : ''}</option>
                    ))}
                  </select>
                  {Array.from({ length: Number(roundPlan.no_of_rounds || 1) }).map((_, index) => (
                    <div key={index}>
                      <div className="mb-2 flex items-center gap-2">
                        <label className="text-sm font-semibold text-gray-900">Round {index + 1} reviewers</label>
                        <InfoTip text="Search by employee name from SPOT EMP. External panel members can still be added by typing an email and pressing Enter." />
                      </div>
                      <EmailAutocompleteTags
                        value={roundPlan.interviewers[index]}
                        onChange={(items) => setRoundPlan((prev) => ({
                          ...prev,
                          interviewers: prev.interviewers.map((existing, position) => (
                            position === index ? items : existing
                          )),
                        }))}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={application.status === 'Shortlisted' ? handleRouteToReview : handleApproveAdditionalRounds}
                    disabled={actionLoading === 'AwaitingHODResponse' || actionLoading === 'approve-round-request'}
                    className="btn-primary w-full disabled:opacity-50"
                  >
                    {application.status === 'Shortlisted'
                      ? (actionLoading === 'AwaitingHODResponse' ? 'Routing...' : 'Route to HOD / Interviewer Review')
                      : (actionLoading === 'approve-round-request' ? 'Saving...' : 'Save Reviewer Plan')}
                  </button>
                </div>
              )}

              {application.status === 'AwaitingHODResponse' && activeInterviewTask && (
                <div className="decision-card">
                  <p className="text-sm font-semibold text-gray-900">Waiting for reviewer action</p>
                  <p className="mt-2 text-sm text-gray-600">
                    The assigned HOD or interviewer must inspect the candidate dossier and either suggest two slots or reject before the interview happens.
                  </p>
                  <button type="button" onClick={openInterviewWorkspace} className="btn-secondary mt-4 w-full">
                    Open Reviewer Workspace
                  </button>
                </div>
              )}

              {application.status === 'AwaitingInterviewScheduling' && (
                <div className="decision-card decision-card-warn">
                  <p className="text-sm font-semibold text-gray-900">Confirm the final interview slot</p>
                  <div className="mt-3 space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    {[application.suggested_interview_datetime1, application.suggested_interview_datetime2].filter(Boolean).map((slot) => (
                      <p key={slot} className="text-sm text-amber-900">{formatDateTime(slot)}</p>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-gray-600">
                    Open the scheduling workspace to choose one of the suggested slots or add a third option after checking with the candidate.
                  </p>
                  <button type="button" onClick={openSchedulingWorkspace} className="btn-primary mt-4 w-full">
                    Open Scheduling Workspace
                  </button>
                </div>
              )}

              {(/^Round\d+$/.test(String(application.status || '')) || application.status === 'AwaitingFeedback') && (
                <div className="decision-card">
                  <p className="text-sm font-semibold text-gray-900">Round is active or awaiting feedback</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Use the scheduling workspace for reminders, Teams updates, and no-show handling. Use the reviewer workspace for feedback or additional-round requests.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <button type="button" onClick={openSchedulingWorkspace} className="btn-primary w-full">
                      Open Scheduling Workspace
                    </button>
                    <button type="button" onClick={openInterviewWorkspace} className="btn-secondary w-full">
                      Open Reviewer Workspace
                    </button>
                  </div>
                </div>
              )}

              {application.status === 'Selected' && (
                <button
                  type="button"
                  onClick={() => handleTransition('OfferInProcess')}
                  disabled={actionLoading === 'OfferInProcess'}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {actionLoading === 'OfferInProcess' ? 'Updating...' : 'Start Offer & Document Collection'}
                </button>
              )}

              {application.status === 'OfferInProcess' && (
                <button
                  type="button"
                  onClick={() => handleTransition('Offered')}
                  disabled={actionLoading === 'Offered'}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {actionLoading === 'Offered' ? 'Updating...' : 'Mark Offer Released'}
                </button>
              )}

              {application.status === 'Offered' && (
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => handleTransition('OfferAccepted')}
                    disabled={actionLoading === 'OfferAccepted'}
                    className="btn-primary w-full disabled:opacity-50"
                  >
                    {actionLoading === 'OfferAccepted' ? 'Updating...' : 'Mark Offer Accepted'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTransition('OfferRejected')}
                    disabled={actionLoading === 'OfferRejected'}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    {actionLoading === 'OfferRejected' ? 'Updating...' : 'Mark Offer Rejected'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTransition('OfferDropout')}
                    disabled={actionLoading === 'OfferDropout'}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {actionLoading === 'OfferDropout' ? 'Updating...' : 'Mark Offer Dropout'}
                  </button>
                </div>
              )}

              {application.status === 'OfferAccepted' && (
                <button
                  type="button"
                  onClick={() => handleTransition('Joined')}
                  disabled={actionLoading === 'Joined'}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {actionLoading === 'Joined' ? 'Updating...' : 'Mark Candidate Joined'}
                </button>
              )}

              {secondaryActions.length > 0 && !['InQueue', 'Applied', 'Shortlisted', 'Offered'].includes(application.status) && (
                <div className="grid gap-2">
                  {secondaryActions.map((action) => (
                    <button
                      key={`${action.nextStatus}-${action.label}`}
                      type="button"
                      onClick={() => handleTransition(action.nextStatus)}
                      className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {activeInterviewTask && (
            <section className="workspace-card panel-hover">
              <div className="flex items-center gap-2">
                <h2 className="section-title">Scheduling & Reminder Desk</h2>
                <InfoTip text="Recruiters should use the scheduling workspace to confirm slots, trigger Teams invites, and handle reschedules. These reminder shortcuts are here so no one gets stuck waiting." />
              </div>
              <div className="mt-4 space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-900">Current round task</p>
                <p className="text-sm text-gray-600">
                  Round {activeInterviewTask.round_number} · {activeInterviewTask.interviewer_email}
                </p>
                {activeInterviewTask.scheduled_datetime && (
                  <p className="text-sm text-gray-600">Scheduled for {formatDateTime(activeInterviewTask.scheduled_datetime)}</p>
                )}
                {activeInterviewTask.meeting_join_url && (
                  <a href={activeInterviewTask.meeting_join_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">
                    Open Teams Link
                  </a>
                )}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleInterviewReminder('candidate')}
                  disabled={actionLoading === 'reminder-candidate'}
                  className="btn-secondary w-full disabled:opacity-50"
                >
                  Remind Candidate
                </button>
                <button
                  type="button"
                  onClick={() => handleInterviewReminder('panel')}
                  disabled={actionLoading === 'reminder-panel'}
                  className="btn-secondary w-full disabled:opacity-50"
                >
                  Remind Interview Panel
                </button>
                <button type="button" onClick={openSchedulingWorkspace} className="btn-primary w-full">
                  Open Scheduling Workspace
                </button>
                <button type="button" onClick={openInterviewWorkspace} className="btn-secondary w-full">
                  Open Reviewer Workspace
                </button>
              </div>
            </section>
          )}

          {requestedRoundExtension && hasRole('hr_admin', 'hr_recruiter') && (
            <section className="workspace-card panel-hover border-amber-200">
              <div className="flex items-center gap-2">
                <h2 className="section-title">Additional Round Requested</h2>
                <InfoTip text="A reviewer has asked for more interview coverage. Update the round plan here and the ATS will create the next round tasks for the recruiter to schedule." />
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {requestedRoundExtension.additional_round_requested_by || 'A reviewer'} requested {requestedRoundExtension.requested_additional_rounds} more round(s).
              </p>
              {requestedRoundExtension.additional_round_request_remarks && (
                <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {requestedRoundExtension.additional_round_request_remarks}
                </div>
              )}
              <div className="mt-4 space-y-4">
                <select
                  value={roundPlan.no_of_rounds}
                  onChange={(event) => setRoundPlan((prev) => ({ ...prev, no_of_rounds: event.target.value }))}
                  className="input-field"
                >
                  {[1, 2, 3].map((round) => (
                    <option key={round} value={round}>{round} total round{round > 1 ? 's' : ''}</option>
                  ))}
                </select>
                {Array.from({ length: Number(roundPlan.no_of_rounds || 1) }).map((_, index) => (
                  <div key={index}>
                    <div className="mb-2 flex items-center gap-2">
                      <label className="text-sm font-semibold text-gray-900">Round {index + 1} reviewers</label>
                      <InfoTip text="You can reuse existing reviewers or add fresh panel members for the newly approved rounds." />
                    </div>
                    <EmailAutocompleteTags
                      value={roundPlan.interviewers[index]}
                      onChange={(items) => setRoundPlan((prev) => ({
                        ...prev,
                        interviewers: prev.interviewers.map((existing, position) => (
                          position === index ? items : existing
                        )),
                      }))}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleApproveAdditionalRounds}
                  disabled={actionLoading === 'approve-round-request'}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {actionLoading === 'approve-round-request' ? 'Updating...' : 'Approve Requested Round Plan'}
                </button>
              </div>
            </section>
          )}

          {REJECTED_STATUSES.has(application.status) && (
            <section className="workspace-card panel-hover">
              <div className="flex items-center gap-2">
                <h2 className="section-title">Post-Interview Disposition</h2>
                <InfoTip text="Rejected or closed candidates should be actively dispositioned so recruiters know whether the profile can be reused, moved, removed, or blocked." />
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Decide whether this profile should stay reusable, move to another open role, be removed from active use, or be banned with a reason.
              </p>

              <div className="mt-5 space-y-5">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">Move to another open job</p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <select
                      value={disposition.target_job_id}
                      onChange={(event) => setDisposition((prev) => ({ ...prev, target_job_id: event.target.value }))}
                      className="input-field flex-1"
                    >
                      <option value="">Select destination job</option>
                      {openJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.job_id} · {job.job_title}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={handleMoveToJob} disabled={actionLoading === 'move-job'} className="btn-primary whitespace-nowrap disabled:opacity-50">
                      Move Candidate
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={handleKeepInTalentPool} disabled={actionLoading === 'keep-pool'} className="btn-secondary w-full disabled:opacity-50">
                    Keep in Talent Pool
                  </button>
                  <button type="button" onClick={handleDeleteProfile} disabled={actionLoading === 'delete-profile'} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                    Delete from Active Workflows
                  </button>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">Ban profile</p>
                  <div className="mt-3 grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        value={disposition.ban_scope}
                        onChange={(event) => setDisposition((prev) => ({ ...prev, ban_scope: event.target.value }))}
                        className="input-field"
                      >
                        <option value="global">Ban across ATS</option>
                        <option value="role">Ban for a role only</option>
                      </select>
                      {disposition.ban_scope === 'role' && (
                        <input
                          type="text"
                          value={disposition.ban_role}
                          onChange={(event) => setDisposition((prev) => ({ ...prev, ban_role: event.target.value }))}
                          className="input-field"
                          placeholder="Role name to restrict"
                        />
                      )}
                    </div>
                    <textarea
                      rows={3}
                      value={disposition.ban_reason}
                      onChange={(event) => setDisposition((prev) => ({ ...prev, ban_reason: event.target.value }))}
                      className="input-field"
                      placeholder="Why should this profile be banned?"
                    />
                    <button type="button" onClick={handleBanProfile} disabled={actionLoading === 'ban-profile'} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                      Save Ban Decision
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>

      <section className="workspace-card panel-hover mt-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="section-title">Candidate Timeline & TAT</h2>
          <InfoTip text="Complete history of events for this application - status changes, document actions, clearance moves, interview events. TAT per step computed here." />
        </div>
        <Timeline entityType="application" entityId={application.id} />
      </section>
      </>
      )}
      {activeTab === 'schedule' && (
        <div className="space-y-6">
          <section className="workspace-card panel-hover">
            <div className="flex items-center justify-between gap-3 mb-6">
              <div>
                <h2 className="section-title">Interview Schedule</h2>
                <p className="mt-1 text-sm text-gray-500">Manage interview scheduling, slots, and outcomes</p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Suggested Slots</h3>
                {application.suggested_interview_datetime1 || application.suggested_interview_datetime2 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {application.suggested_interview_datetime1 && (
                      <button
                        onClick={() => handleScheduleSlot(application.suggested_interview_datetime1)}
                        disabled={scheduleSubmitting}
                        className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 text-left hover:border-blue-400 hover:bg-blue-100 transition-all disabled:opacity-50"
                      >
                        <span className="text-xs font-medium text-blue-600">Slot 1</span>
                        <p className="mt-1 font-semibold text-gray-900">{formatDateTime(application.suggested_interview_datetime1)}</p>
                      </button>
                    )}
                    {application.suggested_interview_datetime2 && (
                      <button
                        onClick={() => handleScheduleSlot(application.suggested_interview_datetime2)}
                        disabled={scheduleSubmitting}
                        className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 text-left hover:border-blue-400 hover:bg-blue-100 transition-all disabled:opacity-50"
                      >
                        <span className="text-xs font-medium text-blue-600">Slot 2</span>
                        <p className="mt-1 font-semibold text-gray-900">{formatDateTime(application.suggested_interview_datetime2)}</p>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                    No slots suggested yet. Interviewers will suggest slots after reviewing the candidate.
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Current Schedule</h3>
                {application.scheduled_datetime ? (
                  <div className="rounded-xl border-2 border-green-200 bg-green-50 p-4">
                    <p className="font-semibold text-green-800">{formatDateTime(application.scheduled_datetime)}</p>
                    <p className="mt-1 text-sm text-green-700">
                      Round {getCurrentRoundTask(application)?.round_number || ''}
                    </p>
                    {application.meeting_link && (
                      <a 
                        href={application.meeting_link} 
                        target="_blank" 
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                      >
                        🔗 Join Meeting
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-dashed border-gray-200 p-4 space-y-3">
                    <p className="text-sm text-gray-500">No interview scheduled yet</p>
                    <input
                      type="datetime-local"
                      value={scheduleForm.datetime}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, datetime: e.target.value }))}
                      className="input-field w-full"
                    />
                    <input
                      type="url"
                      placeholder="Meeting link (Zoom/Teams/Google Meet)"
                      value={scheduleForm.meeting_link}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, meeting_link: e.target.value }))}
                      className="input-field w-full"
                    />
                    <button
                      onClick={handleQuickSchedule}
                      disabled={!scheduleForm.datetime || scheduleSubmitting}
                      className="btn-primary w-full"
                    >
                      {scheduleSubmitting ? 'Scheduling...' : 'Schedule Interview'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="workspace-card panel-hover">
            <h3 className="section-title mb-4">Interview Panel</h3>
            {application.interview_feedback?.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {application.interview_feedback.map((task, idx) => (
                  <div key={task.id || idx} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900">{task.interviewer_email}</p>
                      <span className={`text-xs px-2 py-1 rounded ${
                        task.status === 'completed' ? 'bg-green-100 text-green-700' :
                        task.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {task.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">Round {task.round_number}</p>
                    {task.scheduled_datetime && (
                      <p className="mt-2 text-sm text-gray-600">{formatDateTime(task.scheduled_datetime)}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No interviewers assigned yet</p>
            )}
          </section>

          <section className="workspace-card panel-hover">
            <h3 className="section-title mb-4">Interview History</h3>
            <Timeline entityType="application" entityId={application.id} filterEventTypes={['interview.*', 'feedback.*']} />
          </section>
        </div>
      )}
    </div>
  );
}
