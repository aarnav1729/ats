// Offer letter + digital signature + joining flow.
// Recruiter uploads a PDF from HR One; candidate signs digitally; recruiter
// records joining outcome.

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { logTimeline } from '../services/timeline.js';
import { sendEmail } from '../services/email.js';
import {
  offerLetterReadyEmail,
  joiningOutcomeEmail,
  joiningReminderEmail,
} from '../services/txEmails.js';
import remindersService from '../services/reminders.js';

const router = Router();
const hrAny = requireRole('hr_admin', 'hr_recruiter');
const candidateOnly = requireRole('applicant');

const uploadDir = path.resolve(process.cwd(), '..', 'uploads', 'offers');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 15 * 1024 * 1024 } });

async function loadApp(idOrCode) {
  const r = await pool.query(
    `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
      WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
    [String(idOrCode)]
  );
  return r.rows[0] || null;
}

// ── Recruiter: upload offer letter ────────────────────────────────────────
router.post('/:applicationId/upload', hrAny, upload.single('file'), async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (!req.file) return res.status(400).json({ error: 'PDF required' });

    // ── Pre-flight gate ───────────────────────────────────────────────────
    // Offer can only be released when the full chain is clear:
    //   (a) all required candidate documents are 'accepted'
    //   (b) candidate has signed/accepted the active CTC breakup
    //   (c) Recruiter 2 has cleared (r2_decision = 'approved')
    //   (d) HR Admin has approved (admin_decision = 'approved')
    //       - OR if forwarded to approvers, all of them approved
    // Application status must already be 'OfferInProcess' for the upload to land.
    if (req.body?.bypass !== '1') {  // escape hatch for emergencies
      const status = String(app.status || '').toLowerCase();
      if (status !== 'offerinprocess') {
        return res.status(409).json({ error: `Cannot upload offer letter - application is in "${app.status}", needs to be in OfferInProcess (CTC fully approved).` });
      }
      // Doc check
      const pendingDocs = await pool.query(
        `SELECT COUNT(*) AS c FROM candidate_documents
          WHERE application_id = $1
            AND COALESCE(status, 'pending') NOT IN ('accepted', 'approved')`,
        [app.id]
      );
      if (Number(pendingDocs.rows[0].c) > 0) {
        return res.status(409).json({ error: `Cannot upload offer letter - ${pendingDocs.rows[0].c} candidate document(s) still pending or rejected.` });
      }
      // Active breakup must be candidate-accepted + R2-approved + admin-approved
      const bq = await pool.query(
        `SELECT candidate_decision, r2_decision, admin_decision FROM ctc_breakups
          WHERE application_id = $1 ORDER BY version DESC, created_at DESC LIMIT 1`,
        [app.id]
      );
      const breakup = bq.rows[0];
      if (!breakup) return res.status(409).json({ error: 'Cannot upload offer letter - no CTC breakup on file.' });
      if (breakup.candidate_decision !== 'accepted') return res.status(409).json({ error: 'Cannot upload offer letter - candidate has not signed the CTC breakup.' });
      if (breakup.r2_decision !== 'approved') return res.status(409).json({ error: 'Cannot upload offer letter - Recruiter 2 has not cleared the package.' });
      if (breakup.admin_decision !== 'approved') {
        // Approver branch - if HR admin forwarded, all approvers must be approved
        const ap = await pool.query(`SELECT status FROM ctc_approvers WHERE application_id = $1`, [app.id]);
        if (!ap.rows.length || ap.rows.some((r) => r.status !== 'approved')) {
          return res.status(409).json({ error: 'Cannot upload offer letter - HR Admin / approvers have not approved.' });
        }
      }
    }

    const filePath = `/uploads/offers/${req.file.filename}`;
    const validity = Number(req.body?.validity_days || 14);
    const ins = await pool.query(
      `INSERT INTO offer_letters (application_id, file_path, file_name, uploaded_by_email, validity_days, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($5::int || ' days')::interval) RETURNING *`,
      [app.id, filePath, req.file.originalname, req.user.email, validity]
    );

    await pool.query(
      `UPDATE applications SET status = 'SignaturePending', updated_at = NOW() WHERE id = $1`,
      [app.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'create',
      entityType: 'offer_letter',
      entityId: ins.rows[0].id,
      afterState: ins.rows[0],
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'offer.released',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `Offer letter uploaded  valid for ${validity} days`,
      payload: { offer_letter_id: ins.rows[0].id, file_name: req.file.originalname },
      fromState: app.status,
      toState: 'SignaturePending',
    });

    if (app.candidate_email) {
      sendEmail(app.candidate_email,
        `Your offer letter is ready  ${app.job_title || 'Premier Energies'}`,
        offerLetterReadyEmail({ candidateName: app.candidate_name, jobTitle: app.job_title })
      ).catch(() => {});
    }

    // Schedule expiry reminders T-3d, T-1d
    for (const d of [3, 1]) {
      const runAt = new Date(Date.now() + (validity - d) * 86400000);
      await remindersService.schedule({
        kind: 'offer.expiring',
        runAt,
        payload: {
          application_id: app.id,
          candidate_email: app.candidate_email,
          candidate_name: app.candidate_name,
          job_title: app.job_title,
          days_left: d,
        },
      });
    }

    res.json({ offer: ins.rows[0] });
  } catch (err) {
    console.error('Offer upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Candidate: see own offer ─────────────────────────────────────────────
router.get('/me/current', candidateOnly, async (req, res) => {
  const r = await pool.query(
    `SELECT o.* FROM offer_letters o
       JOIN applications a ON a.id = o.application_id
      WHERE LOWER(a.candidate_email) = LOWER($1)
      ORDER BY o.uploaded_at DESC LIMIT 1`,
    [req.user.email]
  );
  res.json({ offer: r.rows[0] || null });
});

// ── Candidate: digitally sign / accept / reject ──────────────────────────
router.post('/me/sign', candidateOnly, async (req, res) => {
  try {
    const { signature_data, decision = 'accepted', decision_notes } = req.body || {};
    if (decision === 'accepted' && !signature_data) {
      return res.status(400).json({ error: 'Signature is required to accept' });
    }
    const r = await pool.query(
      `SELECT o.*, a.id AS app_id, a.application_id, a.candidate_name, a.recruiter_email, a.secondary_recruiter_email,
              a.created_by, j.job_title
         FROM offer_letters o
         JOIN applications a ON a.id = o.application_id
         LEFT JOIN jobs j ON j.job_id = a.ats_job_id
        WHERE LOWER(a.candidate_email) = LOWER($1)
        ORDER BY o.uploaded_at DESC LIMIT 1`,
      [req.user.email]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No offer found' });
    const offer = r.rows[0];

    if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This offer has expired. Please contact HR.' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || null;

    await pool.query(
      `UPDATE offer_letters SET candidate_signed_at = $1, candidate_signature_data = $2,
              candidate_signature_ip = $3, candidate_decision = $4, candidate_decision_notes = $5,
              decision_at = NOW() WHERE id = $6`,
      [decision === 'accepted' ? new Date() : null, signature_data || null, ip, decision, decision_notes || null, offer.id]
    );
    const newStatus = decision === 'accepted' ? 'OfferAccepted'
                    : decision === 'rejected' ? 'OfferRejected'
                    : 'OfferDropout';
    await pool.query(
      `UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, offer.app_id]
    );

    await logTimeline({
      entityType: 'application',
      entityId: offer.application_id || offer.app_id,
      eventType: decision === 'accepted' ? 'offer.signed' : `offer.${decision}`,
      actorEmail: req.user.email,
      actorRole: 'applicant',
      summary: decision === 'accepted'
        ? `Candidate digitally signed and accepted the offer`
        : `Candidate ${decision} the offer${decision_notes ? `  ${decision_notes}` : ''}`,
      payload: { ip, decision, notes: decision_notes },
      toState: newStatus,
    });

    // Notify everyone
    const stakeholders = [offer.recruiter_email, offer.secondary_recruiter_email, offer.created_by].filter(Boolean);
    if (stakeholders.length) {
      const html = joiningOutcomeEmail({
        candidateName: offer.candidate_name,
        jobTitle: offer.job_title,
        outcome: newStatus,
      });
      sendEmail(stakeholders, `${offer.candidate_name}  ${newStatus}`, html).catch(() => {});
    }

    res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error('Sign error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Recruiter: set/update tentative joining date ─────────────────────────
router.post('/:applicationId/joining', hrAny, async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { joining_date, reason, event_type = 'set' } = req.body || {};
    if (!joining_date) return res.status(400).json({ error: 'joining_date required' });

    await pool.query(
      `INSERT INTO joining_events (application_id, event_type, old_date, new_date, reason, committed_by_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [app.id, event_type, app.joining_date || null, joining_date, reason || null, req.user.email]
    );
    await pool.query(
      `UPDATE applications SET joining_date = $1, updated_at = NOW() WHERE id = $2`,
      [joining_date, app.id]
    );

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: `joining.${event_type}`,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `${event_type === 'set' ? 'Tentative joining date set' : `Joining ${event_type}`} → ${joining_date}${reason ? ` (${reason})` : ''}`,
      payload: { old_date: app.joining_date, new_date: joining_date, reason },
    });

    // Reminder on joining day at 09:00 IST → UTC 03:30
    const at = new Date(`${joining_date}T03:30:00.000Z`);
    await remindersService.schedule({
      kind: 'joining.day',
      runAt: at,
      payload: {
        recruiter_email: app.recruiter_email,
        candidate_name: app.candidate_name,
        job_title: app.job_title,
        joining_date,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recruiter: mark joined / postpone / dropout ───────────────────────────
router.post('/:applicationId/joining-outcome', hrAny, async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { outcome, reason } = req.body || {}; // 'joined' | 'postpone' | 'dropout'
    if (!['joined', 'postpone', 'dropout'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be joined|postpone|dropout' });
    }
    const newStatus = outcome === 'joined' ? 'Joined' : outcome === 'postpone' ? 'Postponed' : 'OfferDropout';
    await pool.query(
      `UPDATE applications SET status = $1, dropout_reason = $2, updated_at = NOW() WHERE id = $3`,
      [newStatus, outcome === 'dropout' ? reason : null, app.id]
    );
    await pool.query(
      `INSERT INTO joining_events (application_id, event_type, reason, committed_by_email)
       VALUES ($1, $2, $3, $4)`,
      [app.id, outcome, reason || null, req.user.email]
    );
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: `application.${outcome}`,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: outcome === 'joined' ? `Candidate joined`
              : outcome === 'postpone' ? `Joining postponed${reason ? `  ${reason}` : ''}`
              : `Marked dropout${reason ? `  ${reason}` : ''}`,
      payload: { outcome, reason },
      toState: newStatus,
    });
    res.json({ ok: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
