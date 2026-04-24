import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';
import { logTimeline } from '../services/timeline.js';
import {
  candidatePortalInviteEmail,
  documentRequestedEmail,
  documentReviewedEmail,
  ctcAcceptanceEmail,
} from '../services/emailTemplates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const hrAny = requireRole('hr_admin', 'hr_recruiter');
const candidateOrHr = requireRole('hr_admin', 'hr_recruiter', 'applicant');
const candidateOnly = requireRole('applicant');

// ── file uploads (shared with candidates.js dir) ──────────────────────────
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/documents'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname.replace(/\s+/g, '_'));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.txt'];
    cb(ok.includes(path.extname(file.originalname).toLowerCase()) ? null : new Error('File type not allowed'), ok.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// ── helpers ───────────────────────────────────────────────────────────────

const DEFAULT_POST_SELECTION_CHECKLIST = [
  { stage: 'post_selection', name: 'Updated resume (latest)', description: 'PDF preferred; include last 3 roles and key achievements.' },
  { stage: 'post_selection', name: 'PAN Card', description: 'Clear scan of both sides.' },
  { stage: 'post_selection', name: 'Aadhaar Card', description: 'Masked version acceptable.' },
  { stage: 'post_selection', name: 'Passport photo', description: 'Recent, formal, white background.' },
  { stage: 'before_offer_release', name: 'Educational certificates', description: 'Degree + 10th + 12th marksheets.' },
  { stage: 'before_offer_release', name: 'Previous employment proof', description: 'Last 2 employers: offer letter, relieving letter, latest 3 payslips.' },
  { stage: 'before_joining', name: 'Signed offer letter', description: 'Countersigned scan with date.' },
  { stage: 'before_joining', name: 'Background check consent', description: 'We\'ll share a pre-filled form for e-signature.' },
];

async function getApplicationByPortalUser(userEmail) {
  const r = await pool.query(
    `SELECT a.*, j.job_title, j.job_id FROM applications a
     LEFT JOIN jobs j ON j.job_id = a.ats_job_id
     WHERE LOWER(a.candidate_email) = LOWER($1)
     ORDER BY a.created_at DESC LIMIT 1`,
    [userEmail]
  );
  return r.rows[0] || null;
}

// ── HR: create portal invite (called when candidate is Selected) ──────────
/**
 * POST /candidate-portal/:applicationId/invite
 * Auto-creates a user (role=applicant) for the candidate and emails
 * them a portal welcome message with login instructions.
 * Also seeds a default document checklist if none exists.
 */
router.post('/:applicationId/invite', hrAny, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { applicationId } = req.params;
    const appQ = await client.query(
      `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
       WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
      [String(applicationId)]
    );
    if (!appQ.rows.length) return res.status(404).json({ error: 'Application not found' });
    const application = appQ.rows[0];
    const email = String(application.candidate_email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Candidate has no email on file' });

    // Upsert user
    const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE users SET is_active = true, role = CASE WHEN role IS NULL OR role = '' THEN 'applicant' ELSE role END,
         name = COALESCE(NULLIF(name,''), $2) WHERE id = $1`,
        [userId, application.candidate_name]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO users (email, role, name, is_active) VALUES ($1, 'applicant', $2, true) RETURNING id`,
        [email, application.candidate_name]
      );
      userId = ins.rows[0].id;
    }

    await client.query(
      `UPDATE applications SET portal_user_id = $1, portal_invited_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [userId, application.id]
    );

    // Seed checklist if empty
    const existingDocs = await client.query(
      'SELECT COUNT(*)::int AS n FROM candidate_documents WHERE application_id = $1',
      [application.id]
    );
    if (existingDocs.rows[0].n === 0) {
      for (const item of DEFAULT_POST_SELECTION_CHECKLIST) {
        await client.query(
          `INSERT INTO candidate_documents (application_id, stage, document_name, description, status, requested_by, kind)
           VALUES ($1, $2, $3, $4, 'pending', $5, 'document')`,
          [application.id, item.stage, item.name, item.description, req.user.email]
        );
      }
    }

    await client.query('COMMIT');

    await logTimeline({
      entityType: 'application',
      entityId: application.application_id,
      eventType: 'candidate.portal_invited',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: 'Candidate portal account created + invite emailed',
      payload: { user_id: userId, email },
    });
    await logAudit({
      actionBy: req.user.email, actionType: 'create', entityType: 'application',
      entityId: application.application_id, fieldEdited: 'portal_user_id',
      afterState: { user_id: userId, email },
    });

    const portalUrl = `${process.env.APP_URL || ''}/candidate`;
    const html = candidatePortalInviteEmail({
      candidateName: application.candidate_name,
      jobTitle: application.job_title || '—',
      portalUrl,
      username: email,
      tempPassword: 'Sent separately via OTP login — use the "Request OTP" option on the login page.',
    });
    sendNotificationEmail({
      to: email,
      title: `Welcome to Premier Energies — your onboarding portal is ready`,
      message: 'Your candidate onboarding portal is live. Sign in to begin your document checklist and next steps.',
      htmlBody: html,
      actionUrl: portalUrl,
    }).catch(() => {});

    res.json({ invited: true, user_id: userId, email });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('portal invite error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── Candidate: fetch own dashboard ────────────────────────────────────────
router.get('/me', candidateOnly, async (req, res) => {
  try {
    const app = await getApplicationByPortalUser(req.user.email);
    if (!app) return res.json({ application: null, documents: [], ctc_requests: [] });

    const docs = await pool.query(
      `SELECT * FROM candidate_documents WHERE application_id = $1 ORDER BY stage, created_at ASC`,
      [app.id]
    );
    const ctcReqs = await pool.query(
      `SELECT * FROM ctc_acceptance_requests WHERE application_id = $1 ORDER BY requested_at DESC`,
      [app.id]
    );
    // Mark first login
    if (!app.portal_first_login_at) {
      await pool.query(`UPDATE applications SET portal_first_login_at = NOW() WHERE id = $1`, [app.id]);
      logTimeline({
        entityType: 'application',
        entityId: app.application_id,
        eventType: 'candidate.first_login',
        actorEmail: req.user.email,
        actorRole: 'applicant',
        summary: 'Candidate logged into portal for the first time',
      }).catch(() => {});
    }

    res.json({
      application: {
        application_id: app.application_id,
        candidate_name: app.candidate_name,
        candidate_email: app.candidate_email,
        status: app.status,
        job_title: app.job_title,
        job_id: app.job_id,
        joining_date: app.joining_date,
      },
      documents: docs.rows,
      ctc_requests: ctcReqs.rows,
    });
  } catch (err) {
    console.error('portal me error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Candidate: upload (or re-upload) a document ───────────────────────────
router.post('/documents/:docId/upload', candidateOnly, upload.single('file'), async (req, res) => {
  try {
    const { docId } = req.params;
    const app = await getApplicationByPortalUser(req.user.email);
    if (!app) return res.status(403).json({ error: 'No linked application' });

    const docQ = await pool.query(
      `SELECT * FROM candidate_documents WHERE id = $1 AND application_id = $2`,
      [Number(docId), app.id]
    );
    if (!docQ.rows.length) return res.status(404).json({ error: 'Document not found' });
    const doc = docQ.rows[0];

    if (!req.file) return res.status(400).json({ error: 'File required' });
    const filePath = `/uploads/documents/${req.file.filename}`;

    const updated = await pool.query(
      `UPDATE candidate_documents SET
         file_path = $1, file_name = $2, status = 'uploaded',
         uploaded_at = NOW(), uploaded_by_email = $3,
         version = COALESCE(version, 1) + CASE WHEN file_path IS NOT NULL THEN 1 ELSE 0 END,
         rejection_reason = NULL, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [filePath, req.file.originalname, req.user.email, doc.id]
    );

    await logTimeline({
      entityType: 'document',
      entityId: `${app.application_id}:${doc.id}`,
      eventType: 'document.uploaded',
      stage: doc.stage,
      actorEmail: req.user.email,
      actorRole: 'applicant',
      summary: `Candidate uploaded ${doc.document_name} (v${updated.rows[0].version})`,
      payload: { file: req.file.originalname, version: updated.rows[0].version },
      fromState: doc.status,
      toState: 'uploaded',
    });

    // Notify recruiters
    const recruiterEmails = [app.recruiter_email, app.secondary_recruiter_email].filter(Boolean);
    for (const to of recruiterEmails) {
      sendNotificationEmail({
        to,
        title: `${app.candidate_name} uploaded ${doc.document_name}`,
        message: `New document awaiting review.`,
        actionUrl: `/applications/${app.application_id}`,
      }).catch(() => {});
    }

    res.json({ document: updated.rows[0] });
  } catch (err) {
    console.error('portal upload error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── HR: list pending documents across all candidates (review queue) ───────
router.get('/review-queue', hrAny, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT d.*, a.application_id, a.candidate_name, a.candidate_email, a.status AS application_status,
              j.job_title, j.job_id
       FROM candidate_documents d
       JOIN applications a ON a.id = d.application_id
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
       WHERE d.status = 'uploaded'
       ORDER BY d.uploaded_at ASC NULLS LAST`
    );
    res.json({ items: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HR: approve/reject a document with comments ───────────────────────────
router.post('/documents/:docId/review', hrAny, async (req, res) => {
  try {
    const { docId } = req.params;
    const { decision, review_notes } = req.body || {}; // 'accepted' | 'rejected'
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be accepted or rejected' });
    }
    if (decision === 'rejected' && !String(review_notes || '').trim()) {
      return res.status(400).json({ error: 'Review notes required when rejecting' });
    }

    const docQ = await pool.query(
      `SELECT d.*, a.application_id, a.candidate_name, a.candidate_email FROM candidate_documents d
       JOIN applications a ON a.id = d.application_id WHERE d.id = $1`,
      [Number(docId)]
    );
    if (!docQ.rows.length) return res.status(404).json({ error: 'Document not found' });
    const doc = docQ.rows[0];

    const updated = await pool.query(
      `UPDATE candidate_documents SET
         status = $1, review_notes = $2, rejection_reason = $3,
         reviewed_at = NOW(), reviewed_by = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [decision, review_notes || null, decision === 'rejected' ? review_notes : null, req.user.email, doc.id]
    );

    await logTimeline({
      entityType: 'document',
      entityId: `${doc.application_id}:${doc.id}`,
      eventType: decision === 'accepted' ? 'document.accepted' : 'document.rejected',
      stage: doc.stage,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `${doc.document_name} ${decision}${review_notes ? ` — ${review_notes}` : ''}`,
      fromState: 'uploaded',
      toState: decision,
      payload: { review_notes },
    });

    const html = documentReviewedEmail({
      candidateName: doc.candidate_name,
      documentName: doc.document_name,
      decision,
      reviewerNotes: review_notes,
      portalUrl: `${process.env.APP_URL || ''}/candidate`,
    });
    sendNotificationEmail({
      to: doc.candidate_email,
      title: decision === 'accepted' ? `${doc.document_name} accepted` : `${doc.document_name} needs changes`,
      message: decision === 'accepted' ? 'Approved.' : review_notes,
      htmlBody: html,
      actionUrl: '/candidate',
    }).catch(() => {});

    res.json({ document: updated.rows[0] });
  } catch (err) {
    console.error('document review error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── HR: request a new document from a candidate ───────────────────────────
router.post('/:applicationId/documents/request', hrAny, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { stage, document_name, description } = req.body || {};
    if (!stage || !document_name) return res.status(400).json({ error: 'stage and document_name are required' });

    const appQ = await pool.query(
      `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
       WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
      [String(applicationId)]
    );
    if (!appQ.rows.length) return res.status(404).json({ error: 'Application not found' });
    const application = appQ.rows[0];

    const ins = await pool.query(
      `INSERT INTO candidate_documents (application_id, stage, document_name, description, status, requested_by, kind)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'document') RETURNING *`,
      [application.id, stage, document_name, description || null, req.user.email]
    );

    await logTimeline({
      entityType: 'document',
      entityId: `${application.application_id}:${ins.rows[0].id}`,
      eventType: 'document.requested',
      stage,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `Requested: ${document_name}`,
      toState: 'pending',
    });

    const html = documentRequestedEmail({
      candidateName: application.candidate_name,
      jobTitle: application.job_title || '—',
      stage,
      items: [{ document_name, description }],
      portalUrl: `${process.env.APP_URL || ''}/candidate`,
    });
    sendNotificationEmail({
      to: application.candidate_email,
      title: `Document requested: ${document_name}`,
      message: `Please upload ${document_name} in your candidate portal.`,
      htmlBody: html,
      actionUrl: '/candidate',
    }).catch(() => {});

    res.json({ document: ins.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HR: request CTC acceptance ────────────────────────────────────────────
router.post('/:applicationId/ctc-request', hrAny, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { ctc_snapshot, ctc_text } = req.body || {};

    const appQ = await pool.query(
      `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
       WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
      [String(applicationId)]
    );
    if (!appQ.rows.length) return res.status(404).json({ error: 'Application not found' });
    const application = appQ.rows[0];

    const token = crypto.randomBytes(24).toString('hex');
    const ins = await pool.query(
      `INSERT INTO ctc_acceptance_requests (application_id, requested_by, ctc_snapshot, ctc_text, token)
       VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *`,
      [application.id, req.user.email, JSON.stringify(ctc_snapshot || {}), ctc_text || null, token]
    );

    await logTimeline({
      entityType: 'application',
      entityId: application.application_id,
      eventType: 'ctc.acceptance_requested',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: 'CTC acceptance requested from candidate',
      payload: { request_id: ins.rows[0].id },
    });

    const html = ctcAcceptanceEmail({
      candidateName: application.candidate_name,
      jobTitle: application.job_title || '—',
      ctcText: ctc_text || 'See attached details',
      portalUrl: `${process.env.APP_URL || ''}/candidate`,
    });
    sendNotificationEmail({
      to: application.candidate_email,
      title: `CTC offer sheet — please review`,
      message: 'Your compensation summary is ready for review.',
      htmlBody: html,
      actionUrl: '/candidate',
    }).catch(() => {});

    res.json({ request: ins.rows[0] });
  } catch (err) {
    console.error('ctc request error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Candidate: respond to a CTC acceptance request ────────────────────────
router.post('/ctc-request/:requestId/respond', candidateOnly, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, response_notes } = req.body || {}; // 'accepted' | 'declined' | 'renegotiated'
    if (!['accepted', 'declined', 'renegotiated'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision' });
    }

    const app = await getApplicationByPortalUser(req.user.email);
    if (!app) return res.status(403).json({ error: 'No linked application' });

    const rq = await pool.query(
      `SELECT * FROM ctc_acceptance_requests WHERE id = $1 AND application_id = $2`,
      [Number(requestId), app.id]
    );
    if (!rq.rows.length) return res.status(404).json({ error: 'CTC request not found' });
    if (rq.rows[0].status !== 'pending') return res.status(409).json({ error: 'Already responded' });

    const updated = await pool.query(
      `UPDATE ctc_acceptance_requests SET status = $1, response_notes = $2, responded_at = NOW()
       WHERE id = $3 RETURNING *`,
      [decision, response_notes || null, rq.rows[0].id]
    );

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id,
      eventType: `ctc.${decision}`,
      actorEmail: req.user.email,
      actorRole: 'applicant',
      summary: `Candidate ${decision} CTC offer${response_notes ? ` — ${response_notes}` : ''}`,
      payload: { request_id: updated.rows[0].id, response_notes },
    });

    // Notify requesting recruiter
    const requester = rq.rows[0].requested_by;
    sendNotificationEmail({
      to: requester,
      title: `${app.candidate_name} ${decision} CTC offer`,
      message: response_notes || `Candidate ${decision} the CTC offer.`,
      actionUrl: `/applications/${app.application_id}`,
    }).catch(() => {});

    res.json({ request: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
