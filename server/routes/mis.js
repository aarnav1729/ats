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
        COALESCE(a.recruiter_email, 'Unassigned') as recruiter,
        COUNT(*) FILTER (WHERE a.status IN ('OfferInProcess','Offered','OfferAccepted','OfferRejected','OfferDropout','Joined')) as offers,
        COUNT(*) FILTER (WHERE a.status = 'Joined') as closures,
        COUNT(*) FILTER (WHERE a.status = 'OfferAccepted') as pending_joins,
        COUNT(*) FILTER (WHERE a.status IN ('OfferRejected', 'OfferDropout')) as backouts
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      GROUP BY TO_CHAR(COALESCE(a.joining_date::timestamp, a.updated_at, a.created_at), 'YYYY-MM'), COALESCE(a.recruiter_email, 'Unassigned')
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
        COALESCE(a.recruiter_email, 'Unassigned') as recruiter,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') IN ('LinkedIn', 'Naukri', 'Indeed', 'Company Website', 'Walk-in', 'Direct', 'Other')) as job_portal,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') = 'Employee Referral') as referral,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') ILIKE '%campus%') as campus,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') IN ('Consultant', 'Agency')) as agency,
        COUNT(*) FILTER (WHERE COALESCE(a.source, '') IN ('Internal', 'Employee Apply')) as internal,
        COUNT(*) as total
      FROM applications a
      LEFT JOIN jobs j ON a.ats_job_id = j.job_id
      ${whereClause}
      GROUP BY COALESCE(a.recruiter_email, 'Unassigned')
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

export default router;
