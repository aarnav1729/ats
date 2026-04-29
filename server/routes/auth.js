import { Router } from 'express';
import pool from '../db.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { sendOTPEmail } from '../services/email.js';
import { logAudit } from '../services/audit.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found or inactive' });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query('INSERT INTO otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email.toLowerCase(), otp, expiresAt]);

    await sendOTPEmail(email.toLowerCase(), otp);

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const otpResult = await pool.query(
      'SELECT * FROM otps WHERE email = $1 AND otp = $2 AND used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [email.toLowerCase(), otp]
    );

    if (otpResult.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired OTP' });

    await pool.query('UPDATE otps SET used = true WHERE id = $1', [otpResult.rows[0].id]);

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = userResult.rows[0];
    const token = generateToken(user);

    // Capture login with IP + UA so we can stat per-user activity later.
    await logAudit({
      actionBy: email,
      actionType: 'login',
      entityType: 'session',
      entityId: user.id,
      metadata: {
        role: user.role,
        ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || null,
        user_agent: req.headers['user-agent'] || null,
      },
    });

    res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await logAudit({
      actionBy: req.user.email,
      actionType: 'logout',
      entityType: 'session',
      entityId: req.user.id,
      metadata: { reason: 'user_logout', role: req.user.role },
    });
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error:', err);
    res.json({ message: 'Logged out' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, role, name, is_active FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
