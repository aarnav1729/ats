// Phase-2 CTC breakup + comparison flow.
//
// 1. Recruiter pastes the CTC breakup table (HTML kept so Excel formatting is
//    preserved) plus an optional attachment, sends to candidate for signature.
// 2. Candidate signs (scribble) → accept; or rejects with reason.
// 3. On accept, recruiter adds a CTC comparison table + optional attachment
//    and sends to recruiter 2 for clearance.
// 4. Recruiter 2 clears (accepts) or rejects with reason  bounces back.
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
        `Your compensation breakup is ready  ${app.job_title}`,
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
      `SELECT b.*, b.application_id AS app_id, a.application_id AS application_code,
              a.candidate_name, a.recruiter_email, a.secondary_recruiter_email, j.job_title
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
      [decision === 'accepted' ? 'CTCAccepted' : 'SalaryRejected', b.app_id]
    );
    await logTimeline({
      entityType: 'application',
      entityId: b.application_code || b.app_id,
      eventType: decision === 'accepted' ? 'ctc.accepted' : 'ctc.rejected_by_candidate',
      actorEmail: req.user.email,
      actorRole: 'applicant',
      summary: decision === 'accepted'
        ? 'Candidate signed and accepted CTC breakup'
        : `Candidate rejected CTC breakup${notes ? `  ${notes}` : ''}`,
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
// Now also returns approvers + the latest "package" so HR admin all-view can
// render everything in one shot.
router.get('/:applicationId/all', hrAny, async (req, res) => {
  const app = await loadApp(req.params.applicationId);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  const [b, c, approvers] = await Promise.all([
    pool.query(`SELECT * FROM ctc_breakups WHERE application_id = $1 ORDER BY version DESC, created_at DESC`, [app.id]),
    pool.query(`SELECT * FROM ctc_comparisons WHERE application_id = $1 ORDER BY created_at DESC`, [app.id]),
    pool.query(`SELECT * FROM ctc_approvers WHERE application_id = $1 ORDER BY created_at ASC`, [app.id]),
  ]);
  res.json({
    application: { id: app.id, application_id: app.application_id, status: app.status, candidate_name: app.candidate_name, candidate_email: app.candidate_email, recruiter_email: app.recruiter_email, secondary_recruiter_email: app.secondary_recruiter_email, job_title: app.job_title, ats_job_id: app.ats_job_id },
    breakups: b.rows,
    active_breakup: b.rows[0] || null,
    comparisons: c.rows,
    approvers: approvers.rows,
  });
});

// ── Recruiter 2: clear (or bounce) the CTC package to HR Admin ───────────
router.post('/:applicationId/r2-clear', hrAny, async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { decision, notes } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved | rejected' });
    }
    if (decision === 'rejected' && !String(notes || '').trim()) {
      return res.status(400).json({ error: 'notes required when sending back to recruiter 1' });
    }

    const bq = await pool.query(
      `SELECT * FROM ctc_breakups WHERE application_id = $1 ORDER BY version DESC, created_at DESC LIMIT 1`,
      [app.id]
    );
    if (!bq.rows.length) return res.status(409).json({ error: 'No CTC breakup yet for this candidate' });
    const breakup = bq.rows[0];
    if (breakup.candidate_decision !== 'accepted') {
      return res.status(409).json({ error: 'Candidate has not accepted the CTC breakup yet' });
    }

    await pool.query(
      `UPDATE ctc_breakups
          SET r2_decision = $1, r2_email = $2, r2_acted_at = NOW(), r2_notes = $3
        WHERE id = $4`,
      [decision, req.user.email, notes || null, breakup.id]
    );

    if (decision === 'approved') {
      const admins = await pool.query(`SELECT email FROM users WHERE role = 'hr_admin' AND is_active = true`);
      const list = admins.rows.map((r) => r.email);
      if (list.length) {
        sendEmail(list, `CTC ready for HR Admin: ${app.candidate_name}`, ctcReviewEmail({
          candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'hr_admin',
        })).catch(() => {});
      }
    } else if (app.recruiter_email) {
      sendEmail(app.recruiter_email, `CTC sent back: ${app.candidate_name}`, ctcReviewEmail({
        candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'hr_recruiter',
      })).catch(() => {});
    }

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: decision === 'approved' ? 'ctc.r2_cleared' : 'ctc.r2_rejected',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: decision === 'approved'
        ? 'Recruiter 2 cleared CTC package, forwarded to HR Admin'
        : `Recruiter 2 sent CTC package back to recruiter 1${notes ? ` - ${notes}` : ''}`,
      payload: { breakup_id: breakup.id, notes },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('r2-clear error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── HR Admin: approve / reject / renegotiate / forward to approvers ──────
router.post('/:applicationId/admin-decide', requireRole('hr_admin'), async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { decision, notes, approver_emails, skip_doc_recheck } = req.body || {};
    if (!['approved', 'rejected', 'renegotiate', 'forward'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved | rejected | renegotiate | forward' });
    }
    if (decision === 'rejected' && !String(notes || '').trim()) {
      return res.status(400).json({ error: 'notes required when rejecting' });
    }
    if (decision === 'forward' && (!Array.isArray(approver_emails) || !approver_emails.length)) {
      return res.status(400).json({ error: 'approver_emails (array) required when forwarding' });
    }

    const bq = await pool.query(
      `SELECT * FROM ctc_breakups WHERE application_id = $1 ORDER BY version DESC, created_at DESC LIMIT 1`,
      [app.id]
    );
    if (!bq.rows.length) return res.status(409).json({ error: 'No CTC breakup yet' });
    const breakup = bq.rows[0];

    await pool.query(
      `UPDATE ctc_breakups
          SET admin_decision = $1, admin_email = $2, admin_acted_at = NOW(), admin_notes = $3,
              skip_doc_recheck = COALESCE($4, skip_doc_recheck)
        WHERE id = $5`,
      [decision, req.user.email, notes || null, skip_doc_recheck === true, breakup.id]
    );

    let newStatus = app.status;
    if (decision === 'approved') {
      newStatus = 'OfferInProcess';
      await pool.query(`UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, app.id]);
      const recipients = [app.recruiter_email, app.secondary_recruiter_email].filter(Boolean);
      if (recipients.length) {
        sendEmail(recipients, `CTC approved - release offer: ${app.candidate_name}`, ctcReviewEmail({
          candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'hr_recruiter',
        })).catch(() => {});
      }
    } else if (decision === 'rejected') {
      newStatus = 'TalentPool';
      await pool.query(
        `UPDATE applications SET status = 'TalentPool', ats_job_id = 'TP-POOL',
                talent_pool_only = true, updated_at = NOW() WHERE id = $1`,
        [app.id]
      );
      // Record TP movement so the historical timeline shows where they came from.
      await pool.query(
        `INSERT INTO talent_pool_movements
           (application_id, candidate_email, candidate_phone, from_job_id, from_status,
            moved_by_email, moved_by_role, reason)
         VALUES ($1, $2, $3, $4, $5, $6, 'hr_admin', $7)`,
        [app.id, app.candidate_email, app.candidate_phone, app.ats_job_id, app.status,
         req.user.email, `CTC rejected: ${notes}`]
      );
    } else if (decision === 'renegotiate') {
      newStatus = 'CTCSent';
      await pool.query(`UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, app.id]);
      if (app.recruiter_email) {
        sendEmail(app.recruiter_email, `CTC renegotiation: ${app.candidate_name}`, ctcReviewEmail({
          candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'hr_recruiter',
        })).catch(() => {});
      }
    } else if (decision === 'forward') {
      await pool.query(`DELETE FROM ctc_approvers WHERE application_id = $1`, [app.id]);
      for (const email of approver_emails) {
        await pool.query(
          `INSERT INTO ctc_approvers (application_id, breakup_id, assignee_email, created_by_email)
           VALUES ($1, $2, $3, $4)`,
          [app.id, breakup.id, String(email).toLowerCase(), req.user.email]
        );
      }
      sendEmail(approver_emails, `CTC approval needed: ${app.candidate_name}`, ctcReviewEmail({
        candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'approver',
      })).catch(() => {});
    }

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: `ctc.admin_${decision}`,
      actorEmail: req.user.email,
      actorRole: 'hr_admin',
      summary: decision === 'approved' ? 'HR Admin approved CTC - moved to OfferInProcess'
        : decision === 'rejected' ? `HR Admin rejected CTC and parked in talent pool - ${notes}`
        : decision === 'renegotiate' ? `HR Admin sent CTC back for renegotiation${notes ? ` - ${notes}` : ''}`
        : `HR Admin forwarded CTC to ${approver_emails.length} approver${approver_emails.length === 1 ? '' : 's'}`,
      payload: { decision, notes, approver_emails, skip_doc_recheck },
      fromState: app.status,
      toState: newStatus,
    });

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('admin-decide error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Approver: act on the assignment (all must approve) ────────────────────
router.post('/:applicationId/approver-act', async (req, res) => {
  try {
    const callerEmail = String(req.user?.email || '').toLowerCase();
    if (!callerEmail) return res.status(401).json({ error: 'Authentication required' });
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { decision, comments } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved | rejected' });
    }
    if (decision === 'rejected' && !String(comments || '').trim()) {
      return res.status(400).json({ error: 'comments required when rejecting' });
    }

    const my = await pool.query(
      `SELECT * FROM ctc_approvers WHERE application_id = $1 AND LOWER(assignee_email) = $2 AND status = 'pending' LIMIT 1`,
      [app.id, callerEmail]
    );
    if (!my.rows.length) return res.status(403).json({ error: 'You have no pending approval for this candidate' });

    await pool.query(
      `UPDATE ctc_approvers SET status = $1, comments = $2, acted_at = NOW() WHERE id = $3`,
      [decision, comments || null, my.rows[0].id]
    );

    const all = await pool.query(`SELECT status FROM ctc_approvers WHERE application_id = $1`, [app.id]);
    const anyRejected = all.rows.some((r) => r.status === 'rejected');
    const allApproved = all.rows.length > 0 && all.rows.every((r) => r.status === 'approved');

    let newStatus = app.status;
    if (anyRejected) {
      await pool.query(
        `UPDATE applications SET ats_job_id = 'TP-POOL', status = 'TalentPool',
                talent_pool_only = true, updated_at = NOW() WHERE id = $1`,
        [app.id]
      );
      await pool.query(
        `INSERT INTO talent_pool_movements (application_id, candidate_email, candidate_phone,
            from_job_id, from_status, moved_by_email, moved_by_role, reason)
         VALUES ($1, $2, $3, $4, $5, $6, 'approver', $7)`,
        [app.id, app.candidate_email, app.candidate_phone, app.ats_job_id, app.status,
         callerEmail, `CTC rejected by approver: ${comments}`]
      );
      newStatus = 'TalentPool';
    } else if (allApproved) {
      await pool.query(`UPDATE applications SET status = 'OfferInProcess', updated_at = NOW() WHERE id = $1`, [app.id]);
      newStatus = 'OfferInProcess';
    }

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: `ctc.approver_${decision}`,
      actorEmail: callerEmail,
      actorRole: req.user.role || 'approver',
      summary: decision === 'approved'
        ? `Approver ${callerEmail} approved the CTC${allApproved ? ' (all approvers cleared)' : ''}`
        : `Approver ${callerEmail} rejected the CTC - ${comments}`,
      payload: { comments, anyRejected, allApproved },
      toState: newStatus !== app.status ? newStatus : undefined,
    });

    res.json({ ok: true, status: newStatus, allApproved, anyRejected });
  } catch (err) {
    console.error('approver-act error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Approver inbox (sidebar widget) ──────────────────────────────────────
router.get('/me/approver-tasks', async (req, res) => {
  const email = String(req.user?.email || '').toLowerCase();
  if (!email) return res.status(401).json({ error: 'Authentication required' });
  const r = await pool.query(`
    SELECT ca.*, a.application_id, a.candidate_name, a.candidate_email, a.status AS app_status,
           j.job_title, b.breakup_html, b.breakup_text, b.attachment_path, b.attachment_name
      FROM ctc_approvers ca
      JOIN applications a ON a.id = ca.application_id
      LEFT JOIN jobs j ON j.job_id = a.ats_job_id
      LEFT JOIN ctc_breakups b ON b.id = ca.breakup_id
     WHERE LOWER(ca.assignee_email) = $1
     ORDER BY ca.created_at DESC`, [email]);
  res.json({ tasks: r.rows });
});

export default router;
