export const WORKFLOW_LANES = [
  {
    key: 'screening',
    label: 'Screening',
    description: 'HR screens, rejects, or shortlists the profile.',
    statuses: ['InQueue', 'Applied', 'Shortlisted', 'HRRejected', 'Withdrawn'],
  },
  {
    key: 'hod_review',
    label: 'HOD Review',
    description: 'HR assigns rounds and HODs review the profile before scheduling.',
    statuses: ['AwaitingHODResponse', 'HODRejected', 'AwaitingInterviewScheduling'],
  },
  {
    key: 'interviews',
    label: 'Interviews',
    description: 'Interview rounds are scheduled, conducted, and reviewed.',
    statuses: ['Round1', 'Round1Rejected', 'Round2', 'Round2Rejected', 'Round3', 'Round3Rejected', 'AwaitingFeedback'],
  },
  {
    key: 'offer',
    label: 'Offer & Documents',
    description: 'Selected candidates move through offer, document collection, and acceptance.',
    statuses: ['Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout'],
  },
  {
    key: 'joining',
    label: 'Joining',
    description: 'Candidate joins and post-joining tasks can continue.',
    statuses: ['Joined'],
  },
];

export const STATUS_SEQUENCE = [
  'InQueue',
  'Applied',
  'Shortlisted',
  'AwaitingHODResponse',
  'AwaitingInterviewScheduling',
  'Round1',
  'Round2',
  'Round3',
  'AwaitingFeedback',
  'Selected',
  'OfferInProcess',
  'Offered',
  'OfferAccepted',
  'Joined',
];

export const STATUS_COPY = {
  InQueue: {
    title: 'Assign the profile into active screening',
    summary: 'This candidate has entered the queue and still needs an HR owner to begin evaluation.',
    owner: 'HR Admin / Recruiter',
  },
  Applied: {
    title: 'Complete the initial screening decision',
    summary: 'Review the profile, then either shortlist it for business review or reject it with a reason.',
    owner: 'Recruiter',
  },
  Shortlisted: {
    title: 'Plan the interview workflow',
    summary: 'Define how many interview rounds are required and assign round-wise reviewers before routing the candidate to HOD review.',
    owner: 'Recruiter',
  },
  AwaitingHODResponse: {
    title: 'Wait for reviewer pre-interview review',
    summary: 'The assigned HOD or interviewer should inspect the resume, documents, and candidate profile before proposing time slots or rejecting the profile.',
    owner: 'HOD / Interviewer',
  },
  AwaitingInterviewScheduling: {
    title: 'Confirm the interview schedule with the candidate',
    summary: 'A reviewer has suggested slots. HR should choose one of the two or add a third, then send the Teams invite and calendar hold.',
    owner: 'Recruiter',
  },
  Round1: {
    title: 'Keep round 1 on track',
    summary: 'The interview is scheduled or complete. Use the scheduling workspace for reminders or no-show handling, and wait for reviewer feedback.',
    owner: 'Recruiter / Interviewer',
  },
  Round2: {
    title: 'Keep round 2 on track',
    summary: 'The interview is scheduled or complete. Use the scheduling workspace for reminders or no-show handling, and wait for reviewer feedback.',
    owner: 'Recruiter / Interviewer',
  },
  Round3: {
    title: 'Close out the final interview round',
    summary: 'The last interview is in progress or complete. Reviewer feedback should drive the final selection outcome.',
    owner: 'Recruiter / Interviewer',
  },
  AwaitingFeedback: {
    title: 'Collect final reviewer decision',
    summary: 'The round is complete and the final HOD/interviewer decision is still pending.',
    owner: 'HOD / Interviewer',
  },
  Selected: {
    title: 'Start pre-offer documentation',
    summary: 'The candidate has been selected. Request documents and start offer preparation from the workflow screen.',
    owner: 'Recruiter',
  },
  OfferInProcess: {
    title: 'Release or close the offer',
    summary: 'Finalize salary discussion, send the offer, or record that the process is not moving forward.',
    owner: 'Recruiter',
  },
  Offered: {
    title: 'Track the offer response',
    summary: 'Record acceptance, rejection, or dropout and keep the candidate informed.',
    owner: 'Recruiter',
  },
  OfferAccepted: {
    title: 'Drive the candidate to joining',
    summary: 'Keep required documents moving and mark the candidate as joined once the onboarding date is confirmed.',
    owner: 'Recruiter',
  },
  Joined: {
    title: 'Hiring journey complete',
    summary: 'The candidate has joined. Post-joining tasks can continue from the document workflow if needed.',
    owner: 'Recruiter / HR Admin',
  },
};

export const HR_WORKFLOW_ACTIONS = {
  InQueue: [
    { kind: 'transition', nextStatus: 'Applied', label: 'Start Screening', help: 'Assign this profile into active HR screening.' },
    { kind: 'transition', nextStatus: 'HRRejected', label: 'Reject with Reason', help: 'Reject the candidate with a required HR reason.' },
  ],
  Applied: [
    { kind: 'transition', nextStatus: 'Shortlisted', label: 'Shortlist', help: 'Mark the candidate as shortlisted before routing to HOD review.' },
    { kind: 'transition', nextStatus: 'HRRejected', label: 'Reject with Reason', help: 'Reject the candidate with a required HR reason.' },
  ],
  Shortlisted: [
    { kind: 'setup_review', label: 'Assign HOD & Rounds', help: 'Choose total rounds and round-wise owners, then route for HOD review.' },
    { kind: 'transition', nextStatus: 'HRRejected', label: 'Reject with Reason', help: 'Reject the candidate instead of moving to HOD review.' },
  ],
  AwaitingHODResponse: [
    { kind: 'navigate_interviews', label: 'Open Interview Hub', help: 'HODs review the profile and suggest interview slots in the Interview Hub.' },
  ],
  AwaitingInterviewScheduling: [
    { kind: 'schedule_interview', label: 'Confirm Interview Schedule', help: 'Use the Interview Hub or candidate workflow panel to block the calendar and create the Teams meeting.' },
  ],
  Round1: [
    { kind: 'await_feedback', label: 'Await Feedback', help: 'Interviewers and HODs complete feedback from the Interview Hub.' },
  ],
  Round2: [
    { kind: 'await_feedback', label: 'Await Feedback', help: 'Interviewers and HODs complete feedback from the Interview Hub.' },
  ],
  Round3: [
    { kind: 'await_feedback', label: 'Await Feedback', help: 'Interviewers and HODs complete feedback from the Interview Hub.' },
  ],
  AwaitingFeedback: [
    { kind: 'await_feedback', label: 'Await HOD Decision', help: 'The final interview owner must submit shortlist or rejection feedback.' },
  ],
  Selected: [
    { kind: 'transition', nextStatus: 'OfferInProcess', label: 'Start Offer & Documents', help: 'Begin offer discussion and request candidate documents.' },
  ],
  OfferInProcess: [
    { kind: 'transition', nextStatus: 'Offered', label: 'Mark Offered', help: 'Offer has been released to the candidate.' },
    { kind: 'transition', nextStatus: 'OfferRejected', label: 'Mark Offer Rejected', help: 'Record that the offer has been declined.' },
  ],
  Offered: [
    { kind: 'transition', nextStatus: 'OfferAccepted', label: 'Mark Accepted', help: 'Candidate has accepted the offer.' },
    { kind: 'transition', nextStatus: 'OfferRejected', label: 'Mark Rejected', help: 'Candidate has rejected the offer.' },
    { kind: 'transition', nextStatus: 'OfferDropout', label: 'Mark Dropout', help: 'Candidate accepted and later dropped out.' },
  ],
  OfferAccepted: [
    { kind: 'transition', nextStatus: 'Joined', label: 'Mark Joined', help: 'Candidate has joined the organization.' },
    { kind: 'transition', nextStatus: 'OfferDropout', label: 'Mark Dropout', help: 'Candidate dropped out after accepting the offer.' },
  ],
};

export const REJECTED_STATUSES = new Set([
  'HRRejected',
  'HODRejected',
  'Round1Rejected',
  'Round2Rejected',
  'Round3Rejected',
]);

export function getLaneForStatus(status) {
  return WORKFLOW_LANES.find((lane) => lane.statuses.includes(status)) || WORKFLOW_LANES[0];
}

export function getWorkflowProgress(status) {
  const lane = getLaneForStatus(status);
  const activeLaneIndex = WORKFLOW_LANES.findIndex((item) => item.key === lane.key);
  return WORKFLOW_LANES.map((item, index) => ({
    ...item,
    state: index < activeLaneIndex ? 'done' : index === activeLaneIndex ? 'active' : 'upcoming',
    currentStatus: index === activeLaneIndex ? status : null,
  }));
}

export function getHrWorkflowActions(application) {
  return HR_WORKFLOW_ACTIONS[application?.status] || [];
}

export function getNextRoundNumber(application) {
  if (!application) return 1;
  const roundCount = Number(application.no_of_rounds || 1) || 1;
  const scheduled = Array.isArray(application.interview_datetimes)
    ? application.interview_datetimes
    : [];
  for (let index = 0; index < roundCount; index += 1) {
    if (!scheduled[index]) return index + 1;
  }
  return Math.min(roundCount, 3);
}

export function getStatusMeta(status) {
  return STATUS_COPY[status] || {
    title: 'Continue the hiring workflow',
    summary: 'Open the workflow screen to see the next guided step for this candidate.',
    owner: 'Recruiter',
  };
}

export function getStatusIndex(status) {
  return STATUS_SEQUENCE.indexOf(status);
}

export function getUpcomingStatuses(status) {
  const index = getStatusIndex(status);
  if (index < 0) return STATUS_SEQUENCE.slice(0, 4);
  return STATUS_SEQUENCE.slice(index + 1, index + 5);
}

export function getCurrentRoundStatus(status) {
  const match = String(status || '').match(/^Round(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function getCurrentRoundTask(application) {
  const tasks = Array.isArray(application?.interview_feedback) ? application.interview_feedback : [];
  const currentRound = getCurrentRoundStatus(application?.status)
    || (application?.status === 'AwaitingInterviewScheduling'
      ? Math.min(Number(application?.no_of_rounds || 1), Math.max(1, tasks.reduce((max, task) => Math.max(max, Number(task?.round_number || 0)), 1)))
      : null);

  if (!currentRound) {
    return tasks.find((task) => ['review_pending', 'awaiting_hr_schedule'].includes(task?.status)) || tasks[0] || null;
  }

  return tasks.find((task) => Number(task?.round_number) === currentRound) || null;
}

export function getPrimaryWorkflowAction(application) {
  const status = String(application?.status || '');
  switch (status) {
    case 'InQueue':
      return { kind: 'transition', nextStatus: 'Applied', label: 'Start Screening - Review & Decide' };
    case 'Applied':
      return { kind: 'transition', nextStatus: 'Shortlisted', label: 'Shortlist - Schedule Initial Call' };
    case 'Shortlisted':
      if (application?.no_of_rounds > 0) {
        return { kind: 'transition', nextStatus: 'AwaitingHODResponse', label: 'Route to HOD for Review' };
      }
      return { kind: 'plan_rounds', label: 'Plan Interview Process - Set Rounds & Panel' };
    case 'AwaitingHODResponse':
      if (application?.hod_email) {
        return { kind: 'wait', label: 'Waiting for HOD Review' };
      }
      return { kind: 'assign_hod', label: 'Assign HOD for Interview Review' };
    case 'AwaitingInterviewScheduling':
      return { kind: 'open_schedule', label: 'Schedule Interview - Propose Time Slots' };
    case 'Round1':
    case 'Round2':
    case 'Round3':
      const roundNum = status.replace('Round', '');
      return { kind: 'open_schedule', label: `Round ${roundNum} - Manage Schedule & Collect Feedback` };
    case 'AwaitingFeedback':
      return { kind: 'remind_feedback', label: 'Remind Interviewer for Feedback' };
    case 'Selected':
      return { kind: 'transition', nextStatus: 'DocumentsInProgress', label: 'Start Document Collection' };
    case 'DocumentsInProgress':
      return { kind: 'transition', nextStatus: 'DocumentsCleared', label: 'Clear Documents & Upload to Portal' };
    case 'DocumentsCleared':
      return { kind: 'ctc_breakup', label: 'Send CTC Breakup to Candidate' };
    case 'CTCSent':
    case 'CTCAcceptance':
      return { kind: 'wait_ctc', label: 'Waiting for Candidate CTC Response' };
    case 'CTCAccepted':
      return { kind: 'transition', nextStatus: 'OfferInProcess', label: 'Start Offer Processing' };
    case 'OfferInProcess':
      return { kind: 'transition', nextStatus: 'Offered', label: 'Release Formal Offer Letter' };
    case 'Offered':
      return { kind: 'transition', nextStatus: 'OfferAccepted', label: 'Confirm Candidate Joined' };
    case 'OfferAccepted':
      return { kind: 'transition', nextStatus: 'Joined', label: 'Mark Candidate Joined' };
    case 'Joined':
      return { kind: 'completed', label: 'Process Complete - Candidate Joined' };
    default:
      return { kind: 'view', label: 'Review Application Details' };
  }
}

export function getSecondaryWorkflowActions(application) {
  const status = String(application?.status || '');
  switch (status) {
    case 'InQueue':
    case 'Applied':
      return [{ kind: 'transition', nextStatus: 'HRRejected', label: 'Reject with Reason' }];
    case 'Shortlisted':
      return [{ kind: 'transition', nextStatus: 'HRRejected', label: 'Reject with Reason' }];
    case 'OfferInProcess':
      return [{ kind: 'transition', nextStatus: 'OfferRejected', label: 'Mark Offer Closed / Rejected' }];
    case 'Offered':
      return [
        { kind: 'transition', nextStatus: 'OfferRejected', label: 'Mark Offer Rejected' },
        { kind: 'transition', nextStatus: 'OfferDropout', label: 'Mark Offer Dropout' },
      ];
    case 'OfferAccepted':
      return [{ kind: 'transition', nextStatus: 'OfferDropout', label: 'Mark Offer Dropout' }];
    default:
      return [];
  }
}

export function getInterviewHubTarget(application, options = {}) {
  const params = new URLSearchParams();
  const status = String(application?.status || '');
  const focus = options.focus || 'review';

  if (application?.id) {
    params.set('application_id', String(application.id));
  }
  if (focus) {
    params.set('focus', focus);
  }

  if (status === 'AwaitingHODResponse') {
    params.set('tab', 'Needs Review');
  } else if (status === 'AwaitingInterviewScheduling') {
    params.set('tab', 'Needs Scheduling');
  } else if (/^Round\d+$/.test(status) || status === 'AwaitingFeedback') {
    params.set('tab', 'Scheduled');
  } else {
    params.set('tab', 'All');
  }

  return `/interviews?${params.toString()}`;
}

export function getSharedBulkWorkflowActions(applications) {
  if (!Array.isArray(applications) || applications.length === 0) return [];

  const transitionMaps = applications
    .map((application) => getHrWorkflowActions(application))
    .map((actions) => actions.filter((action) => action.kind === 'transition'));

  if (transitionMaps.some((actions) => actions.length === 0)) return [];

  return transitionMaps[0].filter((candidateAction) =>
    transitionMaps.every((actions) =>
      actions.some((action) => action.nextStatus === candidateAction.nextStatus)
    )
  );
}

export function getWorkflowTutorial(status) {
  const meta = getStatusMeta(status);
  const steps = {
    InQueue: [
      'Claim the profile into screening.',
      'Review resume and core candidate details.',
      'Either shortlist or reject with a reason.',
    ],
    Shortlisted: [
      'Set how many rounds are needed.',
      'Assign reviewers for each round.',
      'Route the candidate to HOD review.',
    ],
    AwaitingInterviewScheduling: [
      'Check the slots suggested by the reviewer.',
      'Confirm one slot with the candidate or add a third.',
      'Send the Teams invite and block the calendar.',
    ],
    Selected: [
      'Request required documents from the candidate.',
      'Review uploaded files inline from the workflow screen.',
      'Move the candidate into offer processing once ready.',
    ],
  }[status] || [
    meta.summary,
    `Current owner: ${meta.owner}.`,
    'Open the dedicated workspace for the next guided step.',
  ];

  return {
    title: meta.title,
    steps,
  };
}
