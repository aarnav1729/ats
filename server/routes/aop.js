import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const adminOnly = requireRole('hr_admin');
const aopReadRoles = requireRole('hr_admin', 'hr_recruiter', 'hod');

router.get('/', aopReadRoles, async (req, res) => {
  try {
    const { business_unit_id, fiscal_year } = req.query;
    let query = `
      SELECT a.*, bu.bu_name, bu.bu_short_name, d.department_name
      FROM aop a
      JOIN business_units bu ON a.business_unit_id = bu.id
      JOIN departments d ON a.department_id = d.id
      WHERE a.active_flag = true
    `;
    const params = [];
    if (business_unit_id) {
      params.push(business_unit_id);
      query += ` AND a.business_unit_id = $${params.length}`;
    }
    if (fiscal_year) {
      params.push(fiscal_year);
      query += ` AND a.fiscal_year = $${params.length}`;
    }
    query += ' ORDER BY bu.bu_name, d.department_name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List AOP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const { business_unit_id, department_id, max_headcount, fiscal_year } = req.body;
    if (!business_unit_id || !department_id || max_headcount === undefined) {
      return res.status(400).json({ error: 'business_unit_id, department_id, and max_headcount are required' });
    }
    const result = await pool.query(
      `INSERT INTO aop (business_unit_id, department_id, max_headcount, fiscal_year)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_unit_id, department_id, fiscal_year) DO UPDATE SET max_headcount = $3, updated_at = NOW()
       RETURNING *`,
      [business_unit_id, department_id, max_headcount, fiscal_year || new Date().getFullYear().toString()]
    );
    await logAudit({ actionBy: req.user.email, actionType: 'create', entityType: 'aop', entityId: result.rows[0].id, afterState: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create AOP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { max_headcount, fiscal_year } = req.body;
    const existing = await pool.query('SELECT * FROM aop WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const result = await pool.query(
      'UPDATE aop SET max_headcount = COALESCE($1, max_headcount), fiscal_year = COALESCE($2, fiscal_year), updated_at = NOW() WHERE id = $3 RETURNING *',
      [max_headcount, fiscal_year, id]
    );
    await logAudit({ actionBy: req.user.email, actionType: 'update', entityType: 'aop', entityId: id, beforeState: existing.rows[0], afterState: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update AOP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM aop WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query('UPDATE aop SET active_flag = false, updated_at = NOW() WHERE id = $1', [id]);
    await logAudit({ actionBy: req.user.email, actionType: 'delete', entityType: 'aop', entityId: id, beforeState: existing.rows[0] });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete AOP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', aopReadRoles, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, bu.bu_name, bu.bu_short_name, d.department_name,
        (SELECT COUNT(*) FROM applications app
         JOIN jobs j ON app.ats_job_id = j.job_id
         WHERE j.business_unit_id = a.business_unit_id AND j.department_id = a.department_id
         AND app.status = 'Joined') as current_headcount
      FROM aop a
      JOIN business_units bu ON a.business_unit_id = bu.id
      JOIN departments d ON a.department_id = d.id
      WHERE a.active_flag = true
      ORDER BY bu.bu_name, d.department_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('AOP summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
