import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';
import { answerAnalyticsQuestion, getAiServiceStatus } from '../services/ai.js';

const router = Router();
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter');

function buildFilters(query) {
  const {
    date_from,
    date_to,
    business_unit_id,
    department_id,
    location_id,
    phase_id,
    recruiter_email,
    recruiter,
    talent_pool, // 'include' (default) | 'only' | 'exclude'
    hr_one_job_id,
    status,
    source,
  } = query;
  const params = [];
  let whereClause = 'WHERE 1=1';

  if (date_from) { params.push(date_from); whereClause += ` AND a.created_at >= $${params.length}`; }
  if (date_to) { params.push(date_to); whereClause += ` AND a.created_at <= $${params.length}`; }
  if (recruiter_email || recruiter) {
    params.push(recruiter_email || recruiter);
    whereClause += ` AND a.recruiter_email = $${params.length}`;
  }
  if (business_unit_id) { params.push(business_unit_id); whereClause += ` AND j.business_unit_id = $${params.length}`; }
  if (department_id) { params.push(department_id); whereClause += ` AND j.department_id = $${params.length}`; }
  if (location_id) { params.push(location_id); whereClause += ` AND j.location_id = $${params.length}`; }
  if (phase_id) { params.push(phase_id); whereClause += ` AND j.phase_id = $${params.length}`; }
  if (hr_one_job_id) { params.push(hr_one_job_id); whereClause += ` AND j.hr_one_job_id = $${params.length}`; }
  if (status) {
    if (Array.isArray(status)) {
      const placeholders = status.map((s) => { params.push(s); return `$${params.length}`; }).join(',');
      whereClause += ` AND a.status IN (${placeholders})`;
    } else {
      params.push(status);
      whereClause += ` AND a.status = $${params.length}`;
    }
  }
  if (source) { params.push(source); whereClause += ` AND a.source = $${params.length}`; }

  // Talent-pool scoping. Default behaviour = include parked candidates so
  // analytics still see them; `exclude` is used by funnel/efficiency views
  // that should ignore the holding bay.
  const tpMode = talent_pool || 'include';
  if (tpMode === 'only') {
    whereClause += ` AND (a.status = 'TalentPool' OR a.ats_job_id = 'TP-POOL')`;
  } else if (tpMode === 'exclude') {
    whereClause += ` AND a.status <> 'TalentPool' AND a.ats_job_id <> 'TP-POOL'`;
  }

  return { whereClause, params };
}

function buildJobLevelFilters(whereClause) {
  return whereClause
    .replace(/a\.created_at/g, 'COALESCE(r.created_at, j.created_at)')
    .replace(/a\.recruiter_email/g, 'j.recruiter_email');
}

const TERMINAL_STATUSES = [
  'Joined',
  'Withdrawn',
  'HRRejected',
  'HODRejected',
  'Round1Rejected',
  'Round2Rejected',
  'Round3Rejected',
  'OfferRejected',
  'OfferDropout',
];
const OFFER_STATUSES = ['OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined'];
const INTERVIEW_STATUSES = ['AwaitingHODResponse', 'AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3', 'AwaitingFeedback'];
const OFFER_STATUS_SQL = `('${OFFER_STATUSES.join("','")}')`;
const TERMINAL_STATUS_SQL = `('${TERMINAL_STATUSES.join("','")}')`;
const DRILLDOWN_GROUPS = {
  business_unit: {
    select: `COALESCE(bu.bu_name, 'Unassigned')`,
    label: 'Business Unit',
  },
  location: {
    select: `COALESCE(l.location_name, 'Unassigned')`,
    label: 'Location',
  },
  phase: {
    select: `COALESCE(p.phase_name, 'Unassigned')`,
    label: 'Phase',
  },
  department: {
    select: `COALESCE(d.department_name, 'Unassigned')`,
    label: 'Department',
  },
  recruiter: {
    select: `COALESCE(a.recruiter_email, j.recruiter_email, 'Unassigned')`,
    label: 'Recruiter',
  },
};

function buildFunnelBucketCase(alias = 'a') {
  return `
    CASE
      WHEN ${alias}.status = 'InQueue' THEN 'InQueue'
      WHEN ${alias}.status = 'Applied' THEN 'Applied'
      WHEN ${alias}.status = 'Shortlisted' THEN 'Shortlisted'
      WHEN ${alias}.status IN ('AwaitingHODResponse', 'AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3', 'AwaitingFeedback') THEN 'Interview'
      WHEN ${alias}.status = 'Selected' THEN 'Selected'
      WHEN ${alias}.status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout') THEN 'Offered'
      WHEN ${alias}.status = 'Joined' THEN 'Joined'
      ELSE 'Other'
    END
  `;
}

async function buildAssistantSnapshot(filters = {}) {
  const { whereClause, params } = buildFilters(filters);
  const jobWhereClause = buildJobLevelFilters(whereClause);

  const [
    headlineResult,
    openJobsResult,
    openReqResult,
    funnelResult,
    monthlyTrendResult,
    recruiterMomentumResult,
    sourceMixResult,
    departmentResult,
    businessUnitResult,
    recentActivityResult,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE a.status NOT IN ${TERMINAL_STATUS_SQL}) AS active_candidates,
        COUNT(*) FILTER (WHERE a.status IN ('Selected', 'OfferInProcess', 'Offered', 'OfferAccepted')) AS closing_candidates,
        COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS offers_in_flight,
        COUNT(*) FILTER (WHERE a.status IN ('Joined')) AS joined_candidates,
        COUNT(*) FILTER (WHERE a.status IN ('AwaitingHODResponse', 'AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3', 'AwaitingFeedback')) AS interviewing_candidates
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
    `, params),
    pool.query(`
      SELECT COUNT(*) AS open_jobs
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      ${jobWhereClause}
        AND j.active_flag = true
        AND LOWER(COALESCE(j.status, '')) NOT IN ('closed', 'archived')
    `, params),
    pool.query(`
      SELECT COUNT(*) AS open_requisitions
      FROM requisitions r
      WHERE r.active_flag = true
        AND r.status IN ('draft', 'pending_approval', 'pending_cxo_approval', 'pending_hr_admin_approval', 'approved', 'on_hold')
    `),
    pool.query(`
      SELECT ${buildFunnelBucketCase('a')} AS stage, COUNT(*) AS count
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      GROUP BY stage
      ORDER BY COUNT(*) DESC
    `, params),
    pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', a.created_at), 'Mon YYYY') AS month_label,
        DATE_TRUNC('month', a.created_at) AS month_start,
        COUNT(*) AS created_candidates,
        COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS offer_stage_candidates,
        COUNT(*) FILTER (WHERE a.status = 'Joined') AS joined_candidates
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      GROUP BY month_label, month_start
      ORDER BY month_start DESC
      LIMIT 6
    `, params),
    pool.query(`
      SELECT
        COALESCE(a.recruiter_email, j.recruiter_email, 'Unassigned') AS recruiter,
        COUNT(*) FILTER (WHERE a.status IN ('Selected', 'OfferInProcess', 'Offered', 'OfferAccepted')) AS shortlisted_to_close,
        COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS offers,
        COUNT(*) FILTER (WHERE a.status = 'Joined') AS closures,
        COUNT(*) FILTER (WHERE a.status = 'OfferDropout') AS backouts
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      GROUP BY recruiter
      ORDER BY closures DESC, offers DESC, recruiter
      LIMIT 6
    `, params),
    pool.query(`
      SELECT
        COALESCE(NULLIF(a.source, ''), 'Unknown') AS source,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS offers,
        COUNT(*) FILTER (WHERE a.status = 'Joined') AS joins
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      GROUP BY source
      ORDER BY count DESC, joins DESC
      LIMIT 8
    `, params),
    pool.query(`
      SELECT
        COALESCE(d.department_name, 'Unassigned') AS department,
        COUNT(*) FILTER (WHERE a.status NOT IN ${TERMINAL_STATUS_SQL}) AS open_count,
        COUNT(*) FILTER (WHERE a.status IN ('Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'Joined')) AS selected_count,
        COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS offered_count,
        COUNT(*) FILTER (WHERE a.status = 'Joined') AS joined_count
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause}
      GROUP BY department
      ORDER BY open_count DESC, offered_count DESC
      LIMIT 8
    `, params),
    pool.query(`
      SELECT
        COALESCE(bu.bu_name, 'Unassigned') AS business_unit,
        COUNT(*) FILTER (WHERE a.status NOT IN ${TERMINAL_STATUS_SQL}) AS open_count,
        COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS offered_count,
        COUNT(*) FILTER (WHERE a.status = 'Joined') AS joined_count
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      ${whereClause}
      GROUP BY business_unit
      ORDER BY open_count DESC, offered_count DESC
      LIMIT 6
    `, params),
    pool.query(`
      SELECT
        a.application_id,
        a.candidate_name,
        a.status,
        COALESCE(a.recruiter_email, j.recruiter_email, 'Unassigned') AS recruiter,
        COALESCE(NULLIF(a.source, ''), 'Unknown') AS source,
        j.job_id,
        j.job_title,
        a.updated_at
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      ORDER BY a.updated_at DESC
      LIMIT 8
    `, params),
  ]);

  const headline = headlineResult.rows[0] || {};
  return {
    generated_at: new Date().toISOString(),
    filters,
    headline: {
      open_jobs: Number(openJobsResult.rows[0]?.open_jobs || 0),
      open_requisitions: Number(openReqResult.rows[0]?.open_requisitions || 0),
      active_candidates: Number(headline.active_candidates || 0),
      interviewing_candidates: Number(headline.interviewing_candidates || 0),
      closing_candidates: Number(headline.closing_candidates || 0),
      offers_in_flight: Number(headline.offers_in_flight || 0),
      joined_candidates: Number(headline.joined_candidates || 0),
    },
    funnel: funnelResult.rows.map((row) => ({
      stage: row.stage,
      count: Number(row.count || 0),
    })),
    monthly_trend: monthlyTrendResult.rows.reverse().map((row) => ({
      month: row.month_label,
      created_candidates: Number(row.created_candidates || 0),
      offer_stage_candidates: Number(row.offer_stage_candidates || 0),
      joined_candidates: Number(row.joined_candidates || 0),
    })),
    recruiter_momentum: recruiterMomentumResult.rows.map((row) => ({
      recruiter: row.recruiter,
      shortlisted_to_close: Number(row.shortlisted_to_close || 0),
      offers: Number(row.offers || 0),
      closures: Number(row.closures || 0),
      backouts: Number(row.backouts || 0),
    })),
    source_mix: sourceMixResult.rows.map((row) => ({
      source: row.source,
      count: Number(row.count || 0),
      offers: Number(row.offers || 0),
      joins: Number(row.joins || 0),
    })),
    department_health: departmentResult.rows.map((row) => ({
      department: row.department,
      open_count: Number(row.open_count || 0),
      selected_count: Number(row.selected_count || 0),
      offered_count: Number(row.offered_count || 0),
      joined_count: Number(row.joined_count || 0),
    })),
    business_unit_health: businessUnitResult.rows.map((row) => ({
      business_unit: row.business_unit,
      open_count: Number(row.open_count || 0),
      offered_count: Number(row.offered_count || 0),
      joined_count: Number(row.joined_count || 0),
    })),
    recent_activity: recentActivityResult.rows,
  };
}

// GET /funnel - Status funnel counts
router.get('/funnel', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT stage, COUNT(*) AS count
      FROM (
        SELECT
          ${buildFunnelBucketCase('a')} AS stage
        FROM applications a
        LEFT JOIN jobs j ON a.ats_job_id = j.job_id
        ${whereClause}
      ) grouped
      WHERE stage <> 'Other'
      GROUP BY stage
      ORDER BY CASE stage
        WHEN 'InQueue' THEN 1
        WHEN 'Applied' THEN 2
        WHEN 'Shortlisted' THEN 3
        WHEN 'Interview' THEN 4
        WHEN 'Selected' THEN 5
        WHEN 'Offered' THEN 6
        WHEN 'Joined' THEN 7
        ELSE 99
      END
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Funnel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/assistant', requireRole('hr_admin', 'hr_recruiter', 'hod'), async (req, res) => {
  try {
    const question = String(req.body?.question || '');
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const snapshot = await buildAssistantSnapshot(filters);
    const response = await answerAnalyticsQuestion({
      question,
      snapshot,
      history,
    });
    const aiStatus = await getAiServiceStatus();

    res.json({
      ...response,
      snapshot,
      ai_status: aiStatus,
    });
  } catch (err) {
    console.error('MIS assistant error:', err);
    res.status(500).json({ error: 'Failed to answer analytics question' });
  }
});

// GET /drilldown-summary - Click-first MIS groups with TAT and funnel counts
router.get('/drilldown-summary', adminOrRecruiter, async (req, res) => {
  try {
    const { group_by = 'department' } = req.query;
    const groupConfig = DRILLDOWN_GROUPS[group_by];
    if (!groupConfig) {
      return res.status(400).json({ error: 'Invalid group_by value' });
    }

    const { whereClause, params } = buildFilters(req.query);
    const result = await pool.query(`
      WITH grouped AS (
        SELECT
          ${groupConfig.select} AS group_value,
          a.status,
          ${buildFunnelBucketCase('a')} AS funnel_stage,
          a.created_at,
          a.updated_at
        FROM applications a
        LEFT JOIN jobs j ON a.ats_job_id = j.job_id
        LEFT JOIN business_units bu ON j.business_unit_id = bu.id
        LEFT JOIN locations l ON j.location_id = l.id
        LEFT JOIN phases p ON j.phase_id = p.id
        LEFT JOIN departments d ON j.department_id = d.id
        ${whereClause}
      )
      SELECT
        group_value,
        COUNT(*) AS total_candidates,
        COUNT(*) FILTER (WHERE status NOT IN ${TERMINAL_STATUS_SQL}) AS open_count,
        COUNT(*) FILTER (WHERE status IN ('Selected', 'OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')) AS selected_count,
        COUNT(*) FILTER (WHERE status IN ${OFFER_STATUS_SQL}) AS offered_count,
        COUNT(*) FILTER (WHERE status = 'Joined') AS joined_count,
        COUNT(*) FILTER (WHERE funnel_stage = 'Interview') AS interview_count,
        ROUND(AVG(CASE WHEN status IN ${OFFER_STATUS_SQL} THEN EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400 END)::numeric, 1) AS avg_tat_days,
        ROUND(AVG(CASE WHEN status = 'Joined' THEN EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400 END)::numeric, 1) AS avg_join_cycle_days
      FROM grouped
      GROUP BY group_value
      ORDER BY open_count DESC, offered_count DESC, group_value
    `, params);

    res.json({
      group_by,
      group_label: groupConfig.label,
      items: result.rows,
      data: result.rows,
    });
  } catch (err) {
    console.error('MIS drilldown summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /drilldown-details - Tabular rows for clicked MIS section
router.get('/drilldown-details', adminOrRecruiter, async (req, res) => {
  try {
    const { group_by = 'department', group_value, stage_bucket } = req.query;
    const groupConfig = DRILLDOWN_GROUPS[group_by];
    if (!groupConfig) {
      return res.status(400).json({ error: 'Invalid group_by value' });
    }

    const { whereClause, params } = buildFilters(req.query);
    const scopedParams = [...params];
    let scopedWhereClause = whereClause;

    if (group_value) {
      scopedParams.push(group_value);
      scopedWhereClause += ` AND ${groupConfig.select} = $${scopedParams.length}`;
    }
    if (stage_bucket) {
      scopedParams.push(stage_bucket);
      scopedWhereClause += ` AND ${buildFunnelBucketCase('a')} = $${scopedParams.length}`;
    }

    const result = await pool.query(`
      SELECT
        a.id,
        a.application_id,
        a.candidate_name,
        a.candidate_email,
        a.status,
        a.source,
        a.created_by,
        COALESCE(a.recruiter_email, j.recruiter_email) AS recruiter_email,
        a.created_at,
        a.updated_at,
        j.job_id,
        j.job_title,
        COALESCE(bu.bu_name, 'Unassigned') AS business_unit,
        COALESCE(l.location_name, 'Unassigned') AS location,
        COALESCE(p.phase_name, 'Unassigned') AS phase,
        COALESCE(d.department_name, 'Unassigned') AS department,
        ${buildFunnelBucketCase('a')} AS stage_bucket,
        ROUND(CASE WHEN a.status IN ${OFFER_STATUS_SQL} THEN EXTRACT(EPOCH FROM (a.updated_at - a.created_at)) / 86400 END) AS tat_days
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      ${scopedWhereClause}
      ORDER BY a.updated_at DESC, a.created_at DESC
      LIMIT 200
    `, scopedParams);

    res.json({
      group_by,
      group_value: group_value || null,
      stage_bucket: stage_bucket || null,
      rows: result.rows,
      items: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('MIS drilldown details error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /entity-summary - BU/Phase level department wise open, offered, selected
router.get('/entity-summary', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        bu.bu_name as business_unit,
        p.phase_name as phase,
        d.department_name as department,
        COUNT(*) FILTER (WHERE a.status NOT IN ('Joined','Withdrawn','HRRejected','HODRejected','Round1Rejected','Round2Rejected','Round3Rejected','OfferRejected','OfferDropout')) as open_count,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as offered_count,
        COUNT(*) FILTER (WHERE a.status IN ('Selected','OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as selected_count,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as joined_count,
        COUNT(*) FILTER (WHERE a.status IN ('HRRejected','HODRejected','Round1Rejected','Round2Rejected','Round3Rejected','OfferRejected','Withdrawn','OfferDropout')) as rejected_count,
        COUNT(*) as total
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause}
      GROUP BY bu.bu_name, p.phase_name, d.department_name
      ORDER BY bu.bu_name, p.phase_name, d.department_name
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Entity summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /backfill-summary - Backfill phase wise department wise
router.get('/backfill-summary', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const backfillClause = `${whereClause} AND j.requisition_type = 'backfill'`;

    const result = await pool.query(`
      SELECT
        p.phase_name as phase,
        d.department_name as department,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE a.status NOT IN ('Joined','Withdrawn','HRRejected','HODRejected','Round1Rejected','Round2Rejected','Round3Rejected','OfferRejected','OfferDropout')) as open_count,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as offered_count,
        COUNT(*) FILTER (WHERE a.status IN ('Selected','OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as selected_count,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as joined_count
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      ${backfillClause}
      GROUP BY p.phase_name, d.department_name
      ORDER BY p.phase_name, d.department_name
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Backfill summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /new-positions-summary - New positions phase wise department wise
router.get('/new-positions-summary', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const newPosClause = `${whereClause} AND j.requisition_type = 'new_hire'`;

    const result = await pool.query(`
      SELECT
        p.phase_name as phase,
        d.department_name as department,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE a.status NOT IN ('Joined','Withdrawn','HRRejected','HODRejected','Round1Rejected','Round2Rejected','Round3Rejected','OfferRejected','OfferDropout')) as open_count,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as offered_count,
        COUNT(*) FILTER (WHERE a.status IN ('Selected','OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as selected_count,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as joined_count
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      ${newPosClause}
      GROUP BY p.phase_name, d.department_name
      ORDER BY p.phase_name, d.department_name
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('New positions summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /tat - Turn Around Time with and without dropouts
router.get('/tat', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        d.department_name as category,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (a.updated_at - a.created_at)) / 86400)::numeric, 1) as avg_days_with_dropouts,
        ROUND(AVG(CASE WHEN a.status NOT IN ('Withdrawn','OfferDropout','OfferRejected','HRRejected','HODRejected','Round1Rejected','Round2Rejected','Round3Rejected')
          THEN EXTRACT(EPOCH FROM (COALESCE(a.updated_at, NOW()) - a.created_at)) / 86400 END)::numeric, 1) as avg_tat_days_no_dropouts,
        ROUND(MIN(EXTRACT(EPOCH FROM (a.updated_at - a.created_at)) / 86400)::numeric, 1) as min_days,
        ROUND(MAX(EXTRACT(EPOCH FROM (a.updated_at - a.created_at)) / 86400)::numeric, 1) as max_days
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause}
      GROUP BY d.department_name
      ORDER BY d.department_name
    `, params);

    const normalized = result.rows.map((row) => ({
      ...row,
      avg_days_without_dropouts: row.avg_tat_days_no_dropouts,
    }));

    res.json(normalized);
  } catch (err) {
    console.error('TAT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /monthly-offers - Monthly offers/closures recruiter wise
router.get('/monthly-offers', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        TO_CHAR(COALESCE(a.joining_date::timestamp, a.updated_at, a.created_at), 'YYYY-MM') as month,
        COALESCE(a.recruiter_email, 'Unassigned') as recruiter_email,
        COALESCE(u.name, a.recruiter_email, 'Unassigned') as recruiter_name,
        COALESCE(u.name, a.recruiter_email, 'Unassigned') as recruiter,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as offers,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as closures,
        COUNT(*) FILTER (WHERE a.status = 'OfferAccepted') as pending_joins,
        COUNT(*) FILTER (WHERE a.status IN ('OfferRejected', 'OfferDropout')) as backouts
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN users u ON LOWER(u.email) = LOWER(a.recruiter_email)
      ${whereClause}
      GROUP BY TO_CHAR(COALESCE(a.joining_date::timestamp, a.updated_at, a.created_at), 'YYYY-MM'),
               COALESCE(a.recruiter_email, 'Unassigned'),
               COALESCE(u.name, a.recruiter_email, 'Unassigned')
      ORDER BY month DESC, offers DESC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Monthly offers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /open-positions-tat - Open jobs aging, workbook style
router.get('/open-positions-tat', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const jobWhereClause = buildJobLevelFilters(whereClause);

    const result = await pool.query(`
      SELECT
        j.job_id,
        j.job_title,
        j.requisition_type,
        j.job_type,
        j.total_positions,
        COALESCE(bu.bu_name, 'Unassigned') AS business_unit,
        COALESCE(l.location_name, 'Unassigned') AS location,
        COALESCE(p.phase_name, 'Unassigned') AS phase,
        COALESCE(d.department_name, 'Unassigned') AS department,
        COALESCE(sd.sub_department_name, 'Unassigned') AS sub_department,
        COALESCE(j.recruiter_email, 'Unassigned') AS recruiter_email,
        COALESCE(r.created_at, j.created_at) AS req_date,
        ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(r.created_at, j.created_at))) / 86400) AS tat_days
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      ${jobWhereClause} AND j.status = 'open' AND j.active_flag = true
      ORDER BY tat_days DESC, req_date ASC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Open positions TAT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /offers-tat - Offers and open positions TAT
router.get('/offers-tat', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      WITH offer_events AS (
        SELECT
          a.ats_job_id,
          MIN(a.updated_at) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS first_offer_date,
          COUNT(*) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS total_offers,
          COUNT(*) FILTER (WHERE a.status NOT IN ${TERMINAL_STATUS_SQL}) AS still_open
        FROM applications a
        WHERE a.active_flag = true
        GROUP BY a.ats_job_id
      )
      SELECT
        j.job_id,
        j.job_title,
        j.requisition_type,
        j.job_type,
        j.total_positions,
        COALESCE(bu.bu_name, 'Unassigned') AS business_unit,
        COALESCE(l.location_name, 'Unassigned') AS location,
        COALESCE(p.phase_name, 'Unassigned') AS phase,
        d.department_name as department,
        COALESCE(sd.sub_department_name, 'Unassigned') AS sub_department,
        COALESCE(j.recruiter_email, 'Unassigned') AS recruiter_email,
        j.created_at as req_date,
        oe.first_offer_date,
        ROUND(EXTRACT(EPOCH FROM (oe.first_offer_date - j.created_at)) / 86400)::numeric as avg_days_to_offer,
        COALESCE(oe.total_offers, 0) as total_offers,
        COALESCE(oe.still_open, 0) as still_open
      FROM jobs j
      LEFT JOIN offer_events oe ON oe.ats_job_id = j.job_id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      ${whereClause.replace(/a\.created_at/g, 'j.created_at').replace(/a\.recruiter_email/g, 'j.recruiter_email')}
      ORDER BY j.created_at DESC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Offers TAT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /selection-to-offer - Selection to offer TAT
router.get('/selection-to-offer', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      WITH latest_round_feedback AS (
        SELECT
          ifb.application_id,
          MAX(COALESCE(ifb.actual_datetime, ifb.updated_at, ifb.created_at)) AS final_feedback_at
        FROM interview_feedback ifb
        WHERE ifb.status = 'completed'
        GROUP BY ifb.application_id
      ),
      offer_events AS (
        SELECT
          a.id AS application_id,
          a.recruiter_email,
          a.ats_job_id,
          MIN(a.updated_at) FILTER (WHERE a.status IN ${OFFER_STATUS_SQL}) AS first_offer_date
        FROM applications a
        GROUP BY a.id, a.recruiter_email, a.ats_job_id
      )
      SELECT
        d.department_name as department,
        oe.recruiter_email,
        COUNT(*) as total,
        ROUND(AVG(EXTRACT(EPOCH FROM (oe.first_offer_date - lrf.final_feedback_at)) / 86400)::numeric, 1) as avg_selection_to_offer_days,
        ROUND(MIN(EXTRACT(EPOCH FROM (oe.first_offer_date - lrf.final_feedback_at)) / 86400)::numeric, 1) as min_days,
        ROUND(MAX(EXTRACT(EPOCH FROM (oe.first_offer_date - lrf.final_feedback_at)) / 86400)::numeric, 1) as max_days
      FROM offer_events oe
      INNER JOIN latest_round_feedback lrf ON lrf.application_id = oe.application_id
      LEFT JOIN jobs j ON oe.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause.replace(/a\./g, 'oe.')} AND oe.first_offer_date IS NOT NULL
      GROUP BY d.department_name, oe.recruiter_email
      ORDER BY d.department_name, avg_selection_to_offer_days
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Selection to offer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /recruiter-sourcing - Recruiter wise offers by sourcing type
router.get('/recruiter-sourcing', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        COALESCE(a.recruiter_email, 'Unassigned') as recruiter_email,
        COALESCE(u.name, a.recruiter_email, 'Unassigned') as recruiter_name,
        COALESCE(u.name, a.recruiter_email, 'Unassigned') as recruiter,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') IN ('LinkedIn', 'Naukri', 'Indeed', 'Company Website', 'Walk-in', 'Direct', 'Other')) as job_portal,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') = 'Employee Referral') as referral,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') ILIKE '%campus%') as campus,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') IN ('Consultant', 'Agency')) as agency,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') IN ('Internal', 'Employee Apply')) as internal,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') NOT IN ('LinkedIn','Naukri','Indeed','Company Website','Walk-in','Direct','Other','Employee Referral','Consultant','Agency','Internal','Employee Apply') OR a.source IS NULL OR a.source ILIKE '%campus%') as other_unknown,
        COUNT(*) as total
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN users u ON LOWER(u.email) = LOWER(a.recruiter_email)
      ${whereClause}
      GROUP BY COALESCE(a.recruiter_email, 'Unassigned'),
               COALESCE(u.name, a.recruiter_email, 'Unassigned')
      ORDER BY total DESC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Recruiter sourcing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /backouts-summary - Candidate backouts after selection/offer with reasons
router.get('/backouts-summary', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        COALESCE(NULLIF(a.dropout_reason, ''), NULLIF(a.rejection_reason, ''), a.status) as reason,
        COUNT(*) as count,
        COALESCE(a.recruiter_email, 'Unassigned') as recruiter
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause} AND a.status IN ('Withdrawn','OfferRejected','OfferDropout')
      GROUP BY COALESCE(NULLIF(a.dropout_reason, ''), NULLIF(a.rejection_reason, ''), a.status), COALESCE(a.recruiter_email, 'Unassigned')
      ORDER BY count DESC
    `, params);

    // Also get summary totals
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE a.status = 'Withdrawn') as withdrawn_count,
        COUNT(*) FILTER (WHERE a.status = 'OfferRejected') as offer_rejected_count,
        COUNT(*) FILTER (WHERE a.status = 'OfferDropout') as offer_dropout_count,
        COUNT(*) as total_backouts
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause} AND a.status IN ('Withdrawn','OfferRejected','OfferDropout')
    `, params);

    res.json({ details: result.rows, data: result.rows, summary: summary.rows[0] });
  } catch (err) {
    console.error('Backouts summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /time-to-fill - From date of requisition to offer
router.get('/time-to-fill', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const jobWhereClause = buildJobLevelFilters(whereClause);

    const result = await pool.query(`
      WITH offer_events AS (
        SELECT
          ats_job_id,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) AS first_offer_date
        FROM applications
        WHERE active_flag = true
        GROUP BY ats_job_id
      )
      SELECT
        d.department_name as department,
        j.job_id,
        j.job_title,
        j.requisition_type,
        j.job_type,
        j.total_positions,
        COALESCE(bu.bu_name, 'Unassigned') AS business_unit,
        COALESCE(l.location_name, 'Unassigned') AS location,
        COALESCE(p.phase_name, 'Unassigned') AS phase,
        COALESCE(sd.sub_department_name, 'Unassigned') AS sub_department,
        COALESCE(j.recruiter_email, 'Unassigned') AS recruiter_email,
        COALESCE(r.created_at, j.created_at) as req_date,
        oe.first_offer_date,
        ROUND(EXTRACT(EPOCH FROM (oe.first_offer_date - COALESCE(r.created_at, j.created_at))) / 86400) as time_to_fill_days
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      LEFT JOIN offer_events oe ON oe.ats_job_id = j.job_id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      ${jobWhereClause} AND oe.first_offer_date IS NOT NULL
      ORDER BY time_to_fill_days DESC
    `, params);

    // Averages
    const avgResult = await pool.query(`
      WITH offer_events AS (
        SELECT
          ats_job_id,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) AS first_offer_date
        FROM applications
        WHERE active_flag = true
        GROUP BY ats_job_id
      )
      SELECT
        d.department_name as department,
        ROUND(AVG(EXTRACT(EPOCH FROM (oe.first_offer_date - COALESCE(r.created_at, j.created_at))) / 86400)::numeric, 1) as avg_time_to_fill_days
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      INNER JOIN offer_events oe ON oe.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${jobWhereClause} AND oe.first_offer_date IS NOT NULL
      GROUP BY d.department_name
      ORDER BY d.department_name
    `, params);

    const overallResult = await pool.query(`
      WITH offer_events AS (
        SELECT
          ats_job_id,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) AS first_offer_date
        FROM applications
        WHERE active_flag = true
        GROUP BY ats_job_id
      )
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (oe.first_offer_date - COALESCE(r.created_at, j.created_at))) / 86400)::numeric, 1) as average_days
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      INNER JOIN offer_events oe ON oe.ats_job_id = j.job_id
      ${jobWhereClause} AND oe.first_offer_date IS NOT NULL
    `, params);

    res.json({ details: result.rows, averages: avgResult.rows, average_days: overallResult.rows[0]?.average_days ?? null });
  } catch (err) {
    console.error('Time to fill error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /time-to-join - From offer to joining
router.get('/time-to-join', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      WITH offer_events AS (
        SELECT
          id,
          recruiter_email,
          ats_job_id,
          created_at,
          joining_date,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) OVER (PARTITION BY id) AS first_offer_date
        FROM applications
      )
      SELECT
        d.department_name as department,
        oe.recruiter_email,
        COUNT(*) as total,
        ROUND(AVG(EXTRACT(EPOCH FROM (oe.joining_date::timestamp - oe.first_offer_date)) / 86400)::numeric, 1) as avg_time_to_join_days,
        ROUND(MIN(EXTRACT(EPOCH FROM (oe.joining_date::timestamp - oe.first_offer_date)) / 86400)::numeric, 1) as min_days,
        ROUND(MAX(EXTRACT(EPOCH FROM (oe.joining_date::timestamp - oe.first_offer_date)) / 86400)::numeric, 1) as max_days
      FROM offer_events oe
      LEFT JOIN jobs j ON oe.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause.replace(/a\./g, 'oe.')} AND oe.first_offer_date IS NOT NULL AND oe.joining_date IS NOT NULL
      GROUP BY d.department_name, oe.recruiter_email
      ORDER BY d.department_name, avg_time_to_join_days
    `, params);

    const overall = await pool.query(`
      WITH offer_events AS (
        SELECT
          id,
          recruiter_email,
          ats_job_id,
          created_at,
          joining_date,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) OVER (PARTITION BY id) AS first_offer_date
        FROM applications
      )
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (oe.joining_date::timestamp - oe.first_offer_date)) / 86400)::numeric, 1) as average_days
      FROM offer_events oe
      LEFT JOIN jobs j ON oe.ats_job_id = j.job_id
      ${whereClause.replace(/a\./g, 'oe.')} AND oe.first_offer_date IS NOT NULL AND oe.joining_date IS NOT NULL
    `, params);

    res.json({ details: result.rows, average_days: overall.rows[0]?.average_days ?? null });
  } catch (err) {
    console.error('Time to join error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /offer-acceptance-rate - Offer to acceptance rate
router.get('/offer-acceptance-rate', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        d.department_name as department,
        a.recruiter_email,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as total_offers,
        COUNT(*) FILTER (WHERE a.status IN ('OfferAccepted','Joined')) as accepted,
        COUNT(*) FILTER (WHERE a.status IN ('OfferRejected', 'OfferDropout')) as declined,
        ROUND(
          (COUNT(*) FILTER (WHERE a.status IN ('OfferAccepted','Joined'))::numeric /
           NULLIF(COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')), 0) * 100
          ), 1
        ) as acceptance_rate
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause}
      GROUP BY d.department_name, a.recruiter_email
      ORDER BY acceptance_rate DESC
    `, params);

    // Overall rate
    const overall = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as total_offers,
        COUNT(*) FILTER (WHERE a.status IN ('OfferAccepted','Joined')) as accepted,
        ROUND(
          (COUNT(*) FILTER (WHERE a.status IN ('OfferAccepted','Joined'))::numeric /
           NULLIF(COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')), 0) * 100
          ), 1
        ) as overall_acceptance_rate
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
    `, params);

    res.json({
      details: result.rows,
      overall: overall.rows[0],
      rate: overall.rows[0]?.overall_acceptance_rate ?? null,
      accepted: overall.rows[0]?.accepted ?? 0,
      total: overall.rows[0]?.total_offers ?? 0,
    });
  } catch (err) {
    console.error('Offer acceptance rate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /offer-join-ratio - Offer to join ratio
router.get('/offer-join-ratio', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const result = await pool.query(`
      SELECT
        d.department_name as department,
        a.recruiter_email,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as total_offers,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as joined,
        ROUND(
          (COUNT(*) FILTER (WHERE a.status = 'Joined')::numeric /
           NULLIF(COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')), 0) * 100
          ), 1
        ) as join_ratio
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      LEFT JOIN departments d ON j.department_id = d.id
      ${whereClause}
      GROUP BY d.department_name, a.recruiter_email
      ORDER BY join_ratio DESC
    `, params);

    // Overall
    const overall = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as total_offers,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as joined,
        ROUND(
          (COUNT(*) FILTER (WHERE a.status = 'Joined')::numeric /
           NULLIF(COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')), 0) * 100
          ), 1
        ) as overall_join_ratio
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
    `, params);

    res.json({
      details: result.rows,
      overall: overall.rows[0],
      ratio: overall.rows[0]?.overall_join_ratio ?? null,
      joined: overall.rows[0]?.joined ?? 0,
      offered: overall.rows[0]?.total_offers ?? 0,
    });
  } catch (err) {
    console.error('Offer join ratio error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /dashboard - Combined dashboard stats
router.get('/dashboard', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const jobWhereClause = buildJobLevelFilters(whereClause);

    const [summary, pipeline, openJobs] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total_applications,
          COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) AS offers_made,
          COUNT(*) FILTER (
            WHERE a.status = 'Joined'
              AND DATE_TRUNC('month', COALESCE(a.joining_date::timestamp, a.updated_at, a.created_at)) = DATE_TRUNC('month', NOW())
          ) AS joined_this_month,
          ROUND((
            COUNT(*) FILTER (WHERE a.status IN ('OfferAccepted','Joined'))::numeric /
            NULLIF(COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')), 0)
          ) * 100, 1) AS offer_acceptance_rate
        FROM applications a
        LEFT JOIN jobs j ON a.ats_job_id = j.job_id
        ${whereClause}
      `, params),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE a.status = 'InQueue') AS in_queue,
          COUNT(*) FILTER (WHERE a.status IN ('Applied', 'Shortlisted')) AS screening,
          COUNT(*) FILTER (WHERE a.status IN ('AwaitingHODResponse', 'AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3', 'AwaitingFeedback')) AS interviewing,
          COUNT(*) FILTER (WHERE a.status = 'Selected') AS selected,
          COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout')) AS offered
        FROM applications a
        LEFT JOIN jobs j ON a.ats_job_id = j.job_id
        ${whereClause}
      `, params),
      pool.query(`
        SELECT COUNT(*) AS open_jobs
        FROM jobs j
        LEFT JOIN requisitions r ON j.requisition_id = r.id
        ${jobWhereClause} AND j.status = 'open' AND j.active_flag = true
      `, params)
    ]);

    const avgTimeToFill = await pool.query(`
      WITH offer_events AS (
        SELECT
          ats_job_id,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) AS first_offer_date
        FROM applications
        WHERE active_flag = true
        GROUP BY ats_job_id
      )
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (oe.first_offer_date - COALESCE(r.created_at, j.created_at))) / 86400)::numeric, 1) AS avg_time_to_fill
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      INNER JOIN offer_events oe ON oe.ats_job_id = j.job_id
      ${jobWhereClause} AND oe.first_offer_date IS NOT NULL
    `, params);

    const avgTimeToJoin = await pool.query(`
      WITH offer_events AS (
        SELECT
          id,
          ats_job_id,
          recruiter_email,
          created_at,
          joining_date,
          MIN(updated_at) FILTER (
            WHERE status IN ('OfferInProcess', 'Offered', 'OfferAccepted', 'OfferRejected', 'OfferDropout', 'Joined')
          ) OVER (PARTITION BY id) AS first_offer_date
        FROM applications
      )
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (oe.joining_date::timestamp - oe.first_offer_date)) / 86400)::numeric, 1) AS avg_time_to_join
      FROM offer_events oe
      LEFT JOIN jobs j ON oe.ats_job_id = j.job_id
      ${whereClause.replace(/a\./g, 'oe.')} AND oe.first_offer_date IS NOT NULL AND oe.joining_date IS NOT NULL
    `, params);

    const summaryRow = summary.rows[0] || {};
    const pipelineRow = pipeline.rows[0] || {};
    const openJobsRow = openJobs.rows[0] || {};

    const aiStatus = await getAiServiceStatus();

    res.json({
      open_jobs: Number(openJobsRow.open_jobs || 0),
      total_applications: Number(summaryRow.total_applications || 0),
      offers_made: Number(summaryRow.offers_made || 0),
      joined_this_month: Number(summaryRow.joined_this_month || 0),
      in_queue: Number(pipelineRow.in_queue || 0),
      screening: Number(pipelineRow.screening || 0),
      interviewing: Number(pipelineRow.interviewing || 0),
      selected: Number(pipelineRow.selected || 0),
      offered: Number(pipelineRow.offered || 0),
      offer_acceptance_rate: Number(summaryRow.offer_acceptance_rate || 0),
      avg_time_to_fill: Number(avgTimeToFill.rows[0]?.avg_time_to_fill || 0),
      avg_time_to_join: Number(avgTimeToJoin.rows[0]?.avg_time_to_join || 0),
      ai_status: aiStatus,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /tat-phases - TAT metrics per phase: requisition, approval by person, job creation, candidate milestones
router.get('/tat-phases', adminOrRecruiter, async (req, res) => {
  try {
    const { date_from, date_to, business_unit_id, department_id } = req.query;

    const filters = [];
    const params = [];
    if (date_from) { params.push(date_from); filters.push(`r.created_at >= $${params.length}`); }
    if (date_to) { params.push(date_to); filters.push(`r.created_at <= $${params.length}`); }
    if (business_unit_id) { params.push(business_unit_id); filters.push(`r.business_unit_id = $${params.length}`); }
    if (department_id) { params.push(department_id); filters.push(`r.department_id = $${params.length}`); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : 'WHERE 1=1';

    // 1. Requisition creation to approval TAT
    const reqTatResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'approved') AS approved_count,
        ROUND(AVG(
          CASE WHEN r.approved_at IS NOT NULL AND r.submitted_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.approved_at - r.submitted_at)) / 3600
          END
        )::numeric, 1) AS avg_req_to_approval_hours,
        ROUND(AVG(
          CASE WHEN r.approved_at IS NOT NULL AND r.created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.approved_at - r.created_at)) / 86400
          END
        )::numeric, 1) AS avg_req_to_approval_days,
        ROUND(MIN(
          CASE WHEN r.approved_at IS NOT NULL AND r.submitted_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.approved_at - r.submitted_at)) / 86400
          END
        )::numeric, 1) AS min_req_to_approval_days,
        ROUND(MAX(
          CASE WHEN r.approved_at IS NOT NULL AND r.submitted_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.approved_at - r.submitted_at)) / 86400
          END
        )::numeric, 1) AS max_req_to_approval_days
      FROM requisitions r
      ${whereClause}
        AND r.active_flag = true
    `, params);

    // 2. Approval TAT by individual approver
    const approverTatResult = await pool.query(`
      SELECT
        ra.approver_email,
        ra.approver_name,
        ra.approval_stage,
        COUNT(*) AS total_approvals,
        ROUND(AVG(
          CASE WHEN ra.acted_at IS NOT NULL AND ra.created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (ra.acted_at - ra.created_at)) / 3600
          END
        )::numeric, 1) AS avg_response_hours,
        ROUND(MIN(
          CASE WHEN ra.acted_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (ra.acted_at - ra.created_at)) / 3600
          END
        )::numeric, 1) AS min_response_hours,
        ROUND(MAX(
          CASE WHEN ra.acted_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (ra.acted_at - ra.created_at)) / 3600
          END
        )::numeric, 1) AS max_response_hours
      FROM requisition_approvals ra
      JOIN requisitions r ON r.id = ra.requisition_id
      ${whereClause.replace(/r\./g, 'r.')}
        AND r.active_flag = true
        AND ra.status IN ('approved', 'rejected')
      GROUP BY ra.approver_email, ra.approver_name, ra.approval_stage
      ORDER BY avg_response_hours DESC NULLS LAST
    `, params);

    // 3. Approved requisition to job creation TAT
    const jobCreationTatResult = await pool.query(`
      SELECT
        COUNT(DISTINCT j.job_id) AS jobs_created,
        ROUND(AVG(
          CASE WHEN j.created_at IS NOT NULL AND r.approved_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (j.created_at - r.approved_at)) / 86400
          END
        )::numeric, 1) AS avg_approval_to_job_days,
        ROUND(MIN(
          CASE WHEN j.created_at IS NOT NULL AND r.approved_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (j.created_at - r.approved_at)) / 86400
          END
        )::numeric, 1) AS min_approval_to_job_days,
        ROUND(MAX(
          CASE WHEN j.created_at IS NOT NULL AND r.approved_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (j.created_at - r.approved_at)) / 86400
          END
        )::numeric, 1) AS max_approval_to_job_days
      FROM jobs j
      JOIN requisitions r ON j.requisition_id = r.id
      ${whereClause.replace(/r\.created_at/g, 'j.created_at').replace(/r\.business_unit_id/g, 'j.business_unit_id').replace(/r\.department_id/g, 'j.department_id')}
        AND r.active_flag = true
        AND j.active_flag = true
    `, params);

    // 4. Candidate milestone TAT (1st, 5th, 10th candidate per job)
    const candidateMilestoneTatResult = await pool.query(`
      WITH ranked_candidates AS (
        SELECT
          a.ats_job_id,
          j.job_title,
          a.created_at,
          j.created_at AS job_created_at,
          ROW_NUMBER() OVER (PARTITION BY a.ats_job_id ORDER BY a.created_at ASC) AS candidate_rank
        FROM applications a
        JOIN jobs j ON a.ats_job_id = j.job_id
        WHERE a.active_flag = true AND j.active_flag = true
      ),
      milestones AS (
        SELECT
          ats_job_id,
          job_title,
          job_created_at,
          MAX(CASE WHEN candidate_rank = 1 THEN created_at END) AS first_candidate_at,
          MAX(CASE WHEN candidate_rank = 5 THEN created_at END) AS fifth_candidate_at,
          MAX(CASE WHEN candidate_rank = 10 THEN created_at END) AS tenth_candidate_at,
          MAX(candidate_rank) AS total_candidates
        FROM ranked_candidates
        GROUP BY ats_job_id, job_title, job_created_at
      )
      SELECT
        COUNT(*) AS total_jobs,
        ROUND(AVG(
          CASE WHEN first_candidate_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (first_candidate_at - job_created_at)) / 86400
          END
        )::numeric, 1) AS avg_days_to_first_candidate,
        ROUND(AVG(
          CASE WHEN fifth_candidate_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fifth_candidate_at - job_created_at)) / 86400
          END
        )::numeric, 1) AS avg_days_to_fifth_candidate,
        ROUND(AVG(
          CASE WHEN tenth_candidate_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (tenth_candidate_at - job_created_at)) / 86400
          END
        )::numeric, 1) AS avg_days_to_tenth_candidate,
        COUNT(*) FILTER (WHERE first_candidate_at IS NOT NULL) AS jobs_with_first_candidate,
        COUNT(*) FILTER (WHERE fifth_candidate_at IS NOT NULL) AS jobs_with_fifth_candidate,
        COUNT(*) FILTER (WHERE tenth_candidate_at IS NOT NULL) AS jobs_with_tenth_candidate
      FROM milestones
    `);

    // 5. Per-job milestone breakdown (top 20 most recent)
    const perJobMilestonesResult = await pool.query(`
      WITH ranked_candidates AS (
        SELECT
          a.ats_job_id,
          j.job_title,
          j.created_at AS job_created_at,
          a.created_at,
          ROW_NUMBER() OVER (PARTITION BY a.ats_job_id ORDER BY a.created_at ASC) AS candidate_rank
        FROM applications a
        JOIN jobs j ON a.ats_job_id = j.job_id
        WHERE a.active_flag = true AND j.active_flag = true
      )
      SELECT
        ats_job_id,
        job_title,
        job_created_at,
        MAX(CASE WHEN candidate_rank = 1 THEN ROUND(EXTRACT(EPOCH FROM (created_at - job_created_at)) / 86400, 1) END) AS days_to_1st,
        MAX(CASE WHEN candidate_rank = 5 THEN ROUND(EXTRACT(EPOCH FROM (created_at - job_created_at)) / 86400, 1) END) AS days_to_5th,
        MAX(CASE WHEN candidate_rank = 10 THEN ROUND(EXTRACT(EPOCH FROM (created_at - job_created_at)) / 86400, 1) END) AS days_to_10th,
        MAX(candidate_rank) AS total_candidates
      FROM ranked_candidates
      GROUP BY ats_job_id, job_title, job_created_at
      ORDER BY job_created_at DESC
      LIMIT 20
    `);

    res.json({
      requisition_tat: reqTatResult.rows[0] || {},
      approval_tat_by_person: approverTatResult.rows,
      job_creation_tat: jobCreationTatResult.rows[0] || {},
      candidate_milestone_tat: candidateMilestoneTatResult.rows[0] || {},
      per_job_milestones: perJobMilestonesResult.rows,
    });
  } catch (err) {
    console.error('TAT phases error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /ninety-days-recruiter - Open positions > 90 days TAT grouped by recruiter (matches Excel "Summary" sheet)
router.get('/ninety-days-recruiter', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const jobWhereClause = buildJobLevelFilters(whereClause);

    const summary = await pool.query(`
      SELECT
        COALESCE(j.recruiter_email, 'Unassigned') AS recruiter,
        COUNT(*) AS count
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      ${jobWhereClause}
        AND j.status = 'open'
        AND j.active_flag = true
        AND ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(r.created_at, j.created_at))) / 86400) > 90
      GROUP BY COALESCE(j.recruiter_email, 'Unassigned')
      ORDER BY count DESC
    `, params);

    const details = await pool.query(`
      SELECT
        j.job_id,
        j.job_title,
        j.requisition_type,
        j.job_type,
        j.total_positions,
        COALESCE(bu.bu_name, 'Unassigned') AS company,
        COALESCE(p.phase_name, 'Unassigned') AS phase,
        COALESCE(d.department_name, 'Unassigned') AS department,
        COALESCE(sd.sub_department_name, 'Unassigned') AS sub_department,
        COALESCE(l.location_name, 'Unassigned') AS branch,
        COALESCE(j.recruiter_email, 'Unassigned') AS recruiter,
        COALESCE(r.created_at, j.created_at) AS position_opened_on,
        ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(r.created_at, j.created_at))) / 86400) AS tat_days,
        j.status
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      ${jobWhereClause}
        AND j.status = 'open'
        AND j.active_flag = true
        AND ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(r.created_at, j.created_at))) / 86400) > 90
      ORDER BY tat_days DESC
    `, params);

    res.json({ summary: summary.rows, details: details.rows });
  } catch (err) {
    console.error('Ninety days recruiter error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /detailed-open-positions - Full open positions list matching Excel Factory Open Positions format
router.get('/detailed-open-positions', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);
    const jobWhereClause = buildJobLevelFilters(whereClause);

    const result = await pool.query(`
      SELECT
        j.job_title AS "Job Title",
        j.job_id AS "Job ID",
        j.requisition_type AS "New/Replacement",
        j.job_type AS "Permanent/Contractual",
        j.total_positions AS "Number of Openings",
        COALESCE(p.phase_name, '') AS "Phase",
        COALESCE(bu.bu_name, '') AS "Company",
        COALESCE(d.department_name, '') AS "Department",
        COALESCE(sd.sub_department_name, '') AS "Sub Department",
        COALESCE(des.designation, '') AS "Designation",
        COALESCE(l.location_name, '') AS "Branch",
        COALESCE(j.recruiter_email, '') AS "Recruiter",
        COALESCE(r.created_at, j.created_at) AS "Position Opened On",
        ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(r.created_at, j.created_at))) / 86400) AS "TAT",
        j.status AS "Status"
      FROM jobs j
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      LEFT JOIN designations des ON des.id = (
        SELECT id FROM designations LIMIT 1
      )
      ${jobWhereClause} AND j.active_flag = true AND j.status NOT IN ('closed', 'archived')
      ORDER BY "TAT" DESC
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Detailed open positions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Raw export: one row per application with every field from requisition
// creation through current state  requisition, job, candidate, application,
// interview feedback, clearance, offer, join. Used by "Raw Data" tab for
// MIS exports. Every field is exposed as a column; nested JSON is flattened
// to comma-separated scalars where useful.
// ───────────────────────────────────────────────────────────────────────────
router.get('/raw-export', adminOrRecruiter, async (req, res) => {
  try {
    const { whereClause, params } = buildFilters(req.query);

    const sql = `
      SELECT
        -- Requisition
        r.requisition_id        AS "Requisition ID",
        r.job_title             AS "Requisition Title",
        r.priority              AS "Priority",
        r.requisition_type      AS "Requisition Type",
        r.job_type              AS "Employment Type",
        r.experience_years      AS "Experience (yrs)",
        r.total_positions       AS "Positions",
        r.start_hire_date       AS "Hire Window Start",
        r.target_hire_date      AS "Hire Window Target",
        r.created_by            AS "Requisition Created By",
        r.created_at            AS "Requisition Created At",
        r.submitted_by          AS "Requisition Submitted By",
        r.submitted_at          AS "Requisition Submitted At",
        r.current_approval_stage AS "Approval Stage",
        r.cxo_approval_required AS "CXO Approval Required",
        r.approved_by           AS "Approved By",
        r.approved_at           AS "Approved At",
        r.assigned_recruiter_email AS "Assigned Recruiter",
        r.assigned_recruiter_assigned_at AS "Assigned Recruiter At",
        r.approval_comments     AS "Approval Comments",

        -- Org / taxonomy
        bu.bu_name              AS "Business Unit",
        d.department_name       AS "Department",
        sd.sub_department_name  AS "Sub Department",
        l.location_name         AS "Location",
        p.phase_name            AS "Phase",
        g.grade                 AS "Grade",
        lv.level                AS "Level",

        -- Job
        j.job_id                AS "Job ID",
        j.hr_one_job_id         AS "HR One Job ID",
        j.job_title             AS "Job Title",
        j.status                AS "Job Status",
        j.number_of_positions   AS "Job Positions",
        j.compensation_currency AS "Currency",
        j.compensation_min      AS "Comp Min",
        j.compensation_max      AS "Comp Max",
        j.recruiter_email       AS "Job Recruiter",
        j.publish_to_careers    AS "Published",
        j.allow_employee_apply  AS "Internal Apply",
        j.allow_employee_refer  AS "Referral Open",
        j.created_at            AS "Job Created At",

        -- Application / candidate
        a.application_id        AS "Application ID",
        a.status                AS "Application Status",
        a.candidate_name        AS "Candidate Name",
        a.candidate_email       AS "Candidate Email",
        a.candidate_phone       AS "Candidate Phone",
        a.candidate_age         AS "Candidate Age",
        a.candidate_gender      AS "Candidate Gender",
        a.candidate_years_of_experience AS "Candidate Experience",
        a.current_organization  AS "Current Employer",
        a.current_ctc           AS "Current CTC",
        a.current_location      AS "Current Location",
        a.willing_to_relocate   AS "Relocation",
        a.education_level       AS "Education",
        a.source                AS "Source",
        a.referrer_emp_id       AS "Referrer",
        a.consultant_code       AS "Consultant",
        a.referral_flag         AS "Is Referral",
        a.resume_flag           AS "Resume Uploaded",
        a.resume_file_name      AS "Resume File",
        a.recruiter_email       AS "App Recruiter",
        a.talent_pool_only      AS "Pool Only",
        a.talent_pool_expires_at AS "Pool Expires",
        a.banned_flag           AS "Banned",
        a.ban_scope             AS "Ban Scope",
        a.banned_reason         AS "Ban Reason",
        a.created_at            AS "Application Created At",
        a.updated_at            AS "Application Updated At",

        -- Interview
        a.no_of_rounds          AS "Planned Rounds",
        a.suggested_interview_datetime1 AS "Interview Slot 1",
        a.suggested_interview_datetime2 AS "Interview Slot 2",
        a.interviewer_technical_score AS "Tech Score",
        a.interviewer_behavioral_score AS "Behavioral Score",
        a.interviewer_company_fit_score AS "Fit Score",
        a.interviewer_final_decision AS "Final Decision",
        a.interviewer_feedback_remarks AS "Feedback Remarks",

        -- Offer / join
        a.joining_date          AS "Joining Date",
        a.rejected_by_email     AS "Rejected By",
        a.rejection_reason      AS "Rejection Reason",
        a.dropout_reason        AS "Dropout Reason",

        -- Clearance
        cc.status               AS "Clearance Status",
        cc.primary_cleared_by   AS "Primary Cleared By",
        cc.primary_cleared_at   AS "Primary Cleared At",
        cc.secondary_cleared_by AS "Secondary Cleared By",
        cc.secondary_cleared_at AS "Secondary Cleared At",
        cc.hr_action            AS "HR Action",
        cc.hr_action_by         AS "HR Action By",
        cc.hr_action_at         AS "HR Action At",
        cc.hr_comments          AS "HR Comments",
        cc.cxo_email            AS "CXO Approver",
        cc.cxo_action           AS "CXO Decision",
        cc.cxo_action_at        AS "CXO Decision At",
        cc.cxo_comments         AS "CXO Comments",
        cc.aop_inline           AS "AOP Inline",
        cc.aop_exceeded_amount  AS "AOP Exceeded Amount",
        cc.renegotiation_count  AS "Renegotiations",
        cc.ctc_data             AS "CTC Data (JSON)",

        -- Talent-pool provenance (latest movement, if any)
        tpm.from_job_id         AS "TP From Job",
        tpm.from_status         AS "TP From Status",
        tpm.moved_by_email      AS "TP Moved By",
        tpm.moved_at            AS "TP Moved At",
        tpm.reason              AS "TP Reason",

        -- Blacklist
        bl.reason               AS "Blacklist Reason",
        bl.blacklisted_by_email AS "Blacklisted By",
        bl.blacklisted_at       AS "Blacklisted At",

        -- Offer letter (latest)
        ol.file_name            AS "Offer Letter File",
        ol.uploaded_at          AS "Offer Released At",
        ol.expires_at           AS "Offer Valid Until",
        ol.candidate_signed_at  AS "Offer Signed At",
        ol.candidate_decision   AS "Offer Decision",

        -- Joining provenance (latest non-set event)
        je.event_type           AS "Last Joining Event",
        je.committed_by_email   AS "Joining Action By",
        je.committed_at         AS "Joining Action At",

        -- Timing (legacy headline)
        ROUND(EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400)                   AS "Days Since Req",
        ROUND(EXTRACT(EPOCH FROM (a.created_at - r.created_at)) / 86400)            AS "Req → Applied (days)",
        ROUND(EXTRACT(EPOCH FROM (a.joining_date::timestamp - a.created_at)) / 86400) AS "Applied → Joined (days)"
      FROM applications a
      JOIN jobs j ON j.job_id = a.ats_job_id
      LEFT JOIN requisitions r ON j.requisition_id = r.id
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN grades g ON j.grade_id = g.id
      LEFT JOIN levels lv ON j.level_id = lv.id
      LEFT JOIN candidate_clearance cc ON cc.application_id = a.id
      LEFT JOIN LATERAL (
        SELECT * FROM talent_pool_movements t
         WHERE t.application_id = a.id
         ORDER BY moved_at DESC LIMIT 1
      ) tpm ON true
      LEFT JOIN LATERAL (
        SELECT * FROM blacklisted_phones b
         WHERE b.phone = REGEXP_REPLACE(COALESCE(a.candidate_phone, ''), '\\D', '', 'g')
           AND lifted_at IS NULL
         LIMIT 1
      ) bl ON true
      LEFT JOIN LATERAL (
        SELECT * FROM offer_letters o
         WHERE o.application_id = a.id
         ORDER BY uploaded_at DESC LIMIT 1
      ) ol ON true
      LEFT JOIN LATERAL (
        SELECT * FROM joining_events e
         WHERE e.application_id = a.id
           AND e.event_type IN ('joined', 'postpone', 'dropout', 'prepone')
         ORDER BY committed_at DESC LIMIT 1
      ) je ON true
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT 5000
    `;

    const result = await pool.query(sql, params);
    res.json({ rows: result.rows, count: result.rowCount });
  } catch (err) {
    console.error('Raw export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /jobs-export?include_applicants=true|false
// One row per job (or per job × application). Includes hr_one_job_id and
// every taxonomy join. Used by the Jobs page → Export ↓ menu.
// ───────────────────────────────────────────────────────────────────────────
router.get('/jobs-export', adminOrRecruiter, async (req, res) => {
  try {
    const includeApplicants = String(req.query.include_applicants || 'false') === 'true';
    const { whereClause, params } = buildFilters(req.query);
    const jobWhere = buildJobLevelFilters(whereClause).replace('WHERE 1=1', `WHERE j.job_id <> 'TP-POOL'`);

    if (!includeApplicants) {
      const sql = `
        SELECT
          j.job_id              AS "Job ID",
          j.hr_one_job_id       AS "HR One Job ID",
          j.job_title           AS "Job Title",
          j.status              AS "Job Status",
          j.created_at          AS "Created At",
          j.created_by          AS "Created By",
          j.recruiter_email     AS "Recruiter",
          j.secondary_recruiter_email AS "Secondary Recruiter",
          j.total_positions     AS "Total Positions",
          j.compensation_currency AS "Currency",
          j.compensation_min    AS "Comp Min",
          j.compensation_max    AS "Comp Max",
          j.publish_to_careers  AS "Public",
          j.allow_employee_apply AS "Internal Apply",
          j.allow_employee_refer AS "Referral Open",
          bu.bu_name            AS "Business Unit",
          d.department_name     AS "Department",
          sd.sub_department_name AS "Sub Department",
          l.location_name       AS "Location",
          p.phase_name          AS "Phase",
          g.grade               AS "Grade",
          lv.level              AS "Level",
          r.requisition_id      AS "Requisition",
          r.created_by          AS "Requisition Raised By",
          r.approved_at         AS "Requisition Approved At",
          (SELECT COUNT(*) FROM applications a2 WHERE a2.ats_job_id = j.job_id AND a2.active_flag = true) AS "Applicants"
        FROM jobs j
        LEFT JOIN requisitions r ON j.requisition_id = r.id
        LEFT JOIN business_units bu ON j.business_unit_id = bu.id
        LEFT JOIN departments d ON j.department_id = d.id
        LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
        LEFT JOIN locations l ON j.location_id = l.id
        LEFT JOIN phases p ON j.phase_id = p.id
        LEFT JOIN grades g ON j.grade_id = g.id
        LEFT JOIN levels lv ON j.level_id = lv.id
        LEFT JOIN applications a ON FALSE  -- alias kept so jobWhere works
        ${jobWhere}
        ORDER BY j.created_at DESC
        LIMIT 5000`;
      const r = await pool.query(sql, params);
      return res.json({ rows: r.rows, count: r.rowCount });
    }

    // include_applicants → fall through to raw-export shape (one row per app).
    return res.redirect(307, `/api/mis/raw-export?${new URLSearchParams(req.query).toString()}`);
  } catch (err) {
    console.error('Jobs export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
