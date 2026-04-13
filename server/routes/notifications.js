import { Router } from 'express';
import pool from '../db.js';
import { generateEmailDraft } from '../services/ai.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;
    const userEmail = String(req.user?.email || '').trim().toLowerCase();
    const result = await pool.query(
      'SELECT * FROM notifications WHERE LOWER(user_email) = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userEmail, limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) FROM notifications WHERE LOWER(user_email) = $1', [userEmail]);
    const unreadResult = await pool.query('SELECT COUNT(*) FROM notifications WHERE LOWER(user_email) = $1 AND read_flag = false', [userEmail]);
    res.json({ notifications: result.rows, total: parseInt(countResult.rows[0].count), unread: parseInt(unreadResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/read-all', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read_flag = true WHERE LOWER(user_email) = $1', [String(req.user?.email || '').trim().toLowerCase()]);
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/read', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET read_flag = true WHERE id = $1 AND LOWER(user_email) = $2',
      [req.params.id, String(req.user?.email || '').trim().toLowerCase()]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/draft-email', async (req, res) => {
  try {
    const { purpose, prompt, context, recipients } = req.body || {};
    const draft = await generateEmailDraft({
      purpose,
      prompt,
      context: context || {},
      recipients: Array.isArray(recipients) ? recipients : [],
    });
    res.json(draft);
  } catch (err) {
    console.error('Draft email error:', err);
    res.status(500).json({ error: 'Failed to generate email draft' });
  }
});

export default router;
