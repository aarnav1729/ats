import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { parseResume } from '../services/ai.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';
import { extractTextFromResume, createApplicationRecord } from './applications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../uploads/resumes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Unique filename per upload so concurrent candidates never collide even when
// two requests land in the same millisecond.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const rand = crypto.randomBytes(6).toString('hex');
    cb(null, `public-${Date.now()}-${rand}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx?|rtf|txt)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Only PDF, DOC, DOCX, RTF, or TXT resumes are accepted'));
    cb(null, true);
  },
});

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /jobs/:jobId  —  Public job detail (QR links, shared URLs)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const param = req.params.jobId;
    const isNumeric = /^\d+$/.test(param);

    const result = await pool.query(
      `SELECT
          j.id,
          j.job_id,
          j.job_title,
          j.job_description,
          j.job_type,
          j.status,
          j.total_positions,
          j.experience_years,
          j.compensation_min,
          j.compensation_max,
          j.compensation_currency AS currency,
          j.publish_to_careers,
          bu.bu_name,
          bu.bu_short_name,
          d.department_name,
          sd.sub_department_name,
          l.location_name,
          p.phase_name
       FROM jobs j
       LEFT JOIN business_units bu ON j.business_unit_id = bu.id
       LEFT JOIN departments d ON j.department_id = d.id
       LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
       LEFT JOIN locations l ON j.location_id = l.id
       LEFT JOIN phases p ON j.phase_id = p.id
       WHERE (j.job_id = $1 ${isNumeric ? 'OR j.id = ' + parseInt(param, 10) : ''})
         AND j.active_flag = true
         AND LOWER(COALESCE(j.status, 'draft')) NOT IN ('archived')
       LIMIT 1`,
      [param]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or not published' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Public job fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /parse-resume  —  Accept a resume file, extract text, AI-parse, return
// Does NOT create an application. Used by the public job page to pre-fill.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/parse-resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No resume file uploaded' });

    const filePath = req.file.path;
    const text = await extractTextFromResume(filePath, req.file.originalname);

    let parsed = {};
    if (text) {
      try {
        parsed = await parseResume(text);
      } catch (aiErr) {
        console.error('Public parseResume error:', aiErr.message);
      }
    }

    return res.json({
      file: {
        original_name: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        path: `/uploads/resumes/${req.file.filename}`,
      },
      parsed: parsed || {},
      extracted_text_preview: (text || '').slice(0, 2000),
    });
  } catch (err) {
    console.error('Public parse-resume error:', err);
    return res.status(500).json({ error: err.message || 'Failed to parse resume' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /jobs/:jobId/apply  —  Candidate-facing apply endpoint.
// Accepts either multipart (with `resume` file) OR JSON with an already-uploaded
// `resume_path` / `resume_file_name` from a prior /parse-resume call.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/jobs/:jobId/apply', upload.single('resume'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const isNumeric = /^\d+$/.test(jobId);

    const jobLookup = await pool.query(
      `SELECT id, job_id, job_title, recruiter_email, active_flag, status
       FROM jobs
       WHERE (job_id = $1 ${isNumeric ? 'OR id = ' + parseInt(jobId, 10) : ''})
         AND active_flag = true
       LIMIT 1`,
      [jobId]
    );
    if (jobLookup.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or no longer open' });
    }
    const job = jobLookup.rows[0];

    const payload = { ...(req.body || {}) };
    if (req.file) {
      payload.resume_path = `/uploads/resumes/${req.file.filename}`;
      payload.resume_file_name = req.file.originalname;
      payload.resume_flag = true;
    }
    payload.ats_job_id = job.job_id;
    payload.source = payload.source || 'Company Website';
    payload.status = 'Applied';
    payload.talent_pool_only = false;
    payload.recruiter_email = payload.recruiter_email || job.recruiter_email || null;

    // Minimum required for a candidate self-apply
    if (!payload.candidate_name || !payload.candidate_email) {
      return res.status(400).json({ error: 'Your name and email are required to submit this application' });
    }

    const { row, duplicate, isDuplicate } = await createApplicationRecord(payload, payload.candidate_email);

    if (duplicate) {
      return res.status(200).json({
        already_applied: true,
        application_id: duplicate.application_id,
        message: 'You have already applied to this role. Our team will reach out to you.',
      });
    }

    await logAudit({
      actionBy: payload.candidate_email,
      actionType: 'create',
      entityType: 'application',
      entityId: row.id,
      afterState: row,
      metadata: { source: 'public_apply', jobId: job.job_id },
    });

    if (job.recruiter_email) {
      await sendNotificationEmail({
        to: job.recruiter_email,
        subject: `New self-apply: ${row.candidate_name} — ${job.job_title || job.job_id}`,
        body: `Candidate ${row.candidate_name} (${row.candidate_email}) applied via the public link for ${job.job_title || job.job_id}. Application ID: ${row.application_id}.`,
      }).catch((err) => console.error('Recruiter notify error:', err.message));
    }

    return res.status(201).json({
      application_id: row.application_id,
      message: "Thanks! Your application is in. You'll hear from our recruiting team soon.",
      warnings: isDuplicate ? ['Phone number matches another candidate record.'] : [],
    });
  } catch (err) {
    console.error('Public apply error:', err);
    return res.status(400).json({ error: err.message || 'Failed to submit application' });
  }
});

export default router;
