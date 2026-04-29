// Phase-2 CTC breakup + comparison flow.
//
// 1. Recruiter pastes the CTC breakup table (HTML kept so Excel formatting is
//    preserved) plus an optional attachment, sends to candidate for signature.
// 2. Candidate signs (scribble) → accept; or rejects with reason.
// 3. On accept, recruiter adds a CTC comparison table + optional attachment
//    and sends to recruiter 2 for clearance.
// 4. Recruiter 2 clears (accepts) or rejects with reason — bounces back.
// 5. Cleared package goes to HR Admin via existing CTC chain.

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { logTimeline } from '../services/timeline.js';
import { sendEmail } from '../services/email.js';
import { ctcAcceptanceEmailV2, ctcReviewEmail } from '../services/txEmails.js';

const router = Router();
const hrAny = requireRole('hr_admin', 'hr_recruiter');
const candidateOnly = requireRole('applicant');

const uploadDir = path.resolve(process.cwd(), '..', 'uploads', 'ctc');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 15 * 1024 * 1024 } });

async function loadApp(id) {
  const r = await pool.query(
    `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
      WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
    [String(id)]
  );
  return r.rows[0] || null;
}

// ── Recruiter: create / update the CTC breakup ────────────────────────────
router.post('/:applicationId/breakup', hrAny, upload.single('attachment'), async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { breakup_text, breakup_html } = req.body || {};
    if (!breakup_text && !breakup_html) return res.status(400).json({ error: 'breakup_html or breakup_text required' });

    const filePath = req.file ? `/uploads/ctc/${req.file.filename}` : null;
    const fileName = req.file ? req.file.originalname : null;
    // Deactivate previous versions on same application by bumping version.
    const verQ = await pool.query(
      `SELECT COALESCE(MAX(version), 0) AS v FROM ctc_breakups WHERE application_id = $1`,
      [app.id]
    );
    const ins = await pool.query(
      `INSERT INTO ctc_breakups
         (application_id, created_by_email, breakup_text, breakup_html, attachment_path, attachment_name, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [app.id, req.user.email, breakup_text || null, breakup_html || null, filePath, fileName, Number(verQ.rows[0].v) + 1]
    );

    await pool.query(
      `UPDATE applications SET status = 'CTCAcceptance', updated_at = NOW() WHERE id = $1`,
      [app.id]
    );

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'ctc.breakup_sent',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `CTC breakup ${ins.rows[0].version > 1 ? `v${ins.rows[0].version} (revised)` : 'sent'} to candidate${fileName ? ` with attachment ${fileName}` : ''}`,
      payload: { breakup_id: ins.rows[0].id, version: ins.rows[0].version, attachment: fileName },
      toState: 'CTCAcceptance',
    });

    if (app.candidate_email) {
      sendEmail(app.candidate_email,
        `Your compensation breakup is ready — ${app.job_title}`,
        ctcAcceptanceEmailV2({ candidateName: app.candidate_name, jobTitle: app.job_title, validityDays: 14 })
      ).catch(() => {});
    }
    res.json({ breakup: ins.rows[0] });
  } catch (err) {
    console.error('breakup post error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Candidate: view active breakup ────────────────────────────────────────
router.get('/me/breakup', candidateOnly, async (req, res) => {
  const r = await pool.query(
    `SELECT b.* FROM ctc_breakups b
       JOIN applications a ON a.id = b.application_id
      WHERE LOWER(a.candidate_email) = LOWER($1)
      ORDER BY b.created_at DESC LIMIT 1`,
    [req.user.email]
  );
  res.json({ breakup: r.rows[0] || null });
});

// ── Candidate: scribble-sign accept / reject ──────────────────────────────
router.post('/me/breakup/:id/respond', candidateOnly, async (req, res) => {
  try {
    const { decision, signature_data, notes } = req.body || {};
    if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision required' });
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null;
    const r = await pool.query(
      `SELECT b.*, a.application_id, a.candidate_name, a.recruiter_email, a.secondary_recruiter_email, j.job_title
         FROM ctc_breakups b
         JOIN applications a ON a.id = b.application_id
         LEFT JOIN jobs j ON j.job_id = a.ats_job_id
        WHERE b.id = $1 AND LOWER(a.candidate_email) = LOWER($2)`,
      [Number(req.params.id), req.user.email]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Breakup not found' });
    const b = r.rows[0];
    if (b.candidate_decision) return res.status(409).json({ error: 'Already responded' });
    await pool.query(
      `UPDATE ctc_breakups
          SET candidate_decision = $1,
              candidate_decision_notes = $2,
              candidate_signature_data = $3,
              candidate_signed_at = $4,
              candidate_signature_ip = $5,
              decision_at = NOW()
        WHERE id = $6`,
      [decision, notes || null, signature_data || null, decision === 'accepted' ? new Date() : null, ip, b.id]
    );
    await pool.query(
      `UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2`,
      [decision === 'accepted' ? 'CTCAccepted' : 'SalaryRejected', b.application_id]
    );
    await logTimeline({
      entityType: 'application',
      entityId: b.application_id,
      eventType: decision === 'accepted' ? 'ctc.accepted' : 'ctc.rejected_by_candidate',
      actorEmail: req.user.email,
      actorRole: 'applicant',
      summary: decision === 'accepted'
        ? 'Candidate signed and accepted CTC breakup'
        : `Candidate rejected CTC breakup${notes ? ` — ${notes}` : ''}`,
      payload: { breakup_id: b.id, ip },
      toState: decision === 'accepted' ? 'CTCAccepted' : 'SalaryRejected',
    });
    // Notify recruiters on either decision
    const stakeholders = [b.recruiter_email, b.secondary_recruiter_email].filter(Boolean);
    if (stakeholders.length) {
      sendEmail(stakeholders,
        `${b.candidate_name} ${decision} the CTC breakup`,
        `<p>${b.candidate_name} has ${decision} the CTC breakup for ${b.job_title}.${notes ? ` Note: ${notes}` : ''}</p><p>Open the application workflow to continue the process.</p>`
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Recruiter 1: add CTC comparison + send to recruiter 2 for clearance ──
router.post('/:applicationId/comparison', hrAny, upload.single('attachment'), async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { comparison_text, comparison_html, secondary_recruiter_email } = req.body || {};
    if (!comparison_text && !comparison_html) return res.status(400).json({ error: 'comparison_html or comparison_text required' });
    const filePath = req.file ? `/uploads/ctc/${req.file.filename}` : null;
    const fileName = req.file ? req.file.originalname : null;
    const ins = await pool.query(
      `INSERT INTO ctc_comparisons
         (application_id, created_by_email, comparison_text, comparison_html, attachment_path, attachment_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [app.id, req.user.email, comparison_text || null, comparison_html || null, filePath, fileName]
    );
    if (secondary_recruiter_email) {
      await pool.query(
        `UPDATE applications SET secondary_recruiter_email = $1 WHERE id = $2`,
        [String(secondary_recruiter_email).toLowerCase(), app.id]
      );
    }
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'ctc.comparison_sent',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `CTC comparison ${fileName ? `with attachment ${fileName} ` : ''}sent to recruiter 2 for clearance`,
      payload: { comparison_id: ins.rows[0].id, attachment: fileName },
    });
    const target = secondary_recruiter_email || app.secondary_recruiter_email;
    if (target) {
      sendEmail(target,
        `CTC review: ${app.candidate_name}`,
        ctcReviewEmail({ candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'hr_recruiter' })
      ).catch(() => {});
    }
    res.json({ comparison: ins.rows[0] });
  } catch (err) {
    console.error('comparison post error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── List all ctc_breakups + comparisons for an application (HR view) ──────
router.get('/:applicationId/all', hrAny, async (req, res) => {
  const app = await loadApp(req.params.applicationId);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  const [b, c] = await Promise.all([
    pool.query(`SELECT * FROM ctc_breakups WHERE application_id = $1 ORDER BY version DESC, created_at DESC`, [app.id]),
    pool.query(`SELECT * FROM ctc_comparisons WHERE application_id = $1 ORDER BY created_at DESC`, [app.id]),
  ]);
  res.json({ breakups: b.rows, comparisons: c.rows });
});

export default router;
