import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { applicationsAPI, candidatesAPI, interviewsAPI, jobsAPI, mastersAPI, orgAPI, candidatePortalAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import EmailAutocompleteTags from '../components/EmailAutocompleteTags';
import InfoTip from '../components/InfoTip';
import CTCPasteTable from '../components/CTCPasteTable';
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
    no_of_rounds: String(Math.max(Number(application?.no_of_rounds || highestRound || 1), 1)),
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
              <p className="mt-2 text-sm font-semibold text-slate-900">{application?.candidate_email || 'Email not captured'}</p>
              <p className="mt-1 text-sm text-slate-500">{application?.candidate_phone || 'Phone not captured'}</p>
            </div>
            <div className="fact-card">
              <p className="workspace-kicker">Recruiter Owner</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{application?.recruiter_email || 'Unassigned'}</p>
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
    <div className="workspace-card animate-fade-in-up stagger-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="workspace-kicker">Process Map</p>
          <h2 className="section-title mt-2">Hiring progression at a glance</h2>
        </div>
        <span className="utility-chip">Live status · {status || 'Unknown'}</span>
      </div>
      <div className="workflow-stage-rail mt-5">
        {progress.map((lane) => (
          <div
            key={lane.key}
            className={`workflow-stage-card ${
              lane.state === 'active'
                ? 'is-active'
                : lane.state === 'done'
                  ? 'is-done'
                  : ''
            }`}
          >
            <p className="workspace-kicker">{lane.state === 'active' ? 'Active lane' : lane.state === 'done' ? 'Completed' : 'Up next'}</p>
            <p className="mt-2 text-sm font-semibold text-gray-900">{lane.label}</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">{lane.description}</p>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              {lane.state === 'active' ? lane.currentStatus : lane.state}
            </p>
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
  const [disposition, setDisposition] = useState({
    target_job_id: '',
    ban_scope: 'global',
    ban_role: '',
    ban_reason: '',
  });

  const activeInterviewTask = useMemo(() => getCurrentRoundTask(application), [application]);
  const requestedRoundExtension = useMemo(() => {
    const tasks = Array.isArray(application?.interview_feedback) ? application.interview_feedback : [];
    return tasks.find((task) => Number(task.requested_additional_rounds || 0) > 0) || null;
  }, [application?.interview_feedback]);
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
        setSecondaryRecruiterEmail(appRes.data?.secondary_recruiter_email || '');
        loadClearance(id);
      } catch (err) {
        const detail = err?.response?.data?.error || err?.message || 'Unknown error';
        console.error('Candidate workflow load error:', err);
        toast.error(`Failed to load candidate workflow: ${detail}`);
        // Don't force-navigate — let the user see the error and try again.
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
    navigate(`/applications/${application.id}/schedule`);
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

      <WorkflowHero application={application} nextOwner={nextOwner} primaryAction={primaryAction} />
      <StageRail status={application.status} />

      <div className="workboard-layout">
        <aside className="workboard-lane workboard-lane-primary">
          <section className="workspace-card panel-hover">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Candidate Dossier</h2>
                <p className="mt-1 text-sm text-gray-500">Context, candidate facts, and the primary review packet in one left rail.</p>
              </div>
              {application.resume_path && (
                <a href={application.resume_path} target="_blank" rel="noreferrer" className="btn-secondary">
                  Open Resume
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
              ].map(([label, value]) => (
                <div key={label} className="fact-card">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</p>
                  <p className="mt-2 text-sm font-medium text-gray-900">{value || '-'}</p>
                </div>
              ))}
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

          <section className="workspace-card panel-hover">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Routing Snapshot</h2>
              <InfoTip text="Use this summary rail to understand who owns the current motion and what action desk should open next." />
            </div>
            <div className="mt-4 decision-stack">
              <div className="decision-card decision-card-strong">
                <p className="workspace-kicker">Recommended next action</p>
                <p className="mt-2 text-base font-semibold text-slate-950">{primaryAction?.label || 'Monitor current owner activity'}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{getStatusMeta(application.status).summary}</p>
              </div>
              <div className="fact-grid">
                <div className="fact-card">
                  <p className="workspace-kicker">Current owner</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{nextOwner || getStatusMeta(application.status).owner}</p>
                </div>
                <div className="fact-card">
                  <p className="workspace-kicker">Secondary recruiter</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{application.secondary_recruiter_email || 'Not assigned'}</p>
                </div>
              </div>
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

          <section className="workspace-card panel-hover">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Candidate Documents</h2>
                <p className="mt-1 text-sm text-gray-500">Document requests, uploads, inline review, and reminders are grouped into one operating surface.</p>
              </div>
              <span className="text-sm font-medium text-gray-500">{application.candidate_documents?.length || 0} document(s)</span>
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
          {['Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'Joined'].includes(application.status) && (
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

              {/* Secondary recruiter assignment */}
              {!application.secondary_recruiter_email && (
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

              {application.secondary_recruiter_email && (
                <p className="mt-3 text-sm text-gray-500">
                  Secondary recruiter: <span className="font-semibold text-gray-800">{application.secondary_recruiter_email}</span>
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
                    <h3 className="text-sm font-semibold text-gray-900">CTC Comparison Table</h3>
                    <InfoTip text="Paste the CTC comparison table directly from your Excel sheet — rows and columns are preserved exactly as pasted." />
                  </div>
                  <CTCPasteTable
                    value={ctcTable}
                    onChange={setCtcTable}
                    placeholder="Paste the full CTC comparison table from your Excel template — headers, values, all preserved."
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
                    disabled={clearanceLoading || !application.secondary_recruiter_email}
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
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">CTC Table (Submitted)</h3>
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
              <h2 className="section-title">Guided Next Step</h2>
              <InfoTip text="Only the next operationally valid step is highlighted here so recruiters do not have to infer the process from row buttons or guesswork." />
            </div>

            <div className="decision-card decision-card-strong mt-5">
              <p className="workspace-kicker text-indigo-600">Recommended next action</p>
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
          <InfoTip text="Complete history of events for this application — status changes, document actions, clearance moves, interview events. TAT per step computed here." />
        </div>
        <Timeline entityType="application" entityId={application.id} />
      </section>
    </div>
  );
}
