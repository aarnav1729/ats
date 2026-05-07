// Blacklist API: bans a candidate phone from future applications, notifies
// admins with a structured alert (resume attached if available), and writes
// rich audit + timeline events.

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { logTimeline } from '../services/timeline.js';
import { sendEmail } from '../services/email.js';
import { blacklistAdminAlertEmail } from '../services/txEmails.js';

const router = Router();
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter');

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '').slice(-12);
}

// GET /blacklist  list current bans
router.get('/', adminOrRecruiter, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT id, phone, candidate_name, candidate_email, reason,
              blacklisted_by_email, blacklisted_at, lifted_at, lifted_by_email
         FROM blacklisted_phones
         ORDER BY blacklisted_at DESC`
    );
    res.json({ items: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /blacklist/check  { phone } → { blacklisted, reason }
// Used by /public/jobs/:id/apply to reject banned phones.
router.post('/check', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.json({ blacklisted: false });
  const r = await pool.query(
    `SELECT phone, reason FROM blacklisted_phones
      WHERE phone = $1 AND lifted_at IS NULL LIMIT 1`,
    [phone]
  );
  res.json({ blacklisted: r.rows.length > 0, reason: r.rows[0]?.reason || null });
});

// POST /blacklist  { application_id, reason }
router.post('/', adminOrRecruiter, async (req, res) => {
  try {
    const { application_id, reason } = req.body || {};
    if (!application_id || !String(reason || '').trim()) {
      return res.status(400).json({ error: 'application_id and reason are required' });
    }

    const appQ = await pool.query(
      `SELECT a.*, j.job_title FROM applications a
         LEFT JOIN jobs j ON j.job_id = a.ats_job_id
        WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
      [String(application_id)]
    );
    if (!appQ.rows.length) return res.status(404).json({ error: 'Application not found' });
    const app = appQ.rows[0];
    const phone = normalizePhone(app.candidate_phone);
    if (!phone) return res.status(400).json({ error: 'Candidate has no phone on record; cannot blacklist.' });

    // Upsert the ban
    await pool.query(
      `INSERT INTO blacklisted_phones (phone, candidate_email, candidate_name, reason, blacklisted_by_email)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (phone) DO UPDATE SET
            reason = EXCLUDED.reason,
            blacklisted_by_email = EXCLUDED.blacklisted_by_email,
            blacklisted_at = NOW(),
            lifted_at = NULL,
            lifted_by_email = NULL`,
      [phone, app.candidate_email, app.candidate_name, reason, req.user.email]
    );

    // Move the application status
    await pool.query(
      `UPDATE applications SET status = 'Blacklisted', updated_at = NOW() WHERE id = $1`,
      [app.id]
    );

    // Audit + timeline
    await logAudit({
      actionBy: req.user.email,
      actionType: 'blacklist',
      entityType: 'application',
      entityId: app.id,
      beforeState: { status: app.status },
      afterState: { status: 'Blacklisted', phone, reason },
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'application.blacklisted',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `Candidate blacklisted (${reason})`,
      payload: { phone, reason, ats_job_id: app.ats_job_id },
      fromState: app.status,
      toState: 'Blacklisted',
    });

    // Notify admins with full details + resume URL
    const admins = await pool.query(
      `SELECT email, name FROM users WHERE role = 'hr_admin' AND is_active = true`
    );
    const recruiterRow = await pool.query(
      `SELECT email, name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [req.user.email]
    );
    const recruiter = recruiterRow.rows[0] || { email: req.user.email, name: '' };

    const resumeUrl = app.resume_path
      ? `${process.env.APP_URL || ''}${app.resume_path}`
      : null;

    const html = blacklistAdminAlertEmail({
      candidate: { name: app.candidate_name, email: app.candidate_email, phone: app.candidate_phone },
      recruiter,
      reason,
      resumeUrl,
    });

    const adminEmails = admins.rows.map((r) => r.email);
    if (adminEmails.length) {
      // Attach resume file if it exists locally so the admin doesn't have to log in.
      let attachments;
      if (app.resume_path) {
        const localPath = path.resolve(process.cwd(), '..', app.resume_path.replace(/^\//, ''));
        try {
          if (fs.existsSync(localPath)) {
            const buf = fs.readFileSync(localPath);
            attachments = [{
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: path.basename(localPath),
              contentBytes: buf.toString('base64'),
            }];
          }
        } catch { /* fall through, link still in body */ }
      }
      await sendEmail(adminEmails, `Compliance: candidate blacklisted (${app.candidate_name})`, html, { attachments });
    }

    res.json({ ok: true, application_id: app.application_id });
  } catch (err) {
    console.error('Blacklist error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /blacklist/:phone  lift a ban (admin only)
router.delete('/:phone', requireRole('hr_admin'), async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const r = await pool.query(
      `UPDATE blacklisted_phones SET lifted_at = NOW(), lifted_by_email = $1
        WHERE phone = $2 AND lifted_at IS NULL`,
      [req.user.email, phone]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Phone not currently blacklisted' });
    await logAudit({
      actionBy: req.user.email,
      actionType: 'unblacklist',
      entityType: 'phone',
      entityId: phone,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
