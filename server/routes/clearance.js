import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';

const router = Router();

// GET /candidates/:appId/clearance - Get clearance record
router.get('/:appId/clearance', async (req, res) => {
  try {
    const { appId } = req.params;
    const result = await pool.query(
      'SELECT * FROM candidate_clearance WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
      [appId]
    );
    if (result.rows.length === 0) {
      return res.json({ clearance: null });
    }
    res.json({ clearance: result.rows[0] });
  } catch (err) {
    console.error('Get clearance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /candidates/:appId/clearance - Submit clearance (primary recruiter)
router.post('/:appId/clearance', requireRole('hr_admin', 'hr_recruiter'), async (req, res) => {
  try {
    const { appId } = req.params;
    const { ctc_data, ctc_text, aop_inline, aop_exceeded_amount, secondary_recruiter_email } = req.body;

    // Check if application exists and has documents uploaded
    const appResult = await pool.query(
      `SELECT a.*, j.secondary_recruiter_email AS job_secondary_recruiter
       FROM applications a
       LEFT JOIN jobs j ON a.ats_job_id = j.job_id
       WHERE a.id = $1`,
      [appId]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const app = appResult.rows[0];
    const bodySecondaryRecruiter = String(secondary_recruiter_email || '').trim().toLowerCase();
    const secondaryRecruiter = [app.secondary_recruiter_email, bodySecondaryRecruiter, app.job_secondary_recruiter]
      .map((email) => String(email || '').trim().toLowerCase())
      .find(Boolean);

    // Check if secondary recruiter exists
    const needsSecondary = !secondaryRecruiter;
    if (needsSecondary) {
      return res.status(400).json({
        error: 'Secondary recruiter not assigned. Please add a secondary recruiter before proceeding with clearance.',
        needs_secondary_recruiter: true,
      });
    }

    if (bodySecondaryRecruiter && !app.secondary_recruiter_email) {
      await pool.query(
        'UPDATE applications SET secondary_recruiter_email = $1, updated_at = NOW() WHERE id = $2',
        [bodySecondaryRecruiter, appId]
      );
    }

    // Upsert clearance record
    const existing = await pool.query(
      'SELECT id FROM candidate_clearance WHERE application_id = $1',
      [appId]
    );

    let clearanceId;
    if (existing.rows.length > 0) {
      clearanceId = existing.rows[0].id;
      await pool.query(
        `UPDATE candidate_clearance SET
          ctc_data = $1, ctc_text = $6, aop_inline = $2, aop_exceeded_amount = $3,
          primary_cleared = true, primary_cleared_by = $4, primary_cleared_at = NOW(),
          status = 'secondary_review', updated_at = NOW()
        WHERE id = $5`,
        [JSON.stringify(ctc_data || {}), aop_inline !== false, aop_exceeded_amount || 0, req.user.email, clearanceId, ctc_text || null]
      );
    } else {
      const insertResult = await pool.query(
        `INSERT INTO candidate_clearance
          (application_id, ctc_data, ctc_text, aop_inline, aop_exceeded_amount,
           primary_cleared, primary_cleared_by, primary_cleared_at, status)
        VALUES ($1, $2, $3, $4, $5, true, $6, NOW(), 'secondary_review')
        RETURNING id`,
        [appId, JSON.stringify(ctc_data || {}), ctc_text || null, aop_inline !== false, aop_exceeded_amount || 0, req.user.email]
      );
      clearanceId = insertResult.rows[0].id;
    }

    // Notify secondary recruiter
    if (secondaryRecruiter) {
      await pool.query(
        `INSERT INTO notifications (user_email, title, message, link) VALUES ($1, $2, $3, $4)`,
        [secondaryRecruiter, 'Clearance Review Required',
         `Documents and CTC table for ${app.candidate_name} need your review.`,
         `/applications/${appId}/workflow`]
      );
      sendNotificationEmail(secondaryRecruiter, 'Clearance Review Required',
        `Documents and CTC table for ${app.candidate_name} need your review as secondary recruiter.`,
        `${process.env.APP_URL || ''}/applications/${appId}/workflow`
      ).catch(() => {});
    }

    await logAudit(req, 'create', 'candidate_clearance', clearanceId, null, { appId, status: 'secondary_review' });

    res.json({ message: 'Clearance submitted for secondary review', clearance_id: clearanceId });
  } catch (err) {
    console.error('Submit clearance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /candidates/:appId/clearance - Take action on clearance
router.put('/:appId/clearance', requireRole('hr_admin', 'hr_recruiter'), async (req, res) => {
  try {
    const { appId } = req.params;
    const { action, comments, cxo_email, ctc_data, ctc_text } = req.body;

    const clearanceResult = await pool.query(
      'SELECT * FROM candidate_clearance WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
      [appId]
    );
    if (clearanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'No clearance record found' });
    }

    const clearance = clearanceResult.rows[0];
    const appResult = await pool.query('SELECT * FROM applications WHERE id = $1', [appId]);
    const app = appResult.rows[0];

    switch (action) {
      case 'secondary_clear': {
        await pool.query(
          `UPDATE candidate_clearance SET
            secondary_cleared = true, secondary_cleared_by = $1, secondary_cleared_at = NOW(),
            status = 'hr_review', updated_at = NOW()
          WHERE id = $2`,
          [req.user.email, clearance.id]
        );
        // Notify HR admins
        const hrAdmins = await pool.query("SELECT email FROM users WHERE role = 'hr_admin' AND is_active = true");
        for (const admin of hrAdmins.rows) {
          await pool.query(
            `INSERT INTO notifications (user_email, title, message, link) VALUES ($1, $2, $3, $4)`,
            [admin.email, 'Clearance Ready for HR Review',
             `Clearance for ${app?.candidate_name} has been verified by secondary recruiter.`,
             `/applications/${appId}/workflow`]
          );
        }
        break;
      }

      case 'hr_approve': {
        await pool.query(
          `UPDATE candidate_clearance SET
            hr_action = 'approved', hr_action_by = $1, hr_action_at = NOW(),
            hr_comments = $2, status = 'approved', updated_at = NOW()
          WHERE id = $3`,
          [req.user.email, comments || '', clearance.id]
        );
        break;
      }

      case 'hr_reject': {
        await pool.query(
          `UPDATE candidate_clearance SET
            hr_action = 'rejected', hr_action_by = $1, hr_action_at = NOW(),
            hr_comments = $2, status = 'rejected', updated_at = NOW()
          WHERE id = $3`,
          [req.user.email, comments || '', clearance.id]
        );
        // Notify primary recruiter
        if (clearance.primary_cleared_by) {
          await pool.query(
            `INSERT INTO notifications (user_email, title, message, link) VALUES ($1, $2, $3, $4)`,
            [clearance.primary_cleared_by, 'Clearance Rejected',
             `Clearance for ${app?.candidate_name} was rejected: ${comments}`,
             `/applications/${appId}/workflow`]
          );
        }
        break;
      }

      case 'hr_renegotiate': {
        await pool.query(
          `UPDATE candidate_clearance SET
            hr_action = 'renegotiation', hr_action_by = $1, hr_action_at = NOW(),
            hr_comments = $2, status = 'renegotiation', renegotiation_count = renegotiation_count + 1,
            primary_cleared = false, secondary_cleared = false, updated_at = NOW()
          WHERE id = $3`,
          [req.user.email, comments || '', clearance.id]
        );
        // Notify primary recruiter to renegotiate
        if (clearance.primary_cleared_by) {
          await pool.query(
            `INSERT INTO notifications (user_email, title, message, link) VALUES ($1, $2, $3, $4)`,
            [clearance.primary_cleared_by, 'Renegotiation Required',
             `CTC for ${app?.candidate_name} needs renegotiation: ${comments}`,
             `/applications/${appId}/workflow`]
          );
        }
        break;
      }

      case 'hr_send_to_cxo': {
        if (!cxo_email) {
          return res.status(400).json({ error: 'CXO email is required' });
        }
        await pool.query(
          `UPDATE candidate_clearance SET
            hr_action = 'sent_to_cxo', hr_action_by = $1, hr_action_at = NOW(),
            hr_comments = $2, cxo_email = $3, cxo_action = 'pending',
            status = 'cxo_review', updated_at = NOW()
          WHERE id = $4`,
          [req.user.email, comments || '', cxo_email, clearance.id]
        );
        // Notify CXO
        await pool.query(
          `INSERT INTO notifications (user_email, title, message, link) VALUES ($1, $2, $3, $4)`,
          [cxo_email, 'CXO Approval Required',
           `Clearance for ${app?.candidate_name} requires your approval. ${comments || ''}`,
           `/applications/${appId}/workflow`]
        );
        sendNotificationEmail(cxo_email, 'CXO Approval Required',
          `Clearance for ${app?.candidate_name} requires your approval. ${comments || ''}`,
          `${process.env.APP_URL || ''}/applications/${appId}/workflow`
        ).catch(() => {});
        break;
      }

      case 'cxo_approve': {
        await pool.query(
          `UPDATE candidate_clearance SET
            cxo_action = 'approved', cxo_action_at = NOW(),
            cxo_comments = $1, status = 'approved', updated_at = NOW()
          WHERE id = $2`,
          [comments || '', clearance.id]
        );
        break;
      }

      case 'cxo_reject': {
        await pool.query(
          `UPDATE candidate_clearance SET
            cxo_action = 'rejected', cxo_action_at = NOW(),
            cxo_comments = $1, status = 'rejected', updated_at = NOW()
          WHERE id = $2`,
          [comments || '', clearance.id]
        );
        break;
      }

      case 'update_ctc': {
        // Allow recruiter to update CTC after renegotiation
        await pool.query(
          `UPDATE candidate_clearance SET
            ctc_data = $1, ctc_text = $3, primary_cleared = false, secondary_cleared = false,
            status = 'pending', hr_action = 'pending', updated_at = NOW()
          WHERE id = $2`,
          [JSON.stringify(ctc_data || {}), clearance.id, ctc_text || null]
        );
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    await logAudit(req, 'update', 'candidate_clearance', clearance.id, { status: clearance.status }, { action, status: action });
    res.json({ message: `Clearance action '${action}' completed` });
  } catch (err) {
    console.error('Clearance action error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
