import { Router } from 'express';
import QRCode from 'qrcode';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const adminOrRecruiter = requireRole('hr_admin', 'hr_recruiter');

const SORT_COLUMNS = {
  created_at: 'j.created_at',
  updated_at: 'j.updated_at',
  job_id: 'j.job_id',
  job_title: 'j.job_title',
  status: 'j.status',
  total_positions: 'j.total_positions',
};

const DEFAULT_HIRING_FLOW = [
  'Sourced',
  'Screening',
  'Interview Round 1',
  'Interview Round 2',
  'Interview Round 3',
  'Preboarding',
  'Hired',
  'Archived',
];

function normalizeJobType(value) {
  if (['permanent', 'internship', 'contractual'].includes(value)) {
    return value;
  }
  return 'permanent';
}

function normalizeFlow(value, fallback) {
  if (Array.isArray(value) && value.length > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return fallback;
}

function normalizeInterviewerMap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

async function findByIdOrValue(client, { table, id, value, valueColumns }) {
  if (id) {
    const result = await client.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
    return result.rows[0] || null;
  }

  if (!value) return null;

  const whereClause = valueColumns.map((column) => `${column} = $1`).join(' OR ');
  const result = await client.query(
    `SELECT * FROM ${table} WHERE ${whereClause} LIMIT 1`,
    [value]
  );
  return result.rows[0] || null;
}

async function fetchRequisitionSource(client, requisitionId) {
  const result = await client.query(
    `SELECT
        r.*,
        bu.bu_name,
        bu.bu_short_name,
        d.department_name,
        sd.sub_department_name,
        g.grade,
        lv.level,
        rp.position_type,
        rp.number_of_positions,
        l.location_name,
        p.phase_name
      FROM requisitions r
      LEFT JOIN business_units bu ON r.business_unit_id = bu.id
      LEFT JOIN departments d ON r.department_id = d.id
      LEFT JOIN sub_departments sd ON r.sub_department_id = sd.id
      LEFT JOIN grades g ON r.grade_id = g.id
      LEFT JOIN levels lv ON r.level_id = lv.id
      LEFT JOIN LATERAL (
        SELECT * FROM requisition_positions
        WHERE requisition_id = r.id
        ORDER BY id
        LIMIT 1
      ) rp ON TRUE
      LEFT JOIN locations l ON rp.location_id = l.id
      LEFT JOIN phases p ON rp.phase_id = p.id
      WHERE r.id = $1 AND r.active_flag = true`,
    [requisitionId]
  );

  return result.rows[0] || null;
}

async function fetchJob(client, id) {
  const result = await client.query(
    `SELECT
        j.*,
        bu.bu_name,
        bu.bu_short_name,
        d.department_name,
        sd.sub_department_name,
        l.location_name,
        p.phase_name,
        g.grade,
        lv.level,
        req.requisition_id AS source_requisition_id,
        req.status AS requisition_status,
        COALESCE(app_stats.application_count, 0) AS application_count,
        COALESCE(app_stats.filled_positions, 0) AS filled_positions
      FROM jobs j
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN grades g ON j.grade_id = g.id
      LEFT JOIN levels lv ON j.level_id = lv.id
      LEFT JOIN requisitions req ON j.requisition_id = req.id
      LEFT JOIN (
        SELECT
          ats_job_id,
          COUNT(*) AS application_count,
          SUM(CASE WHEN status = 'Joined' THEN 1 ELSE 0 END) AS filled_positions
        FROM applications
        WHERE active_flag = true
        GROUP BY ats_job_id
      ) app_stats ON app_stats.ats_job_id = j.job_id
      WHERE j.id = $1 AND j.active_flag = true`,
    [id]
  );

  return result.rows[0] || null;
}

async function generateJobId(client) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await client.query('SELECT COUNT(*) FROM jobs WHERE job_id LIKE $1', [`ATS-${today}-%`]);
  const sequence = Number(count.rows[0]?.count || 0) + 1;
  return `ATS-${today}-${String(sequence).padStart(3, '0')}`;
}

async function resolveJobPayload(client, body, actor, options = {}) {
  const requisitionSource = body.requisition_id
    ? await fetchRequisitionSource(client, body.requisition_id)
    : null;

  if (body.requisition_id && !requisitionSource) {
    throw new Error('Selected requisition could not be found');
  }

  if (requisitionSource && requisitionSource.status !== 'approved') {
    throw new Error('Only HR Admin approved requisitions can be converted into jobs');
  }

  if (options.enforceRecruiterAssignment !== false && requisitionSource && actor?.role === 'hr_recruiter') {
    const assignedRecruiter = String(requisitionSource.assigned_recruiter_email || '').trim().toLowerCase();
    const actorEmail = String(actor?.email || '').trim().toLowerCase();
    if (!assignedRecruiter) {
      throw new Error('HR Admin must assign a recruiter before a recruiter can create a job from this requisition');
    }
    if (assignedRecruiter !== actorEmail) {
      throw new Error('This requisition is assigned to another recruiter');
    }
  }

  const businessUnit = await findByIdOrValue(client, {
    table: 'business_units',
    id: body.business_unit_id || requisitionSource?.business_unit_id,
    value: body.business_unit || requisitionSource?.bu_short_name || requisitionSource?.bu_name,
    valueColumns: ['bu_short_name', 'bu_name'],
  });
  if (!businessUnit) throw new Error('A valid business unit is required');

  const department = await findByIdOrValue(client, {
    table: 'departments',
    id: body.department_id || requisitionSource?.department_id,
    value: body.department || requisitionSource?.department_name,
    valueColumns: ['department_name'],
  });
  if (!department) throw new Error('A valid department is required');

  const subDepartment = await findByIdOrValue(client, {
    table: 'sub_departments',
    id: body.sub_department_id || requisitionSource?.sub_department_id,
    value: body.sub_department || requisitionSource?.sub_department_name,
    valueColumns: ['sub_department_name'],
  });

  const location = await findByIdOrValue(client, {
    table: 'locations',
    id: body.location_id || requisitionSource?.location_id,
    value: body.location || requisitionSource?.location_name,
    valueColumns: ['location_name'],
  });

  let phase = null;
  const phaseValue = body.phase || requisitionSource?.phase_name;
  const phaseId = body.phase_id || requisitionSource?.phase_id;
  if (phaseId) {
    phase = await findByIdOrValue(client, {
      table: 'phases',
      id: phaseId,
      value: null,
      valueColumns: ['phase_name'],
    });
  } else if (phaseValue) {
    const result = await client.query(
      `SELECT * FROM phases WHERE phase_name = $1 AND location_name = $2 LIMIT 1`,
      [phaseValue, location?.location_name || null]
    );
    phase = result.rows[0] || null;
  }

  if (!location) {
    throw new Error('A valid location is required');
  }

  if (!phase) {
    throw new Error('A valid phase is required');
  }

  const grade = await findByIdOrValue(client, {
    table: 'grades',
    id: body.grade_id,
    value: body.grade,
    valueColumns: ['grade'],
  });

  const level = await findByIdOrValue(client, {
    table: 'levels',
    id: body.level_id,
    value: body.level,
    valueColumns: ['level'],
  });

  const jobTitle = body.job_title || requisitionSource?.job_title;
  if (!jobTitle) throw new Error('Job title is required');

  const totalPositions = Math.max(
    1,
    Number(body.total_positions || body.number_of_positions || requisitionSource?.total_positions || requisitionSource?.number_of_positions || 1)
  );

  const hiringFlow = normalizeFlow(body.hiring_stages || body.hiring_flow, [
    ...DEFAULT_HIRING_FLOW,
  ]);

  return {
    requisition_id: body.requisition_id || null,
    status: body.status || 'open',
    job_title: jobTitle,
    department_id: department.id,
    sub_department_id: subDepartment?.id || null,
    business_unit_id: businessUnit.id,
    location_id: location?.id || null,
    phase_id: phase?.id || null,
    grade_id: grade?.id || null,
    level_id: level?.id || null,
    experience_years: body.experience_years !== '' && body.experience_years !== undefined
      ? Number(body.experience_years)
      : (requisitionSource?.experience_years ?? null),
    job_type: normalizeJobType(body.job_type || requisitionSource?.job_type),
    requisition_type: body.requisition_type || requisitionSource?.requisition_type || null,
    job_description: body.job_description || requisitionSource?.job_description || null,
    additional_comments: body.additional_comments || requisitionSource?.additional_comments || null,
    compensation_currency: body.currency || body.compensation_currency || 'INR',
    compensation_min: body.compensation_min !== '' && body.compensation_min !== undefined
      ? Number(body.compensation_min)
      : null,
    compensation_max: body.compensation_max !== '' && body.compensation_max !== undefined
      ? Number(body.compensation_max)
      : null,
    reapply_days: Math.max(0, Number(body.reapply_days ?? 90)),
    hiring_flow: hiringFlow,
    interviewer_emails: normalizeInterviewerMap(body.interviewer_emails),
    publish_to_careers: Boolean(body.publish_to_careers),
    allow_employee_apply: Boolean(body.allow_employee_apply),
    allow_employee_refer: Boolean(body.allow_employee_refer),
    number_of_positions: totalPositions,
    recruiter_email: body.recruiter_email || null,
    secondary_recruiter_email: body.secondary_recruiter_email || null,
    priority: Boolean(body.priority || requisitionSource?.priority),
    total_positions: totalPositions,
  };
}

function buildHrOneJobIds(jobId, totalPositions) {
  return Array.from({ length: totalPositions }, (_, index) =>
    `${jobId}-${String(index + 1).padStart(2, '0')}`
  );
}

function isClientErrorMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  return [
    'required',
    'valid',
    'not found',
    'could not be found',
    'must be',
    'approved requisitions',
  ].some((fragment) => normalized.includes(fragment));
}

// GET / - List all jobs
router.get('/', adminOrRecruiter, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      department_id,
      business_unit_id,
      recruiter_email,
      job_type,
      date_from,
      date_to,
      search,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const params = [];
    let idx = 0;

    let baseQuery = `
      FROM jobs j
      LEFT JOIN business_units bu ON j.business_unit_id = bu.id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
      LEFT JOIN locations l ON j.location_id = l.id
      LEFT JOIN phases p ON j.phase_id = p.id
      LEFT JOIN grades g ON j.grade_id = g.id
      LEFT JOIN levels lv ON j.level_id = lv.id
      LEFT JOIN (
        SELECT
          ats_job_id,
          COUNT(*) AS application_count,
          SUM(CASE WHEN status = 'Joined' THEN 1 ELSE 0 END) AS filled_positions
        FROM applications
        WHERE active_flag = true
        GROUP BY ats_job_id
      ) app_stats ON app_stats.ats_job_id = j.job_id
      WHERE j.active_flag = true
    `;

    if (status) {
      idx += 1;
      baseQuery += ` AND j.status = $${idx}`;
      params.push(status);
    }
    if (department_id) {
      idx += 1;
      baseQuery += ` AND j.department_id = $${idx}`;
      params.push(department_id);
    }
    if (business_unit_id) {
      idx += 1;
      baseQuery += ` AND j.business_unit_id = $${idx}`;
      params.push(business_unit_id);
    }
    if (recruiter_email) {
      idx += 1;
      baseQuery += ` AND j.recruiter_email = $${idx}`;
      params.push(recruiter_email);
    }
    if (job_type) {
      idx += 1;
      baseQuery += ` AND j.job_type = $${idx}`;
      params.push(job_type);
    }
    if (date_from) {
      idx += 1;
      baseQuery += ` AND j.created_at >= $${idx}`;
      params.push(date_from);
    }
    if (date_to) {
      idx += 1;
      baseQuery += ` AND j.created_at <= $${idx}`;
      params.push(date_to);
    }
    if (search) {
      idx += 1;
      baseQuery += ` AND (j.job_id ILIKE $${idx} OR j.job_title ILIKE $${idx})`;
      params.push(`%${search}%`);
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const total = Number(countResult.rows[0]?.count || 0);

    const safeSortBy = SORT_COLUMNS[sort_by] || SORT_COLUMNS.created_at;
    const safeSortOrder = String(sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    idx += 1;
    params.push(Number(limit));
    const limitParam = idx;

    idx += 1;
    params.push(offset);
    const offsetParam = idx;

    const result = await pool.query(
      `SELECT
          j.*,
          bu.bu_name,
          bu.bu_short_name,
          d.department_name,
          sd.sub_department_name,
          l.location_name,
          p.phase_name,
          g.grade,
          lv.level,
          COALESCE(app_stats.application_count, 0) AS application_count,
          COALESCE(app_stats.filled_positions, 0) AS filled_positions
        ${baseQuery}
        ORDER BY ${safeSortBy} ${safeSortOrder}
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    res.json({
      jobs: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('List jobs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /export - Export all jobs as JSON
router.get('/export', adminOrRecruiter, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
          j.*,
          bu.bu_name,
          bu.bu_short_name,
          d.department_name,
          sd.sub_department_name,
          l.location_name,
          p.phase_name,
          g.grade,
          lv.level
        FROM jobs j
        LEFT JOIN business_units bu ON j.business_unit_id = bu.id
        LEFT JOIN departments d ON j.department_id = d.id
        LEFT JOIN sub_departments sd ON j.sub_department_id = sd.id
        LEFT JOIN locations l ON j.location_id = l.id
        LEFT JOIN phases p ON j.phase_id = p.id
        LEFT JOIN grades g ON j.grade_id = g.id
        LEFT JOIN levels lv ON j.level_id = lv.id
        WHERE j.active_flag = true
        ORDER BY j.created_at DESC`
    );

    res.json({ jobs: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Export jobs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id - Get single job with application counts per status stage
router.get('/:id', adminOrRecruiter, async (req, res) => {
  try {
    const job = await fetchJob(pool, req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const stageCounts = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM applications
       WHERE ats_job_id = $1 AND active_flag = true
       GROUP BY status`,
      [job.job_id]
    );

    const stageCountMap = {};
    for (const row of stageCounts.rows) {
      stageCountMap[row.status] = Number(row.count);
    }

    res.json({ ...job, stage_counts: stageCountMap });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / - Create job
router.post('/', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();

  try {
    const payload = await resolveJobPayload(client, req.body, req.user);

    await client.query('BEGIN');

    const jobId = await generateJobId(client);
    const hrOneJobIds = buildHrOneJobIds(jobId, payload.total_positions);

    const result = await client.query(
      `INSERT INTO jobs (
          job_id,
          requisition_id,
          status,
          job_title,
          department_id,
          sub_department_id,
          business_unit_id,
          location_id,
          phase_id,
          grade_id,
          level_id,
          experience_years,
          job_type,
          requisition_type,
          job_description,
          additional_comments,
          compensation_currency,
          compensation_min,
          compensation_max,
          reapply_days,
          hiring_flow,
          interviewer_emails,
          publish_to_careers,
          allow_employee_apply,
          allow_employee_refer,
          number_of_positions,
          hr_one_job_ids,
          recruiter_email,
          secondary_recruiter_email,
          priority,
          total_positions,
          created_by,
          updated_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
        )
        RETURNING *`,
      [
        jobId,
        payload.requisition_id,
        payload.status,
        payload.job_title,
        payload.department_id,
        payload.sub_department_id,
        payload.business_unit_id,
        payload.location_id,
        payload.phase_id,
        payload.grade_id,
        payload.level_id,
        payload.experience_years,
        payload.job_type,
        payload.requisition_type,
        payload.job_description,
        payload.additional_comments,
        payload.compensation_currency,
        payload.compensation_min,
        payload.compensation_max,
        payload.reapply_days,
        JSON.stringify(payload.hiring_flow),
        JSON.stringify(payload.interviewer_emails),
        payload.publish_to_careers,
        payload.allow_employee_apply,
        payload.allow_employee_refer,
        payload.number_of_positions,
        JSON.stringify(hrOneJobIds),
        payload.recruiter_email,
        payload.secondary_recruiter_email,
        payload.priority,
        payload.total_positions,
        req.user.email,
        req.user.email,
      ]
    );

    // Persist HR One single-id reference (Phase 0 column).
    if (req.body.hr_one_job_id !== undefined) {
      await client.query(
        `UPDATE jobs SET hr_one_job_id = $1 WHERE id = $2`,
        [String(req.body.hr_one_job_id || '').trim() || null, result.rows[0].id]
      );
    }

    await client.query('COMMIT');

    await logAudit({
      actionBy: req.user.email,
      actionType: 'create',
      entityType: 'job',
      entityId: result.rows[0].id,
      afterState: result.rows[0],
    });

    const fullJob = await fetchJob(pool, result.rows[0].id);
    res.status(201).json(fullJob);
  } catch (err) {
    await client.query('ROLLBACK');
    const message = err.message || 'Internal server error';
    console.error('Create job error:', err);
    res.status(isClientErrorMessage(message) ? 400 : 500).json({ error: message });
  } finally {
    client.release();
  }
});

// PUT /:id - Update job
router.put('/:id', adminOrRecruiter, async (req, res) => {
  const client = await pool.connect();

  try {
    const existing = await fetchJob(client, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const payload = await resolveJobPayload(client, {
      ...existing,
      ...req.body,
      business_unit: req.body.business_unit ?? existing.bu_short_name,
      department: req.body.department ?? existing.department_name,
      sub_department: req.body.sub_department ?? existing.sub_department_name,
      location: req.body.location ?? existing.location_name,
      phase: req.body.phase ?? existing.phase_name,
      grade: req.body.grade ?? existing.grade,
      level: req.body.level ?? existing.level,
      currency: req.body.currency ?? existing.compensation_currency,
      compensation_min: req.body.compensation_min ?? existing.compensation_min,
      compensation_max: req.body.compensation_max ?? existing.compensation_max,
      experience_years: req.body.experience_years ?? existing.experience_years,
      number_of_positions: req.body.number_of_positions ?? existing.total_positions,
      hiring_stages: req.body.hiring_stages ?? existing.hiring_flow,
      interviewer_emails: req.body.interviewer_emails ?? existing.interviewer_emails,
      publish_to_careers: req.body.publish_to_careers ?? existing.publish_to_careers,
      allow_employee_apply: req.body.allow_employee_apply ?? existing.allow_employee_apply,
      allow_employee_refer: req.body.allow_employee_refer ?? existing.allow_employee_refer,
      recruiter_email: req.body.recruiter_email ?? existing.recruiter_email,
      secondary_recruiter_email: req.body.secondary_recruiter_email ?? existing.secondary_recruiter_email,
      priority: req.body.priority ?? existing.priority,
      requisition_id: req.body.requisition_id ?? existing.requisition_id,
      status: req.body.status ?? existing.status,
    }, req.user, { enforceRecruiterAssignment: false });

    await client.query('BEGIN');

    const hrOneJobIds = buildHrOneJobIds(existing.job_id, payload.total_positions);

    await client.query(
      `UPDATE jobs SET
          requisition_id = $1,
          status = $2,
          job_title = $3,
          department_id = $4,
          sub_department_id = $5,
          business_unit_id = $6,
          location_id = $7,
          phase_id = $8,
          grade_id = $9,
          level_id = $10,
          experience_years = $11,
          job_type = $12,
          requisition_type = $13,
          job_description = $14,
          additional_comments = $15,
          compensation_currency = $16,
          compensation_min = $17,
          compensation_max = $18,
          reapply_days = $19,
          hiring_flow = $20,
          interviewer_emails = $21,
          publish_to_careers = $22,
          allow_employee_apply = $23,
          allow_employee_refer = $24,
          number_of_positions = $25,
          hr_one_job_ids = $26,
          recruiter_email = $27,
          secondary_recruiter_email = $28,
          priority = $29,
          total_positions = $30,
          updated_by = $31,
          updated_at = NOW()
        WHERE id = $32`,
      [
        payload.requisition_id,
        payload.status,
        payload.job_title,
        payload.department_id,
        payload.sub_department_id,
        payload.business_unit_id,
        payload.location_id,
        payload.phase_id,
        payload.grade_id,
        payload.level_id,
        payload.experience_years,
        payload.job_type,
        payload.requisition_type,
        payload.job_description,
        payload.additional_comments,
        payload.compensation_currency,
        payload.compensation_min,
        payload.compensation_max,
        payload.reapply_days,
        JSON.stringify(payload.hiring_flow),
        JSON.stringify(payload.interviewer_emails),
        payload.publish_to_careers,
        payload.allow_employee_apply,
        payload.allow_employee_refer,
        payload.number_of_positions,
        JSON.stringify(hrOneJobIds),
        payload.recruiter_email,
        payload.secondary_recruiter_email,
        payload.priority,
        payload.total_positions,
        req.user.email,
        req.params.id,
      ]
    );

    // Persist HR One single-id reference (Phase 0 column).
    if (req.body.hr_one_job_id !== undefined) {
      await client.query(
        `UPDATE jobs SET hr_one_job_id = $1 WHERE id = $2`,
        [String(req.body.hr_one_job_id || '').trim() || null, req.params.id]
      );
    }

    await client.query('COMMIT');

    const updated = await fetchJob(pool, req.params.id);

    // ── Side-effect: hold notification ──────────────────────────────────
    // When the status transitions into on_hold, fan out the branded "Job on
    // hold" email to primary + secondary recruiter + all hr_admin users with
    // the recruiter-supplied reason. Done after COMMIT so we never block the
    // status update on email delivery.
    if (req.body.status === 'on_hold' && existing.status !== 'on_hold') {
      try {
        const { jobOnHoldEmail } = await import('../services/txEmails.js');
        const { sendEmail } = await import('../services/email.js');
        const { logTimeline } = await import('../services/timeline.js');
        const reason = String(req.body.hold_reason || '').trim() || 'No reason provided';

        const adminsQ = await pool.query(`SELECT email FROM users WHERE role = 'hr_admin' AND is_active = true`);
        const recipients = Array.from(new Set([
          updated.recruiter_email,
          updated.secondary_recruiter_email,
          updated.created_by,
          ...adminsQ.rows.map((row) => row.email),
        ].filter(Boolean)));

        if (recipients.length) {
          const html = jobOnHoldEmail({
            jobTitle: updated.job_title,
            jobId: updated.job_id,
            reason,
            placedBy: req.user.email,
          });
          sendEmail(recipients, `Job on hold  ${updated.job_title}`, html).catch(() => {});
        }
        await logTimeline({
          entityType: 'job',
          entityId: updated.job_id,
          eventType: 'job.held',
          actorEmail: req.user.email,
          actorRole: req.user.role,
          summary: `Job placed on hold  ${reason}`,
          payload: { reason, recipients },
          fromState: existing.status,
          toState: 'on_hold',
        });
      } catch (notifyErr) {
        console.error('Hold notification error:', notifyErr.message);
      }
    }
    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'job',
      entityId: req.params.id,
      beforeState: existing,
      afterState: updated,
    });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    const message = err.message || 'Internal server error';
    console.error('Update job error:', err);
    res.status(isClientErrorMessage(message) ? 400 : 500).json({ error: message });
  } finally {
    client.release();
  }
});

// DELETE /:id - Soft delete (archive)
router.delete('/:id', adminOrRecruiter, async (req, res) => {
  try {
    const existing = await fetchJob(pool, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await pool.query(
      "UPDATE jobs SET active_flag = false, status = 'archived', updated_by = $1, updated_at = NOW() WHERE id = $2",
      [req.user.email, req.params.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'delete',
      entityType: 'job',
      entityId: req.params.id,
      beforeState: existing,
    });

    res.json({ message: 'Job archived successfully' });
  } catch (err) {
    console.error('Delete job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/publish - Toggle publish_to_careers
router.post('/:id/publish', adminOrRecruiter, async (req, res) => {
  try {
    const existing = await fetchJob(pool, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const newValue = !existing.publish_to_careers;
    const result = await pool.query(
      'UPDATE jobs SET publish_to_careers = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [newValue, req.user.email, req.params.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'job',
      entityId: req.params.id,
      fieldEdited: 'publish_to_careers',
      beforeState: existing.publish_to_careers,
      afterState: newValue,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Toggle publish error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/applicants - Get all applicants for a job
router.get('/:id/applicants', adminOrRecruiter, async (req, res) => {
  try {
    const job = await pool.query('SELECT job_id FROM jobs WHERE id = $1 AND active_flag = true', [req.params.id]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const { page = 1, limit = 20, sort_by = 'created_at', sort_order = 'desc', status, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const params = [job.rows[0].job_id];
    let idx = 1;

    let baseQuery = 'FROM applications a WHERE a.ats_job_id = $1 AND a.active_flag = true';
    if (status) {
      idx += 1;
      baseQuery += ` AND a.status = $${idx}`;
      params.push(status);
    }
    if (search) {
      idx += 1;
      baseQuery += ` AND (a.candidate_name ILIKE $${idx} OR a.candidate_email ILIKE $${idx} OR a.application_id ILIKE $${idx})`;
      params.push(`%${search}%`);
    }

    const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
    const total = Number(countResult.rows[0]?.count || 0);

    const sortColumn = ['created_at', 'candidate_name', 'status', 'updated_at'].includes(sort_by)
      ? `a.${sort_by}`
      : 'a.created_at';
    const sortDirection = String(sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    idx += 1;
    params.push(Number(limit));
    const limitParam = idx;

    idx += 1;
    params.push(offset);
    const offsetParam = idx;

    const result = await pool.query(
      `SELECT a.*
       ${baseQuery}
       ORDER BY ${sortColumn} ${sortDirection}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    res.json({
      applicants: result.rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('Get applicants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/stage-counts - Get count of applicants in each hiring flow stage
router.get('/:id/stage-counts', adminOrRecruiter, async (req, res) => {
  try {
    const job = await pool.query('SELECT job_id FROM jobs WHERE id = $1 AND active_flag = true', [req.params.id]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const result = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM applications
       WHERE ats_job_id = $1 AND active_flag = true
       GROUP BY status
       ORDER BY status`,
      [job.rows[0].job_id]
    );

    const stageCounts = {};
    for (const row of result.rows) {
      stageCounts[row.status] = Number(row.count);
    }

    res.json({ job_id: job.rows[0].job_id, stage_counts: stageCounts });
  } catch (err) {
    console.error('Stage counts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/qr-code - Generate QR code for the job
router.post('/:id/qr-code', adminOrRecruiter, async (req, res) => {
  try {
    const job = await pool.query('SELECT id, job_id FROM jobs WHERE id = $1', [req.params.id]);
    if (job.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const requestedBaseUrl = String(req.body.base_url || req.headers.origin || '').replace(/\/$/, '');
    const fallbackBaseUrl = `${req.protocol || 'https'}://${req.get('host')}`.replace(/\/$/, '');
    const baseUrl = requestedBaseUrl || fallbackBaseUrl;
    const url = req.body.url || `${baseUrl}/careers/${job.rows[0].id}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    res.json({ qr_code: qrDataUrl, url });
  } catch (err) {
    console.error('QR code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
