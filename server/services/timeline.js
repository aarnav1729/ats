import pool from '../db.js';

/**
 * Timeline service — emit a typed event for any entity in the system.
 * Every call computes duration_since_prev_seconds automatically and flags
 * `hold_paused` if the entity (or its parent requisition) was on hold at
 * the moment of the event.
 *
 * Entity types: requisition | job | application | clearance | document | offer | candidate
 *
 * Usage:
 *   await logTimeline({
 *     entityType: 'application',
 *     entityId: app.application_id,
 *     eventType: 'application.status_changed',
 *     actorEmail: user.email,
 *     actorRole: user.role,
 *     fromState: 'Shortlisted',
 *     toState: 'Round1',
 *     stage: 'Round 1',
 *     summary: 'Moved to Round 1',
 *     payload: { ... },
 *   });
 */
export async function logTimeline(input) {
  const {
    entityType,
    entityId,
    eventType,
    stage = null,
    actorEmail = null,
    actorRole = null,
    summary = null,
    payload = {},
    fromState = null,
    toState = null,
    holdPaused,
    occurredAt = null,
  } = input || {};

  if (!entityType || !entityId || !eventType) {
    console.warn('logTimeline: missing required fields', { entityType, entityId, eventType });
    return null;
  }

  try {
    // Look up most recent prior event for this entity to compute gap
    const prev = await pool.query(
      `SELECT occurred_at FROM timeline_events
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY occurred_at DESC LIMIT 1`,
      [entityType, String(entityId)]
    );

    let durationSecs = null;
    if (prev.rows.length) {
      const prevAt = new Date(prev.rows[0].occurred_at).getTime();
      const now = occurredAt ? new Date(occurredAt).getTime() : Date.now();
      durationSecs = Math.max(0, Math.round((now - prevAt) / 1000));
    }

    // Auto-detect hold state if caller didn't override
    let paused = Boolean(holdPaused);
    if (holdPaused === undefined) {
      paused = await isEntityOnHold(entityType, entityId);
    }

    const result = await pool.query(
      `INSERT INTO timeline_events
        (entity_type, entity_id, event_type, stage, actor_email, actor_role,
         summary, payload, from_state, to_state,
         duration_since_prev_seconds, hold_paused, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13, NOW()))
       RETURNING *`,
      [
        entityType,
        String(entityId),
        eventType,
        stage,
        actorEmail,
        actorRole,
        summary,
        JSON.stringify(payload || {}),
        fromState,
        toState,
        durationSecs,
        paused,
        occurredAt,
      ]
    );
    return result.rows[0];
  } catch (err) {
    console.error('logTimeline error:', err.message);
    return null;
  }
}

/**
 * Check whether the entity's parent requisition is currently on hold.
 * Hold applies to requisition, its jobs, and applications to those jobs.
 */
async function isEntityOnHold(entityType, entityId) {
  try {
    if (entityType === 'requisition') {
      const r = await pool.query(
        `SELECT on_hold FROM requisitions WHERE requisition_id = $1 OR id::text = $1 LIMIT 1`,
        [String(entityId)]
      );
      return Boolean(r.rows[0]?.on_hold);
    }
    if (entityType === 'job') {
      const r = await pool.query(
        `SELECT r.on_hold FROM jobs j LEFT JOIN requisitions r ON j.requisition_id = r.id
         WHERE j.job_id = $1 OR j.id::text = $1 LIMIT 1`,
        [String(entityId)]
      );
      return Boolean(r.rows[0]?.on_hold);
    }
    if (entityType === 'application' || entityType === 'clearance' || entityType === 'document' || entityType === 'offer') {
      const r = await pool.query(
        `SELECT r.on_hold FROM applications a
         LEFT JOIN jobs j ON j.job_id = a.ats_job_id
         LEFT JOIN requisitions r ON j.requisition_id = r.id
         WHERE a.application_id = $1 OR a.id::text = $1 LIMIT 1`,
        [String(entityId)]
      );
      return Boolean(r.rows[0]?.on_hold);
    }
  } catch {
    // fall through
  }
  return false;
}

/**
 * Fetch the full timeline for an entity.
 */
export async function getTimeline(entityType, entityId, opts = {}) {
  const { limit = 500, includeRelated = true } = opts;
  const rows = [];

  // Core entity
  const core = await pool.query(
    `SELECT * FROM timeline_events
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY occurred_at ASC LIMIT $3`,
    [entityType, String(entityId), limit]
  );
  rows.push(...core.rows);

  // Expand candidate → application(s), requisition → jobs + applications
  if (includeRelated) {
    if (entityType === 'application') {
      // include clearance + document events for same application
      const rel = await pool.query(
        `SELECT * FROM timeline_events
         WHERE (entity_type IN ('clearance','document','offer') AND entity_id = $1)
         ORDER BY occurred_at ASC LIMIT $2`,
        [String(entityId), limit]
      );
      rows.push(...rel.rows);
    } else if (entityType === 'requisition') {
      const jobs = await pool.query(
        `SELECT job_id FROM jobs j
         WHERE j.requisition_id = (SELECT id FROM requisitions WHERE requisition_id = $1 LIMIT 1)`,
        [String(entityId)]
      );
      if (jobs.rows.length) {
        const jobIds = jobs.rows.map((r) => r.job_id);
        const rel = await pool.query(
          `SELECT * FROM timeline_events
           WHERE entity_type = 'job' AND entity_id = ANY($1::text[])
           ORDER BY occurred_at ASC LIMIT $2`,
          [jobIds, limit]
        );
        rows.push(...rel.rows);
      }
    } else if (entityType === 'job') {
      const apps = await pool.query(
        `SELECT application_id FROM applications WHERE ats_job_id = $1 LIMIT 200`,
        [String(entityId)]
      );
      if (apps.rows.length) {
        const appIds = apps.rows.map((r) => r.application_id);
        const rel = await pool.query(
          `SELECT * FROM timeline_events
           WHERE entity_type = 'application' AND entity_id = ANY($1::text[])
           ORDER BY occurred_at ASC LIMIT $2`,
          [appIds, limit]
        );
        rows.push(...rel.rows);
      }
    }
  }

  rows.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  return rows;
}

/**
 * TAT-per-step: aggregate average duration between consecutive event_type pairs
 * across an entity_type. Optional filter by from/to event types.
 */
export async function stepTatAcrossEntity(entityType, opts = {}) {
  const { fromEvent, toEvent, dateFrom, dateTo } = opts;
  const params = [entityType];
  let clauses = 'entity_type = $1';
  if (dateFrom) { params.push(dateFrom); clauses += ` AND occurred_at >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); clauses += ` AND occurred_at <= $${params.length}`; }

  let rows = await pool.query(
    `SELECT entity_id, event_type, from_state, to_state, occurred_at, duration_since_prev_seconds, hold_paused
     FROM timeline_events WHERE ${clauses} ORDER BY entity_id, occurred_at`,
    params
  );

  // Fallback: synthesize pseudo-events from audit_trail when timeline_events
  // is empty for this entity_type. Uses status-change updates + create/approve/reject rows.
  if (rows.rows.length === 0) {
    const atParams = [entityType];
    let atClause = `entity_type = $1`;
    if (dateFrom) { atParams.push(dateFrom); atClause += ` AND created_at >= $${atParams.length}`; }
    if (dateTo) { atParams.push(dateTo); atClause += ` AND created_at <= $${atParams.length}`; }
    const audit = await pool.query(
      `SELECT
         entity_id,
         CASE
           WHEN action_type = 'create' THEN 'created'
           WHEN action_type = 'approve' THEN 'approved'
           WHEN action_type = 'reject' THEN 'rejected'
           WHEN action_type = 'schedule' THEN 'scheduled'
           WHEN action_type = 'upload' THEN 'uploaded'
           WHEN field_edited = 'status' AND after_state IS NOT NULL THEN COALESCE(NULLIF(after_state,''), 'updated')
           ELSE COALESCE(NULLIF(field_edited,''), action_type)
         END AS event_type,
         before_state AS from_state,
         after_state  AS to_state,
         created_at   AS occurred_at,
         false        AS hold_paused
       FROM audit_trail
       WHERE ${atClause}
         AND (action_type IN ('create','approve','reject','schedule','upload')
              OR field_edited = 'status')
       ORDER BY entity_id, created_at`,
      atParams
    );
    // compute duration_since_prev_seconds per entity walk
    let prevEntity = null;
    let prevAt = null;
    const synth = audit.rows.map((r) => {
      const at = new Date(r.occurred_at).getTime();
      const dur = (prevEntity === r.entity_id && prevAt) ? Math.round((at - prevAt) / 1000) : null;
      prevEntity = r.entity_id;
      prevAt = at;
      return { ...r, duration_since_prev_seconds: dur };
    });
    rows = { rows: synth };
  }

  // Group by consecutive (prev → curr) pair per entity, drop hold-paused segments.
  const pairs = {};
  const perEntity = {};
  for (const row of rows.rows) {
    const key = row.entity_id;
    if (!perEntity[key]) perEntity[key] = [];
    perEntity[key].push(row);
  }
  for (const events of Object.values(perEntity)) {
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      if (curr.hold_paused) continue;
      if (fromEvent && prev.event_type !== fromEvent) continue;
      if (toEvent && curr.event_type !== toEvent) continue;
      const pairKey = `${prev.event_type} → ${curr.event_type}`;
      if (!pairs[pairKey]) pairs[pairKey] = { count: 0, totalSecs: 0, minSecs: Infinity, maxSecs: 0 };
      const secs = Number(curr.duration_since_prev_seconds || 0);
      pairs[pairKey].count += 1;
      pairs[pairKey].totalSecs += secs;
      pairs[pairKey].minSecs = Math.min(pairs[pairKey].minSecs, secs);
      pairs[pairKey].maxSecs = Math.max(pairs[pairKey].maxSecs, secs);
    }
  }
  return Object.entries(pairs).map(([pair, s]) => ({
    pair,
    count: s.count,
    avg_days: +(s.totalSecs / s.count / 86400).toFixed(2),
    min_days: +(s.minSecs / 86400).toFixed(2),
    max_days: +(s.maxSecs / 86400).toFixed(2),
  })).sort((a, b) => b.count - a.count);
}

export default { logTimeline, getTimeline, stepTatAcrossEntity };
