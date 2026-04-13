import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';

const router = Router();
const VALID_ROLES = ['hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod'];

router.get('/recruiter-options', requireRole('hr_admin', 'hr_recruiter'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, name
       FROM users
       WHERE is_active = true
         AND role IN ('hr_admin', 'hr_recruiter')
       ORDER BY name NULLS LAST, email`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Recruiter options error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', requireRole('hr_admin'), async (req, res) => {
  try {
    const { search, role, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT id, email, role, name, is_active, is_default, created_at, updated_at FROM users WHERE 1=1';
    const params = [];
    let paramIdx = 0;

    if (search) {
      paramIdx++;
      query += ` AND (email ILIKE $${paramIdx} OR name ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
    }
    if (role) {
      paramIdx++;
      query += ` AND role = $${paramIdx}`;
      params.push(role);
    }

    const countResult = await pool.query(query.replace('SELECT id, email, role, name, is_active, is_default, created_at, updated_at', 'SELECT COUNT(*)'), params);
    const total = parseInt(countResult.rows[0].count);

    paramIdx++;
    query += ` ORDER BY created_at DESC LIMIT $${paramIdx}`;
    params.push(limit);
    paramIdx++;
    query += ` OFFSET $${paramIdx}`;
    params.push(offset);

    const result = await pool.query(query, params);
    res.json({ users: result.rows, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireRole('hr_admin'), async (req, res) => {
  try {
    const { email, role, name } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'Email and role are required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'User already exists' });

    const result = await pool.query(
      'INSERT INTO users (email, role, name) VALUES ($1, $2, $3) RETURNING *',
      [email.toLowerCase(), role, name || null]
    );

    await logAudit({ actionBy: req.user.email, actionType: 'create', entityType: 'user', entityId: result.rows[0].id, afterState: result.rows[0] });
    await sendNotificationEmail(email.toLowerCase(), 'Welcome to Premier Energies ATS', `<p>Your account has been created with the role: <strong>${role.replace('_', ' ').toUpperCase()}</strong></p><p>You can now log in using your email address.</p>`);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', requireRole('hr_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, name, is_active } = req.body;

    const existing = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    if (existing.rows[0].is_default && (is_active === false || role !== 'hr_admin')) {
      return res.status(403).json({ error: 'Cannot modify default admin role or deactivate' });
    }

    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const result = await pool.query(
      `UPDATE users SET email = COALESCE($1, email), role = COALESCE($2, role), name = COALESCE($3, name), is_active = COALESCE($4, is_active), updated_at = NOW() WHERE id = $5 RETURNING *`,
      [email?.toLowerCase(), role, name, is_active, id]
    );

    await logAudit({ actionBy: req.user.email, actionType: 'update', entityType: 'user', entityId: id, beforeState: existing.rows[0], afterState: result.rows[0] });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireRole('hr_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (existing.rows[0].is_default) return res.status(403).json({ error: 'Cannot delete default admin' });

    await pool.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
    await logAudit({ actionBy: req.user.email, actionType: 'delete', entityType: 'user', entityId: id, beforeState: existing.rows[0] });

    res.json({ message: 'User deactivated' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
