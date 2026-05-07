// CTC approval chain.
// Recruiter 1 drafts → Recruiter 2 reviews → HR Admin clears → optional approver.
// Any step can: approve / reject / send-back-for-renegotiation.

import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { logTimeline } from '../services/timeline.js';
import { sendEmail } from '../services/email.js';
import { ctcReviewEmail, ctcAcceptanceEmailV2 } from '../services/txEmails.js';
import remindersService from '../services/reminders.js';

const router = Router();
const hrAny = requireRole('hr_admin', 'hr_recruiter');

async function loadApp(idOrCode) {
  const r = await pool.query(
    `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
      WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
    [String(idOrCode)]
  );
  return r.rows[0] || null;
}

// ── Recruiter 1: draft and send for review ────────────────────────────────
router.post('/:applicationId/start', hrAny, async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { ctc_text, ctc_snapshot, secondary_recruiter_email, approver_email } = req.body || {};
    if (!ctc_text) return res.status(400).json({ error: 'ctc_text is required' });

    const steps = [];
    if (secondary_recruiter_email) steps.push({ role: 'hr_recruiter', email: secondary_recruiter_email });
    steps.push({ role: 'hr_admin', email: null }); // resolved at approval time
    if (approver_email) steps.push({ role: 'approver', email: approver_email });

    // Wipe any previous chain on this app then insert fresh
    await pool.query(`DELETE FROM ctc_approval_chain WHERE application_id = $1`, [app.id]);
    for (let i = 0; i < steps.length; i++) {
      await pool.query(
        `INSERT INTO ctc_approval_chain (application_id, step_index, role_required, assignee_email, ctc_text, ctc_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [app.id, i, steps[i].role, steps[i].email, ctc_text, JSON.stringify(ctc_snapshot || {})]
      );
    }
    await pool.query(
      `UPDATE applications SET status = 'CTCSent', updated_at = NOW() WHERE id = $1`,
      [app.id]
    );

    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'ctc.sent',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `CTC drafted and sent for review (${steps.length} step${steps.length === 1 ? '' : 's'})`,
      payload: { steps, ats_job_id: app.ats_job_id },
      fromState: app.status,
      toState: 'CTCSent',
    });

    // Notify the first reviewer
    const first = steps[0];
    if (first.email) {
      sendEmail(first.email, `CTC review: ${app.candidate_name}`, ctcReviewEmail({
        candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: first.role,
      })).catch(() => {});
    } else if (first.role === 'hr_admin') {
      const admins = await pool.query(`SELECT email FROM users WHERE role = 'hr_admin' AND is_active = true`);
      const list = admins.rows.map((r) => r.email);
      if (list.length) {
        sendEmail(list, `CTC review: ${app.candidate_name}`, ctcReviewEmail({
          candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: 'hr_admin',
        })).catch(() => {});
      }
    }

    res.json({ ok: true, steps });
  } catch (err) {
    console.error('CTC start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Get current chain state for an application ───────────────────────────
router.get('/:applicationId/chain', hrAny, async (req, res) => {
  const app = await loadApp(req.params.applicationId);
  if (!app) return res.status(404).json({ error: 'Application not found' });
  const r = await pool.query(
    `SELECT * FROM ctc_approval_chain WHERE application_id = $1 ORDER BY step_index ASC`,
    [app.id]
  );
  res.json({ steps: r.rows });
});

// ── Act on the current pending step ──────────────────────────────────────
router.post('/:applicationId/act', hrAny, async (req, res) => {
  try {
    const app = await loadApp(req.params.applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { decision, comments } = req.body || {}; // 'approved' | 'rejected' | 'renegotiate'
    if (!['approved', 'rejected', 'renegotiate'].includes(decision)) {
      return res.status(400).json({ error: 'decision required' });
    }

    const stepsQ = await pool.query(
      `SELECT * FROM ctc_approval_chain WHERE application_id = $1 ORDER BY step_index ASC`,
      [app.id]
    );
    const steps = stepsQ.rows;
    const pending = steps.find((s) => s.status === 'pending');
    if (!pending) return res.status(409).json({ error: 'No pending step' });

    // Role gate: caller must match step role and (if assigned) assignee email
    const callerRole = req.user.role;
    const callerEmail = String(req.user.email || '').toLowerCase();
    const expectedRole = pending.role_required;
    const isAssigneeMatch = pending.assignee_email
      ? String(pending.assignee_email).toLowerCase() === callerEmail
      : true;
    const isRoleMatch = expectedRole === callerRole
      || (expectedRole === 'approver' && callerRole === 'hr_admin');
    if (!isAssigneeMatch || !isRoleMatch) {
      return res.status(403).json({ error: `This step requires ${expectedRole}${pending.assignee_email ? ` (${pending.assignee_email})` : ''}` });
    }

    await pool.query(
      `UPDATE ctc_approval_chain SET status = $1, comments = $2, acted_at = NOW(),
              assignee_email = COALESCE(assignee_email, $3) WHERE id = $4`,
      [decision, comments || null, callerEmail, pending.id]
    );

    let newAppStatus = 'CTCSent';
    if (decision === 'rejected') {
      newAppStatus = 'SalaryRejected';
    } else if (decision === 'renegotiate') {
      // Bounce back to recruiter 1  wipe later steps so they re-enter pending after re-submit
      await pool.query(
        `UPDATE ctc_approval_chain SET status = 'pending' WHERE application_id = $1 AND step_index < $2`,
        [app.id, pending.step_index]
      );
      newAppStatus = 'CTCSent';
    } else if (decision === 'approved') {
      const nextStep = steps.find((s) => s.step_index > pending.step_index && s.status === 'pending');
      if (nextStep) {
        // Notify next reviewer
        const target = nextStep.assignee_email
          ? [nextStep.assignee_email]
          : (await pool.query(`SELECT email FROM users WHERE role = $1 AND is_active = true`, [nextStep.role_required])).rows.map((r) => r.email);
        if (target.length) {
          sendEmail(target, `CTC review: ${app.candidate_name}`, ctcReviewEmail({
            candidateName: app.candidate_name, jobTitle: app.job_title, applicationId: app.application_id, role: nextStep.role_required,
          })).catch(() => {});
        }
        newAppStatus = 'CTCSent';
      } else {
        // All steps cleared → notify candidate
        newAppStatus = 'CTCAcceptance';
        await logTimeline({
          entityType: 'application',
          entityId: app.application_id || app.id,
          eventType: 'ctc.approved',
          actorEmail: callerEmail,
          actorRole: callerRole,
          summary: `CTC fully approved  sent to candidate for acceptance`,
          payload: { ats_job_id: app.ats_job_id },
        });
        if (app.candidate_email) {
          sendEmail(app.candidate_email, `Your compensation summary is ready`, ctcAcceptanceEmailV2({
            candidateName: app.candidate_name, jobTitle: app.job_title, validityDays: 14,
          })).catch(() => {});
        }
      }
    }

    await pool.query(
      `UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newAppStatus, app.id]
    );

    await logAudit({
      actionBy: callerEmail,
      actionType: decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'update',
      entityType: 'ctc_chain_step',
      entityId: pending.id,
      beforeState: { status: 'pending' },
      afterState: { status: decision, comments },
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: `ctc.${decision}`,
      actorEmail: callerEmail,
      actorRole: callerRole,
      summary: `${pending.role_required.replace('_', ' ')} ${decision} the CTC${comments ? `  ${comments}` : ''}`,
      payload: { step_index: pending.step_index, comments },
      toState: newAppStatus,
    });

    res.json({ ok: true, status: newAppStatus });
  } catch (err) {
    console.error('CTC act error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Candidate accepts CTC ────────────────────────────────────────────────
router.post('/me/accept', requireRole('applicant'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM applications
        WHERE LOWER(candidate_email) = LOWER($1) AND status = 'CTCAcceptance' AND active_flag = true
        ORDER BY updated_at DESC LIMIT 1`,
      [req.user.email]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No CTC awaiting acceptance' });
    const app = r.rows[0];
    await pool.query(`UPDATE applications SET status = 'CTCAccepted', updated_at = NOW() WHERE id = $1`, [app.id]);
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'ctc.accepted',
      actorEmail: req.user.email,
      actorRole: 'applicant',
      summary: `Candidate accepted the CTC`,
      toState: 'CTCAccepted',
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
