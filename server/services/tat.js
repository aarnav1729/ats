// TAT (Turnaround Time) engine.
//
// Every TAT number in the product is defined here so the meaning is unambiguous,
// the calculation is auditable ("Show working"), and the same definitions power
// MIS dashboards, raw exports, drilldowns, and API responses.
//
// Each PAIR has:
//   id            — stable machine id (used in URLs / exports)
//   label         — human label
//   level         — 'requisition' | 'job' | 'application'
//   from          — { source: 'timeline_events' | 'audit_trail' | 'column', match: …}
//   to            — same shape as `from`
//   description   — plain-English definition shown in the working modal
//   excludeWhen   — optional: array of conditions that pause the clock (e.g., job on hold)
//
// `match` shapes:
//   { source:'column',         table:'requisitions', column:'created_at' }
//   { source:'column',         table:'requisitions', column:'approved_at' }
//   { source:'timeline_events', entity:'application', event_type:'application.shortlisted' }
//   { source:'audit_trail',    entity_type:'application', action_type:'create' }

import pool from '../db.js';

export const TAT_PAIRS = [
  // ── Requisition lifecycle ──────────────────────────────────────────────
  {
    id: 'req_raised_to_first_approval',
    label: 'Requisition raised → first approval',
    level: 'requisition',
    description: 'Time from when the requisition was submitted (status moved out of draft) to when the first approver acted on it.',
    from: { source: 'column', table: 'requisitions', column: 'submitted_at' },
    to: { source: 'audit_trail', entity_type: 'requisition_approval', action_type: 'approve', first: true },
  },
  {
    id: 'req_raised_to_final_approval',
    label: 'Requisition raised → fully approved',
    level: 'requisition',
    description: 'Time from requisition submission to the moment all approval steps cleared and status became "approved".',
    from: { source: 'column', table: 'requisitions', column: 'submitted_at' },
    to: { source: 'column', table: 'requisitions', column: 'approved_at' },
  },
  {
    id: 'req_approved_to_job_created',
    label: 'Requisition approved → job created',
    level: 'requisition',
    description: 'Time between requisition approval and the moment the linked job was published.',
    from: { source: 'column', table: 'requisitions', column: 'approved_at' },
    to: { source: 'column', table: 'jobs', column: 'created_at', via: 'requisition_id' },
  },

  // ── Job lifecycle ─────────────────────────────────────────────────────
  {
    id: 'job_created_to_first_application',
    label: 'Job created → first applicant',
    level: 'job',
    description: 'Time from job publication to the first candidate application landing in the system.',
    from: { source: 'column', table: 'jobs', column: 'created_at' },
    to: { source: 'audit_trail', entity_type: 'application', action_type: 'create', first: true, scope: 'job' },
  },
  {
    id: 'job_created_to_first_offer',
    label: 'Job created → first offer issued',
    level: 'job',
    description: 'Time from job publication to the first candidate reaching Offered.',
    from: { source: 'column', table: 'jobs', column: 'created_at' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'application.offered', first: true, scope: 'job' },
    excludeWhen: ['job.status=on_hold'],
  },
  {
    id: 'job_created_to_first_join',
    label: 'Job created → first join',
    level: 'job',
    description: 'End-to-end fill time: from job publication to the first candidate marked as Joined.',
    from: { source: 'column', table: 'jobs', column: 'created_at' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'application.joined', first: true, scope: 'job' },
    excludeWhen: ['job.status=on_hold'],
  },

  // ── Per-application stage TATs ────────────────────────────────────────
  {
    id: 'applied_to_shortlisted',
    label: 'Applied → Shortlisted',
    level: 'application',
    description: 'Time the candidate spent in InQueue/Applied before the recruiter shortlisted them.',
    from: { source: 'audit_trail', entity_type: 'application', action_type: 'create' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'application.shortlisted' },
  },
  {
    id: 'shortlisted_to_first_interview',
    label: 'Shortlisted → first interview scheduled',
    level: 'application',
    description: 'How long it took to confirm an interview slot after the candidate was shortlisted.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'application.shortlisted' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'interview.scheduled', first: true },
  },
  {
    id: 'shortlisted_to_selected',
    label: 'Shortlisted → Selected',
    level: 'application',
    description: 'Total interview phase duration: from shortlist to the final-round shortlist decision.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'application.shortlisted' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'application.selected' },
  },
  {
    id: 'selected_to_documents_cleared',
    label: 'Selected → documents cleared',
    level: 'application',
    description: 'Time the candidate took to upload all required documents and have them approved.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'application.selected' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'documents.cleared' },
  },
  {
    id: 'documents_cleared_to_ctc_sent',
    label: 'Documents cleared → CTC sent',
    level: 'application',
    description: 'Time between document clearance and the recruiter sending the proposed CTC.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'documents.cleared' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'ctc.sent' },
  },
  {
    id: 'ctc_sent_to_ctc_approved',
    label: 'CTC sent → CTC approved by HR Admin',
    level: 'application',
    description: 'How long the CTC chain (recruiter 2 → HR admin → optional approver) took to clear.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'ctc.sent' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'ctc.approved' },
  },
  {
    id: 'ctc_approved_to_candidate_accepted',
    label: 'CTC approved → candidate accepted',
    level: 'application',
    description: 'How long the candidate took to accept the proposed CTC.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'ctc.approved' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'ctc.accepted' },
  },
  {
    id: 'ctc_accepted_to_offer_released',
    label: 'CTC accepted → offer letter released',
    level: 'application',
    description: 'Time between candidate accepting the CTC and the recruiter uploading the offer letter.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'ctc.accepted' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'offer.released' },
  },
  {
    id: 'offer_released_to_candidate_signed',
    label: 'Offer released → candidate signed',
    level: 'application',
    description: 'Candidate response time on the offer letter.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'offer.released' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'offer.signed' },
  },
  {
    id: 'offer_signed_to_joined',
    label: 'Offer signed → Joined',
    level: 'application',
    description: 'Time between candidate signing the offer and actually joining.',
    from: { source: 'timeline_events', entity: 'application', event_type: 'offer.signed' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'application.joined' },
  },

  // ── End-to-end (rolls everything up) ──────────────────────────────────
  {
    id: 'applied_to_joined',
    label: 'Applied → Joined (end-to-end)',
    level: 'application',
    description: 'Total candidate journey: from application receipt to actual join.',
    from: { source: 'audit_trail', entity_type: 'application', action_type: 'create' },
    to: { source: 'timeline_events', entity: 'application', event_type: 'application.joined' },
  },
];

export function getPair(id) {
  return TAT_PAIRS.find((p) => p.id === id) || null;
}

// ──────────────────────────────────────────────────────────────────────────
// Resolver: given a TAT pair + entity id, returns the actual two timestamps
// AND the rows used to derive them. The "Show working" modal renders these
// raw rows so users can verify the math.
// ──────────────────────────────────────────────────────────────────────────
async function resolveSide(side, { entityId, entityType, scopeJobId, scopeRequisitionId }) {
  const { source, first } = side;
  const orderDir = first ? 'ASC' : 'DESC';

  if (source === 'column') {
    if (side.via === 'requisition_id' && side.table === 'jobs') {
      const r = await pool.query(
        `SELECT created_at AS ts, id AS row_id, job_id, job_title FROM jobs
          WHERE requisition_id = $1 ORDER BY created_at ${orderDir} LIMIT 1`,
        [entityId]
      );
      return r.rows[0] ? { ts: r.rows[0].ts, row: r.rows[0], source } : { ts: null };
    }
    const tbl = side.table;
    const idCol = tbl === 'jobs' ? 'job_id' : 'id';
    const r = await pool.query(
      `SELECT ${side.column} AS ts, * FROM ${tbl} WHERE ${idCol} = $1 LIMIT 1`,
      [entityId]
    );
    return r.rows[0] ? { ts: r.rows[0].ts, row: r.rows[0], source } : { ts: null };
  }

  if (source === 'audit_trail') {
    const params = [side.entity_type, side.action_type];
    let where = `entity_type = $1 AND action_type = $2`;
    if (side.scope === 'job' && scopeJobId) {
      params.push(scopeJobId);
      where += ` AND (after_state::jsonb)->>'ats_job_id' = $${params.length}`;
    } else if (entityType !== 'job') {
      params.push(String(entityId));
      where += ` AND entity_id::text = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT created_at AS ts, * FROM audit_trail
        WHERE ${where} ORDER BY created_at ${orderDir} LIMIT 1`,
      params
    );
    return r.rows[0] ? { ts: r.rows[0].ts, row: r.rows[0], source } : { ts: null };
  }

  if (source === 'timeline_events') {
    const params = [side.entity, side.event_type];
    let where = `entity_type = $1 AND event_type = $2`;
    if (side.scope === 'job' && scopeJobId) {
      params.push(scopeJobId);
      where += ` AND payload->>'ats_job_id' = $${params.length}`;
    } else {
      params.push(String(entityId));
      where += ` AND entity_id::text = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT occurred_at AS ts, * FROM timeline_events
        WHERE ${where} ORDER BY occurred_at ${orderDir} LIMIT 1`,
      params
    );
    return r.rows[0] ? { ts: r.rows[0].ts, row: r.rows[0], source } : { ts: null };
  }

  return { ts: null };
}

export async function calculateTat(pairId, { entityId, entityType, scopeJobId, scopeRequisitionId }) {
  const pair = getPair(pairId);
  if (!pair) throw new Error(`Unknown TAT pair: ${pairId}`);

  const fromSide = await resolveSide(pair.from, { entityId, entityType, scopeJobId, scopeRequisitionId });
  const toSide = await resolveSide(pair.to, { entityId, entityType, scopeJobId, scopeRequisitionId });

  if (!fromSide.ts || !toSide.ts) {
    return {
      pair_id: pair.id,
      label: pair.label,
      description: pair.description,
      from: fromSide,
      to: toSide,
      duration_seconds: null,
      duration_human: null,
      missing: !fromSide.ts ? 'from' : 'to',
    };
  }

  const fromMs = new Date(fromSide.ts).getTime();
  const toMs = new Date(toSide.ts).getTime();
  const seconds = Math.max(0, Math.floor((toMs - fromMs) / 1000));

  return {
    pair_id: pair.id,
    label: pair.label,
    description: pair.description,
    from: fromSide,
    to: toSide,
    duration_seconds: seconds,
    duration_human: humanDuration(seconds),
  };
}

export function humanDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function listTatPairs(level) {
  return level ? TAT_PAIRS.filter((p) => p.level === level) : TAT_PAIRS;
}
