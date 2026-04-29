import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';
import { generateJobDescription } from '../services/ai.js';
import {
  buildApprovalRoute,
  createHrAdminApprovalSteps,
  ensureApproverUserAccounts,
  getActiveHrAdmins,
  isEmailInApproversList,
  listApprovalSteps,
  matchCxoApprovers,
  replaceApprovalSteps,
  requisitionNeedsCxoApproval,
  resolveSubmissionStatus,
  skipOtherApprovalSteps,
} from '../services/requisitionApproval.js';

const router = Router();

/**
 * Extended access: hr_admin, hr_recruiter, hod PLUS any email listed in approvers_master
 * (e.g. CXO-level users who need to create requisitions for their own teams)
 */
async function allowedToAccessRequisitions(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const { role, email } = req.user;
  if (['hr_admin', 'hr_recruiter', 'hod'].includes(role)) return next();
  try {
    const inList = await isEmailInApproversList(pool, email);
    if (inList) return next();
    return res.status(403).json({ error: 'Access denied' });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const allowedRoles = allowedToAccessRequisitions;
const hrAdminOnly = requireRole('hr_admin');

const SORT_COLUMNS = {
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
  requisition_id: 'r.requisition_id',
  job_title: 'r.job_title',
  status: 'r.status',
  total_positions: 'r.total_positions',
};

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function normalizeRequisitionType(value) {
  if (Array.isArray(value)) {
    const unique = Array.from(new Set(value.filter(Boolean)));
    if (unique.length > 1) return 'both';
    return unique[0] || '';
  }
  if (value === 'both' || value === 'new_hire' || value === 'backfill') return value;
  return '';
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.name === 'string') return item.name;
      return null;
    })
    .filter(Boolean);
}

function summarizePositions(positions) {
  return {
    start_hire_date: null,
    target_hire_date: null,
  };
}

function buildApprovalSelect() {
  return `
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          json_agg(
            json_build_object(
              'id', ra.id,
              'approval_stage', ra.approval_stage,
              'approver_email', ra.approver_email,
              'approver_name', ra.approver_name,
              'approver_employee_id', ra.approver_employee_id,
              'approver_role', ra.approver_role,
              'sequence_no', ra.sequence_no,
              'status', ra.status,
              'comments', ra.comments,
              'acted_by_email', ra.acted_by_email,
              'acted_at', ra.acted_at,
              'created_at', ra.created_at,
              'updated_at', ra.updated_at
            )
            ORDER BY ra.sequence_no, ra.created_at, ra.approver_name
          ),
          '[]'::json
        ) AS approval_steps,
        COALESCE(
          json_agg(ra.approver_email ORDER BY ra.approver_email)
            FILTER (WHERE ra.status = 'pending'),
          '[]'::json
        ) AS pending_approver_emails,
        COUNT(*) FILTER (WHERE ra.status = 'pending') AS pending_approval_count
      FROM requisition_approvals ra
      WHERE ra.requisition_id = r.id
    ) approval_meta ON TRUE
  `;
}

function normalizeApprovalSteps(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    return typeof value === 'string' ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function normalizeEmailList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    return typeof value === 'string' ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function getPendingApprovalForUser(steps, stage, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return steps.find((step) => (
    step.approval_stage === stage
    && step.status === 'pending'
    && String(step.approver_email || '').trim().toLowerCase() === normalizedEmail
  ));
}

function mergeApprovalComment(existingComment, actorEmail, newComment) {
  if (!newComment) return existingComment || null;
  const stamped = `${actorEmail}: ${newComment}`;
  return existingComment ? `${existingComment}\n${stamped}` : stamped;
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

async function resolvePosition(client, position) {
  const location = await findByIdOrValue(client, {
    table: 'locations',
    id: position.location_id,
    value: position.location,
    valueColumns: ['location_name'],
  });

  if (!location) {
    throw new Error('Each position row requires a valid location');
  }

  let phase = null;
  if (position.phase_id || position.phase) {
    if (position.phase_id) {
      phase = await findByIdOrValue(client, {
        table: 'phases',
        id: position.phase_id,
        value: null,
        valueColumns: ['phase_name'],
      });
    } else {
      const result = await client.query(
        `SELECT * FROM phases WHERE phase_name = $1 AND location_name = $2 LIMIT 1`,
        [position.phase, location.location_name]
      );
      phase = result.rows[0] || null;
    }
  }

  let backfillReason = null;
  if (position.backfill_reason_id || position.backfill_reason) {
    backfillReason = await findByIdOrValue(client, {
      table: 'backfill_reasons',
      id: position.backfill_reason_id,
      value: position.backfill_reason,
      valueColumns: ['reason'],
    });
  }

  const normalized = {
    position_type: position.position_type || position.type,
    location_id: location.id,
    phase_id: phase?.id || null,
    start_hire_date: null,
    target_hire_date: null,
    number_of_positions: Math.max(1, Number(position.number_of_positions) || 1),
    backfill_employee_id: position.backfill_employee_id || position.employee_id || null,
    backfill_employee_name: position.backfill_employee_name || position.employee_name || null,
    backfill_employee_email: position.backfill_employee_email || position.employee_email || null,
    backfill_reason_id: backfillReason?.id || null,
  };

  if (!['new_hire', 'backfill'].includes(normalized.position_type)) {
    throw new Error('Each position row requires a valid requisition type');
  }

  if (!normalized.phase_id) {
    throw new Error('Each position row requires a valid phase');
  }

  if (normalized.position_type === 'backfill' && !normalized.backfill_employee_name) {
    throw new Error('Replacement rows require an employee name');
  }

  if (normalized.position_type === 'backfill' && !normalized.backfill_reason_id) {
    throw new Error('Replacement rows require a valid replacement reason');
  }

  return normalized;
}

async function fetchRequisition(client, id, includeInactive = false) {
  const result = await client.query(
    `SELECT
        r.*,
        bu.bu_name,
        bu.bu_short_name,
        d.department_name,
        sd.sub_department_name,
        g.grade,
        lv.level,
        u.name AS created_by_name,
        uu.name AS updated_by_name,
        au.name AS approved_by_name,
        ar.name AS assigned_recruiter_name,
        ara.name AS assigned_recruiter_assigned_by_name,
        approval_meta.approval_steps,
        approval_meta.pending_approver_emails,
        approval_meta.pending_approval_count
      FROM requisitions r
      LEFT JOIN business_units bu ON r.business_unit_id = bu.id
      LEFT JOIN departments d ON r.department_id = d.id
      LEFT JOIN sub_departments sd ON r.sub_department_id = sd.id
      LEFT JOIN grades g ON r.grade_id = g.id
      LEFT JOIN levels lv ON r.level_id = lv.id
      LEFT JOIN users u ON r.created_by = u.email
      LEFT JOIN users uu ON r.updated_by = uu.email
      LEFT JOIN users au ON r.approved_by = au.email
      LEFT JOIN users ar ON r.assigned_recruiter_email = ar.email
      LEFT JOIN users ara ON r.assigned_recruiter_assigned_by = ara.email
      ${buildApprovalSelect()}
      WHERE r.id = $1${includeInactive ? '' : ' AND r.active_flag = true'}`,
    [id]
  );
  if (!result.rows[0]) return null;

  return {
    ...result.rows[0],
    approval_steps: normalizeApprovalSteps(result.rows[0].approval_steps),
    pending_approver_emails: normalizeEmailList(result.rows[0].pending_approver_emails),
  };
}

async function fetchRequisitionPositions(client, requisitionId) {
  const result = await client.query(
    `SELECT
        rp.*,
        l.location_name,
        p.phase_name,
        br.reason AS backfill_reason_name
      FROM requisition_positions rp
      LEFT JOIN locations l ON rp.location_id = l.id
      LEFT JOIN phases p ON rp.phase_id = p.id
      LEFT JOIN backfill_reasons br ON rp.backfill_reason_id = br.id
      WHERE rp.requisition_id = $1
      ORDER BY rp.id`,
    [requisitionId]
  );
  return result.rows;
}

async function generateRequisitionId(client, businessUnitId) {
  const bu = await client.query('SELECT bu_short_name FROM business_units WHERE id = $1', [businessUnitId]);
  const shortName = bu.rows[0]?.bu_short_name || 'GEN';
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await client.query(
    "SELECT COUNT(*) FROM requisitions WHERE requisition_id LIKE $1",
    [`${shortName}-${today}-%`]
  );
  const sequence = Number(count.rows[0]?.count || 0) + 1;
  return `${shortName}-${today}-${String(sequence).padStart(3, '0')}`;
}

async function resolveBusinessUnit(client, body) {
  return findByIdOrValue(client, {
    table: 'business_units',
    id: body.business_unit_id,
    value: body.business_unit,
    valueColumns: ['bu_name', 'bu_short_name'],
  });
}

async function checkAOP(client, businessUnitId, departmentId, newPositions, excludeRequisitionId = null) {
  const aop = await client.query(
    `SELECT max_headcount
     FROM aop
     WHERE business_unit_id = $1
       AND department_id = $2
       AND active_flag = true
     ORDER BY fiscal_year DESC
     LIMIT 1`,
    [businessUnitId, departmentId]
  );

  if (aop.rows.length === 0) {
    return { warning: false };
  }

  const currentCount = await client.query(
    `SELECT COUNT(*) AS count
     FROM applications a
     JOIN jobs j ON a.ats_job_id = j.job_id
     WHERE j.business_unit_id = $1
       AND j.department_id = $2
       AND a.status = 'Joined'
       AND a.active_flag = true
       AND j.active_flag = true`,
    [businessUnitId, departmentId]
  );

  const params = [businessUnitId, departmentId];
  let exclusionClause = '';
  if (excludeRequisitionId) {
    params.push(excludeRequisitionId);
    exclusionClause = ` AND id <> $${params.length}`;
  }

  const pendingPositions = await client.query(
    `SELECT COALESCE(SUM(total_positions), 0) AS total
     FROM requisitions
     WHERE business_unit_id = $1
       AND department_id = $2
       AND status IN ('draft', 'pending_approval', 'approved')
       AND active_flag = true${exclusionClause}`,
    params
  );

  const current = Number(currentCount.rows[0]?.count || 0);
  const pending = Number(pendingPositions.rows[0]?.total || 0);
  const max = Number(aop.rows[0]?.max_headcount || 0);
  const projected = current + pending + Number(newPositions || 0);

  return {
    warning: projected > max,
    current,
    pending,
    max,
    projected,
  };
}

async function resolveRequisitionPayload(client, body) {
  const businessUnit = await resolveBusinessUnit(client, body);
  if (!businessUnit) throw new Error('A valid business unit is required');

  const department = await findByIdOrValue(client, {
    table: 'departments',
    id: body.department_id,
    value: body.department,
    valueColumns: ['department_name'],
  });
  if (!department) throw new Error('A valid department is required');

  const subDepartment = await findByIdOrValue(client, {
    table: 'sub_departments',
    id: body.sub_department_id,
    value: body.sub_department,
    valueColumns: ['sub_department_name'],
  });

  const requisitionType = normalizeRequisitionType(body.requisition_type);
  if (!requisitionType) throw new Error('Select at least one requisition type');

  const positionsInput = Array.isArray(body.positions) ? body.positions : [];
  if (positionsInput.length === 0) throw new Error('At least one position row is required');

  const positions = [];
  for (const position of positionsInput) {
    positions.push(await resolvePosition(client, position));
  }

  let experienceYears = null;
  if (body.experience_years !== '' && body.experience_years !== undefined && body.experience_years !== null) {
    const parsedExperience = Number(body.experience_years);
    if (!Number.isInteger(parsedExperience) || parsedExperience < 0) {
      throw new Error('Experience years must be a whole number');
    }
    experienceYears = parsedExperience;
  }

  return {
    job_title: body.job_title,
    priority: Boolean(body.priority),
    department_id: department.id,
    department_name: department.department_name,
    sub_department_id: subDepartment?.id || null,
    sub_department_name: subDepartment?.sub_department_name || null,
    experience_years: experienceYears,
    grade_id: null,
    level_id: null,
    requisition_type: requisitionType,
    job_type: body.job_type || 'permanent',
    business_unit_id: businessUnit.id,
    business_unit_name: businessUnit.bu_name,
    business_unit_short_name: businessUnit.bu_short_name,
    job_description: body.job_description || null,
    additional_comments: body.additional_comments || null,
    attachments: normalizeAttachments(body.attachments),
    active_flag: parseBoolean(body.active_flag, true),
    positions,
  };
}

// GET /preview-id - Preview the next requisition id for a BU
router.get('/preview-id', allowedRoles, async (req, res) => {
  try {
    const businessUnit = await resolveBusinessUnit(pool, req.query);
    if (!businessUnit) {
      return res.status(400).json({ error: 'A valid business unit is required for requisition id preview' });
    }

    const requisitionId = await generateRequisitionId(pool, businessUnit.id);
    res.json({
      requisition_id: requisitionId,
      bu_name: businessUnit.bu_name,
      bu_short_name: businessUnit.bu_short_name,
    });
  } catch (err) {
    console.error('Preview requisition id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/approval-preview', allowedRoles, async (req, res) => {
  try {
    const requiresCxo = String(req.query.requires_cxo) === 'true' || requisitionNeedsCxoApproval({
      requisition_type: req.query.requisition_type || '',
    });
    const requisitionerEmail = req.query.requisitioner_email || req.user.email;
    const hrAdmins = await getActiveHrAdmins(pool);
    const cxoApprovers = requiresCxo
      ? await matchCxoApprovers(pool, { requisitionerEmail })
      : [];

    res.json({
      requires_cxo: requiresCxo,
      requisitioner_email: requisitionerEmail,
      cxo_approvers: cxoApprovers,
      hr_admin_approvers: hrAdmins,
      route: buildApprovalRoute({
        requiresCxo,
        cxoApprovers,
        hrAdmins,
      }),
    });
  } catch (err) {
    console.error('Requisition approval preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET / - List all requisitions
router.get('/', allowedRoles, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      department_id,
      business_unit_id,
      requisition_type,
      created_by,
      date_from,
      date_to,
      search,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const params = [];
    let idx = 0;

    // HR users see all; non-HR (hod, approvers) see only their own
    const isHrUser = ['hr_admin', 'hr_recruiter'].includes(req.user.role);

    let baseQuery = `
      FROM requisitions r
      LEFT JOIN business_units bu ON r.business_unit_id = bu.id
      LEFT JOIN departments d ON r.department_id = d.id
      LEFT JOIN sub_departments sd ON r.sub_department_id = sd.id
      LEFT JOIN grades g ON r.grade_id = g.id
      LEFT JOIN levels lv ON r.level_id = lv.id
      LEFT JOIN users u ON r.created_by = u.email
      LEFT JOIN users au ON r.approved_by = au.email
      LEFT JOIN users ar ON r.assigned_recruiter_email = ar.email
      ${buildApprovalSelect()}
      WHERE r.active_flag = true
    `;

    if (!isHrUser) {
      idx += 1;
      baseQuery += ` AND r.created_by = $${idx}`;
      params.push(req.user.email);
    }

    if (status) {
      idx += 1;
      baseQuery += ` AND r.status = $${idx}`;
      params.push(status);
    }
    if (department_id) {
      idx += 1;
      baseQuery += ` AND r.department_id = $${idx}`;
      params.push(department_id);
    }
    if (business_unit_id) {
      idx += 1;
      baseQuery += ` AND r.business_unit_id = $${idx}`;
      params.push(business_unit_id);
    }
    if (requisition_type) {
      idx += 1;
      baseQuery += ` AND r.requisition_type = $${idx}`;
      params.push(requisition_type);
    }
    if (created_by) {
      idx += 1;
      baseQuery += ` AND r.created_by = $${idx}`;
      params.push(created_by);
    }
    if (date_from) {
      idx += 1;
      baseQuery += ` AND r.created_at >= $${idx}`;
      params.push(date_from);
    }
    if (date_to) {
      idx += 1;
      baseQuery += ` AND r.created_at <= $${idx}`;
      params.push(date_to);
    }
    if (search) {
      idx += 1;
      baseQuery += ` AND (r.requisition_id ILIKE $${idx} OR r.job_title ILIKE $${idx})`;
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
          r.*,
          bu.bu_name,
          bu.bu_short_name,
          d.department_name,
          sd.sub_department_name,
          g.grade,
          lv.level,
          u.name AS created_by_name,
          au.name AS approved_by_name,
          ar.name AS assigned_recruiter_name,
          approval_meta.approval_steps,
          approval_meta.pending_approver_emails,
          approval_meta.pending_approval_count
        ${baseQuery}
        ORDER BY ${safeSortBy} ${safeSortOrder}
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const requisitions = result.rows.map((row) => ({
      ...row,
      approval_steps: normalizeApprovalSteps(row.approval_steps),
      pending_approver_emails: normalizeEmailList(row.pending_approver_emails),
    }));

    res.json({
      requisitions,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('List requisitions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /export - Export all requisitions as JSON
router.get('/export', allowedRoles, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
          r.*,
          bu.bu_name,
          bu.bu_short_name,
          d.department_name,
          sd.sub_department_name,
          g.grade,
          lv.level,
          u.name AS created_by_name,
          au.name AS approved_by_name,
          ar.name AS assigned_recruiter_name
        FROM requisitions r
        LEFT JOIN business_units bu ON r.business_unit_id = bu.id
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN sub_departments sd ON r.sub_department_id = sd.id
        LEFT JOIN grades g ON r.grade_id = g.id
        LEFT JOIN levels lv ON r.level_id = lv.id
        LEFT JOIN users u ON r.created_by = u.email
        LEFT JOIN users au ON r.approved_by = au.email
        LEFT JOIN users ar ON r.assigned_recruiter_email = ar.email
        ${buildApprovalSelect()}
        WHERE r.active_flag = true
        ORDER BY r.created_at DESC`
    );

    res.json({
      requisitions: result.rows.map((row) => ({
        ...row,
        approval_steps: normalizeApprovalSteps(row.approval_steps),
        pending_approver_emails: normalizeEmailList(row.pending_approver_emails),
      })),
      total: result.rows.length,
    });
  } catch (err) {
    console.error('Export requisitions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id - Get single requisition with position details
router.get('/:id', allowedRoles, async (req, res) => {
  try {
    const requisition = await fetchRequisition(pool, req.params.id);
    if (!requisition) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    const positions = await fetchRequisitionPositions(pool, req.params.id);
    res.json({ ...requisition, positions });
  } catch (err) {
    console.error('Get requisition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/assign-recruiter', hrAdminOnly, async (req, res) => {
  try {
    const existing = await fetchRequisition(pool, req.params.id, true);
    if (!existing || existing.active_flag === false) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    if (existing.status !== 'approved') {
      return res.status(400).json({ error: 'Recruiter assignment is available only after HR Admin approval' });
    }

    const recruiterEmail = String(req.body.recruiter_email || '').trim().toLowerCase();
    let recruiter = null;

    if (recruiterEmail) {
      const recruiterResult = await pool.query(
        `SELECT email, name, role
         FROM users
         WHERE LOWER(email) = LOWER($1)
           AND is_active = true
           AND role IN ('hr_admin', 'hr_recruiter')
         LIMIT 1`,
        [recruiterEmail]
      );
      recruiter = recruiterResult.rows[0] || null;
      if (!recruiter) {
        return res.status(400).json({ error: 'Select a valid active recruiter or HR Admin' });
      }
    }

    await pool.query(
      `UPDATE requisitions
       SET assigned_recruiter_email = $1,
           assigned_recruiter_assigned_by = CASE WHEN $1::varchar IS NULL THEN NULL ELSE $2 END,
           assigned_recruiter_assigned_at = CASE WHEN $1::varchar IS NULL THEN NULL ELSE NOW() END,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [recruiter?.email || null, req.user.email, req.params.id]
    );

    const updated = await fetchRequisition(pool, req.params.id, true);
    const positions = await fetchRequisitionPositions(pool, req.params.id);

    await logAudit({
      actionBy: req.user.email,
      actionType: recruiter ? 'assign_recruiter' : 'clear_recruiter',
      entityType: 'requisition',
      entityId: req.params.id,
      beforeState: existing,
      afterState: updated,
    });

    if (recruiter?.email) {
      await sendNotificationEmail(
        recruiter.email,
        'Approved Requisition Assigned',
        `Requisition ${existing.requisition_id} has been assigned to you for job creation.`
      ).catch((emailErr) => console.error('Recruiter assignment email error:', emailErr.message));
    }

    res.json({ ...updated, positions });
  } catch (err) {
    console.error('Assign recruiter error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /:id/approve - Approve CXO or HR Admin stage
router.post('/:id/approve', allowedRoles, async (req, res) => {
  const client = await pool.connect();
  try {
    const existing = await fetchRequisition(client, req.params.id, true);
    if (!existing || existing.active_flag === false) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    const comments = req.body.comments || null;
    const approvalSteps = Array.isArray(existing.approval_steps) ? existing.approval_steps : await listApprovalSteps(client, req.params.id);

    await client.query('BEGIN');

    if (existing.status === 'pending_cxo_approval') {
      const pendingStep = getPendingApprovalForUser(approvalSteps, 'cxo', req.user.email);
      if (!pendingStep) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You are not the pending CXO approver for this requisition' });
      }

      await client.query(
        `UPDATE requisition_approvals
         SET status = 'approved',
             comments = $1,
             acted_by_email = $2,
             acted_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [comments, req.user.email, pendingStep.id]
      );

      const remainingCxoApprovals = await client.query(
        `SELECT COUNT(*) AS count
         FROM requisition_approvals
         WHERE requisition_id = $1
           AND approval_stage = 'cxo'
           AND status = 'pending'`,
        [req.params.id]
      );

      if (Number(remainingCxoApprovals.rows[0]?.count || 0) > 0) {
        await client.query(
          `UPDATE requisitions
           SET approval_comments = $1,
               updated_by = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [mergeApprovalComment(existing.approval_comments, req.user.email, comments), req.user.email, req.params.id]
        );
      } else {
        const hrAdmins = await createHrAdminApprovalSteps(client, req.params.id);
        await client.query(
          `UPDATE requisitions
           SET status = 'pending_hr_admin_approval',
               current_approval_stage = 'hr_admin',
               approval_route = $1,
               approval_comments = $2,
               updated_by = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [
            JSON.stringify(buildApprovalRoute({ requiresCxo: true, cxoApprovers: approvalSteps.filter((step) => step.approval_stage === 'cxo').map((step) => ({
              employee_email: step.approver_email,
              employee_name: step.approver_name,
              employee_id: step.approver_employee_id,
              designation: step.approver_role,
            })), hrAdmins })),
            mergeApprovalComment(existing.approval_comments, req.user.email, comments),
            req.user.email,
            req.params.id,
          ]
        );

        for (const admin of hrAdmins) {
          await sendNotificationEmail(
            admin.email,
            'Requisition Awaiting HR Admin Approval',
            `Requisition ${existing.requisition_id} has cleared CXO approval and now awaits HR Admin approval.`
          ).catch((emailErr) => console.error('HR admin approval notification error:', emailErr.message));
        }
      }
    } else if (['pending_hr_admin_approval', 'pending_approval'].includes(existing.status)) {
      if (req.user.role !== 'hr_admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Only HR Admin can approve this requisition at the current stage' });
      }

      const pendingAdminStep = getPendingApprovalForUser(approvalSteps, 'hr_admin', req.user.email);
      if (pendingAdminStep) {
        await client.query(
          `UPDATE requisition_approvals
           SET status = 'approved',
               comments = $1,
               acted_by_email = $2,
               acted_at = NOW(),
               updated_at = NOW()
           WHERE id = $3`,
          [comments, req.user.email, pendingAdminStep.id]
        );
        await skipOtherApprovalSteps(client, {
          requisitionId: req.params.id,
          approvalStage: 'hr_admin',
          actorEmail: req.user.email,
        });
      }

      await client.query(
        `UPDATE requisitions
         SET status = 'approved',
             current_approval_stage = 'completed',
             approved_by = $1,
             approved_at = NOW(),
             approval_comments = $2,
             updated_by = $1,
             updated_at = NOW()
         WHERE id = $3`,
        [req.user.email, mergeApprovalComment(existing.approval_comments, req.user.email, comments), req.params.id]
      );
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This requisition is not awaiting approval' });
    }

    await client.query('COMMIT');

    const updated = await fetchRequisition(pool, req.params.id, true);
    const positions = await fetchRequisitionPositions(pool, req.params.id);

    await logAudit({
      actionBy: req.user.email,
      actionType: 'approve',
      entityType: 'requisition',
      entityId: req.params.id,
      beforeState: existing,
      afterState: updated,
    });

    if (updated.status === 'approved') {
      await sendNotificationEmail(
        existing.created_by,
        'Requisition Approved',
        `Requisition ${existing.requisition_id} has been approved and can now be converted into a job.`
      ).catch((emailErr) => console.error('Requisition approval email error:', emailErr.message));
    } else if (updated.status === 'pending_hr_admin_approval') {
      await sendNotificationEmail(
        existing.created_by,
        'CXO Approval Completed',
        `Requisition ${existing.requisition_id} has completed CXO approval and now awaits HR Admin approval.`
      ).catch((emailErr) => console.error('CXO approval transition email error:', emailErr.message));
    }

    res.json({ ...updated, positions });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Approve requisition error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /:id/reject - Reject CXO or HR Admin approval stage
router.post('/:id/reject', allowedRoles, async (req, res) => {
  const client = await pool.connect();
  try {
    const existing = await fetchRequisition(client, req.params.id, true);
    if (!existing || existing.active_flag === false) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    const comments = req.body.comments || null;
    const approvalSteps = Array.isArray(existing.approval_steps) ? existing.approval_steps : await listApprovalSteps(client, req.params.id);

    await client.query('BEGIN');

    if (existing.status === 'pending_cxo_approval') {
      const pendingStep = getPendingApprovalForUser(approvalSteps, 'cxo', req.user.email);
      if (!pendingStep) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You are not the pending CXO approver for this requisition' });
      }

      await client.query(
        `UPDATE requisition_approvals
         SET status = 'rejected',
             comments = $1,
             acted_by_email = $2,
             acted_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [comments, req.user.email, pendingStep.id]
      );
      await skipOtherApprovalSteps(client, {
        requisitionId: req.params.id,
        approvalStage: 'cxo',
        actorEmail: req.user.email,
      });

      await client.query(
        `UPDATE requisitions
         SET status = 'cxo_rejected',
             current_approval_stage = 'cxo',
             approved_by = NULL,
             approved_at = NULL,
             approval_comments = $1,
             updated_by = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [mergeApprovalComment(existing.approval_comments, req.user.email, comments), req.user.email, req.params.id]
      );
    } else if (['pending_hr_admin_approval', 'pending_approval'].includes(existing.status)) {
      if (req.user.role !== 'hr_admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Only HR Admin can reject this requisition at the current stage' });
      }

      const pendingAdminStep = getPendingApprovalForUser(approvalSteps, 'hr_admin', req.user.email);
      if (pendingAdminStep) {
        await client.query(
          `UPDATE requisition_approvals
           SET status = 'rejected',
               comments = $1,
               acted_by_email = $2,
               acted_at = NOW(),
               updated_at = NOW()
           WHERE id = $3`,
          [comments, req.user.email, pendingAdminStep.id]
        );
        await skipOtherApprovalSteps(client, {
          requisitionId: req.params.id,
          approvalStage: 'hr_admin',
          actorEmail: req.user.email,
        });
      }

      await client.query(
        `UPDATE requisitions
         SET status = 'rejected',
             current_approval_stage = 'hr_admin',
             approved_by = NULL,
             approved_at = NULL,
             approval_comments = $1,
             updated_by = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [mergeApprovalComment(existing.approval_comments, req.user.email, comments), req.user.email, req.params.id]
      );
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This requisition is not awaiting approval' });
    }

    await client.query('COMMIT');

    const updated = await fetchRequisition(pool, req.params.id, true);
    const positions = await fetchRequisitionPositions(pool, req.params.id);

    await logAudit({
      actionBy: req.user.email,
      actionType: 'reject',
      entityType: 'requisition',
      entityId: req.params.id,
      beforeState: existing,
      afterState: updated,
    });

    await sendNotificationEmail(
      existing.created_by,
      updated.status === 'cxo_rejected' ? 'Requisition Rejected by CXO' : 'Requisition Rejected by HR Admin',
      `Requisition ${existing.requisition_id} was rejected.${comments ? ` Comments: ${comments}` : ''}`
    ).catch((emailErr) => console.error('Requisition rejection email error:', emailErr.message));

    res.json({ ...updated, positions });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Reject requisition error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST / - Create requisition
router.post('/', allowedRoles, async (req, res) => {
  const client = await pool.connect();

  try {
    const payload = await resolveRequisitionPayload(client, req.body);
    if (!payload.job_title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    await client.query('BEGIN');

    const requisitionId = await generateRequisitionId(client, payload.business_unit_id);
    const totalPositions = payload.positions.reduce((sum, row) => sum + row.number_of_positions, 0);
    const summaryDates = summarizePositions(payload.positions);
    const requiresCxo = requisitionNeedsCxoApproval(payload);
    const cxoApprovers = requiresCxo
      ? await matchCxoApprovers(client, {
        requisitionerEmail: req.user.email,
      })
      : [];
    const hrAdmins = await getActiveHrAdmins(client);
    const status = resolveSubmissionStatus({
      userRole: req.user.role,
      requestedStatus: req.body.status,
      requiresCxo,
      hasCxoApprovers: cxoApprovers.length > 0,
    });
    // Only error if submitting (not draft) AND requires CXO AND no approvers found at all
    // (self-approval case is fine - it goes directly to HR admin)
    if (status !== 'draft' && requiresCxo && cxoApprovers.length === 0) {
      // This is the self-approval or no-mapping case; we already route to HR admin, so it's OK
      // Only throw if no HR admins exist
    }

    await ensureApproverUserAccounts(client, cxoApprovers);
    const approvalRoute = buildApprovalRoute({ requiresCxo, cxoApprovers, hrAdmins });

    const insertResult = await client.query(
      `INSERT INTO requisitions (
          requisition_id,
          created_by,
          updated_by,
          job_title,
          priority,
          department_id,
          sub_department_id,
          experience_years,
          grade_id,
          level_id,
          requisition_type,
          job_type,
          business_unit_id,
          start_hire_date,
          target_hire_date,
          submitted_at,
          submitted_by,
          cxo_approval_required,
          current_approval_stage,
          approval_route,
          approved_by,
          approved_at,
          approval_comments,
          job_description,
          additional_comments,
          attachments,
          total_positions,
          active_flag,
          status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
        )
        RETURNING *`,
      [
        requisitionId,
        req.user.email,
        req.user.email,
        payload.job_title,
        payload.priority,
        payload.department_id,
        payload.sub_department_id,
        payload.experience_years,
        payload.grade_id,
        payload.level_id,
        payload.requisition_type,
        payload.job_type,
        payload.business_unit_id,
        summaryDates.start_hire_date,
        summaryDates.target_hire_date,
        status === 'draft' ? null : new Date().toISOString(),
        status === 'draft' ? null : req.user.email,
        requiresCxo,
        status === 'draft' ? null : (requiresCxo ? 'cxo' : 'hr_admin'),
        JSON.stringify(approvalRoute),
        null,
        null,
        null,
        payload.job_description,
        payload.additional_comments,
        JSON.stringify(payload.attachments),
        totalPositions,
        payload.active_flag,
        status,
      ]
    );

    const requisition = insertResult.rows[0];

    for (const position of payload.positions) {
      await client.query(
        `INSERT INTO requisition_positions (
            requisition_id,
            position_type,
            location_id,
            phase_id,
            start_hire_date,
            target_hire_date,
            number_of_positions,
            backfill_employee_id,
            backfill_employee_name,
            backfill_employee_email,
            backfill_reason_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          requisition.id,
          position.position_type,
          position.location_id,
          position.phase_id,
          position.start_hire_date,
          position.target_hire_date,
          position.number_of_positions,
          position.backfill_employee_id,
          position.backfill_employee_name,
          position.backfill_employee_email,
          position.backfill_reason_id,
        ]
      );
    }

    if (status !== 'draft') {
      await replaceApprovalSteps(client, {
        requisitionId: requisition.id,
        requiresCxo,
        cxoApprovers,
      });
    }

    await client.query('COMMIT');

    const aopWarning = await checkAOP(
      pool,
      payload.business_unit_id,
      payload.department_id,
      totalPositions
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'create',
      entityType: 'requisition',
      entityId: requisition.id,
      afterState: requisition,
    });

    try {
      const recipients = status === 'draft'
        ? hrAdmins
        : requiresCxo
          ? cxoApprovers.map((approver) => ({ email: approver.employee_email }))
          : hrAdmins;
      for (const recipient of recipients) {
        if (!recipient.email) continue;
        await sendNotificationEmail(
          recipient.email,
          status === 'draft' ? 'New Requisition Draft Created' : 'Requisition Awaiting Approval',
          status === 'draft'
            ? `A new requisition draft ${requisitionId} for "${payload.job_title}" has been created.`
            : `Requisition ${requisitionId} for "${payload.job_title}" is awaiting your approval.`
        );
      }

      // Phase 3: branded admin alert + raiser confirmation using the new
      // Goldman-style templates.
      if (status !== 'draft') {
        const { requisitionRaisedAdminEmail, requisitionRaisedConfirmationEmail } = await import('../services/txEmails.js');
        const { sendEmail } = await import('../services/email.js');

        // Admin alert (always — informs the HR admin team a new req exists)
        const adminEmails = hrAdmins.map((a) => a.email).filter(Boolean);
        if (adminEmails.length) {
          sendEmail(adminEmails,
            `New requisition ${requisitionId} — ${payload.job_title}`,
            requisitionRaisedAdminEmail({
              requisitionId,
              raisedBy: req.user.email,
              jobTitle: payload.job_title,
              type: requiresCxo ? 'new_hire' : 'replacement',
            })
          ).catch(() => {});
        }
        // Raiser confirmation
        sendEmail(req.user.email,
          `Requisition ${requisitionId} submitted`,
          requisitionRaisedConfirmationEmail({
            requisitionId,
            jobTitle: payload.job_title,
            type: requiresCxo ? 'new_hire' : 'replacement',
          })
        ).catch(() => {});
      }
    } catch (emailErr) {
      console.error('Requisition notification error:', emailErr.message);
    }

    const fullRequisition = await fetchRequisition(pool, requisition.id, true);
    const positions = await fetchRequisitionPositions(pool, requisition.id);

    res.status(201).json({
      ...fullRequisition,
      positions,
      aop_warning: aopWarning.warning ? aopWarning : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const message = err.message || 'Internal server error';
    console.error('Create requisition error:', err);
    res.status(message.includes('required') || message.includes('valid') ? 400 : 500).json({ error: message });
  } finally {
    client.release();
  }
});

// PUT /:id - Update requisition
router.put('/:id', allowedRoles, async (req, res) => {
  const client = await pool.connect();

  try {
    const existing = await fetchRequisition(client, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    const payload = await resolveRequisitionPayload(client, {
      ...existing,
      ...req.body,
      business_unit: req.body.business_unit ?? existing.bu_name,
      department: req.body.department ?? existing.department_name,
      sub_department: req.body.sub_department ?? existing.sub_department_name,
    });

    await client.query('BEGIN');

    const totalPositions = payload.positions.reduce((sum, row) => sum + row.number_of_positions, 0);
    const summaryDates = summarizePositions(payload.positions);
    const requiresCxo = requisitionNeedsCxoApproval(payload);
    const cxoApprovers = requiresCxo
      ? await matchCxoApprovers(client, {
        requisitionerEmail: existing.created_by || req.user.email,
      })
      : [];
    const hrAdmins = await getActiveHrAdmins(client);
    const status = resolveSubmissionStatus({
      userRole: req.user.role,
      requestedStatus: req.body.status,
      existingStatus: existing.status,
      requiresCxo,
      hasCxoApprovers: cxoApprovers.length > 0,
    });
    if (status !== 'draft' && status !== 'approved' && requiresCxo && cxoApprovers.length === 0) {
      throw new Error('No approver mapping is configured for this requisitioner');
    }

    await ensureApproverUserAccounts(client, cxoApprovers);

    const isApprovalPendingStatus = ['pending_cxo_approval', 'pending_hr_admin_approval', 'pending_approval'].includes(status);
    const approvalRoute = buildApprovalRoute({ requiresCxo, cxoApprovers, hrAdmins });
    const approvedBy = status === 'approved' ? existing.approved_by : null;
    const approvedAt = status === 'approved' ? existing.approved_at : null;
    const approvalComments = ['approved', 'rejected', 'cxo_rejected'].includes(status)
      ? existing.approval_comments
      : null;

    await client.query(
      `UPDATE requisitions SET
          updated_by = $1,
          job_title = $2,
          priority = $3,
          department_id = $4,
          sub_department_id = $5,
          experience_years = $6,
          grade_id = $7,
          level_id = $8,
          requisition_type = $9,
          job_type = $10,
          business_unit_id = $11,
          start_hire_date = $12,
          target_hire_date = $13,
          submitted_at = $14,
          submitted_by = $15,
          cxo_approval_required = $16,
          current_approval_stage = $17,
          approval_route = $18,
          job_description = $19,
          additional_comments = $20,
          attachments = $21,
          total_positions = $22,
          active_flag = $23,
          status = $24,
          approved_by = $25,
          approved_at = $26,
          approval_comments = $27,
          updated_at = NOW()
        WHERE id = $28`,
      [
        req.user.email,
        payload.job_title,
        payload.priority,
        payload.department_id,
        payload.sub_department_id,
        payload.experience_years,
        payload.grade_id,
        payload.level_id,
        payload.requisition_type,
        payload.job_type,
        payload.business_unit_id,
        summaryDates.start_hire_date,
        summaryDates.target_hire_date,
        isApprovalPendingStatus ? new Date().toISOString() : existing.submitted_at,
        isApprovalPendingStatus ? req.user.email : existing.submitted_by,
        requiresCxo,
        status === 'draft' ? null : status === 'approved' ? 'completed' : (requiresCxo ? 'cxo' : 'hr_admin'),
        JSON.stringify(approvalRoute),
        payload.job_description,
        payload.additional_comments,
        JSON.stringify(payload.attachments),
        totalPositions,
        payload.active_flag,
        status,
        approvedBy,
        approvedAt,
        approvalComments,
        req.params.id,
      ]
    );

    await client.query('DELETE FROM requisition_positions WHERE requisition_id = $1', [req.params.id]);

    for (const position of payload.positions) {
      await client.query(
        `INSERT INTO requisition_positions (
            requisition_id,
            position_type,
            location_id,
            phase_id,
            start_hire_date,
            target_hire_date,
            number_of_positions,
            backfill_employee_id,
            backfill_employee_name,
            backfill_employee_email,
            backfill_reason_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          req.params.id,
          position.position_type,
          position.location_id,
          position.phase_id,
          position.start_hire_date,
          position.target_hire_date,
          position.number_of_positions,
          position.backfill_employee_id,
          position.backfill_employee_name,
          position.backfill_employee_email,
          position.backfill_reason_id,
        ]
      );
    }

    if (status === 'draft') {
      await client.query('DELETE FROM requisition_approvals WHERE requisition_id = $1', [req.params.id]);
    } else if (status === 'approved') {
      // Preserve historic approval steps for already-approved requisitions.
    } else {
      // Wipe before replace so re-submitting a pending requisition can never
      // accumulate stale/duplicate approval steps.
      await client.query('DELETE FROM requisition_approvals WHERE requisition_id = $1', [req.params.id]);
      await replaceApprovalSteps(client, {
        requisitionId: req.params.id,
        requiresCxo,
        cxoApprovers,
      });
    }

    await client.query('COMMIT');

    const updated = await fetchRequisition(pool, req.params.id, true);
    const positions = await fetchRequisitionPositions(pool, req.params.id);
    const aopWarning = await checkAOP(
      pool,
      payload.business_unit_id,
      payload.department_id,
      totalPositions,
      req.params.id
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'requisition',
      entityId: req.params.id,
      beforeState: existing,
      afterState: updated,
    });

    res.json({
      ...updated,
      positions,
      aop_warning: aopWarning.warning ? aopWarning : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const message = err.message || 'Internal server error';
    console.error('Update requisition error:', err);
    res.status(message.includes('required') || message.includes('valid') ? 400 : 500).json({ error: message });
  } finally {
    client.release();
  }
});

// DELETE /:id - Soft delete
router.delete('/:id', allowedRoles, async (req, res) => {
  try {
    const existing = await fetchRequisition(pool, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    await pool.query(
      'UPDATE requisitions SET active_flag = false, updated_by = $1, updated_at = NOW() WHERE id = $2',
      [req.user.email, req.params.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'delete',
      entityType: 'requisition',
      entityId: req.params.id,
      beforeState: existing,
    });

    res.json({ message: 'Requisition deleted successfully' });
  } catch (err) {
    console.error('Delete requisition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /generate-jd - Generate job description using AI
router.post('/generate-jd', allowedRoles, async (req, res) => {
  try {
    const designation = req.body.designation || req.body.job_title;
    const { department, sub_department, additional_context } = req.body;

    if (!designation || !department) {
      return res.status(400).json({ error: 'designation/job title and department are required' });
    }

    const templateResult = await pool.query(
      'SELECT jd_template FROM designations WHERE designation = $1 LIMIT 1',
      [designation]
    );

    const jd = await generateJobDescription({
      designation,
      department,
      subDepartment: sub_department || null,
      jdTemplate: templateResult.rows[0]?.jd_template || null,
      additionalContext: additional_context || null,
    });

    res.json({ job_description: jd });
  } catch (err) {
    console.error('Generate JD error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
