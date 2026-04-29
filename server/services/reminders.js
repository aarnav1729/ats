// Scheduled-reminder runner. Polls the `scheduled_reminders` table every
// 30 seconds and dispatches due jobs. Built on setInterval so we don't need
// node-cron or BullMQ — the cadence requirements (T-24h, T-30m, daily)
// don't need sub-second precision.
//
// Public API:
//   schedule({ kind, runAt, payload })  -> insert one row
//   cancelByPredicate(kind, payloadKey, payloadValue) -> mark pending rows cancelled
//   start() -> begin polling (called from index.js)
//
// Each `kind` maps to a handler in HANDLERS. Add new kinds there.

import pool from '../db.js';
import { sendEmail } from './email.js';
import {
  interviewReminderEmail,
  offerExpiringEmail,
  joiningReminderEmail,
} from './txEmails.js';

const POLL_INTERVAL_MS = 30 * 1000;
const MAX_PER_TICK = 25;
const MAX_ATTEMPTS = 5;

let started = false;

export async function schedule({ kind, runAt, payload = {} }) {
  if (!kind || !runAt) throw new Error('schedule(): kind and runAt are required');
  const r = await pool.query(
    `INSERT INTO scheduled_reminders (kind, run_at, payload)
     VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [kind, runAt instanceof Date ? runAt.toISOString() : runAt, JSON.stringify(payload)]
  );
  return r.rows[0]?.id;
}

export async function cancelByPredicate(kind, key, value) {
  await pool.query(
    `UPDATE scheduled_reminders SET status = 'cancelled', processed_at = NOW()
      WHERE kind = $1 AND status = 'pending' AND payload->>$2 = $3`,
    [kind, key, String(value)]
  );
}

const HANDLERS = {
  // ── Interview T-24h reminder ─────────────────────────────────────────
  'interview.t24h': async ({ candidate_email, candidate_name, job_title, round_label, scheduled_at }) => {
    const html = interviewReminderEmail({
      candidateName: candidate_name,
      jobTitle: job_title,
      roundLabel: round_label,
      scheduledAt: scheduled_at,
      leadLabel: 'in 24 hours',
    });
    await sendEmail(candidate_email, `Reminder: ${round_label} in 24 hours`, html);
  },

  'interview.t30m': async ({ candidate_email, candidate_name, job_title, round_label, scheduled_at }) => {
    const html = interviewReminderEmail({
      candidateName: candidate_name,
      jobTitle: job_title,
      roundLabel: round_label,
      scheduledAt: scheduled_at,
      leadLabel: 'in 30 minutes',
    });
    await sendEmail(candidate_email, `Starting in 30 minutes: ${round_label}`, html);
  },

  // ── Interviewer / recruiter notify (parallel to candidate reminders) ─
  'interview.t24h.internal': async ({ to, candidate_name, job_title, round_label, scheduled_at }) => {
    const html = interviewReminderEmail({
      candidateName: candidate_name,
      jobTitle: job_title,
      roundLabel: round_label,
      scheduledAt: scheduled_at,
      leadLabel: 'in 24 hours',
    });
    const list = Array.isArray(to) ? to : [to];
    await sendEmail(list, `Tomorrow: ${round_label} for ${candidate_name}`, html);
  },

  // ── Offer letter expiring ────────────────────────────────────────────
  'offer.expiring': async ({ candidate_email, candidate_name, job_title, days_left }) => {
    const html = offerExpiringEmail({
      candidateName: candidate_name,
      jobTitle: job_title,
      daysLeft: days_left,
    });
    await sendEmail(candidate_email, `Reminder: please respond to your offer`, html);
  },

  // ── Joining day reminder to recruiter ────────────────────────────────
  'joining.day': async ({ recruiter_email, candidate_name, job_title, joining_date }) => {
    const html = joiningReminderEmail({
      candidateName: candidate_name,
      jobTitle: job_title,
      joiningDate: joining_date,
    });
    await sendEmail(recruiter_email, `Joining today: ${candidate_name}`, html);
  },
};

async function tick() {
  let due;
  try {
    due = await pool.query(
      `SELECT id, kind, payload, attempts FROM scheduled_reminders
        WHERE status = 'pending' AND run_at <= NOW()
        ORDER BY run_at ASC
        LIMIT $1`,
      [MAX_PER_TICK]
    );
  } catch (err) {
    console.error('reminders.tick query failed:', err.message);
    return;
  }

  for (const row of due.rows) {
    const handler = HANDLERS[row.kind];
    if (!handler) {
      await pool.query(
        `UPDATE scheduled_reminders SET status='failed', last_error=$1, processed_at=NOW() WHERE id=$2`,
        [`No handler for ${row.kind}`, row.id]
      );
      continue;
    }
    try {
      await handler(row.payload || {});
      await pool.query(
        `UPDATE scheduled_reminders SET status='sent', processed_at=NOW() WHERE id=$1`,
        [row.id]
      );
    } catch (err) {
      const attempts = (row.attempts || 0) + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await pool.query(
        `UPDATE scheduled_reminders SET status=$1, attempts=$2, last_error=$3, processed_at=NOW() WHERE id=$4`,
        [status, attempts, err.message, row.id]
      );
    }
  }
}

function start() {
  if (started) return;
  started = true;
  setInterval(tick, POLL_INTERVAL_MS).unref?.();
  // Run once on boot so anything overdue from downtime fires immediately.
  setTimeout(tick, 5000).unref?.();
  console.log('Scheduled reminder runner started (poll interval 30s).');
}

export default { schedule, cancelByPredicate, start };
