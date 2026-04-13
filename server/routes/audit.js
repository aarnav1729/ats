import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';

const router = Router();
const adminOnly = requireRole('hr_admin');

function parseJsonSafely(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatEntityLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildDiff(beforeState, afterState) {
  if (!beforeState && !afterState) return [];
  if (
    typeof beforeState !== 'object'
    || typeof afterState !== 'object'
    || Array.isArray(beforeState)
    || Array.isArray(afterState)
    || beforeState === null
    || afterState === null
  ) {
    return JSON.stringify(beforeState) === JSON.stringify(afterState)
      ? []
      : [{ field: 'value', before: beforeState, after: afterState }];
  }

  const keys = [...new Set([...Object.keys(beforeState), ...Object.keys(afterState)])];
  return keys
    .filter((key) => JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key]))
    .map((key) => ({
      field: key,
      before: beforeState[key],
      after: afterState[key],
    }));
}

function summarizeEntry(entry, changes) {
  const entityLabel = formatEntityLabel(entry.entity_type);
  const actor = entry.action_by || 'System';
  if (entry.action_type === 'create') return `${actor} created ${entityLabel}`;
  if (entry.action_type === 'delete') return `${actor} removed ${entityLabel}`;
  if (entry.action_type === 'approve') return `${actor} approved ${entityLabel}`;
  if (entry.action_type === 'reject') return `${actor} rejected ${entityLabel}`;
  if (entry.action_type === 'upload') return `${actor} uploaded a file for ${entityLabel}`;
  if (entry.action_type === 'reminder') return `${actor} sent a reminder on ${entityLabel}`;
  if (entry.action_type === 'schedule') return `${actor} scheduled or rescheduled ${entityLabel}`;
  if (entry.action_type === 'message') return `${actor} sent a message on ${entityLabel}`;
  if (entry.field_edited) return `${actor} updated ${entry.field_edited} on ${entityLabel}`;
  if (changes.length > 0) {
    const preview = changes.slice(0, 3).map((change) => change.field).join(', ');
    return `${actor} updated ${entityLabel}: ${preview}`;
  }
  return `${actor} recorded ${entry.action_type} on ${entityLabel}`;
}

function enrichEntry(row) {
  const beforeState = parseJsonSafely(row.before_state);
  const afterState = parseJsonSafely(row.after_state);
  const metadata = parseJsonSafely(row.metadata) || {};
  const changes = buildDiff(beforeState, afterState);

  return {
    ...row,
    before_state: beforeState,
    after_state: afterState,
    metadata,
    changed_fields: changes.map((change) => change.field),
    changes,
    summary: summarizeEntry(row, changes),
  };
}

// GET / - List audit entries with advanced filtering
router.get('/', adminOnly, async (req, res) => {
  try {
    const {
      page = 1, limit = 50, sort_by = 'created_at', sort_order = 'DESC',
      action_by, action_type, entity_type, entity_id, date_from, date_to, field_edited
    } = req.query;
    const offset = (page - 1) * limit;
    const params = [];

    let whereClause = 'WHERE 1=1';

    if (action_by) {
      params.push(action_by);
      whereClause += ` AND action_by = $${params.length}`;
    }
    if (action_type) {
      params.push(action_type);
      whereClause += ` AND action_type = $${params.length}`;
    }
    if (entity_type) {
      params.push(entity_type);
      whereClause += ` AND entity_type = $${params.length}`;
    }
    if (entity_id) {
      params.push(entity_id);
      whereClause += ` AND entity_id::text = $${params.length}`;
    }
    if (date_from) {
      params.push(date_from);
      whereClause += ` AND created_at >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      whereClause += ` AND created_at <= $${params.length}`;
    }
    if (field_edited) {
      params.push(`%${field_edited}%`);
      whereClause += ` AND (after_state::text ILIKE $${params.length} OR before_state::text ILIKE $${params.length})`;
    }

    const allowedSort = ['created_at', 'action_by', 'action_type', 'entity_type'];
    const safeSortBy = allowedSort.includes(sort_by) ? sort_by : 'created_at';
    const safeSortOrder = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM audit_trail ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query(
      `SELECT * FROM audit_trail ${whereClause}
       ORDER BY ${safeSortBy} ${safeSortOrder}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const entries = result.rows.map(enrichEntry);

    res.json({
      entries,
      timeline: entries,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('List audit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /export - Export filtered audit entries as JSON
router.get('/export', adminOnly, async (req, res) => {
  try {
    const { action_by, action_type, entity_type, entity_id, date_from, date_to, field_edited } = req.query;
    const params = [];

    let whereClause = 'WHERE 1=1';

    if (action_by) {
      params.push(action_by);
      whereClause += ` AND action_by = $${params.length}`;
    }
    if (action_type) {
      params.push(action_type);
      whereClause += ` AND action_type = $${params.length}`;
    }
    if (entity_type) {
      params.push(entity_type);
      whereClause += ` AND entity_type = $${params.length}`;
    }
    if (entity_id) {
      params.push(entity_id);
      whereClause += ` AND entity_id::text = $${params.length}`;
    }
    if (date_from) {
      params.push(date_from);
      whereClause += ` AND created_at >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      whereClause += ` AND created_at <= $${params.length}`;
    }
    if (field_edited) {
      params.push(`%${field_edited}%`);
      whereClause += ` AND (after_state::text ILIKE $${params.length} OR before_state::text ILIKE $${params.length})`;
    }

    const result = await pool.query(
      `SELECT * FROM audit_trail ${whereClause} ORDER BY created_at DESC`,
      params
    );

    const entries = result.rows.map(enrichEntry);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=audit-export-${Date.now()}.json`);
    res.json({ exported_at: new Date().toISOString(), total: entries.length, entries });
  } catch (err) {
    console.error('Export audit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /stats - Audit summary statistics
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (date_from) {
      params.push(date_from);
      whereClause += ` AND created_at >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      whereClause += ` AND created_at <= $${params.length}`;
    }

    const [byType, byUser, byEntity] = await Promise.all([
      pool.query(
        `SELECT action_type, COUNT(*) as count FROM audit_trail ${whereClause} GROUP BY action_type ORDER BY count DESC`,
        params
      ),
      pool.query(
        `SELECT action_by, COUNT(*) as count FROM audit_trail ${whereClause} GROUP BY action_by ORDER BY count DESC LIMIT 50`,
        params
      ),
      pool.query(
        `SELECT entity_type, COUNT(*) as count FROM audit_trail ${whereClause} GROUP BY entity_type ORDER BY count DESC`,
        params
      )
    ]);

    const typeCounts = Object.fromEntries(
      ['create', 'read', 'update', 'delete', 'approve', 'reject', 'reminder', 'schedule'].map((type) => [type, 0])
    );
    for (const row of byType.rows) {
      typeCounts[row.action_type] = Number(row.count || 0);
    }

    res.json({
      ...typeCounts,
      actions_by_type: byType.rows,
      actions_by_user: byUser.rows,
      actions_by_entity: byEntity.rows,
    });
  } catch (err) {
    console.error('Audit stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
