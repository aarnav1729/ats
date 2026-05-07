// Single-source-of-truth next-action helper.
// Given an application + current user, returns ONE next CTA (or null) to surface.
// This drives the progressive-disclosure home pages so users only see the
// immediate next thing, never the full menu of options.

const ROUND_STATUSES = new Set(['Round1', 'Round2', 'Round3']);

function appNeedsSlots(app) {
  // status begins a round but no scheduled slot yet
  return app.status === 'AwaitingInterviewScheduling';
}

function appAwaitingFeedback(app) {
  return ROUND_STATUSES.has(app.status) || app.status === 'AwaitingFeedback';
}

export function nextActionForRecruiter(app) {
  const id = app.id;
  const wf = `/applications/${id}/workflow`;
  switch (app.status) {
    case 'InQueue':
    case 'Applied':
      return { label: 'Triage resume', to: wf, hint: 'Shortlist or reject this candidate', tone: 'brand' };
    case 'Shortlisted':
      return { label: 'Send to HOD', to: wf, hint: 'Forward shortlist to HOD for approval', tone: 'brand' };
    case 'AwaitingHODResponse':
      return { label: 'Awaiting HOD', to: wf, hint: 'Waiting on HOD response - nudge if stalled', tone: 'neutral' };
    case 'AwaitingInterviewScheduling':
      return { label: 'Schedule interview', to: wf, hint: 'Confirm an interview slot with the panel', tone: 'brand' };
    case 'Round1':
    case 'Round2':
    case 'Round3':
    case 'AwaitingFeedback':
      return { label: 'Chase feedback', to: wf, hint: 'Interviewer feedback pending', tone: 'warn' };
    case 'Selected':
      return { label: 'Start documents', to: wf, hint: 'Kick off document collection for joining', tone: 'brand' };
    case 'DocumentsInProgress':
      return { label: 'Review documents', to: '/hr/document-queue', hint: 'Verify uploaded candidate documents', tone: 'brand' };
    case 'DocumentsCleared':
      return { label: 'Send CTC breakup', to: wf, hint: 'Build & send the CTC breakup', tone: 'brand' };
    case 'CTCSent':
    case 'CTCAcceptance':
      return { label: 'Awaiting candidate', to: wf, hint: 'Candidate is reviewing CTC offer', tone: 'neutral' };
    case 'CTCAccepted':
      return { label: 'Run CTC comparison', to: wf, hint: 'Send to R2 and approvers for sign-off', tone: 'brand' };
    case 'SalaryRejected':
      return { label: 'Renegotiate CTC', to: wf, hint: 'Candidate rejected CTC - revise & resend', tone: 'warn' };
    case 'OfferInProcess':
      return { label: 'Upload offer letter', to: wf, hint: 'Generate / upload the signed offer letter', tone: 'brand' };
    case 'SignaturePending':
      return { label: 'Awaiting signature', to: wf, hint: 'Candidate is signing the offer', tone: 'neutral' };
    case 'Offered':
      return { label: 'Confirm acceptance', to: wf, hint: 'Capture candidate offer acceptance', tone: 'brand' };
    case 'OfferAccepted':
    case 'Postponed':
      return { label: 'Track joining', to: wf, hint: 'Confirm joining date or postponement', tone: 'brand' };
    default:
      return null; // terminal / parked
  }
}

export function nextActionForInterviewer(app) {
  const id = app.id;
  const ws = `/interviews/${id}/workspace`;
  if (appNeedsSlots(app)) {
    return { label: 'Suggest slots', to: ws, hint: 'Propose 2–3 interview slots', tone: 'brand' };
  }
  if (appAwaitingFeedback(app)) {
    return { label: 'Give feedback', to: ws, hint: 'Submit your interview feedback', tone: 'warn' };
  }
  // After feedback / pre-interview informational
  if (['Selected', 'DocumentsInProgress', 'DocumentsCleared'].includes(app.status)) {
    return { label: 'View outcome', to: ws, hint: 'Candidate selected - view post-interview status', tone: 'success' };
  }
  return null;
}

// HR Admin sees the recruiter action (universal pipeline view), but if
// CTC admin decision is needed it is escalated as the next action.
export function nextActionForAdmin(app) {
  if (app.status === 'CTCAccepted' && app.admin_decision === 'pending') {
    return { label: 'Approve CTC', to: '/ctc-approvals', hint: 'HR Admin decision required on CTC', tone: 'danger' };
  }
  return nextActionForRecruiter(app);
}

export function nextAction(app, role) {
  if (!app) return null;
  if (role === 'interviewer') return nextActionForInterviewer(app);
  if (role === 'hr_admin')    return nextActionForAdmin(app);
  return nextActionForRecruiter(app);
}

export const TONE_CLASSES = {
  brand:   'bg-indigo-600 hover:bg-indigo-700 text-white',
  warn:    'bg-amber-500 hover:bg-amber-600 text-white',
  danger:  'bg-rose-600 hover:bg-rose-700 text-white',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  neutral: 'bg-slate-200 hover:bg-slate-300 text-slate-800',
};
