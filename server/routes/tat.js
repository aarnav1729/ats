import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { TAT_PAIRS, listTatPairs, calculateTat, getPair } from '../services/tat.js';

const router = Router();
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter', 'hod');

// GET /tat/pairs — catalog of every TAT pair with its definition
router.get('/pairs', adminOrRecruiter, async (req, res) => {
  const level = req.query.level || null;
  res.json({ pairs: listTatPairs(level) });
});

// GET /tat/calculate?pair=...&entityId=...&entityType=...
router.get('/calculate', adminOrRecruiter, async (req, res) => {
  try {
    const { pair, entityId, entityType, scopeJobId, scopeRequisitionId } = req.query;
    if (!pair || !entityId) return res.status(400).json({ error: 'pair and entityId required' });
    const result = await calculateTat(pair, {
      entityId,
      entityType,
      scopeJobId,
      scopeRequisitionId,
    });
    res.json(result);
  } catch (err) {
    console.error('TAT calculate error:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET /tat/grid?level=application&pair=applied_to_joined
// Returns one row per entity in scope, with the calculated TAT and the
// rows used to derive it. Drives the TAT explorer table.
router.get('/grid', adminOrRecruiter, async (req, res) => {
  try {
    const { level = 'application', pair: pairId, limit = 200 } = req.query;
    const pair = getPair(pairId);
    if (!pair) return res.status(400).json({ error: 'Unknown TAT pair' });

    let entityRows = [];
    if (level === 'application') {
      const r = await pool.query(`
        SELECT a.id, a.application_id, a.candidate_name, a.candidate_email,
               a.status, a.recruiter_email, a.ats_job_id,
               j.job_title, j.job_id AS job_code,
               r.requisition_id
          FROM applications a
          LEFT JOIN jobs j ON j.job_id = a.ats_job_id
          LEFT JOIN requisitions r ON r.id = j.requisition_id
         WHERE a.active_flag = true
         ORDER BY a.created_at DESC LIMIT $1`, [Number(limit)]);
      entityRows = r.rows.map((row) => ({ ...row, _entityId: row.id, _entityType: 'application' }));
    } else if (level === 'job') {
      const r = await pool.query(`
        SELECT j.id, j.job_id AS job_code, j.job_title, j.status, j.recruiter_email,
               r.requisition_id
          FROM jobs j
          LEFT JOIN requisitions r ON r.id = j.requisition_id
         WHERE j.active_flag = true
         ORDER BY j.created_at DESC LIMIT $1`, [Number(limit)]);
      entityRows = r.rows.map((row) => ({ ...row, _entityId: row.job_code, _entityType: 'job' }));
    } else {
      const r = await pool.query(`
        SELECT id, requisition_id, job_title, status, business_unit_id
          FROM requisitions WHERE active_flag = true
         ORDER BY created_at DESC LIMIT $1`, [Number(limit)]);
      entityRows = r.rows.map((row) => ({ ...row, _entityId: row.id, _entityType: 'requisition' }));
    }

    const results = await Promise.all(entityRows.map(async (row) => {
      const calc = await calculateTat(pairId, {
        entityId: row._entityId,
        entityType: row._entityType,
        scopeJobId: row.ats_job_id || row.job_code,
        scopeRequisitionId: row.requisition_id,
      });
      return { entity: row, tat: calc };
    }));

    res.json({
      pair: { id: pair.id, label: pair.label, description: pair.description },
      results,
    });
  } catch (err) {
    console.error('TAT grid error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
