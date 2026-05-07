import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsAPI, mastersAPI } from '../services/api';
import toast from 'react-hot-toast';
import DataTable from '../components/DataTable';
import { PageHeader, SectionCard, StatCard, StatusPill, toneForStatus } from '../components/ui';

const STATUS_KEYS = ['draft', 'open', 'on_hold', 'closed', 'archived'];

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

function statusLabel(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Jobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('');
  const [departments, setDepartments] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);

  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [deptRes, buRes] = await Promise.all([
          mastersAPI.list('departments', { active_only: 'true' }).catch(() => ({ data: [] })),
          mastersAPI.list('business-units', { active_only: 'true' }).catch(() => ({ data: [] })),
        ]);
        setDepartments(extractItems(deptRes.data));
        setBusinessUnits(extractItems(buRes.data));
      } catch { /* ignore */ }
    };
    loadMasters();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20, sort_by: 'created_at', sort_order: 'desc' };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (departmentFilter) params.department_id = departmentFilter;
      if (buFilter) params.business_unit_id = buFilter;
      if (jobTypeFilter) params.job_type = jobTypeFilter;

      const res = await jobsAPI.list(params);
      setJobs(res.data.jobs || []);
      setTotal(res.data.total || 0);
    } catch {
      toast.error('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, departmentFilter, buFilter, jobTypeFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleExport = async () => {
    try {
      const res = await jobsAPI.export({ status: statusFilter || undefined, department_id: departmentFilter || undefined });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'jobs_export.json'; a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleArchive = async (e, job) => {
    e.stopPropagation();
    if (!window.confirm(`Archive job "${job.job_title || job.job_id}"?`)) return;
    try {
      await jobsAPI.delete(job.id);
      toast.success('Job archived');
      loadData();
    } catch {
      toast.error('Failed to archive job');
    }
  };

  const resetFilters = () => {
    setSearch(''); setStatusFilter(''); setDepartmentFilter('');
    setBuFilter(''); setJobTypeFilter(''); setPage(1);
  };

  const hasActiveFilters = search || statusFilter || departmentFilter || buFilter || jobTypeFilter;

  const summary = useMemo(() => ({
    open: jobs.filter(j => j.status === 'open').length,
    onHold: jobs.filter(j => j.status === 'on_hold').length,
    closed: jobs.filter(j => j.status === 'closed').length,
    applications: jobs.reduce((acc, j) => acc + (parseInt(j.application_count, 10) || 0), 0),
  }), [jobs]);

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Jobs' }]}
        title="Jobs"
        subtitle="Post, track, and orchestrate every open role from requisition to offer."
        meta={[{ label: `${total} job${total !== 1 ? 's' : ''}` }]}
        actions={
          <>
            <button className="btn-secondary" onClick={handleExport}>Export</button>
            <button className="btn-primary" onClick={() => navigate('/jobs/create')}>+ Create Job</button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard label="Open" value={summary.open} deltaTone="success" hint="Currently posted and receiving applications." />
        <StatCard label="On hold" value={summary.onHold} deltaTone="warning" hint="Paused - awaiting decision or budget." />
        <StatCard label="Closed" value={summary.closed} hint="Filled or decommissioned roles." />
        <StatCard label="Applications" value={summary.applications} hint="Received across visible jobs." />
      </div>

      <SectionCard title="Filter jobs" subtitle="Narrow the list by status, department, BU, or job type.">
        <div className="flex flex-wrap gap-2.5 items-end">
          <div style={{ flex: 1, minWidth: 200, maxWidth: 260 }}>
            <label className="input-label">Search</label>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Job title or ID…"
              className="input-field"
              style={{ height: 36 }}
            />
          </div>
          <div style={{ minWidth: 150 }}>
            <label className="input-label">Status</label>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }}>
              <option value="">All</option>
              {STATUS_KEYS.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label className="input-label">Department</label>
            <select value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }}>
              <option value="">All</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label className="input-label">Business Unit</label>
            <select value={buFilter} onChange={e => { setBuFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }}>
              <option value="">All</option>
              {businessUnits.map(b => <option key={b.id} value={b.id}>{b.bu_name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="input-label">Job type</label>
            <select value={jobTypeFilter} onChange={e => { setJobTypeFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }}>
              <option value="">All</option>
              <option value="permanent">Permanent</option>
              <option value="internship">Internship</option>
              <option value="contractual">Contractual</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="table-link" style={{ paddingBottom: 8 }}>
              Clear filters
            </button>
          )}
        </div>
      </SectionCard>

      {loading ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 48, display: 'flex', justifyContent: 'center' }}>
          <div className="animate-spin rounded-full h-6 w-6" style={{ borderBottom: '2px solid var(--accent-blue)' }} />
        </div>
      ) : (
        <DataTable
          title="Jobs"
          data={jobs}
          exportFileName="jobs"
          emptyMessage={hasActiveFilters ? 'No jobs match your filters.' : 'No jobs yet. Create your first job to get started.'}
          onRowClick={(row) => navigate(`/jobs/${row.id}`)}
          collapsible
          columns={[
            { key: 'job_id', label: 'Job ID', render: (row) => (
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--accent-blue)' }}>{row.job_id || '-'}</span>
            )},
            { key: 'job_title', label: 'Job Title', render: (row) => (
              <div>
                <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                  {row.priority ? <span style={{ color: 'var(--danger-text)', marginRight: 6 }}>●</span> : null}
                  {row.job_title || '-'}
                </span>
                {(row.bu_name || row.department_name) && (
                  <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    {[row.bu_name, row.location_name, row.department_name].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )},
            { key: 'status', label: 'Status', render: (row) => (
              <StatusPill tone={toneForStatus(row.status)}>{statusLabel(row.status || 'draft')}</StatusPill>
            )},
            { key: 'total_positions', label: 'Positions', render: (row) => (
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                {row.filled_positions != null && row.total_positions != null
                  ? `${row.filled_positions}/${row.total_positions}`
                  : row.total_positions || row.number_of_positions || 0}
              </span>
            )},
            { key: 'recruiter_email', label: 'Recruiter', render: (row) => (
              <span style={{ color: 'var(--text-body)' }}>{row.recruiter_email?.split('@')[0] || '-'}</span>
            )},
            { key: 'application_count', label: 'Applications', render: (row) => (
              <span style={{ fontWeight: 500 }}>{row.application_count ?? '-'}</span>
            )},
            { key: 'created_at', label: 'Posted', render: (row) => (
              <span style={{ color: 'var(--text-faint)' }}>
                {row.created_at ? new Date(row.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
              </span>
            )},
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => navigate(`/jobs/${row.id}`)} className="table-link">View</button>
                <button onClick={() => navigate(`/jobs/${row.id}/edit`)} className="table-link" style={{ color: 'var(--text-body)' }}>Edit</button>
                <button onClick={(e) => handleArchive(e, row)} className="table-link" style={{ color: 'var(--danger-text)' }}>Archive</button>
              </div>
            )},
          ]}
        />
      )}
    </div>
  );
}
