// Triage actions for the candidate row + detail view:
//   POST /triage/:id/move-to-job          — move candidate to another job (status → Applied there)
//   POST /triage/:id/move-to-talent-pool  — park candidate, retain history
//   POST /triage/:id/shortlist            — set status, optionally override rounds + interviewers
//
// Blacklist already lives in routes/blacklist.js.

import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { logTimeline } from '../services/timeline.js';
import { sendEmail } from '../services/email.js';
import { politeDeclineEmail, shortlistInterviewerEmail } from '../services/txEmails.js';
import { ensureInterviewTasksForRound } from '../services/interviewWorkflow.js';

const router = Router();
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter');

async function loadApp(idOrCode) {
  const r = await pool.query(
    `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
      WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
    [String(idOrCode)]
  );
  return r.rows[0] || null;
}

// ── Move to Talent Pool ────────────────────────────────────────────────────
router.post('/:id/move-to-talent-pool', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const app = await loadApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { reason } = req.body || {};
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO talent_pool_movements
         (application_id, candidate_email, candidate_phone, from_job_id,
          from_status, moved_by_email, moved_by_role, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [app.id, app.candidate_email, app.candidate_phone, app.ats_job_id,
       app.status, req.user.email, req.user.role, reason || null]
    );
    // RBAC retention: keep the moving recruiter as the owner so the talent
    // pool stays scoped to whoever parked the candidate. HR Admins still see
    // everything; recruiters only see their own pool entries.
    await client.query(
      `UPDATE applications SET ats_job_id = 'TP-POOL', status = 'TalentPool',
              talent_pool_only = true,
              recruiter_email = COALESCE($2, recruiter_email),
              updated_at = NOW() WHERE id = $1`,
      [app.id, req.user.role === 'hr_recruiter' ? req.user.email : null]
    );
    await client.query('COMMIT');

    await logAudit({
      actionBy: req.user.email,
      actionType: 'move_talent_pool',
      entityType: 'application',
      entityId: app.id,
      beforeState: { status: app.status, ats_job_id: app.ats_job_id },
      afterState: { status: 'TalentPool', ats_job_id: 'TP-POOL' },
      metadata: { reason },
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'application.moved_to_talent_pool',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `Moved to talent pool from ${app.job_title || app.ats_job_id}${reason ? ` — ${reason}` : ''}`,
      payload: { from_job_id: app.ats_job_id, reason },
      fromState: app.status,
      toState: 'TalentPool',
    });

    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('TP move error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Move to another job ────────────────────────────────────────────────────
// Searchable picker uses GET /jobs/searchable to populate a dropdown.
router.post('/:id/move-to-job', adminOrRecruiter, async (req, res) => {
  try {
    const app = await loadApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { target_job_id } = req.body || {};
    if (!target_job_id) return res.status(400).json({ error: 'target_job_id required' });
    if (target_job_id === app.ats_job_id) return res.status(400).json({ error: 'Already in that job' });

    const targetQ = await pool.query(
      `SELECT job_id, job_title, recruiter_email FROM jobs WHERE job_id = $1 AND active_flag = true LIMIT 1`,
      [target_job_id]
    );
    if (!targetQ.rows.length) return res.status(404).json({ error: 'Target job not found' });
    const target = targetQ.rows[0];

    await pool.query(
      `UPDATE applications SET ats_job_id = $1, status = 'Applied',
              recruiter_email = COALESCE($2, recruiter_email),
              updated_at = NOW() WHERE id = $3`,
      [target.job_id, target.recruiter_email, app.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'move_job',
      entityType: 'application',
      entityId: app.id,
      beforeState: { status: app.status, ats_job_id: app.ats_job_id },
      afterState: { status: 'Applied', ats_job_id: target.job_id },
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'application.moved_to_job',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `Moved to "${target.job_title}" (${target.job_id}) from ${app.job_title || app.ats_job_id}`,
      payload: { from_job_id: app.ats_job_id, to_job_id: target.job_id, to_job_title: target.job_title },
      fromState: app.status,
      toState: 'Applied',
    });

    res.json({ ok: true, to_job: target });
  } catch (err) {
    console.error('Move-job error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Shortlist with optional per-application rounds/interviewers override ──
router.post('/:id/shortlist', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const app = await loadApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { no_of_rounds, interviewers_per_round, comment } = req.body || {};
    await client.query('BEGIN');

    const updateValues = ['AwaitingHODResponse'];
    const updateParts = ['status = $1', 'updated_at = NOW()'];
    if (Number.isInteger(no_of_rounds) && no_of_rounds >= 1) {
      updateValues.push(no_of_rounds);
      updateParts.push(`no_of_rounds = $${updateValues.length}`);
    }
    if (Array.isArray(interviewers_per_round)) {
      updateValues.push(JSON.stringify(interviewers_per_round));
      updateParts.push(`interviewers = $${updateValues.length}`);
    }
    updateValues.push(app.id);
    await client.query(
      `UPDATE applications SET ${updateParts.join(', ')} WHERE id = $${updateValues.length}`,
      updateValues
    );

    // Persist override rows so we can show provenance ("rounds added by X at Y")
    if (Array.isArray(interviewers_per_round)) {
      for (let i = 0; i < interviewers_per_round.length; i++) {
        const list = interviewers_per_round[i] || [];
        await client.query(
          `INSERT INTO application_round_overrides
             (application_id, round_number, interviewer_emails, added_by_email, added_by_role, reason)
            VALUES ($1, $2, $3::jsonb, $4, $5, $6)
            ON CONFLICT (application_id, round_number) DO UPDATE SET
              interviewer_emails = EXCLUDED.interviewer_emails,
              added_by_email = EXCLUDED.added_by_email,
              added_at = NOW()`,
          [app.id, i + 1, JSON.stringify(list), req.user.email, req.user.role, comment || null]
        );
      }
    }
    await client.query('COMMIT');

    // Create interview tasks after shortlist
    const updatedApp = await pool.query('SELECT * FROM applications WHERE id = $1', [app.id]);
    if (updatedApp.rows[0]?.ats_job_id) {
      await ensureInterviewTasksForRound(client, updatedApp.rows[0], 1, 'AwaitingHODResponse');
    }

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'application',
      entityId: app.id,
      beforeState: { status: app.status, no_of_rounds: app.no_of_rounds, interviewers: app.interviewers },
      afterState: { status: 'AwaitingHODResponse', no_of_rounds, interviewers: interviewers_per_round },
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'application.shortlisted',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `Shortlisted${no_of_rounds ? ` for ${no_of_rounds} round${no_of_rounds === 1 ? '' : 's'}` : ''}`,
      payload: { no_of_rounds, interviewers_per_round, ats_job_id: app.ats_job_id },
      fromState: app.status,
      toState: 'AwaitingHODResponse',
    });

    // Notify first-round interviewers
    const firstRoundInterviewers = (interviewers_per_round && interviewers_per_round[0]) || [];
    for (const email of firstRoundInterviewers) {
      const html = shortlistInterviewerEmail({
        candidateName: app.candidate_name,
        jobTitle: app.job_title,
        roundLabel: 'Round 1',
        applicationId: app.application_id,
      });
      await sendEmail(email, `Candidate ready for review — ${app.candidate_name}`, html).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Shortlist error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── HR reject with polite Goldman-style email ──────────────────────────────
router.post('/:id/hr-reject', adminOrRecruiter, async (req, res) => {
  try {
    const app = await loadApp(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

    await pool.query(
      `UPDATE applications SET status = 'HRRejected', rejection_reason = $1,
              rejected_by_email = $2, updated_at = NOW() WHERE id = $3`,
      [reason, req.user.email, app.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'hr_reject',
      entityType: 'application',
      entityId: app.id,
      beforeState: { status: app.status },
      afterState: { status: 'HRRejected', rejection_reason: reason },
    });
    await logTimeline({
      entityType: 'application',
      entityId: app.application_id || app.id,
      eventType: 'application.hr_rejected',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      summary: `HR rejected — ${reason}`,
      payload: { reason },
      fromState: app.status,
      toState: 'HRRejected',
    });

    if (app.candidate_email) {
      const html = politeDeclineEmail({
        candidateName: app.candidate_name,
        jobTitle: app.job_title || 'the role you applied for',
        reason,
      });
      sendEmail(app.candidate_email, 'An update on your Premier Energies application', html).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper for the move-to-job picker — searchable jobs list ──────────────
router.get('/jobs/searchable', adminOrRecruiter, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = "j.active_flag = true AND j.status NOT IN ('archived','closed','cancelled') AND j.job_id <> 'TP-POOL'";
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where += ` AND (LOWER(j.job_title) LIKE $${params.length} OR LOWER(j.job_id) LIKE $${params.length} OR LOWER(j.hr_one_job_id) LIKE $${params.length})`;
  }
  const r = await pool.query(`
    SELECT j.id, j.job_id, j.job_title, j.hr_one_job_id, j.recruiter_email,
           bu.bu_name, l.location_name, d.department_name, j.status
      FROM jobs j
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN departments d ON j.department_id = d.id
     WHERE ${where}
     ORDER BY j.created_at DESC LIMIT 80`, params);
  res.json({
    items: r.rows.map((row) => ({
      job_id: row.job_id,
      job_title: row.job_title,
      hr_one_job_id: row.hr_one_job_id,
      recruiter_email: row.recruiter_email,
      label: `${row.job_title} — ${row.job_id}${row.hr_one_job_id ? ` (HR1: ${row.hr_one_job_id})` : ''} · ${[row.bu_name, row.department_name, row.location_name].filter(Boolean).join(' · ')}`,
      status: row.status,
    })),
  });
});

export default router;
