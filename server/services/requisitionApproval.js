export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeStringArray(parsed);
    } catch {
      return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    }
  }

  return [String(value).trim()].filter(Boolean);
}

export function requisitionNeedsCxoApproval(payload = {}) {
  if (Array.isArray(payload.positions)) {
    return payload.positions.some((position) => position?.position_type === 'new_hire');
  }

  return ['new_hire', 'both'].includes(payload.requisition_type);
}

export function resolveSubmissionStatus({ requestedStatus, existingStatus, requiresCxo, hasCxoApprovers, userRole }) {
  if (requestedStatus && !['draft', 'pending_approval', 'pending_cxo_approval', 'pending_hr_admin_approval'].includes(requestedStatus)) {
    throw new Error('Only draft or approval-pending statuses can be saved from the requisition form');
  }

  if (!requestedStatus) {
    if (existingStatus === 'approved' && userRole === 'hr_admin') {
      return 'approved';
    }
    return existingStatus || 'draft';
  }

  if (requestedStatus === 'draft') {
    return 'draft';
  }

  // If requires CXO but no actual CXO approvers (self-approval case or backfill-only),
  // go directly to HR admin approval
  if (requiresCxo && hasCxoApprovers) {
    return 'pending_cxo_approval';
  }
  return 'pending_hr_admin_approval';
}

export async function getActiveHrAdmins(client) {
  const result = await client.query(
    `SELECT email, COALESCE(name, split_part(email, '@', 1)) AS name
     FROM users
     WHERE role = 'hr_admin' AND is_active = true
     ORDER BY name, email`
  );
  return result.rows;
}

export async function ensureApproverUserAccounts(client, approvers = []) {
  for (const approver of approvers) {
    if (!approver?.employee_email) continue;
    await client.query(
      `INSERT INTO users (email, role, name, is_active)
       VALUES ($1, 'hod', $2, true)
       ON CONFLICT (email) DO NOTHING`,
      [approver.employee_email.toLowerCase(), approver.employee_name || null]
    );
  }
}

function matchesScope(scopes, value) {
  if (!scopes.length) return true;
  if (!value) return false;
  const normalizedValue = normalizeComparableValue(value);
  return scopes.some((scope) => normalizeComparableValue(scope) === normalizedValue);
}

function normalizeComparableValue(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const aliases = {
    hr: 'human resources',
    'human resource': 'human resources',
    'human resources': 'human resources',
  };

  return aliases[normalized] || normalized;
}

function subDepartmentMatches(scopeValues, subDepartmentName) {
  const scopes = normalizeStringArray(scopeValues);
  if (!scopes.length) return true;
  if (!subDepartmentName) return true;
  return matchesScope(scopes, subDepartmentName);
}

export async function matchCxoApprovers(client, { requisitionerEmail }) {
  if (!requisitionerEmail) return [];

  const normalizedRequisitioner = String(requisitionerEmail || '').trim().toLowerCase();

  const result = await client.query(
    `SELECT *
     FROM approvers_master
     WHERE active_flag = true
       AND LOWER(requisitioner_email) = LOWER($1)
     ORDER BY cxo_name ASC, cxo_email ASC`,
    [normalizedRequisitioner]
  );

  return result.rows
    .filter((row) => {
      if (!row.cxo_email) return false;
      // Skip self-approval: if the CXO approver IS the requisitioner, skip them
      // and let it go directly to HR admin
      const cxoEmail = String(row.cxo_email || '').trim().toLowerCase();
      return cxoEmail !== normalizedRequisitioner;
    })
    .map((row) => ({
      employee_email: row.cxo_email,
      employee_name: row.cxo_name,
      employee_id: row.cxo_employee_id,
      designation: row.cxo_designation || 'CXO',
      approval_order: 1,
      requisitioner_email: row.requisitioner_email,
      requisitioner_name: row.requisitioner_name,
    }));
}

/**
 * Check if a given email is allowed to create requisitions based on the approvers_master table.
 * This enables CXO-level users listed in the approvers master to also create requisitions.
 */
export async function isEmailInApproversList(client, email) {
  if (!email) return false;
  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await client.query(
    `SELECT 1 FROM approvers_master
     WHERE active_flag = true
       AND (LOWER(requisitioner_email) = $1 OR LOWER(cxo_email) = $1)
     LIMIT 1`,
    [normalizedEmail]
  );
  return result.rows.length > 0;
}

export function buildApprovalRoute({ requiresCxo, cxoApprovers = [], hrAdmins = [] }) {
  const route = [];

  // Only add CXO stage if: requires CXO approval AND there are actual (non-self) CXO approvers
  if (requiresCxo && cxoApprovers.length > 0) {
    route.push({
      stage: 'cxo',
      label: cxoApprovers.length > 1 ? 'CXO approvals' : 'CXO approval',
      approvers: cxoApprovers.map((approver) => ({
        email: approver.employee_email,
        name: approver.employee_name,
        employee_id: approver.employee_id,
        designation: approver.designation,
      })),
      note: null,
    });
  } else if (requiresCxo && cxoApprovers.length === 0) {
    // Self-approval case: CXO is the requisitioner, skip CXO stage entirely
    // (goes directly to HR Admin)
  }

  route.push({
    stage: 'hr_admin',
    label: 'HR Admin approval',
    approvers: hrAdmins.map((admin) => ({
      email: admin.email,
      name: admin.name,
    })),
  });

  return route;
}

export async function replaceApprovalSteps(client, { requisitionId, requiresCxo, cxoApprovers = [] }) {
  await client.query('DELETE FROM requisition_approvals WHERE requisition_id = $1', [requisitionId]);

  // Only insert CXO steps if there are actual (non-self) CXO approvers
  if (requiresCxo && cxoApprovers.length > 0) {
    for (const approver of cxoApprovers) {
      await client.query(
        `INSERT INTO requisition_approvals (
          requisition_id,
          approval_stage,
          approver_email,
          approver_name,
          approver_employee_id,
          approver_role,
          sequence_no,
          status
        ) VALUES ($1, 'cxo', $2, $3, $4, $5, $6, 'pending')`,
        [
          requisitionId,
          approver.employee_email?.toLowerCase(),
          approver.employee_name || null,
          approver.employee_id || null,
          approver.designation || 'cxo',
          approver.approval_order || 1,
        ]
      );
    }
    // Also create HR admin steps (they come after CXO)
  }

  const hrAdmins = await getActiveHrAdmins(client);
  for (const admin of hrAdmins) {
    await client.query(
      `INSERT INTO requisition_approvals (
        requisition_id,
        approval_stage,
        approver_email,
        approver_name,
        approver_role,
        sequence_no,
        status
      ) VALUES ($1, 'hr_admin', $2, $3, 'hr_admin', ${requiresCxo && cxoApprovers.length > 0 ? 2 : 1}, 'pending')`,
      [requisitionId, admin.email.toLowerCase(), admin.name || null]
    );
  }
}

export async function createHrAdminApprovalSteps(client, requisitionId) {
  await client.query(
    `DELETE FROM requisition_approvals
     WHERE requisition_id = $1 AND approval_stage = 'hr_admin'`,
    [requisitionId]
  );

  const hrAdmins = await getActiveHrAdmins(client);
  for (const admin of hrAdmins) {
    await client.query(
      `INSERT INTO requisition_approvals (
        requisition_id,
        approval_stage,
        approver_email,
        approver_name,
        approver_role,
        sequence_no,
        status
      ) VALUES ($1, 'hr_admin', $2, $3, 'hr_admin', 2, 'pending')`,
      [requisitionId, admin.email.toLowerCase(), admin.name || null]
    );
  }

  return hrAdmins;
}

export async function skipOtherApprovalSteps(client, { requisitionId, approvalStage, actorEmail }) {
  await client.query(
    `UPDATE requisition_approvals
     SET status = 'skipped',
         comments = COALESCE(comments, 'Superseded by another approval action'),
         updated_at = NOW()
     WHERE requisition_id = $1
       AND approval_stage = $2
       AND status = 'pending'
       AND approver_email <> $3`,
    [requisitionId, approvalStage, actorEmail.toLowerCase()]
  );
}

export async function listApprovalSteps(client, requisitionId) {
  const result = await client.query(
    `SELECT *
     FROM requisition_approvals
     WHERE requisition_id = $1
     ORDER BY sequence_no ASC, created_at ASC, approver_name ASC`,
    [requisitionId]
  );
  return result.rows;
}
