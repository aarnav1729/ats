import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { listManagingDirectorDirectReports, listSpotEmployees } from '../services/spot.js';
import {
  buildApprovalRoute,
  ensureApproverUserAccounts,
  getActiveHrAdmins,
  matchCxoApprovers,
  normalizeStringArray,
  requisitionNeedsCxoApproval,
} from '../services/requisitionApproval.js';

const router = Router();
const readRoles = requireRole('hr_admin', 'hr_recruiter', 'hod');
const adminOnly = requireRole('hr_admin');

function mergeScopes(existingRow = {}, body = {}) {
  return {
    department_scope: normalizeStringArray(body.department_scope ?? existingRow.department_scope ?? body.department_name ?? existingRow.department_name),
    sub_department_scope: normalizeStringArray(body.sub_department_scope ?? existingRow.sub_department_scope ?? body.sub_department_name ?? existingRow.sub_department_name),
    business_unit_scope: normalizeStringArray(body.business_unit_scope ?? existingRow.business_unit_scope),
  };
}

async function resolveSpotEmployee(searchValue) {
  if (!searchValue) return null;
  const employees = await listSpotEmployees({ search: searchValue });
  return employees.find((employee) => (
    employee.employee_id === searchValue
    || employee.employee_email?.toLowerCase() === String(searchValue).trim().toLowerCase()
    || employee.employee_name?.toLowerCase() === String(searchValue).trim().toLowerCase()
  )) || null;
}

function shouldLookupSpot(body = {}) {
  return Boolean(body.search)
    || (!body.employee_name && !body.designation)
    || (!body.employee_email && !body.employee_id);
}

function shapeCxoInput(existingRow = {}, spotEmployee = null, body = {}) {
  const sourceEmployee = spotEmployee || existingRow;
  const scopes = mergeScopes(existingRow, body);

  return {
    employee_id: body.employee_id || sourceEmployee?.employee_id || null,
    employee_name: body.employee_name || sourceEmployee?.employee_name || null,
    employee_email: body.employee_email || sourceEmployee?.employee_email || null,
    designation: body.designation || sourceEmployee?.designation || null,
    department_name: body.department_name || sourceEmployee?.department_name || null,
    sub_department_name: body.sub_department_name || sourceEmployee?.sub_department_name || null,
    location_name: body.location_name || sourceEmployee?.location_name || null,
    manager_id: body.manager_id || sourceEmployee?.manager_id || null,
    department_scope: JSON.stringify(scopes.department_scope),
    sub_department_scope: JSON.stringify(scopes.sub_department_scope),
    business_unit_scope: JSON.stringify(scopes.business_unit_scope),
    approval_order: Number(body.approval_order ?? existingRow.approval_order ?? 1) || 1,
    notes: body.notes ?? existingRow.notes ?? null,
    is_direct_report: body.is_direct_report ?? existingRow.is_direct_report ?? Boolean(spotEmployee),
    source: body.source || existingRow.source || (spotEmployee ? 'spot' : 'manual'),
    active_flag: body.active_flag ?? existingRow.active_flag ?? true,
  };
}

// Search employees from SPOT EMP for auto-fill
router.get('/employee-search', readRoles, async (req, res) => {
  try {
    const employees = await listSpotEmployees({ search: req.query.search || '' });
    res.json({
      items: employees.slice(0, 30),
      data: employees.slice(0, 30),
      total: employees.length,
    });
  } catch (err) {
    console.error('Org employee search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Read CXO directory and live direct reports to MD
router.get('/cxo-directory', readRoles, async (_req, res) => {
  try {
    const [directoryResult, hrAdmins] = await Promise.all([
      pool.query('SELECT * FROM cxo_directory ORDER BY approval_order ASC, employee_name ASC'),
      getActiveHrAdmins(pool),
    ]);

    let mdSnapshot = { managingDirector: null, directReports: [] };
    let spotUnavailableReason = null;
    try {
      mdSnapshot = await listManagingDirectorDirectReports();
    } catch (spotErr) {
      spotUnavailableReason = spotErr.message || 'SPOT EMP was unavailable';
    }

    res.json({
      managing_director: mdSnapshot.managingDirector,
      direct_reports: mdSnapshot.directReports,
      items: directoryResult.rows,
      data: directoryResult.rows,
      spot_unavailable_reason: spotUnavailableReason,
      approval_route_template: buildApprovalRoute({
        requiresCxo: true,
        cxoApprovers: directoryResult.rows,
        hrAdmins,
      }),
    });
  } catch (err) {
    console.error('CXO directory error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Preview approval path for a requisition selection
router.get('/approval-preview', readRoles, async (req, res) => {
  try {
    const {
      department,
      sub_department,
      business_unit,
      requires_cxo,
      requisition_type,
    } = req.query;
    const requiresCxo = String(requires_cxo) === 'true' || requisitionNeedsCxoApproval({
      requisition_type: requisition_type || '',
    });
    const hrAdmins = await getActiveHrAdmins(pool);
    const cxoApprovers = requiresCxo
      ? await matchCxoApprovers(pool, {
        departmentName: department,
        subDepartmentName: sub_department,
        businessUnitName: business_unit,
      })
      : [];

    res.json({
      requires_cxo: requiresCxo,
      cxo_approvers: cxoApprovers,
      hr_admin_approvers: hrAdmins,
      route: buildApprovalRoute({
        requiresCxo,
        cxoApprovers,
        hrAdmins,
      }),
    });
  } catch (err) {
    console.error('Approval preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync MD direct reports from SPOT into CXO directory
router.post('/cxo-directory/sync', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const { managingDirector, directReports } = await listManagingDirectorDirectReports();

    await client.query('BEGIN');
    await ensureApproverUserAccounts(client, directReports);

    for (const employee of directReports) {
      await client.query(
        `INSERT INTO cxo_directory (
          employee_id,
          employee_name,
          employee_email,
          designation,
          department_name,
          sub_department_name,
          location_name,
          manager_id,
          department_scope,
          sub_department_scope,
          business_unit_scope,
          approval_order,
          notes,
          is_direct_report,
          source,
          active_flag,
          created_by,
          updated_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,'spot',true,$14,$14
        )
        ON CONFLICT (employee_id) DO UPDATE SET
          employee_name = EXCLUDED.employee_name,
          employee_email = EXCLUDED.employee_email,
          designation = EXCLUDED.designation,
          department_name = EXCLUDED.department_name,
          sub_department_name = EXCLUDED.sub_department_name,
          location_name = EXCLUDED.location_name,
          manager_id = EXCLUDED.manager_id,
          is_direct_report = true,
          source = 'spot',
          active_flag = true,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()`,
        [
          employee.employee_id,
          employee.employee_name,
          employee.employee_email?.toLowerCase() || null,
          employee.designation,
          employee.department_name,
          employee.sub_department_name,
          employee.location_name,
          employee.manager_id,
          JSON.stringify([employee.department_name].filter(Boolean)),
          JSON.stringify([employee.sub_department_name].filter(Boolean)),
          JSON.stringify([]),
          1,
          `Synced from SPOT direct reports of ${managingDirector?.employee_name || 'Managing Director'}`,
          req.user.email,
        ]
      );
    }

    await client.query('COMMIT');

    const refreshed = await client.query('SELECT * FROM cxo_directory ORDER BY approval_order ASC, employee_name ASC');
    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'cxo_directory',
      entityId: 'sync',
      afterState: {
        managing_director: managingDirector,
        synced_count: directReports.length,
      },
    });

    res.json({
      managing_director: managingDirector,
      synced_count: directReports.length,
      items: refreshed.rows,
      data: refreshed.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('CXO sync error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Create a CXO directory entry
router.post('/cxo-directory', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const spotEmployee = shouldLookupSpot(req.body)
      ? await resolveSpotEmployee(req.body.employee_id || req.body.employee_email || req.body.employee_name || req.body.search)
      : null;
    const payload = shapeCxoInput({}, spotEmployee, req.body);

    if (!payload.employee_id || !payload.employee_name) {
      return res.status(400).json({ error: 'Select a valid employee from SPOT EMP or provide employee details' });
    }

    await client.query('BEGIN');
    await ensureApproverUserAccounts(client, [payload]);
    const result = await client.query(
      `INSERT INTO cxo_directory (
        employee_id,
        employee_name,
        employee_email,
        designation,
        department_name,
        sub_department_name,
        location_name,
        manager_id,
        department_scope,
        sub_department_scope,
        business_unit_scope,
        approval_order,
        notes,
        is_direct_report,
        source,
        active_flag,
        created_by,
        updated_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17
      )
      RETURNING *`,
      [
        payload.employee_id,
        payload.employee_name,
        payload.employee_email?.toLowerCase() || null,
        payload.designation,
        payload.department_name,
        payload.sub_department_name,
        payload.location_name,
        payload.manager_id,
        payload.department_scope,
        payload.sub_department_scope,
        payload.business_unit_scope,
        payload.approval_order,
        payload.notes,
        payload.is_direct_report,
        payload.source,
        payload.active_flag,
        req.user.email,
      ]
    );
    await client.query('COMMIT');

    await logAudit({
      actionBy: req.user.email,
      actionType: 'create',
      entityType: 'cxo_directory',
      entityId: result.rows[0].id,
      afterState: result.rows[0],
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Create CXO error:', err);
    res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'Employee already exists in the CXO directory' : 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update a CXO directory entry
router.put('/cxo-directory/:id', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    const existingResult = await client.query('SELECT * FROM cxo_directory WHERE id = $1', [req.params.id]);
    if (!existingResult.rows.length) {
      return res.status(404).json({ error: 'CXO entry not found' });
    }

    const existing = existingResult.rows[0];
    const spotEmployee = shouldLookupSpot(req.body)
      ? await resolveSpotEmployee(req.body.employee_id || req.body.employee_email || req.body.employee_name || null)
      : null;
    const payload = shapeCxoInput(existing, spotEmployee, req.body);

    await client.query('BEGIN');
    await ensureApproverUserAccounts(client, [payload]);
    const result = await client.query(
      `UPDATE cxo_directory SET
        employee_id = $1,
        employee_name = $2,
        employee_email = $3,
        designation = $4,
        department_name = $5,
        sub_department_name = $6,
        location_name = $7,
        manager_id = $8,
        department_scope = $9,
        sub_department_scope = $10,
        business_unit_scope = $11,
        approval_order = $12,
        notes = $13,
        is_direct_report = $14,
        source = $15,
        active_flag = $16,
        updated_by = $17,
        updated_at = NOW()
      WHERE id = $18
      RETURNING *`,
      [
        payload.employee_id,
        payload.employee_name,
        payload.employee_email?.toLowerCase() || null,
        payload.designation,
        payload.department_name,
        payload.sub_department_name,
        payload.location_name,
        payload.manager_id,
        payload.department_scope,
        payload.sub_department_scope,
        payload.business_unit_scope,
        payload.approval_order,
        payload.notes,
        payload.is_direct_report,
        payload.source,
        payload.active_flag,
        req.user.email,
        req.params.id,
      ]
    );
    await client.query('COMMIT');

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'cxo_directory',
      entityId: req.params.id,
      beforeState: existing,
      afterState: result.rows[0],
    });

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Update CXO error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.delete('/cxo-directory/:id', adminOnly, async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM cxo_directory WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'CXO entry not found' });
    }

    await pool.query(
      `UPDATE cxo_directory
       SET active_flag = false,
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [req.user.email, req.params.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'delete',
      entityType: 'cxo_directory',
      entityId: req.params.id,
      beforeState: existing.rows[0],
    });

    res.json({ message: 'CXO entry deactivated' });
  } catch (err) {
    console.error('Delete CXO error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
