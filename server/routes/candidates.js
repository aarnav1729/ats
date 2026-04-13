import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const adminOnly = requireRole('hr_admin');
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter');
const adminOrApplicant = requireRole('hr_admin', 'applicant');
const adminOrRecruiterOrApplicant = requireRole('hr_admin', 'hr_recruiter', 'applicant');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads/documents'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

const STAGE_ALIASES = {
  'Before Offer Release': 'before_offer_release',
  'After Offer Release': 'after_offer_release',
  'After Offer Acceptance': 'after_offer_acceptance',
  'Before Joining': 'before_joining',
  'Joining Day': 'joining_day',
  'After Joining': 'after_joining',
};

function normalizeStage(stage) {
  return STAGE_ALIASES[stage] || stage || 'before_offer_release';
}

// GET /my-tasks - Candidate's own document requests grouped by stage
router.get('/my-tasks', requireRole('applicant', 'hr_admin'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'hr_admin';
    let query = `
      SELECT dr.*, a.candidate_name, a.ats_job_id, a.status as app_status,
             j.job_title
      FROM candidate_documents dr
      JOIN applications a ON dr.application_id = a.id
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
    `;
    const params = [];

    if (!isAdmin) {
      params.push(req.user.email);
      query += ` WHERE a.candidate_email = $${params.length}`;
    }

    query += ' ORDER BY dr.stage, dr.created_at DESC';

    const result = await pool.query(query, params);

    // Group by stage
    const grouped = {};
    for (const row of result.rows) {
      const stage = row.stage || 'general';
      if (!grouped[stage]) grouped[stage] = [];
      grouped[stage].push(row);
    }

    res.json({ tasks: grouped, total: result.rows.length });
  } catch (err) {
    console.error('My tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:applicationId/documents - List all document requests for an application
router.get('/:applicationId/documents', adminOrRecruiterOrApplicant, async (req, res) => {
  try {
    const { applicationId } = req.params;

    // Verify access for applicants
    if (req.user.role === 'applicant') {
      const appCheck = await pool.query(
        'SELECT id FROM applications WHERE id = $1 AND candidate_email = $2',
        [applicationId, req.user.email]
      );
      if (appCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT dr.*, a.candidate_name, a.candidate_email
       FROM candidate_documents dr
       JOIN applications a ON dr.application_id = a.id
       WHERE dr.application_id = $1
       ORDER BY dr.created_at DESC`,
      [applicationId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('List documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:applicationId/documents - HR creates a document request
router.post('/:applicationId/documents', adminOrRecruiter, async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { stage, document_name, description } = req.body;

    if (!document_name) return res.status(400).json({ error: 'document_name is required' });

    const app = await pool.query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    if (app.rows.length === 0) return res.status(404).json({ error: 'Application not found' });

    const result = await pool.query(
      `INSERT INTO candidate_documents (application_id, stage, document_name, description, status, requested_by)
       VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [applicationId, normalizeStage(stage), document_name, description, req.user.email]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'create',
      entityType: 'document_request',
      entityId: result.rows[0].id,
      afterState: result.rows[0]
    });

    // Notify candidate
    if (app.rows[0].candidate_email) {
      await sendNotificationEmail(
        app.rows[0].candidate_email,
        'Document Required - ATS',
        `<p>Dear ${app.rows[0].candidate_name},</p><p>A new document has been requested: <strong>${document_name}</strong>.</p><p>Please log in to the portal to upload the required document.</p>`
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create document request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:applicationId/documents/:docId/upload - Candidate uploads document
router.post('/:applicationId/documents/:docId/upload', adminOrRecruiterOrApplicant, upload.single('file'), async (req, res) => {
  try {
    const { applicationId, docId } = req.params;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Verify access for applicants
    if (req.user.role === 'applicant') {
      const appCheck = await pool.query(
        'SELECT id FROM applications WHERE id = $1 AND candidate_email = $2',
        [applicationId, req.user.email]
      );
      if (appCheck.rows.length === 0) return res.status(403).json({ error: 'Access denied' });
    }

    const existing = await pool.query(
      'SELECT * FROM candidate_documents WHERE id = $1 AND application_id = $2',
      [docId, applicationId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Document request not found' });

    const filePath = `/uploads/documents/${req.file.filename}`;

    const result = await pool.query(
      `UPDATE candidate_documents
       SET file_path = $1, file_name = $2, status = 'uploaded', uploaded_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [filePath, req.file.originalname, docId]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'upload',
      entityType: 'document_request',
      entityId: docId,
      beforeState: { status: existing.rows[0].status },
      afterState: { status: 'uploaded', file_path: filePath }
    });

    // Notify HR about upload
    const app = await pool.query('SELECT recruiter_email, candidate_name FROM applications WHERE id = $1', [applicationId]);
    if (app.rows[0]?.recruiter_email) {
      await sendNotificationEmail(
        app.rows[0].recruiter_email,
        'Document Uploaded by Candidate',
        `<p>Candidate <strong>${app.rows[0].candidate_name}</strong> has uploaded the document: <strong>${existing.rows[0].document_name}</strong>.</p>`
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Upload document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:applicationId/documents/:docId/review - HR accepts or rejects
router.put('/:applicationId/documents/:docId/review', adminOrRecruiter, async (req, res) => {
  try {
    const { applicationId, docId } = req.params;
    const { status, rejection_reason } = req.body;

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'accepted' or 'rejected'" });
    }

    const existing = await pool.query(
      'SELECT * FROM candidate_documents WHERE id = $1 AND application_id = $2',
      [docId, applicationId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Document request not found' });

    const result = await pool.query(
      `UPDATE candidate_documents
       SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status, status === 'rejected' ? rejection_reason : null, req.user.email, docId]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: status === 'accepted' ? 'approve' : 'reject',
      entityType: 'document_request',
      entityId: docId,
      beforeState: { status: existing.rows[0].status },
      afterState: { status, rejection_reason }
    });

    // Notify candidate
    const app = await pool.query('SELECT candidate_email, candidate_name FROM applications WHERE id = $1', [applicationId]);
    if (app.rows[0]?.candidate_email) {
      const subject = status === 'accepted' ? 'Document Accepted' : 'Document Rejected - Action Required';
      const body = status === 'accepted'
        ? `<p>Dear ${app.rows[0].candidate_name},</p><p>Your document <strong>${existing.rows[0].document_name}</strong> has been accepted.</p>`
        : `<p>Dear ${app.rows[0].candidate_name},</p><p>Your document <strong>${existing.rows[0].document_name}</strong> has been rejected.</p><p>Reason: ${rejection_reason}</p><p>Please re-upload the correct document.</p>`;
      await sendNotificationEmail(app.rows[0].candidate_email, subject, body);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Review document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:applicationId/documents/:docId/remind - HR sends reminder
router.post('/:applicationId/documents/:docId/remind', adminOrRecruiter, async (req, res) => {
  try {
    const { applicationId, docId } = req.params;
    const { subject, html_body } = req.body || {};

    const existing = await pool.query(
      'SELECT * FROM candidate_documents WHERE id = $1 AND application_id = $2',
      [docId, applicationId]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Document request not found' });

    const app = await pool.query('SELECT candidate_email, candidate_name FROM applications WHERE id = $1', [applicationId]);
    if (!app.rows[0]?.candidate_email) return res.status(400).json({ error: 'No candidate email found' });

    await sendNotificationEmail({
      to: app.rows[0].candidate_email,
      subject: subject || 'Reminder: Document Required - Premier Energies ATS',
      htmlBody: html_body || `
        <p style="margin:0 0 14px;color:#475569;line-height:1.7;">Dear ${app.rows[0].candidate_name},</p>
        <p style="margin:0 0 14px;color:#475569;line-height:1.7;">This is a reminder to upload the required document: <strong>${existing.rows[0].document_name}</strong>.</p>
        ${existing.rows[0].description ? `<p style="margin:0 0 14px;color:#475569;line-height:1.7;">${existing.rows[0].description}</p>` : ''}
        <div style="margin-top:18px;border:1px solid #dbeafe;border-radius:18px;background:linear-gradient(135deg,#eef4ff,#f8fbff);padding:18px 20px;">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#1d4ed8;">Requested document</p>
          <p style="margin:10px 0 0;color:#1e293b;line-height:1.7;">Document: <strong>${existing.rows[0].document_name}</strong><br />Stage: <strong>${String(existing.rows[0].stage || '').replace(/_/g, ' ')}</strong></p>
        </div>
        <p style="margin:14px 0 0;color:#475569;line-height:1.7;">Please log in to the ATS portal to upload the document at your earliest convenience.</p>
      `,
    });

    await pool.query(
      'UPDATE candidate_documents SET last_reminded_at = NOW(), updated_at = NOW() WHERE id = $1',
      [docId]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'reminder',
      entityType: 'document_request',
      entityId: docId,
      afterState: { reminded: true, candidate_email: app.rows[0].candidate_email }
    });

    res.json({ message: 'Reminder sent' });
  } catch (err) {
    console.error('Remind error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
