import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { getTimeline, stepTatAcrossEntity } from '../services/timeline.js';

const router = Router();
const anyAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Unauthorized' }));

/**
 * GET /timeline/:entityType/:entityId
 * Returns chronological events for the entity, including related children
 * (application → clearance/documents/offer, job → applications, req → jobs).
 */
router.get('/:entityType/:entityId', anyAuth, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const rows = await getTimeline(entityType, entityId, {
      limit: Number(req.query.limit) || 500,
      includeRelated: req.query.include_related !== '0',
    });
    res.json({ events: rows, count: rows.length });
  } catch (err) {
    console.error('timeline fetch error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /timeline/tat/step-pairs?entity_type=application
 * Aggregate TAT per consecutive step pair.
 */
router.get('/tat/step-pairs', requireRole('hr_admin', 'hr_recruiter', 'hod', 'cxo'), async (req, res) => {
  try {
    const entityType = req.query.entity_type || 'application';
    const summary = await stepTatAcrossEntity(entityType, {
      fromEvent: req.query.from_event,
      toEvent: req.query.to_event,
      dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
    });
    res.json({ pairs: summary });
  } catch (err) {
    console.error('step tat error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /timeline/events/raw  list with filters, for MIS raw browsing.
 */
router.get('/events/raw', requireRole('hr_admin', 'hr_recruiter'), async (req, res) => {
  try {
    const params = [];
    const clauses = ['1=1'];
    if (req.query.entity_type) { params.push(req.query.entity_type); clauses.push(`entity_type = $${params.length}`); }
    if (req.query.event_type) { params.push(req.query.event_type); clauses.push(`event_type = $${params.length}`); }
    if (req.query.actor_email) { params.push(req.query.actor_email); clauses.push(`actor_email = $${params.length}`); }
    if (req.query.date_from) { params.push(req.query.date_from); clauses.push(`occurred_at >= $${params.length}`); }
    if (req.query.date_to) { params.push(req.query.date_to); clauses.push(`occurred_at <= $${params.length}`); }
    const limit = Math.min(Number(req.query.limit) || 1000, 10000);
    const rows = await pool.query(
      `SELECT * FROM timeline_events WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ${limit}`,
      params
    );
    res.json({ events: rows.rows, count: rows.rowCount });
  } catch (err) {
    console.error('timeline raw error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
