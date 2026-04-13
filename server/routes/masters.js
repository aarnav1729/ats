import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { listSpotEmployees } from '../services/spot.js';

const router = Router();
const masterReadRoles = requireRole('hr_admin', 'hr_recruiter', 'hod');
const masterWriteRoles = requireRole('hr_admin', 'hr_recruiter');

// Generic CRUD factory
function createMasterRoutes(tableName, entityType) {
  const r = Router();

  r.get('/', masterReadRoles, async (req, res) => {
    try {
      const { active_only } = req.query;
      let query = `SELECT * FROM ${tableName}`;
      if (active_only === 'true') query += ' WHERE active_flag = true';
      query += ' ORDER BY id ASC';
      const result = await pool.query(query);
      res.json(result.rows);
    } catch (err) {
      console.error(`List ${tableName} error:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.post('/', masterWriteRoles, async (req, res) => {
    try {
      const fields = Object.keys(req.body);
      const values = Object.values(req.body);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const result = await pool.query(
        `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      await logAudit({ actionBy: req.user.email, actionType: 'create', entityType, entityId: result.rows[0].id, afterState: result.rows[0] });
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(`Create ${tableName} error:`, err);
      if (err.code === '23505') return res.status(409).json({ error: 'Duplicate entry' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.put('/:id', masterWriteRoles, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

      const fields = Object.keys(req.body);
      const values = Object.values(req.body);
      const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
      values.push(id);
      const result = await pool.query(
        `UPDATE ${tableName} SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
        values
      );
      await logAudit({ actionBy: req.user.email, actionType: 'update', entityType, entityId: id, beforeState: existing.rows[0], afterState: result.rows[0] });
      res.json(result.rows[0]);
    } catch (err) {
      console.error(`Update ${tableName} error:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  r.delete('/:id', masterWriteRoles, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      await pool.query(`UPDATE ${tableName} SET active_flag = false, updated_at = NOW() WHERE id = $1`, [id]);
      await logAudit({ actionBy: req.user.email, actionType: 'delete', entityType, entityId: id, beforeState: existing.rows[0] });
      res.json({ message: 'Deactivated' });
    } catch (err) {
      console.error(`Delete ${tableName} error:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return r;
}

router.use('/business-units', createMasterRoutes('business_units', 'business_unit'));
router.use('/locations', createMasterRoutes('locations', 'location'));
router.use('/phases', createMasterRoutes('phases', 'phase'));
router.use('/departments', createMasterRoutes('departments', 'department'));
router.use('/sub-departments', createMasterRoutes('sub_departments', 'sub_department'));
router.use('/grades', createMasterRoutes('grades', 'grade'));
router.use('/levels', createMasterRoutes('levels', 'level'));
router.use('/designations', createMasterRoutes('designations', 'designation'));
router.use('/rejection-reasons', createMasterRoutes('rejection_reasons', 'rejection_reason'));
router.use('/backfill-reasons', createMasterRoutes('backfill_reasons', 'backfill_reason'));
router.use('/offer-dropout-reasons', createMasterRoutes('offer_dropout_reasons', 'offer_dropout_reason'));
router.use('/approvers', createMasterRoutes('approvers_master', 'approver'));

// Get sub-departments by department
router.get('/sub-departments-by-dept/:deptName', masterReadRoles, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sub_departments WHERE department_name = $1 AND active_flag = true ORDER BY id', [req.params.deptName]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get phases by location
router.get('/phases-by-location/:locationName', masterReadRoles, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM phases WHERE location_name = $1 AND active_flag = true ORDER BY id', [req.params.locationName]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get locations by business unit
router.get('/locations-by-bu/:buShortName', masterReadRoles, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM locations WHERE bu_short_name = $1 AND active_flag = true ORDER BY id', [req.params.buShortName]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/employees', masterReadRoles, async (req, res) => {
  try {
    const employees = await listSpotEmployees({ search: req.query.search || '' });
    res.json(employees);
  } catch (err) {
    console.error('Employee options error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
