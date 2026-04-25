import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail, sendStatusUpdateEmail } from '../services/email.js';
import { parseResume, matchCandidateToJobs } from '../services/ai.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import XLSX from 'xlsx';
import {
  assertHrManagedTransition,
  ensureInterviewTasksForRound,
} from '../services/interviewWorkflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../uploads/resumes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter');
const execFileAsync = promisify(execFile);

const VALID_STATUSES = [
  'InQueue', 'Applied', 'Withdrawn', 'HRRejected', 'Shortlisted',
  'AwaitingHODResponse', 'HODRejected', 'AwaitingInterviewScheduling',
  'Round1', 'Round1Rejected', 'Round2', 'Round2Rejected', 'Round3', 'Round3Rejected',
  'AwaitingFeedback', 'Selected', 'OfferInProcess', 'Offered', 'OfferAccepted',
  'OfferRejected', 'OfferDropout', 'Joined'
];

const PREBOARDING_STATUSES = ['OfferInProcess', 'Offered', 'OfferAccepted', 'Joined'];
const DEFAULT_SELECTED_DOCUMENTS = [
  {
    stage: 'before_offer_release',
    document_name: 'PAN Card',
    description: 'Upload a clear PAN card copy for identity and payroll verification.',
  },
  {
    stage: 'before_offer_release',
    document_name: 'Aadhaar Card',
    description: 'Upload a clear Aadhaar card copy for identity verification.',
  },
  {
    stage: 'before_offer_release',
    document_name: 'Latest Payslip or Bank Statement',
    description: 'Upload either your latest payslip or a recent bank statement as compensation proof.',
  },
  {
    stage: 'before_offer_release',
    document_name: 'Offer Letter or Employment Proof',
    description: 'Upload either your current offer letter, appointment letter, or another employment proof document.',
  },
];

async function ensureDefaultSelectedDocuments(client, application, actorEmail) {
  const existingResult = await client.query(
    `SELECT LOWER(document_name) AS document_name
     FROM candidate_documents
     WHERE application_id = $1`,
    [application.id]
  );
  const existingNames = new Set(existingResult.rows.map((row) => row.document_name));

  const docsToCreate = DEFAULT_SELECTED_DOCUMENTS.filter(
    (doc) => !existingNames.has(String(doc.document_name || '').toLowerCase())
  );

  for (const doc of docsToCreate) {
    await client.query(
      `INSERT INTO candidate_documents (
        application_id,
        stage,
        document_name,
        description,
        status,
        requested_by
      ) VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [application.id, doc.stage, doc.document_name, doc.description, actorEmail || null]
    );
  }

  if (docsToCreate.length && application.candidate_email) {
    await sendNotificationEmail({
      to: application.candidate_email,
      subject: 'Premier Energies Document Checklist Is Ready',
      htmlBody: `
        <p style="margin:0 0 14px;color:#475569;line-height:1.7;">Dear ${application.candidate_name || 'Candidate'},</p>
        <p style="margin:0 0 14px;color:#475569;line-height:1.7;">You have progressed to the next hiring step. Your document checklist is now ready in the ATS portal.</p>
        <div style="margin:18px 0;border:1px solid #dbeafe;border-radius:18px;background:linear-gradient(135deg,#eef4ff,#f8fbff);padding:18px 20px;">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#1d4ed8;">Requested by default</p>
          <ul style="margin:12px 0 0;padding-left:18px;color:#1e293b;line-height:1.8;">
            ${docsToCreate.map((doc) => `<li>${doc.document_name}</li>`).join('')}
          </ul>
        </div>
        <p style="margin:0;color:#475569;line-height:1.7;">Please log in to the ATS and upload the requested files. Your recruiter can also add more documents if needed.</p>
      `,
    }).catch((err) => console.error('Default document notification error:', err.message));
  }
}

async function generateApplicationId(atsJobId) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const jobPart = atsJobId || 'POOL';
  const count = await pool.query(
    "SELECT COUNT(*) FROM applications WHERE application_id LIKE $1",
    [`ATS-APP-${today}-${jobPart}-%`]
  );
  const seq = parseInt(count.rows[0].count) + 1;
  return `ATS-APP-${today}-${jobPart}-${String(seq).padStart(4, '0')}`;
}

async function extractPdfText(filePath) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return cleanExtractedText(data.text);
  } catch (err) {
    console.error('PDF parse error:', err.message);
    return '';
  }
}

function cleanExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#xA;/gi, '\n');
}

async function extractViaTextutil(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'textutil',
      ['-convert', 'txt', '-stdout', filePath],
      { maxBuffer: 12 * 1024 * 1024 }
    );
    return cleanExtractedText(stdout);
  } catch {
    return '';
  }
}

async function extractDocxText(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'unzip',
      ['-p', filePath, 'word/document.xml'],
      { maxBuffer: 12 * 1024 * 1024 }
    );
    const plainText = decodeXmlEntities(stdout)
      .replace(/<w:tab[^>]*\/>/g, ' ')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ' ');
    return cleanExtractedText(plainText);
  } catch {
    return extractViaTextutil(filePath);
  }
}

async function extractDocText(filePath) {
  const textutilResult = await extractViaTextutil(filePath);
  if (textutilResult) return textutilResult;

  try {
    const { stdout } = await execFileAsync(
      'strings',
      ['-n', '4', filePath],
      { maxBuffer: 12 * 1024 * 1024 }
    );
    return cleanExtractedText(stdout);
  } catch {
    return '';
  }
}

async function extractTextFromResume(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === '.pdf') return extractPdfText(filePath);
  if (ext === '.docx') return extractDocxText(filePath);
  if (ext === '.doc' || ext === '.rtf') return extractDocText(filePath);

  try {
    return cleanExtractedText(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return '';
  }
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y'].includes(normalized);
  }
  return false;
}

function coerceNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const PATCH_BOOLEAN_FIELDS = new Set([
  'willing_to_relocate',
  'resume_flag',
  'referral_flag',
  'talent_pool_only',
  'multi_apply_flag',
  'active_flag',
]);

const PATCH_NUMBER_FIELDS = new Set([
  'candidate_age',
  'candidate_years_of_experience',
  'current_ctc',
  'no_of_rounds',
  'interviewer_technical_score',
  'interviewer_behavioral_score',
  'interviewer_company_fit_score',
]);

const PATCH_TEXT_FIELDS = new Set([
  'candidate_name',
  'candidate_email',
  'candidate_phone',
  'candidate_aadhar',
  'candidate_pan',
  'candidate_gender',
  'current_organization',
  'current_location',
  'resume_path',
  'resume_file_name',
  'education_level',
  'education_other',
  'source',
  'referrer_emp_id',
  'consultant_code',
  'recruiter_email',
  'ats_job_id',
  'status',
  'joining_date',
  'rejected_by_email',
  'rejection_reason',
  'suggested_interview_datetime1',
  'suggested_interview_datetime2',
  'dropout_reason',
  'interviewer_feedback_remarks',
  'interviewer_final_decision',
  'dob',
  'uploaded_by',
]);

function normalizePatchFieldValue(dbField, value) {
  if (value === undefined) {
    return { include: false, value: undefined };
  }

  if (PATCH_BOOLEAN_FIELDS.has(dbField)) {
    return { include: true, value: coerceBoolean(value) };
  }

  if (PATCH_NUMBER_FIELDS.has(dbField)) {
    return { include: true, value: coerceNumber(value) };
  }

  if (PATCH_TEXT_FIELDS.has(dbField)) {
    if (value === null) return { include: true, value: null };
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return { include: true, value: trimmed === '' ? null : trimmed };
    }
    return { include: true, value };
  }

  return { include: true, value };
}

function normalizePhone(value) {
  if (!value) return null;
  return String(value).replace(/\D/g, '');
}

function normalizeApplicationInput(input, actorEmail) {
  const atsJobId = input.ats_job_id || input.job_id || null;
  const talentPoolOnly = coerceBoolean(input.talent_pool_only) || !atsJobId;
  const resumePath = input.resume_path || input.resume_url || null;
  const source = input.source || null;

  return {
    ats_job_id: atsJobId,
    status: input.status || (talentPoolOnly ? 'InQueue' : 'Applied'),
    candidate_name: input.candidate_name || input.name || null,
    candidate_aadhar: input.candidate_aadhar || null,
    candidate_pan: input.candidate_pan || null,
    candidate_email: input.candidate_email || input.email || null,
    candidate_phone: normalizePhone(input.candidate_phone || input.phone),
    candidate_age: coerceNumber(input.candidate_age || input.age),
    candidate_gender: input.candidate_gender || input.gender || null,
    candidate_years_of_experience: coerceNumber(
      input.candidate_years_of_experience ?? input.candidate_experience ?? input.experience
    ),
    current_organization: input.current_organization || input.candidate_current_company || input.current_company || null,
    current_ctc: coerceNumber(input.current_ctc ?? input.candidate_current_ctc),
    current_location: input.current_location || input.candidate_location || input.location || null,
    willing_to_relocate: coerceBoolean(input.willing_to_relocate ?? input.willing_to_relocate_flag),
    resume_flag: coerceBoolean(input.resume_flag) || Boolean(resumePath),
    resume_path: resumePath,
    resume_file_name: input.resume_file_name || null,
    education_level: input.education_level || null,
    education_other: input.education_other || null,
    source,
    referrer_emp_id: input.referrer_emp_id || input.referred_by || null,
    consultant_code: input.consultant_code || null,
    referral_flag: coerceBoolean(input.referral_flag) || source === 'Employee Referral' || Boolean(input.referrer_emp_id),
    recruiter_email: input.recruiter_email || actorEmail || null,
    talent_pool_only: talentPoolOnly,
    talent_pool_expires_at: talentPoolOnly
      ? new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    created_by: input.created_by || actorEmail || null,
    uploaded_by: actorEmail || null,
    dob: input.dob || null,
  };
}

async function createApplicationRecord(input, actorEmail) {
  const payload = normalizeApplicationInput(input, actorEmail);

  if (!payload.candidate_name || !payload.candidate_email) {
    throw new Error('candidate_name and candidate_email are required');
  }

  if (!payload.source) {
    throw new Error('source is required — specify how this candidate was sourced');
  }

  if (payload.candidate_phone) {
    const digits = String(payload.candidate_phone).replace(/\D/g, '');
    if (digits.length !== 10) {
      throw new Error('candidate_phone must be exactly 10 digits');
    }
    payload.candidate_phone = digits;
  }

  if (payload.ats_job_id) {
    const rawJobValue = String(payload.ats_job_id);
    if (!rawJobValue.startsWith('ATS-')) {
      const jobLookup = await pool.query(
        'SELECT job_id FROM jobs WHERE id = $1 AND active_flag = true LIMIT 1',
        [rawJobValue]
      );
      payload.ats_job_id = jobLookup.rows[0]?.job_id || rawJobValue;
    }
  }

  // Same-job duplicate check (block)
  if (payload.ats_job_id) {
    const duplicateCheck = await pool.query(
      `SELECT id, application_id FROM applications
       WHERE active_flag = true AND ats_job_id = $1
         AND (candidate_email = $2 OR ($3::text IS NOT NULL AND candidate_phone = $3))`,
      [payload.ats_job_id, payload.candidate_email, payload.candidate_phone]
    );
    if (duplicateCheck.rows.length > 0) {
      return { duplicate: duplicateCheck.rows[0], payload };
    }
  }

  // Cross-job duplicate detection by phone (flag, don't block)
  let isDuplicate = false;
  let duplicateOfId = null;
  if (payload.candidate_phone) {
    const crossDupe = await pool.query(
      `SELECT id FROM applications WHERE active_flag = true AND candidate_phone = $1 LIMIT 1`,
      [payload.candidate_phone]
    );
    if (crossDupe.rows.length > 0) {
      isDuplicate = true;
      duplicateOfId = crossDupe.rows[0].id;
    }
  }

  const applicationId = await generateApplicationId(payload.ats_job_id);
  const result = await pool.query(
    `INSERT INTO applications (
      application_id,
      ats_job_id,
      status,
      candidate_name,
      candidate_aadhar,
      candidate_pan,
      candidate_email,
      candidate_phone,
      candidate_age,
      candidate_gender,
      candidate_years_of_experience,
      current_organization,
      current_ctc,
      current_location,
      willing_to_relocate,
      resume_flag,
      resume_path,
      resume_file_name,
      education_level,
      education_other,
      source,
      referrer_emp_id,
      consultant_code,
      referral_flag,
      recruiter_email,
      talent_pool_only,
      talent_pool_expires_at,
      created_by,
      uploaded_by,
      dob,
      is_duplicate,
      duplicate_of_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
    )
    RETURNING *`,
    [
      applicationId,
      payload.ats_job_id,
      payload.status,
      payload.candidate_name,
      payload.candidate_aadhar,
      payload.candidate_pan,
      payload.candidate_email,
      payload.candidate_phone,
      payload.candidate_age,
      payload.candidate_gender,
      payload.candidate_years_of_experience,
      payload.current_organization,
      payload.current_ctc,
      payload.current_location,
      payload.willing_to_relocate,
      payload.resume_flag,
      payload.resume_path,
      payload.resume_file_name,
      payload.education_level,
      payload.education_other,
      payload.source,
      payload.referrer_emp_id,
      payload.consultant_code,
      payload.referral_flag,
      payload.recruiter_email,
      payload.talent_pool_only,
      payload.talent_pool_expires_at,
      payload.created_by,
      payload.uploaded_by,
      payload.dob,
      isDuplicate,
      duplicateOfId,
    ]
  );

  return { row: result.rows[0], payload, isDuplicate };
}

async function softDeactivateApplication(id, actorEmail, reason = 'Removed from active workflows') {
  const result = await pool.query(
    `UPDATE applications
     SET active_flag = false,
         updated_at = NOW(),
         interviewer_feedback_remarks = CONCAT(COALESCE(interviewer_feedback_remarks, ''), E'\n', $2)
     WHERE id = $1 AND active_flag = true
     RETURNING *`,
    [id, reason]
  );
  if (result.rows.length === 0) {
    throw new Error('Application not found');
  }

  await logAudit({
    actionBy: actorEmail,
    actionType: 'delete',
    entityType: 'application',
    entityId: id,
    afterState: {
      active_flag: false,
      reason,
    },
  });

  return result.rows[0];
}

function normalizeArrayInput(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed].filter(Boolean);
    } catch {
      return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [value].filter(Boolean);
}

function normalizeObjectInput(value) {
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

function getRoundNumberFromStatus(status) {
  const match = String(status || '').match(/^Round(\d+)$/);
  return match ? Number(match[1]) : null;
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
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
}

function getInterviewStageIndices(hiringFlow) {
  const stages = normalizeArrayInput(hiringFlow);
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

function resolveRoundAssignments(application, job, roundNumber, status) {
  const stageIndex = roundNumber - 1;
  const appInterviewers = normalizeArrayInput(application.interviewers);
  const jobAssignments = normalizeObjectInput(job?.interviewer_emails);
  const hiringFlow = normalizeArrayInput(job?.hiring_flow);
  const normalizedStage = String(status || '').replace(/\s+/g, '').toLowerCase();
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
  const applicationAssignments = normalizeArrayInput(
    appInterviewers[stageIndex]
    ?? appInterviewers[String(stageIndex)]
    ?? (derivedFlowIndex !== null ? appInterviewers[derivedFlowIndex] : undefined)
    ?? (derivedFlowIndex !== null ? appInterviewers[String(derivedFlowIndex)] : undefined)
  );
  const mappedAssignments = normalizeArrayInput(
    jobAssignments[stageIndex]
    ?? jobAssignments[String(stageIndex)]
    ?? (derivedFlowIndex !== null ? jobAssignments[derivedFlowIndex] : undefined)
    ?? (derivedFlowIndex !== null ? jobAssignments[String(derivedFlowIndex)] : undefined)
    ?? jobAssignments[roundNumber]
    ?? jobAssignments[String(roundNumber)]
    ?? jobAssignments[`Round${roundNumber}`]
    ?? jobAssignments[status]
  );

  return {
    assignees: uniqueEmails([...applicationAssignments, ...mappedAssignments]),
    derivedFlowIndex,
  };
}

async function syncInterviewTasksForStage(client, application, status) {
  const roundNumber = getRoundNumberFromStatus(status);
  if (!roundNumber || !application.ats_job_id) return [];

  const jobResult = await client.query(
    `SELECT job_id, job_title, interviewer_emails, hiring_flow
     FROM jobs
     WHERE job_id = $1 AND active_flag = true
     LIMIT 1`,
    [application.ats_job_id]
  );
  const job = jobResult.rows[0];
  if (!job) return [];

  const assignmentContext = resolveRoundAssignments(application, job, roundNumber, status);
  const assignees = assignmentContext.assignees;
  if (assignees.length === 0) return [];

  const interviewTimes = normalizeArrayInput(application.interview_datetimes);
  const scheduledDatetime =
    interviewTimes[roundNumber - 1]
    || (assignmentContext.derivedFlowIndex !== null
      ? interviewTimes[assignmentContext.derivedFlowIndex]
      : null)
    || null;
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
             status = 'scheduled',
             updated_at = NOW()
         WHERE id = $3`,
        [application.ats_job_id, scheduledDatetime, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO interview_feedback (
          application_id,
          job_id,
          round_number,
          interviewer_email,
          scheduled_datetime,
          status
        ) VALUES ($1, $2, $3, $4, $5, 'scheduled')`,
        [application.id, application.ats_job_id, roundNumber, interviewerEmail, scheduledDatetime]
      );
    }

    createdTasks.push(interviewerEmail);
  }

  return createdTasks;
}

async function transitionApplicationStatus(client, applicationId, nextStatus, actorEmail, comment = null, options = {}) {
  if (!VALID_STATUSES.includes(nextStatus)) {
    throw new Error('Invalid stage/status provided');
  }

  const existing = await client.query(
    `SELECT * FROM applications WHERE id = $1 AND active_flag = true`,
    [applicationId]
  );
  if (existing.rows.length === 0) {
    throw new Error('Application not found');
  }

  const current = existing.rows[0];
  const previousStatus = current.status;
  const isRejectedStatus = ['HRRejected', 'HODRejected', 'Round1Rejected', 'Round2Rejected', 'Round3Rejected'].includes(nextStatus);
  const rejectionReason = options.rejectionReason || options.rejection_reason || null;
  const actorRole = options.actorRole || 'hr_recruiter';

  // Block forward transitions on candidates whose parent job is closed/archived.
  // Terminal/withdraw states are still allowed so HR can clean up.
  const TERMINAL_NEXT = ['Withdrawn', 'HRRejected', 'HODRejected', 'OfferDropout', 'OfferRejected', 'Round1Rejected', 'Round2Rejected', 'Round3Rejected'];
  if (current.ats_job_id && !TERMINAL_NEXT.includes(nextStatus)) {
    const jobRow = await client.query(
      `SELECT status, active_flag FROM jobs WHERE job_id = $1 LIMIT 1`,
      [current.ats_job_id]
    );
    if (jobRow.rows.length) {
      const jobStatus = String(jobRow.rows[0].status || '').toLowerCase();
      const jobActive = jobRow.rows[0].active_flag !== false;
      if (!jobActive || ['closed', 'archived', 'cancelled', 'filled'].includes(jobStatus)) {
        throw new Error('Parent job is closed or archived; only withdrawal/rejection is allowed');
      }
    }
  }

  if (['hr_admin', 'hr_recruiter'].includes(actorRole)) {
    assertHrManagedTransition(current.status, nextStatus, { rejectionReason });
  }
  const updateValues = [nextStatus];
  const updateParts = ['status = $1', 'updated_at = NOW()'];

  if (nextStatus === 'AwaitingHODResponse') {
    const requestedRounds = Number(options.noOfRounds ?? current.no_of_rounds ?? 0);
    const requestedInterviewers = normalizeArrayInput(options.interviewers ?? current.interviewers);
    const firstRoundOwners = normalizeArrayInput(requestedInterviewers[0]);

    if (!Number.isInteger(requestedRounds) || requestedRounds < 1) {
      throw new Error('Assign at least one interview round before sending a candidate for HOD review');
    }
    if (firstRoundOwners.length === 0) {
      throw new Error('Assign at least one round 1 reviewer before sending a candidate for HOD review');
    }

    updateValues.push(requestedRounds);
    updateParts.push(`no_of_rounds = $${updateValues.length}`);
    updateValues.push(JSON.stringify(requestedInterviewers));
    updateParts.push(`interviewers = $${updateValues.length}`);
  }

  if (isRejectedStatus) {
    updateValues.push(actorEmail || null);
    updateParts.push(`rejected_by_email = $${updateValues.length}`);
    updateValues.push(rejectionReason || current.rejection_reason || null);
    updateParts.push(`rejection_reason = $${updateValues.length}`);
  }

  if (nextStatus === 'Joined' && !current.joining_date) {
    updateValues.push(new Date().toISOString().slice(0, 10));
    updateParts.push(`joining_date = COALESCE(joining_date, $${updateValues.length})`);
  }

  updateValues.push(applicationId);
  const result = await client.query(
    `UPDATE applications
     SET ${updateParts.join(', ')}
     WHERE id = $${updateValues.length}
     RETURNING *`,
    updateValues
  );

  const updated = result.rows[0];
  let taskAssignments = [];

  if (nextStatus === 'AwaitingHODResponse') {
    const createdTasks = await ensureInterviewTasksForRound(client, updated, 1, 'AwaitingHODResponse');
    taskAssignments = createdTasks.map((task) => task.interviewer_email).filter(Boolean);
  } else if (/^Round\d+$/.test(nextStatus)) {
    const roundNumber = getRoundNumberFromStatus(nextStatus);
    const createdTasks = await ensureInterviewTasksForRound(client, updated, roundNumber, nextStatus);
    taskAssignments = createdTasks.map((task) => task.interviewer_email).filter(Boolean);
  }

  if (PREBOARDING_STATUSES.includes(nextStatus)) {
    await client.query(
      `INSERT INTO users (email, name, role, phone, created_by)
       VALUES ($1, $2, 'applicant', $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [updated.candidate_email, updated.candidate_name, updated.candidate_phone, actorEmail || null]
    );
  }

  if (nextStatus === 'Selected' || nextStatus === 'OfferInProcess') {
    await ensureDefaultSelectedDocuments(client, updated, actorEmail);
  }

  return {
    application: updated,
    previousStatus,
    taskAssignments,
    comment,
  };
}

// ---------------------------------------------------------------------------
// GET / - List applications with pagination, sorting, filtering, search
// ---------------------------------------------------------------------------
router.get('/', adminOrRecruiter, async (req, res) => {
  try {
    const {
      page = 1, limit = 20, sort_by = 'a.created_at', sort_order = 'DESC',
      status, ats_job_id, talent_pool_only, recruiter_email, source,
      date_from, date_to, candidate_name, candidate_email
    } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let paramIdx = 0;

    let baseQuery = `
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      WHERE a.active_flag = true
    `;

    if (status) {
      paramIdx++;
      baseQuery += ` AND a.status = $${paramIdx}`;
      params.push(status);
    }
    if (ats_job_id) {
      paramIdx++;
      baseQuery += ` AND a.ats_job_id = $${paramIdx}`;
      params.push(ats_job_id);
    }
    if (talent_pool_only === 'true') {
      baseQuery += ` AND a.talent_pool_only = true`;
    }
    if (recruiter_email) {
      paramIdx++;
      baseQuery += ` AND a.recruiter_email = $${paramIdx}`;
      params.push(recruiter_email);
    }
    if (source) {
      paramIdx++;
      baseQuery += ` AND a.source = $${paramIdx}`;
      params.push(source);
    }
    if (date_from) {
      paramIdx++;
      baseQuery += ` AND a.created_at >= $${paramIdx}`;
      params.push(date_from);
    }
    if (date_to) {
      paramIdx++;
      baseQuery += ` AND a.created_at <= $${paramIdx}`;
      params.push(date_to);
    }
    if (candidate_name) {
      paramIdx++;
      baseQuery += ` AND a.candidate_name ILIKE $${paramIdx}`;
      params.push(`%${candidate_name}%`);
    }
    if (candidate_email) {
      paramIdx++;
      baseQuery += ` AND a.candidate_email ILIKE $${paramIdx}`;
      params.push(`%${candidate_email}%`);
    }

    const allowedSorts = [
      'a.created_at', 'a.updated_at', 'a.candidate_name', 'a.status',
      'a.application_id', 'j.job_title'
    ];
    const safeSortBy = allowedSorts.includes(sort_by) ? sort_by : 'a.created_at';
    const safeSortOrder = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT a.*, j.job_title, j.department_id, j.business_unit_id
       ${baseQuery}
       ORDER BY ${safeSortBy} ${safeSortOrder}
       LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
      [...params, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('List applications error:', err);
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

// ---------------------------------------------------------------------------
// GET /talent-pool - Universal candidate inventory with talent-pool context
// ---------------------------------------------------------------------------
router.get('/talent-pool', adminOrRecruiter, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      source,
      education,
      location,
      exp_min,
      exp_max,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params = [];
    let idx = 0;

    let baseQuery = `
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      WHERE a.active_flag = true
        AND a.status <> 'Withdrawn'
    `;

    if (search) {
      idx += 1;
      params.push(`%${search}%`);
      baseQuery += ` AND (a.candidate_name ILIKE $${idx} OR a.candidate_email ILIKE $${idx} OR COALESCE(a.candidate_phone, '') ILIKE $${idx})`;
    }
    if (source) {
      idx += 1;
      params.push(source);
      baseQuery += ` AND a.source = $${idx}`;
    }
    if (education) {
      idx += 1;
      params.push(`%${education}%`);
      baseQuery += ` AND (COALESCE(a.education_level, '') ILIKE $${idx} OR COALESCE(a.education_other, '') ILIKE $${idx})`;
    }
    if (location) {
      idx += 1;
      params.push(`%${location}%`);
      baseQuery += ` AND COALESCE(a.current_location, '') ILIKE $${idx}`;
    }
    if (exp_min !== undefined && exp_min !== '') {
      idx += 1;
      params.push(Number(exp_min));
      baseQuery += ` AND COALESCE(a.candidate_years_of_experience, 0) >= $${idx}`;
    }
    if (exp_max !== undefined && exp_max !== '') {
      idx += 1;
      params.push(Number(exp_max));
      baseQuery += ` AND COALESCE(a.candidate_years_of_experience, 0) <= $${idx}`;
    }

    const allowedSorts = {
      created_at: 'a.created_at',
      updated_at: 'a.updated_at',
      candidate_name: 'a.candidate_name',
      experience: 'a.candidate_years_of_experience',
      source: 'a.source',
    };
    const safeSortBy = allowedSorts[sort_by] || allowedSorts.created_at;
    const safeSortOrder = String(sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT
          a.*,
          j.id AS job_record_id,
          j.job_id AS linked_job_id,
          j.job_title,
          COALESCE(j.recruiter_email, a.recruiter_email) AS owning_recruiter_email,
          CASE
            WHEN a.talent_pool_only THEN 'Talent Pool Only'
            WHEN a.ats_job_id IS NOT NULL THEN 'Linked to Job'
            ELSE 'Talent Pool Only'
          END AS pool_membership,
          CASE
            WHEN a.talent_pool_only THEN COALESCE(a.talent_pool_expires_at, a.created_at + INTERVAL '6 months')
            ELSE NULL
          END AS pool_expires_at
       ${baseQuery}
       ORDER BY ${safeSortBy} ${safeSortOrder}
       LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...params, Number(limit), offset]
    );

    const summary = await pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE a.talent_pool_only = true) AS pool_only_count,
          COUNT(*) FILTER (WHERE a.ats_job_id IS NOT NULL) AS linked_to_job_count,
          COUNT(*) FILTER (
            WHERE a.talent_pool_only = true
              AND COALESCE(a.talent_pool_expires_at, a.created_at + INTERVAL '6 months') BETWEEN NOW() AND NOW() + INTERVAL '30 days'
          ) AS expiring_soon_count
        ${baseQuery}`,
      params
    );

    res.json({
      data: result.rows,
      applications: result.rows,
      total,
      ai_suggestions_count: 0,
      summary: {
        pool_only_count: Number(summary.rows[0]?.pool_only_count || 0),
        linked_to_job_count: Number(summary.rows[0]?.linked_to_job_count || 0),
        expiring_soon_count: Number(summary.rows[0]?.expiring_soon_count || 0),
      },
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('Talent pool error:', err);
    res.status(500).json({ error: 'Failed to fetch talent pool' });
  }
});

// ---------------------------------------------------------------------------
// GET /export - Export all applications as JSON array
// ---------------------------------------------------------------------------
router.get('/export', adminOrRecruiter, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, j.job_title
       FROM applications a
       LEFT JOIN jobs j ON a.ats_job_id = j.job_id
       WHERE a.active_flag = true
       ORDER BY a.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export applications' });
  }
});

// ---------------------------------------------------------------------------
// GET /duplicates - Check duplicates by candidate_email or candidate_phone
// ---------------------------------------------------------------------------
router.get('/duplicates', adminOrRecruiter, async (req, res) => {
  try {
    const { candidate_email, candidate_phone } = req.query;
    if (!candidate_email && !candidate_phone) {
      return res.status(400).json({ error: 'Provide candidate_email or candidate_phone' });
    }

    const params = [];
    let paramIdx = 0;
    const conditions = [];

    if (candidate_email) {
      paramIdx++;
      conditions.push(`a.candidate_email = $${paramIdx}`);
      params.push(candidate_email);
    }
    if (candidate_phone) {
      paramIdx++;
      conditions.push(`a.candidate_phone = $${paramIdx}`);
      params.push(candidate_phone);
    }

    const result = await pool.query(
      `SELECT a.*, j.job_title
       FROM applications a
       LEFT JOIN jobs j ON a.ats_job_id = j.job_id
       WHERE a.active_flag = true AND (${conditions.join(' OR ')})
       ORDER BY a.created_at DESC`,
      params
    );

    res.json({ duplicates: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Duplicates check error:', err);
    res.status(500).json({ error: 'Failed to check duplicates' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id - Single application with interview_feedback and candidate_documents
// ---------------------------------------------------------------------------
router.get('/:id', adminOrRecruiter, async (req, res) => {
  try {
    const { id } = req.params;
    const appResult = await pool.query(
      `SELECT a.*, j.job_title, j.department_id, j.business_unit_id
       FROM applications a
       LEFT JOIN jobs j ON a.ats_job_id = j.job_id
       WHERE a.id = $1 AND a.active_flag = true`,
      [id]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const feedbackResult = await pool.query(
      `SELECT * FROM interview_feedback WHERE application_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    const docsResult = await pool.query(
      `SELECT * FROM candidate_documents WHERE application_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    res.json({
      ...appResult.rows[0],
      interview_feedback: feedbackResult.rows,
      candidate_documents: docsResult.rows,
    });
  } catch (err) {
    console.error('Get application error:', err);
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

// ---------------------------------------------------------------------------
// POST / - Create a single application
// ---------------------------------------------------------------------------
router.post('/', adminOrRecruiter, async (req, res) => {
  try {
    const { row, duplicate, payload, isDuplicate } = await createApplicationRecord(req.body, req.user?.email);
    if (duplicate) {
      return res.status(409).json({
        error: 'Duplicate application found for this job',
        existing: duplicate,
      });
    }

    await logAudit({
      actionBy: req.user?.email,
      actionType: 'create',
      entityType: 'application',
      entityId: row.id,
      afterState: row,
    });

    if (payload.recruiter_email) {
      await sendNotificationEmail({
        to: payload.recruiter_email,
        subject: `New Application: ${row.candidate_name} - ${row.application_id}`,
        body: `A new application has been created for ${row.candidate_name} (${row.candidate_email}).`,
      }).catch(err => console.error('Notification email error:', err));
    }

    res.status(201).json({ ...row, _warnings: isDuplicate ? ['This phone number exists in another application — possible duplicate candidate'] : [] });
  } catch (err) {
    console.error('Create application error:', err);
    const statusCode = (err.message.includes('required') || err.message.includes('10 digits')) ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Failed to create application' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:id - Update application fields
// ---------------------------------------------------------------------------
router.put('/:id', adminOrRecruiter, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const existingResult = await pool.query(
      'SELECT * FROM applications WHERE id = $1 AND active_flag = true LIMIT 1',
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const existing = existingResult.rows[0];

    const fieldMap = {
      candidate_name: 'candidate_name',
      candidate_email: 'candidate_email',
      candidate_phone: 'candidate_phone',
      candidate_aadhar: 'candidate_aadhar',
      candidate_pan: 'candidate_pan',
      candidate_age: 'candidate_age',
      candidate_gender: 'candidate_gender',
      candidate_years_of_experience: 'candidate_years_of_experience',
      candidate_experience: 'candidate_years_of_experience',
      current_organization: 'current_organization',
      candidate_current_company: 'current_organization',
      current_ctc: 'current_ctc',
      candidate_current_ctc: 'current_ctc',
      current_location: 'current_location',
      candidate_location: 'current_location',
      willing_to_relocate: 'willing_to_relocate',
      willing_to_relocate_flag: 'willing_to_relocate',
      resume_path: 'resume_path',
      resume_url: 'resume_path',
      resume_file_name: 'resume_file_name',
      resume_flag: 'resume_flag',
      education_level: 'education_level',
      education_other: 'education_other',
      source: 'source',
      referrer_emp_id: 'referrer_emp_id',
      referred_by: 'referrer_emp_id',
      consultant_code: 'consultant_code',
      referral_flag: 'referral_flag',
      recruiter_email: 'recruiter_email',
      talent_pool_only: 'talent_pool_only',
      ats_job_id: 'ats_job_id',
      status: 'status',
      no_of_rounds: 'no_of_rounds',
      interviewers: 'interviewers',
      interview_datetimes: 'interview_datetimes',
      multi_apply_flag: 'multi_apply_flag',
      joining_date: 'joining_date',
      active_flag: 'active_flag',
      rejected_by_email: 'rejected_by_email',
      rejection_reason: 'rejection_reason',
      suggested_interview_datetime1: 'suggested_interview_datetime1',
      suggested_interview_datetime2: 'suggested_interview_datetime2',
      dropout_reason: 'dropout_reason',
      interviewer_feedback_remarks: 'interviewer_feedback_remarks',
      interviewer_technical_score: 'interviewer_technical_score',
      interviewer_behavioral_score: 'interviewer_behavioral_score',
      interviewer_company_fit_score: 'interviewer_company_fit_score',
      interviewer_final_decision: 'interviewer_final_decision',
    };
    const jsonFields = new Set(['interviewers', 'interview_datetimes']);

    const setClauses = [];
    const params = [];
    let paramIdx = 0;

    const updatedFieldKeys = [];
    const appliedDbFields = new Set();
    let patchedResumePath;

    for (const [key, value] of Object.entries(fields)) {
      const dbField = fieldMap[key];
      if (!dbField) continue;

      let normalizedValue;
      if (jsonFields.has(dbField)) {
        if (value === undefined) continue;
        normalizedValue = JSON.stringify(normalizeArrayInput(value));
      } else {
        const normalized = normalizePatchFieldValue(dbField, value);
        if (!normalized.include) continue;
        normalizedValue = normalized.value;
      }

      if (dbField === 'ats_job_id' && normalizedValue) {
        const rawJobValue = String(normalizedValue);
        if (!rawJobValue.startsWith('ATS-')) {
          const jobLookup = await pool.query(
            'SELECT job_id FROM jobs WHERE id = $1 AND active_flag = true LIMIT 1',
            [rawJobValue]
          );
          normalizedValue = jobLookup.rows[0]?.job_id || rawJobValue;
        }
      }

      if (dbField === 'resume_path') {
        patchedResumePath = normalizedValue;
      }

      paramIdx++;
      setClauses.push(`${dbField} = $${paramIdx}`);
      params.push(normalizedValue);
      updatedFieldKeys.push(key);
      appliedDbFields.add(dbField);
    }

    if (appliedDbFields.has('resume_path') && !appliedDbFields.has('resume_flag')) {
      paramIdx++;
      setClauses.push(`resume_flag = $${paramIdx}`);
      params.push(Boolean(patchedResumePath));
      updatedFieldKeys.push('resume_flag');
      appliedDbFields.add('resume_flag');
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    paramIdx++;
    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE applications SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND active_flag = true RETURNING *`,
      params
    );

    await logAudit({
      actionBy: req.user?.email,
      actionType: 'update',
      entityType: 'application',
      entityId: id,
      beforeState: existing,
      afterState: result.rows[0],
      details: { updated_fields: updatedFieldKeys },
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update application error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:id/interview-plan - Update interview rounds and round-wise owners
// ---------------------------------------------------------------------------
router.put('/:id/interview-plan', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const noOfRounds = Math.max(1, Math.min(3, Number(req.body.no_of_rounds || 1)));
    const interviewers = Array.isArray(req.body.interviewers) ? req.body.interviewers : [];
    if (!Array.isArray(interviewers[0]) || interviewers[0].length === 0) {
      return res.status(400).json({ error: 'At least one round 1 reviewer is required' });
    }

    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT * FROM applications WHERE id = $1 AND active_flag = true`,
      [req.params.id]
    );
    if (existingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found' });
    }

    const existing = existingResult.rows[0];
    const nextStatus = ['InQueue', 'Applied', 'Shortlisted', 'AwaitingHODResponse'].includes(existing.status)
      ? 'AwaitingHODResponse'
      : 'AwaitingInterviewScheduling';
    const updatedResult = await client.query(
      `UPDATE applications
       SET no_of_rounds = $1,
           interviewers = $2,
           status = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [noOfRounds, JSON.stringify(interviewers), nextStatus, req.params.id]
    );

    const updated = updatedResult.rows[0];
    const maxRoundResult = await client.query(
      `SELECT COALESCE(MAX(round_number), 0) AS max_round
       FROM interview_feedback
       WHERE application_id = $1`,
      [req.params.id]
    );
    const maxRound = Number(maxRoundResult.rows[0]?.max_round || 0);
    const nextRound = Math.min(noOfRounds, maxRound > 0 ? maxRound + 1 : 1);
    await ensureInterviewTasksForRound(client, updated, nextRound, nextStatus);
    await client.query(
      `UPDATE interview_feedback
       SET requested_additional_rounds = 0,
           additional_round_requested_by = NULL,
           additional_round_requested_at = NULL,
           additional_round_request_remarks = NULL,
           updated_at = NOW()
       WHERE application_id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');

    await logAudit({
      actionBy: req.user?.email,
      actionType: 'update',
      entityType: 'application',
      entityId: req.params.id,
      beforeState: {
        no_of_rounds: existing.no_of_rounds,
        interviewers: existing.interviewers,
      },
      afterState: {
        no_of_rounds: noOfRounds,
        interviewers,
        next_round: nextRound,
        status: nextStatus,
      },
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Update interview plan error:', err);
    res.status(500).json({ error: 'Failed to update interview plan' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PUT /:id/status - Change application status
// ---------------------------------------------------------------------------
router.put('/:id/status', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { status, comment, rejection_reason } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        valid_statuses: VALID_STATUSES,
      });
    }

    await client.query('BEGIN');
    const transition = await transitionApplicationStatus(
      client,
      id,
      status,
      req.user?.email,
      comment,
      { rejectionReason: rejection_reason }
    );
    await client.query('COMMIT');

    await sendStatusUpdateEmail({
      to: transition.application.candidate_email,
      candidateName: transition.application.candidate_name,
      applicationId: transition.application.application_id,
      previousStatus: transition.previousStatus,
      newStatus: status,
      comment: comment || null,
    }).catch(err => console.error('Status update email error:', err));

    if (transition.application.recruiter_email) {
      await sendNotificationEmail({
        to: transition.application.recruiter_email,
        subject: `Application Status Update: ${transition.application.candidate_name} - ${status}`,
        body: `Application ${transition.application.application_id} for ${transition.application.candidate_name} has been moved from ${transition.previousStatus} to ${status}.${comment ? ` Comment: ${comment}` : ''}`,
      }).catch(err => console.error('Notification email error:', err));
    }

    await logAudit({
      action: 'APPLICATION_STATUS_CHANGED',
      entity_type: 'application',
      entity_id: id,
      details: {
        application_id: transition.application.application_id,
        previous_status: transition.previousStatus,
        new_status: status,
        comment,
        rejection_reason: rejection_reason || null,
        task_assignments: transition.taskAssignments,
      },
      performed_by: req.user?.id,
    });

    res.json(transition.application);
  } catch (err) {
    console.error('Status change error:', err);
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.message === 'Application not found' || err.message === 'Invalid stage/status provided' || err.message === 'HR rejection reason is required' ? 400 : 500).json({ error: err.message || 'Failed to update status' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /upload-resume - Upload and parse a single resume
// ---------------------------------------------------------------------------
router.post('/upload-resume', adminOrRecruiter, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded' });
    }

    const filePath = req.file.path;
    const text = await extractTextFromResume(filePath, req.file.originalname);

    let parsed = {};
    if (text) {
      try {
        parsed = await parseResume(text);
      } catch (aiErr) {
        console.error('AI parse error:', aiErr.message);
      }
    }

    res.json({
      file: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        path: `/uploads/resumes/${req.file.filename}`,
      },
      extractedText: text.substring(0, 2000),
      parsed,
    });
  } catch (err) {
    console.error('Upload resume error:', err);
    res.status(500).json({ error: 'Failed to process resume' });
  }
});

// ---------------------------------------------------------------------------
// POST /parse-excel - Parse Excel sheet and return rows for review
// ---------------------------------------------------------------------------
router.post('/parse-excel', adminOrRecruiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    fs.unlink(req.file.path, () => {});
    res.json({ rows });
  } catch (err) {
    console.error('Parse excel error:', err);
    res.status(500).json({ error: 'Failed to parse Excel file' });
  }
});

// ---------------------------------------------------------------------------
// POST /bulk-create - Create multiple applications after review
// ---------------------------------------------------------------------------
router.post('/bulk-create', adminOrRecruiter, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'An array of candidate records is required' });
    }

    const createdRows = [];
    const skippedRows = [];
    const errorDetails = [];

    for (let index = 0; index < items.length; index += 1) {
      try {
        const { row, duplicate } = await createApplicationRecord(items[index], req.user?.email);
        if (duplicate) {
          skippedRows.push({ row: index + 1, existing: duplicate });
        } else {
          createdRows.push({ row: index + 1, id: row.id, application_id: row.application_id });
        }
      } catch (rowErr) {
        errorDetails.push({ row: index + 1, message: rowErr.message });
      }
    }

    await logAudit({
      actionBy: req.user?.email,
      actionType: 'create',
      entityType: 'application',
      entityId: 'bulk',
      metadata: {
        created: createdRows.length,
        skipped: skippedRows.length,
        errors: errorDetails.length,
      },
    });

    res.json({
      created: createdRows.length,
      skipped: skippedRows.length,
      errors: errorDetails.length,
      createdRows,
      skippedRows,
      errorDetails,
    });
  } catch (err) {
    console.error('Bulk create applications error:', err);
    res.status(500).json({ error: 'Failed to create applications' });
  }
});

// ---------------------------------------------------------------------------
// POST /bulk-upload-excel - Bulk upload applications from Excel
// ---------------------------------------------------------------------------
router.post('/bulk-upload-excel', adminOrRecruiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const created = [];
    const skipped = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row (1-based header + data)

      try {
        const candidateName = row.candidate_name || row.name || row.Name;
        const candidateEmail = row.candidate_email || row.email || row.Email;
        const candidatePhone = row.candidate_phone || row.phone || row.Phone || null;
        const atsJobId = row.ats_job_id || row.job_id || req.body?.ats_job_id || null;
        const source = row.source || row.Source || 'BulkUpload';

        if (!candidateName || !candidateEmail) {
          errors.push({ row: rowNum, reason: 'Missing candidate_name or candidate_email' });
          continue;
        }

        // Check duplicate
        if (atsJobId) {
          const dup = await pool.query(
            `SELECT id FROM applications
             WHERE active_flag = true AND ats_job_id = $1
               AND (candidate_email = $2 OR ($3::text IS NOT NULL AND candidate_phone = $3))`,
            [atsJobId, candidateEmail, candidatePhone]
          );
          if (dup.rows.length > 0) {
            skipped.push({ row: rowNum, candidate_email: candidateEmail, reason: 'Duplicate' });
            continue;
          }
        }

        const { row: createdRow } = await createApplicationRecord({
          ...row,
          candidate_name: candidateName,
          candidate_email: candidateEmail,
          candidate_phone: candidatePhone,
          ats_job_id: atsJobId,
          source,
          talent_pool_only: false,
          recruiter_email: row.recruiter_email || null,
        }, req.user?.email);

        created.push({ row: rowNum, application_id: createdRow.application_id, candidate_email: candidateEmail });
      } catch (rowErr) {
        errors.push({ row: rowNum, reason: rowErr.message });
      }
    }

    await logAudit({
      action: 'BULK_APPLICATIONS_UPLOADED',
      entity_type: 'application',
      entity_id: null,
      details: { created: created.length, skipped: skipped.length, errors: errors.length },
      performed_by: req.user?.id,
    });

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({ created, skipped, errors });
  } catch (err) {
    console.error('Bulk upload excel error:', err);
    res.status(500).json({ error: 'Failed to process bulk upload' });
  }
});

// ---------------------------------------------------------------------------
// POST /bulk-upload-resumes - Bulk upload and parse multiple resumes
// ---------------------------------------------------------------------------
router.post('/bulk-upload-resumes', adminOrRecruiter, upload.array('resumes', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No resume files uploaded' });
    }

    const results = [];

    for (const file of req.files) {
      const text = await extractTextFromResume(file.path, file.originalname);

      let parsed = {};
      if (text) {
        try {
          parsed = await parseResume(text);
        } catch (aiErr) {
          console.error('AI parse error for', file.originalname, ':', aiErr.message);
        }
      }

      results.push({
        file: {
          originalName: file.originalname,
          filename: file.filename,
          size: file.size,
          path: `/uploads/resumes/${file.filename}`,
        },
        extractedText: text.substring(0, 2000),
        parsed,
      });
    }

    res.json({ count: results.length, results });
  } catch (err) {
    console.error('Bulk upload resumes error:', err);
    res.status(500).json({ error: 'Failed to process resumes' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/move-job - Move application to a different job
// ---------------------------------------------------------------------------
router.post('/:id/move-job', adminOrRecruiter, async (req, res) => {
  try {
    const { id } = req.params;
    let { ats_job_id, target_job_id } = req.body;

    if (!ats_job_id && target_job_id) {
      const targetJob = await pool.query(
        'SELECT job_id FROM jobs WHERE (id::text = $1 OR job_id = $1) AND active_flag = true LIMIT 1',
        [String(target_job_id)]
      );
      ats_job_id = targetJob.rows[0]?.job_id || null;
    }

    if (!ats_job_id) {
      return res.status(400).json({ error: 'ats_job_id is required' });
    }

    const existing = await pool.query(
      `SELECT * FROM applications WHERE id = $1 AND active_flag = true`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const previousJobId = existing.rows[0].ats_job_id;

    const result = await pool.query(
      `UPDATE applications SET ats_job_id = $1, talent_pool_only = false, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [ats_job_id, id]
    );

    await logAudit({
      action: 'APPLICATION_MOVED_JOB',
      entity_type: 'application',
      entity_id: id,
      details: {
        application_id: existing.rows[0].application_id,
        previous_job_id: previousJobId,
        new_job_id: ats_job_id,
      },
      performed_by: req.user?.id,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Move job error:', err);
    res.status(500).json({ error: 'Failed to move application to job' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/keep-in-talent-pool - Return candidate to reusable pool
// ---------------------------------------------------------------------------
router.post('/:id/keep-in-talent-pool', adminOrRecruiter, async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT * FROM applications WHERE id = $1 AND active_flag = true`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const result = await pool.query(
      `UPDATE applications
       SET ats_job_id = NULL,
           recruiter_email = NULL,
           talent_pool_only = true,
           talent_pool_expires_at = NOW() + INTERVAL '6 months',
           status = 'InQueue',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    await logAudit({
      actionBy: req.user?.email,
      actionType: 'update',
      entityType: 'application',
      entityId: req.params.id,
      beforeState: { ats_job_id: existing.rows[0].ats_job_id, talent_pool_only: existing.rows[0].talent_pool_only },
      afterState: { ats_job_id: null, talent_pool_only: true, status: 'InQueue' },
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Keep in talent pool error:', err);
    res.status(500).json({ error: 'Failed to keep candidate in talent pool' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/ban - Ban candidate globally or for a role
// ---------------------------------------------------------------------------
router.post('/:id/ban', adminOrRecruiter, async (req, res) => {
  try {
    const scope = ['global', 'role'].includes(String(req.body.scope || '').toLowerCase())
      ? String(req.body.scope).toLowerCase()
      : 'global';
    const roleName = scope === 'role' ? String(req.body.role_name || '').trim() : null;
    const reason = String(req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'Ban reason is required' });
    }
    if (scope === 'role' && !roleName) {
      return res.status(400).json({ error: 'role_name is required for role-specific bans' });
    }

    const result = await pool.query(
      `UPDATE applications
       SET banned_flag = true,
           ban_scope = $1,
           banned_role = $2,
           banned_reason = $3,
           banned_at = NOW(),
           banned_by = $4,
           updated_at = NOW()
       WHERE id = $5 AND active_flag = true
       RETURNING *`,
      [scope, roleName, reason, req.user?.email || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await logAudit({
      actionBy: req.user?.email,
      actionType: 'update',
      entityType: 'application',
      entityId: req.params.id,
      afterState: {
        banned_flag: true,
        ban_scope: scope,
        banned_role: roleName,
        banned_reason: reason,
      },
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ban candidate error:', err);
    res.status(500).json({ error: 'Failed to ban candidate' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id - Soft delete application from active workflows
// ---------------------------------------------------------------------------
router.delete('/:id', adminOrRecruiter, async (req, res) => {
  try {
    const row = await softDeactivateApplication(req.params.id, req.user?.email);
    res.json({ message: 'Candidate removed from active workflows', application: row });
  } catch (err) {
    console.error('Delete application error:', err);
    res.status(err.message === 'Application not found' ? 404 : 500).json({ error: err.message || 'Failed to delete application' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/move-stage - Move to different hiring flow stage with comment
// ---------------------------------------------------------------------------
router.post('/:id/move-stage', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { stage, comment, rejection_reason } = req.body;

    if (!stage) {
      return res.status(400).json({ error: 'stage is required' });
    }

    await client.query('BEGIN');
    const transition = await transitionApplicationStatus(
      client,
      id,
      stage,
      req.user?.email,
      comment,
      {
        rejectionReason: rejection_reason,
        actorRole: req.user?.role,
        noOfRounds: req.body.no_of_rounds,
        interviewers: req.body.interviewers,
      }
    );
    await client.query('COMMIT');

    await logAudit({
      actionBy: req.user?.email,
      actionType: stage.includes('Rejected') ? 'reject' : 'update',
      entityType: 'application',
      entityId: id,
      beforeState: { status: transition.previousStatus },
      afterState: { status: stage, rejection_reason: rejection_reason || null },
      metadata: {
        comment: comment || null,
        rejection_reason: rejection_reason || null,
        task_assignments: transition.taskAssignments,
      },
    });

    await sendStatusUpdateEmail({
      to: transition.application.candidate_email,
      candidateName: transition.application.candidate_name,
      newStatus: stage,
      jobTitle: transition.application.ats_job_id,
    }).catch((err) => console.error('Stage move email error:', err.message));

    const taskLabel = stage === 'AwaitingHODResponse'
      ? 'candidate review'
      : `Round ${getRoundNumberFromStatus(stage)}`;
    for (const assignee of transition.taskAssignments) {
      await sendNotificationEmail({
        to: assignee,
        subject: `Interview Task Assigned: ${transition.application.candidate_name}`,
        body: `You have been assigned ${taskLabel} for ${transition.application.candidate_name}.`,
        link: '/interviews',
      }).catch((err) => console.error('Interview task notification error:', err.message));
    }

    res.json(transition.application);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Move stage error:', err);
    res.status(
      err.message === 'Application not found'
      || err.message === 'Invalid stage/status provided'
      || err.message === 'HR rejection reason is required'
      || String(err.message || '').startsWith('Cannot move candidate')
      || String(err.message || '').startsWith('Assign at least')
        ? 400
        : 500
    ).json({ error: err.message || 'Failed to move application stage' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET /job-matches/:id - AI job match suggestions for talent pool candidate
// ---------------------------------------------------------------------------
router.get('/job-matches/:id', adminOrRecruiter, async (req, res) => {
  try {
    const { id } = req.params;

    const appResult = await pool.query(
      `SELECT * FROM applications WHERE id = $1 AND active_flag = true`,
      [id]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const app = appResult.rows[0];

    // Get open jobs to match against
    const jobsResult = await pool.query(
      `SELECT
          j.job_id,
          j.job_title,
          d.department_name AS department,
          j.experience_years,
          j.job_type,
          j.job_description
       FROM jobs j
       LEFT JOIN departments d ON j.department_id = d.id
       WHERE j.status = 'open' AND j.active_flag = true`
    );

    const candidateText = [
      `Name: ${app.candidate_name || 'Unknown'}`,
      `Email: ${app.candidate_email || 'Unknown'}`,
      `Experience: ${app.candidate_years_of_experience ?? 'Unknown'} years`,
      `Current organization: ${app.current_organization || 'Unknown'}`,
      `Current location: ${app.current_location || 'Unknown'}`,
      `Education: ${app.education_level || 'Unknown'}`,
      `Source: ${app.source || 'Unknown'}`,
    ].join('\n');

    const matches = await matchCandidateToJobs(candidateText, jobsResult.rows);
    const jobsById = new Map(jobsResult.rows.map((job) => [job.job_id, job]));
    const enrichedMatches = matches.map((match) => {
      const job = jobsById.get(match.job_id) || {};
      return {
        job_id: match.job_id,
        job_title: job.job_title || null,
        department: job.department || null,
        experience_years: job.experience_years ?? null,
        score: Number(match.match_score ?? match.score ?? 0) || 0,
        reason: match.reason || null,
      };
    });

    res.json({ application_id: app.application_id, candidate_name: app.candidate_name, matches: enrichedMatches });
  } catch (err) {
    console.error('Job matches error:', err);
    res.status(500).json({ error: 'Failed to get job matches' });
  }
});

// ---------------------------------------------------------------------------
// POST /bulk-status - Bulk status update for multiple applications
// ---------------------------------------------------------------------------
router.post('/bulk-status', adminOrRecruiter, async (req, res) => {
  try {
    const { application_ids, status, comment, rejection_reason } = req.body;

    if (!application_ids || !Array.isArray(application_ids) || application_ids.length === 0) {
      return res.status(400).json({ error: 'application_ids array is required' });
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status', valid_statuses: VALID_STATUSES });
    }

    const updated = [];
    const errors = [];

    for (const appId of application_ids) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const transition = await transitionApplicationStatus(
          client,
          appId,
          status,
          req.user?.email,
          comment,
          {
            rejectionReason: rejection_reason,
            actorRole: req.user?.role,
          }
        );
        await client.query('COMMIT');

        await sendStatusUpdateEmail({
          to: transition.application.candidate_email,
          candidateName: transition.application.candidate_name,
          newStatus: status,
          jobTitle: transition.application.ats_job_id,
        }).catch(err => console.error('Bulk status email error:', err));

        const taskLabel = status === 'AwaitingHODResponse'
          ? 'candidate review'
          : `Round ${getRoundNumberFromStatus(status)}`;
        for (const assignee of transition.taskAssignments) {
          await sendNotificationEmail({
            to: assignee,
            subject: `Interview Task Assigned: ${transition.application.candidate_name}`,
            body: `You have been assigned ${taskLabel} for ${transition.application.candidate_name}.`,
            link: '/interviews',
          }).catch((err) => console.error('Bulk interview task notification error:', err.message));
        }

        updated.push({
          id: appId,
          application_id: transition.application.application_id,
          previous_status: transition.previousStatus,
          rejection_reason: rejection_reason || null,
          task_assignments: transition.taskAssignments,
        });
      } catch (rowErr) {
        await client.query('ROLLBACK').catch(() => {});
        errors.push({ id: appId, reason: rowErr.message });
      } finally {
        client.release();
      }
    }

    await logAudit({
      actionBy: req.user?.email,
      actionType: status.includes('Rejected') ? 'reject' : 'update',
      entityType: 'application',
      entityId: 'bulk',
      afterState: { status, comment, rejection_reason: rejection_reason || null },
      metadata: {
        updated_count: updated.length,
        error_count: errors.length,
        rejection_reason: rejection_reason || null,
      },
    });

    res.json({ updated, errors });
  } catch (err) {
    console.error('Bulk status error:', err);
    res.status(
      err.message === 'HR rejection reason is required'
      || String(err.message || '').startsWith('Cannot move candidate')
      || String(err.message || '').startsWith('Assign at least')
        ? 400
        : 500
    ).json({ error: err.message || 'Failed to bulk update statuses' });
  }
});

export { extractTextFromResume, createApplicationRecord };
export default router;
