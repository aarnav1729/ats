function parseJsonValue(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function normalizeArrayValue(value) {
  const parsed = parseJsonValue(value, value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed === null || parsed === undefined || parsed === '') return [];
  return [parsed];
}

export function normalizeObjectValue(value) {
  const parsed = parseJsonValue(value, value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return {};
}

function uniqueNumbers(items) {
  return [...new Set(
    items
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0)
  )];
}

function uniqueEmails(items) {
  return [...new Set(
    items
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

export function getRoundNumberFromStatus(status) {
  const match = String(status || '').match(/^Round(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function getInterviewStageIndices(hiringFlow) {
  const stages = normalizeArrayValue(hiringFlow);
  const interviewLikeIndices = stages
    .map((item, index) => {
      const normalized = String(item || '').trim().toLowerCase();
      if (!normalized) return null;
      if (
        normalized.includes('interview')
        || normalized.includes('round')
        || normalized.includes('technical')
        || normalized.includes('panel')
        || normalized.includes('manager')
        || normalized.includes('discussion')
        || normalized.includes('hod')
      ) {
        return index;
      }
      return null;
    })
    .filter((item) => item !== null);

  const fallbackIndices = [2, 3, 4].filter((index) => index < stages.length);
  return uniqueNumbers([...interviewLikeIndices, ...fallbackIndices]).sort((a, b) => a - b);
}

export function resolveRoundAssignments(application, job, roundNumber, statusHint = '') {
  const stageIndex = roundNumber - 1;
  const appInterviewers = normalizeArrayValue(application?.interviewers);
  const jobAssignments = normalizeObjectValue(job?.interviewer_emails);
  const hiringFlow = normalizeArrayValue(job?.hiring_flow);
  const normalizedStage = String(statusHint || '').replace(/\s+/g, '').toLowerCase();
  const interviewStageIndices = getInterviewStageIndices(hiringFlow);
  const matchingFlowIndex = hiringFlow.findIndex((item) => {
    const normalizedItem = String(item || '').replace(/\s+/g, '').toLowerCase();
    return normalizedItem === normalizedStage
      || normalizedItem.includes(`round${roundNumber}`)
      || normalizedItem.includes(`interviewround${roundNumber}`);
  });
  const derivedFlowIndex = matchingFlowIndex >= 0
    ? matchingFlowIndex
    : (interviewStageIndices[stageIndex] ?? null);
  const applicationAssignments = normalizeArrayValue(
    appInterviewers[stageIndex]
    ?? appInterviewers[String(stageIndex)]
    ?? (derivedFlowIndex !== null ? appInterviewers[derivedFlowIndex] : undefined)
    ?? (derivedFlowIndex !== null ? appInterviewers[String(derivedFlowIndex)] : undefined)
  );
  const mappedAssignments = normalizeArrayValue(
    jobAssignments[stageIndex]
    ?? jobAssignments[String(stageIndex)]
    ?? (derivedFlowIndex !== null ? jobAssignments[derivedFlowIndex] : undefined)
    ?? (derivedFlowIndex !== null ? jobAssignments[String(derivedFlowIndex)] : undefined)
    ?? jobAssignments[roundNumber]
    ?? jobAssignments[String(roundNumber)]
    ?? jobAssignments[`Round${roundNumber}`]
    ?? jobAssignments[statusHint]
  );

  return {
    assignees: uniqueEmails([...applicationAssignments, ...mappedAssignments]),
    derivedFlowIndex,
  };
}

export function getInterviewTaskStatus(statusHint = '', scheduledDatetime = null) {
  const normalizedStatus = String(statusHint || '').trim();
  if (normalizedStatus === 'AwaitingHODResponse') {
    return 'review_pending';
  }
  if (normalizedStatus === 'AwaitingInterviewScheduling' && !scheduledDatetime) {
    return 'awaiting_hr_schedule';
  }
  if (/^Round\d+$/.test(normalizedStatus) || scheduledDatetime) {
    return 'scheduled';
  }
  return 'review_pending';
}

export async function ensureInterviewTasksForRound(client, application, roundNumber, statusHint = '') {
  if (!roundNumber || !application?.ats_job_id) return [];

  const jobResult = await client.query(
    `SELECT job_id, job_title, interviewer_emails, hiring_flow
     FROM jobs
     WHERE job_id = $1 AND active_flag = true
     LIMIT 1`,
    [application.ats_job_id]
  );
  const job = jobResult.rows[0];
  if (!job) return [];

  const assignmentContext = resolveRoundAssignments(application, job, roundNumber, statusHint);
  const assignees = assignmentContext.assignees;
  if (assignees.length === 0) return [];

  const interviewTimes = normalizeArrayValue(application.interview_datetimes);
  const scheduledDatetime =
    interviewTimes[roundNumber - 1]
    || (assignmentContext.derivedFlowIndex !== null
      ? interviewTimes[assignmentContext.derivedFlowIndex]
      : null)
    || null;
  const taskStatus = getInterviewTaskStatus(statusHint, scheduledDatetime);

  const createdTasks = [];

  for (const interviewerEmail of assignees) {
    const existing = await client.query(
      `SELECT id
       FROM interview_feedback
       WHERE application_id = $1 AND round_number = $2 AND interviewer_email = $3
       LIMIT 1`,
      [application.id, roundNumber, interviewerEmail]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE interview_feedback
         SET job_id = $1,
             scheduled_datetime = COALESCE($2, scheduled_datetime),
             status = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [application.ats_job_id, scheduledDatetime, taskStatus, existing.rows[0].id]
      );
      createdTasks.push({ id: existing.rows[0].id, interviewer_email: interviewerEmail, scheduled_datetime: scheduledDatetime });
      continue;
    }

    const inserted = await client.query(
      `INSERT INTO interview_feedback (
        application_id,
        job_id,
        round_number,
        interviewer_email,
        scheduled_datetime,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, interviewer_email, scheduled_datetime`,
      [application.id, application.ats_job_id, roundNumber, interviewerEmail, scheduledDatetime, taskStatus]
    );

    createdTasks.push(inserted.rows[0]);
  }

  return createdTasks;
}

export const HR_MANAGED_TRANSITIONS = {
  InQueue: ['Applied', 'HRRejected', 'Withdrawn'],
  Applied: ['Shortlisted', 'HRRejected', 'Withdrawn'],
  Shortlisted: ['AwaitingHODResponse', 'HRRejected', 'Withdrawn'],
  AwaitingHODResponse: ['AwaitingInterviewScheduling', 'HODRejected', 'Withdrawn'],
  AwaitingInterviewScheduling: ['Round1', 'Round2', 'Round3', 'HRRejected', 'Withdrawn'],
  Round1: ['Round1Rejected', 'AwaitingFeedback', 'Round2', 'Selected', 'Withdrawn'],
  Round2: ['Round2Rejected', 'AwaitingFeedback', 'Round3', 'Selected', 'Withdrawn'],
  Round3: ['Round3Rejected', 'AwaitingFeedback', 'Selected', 'Withdrawn'],
  AwaitingFeedback: ['Selected', 'Round1Rejected', 'Round2Rejected', 'Round3Rejected', 'Withdrawn'],
  Selected: ['OfferInProcess', 'OfferRejected', 'Withdrawn'],
  OfferInProcess: ['Offered', 'OfferRejected', 'Withdrawn'],
  Offered: ['OfferAccepted', 'OfferRejected', 'OfferDropout'],
  OfferAccepted: ['Joined', 'OfferDropout'],
};

// Terminal states from which no further transitions are permitted.
const TERMINAL_STATES = new Set([
  'HRRejected', 'HODRejected', 'Round1Rejected', 'Round2Rejected', 'Round3Rejected',
  'OfferRejected', 'OfferDropout', 'Withdrawn', 'Joined',
]);

export function assertHrManagedTransition(currentStatus, nextStatus, options = {}) {
  if (currentStatus === nextStatus) return;
  if (TERMINAL_STATES.has(currentStatus)) {
    throw new Error(`${currentStatus} is a terminal state; cannot move to ${nextStatus}`);
  }
  const allowed = HR_MANAGED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Cannot move candidate from ${currentStatus} to ${nextStatus} from the HR workflow`);
  }

  if (nextStatus === 'HRRejected' && !options.rejectionReason) {
    throw new Error('HR rejection reason is required');
  }
}
