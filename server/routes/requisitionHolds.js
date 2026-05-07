import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logTimeline } from '../services/timeline.js';
import { sendNotificationEmail } from '../services/email.js';
import { requisitionOnHoldEmail, requisitionReleasedEmail } from '../services/emailTemplates.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const hrAdminOnly = requireRole('hr_admin');
const hrAny = requireRole('hr_admin', 'hr_recruiter');

/**
 * POST /requisition-holds/:requisitionId
 * Place a requisition on hold. Pauses TAT, notifies raiser + approvers.
 * Body: { reason, notes, notify_extra: [email,...] }
 */
router.post('/:requisitionId', hrAdminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { requisitionId } = req.params;
    const { reason, notes, notify_extra = [] } = req.body || {};
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const reqRow = await client.query(
      `SELECT * FROM requisitions WHERE requisition_id = $1 OR id::text = $1 LIMIT 1`,
      [String(requisitionId)]
    );
    if (!reqRow.rows.length) return res.status(404).json({ error: 'Requisition not found' });
    const requisition = reqRow.rows[0];

    if (requisition.on_hold) {
      return res.status(409).json({ error: 'Already on hold' });
    }

    // Close any stale holds (safety)
    await client.query(
      `UPDATE requisition_holds SET released_at = NOW(), released_by = $1
       WHERE requisition_id = $2 AND released_at IS NULL`,
      [req.user.email, requisition.id]
    );

    // Gather notify list: raiser + approvers + extras
    const notifyEmails = new Set();
    if (requisition.created_by) notifyEmails.add(requisition.created_by);
    if (requisition.submitted_by) notifyEmails.add(requisition.submitted_by);
    if (requisition.assigned_recruiter_email) notifyEmails.add(requisition.assigned_recruiter_email);
    const approvals = await client.query(
      `SELECT approver_email FROM requisition_approvals WHERE requisition_id = $1`,
      [requisition.id]
    );
    for (const row of approvals.rows) {
      if (row.approver_email) notifyEmails.add(row.approver_email);
    }
    for (const e of notify_extra) { if (e) notifyEmails.add(e); }
    const notifyList = [...notifyEmails];

    const hold = await client.query(
      `INSERT INTO requisition_holds (requisition_id, reason, notes, placed_by, notified_emails)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [requisition.id, reason, notes || null, req.user.email, JSON.stringify(notifyList)]
    );

    await client.query(
      `UPDATE requisitions SET on_hold = true, hold_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason, requisition.id]
    );

    await client.query('COMMIT');

    // Post-commit side-effects
    await logTimeline({
      entityType: 'requisition',
      entityId: requisition.requisition_id,
      eventType: 'requisition.put_on_hold',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      fromState: 'active',
      toState: 'on_hold',
      summary: `Put on hold: ${reason}`,
      payload: { reason, notes, notified: notifyList },
    });

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'requisition',
      entityId: requisition.requisition_id,
      fieldEdited: 'on_hold',
      beforeState: false,
      afterState: true,
      metadata: { reason, notes },
    });

    // Fire-and-forget notify
    const htmlBody = requisitionOnHoldEmail({
      requisitionId: requisition.requisition_id,
      jobTitle: requisition.job_title || '',
      reason,
      notes: notes || '',
      placedBy: req.user.email,
    });
    Promise.all(
      notifyList.map((to) =>
        sendNotificationEmail({
          to,
          title: `Requisition ${requisition.requisition_id} placed on hold`,
          message: `${requisition.job_title || requisition.requisition_id} is on hold  ${reason}`,
          htmlBody,
          actionUrl: '/requisitions',
        }).catch(() => {})
      )
    ).catch(() => {});

    res.json({ hold: hold.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('put on hold error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /requisition-holds/:requisitionId/release
 * Release the active hold. Adds elapsed hold time to cumulative_hold_seconds.
 */
router.post('/:requisitionId/release', hrAdminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { requisitionId } = req.params;
    const reqRow = await client.query(
      `SELECT * FROM requisitions WHERE requisition_id = $1 OR id::text = $1 LIMIT 1`,
      [String(requisitionId)]
    );
    if (!reqRow.rows.length) return res.status(404).json({ error: 'Requisition not found' });
    const requisition = reqRow.rows[0];

    const active = await client.query(
      `SELECT * FROM requisition_holds
       WHERE requisition_id = $1 AND released_at IS NULL
       ORDER BY placed_at DESC LIMIT 1`,
      [requisition.id]
    );
    if (!active.rows.length) {
      return res.status(409).json({ error: 'No active hold' });
    }
    const hold = active.rows[0];

    const elapsedQ = await client.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - placed_at))::bigint AS elapsed FROM requisition_holds WHERE id = $1`,
      [hold.id]
    );
    const elapsed = Number(elapsedQ.rows[0]?.elapsed || 0);

    await client.query(
      `UPDATE requisition_holds SET released_at = NOW(), released_by = $1 WHERE id = $2`,
      [req.user.email, hold.id]
    );
    await client.query(
      `UPDATE requisitions
       SET on_hold = false, hold_reason = NULL,
           cumulative_hold_seconds = COALESCE(cumulative_hold_seconds, 0) + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [elapsed, requisition.id]
    );
    await client.query(
      `UPDATE jobs SET cumulative_hold_seconds = COALESCE(cumulative_hold_seconds, 0) + $1
       WHERE requisition_id = $2`,
      [elapsed, requisition.id]
    );
    await client.query('COMMIT');

    await logTimeline({
      entityType: 'requisition',
      entityId: requisition.requisition_id,
      eventType: 'requisition.released_from_hold',
      actorEmail: req.user.email,
      actorRole: req.user.role,
      fromState: 'on_hold',
      toState: 'active',
      summary: `Released from hold after ${(elapsed / 86400).toFixed(2)} days`,
      payload: { elapsed_seconds: elapsed, hold_id: hold.id },
    });

    // Notify list
    const notify = Array.isArray(hold.notified_emails) ? hold.notified_emails : [];
    const htmlBody = requisitionReleasedEmail({
      requisitionId: requisition.requisition_id,
      jobTitle: requisition.job_title || '',
      elapsedDays: (elapsed / 86400).toFixed(2),
      releasedBy: req.user.email,
    });
    Promise.all(
      notify.map((to) =>
        sendNotificationEmail({
          to,
          title: `Requisition ${requisition.requisition_id} released from hold`,
          message: `${requisition.job_title || requisition.requisition_id} is live again.`,
          htmlBody,
          actionUrl: '/requisitions',
        }).catch(() => {})
      )
    ).catch(() => {});

    res.json({ released: true, elapsed_seconds: elapsed });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('release hold error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /requisition-holds/:requisitionId/history
 */
router.get('/:requisitionId/history', hrAny, async (req, res) => {
  try {
    const { requisitionId } = req.params;
    const rows = await pool.query(
      `SELECT h.*
       FROM requisition_holds h
       JOIN requisitions r ON h.requisition_id = r.id
       WHERE r.requisition_id = $1 OR r.id::text = $1
       ORDER BY h.placed_at DESC`,
      [String(requisitionId)]
    );
    res.json({ holds: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
