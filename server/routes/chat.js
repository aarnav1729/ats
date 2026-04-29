// Candidate ↔ Recruiter chat. The candidate side authenticates via the
// candidate portal (applicant role). Recruiter side reads/sends from the HR UI.

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { renderBrandedEmail, paragraph } from '../services/emailBrand.js';

const router = Router();
const hrAny = requireRole('hr_admin', 'hr_recruiter');
const candidateOnly = requireRole('applicant');

const uploadDir = path.resolve(process.cwd(), '..', 'uploads', 'chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

async function loadAppByEmail(email) {
  const r = await pool.query(
    `SELECT a.*, j.job_title FROM applications a
       LEFT JOIN jobs j ON j.job_id = a.ats_job_id
      WHERE LOWER(a.candidate_email) = LOWER($1) AND a.active_flag = true
      ORDER BY a.created_at DESC LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

function notifyHtml({ senderName, body, jobTitle }) {
  return renderBrandedEmail({
    title: `New message from ${senderName}`,
    bodyHtml: [
      paragraph(`${senderName} sent a message regarding the ${jobTitle || 'application'}.`),
      paragraph(`"${body.slice(0, 240)}${body.length > 240 ? '…' : ''}"`),
    ].join(''),
    cta: { label: 'Open conversation', href: `${process.env.APP_URL || ''}/applications` },
  });
}

// ── Recruiter: list messages for an application ───────────────────────────
router.get('/:applicationId/thread', hrAny, async (req, res) => {
  const r = await pool.query(
    `SELECT id, sender_email, sender_role, body, attachment_path, attachment_name, read_by_recipient, created_at
       FROM candidate_chat_messages
       JOIN applications a ON a.id = candidate_chat_messages.application_id
      WHERE a.application_id = $1 OR a.id::text = $1
      ORDER BY candidate_chat_messages.created_at ASC`,
    [String(req.params.applicationId)]
  );
  res.json({ messages: r.rows });
});

// ── Recruiter: send a message ─────────────────────────────────────────────
router.post('/:applicationId/send', hrAny, upload.single('file'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.application_id, a.candidate_email, a.candidate_name, j.job_title
         FROM applications a LEFT JOIN jobs j ON j.job_id = a.ats_job_id
        WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
      [String(req.params.applicationId)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Application not found' });
    const app = r.rows[0];

    const body = String(req.body?.body || '').trim();
    if (!body && !req.file) return res.status(400).json({ error: 'Empty message' });

    const filePath = req.file ? `/uploads/chat/${req.file.filename}` : null;
    const ins = await pool.query(
      `INSERT INTO candidate_chat_messages
         (application_id, sender_email, sender_role, body, attachment_path, attachment_name)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [app.id, req.user.email, req.user.role, body, filePath, req.file?.originalname || null]
    );

    if (app.candidate_email) {
      sendEmail(app.candidate_email, `New message about your application`, notifyHtml({ senderName: req.user.email, body, jobTitle: app.job_title })).catch(() => {});
    }

    res.json({ message: ins.rows[0] });
  } catch (err) {
    console.error('Chat send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Candidate: list own thread ────────────────────────────────────────────
router.get('/me/thread', candidateOnly, async (req, res) => {
  const app = await loadAppByEmail(req.user.email);
  if (!app) return res.status(404).json({ error: 'No linked application' });
  const r = await pool.query(
    `SELECT id, sender_email, sender_role, body, attachment_path, attachment_name, read_by_recipient, created_at
       FROM candidate_chat_messages
      WHERE application_id = $1
      ORDER BY created_at ASC`,
    [app.id]
  );
  // Mark recruiter messages as read for candidate side
  await pool.query(
    `UPDATE candidate_chat_messages SET read_by_recipient = true
      WHERE application_id = $1 AND sender_role <> 'applicant' AND read_by_recipient = false`,
    [app.id]
  );
  res.json({ application: app, messages: r.rows });
});

// ── Candidate: send ───────────────────────────────────────────────────────
router.post('/me/send', candidateOnly, upload.single('file'), async (req, res) => {
  try {
    const app = await loadAppByEmail(req.user.email);
    if (!app) return res.status(404).json({ error: 'No linked application' });
    const body = String(req.body?.body || '').trim();
    if (!body && !req.file) return res.status(400).json({ error: 'Empty message' });
    const filePath = req.file ? `/uploads/chat/${req.file.filename}` : null;
    const ins = await pool.query(
      `INSERT INTO candidate_chat_messages
         (application_id, sender_email, sender_role, body, attachment_path, attachment_name)
        VALUES ($1, $2, 'applicant', $3, $4, $5) RETURNING *`,
      [app.id, req.user.email, body, filePath, req.file?.originalname || null]
    );

    // Notify primary + secondary recruiter
    const recruiters = [app.recruiter_email, app.secondary_recruiter_email].filter(Boolean);
    for (const to of recruiters) {
      sendEmail(to, `New candidate message — ${app.candidate_name}`, notifyHtml({ senderName: app.candidate_name || req.user.email, body, jobTitle: app.job_title })).catch(() => {});
    }

    res.json({ message: ins.rows[0] });
  } catch (err) {
    console.error('Candidate chat send error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
