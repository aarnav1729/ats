// Audit Deck - replaces the old AuditTrail page with an HR-friendly card deck
// view. Each card represents one action: who did it, when (in IST), what
// changed (human prose + diff pills), with technical details collapsed by
// default. Filtered timeline rail per entity is available via "Open thread".

import { useEffect, useMemo, useState } from 'react';
import { auditAPI } from '../services/api';
import { Hero, KPI, fmtIST, relTime, GhostBtn, PrimaryCTA, StatusPillV2, TimelineRail } from '../components/ui/v2';
import toast from 'react-hot-toast';

const ACTION_VERB = {
  login: 'signed in',
  logout: 'signed out',
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  reset_slots: 'reset interview slots for',
  approve: 'approved',
  reject: 'rejected',
  cxo_reject: 'rejected (CXO)',
  hr_reject: 'rejected (HR)',
  blacklist: 'blacklisted',
  unblacklist: 'lifted blacklist for',
  assign_recruiter: 'assigned recruiter on',
  clear_recruiter: 'cleared recruiter from',
  hold: 'placed on hold',
  resume: 'resumed',
  status_transition: 'moved status of',
  schedule: 'scheduled an interview for',
  upload: 'uploaded a document for',
  approve_doc: 'approved a document for',
  reject_doc: 'rejected a document for',
  send_email: 'sent an email regarding',
  move_job: 'moved candidate to another job',
  move_talent_pool: 'moved candidate to talent pool',
};

const ENTITY_LABEL = {
  application: 'Candidate',
  requisition: 'Requisition',
  requisition_approval: 'Requisition approval',
  job: 'Job',
  master: 'Master',
  user: 'User',
  session: 'Session',
  document: 'Document',
  phone: 'Phone',
  interview_feedback: 'Interview feedback',
};

const TONE_FOR_ACTION = {
  reject: 'danger', cxo_reject: 'danger', hr_reject: 'danger',
  blacklist: 'danger', delete: 'danger',
  approve: 'success', resume: 'success', approve_doc: 'success',
  hold: 'warn', reject_doc: 'warn',
  create: 'info', update: 'info',
};

function diffPills(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const skip = new Set(['updated_at', 'created_at', 'id', 'updated_by']);
  const pills = [];
  for (const k of keys) {
    if (skip.has(k)) continue;
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    pills.push({ key: k, before: b, after: a });
  }
  return pills.slice(0, 6);
}

function shortValue(v) {
  if (v == null) return '∅';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}

export default function AuditDeck() {
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [actionType, setActionType] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actor, setActor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [stats, setStats] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {
        page, limit: 30,
        action_type: actionType || undefined,
        entity_type: entityType || undefined,
        action_by: actor || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        field_edited: search || undefined,
      };
      const r = await auditAPI.list(params);
      setEntries(r.data.entries || []);
      setTotalPages(r.data.totalPages || 1);
      setTotal(r.data.total || 0);
    } catch (err) {
      toast.error('Failed to load audit entries');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try { const r = await auditAPI.stats(); setStats(r.data); } catch {}
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, actionType, entityType, actor, dateFrom, dateTo]);
  useEffect(() => { loadStats(); }, []);

  const exportJson = async () => {
    try {
      const r = await auditAPI.export({
        action_type: actionType || undefined,
        entity_type: entityType || undefined,
        action_by: actor || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-export-${Date.now()}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast.error('Export failed'); }
  };

  // Group consecutive actions on the same entity into "threads" for cleaner reading.
  const grouped = useMemo(() => {
    const out = [];
    let curThread = null;
    for (const e of entries) {
      const key = `${e.entity_type}:${e.entity_id}`;
      if (curThread && curThread.key === key && (new Date(curThread.last) - new Date(e.created_at) < 1000 * 60 * 30)) {
        curThread.events.push(e);
        curThread.last = e.created_at;
      } else {
        curThread = { key, entity_type: e.entity_type, entity_id: e.entity_id, events: [e], last: e.created_at };
        out.push(curThread);
      }
    }
    return out;
  }, [entries]);

  return (
    <div className="page-container space-y-5">
      <Hero
        eyebrow="Compliance"
        title="Audit Deck"
        subtitle="Every action ever taken in the ATS, in plain English, with IST timestamps and exact field-level diffs. Group threads make it easy to follow a conversation across an entity."
        actions={(
          <>
            <PrimaryCTA onClick={load}>↻ Refresh</PrimaryCTA>
            <GhostBtn onClick={exportJson}>↓ Export JSON</GhostBtn>
          </>
        )}
      />

      {stats && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KPI eyebrow="Total events" tone="brand" value={stats.total} animationDelay={0} />
            <KPI eyebrow="Today" tone="vibrant" value={stats.today || 0} animationDelay={60} />
            <KPI eyebrow="Last 7 days" tone="success" value={stats.last_7_days || 0} animationDelay={120} />
            <KPI eyebrow="Active actors" tone="warn" value={stats.unique_actors || 0} animationDelay={180} />
          </div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KPI eyebrow="Logins (window)" tone="brand" value={stats.total_logins || 0} animationDelay={0} foot="OTP-verified sessions" />
            <KPI eyebrow="Logins last 24h" tone="vibrant" value={stats.logins_last_24h || 0} animationDelay={60} foot="Daily activity" />
            <KPI eyebrow="Top action" tone="success" value={stats.actions_by_type?.[0]?.action_type || '—'} foot={`${stats.actions_by_type?.[0]?.count || 0} times`} animationDelay={120} />
            <KPI eyebrow="Most active user" tone="warn" value={(stats.actions_by_user?.[0]?.action_by || '—').split('@')[0]} foot={`${stats.actions_by_user?.[0]?.count || 0} actions`} animationDelay={180} />
          </div>
          {/* Login frequency table */}
          {stats.logins_by_user?.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 v2-fade-up">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Login frequency by user</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stats.logins_by_user.slice(0, 9).map((u) => (
                  <div key={u.action_by} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{u.action_by}</p>
                      <p className="text-[11px] text-slate-500 truncate">last: {u.last_login ? fmtIST(u.last_login) : '—'}</p>
                    </div>
                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-800 font-mono">{u.count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Filter bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Action</label>
            <select className="input-field mt-1 w-full" value={actionType} onChange={(e) => { setActionType(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {Object.keys(ACTION_VERB).map((a) => <option key={a} value={a}>{ACTION_VERB[a]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Entity</label>
            <select className="input-field mt-1 w-full" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {Object.keys(ENTITY_LABEL).map((e) => <option key={e} value={e}>{ENTITY_LABEL[e]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Actor email</label>
            <input className="input-field mt-1 w-full" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="user@…" onKeyDown={(e) => e.key === 'Enter' && load()} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">From</label>
            <input type="date" className="input-field mt-1 w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">To</label>
            <input type="date" className="input-field mt-1 w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Field search</label>
            <input className="input-field mt-1 w-full" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="status, ctc…" onKeyDown={(e) => e.key === 'Enter' && load()} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="v2-empty"><div className="v2-empty-icon">⊘</div>
          <p className="text-sm font-medium text-slate-700">No audit events match.</p>
          <p className="mt-1 text-xs text-slate-500">Loosen the filters or pick a wider date range.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((thread) => (
            <ThreadCard key={`${thread.key}-${thread.last}`} thread={thread} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500"><span className="font-semibold text-slate-700">{(page - 1) * 30 + 1}–{Math.min(page * 30, total)}</span> of {total}</p>
          <div className="flex items-center gap-2">
            <GhostBtn onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</GhostBtn>
            <span className="text-xs text-slate-500 px-2">Page {page} / {totalPages}</span>
            <GhostBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next →</GhostBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadCard({ thread }) {
  const [expanded, setExpanded] = useState(false);
  const head = thread.events[0];
  const tone = TONE_FOR_ACTION[head.action_type] || 'info';
  return (
    <div className="v2-card v2-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {ENTITY_LABEL[thread.entity_type] || thread.entity_type}
            </span>
            <span className="text-xs font-semibold text-slate-700">{thread.entity_id}</span>
            <span className="text-xs text-slate-400">· {thread.events.length} {thread.events.length === 1 ? 'action' : 'actions'} in thread</span>
          </div>
          <p className="mt-2 text-[15px] text-slate-900 leading-snug">
            <span className="font-semibold">{head.action_by}</span>{' '}
            <span className="text-slate-700">{ACTION_VERB[head.action_type] || head.action_type}</span>{' '}
            <span className="text-slate-500">{ENTITY_LABEL[head.entity_type]?.toLowerCase() || head.entity_type}</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">{fmtIST(head.created_at)} · {relTime(head.created_at)}</p>
        </div>
      </div>

      {/* Diff pills */}
      <DiffStrip event={head} />

      {expanded && thread.events.length > 1 && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          {thread.events.slice(1).map((e) => (
            <div key={e.id} className="flex items-start gap-3">
              <span className={`mt-1.5 inline-flex h-2 w-2 rounded-full bg-${tone === 'danger' ? 'red' : tone === 'success' ? 'emerald' : tone === 'warn' ? 'amber' : 'indigo'}-400`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{e.action_by}</span>{' '}
                  <span className="text-slate-700">{ACTION_VERB[e.action_type] || e.action_type}</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{fmtIST(e.created_at)}</p>
                <DiffStrip event={e} compact />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        {thread.events.length > 1 ? (
          <button onClick={() => setExpanded(!expanded)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
            {expanded ? '↑ Collapse thread' : `↓ Show ${thread.events.length - 1} earlier action${thread.events.length === 2 ? '' : 's'}`}
          </button>
        ) : <span />}
        <details className="text-right">
          <summary className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer">Technical details</summary>
          <pre className="v2-working mt-2 text-left">{JSON.stringify({ before: head.before_state, after: head.after_state, metadata: head.metadata }, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

function DiffStrip({ event, compact }) {
  const pills = diffPills(event.before_state, event.after_state);
  if (!pills.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'mt-1' : 'mt-3'}`}>
      {pills.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1 text-[11px] font-mono rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
          <span className="text-slate-500">{p.key}:</span>
          <span className="text-rose-600 line-through">{shortValue(p.before)}</span>
          <span className="text-slate-400">→</span>
          <span className="text-emerald-700 font-semibold">{shortValue(p.after)}</span>
        </span>
      ))}
    </div>
  );
}
