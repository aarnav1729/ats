import pool from '../db.js';

function getISTTimestamp() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

export async function logAudit(input) {
  const {
    actionBy,
    actionType,
    entityType,
    entityId,
    fieldEdited,
    beforeState,
    afterState,
    metadata,
    action_by,
    action_type,
    entity_type,
    entity_id,
    field_edited,
    before_state,
    after_state,
    performed_by,
    action,
    details,
  } = input || {};

  const resolvedActionBy = actionBy || action_by || performed_by || 'system';
  const resolvedActionType = actionType || action_type || action || 'update';
  const resolvedEntityType = entityType || entity_type || 'system';
  const resolvedEntityId = entityId ?? entity_id ?? '';
  const resolvedFieldEdited = fieldEdited ?? field_edited ?? null;
  const resolvedBeforeState = beforeState ?? before_state ?? null;
  const resolvedAfterState = afterState ?? after_state ?? details ?? null;
  const resolvedMetadata = metadata ?? details ?? {};

  try {
    const istTime = getISTTimestamp();
    await pool.query(
      `INSERT INTO audit_trail (action_by, action_type, entity_type, entity_id, field_edited, before_state, after_state, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        resolvedActionBy,
        resolvedActionType,
        resolvedEntityType,
        String(resolvedEntityId || ''),
        resolvedFieldEdited,
        resolvedBeforeState ? JSON.stringify(resolvedBeforeState) : null,
        resolvedAfterState ? JSON.stringify(resolvedAfterState) : null,
        resolvedMetadata ? JSON.stringify(resolvedMetadata) : '{}',
        istTime,
      ]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

export async function logBulkChanges(actionBy, entityType, entityId, before, after) {
  const changes = [];
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes.push({ field: key, before: before[key], after: after[key] });
    }
  }
  for (const change of changes) {
    await logAudit({
      actionBy, actionType: 'update', entityType, entityId,
      fieldEdited: change.field,
      beforeState: change.before,
      afterState: change.after,
    });
  }
}
