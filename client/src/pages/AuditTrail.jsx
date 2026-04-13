import { useState, useEffect, useCallback } from 'react';
import { auditAPI } from '../services/api';
import toast from 'react-hot-toast';

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

export default function AuditTrail() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
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

  useEffect(() => { loadData(); }, [loadData]);

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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Audit Trail</h1>
          <p className="text-sm text-gray-500 mt-1">{total} actions recorded</p>
        </div>
        <button onClick={handleExport} className="btn-secondary">Export</button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {['create', 'update', 'approve', 'reject'].map(type => (
            <div key={type} className="card flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${ACTION_COLORS[type]} flex items-center justify-center text-white font-bold text-lg`}>
                {ACTION_ICONS[type]}
              </div>
              <div>
                <p className="text-xl font-bold">{stats[type] || 0}</p>
                <p className="text-xs text-gray-500 capitalize">{type} actions</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="card">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 mb-3">Top Actors</p>
            <div className="space-y-2">
              {topActors.length === 0 ? <p className="text-sm text-gray-400">No audit activity yet.</p> : topActors.map((actor) => (
                <div key={actor.action_by} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{actor.action_by}</span>
                  <span className="font-semibold text-gray-900">{actor.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 mb-3">Top Entities</p>
            <div className="space-y-2">
              {topEntities.length === 0 ? <p className="text-sm text-gray-400">No entity activity yet.</p> : topEntities.map((entity) => (
                <div key={entity.entity_type} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 capitalize">{formatEntityType(entity.entity_type)}</span>
                  <span className="font-semibold text-gray-900">{entity.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-6">
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
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
        <div className="space-y-4">
          {entries.map((entry, idx) => (
            <div key={entry.id || idx} className="relative pl-14">
              <div className={`absolute left-4 w-5 h-5 rounded-full ${ACTION_COLORS[entry.action_type]} border-2 border-white shadow flex items-center justify-center`}>
                <span className="text-white text-xs font-bold">{ACTION_ICONS[entry.action_type]}</span>
              </div>
              <div className="card !p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">{entry.action_by}</span>
                    <span className={`badge ${ACTION_BADGES[entry.action_type] || ACTION_BADGES.read}`}>
                      {entry.action_type}
                    </span>
                    <span className="text-sm text-gray-500">{formatEntityType(entry.entity_type)}</span>
                    {entry.entity_id && <span className="text-xs text-gray-400">#{entry.entity_id}</span>}
                  </div>
                  <span className="text-xs text-gray-400">{new Date(entry.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-700">{entry.summary || `${entry.action_by} updated ${formatEntityType(entry.entity_type)}`}</p>
                {entry.changed_fields?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.changed_fields.map((field) => (
                      <span key={`${entry.id}-${field}`} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {field}
                      </span>
                    ))}
                  </div>
                )}
                {(entry.changes?.length > 0 || entry.metadata) && (
                  <div className="mt-3 space-y-3">
                    {entry.changes?.slice(0, 6).map((change, changeIndex) => (
                      <div key={`${entry.id}-${change.field}-${changeIndex}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                        <p className="font-medium text-gray-800">{change.field}</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <div className="rounded-lg bg-red-50 px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700">Before</p>
                            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-red-700">{formatValue(change.before)}</pre>
                          </div>
                          <div className="rounded-lg bg-green-50 px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-green-700">After</p>
                            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-green-700">{formatValue(change.after)}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                    {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                      <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Metadata</p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-indigo-800">{formatValue(entry.metadata)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
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
