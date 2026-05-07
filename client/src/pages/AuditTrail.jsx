import { useState, useEffect, useCallback } from 'react';
import { auditAPI } from '../services/api';
import toast from 'react-hot-toast';
import { PageHeader, StatCard, SectionCard } from '../components/ui';

// Format seconds to human readable duration
function fmtDuration(secs) {
  if (!secs || secs <= 0) return '-';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// Format IST date for display
function fmtIST(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// HR-friendly field labels (override machine names where needed)
const FIELD_LABEL = {
  status: 'Status',
  assigned_recruiter_email: 'Assigned recruiter',
  secondary_recruiter_email: 'Secondary recruiter',
  recruiter_email: 'Recruiter',
  job_title: 'Job title',
  total_positions: 'Positions',
  current_approval_stage: 'Approval stage',
  approved_at: 'Approved at',
  approved_by: 'Approved by',
  dropout_reason: 'Dropout reason',
  rejection_reason: 'Rejection reason',
  hr_action: 'HR decision',
  cxo_action: 'CXO decision',
  joining_date: 'Joining date',
  ban_scope: 'Ban scope',
  banned_flag: 'Banned',
};
const ACTION_VERB = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  approve: 'approved',
  reject: 'rejected',
  reminder: 'sent a reminder on',
  message: 'messaged',
  schedule: 'scheduled',
  upload: 'uploaded a file for',
  read: 'viewed',
};
function prettyValue(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') {
    try {
      const keys = Object.keys(val);
      if (keys.length <= 3) return keys.map((k) => `${k}: ${prettyValue(val[k])}`).join(', ');
      return `${keys.length} fields`;
    } catch { return ''; }
  }
  const s = String(val);
  if (s.length > 120) return `${s.slice(0, 117)}…`;
  return s;
}
function prettyField(key) {
  if (!key) return '';
  if (FIELD_LABEL[key]) return FIELD_LABEL[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function sentenceFor(entry) {
  const verb = ACTION_VERB[entry.action_type] || entry.action_type;
  const entity = String(entry.entity_type || '').replace(/_/g, ' ');
  const id = entry.entity_id ? ` #${entry.entity_id}` : '';
  return `${entry.action_by} ${verb} ${entity}${id}`;
}

const ACTION_TONES = {
  create: 'success', update: 'info', delete: 'danger', read: 'neutral',
  approve: 'success', reject: 'warning', reminder: 'purple', schedule: 'info',
};

const ACTION_COLORS = { create: 'bg-emerald-500', update: 'bg-blue-500', delete: 'bg-red-500', read: 'bg-gray-400', approve: 'bg-emerald-600', reject: 'bg-amber-500', reminder: 'bg-violet-500', schedule: 'bg-indigo-500' };
const ACTION_ICONS = { create: '+', update: '~', delete: '\u00d7', read: '\u25cb', approve: 'A', reject: 'R', reminder: '!', schedule: 'S' };
const ACTION_BADGES = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  read: 'bg-gray-100 text-gray-700',
  approve: 'bg-emerald-100 text-emerald-800',
  reject: 'bg-amber-100 text-amber-800',
  reminder: 'bg-violet-100 text-violet-800',
  schedule: 'bg-indigo-100 text-indigo-800',
};
const ENTITY_TYPES = ['user', 'session', 'business_unit', 'location', 'phase', 'department', 'sub_department', 'grade', 'level', 'designation', 'rejection_reason', 'backfill_reason', 'offer_dropout_reason', 'aop', 'requisition', 'job', 'application', 'interview_feedback', 'candidate_document'];

function formatEntityType(value) {
  return String(value || '')
    .replace('backfill_reason', 'replacement_reason')
    .replace(/_/g, ' ');
}

function AuditRow({ entry }) {
  const [showTech, setShowTech] = useState(false);
  const verb = ACTION_VERB[entry.action_type] || entry.action_type;
  const whenText = new Date(entry.created_at).toLocaleString();
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const hasTech = changes.length > 0 || (entry.metadata && Object.keys(entry.metadata).length > 0);
  const headline = entry.summary || sentenceFor(entry);

  // Build human-readable sentences from changes
  const humanLines = changes.slice(0, 6).map((change) => {
    const field = prettyField(change.field);
    const before = prettyValue(change.before);
    const after = prettyValue(change.after);
    if (change.before == null || change.before === '') return `Set ${field} to ${after}`;
    return `Changed ${field} from ${before} to ${after}`;
  });

  return (
    <div className="relative pl-14">
      <div
        className={`absolute left-4 w-5 h-5 rounded-full ${ACTION_COLORS[entry.action_type] || 'bg-gray-400'} border-2 border-white shadow flex items-center justify-center`}
      >
        <span className="text-white text-xs font-bold">{ACTION_ICONS[entry.action_type] || '·'}</span>
      </div>
      <div className="card !p-4">
        <div className="flex items-start justify-between gap-3 mb-1" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>
              <span style={{ color: 'var(--accent-blue)' }}>{entry.action_by}</span>{' '}
              <span style={{ color: 'var(--text-body)', fontWeight: 500 }}>{verb}</span>{' '}
              <span style={{ color: 'var(--text-body)', fontWeight: 500, textTransform: 'capitalize' }}>
                {formatEntityType(entry.entity_type)}
              </span>
              {entry.entity_id && (
                <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}> · #{entry.entity_id}</span>
              )}
            </p>
            {headline && headline !== sentenceFor(entry) && (
              <p style={{ fontSize: 13, color: 'var(--text-body)', marginTop: 4 }}>{headline}</p>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{whenText}</span>
        </div>

        {humanLines.length > 0 && (
          <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {humanLines.map((line, i) => (
              <li
                key={i}
                style={{
                  fontSize: 13,
                  color: 'var(--text-body)',
                  padding: '6px 10px',
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--line-subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {line}
              </li>
            ))}
            {changes.length > humanLines.length && (
              <li style={{ fontSize: 12, color: 'var(--text-faint)', paddingLeft: 10 }}>
                +{changes.length - humanLines.length} more change{changes.length - humanLines.length === 1 ? '' : 's'}
              </li>
            )}
          </ul>
        )}

        {hasTech && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setShowTech((v) => !v)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-faint)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {showTech ? 'Hide technical details' : 'Show technical details'}
            </button>
            {showTech && (
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                {changes.map((change, i) => (
                  <div
                    key={i}
                    style={{
                      border: '1px solid var(--line-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 8,
                      background: 'var(--surface)',
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 4 }}>
                      {change.field}
                    </p>
                    <pre style={{ fontSize: 11, color: 'var(--text-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                      Before: {JSON.stringify(change.before, null, 2)}
                      {'\n'}
                      After: {JSON.stringify(change.after, null, 2)}
                    </pre>
                  </div>
                ))}
                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <pre style={{ fontSize: 11, color: 'var(--text-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: 8, background: 'var(--surface-muted)', borderRadius: 'var(--radius-sm)' }}>
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditTrail() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [loginActivity, setLoginActivity] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [filters, setFilters] = useState({ action_by: '', action_type: '', entity_type: '', date_from: '', date_to: '', field_edited: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 30 };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const [res, statsRes] = await Promise.all([
        auditAPI.list(params),
        page === 1 ? auditAPI.stats() : Promise.resolve(null),
      ]);
      if (page === 1) setEntries(res.data.entries || []);
      else setEntries(prev => [...prev, ...(res.data.entries || [])]);
      setTotal(res.data.total || 0);
      if (statsRes) setStats(statsRes.data);
    } catch {
      toast.error('Failed to load audit trail');
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  const loadLoginActivity = useCallback(async () => {
    setLoginLoading(true);
    try {
      const res = await auditAPI.loginActivity();
      setLoginActivity(res.data);
    } catch {
      toast.error('Failed to load login activity');
    } finally {
      setLoginLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadLoginActivity(); }, [loadLoginActivity]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await auditAPI.export(params);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit-trail.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported');
    } catch {
      toast.error('Export failed');
    }
  };

  const formatValue = (val) => {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'string') {
      try {
        return JSON.stringify(JSON.parse(val), null, 2);
      } catch {
        return val;
      }
    }
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  };

  const topActors = stats?.actions_by_user?.slice(0, 3) || [];
  const topEntities = stats?.actions_by_entity?.slice(0, 3) || [];

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Audit Trail' }]}
        title="Audit Trail"
        subtitle="Every state change, approval, and admin action - searchable by actor, entity, or field."
        meta={[{ label: `${total} actions` }]}
        actions={<button onClick={handleExport} className="btn-secondary">Export</button>}
      />

      {stats && (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))' }}>
          {['create', 'update', 'approve', 'reject'].map(type => (
            <StatCard
              key={type}
              label={`${type.charAt(0).toUpperCase()}${type.slice(1)} actions`}
              value={stats[type] || 0}
              deltaTone={ACTION_TONES[type]}
            />
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SectionCard title="Top Actors">
            <div className="space-y-2">
              {topActors.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No audit activity yet.</p>
              ) : topActors.map((actor) => (
                <div key={actor.action_by} className="flex items-center justify-between" style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--text-body)' }}>{actor.action_by}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{actor.count}</span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Top Entities">
            <div className="space-y-2">
              {topEntities.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No entity activity yet.</p>
              ) : topEntities.map((entity) => (
                <div key={entity.entity_type} className="flex items-center justify-between" style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--text-body)', textTransform: 'capitalize' }}>{formatEntityType(entity.entity_type)}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{entity.count}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Login Activity Stats */}
      {loginActivity && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SectionCard title="Most Common Actions (Top 10)">
              <div className="space-y-2">
                {(stats?.most_common_actions || []).length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No action data yet.</p>
                ) : (
                  stats.most_common_actions.map((a, i) => (
                    <div key={a.action_type} className="flex items-center justify-between" style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-body)' }}>
                        <span style={{ color: 'var(--text-faint)', marginRight: 8 }}>#{i + 1}</span>
                        {a.action_type}
                      </span>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{a.count}</span>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
            <SectionCard title="Session Duration (Avg per User)">
              <div className="space-y-2">
                {(stats?.session_stats || []).length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No session data yet.</p>
                ) : (
                  stats.session_stats.slice(0, 8).map((s) => (
                    <div key={s.action_by} className="flex items-center justify-between" style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-body)' }}>{s.action_by}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{fmtDuration(s.avg_duration_secs)}</span>
                    </div>
                  ))
                )}
                {stats?.avg_session_duration_secs > 0 && (
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-2" style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Overall Average</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{fmtDuration(stats.avg_session_duration_secs)}</span>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Login Activity - Last 30 Days">
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-faint)', fontWeight: 600 }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-faint)', fontWeight: 600 }}>Email</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-faint)', fontWeight: 600 }}>Role</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-faint)', fontWeight: 600 }}>Last Login</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-faint)', fontWeight: 600 }}>Total Logins</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-faint)', fontWeight: 600 }}>Actions Today</th>
                  </tr>
                </thead>
                <tbody>
                  {loginActivity.users.map((u) => (
                    <tr key={u.email} style={{ borderBottom: '1px solid var(--line-subtle)' }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-main)', fontWeight: 500 }}>{u.name || '-'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-body)' }}>{u.email}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-body)' }}>{u.role || '-'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-body)' }}>{u.last_login ? fmtIST(u.last_login) : '-'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-main)', fontWeight: 600, textAlign: 'right' }}>{u.total_logins}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-main)', fontWeight: 600, textAlign: 'right' }}>{u.actions_today}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* DAU chart - last 14 days */}
          <SectionCard title="Daily Active Users (Last 14 Days)">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, marginTop: 8 }}>
              {(stats?.dau_logins || []).slice(0, 14).reverse().map((d) => {
                const maxUsers = Math.max(...(stats?.dau_logins || []).map(r => Number(r.users)), 1);
                const heightPct = (Number(d.users) / maxUsers) * 100;
                return (
                  <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', background: 'var(--accent-blue)', borderRadius: 3, height: `${heightPct}%`, minHeight: 4 }} title={`${d.users} users`} />
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{String(d.day).slice(5, 10)}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </>
      )}

      <SectionCard title="Filters">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <input
            type="text"
            value={filters.action_by}
            onChange={e => handleFilterChange('action_by', e.target.value)}
            placeholder="Action by..."
            className="input-field"
          />
          <select value={filters.action_type} onChange={e => handleFilterChange('action_type', e.target.value)} className="input-field">
            <option value="">All Types</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="read">Read</option>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
            <option value="reminder">Reminder</option>
            <option value="schedule">Schedule</option>
          </select>
          <select value={filters.entity_type} onChange={e => handleFilterChange('entity_type', e.target.value)} className="input-field">
            <option value="">All Entities</option>
            {ENTITY_TYPES.map(e => <option key={e} value={e}>{formatEntityType(e)}</option>)}
          </select>
          <input type="date" value={filters.date_from} onChange={e => handleFilterChange('date_from', e.target.value)} className="input-field" />
          <input type="date" value={filters.date_to} onChange={e => handleFilterChange('date_to', e.target.value)} className="input-field" />
          <input
            type="text"
            value={filters.field_edited}
            onChange={e => handleFilterChange('field_edited', e.target.value)}
            placeholder="Field edited..."
            className="input-field"
          />
        </div>
      </SectionCard>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
        <div className="space-y-4">
          {entries.map((entry, idx) => (
            <AuditRow key={entry.id || idx} entry={entry} />
          ))}
        </div>
      </div>

      {entries.length < total && (
        <div className="text-center mt-6">
          <button onClick={() => setPage(p => p + 1)} disabled={loading} className="btn-secondary disabled:opacity-50">
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {entries.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">No audit entries found</div>
      )}
    </div>
  );
}
