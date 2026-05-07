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
      const afterIdx = params.length;
      params.push(`%${field_edited}%`);
      const beforeIdx = params.length;
      whereClause += ` AND (after_state::text ILIKE $${afterIdx} OR before_state::text ILIKE $${beforeIdx})`;
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
      const afterIdx = params.length;
      params.push(`%${field_edited}%`);
      const beforeIdx = params.length;
      whereClause += ` AND (after_state::text ILIKE $${afterIdx} OR before_state::text ILIKE $${beforeIdx})`;
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

    // Session duration calculation: pair login/logout per user
    const sessionStats = await pool.query(
      `WITH login_logout_pairs AS (
        SELECT
          l.action_by,
          l.created_at AS login_time,
          n.created_at AS logout_time,
          EXTRACT(EPOCH FROM (n.created_at - l.created_at)) AS duration_secs
        FROM audit_trail l
        JOIN audit_trail n ON l.action_by = n.action_by
          AND n.action_type = 'logout'
          AND n.created_at > l.created_at
          AND n.created_at <= l.created_at + INTERVAL '24 hours'
        WHERE l.action_type = 'login'
      )
      SELECT
        action_by,
        COUNT(*) AS session_count,
        AVG(duration_secs) AS avg_duration_secs,
        MIN(duration_secs) AS min_duration,
        MAX(duration_secs) AS max_duration
      FROM login_logout_pairs
      WHERE duration_secs > 0 AND duration_secs < 86400
      GROUP BY action_by
      ORDER BY session_count DESC`,
      []
    );

    // Most common actions top 10
    const topActions = byType.rows.slice(0, 10);

    // Active users today
    const activeUsersToday = await pool.query(
      `SELECT COUNT(DISTINCT action_by) AS count FROM audit_trail WHERE action_type = 'login' AND created_at >= CURRENT_DATE`,
      []
    );

    // Session frequency per user over last 7 days
    const sessionFrequency = await pool.query(
      `SELECT action_by, COUNT(*) AS login_count
       FROM audit_trail
       WHERE action_type = 'login' AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY action_by
       ORDER BY login_count DESC`,
      []
    );

    // Login activity: per-user login counts in the same window + DAU on logins.
    const [loginsByUser, dauLogins, dauActions, totalLogins, sessionsToday] = await Promise.all([
      pool.query(
        `SELECT action_by, COUNT(*) AS count, MAX(created_at) AS last_login
           FROM audit_trail ${whereClause} AND action_type = 'login'
          GROUP BY action_by ORDER BY count DESC LIMIT 50`,
        params
      ),
      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS day, COUNT(DISTINCT action_by) AS users
           FROM audit_trail ${whereClause} AND action_type = 'login'
          GROUP BY day ORDER BY day DESC LIMIT 14`,
        params
      ),
      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS day, COUNT(*) AS actions, COUNT(DISTINCT action_by) AS users
           FROM audit_trail ${whereClause}
          GROUP BY day ORDER BY day DESC LIMIT 14`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) AS c FROM audit_trail ${whereClause} AND action_type = 'login'`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) AS c FROM audit_trail
           WHERE action_type = 'login' AND created_at >= NOW() - INTERVAL '24 hours'`,
      ),
    ]);

    const avgSessionDuration = sessionStats.rows.length > 0
      ? Math.round(sessionStats.rows.reduce((s, r) => s + Number(r.avg_duration_secs || 0), 0) / sessionStats.rows.length)
      : 0;

    res.json({
      ...typeCounts,
      total: byType.rows.reduce((s, r) => s + Number(r.count || 0), 0),
      today: dauActions.rows[0] ? Number(dauActions.rows[0].actions || 0) : 0,
      last_7_days: dauActions.rows.slice(0, 7).reduce((s, r) => s + Number(r.actions || 0), 0),
      unique_actors: byUser.rows.length,
      total_logins: Number(totalLogins.rows[0]?.c || 0),
      logins_last_24h: Number(sessionsToday.rows[0]?.c || 0),
      actions_by_type: byType.rows,
      actions_by_user: byUser.rows,
      actions_by_entity: byEntity.rows,
      logins_by_user: loginsByUser.rows,
      dau_logins: dauLogins.rows,
      dau_actions: dauActions.rows,
      avg_session_duration_secs: avgSessionDuration,
      session_stats: sessionStats.rows,
      most_common_actions: topActions,
      active_users_today: Number(activeUsersToday.rows[0]?.count || 0),
      session_frequency_7d: sessionFrequency.rows,
    });
  } catch (err) {
    console.error('Audit stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /login-activity - Login activity stats per user with daily breakdown
router.get('/login-activity', adminOnly, async (req, res) => {
  try {
    // Per-user login stats
    const userLoginStats = await pool.query(
      `SELECT
        action_by AS email,
        u.role,
        u.name,
        COUNT(*) AS total_logins,
        MIN(a.created_at) AS first_login,
        MAX(a.created_at) AS last_login,
        COUNT(DISTINCT DATE(a.created_at AT TIME ZONE 'Asia/Kolkata')) AS active_days
      FROM audit_trail a
      JOIN users u ON u.email = a.action_by
      WHERE a.action_type = 'login'
      GROUP BY action_by, u.role, u.name
      ORDER BY total_logins DESC`,
      []
    );

    // Total actions per user
    const userActions = await pool.query(
      `SELECT action_by, COUNT(*) AS total_actions
       FROM audit_trail
       GROUP BY action_by`,
      []
    );
    const actionsByUser = {};
    for (const row of userActions.rows) {
      actionsByUser[row.action_by] = Number(row.total_actions);
    }

    // Actions today per user
    const actionsToday = await pool.query(
      `SELECT action_by, COUNT(*) AS actions_today
       FROM audit_trail
       WHERE created_at >= CURRENT_DATE
       GROUP BY action_by`,
      []
    );
    const actionsTodayMap = {};
    for (const row of actionsToday.rows) {
      actionsTodayMap[row.action_by] = Number(row.actions_today);
    }

    // Daily breakdown for last 30 days
    const dailyBreakdown = await pool.query(
      `SELECT
        DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS day,
        COUNT(*) AS total_logins,
        COUNT(DISTINCT action_by) AS unique_users
       FROM audit_trail
       WHERE action_type = 'login' AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY day
       ORDER BY day DESC`,
      []
    );

    const usersWithStats = userLoginStats.rows.map((u) => ({
      email: u.email,
      role: u.role,
      name: u.name,
      total_logins: Number(u.total_logins),
      first_login: u.first_login,
      last_login: u.last_login,
      active_days: Number(u.active_days),
      total_actions: actionsByUser[u.email] || 0,
      actions_today: actionsTodayMap[u.email] || 0,
    }));

    res.json({
      users: usersWithStats,
      daily_breakdown: dailyBreakdown.rows,
    });
  } catch (err) {
    console.error('Login activity error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
