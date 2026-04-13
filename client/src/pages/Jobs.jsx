import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsAPI, mastersAPI } from '../services/api';
import toast from 'react-hot-toast';
import DataTable from '../components/DataTable';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-emerald-100 text-emerald-700',
  on_hold: 'bg-amber-100 text-amber-700',
  closed: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-200 text-gray-500',
};

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

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
  const [recruiterFilter, setRecruiterFilter] = useState('');
  const [jobTypeFilter, setJobTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
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
      const params = {
        page,
        limit: 20,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (departmentFilter) params.department_id = departmentFilter;
      if (buFilter) params.business_unit_id = buFilter;
      if (recruiterFilter) params.recruiter_email = recruiterFilter;
      if (jobTypeFilter) params.job_type = jobTypeFilter;

      const res = await jobsAPI.list(params);
      setJobs(res.data.jobs || []);
      setTotal(res.data.total || 0);
    } catch {
      toast.error('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, departmentFilter, buFilter, recruiterFilter, jobTypeFilter, sortBy, sortOrder]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortOrder('asc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">&#8597;</span>;
    return <span className="text-indigo-600 ml-1">{sortOrder === 'asc' ? '&#8593;' : '&#8595;'}</span>;
  };

  const handleExport = async () => {
    try {
      const res = await jobsAPI.export({ status: statusFilter || undefined, department_id: departmentFilter || undefined });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jobs_export.json';
      a.click();
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
    setSearch('');
    setStatusFilter('');
    setDepartmentFilter('');
    setBuFilter('');
    setRecruiterFilter('');
    setJobTypeFilter('');
    setPage(1);
  };

  const totalPages = Math.ceil(total / 20);
  const hasActiveFilters = search || statusFilter || departmentFilter || buFilter || recruiterFilter || jobTypeFilter;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="text-sm text-gray-500 mt-1">{total} job{total !== 1 ? 's' : ''} total</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExport} className="btn-secondary">
            <svg className="w-4 h-4 mr-1.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Export
          </button>
          <button onClick={() => navigate('/jobs/create')} className="btn-primary">
            + Create New Job
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px] max-w-[240px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Job title, ID..."
              className="input-field w-full"
            />
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input-field w-full">
              <option value="">All Statuses</option>
              {Object.keys(STATUS_COLORS).map(s => (
                <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
            <select value={departmentFilter} onChange={e => { setDepartmentFilter(e.target.value); setPage(1); }} className="input-field w-full">
              <option value="">All Departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
            </select>
          </div>
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Business Unit</label>
            <select value={buFilter} onChange={e => { setBuFilter(e.target.value); setPage(1); }} className="input-field w-full">
              <option value="">All BUs</option>
              {businessUnits.map(b => <option key={b.id} value={b.id}>{b.bu_name}</option>)}
            </select>
          </div>
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Job Type</label>
            <select value={jobTypeFilter} onChange={e => { setJobTypeFilter(e.target.value); setPage(1); }} className="input-field w-full">
              <option value="">All Types</option>
              <option value="permanent">Permanent</option>
              <option value="internship">Internship</option>
              <option value="contractual">Contractual</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium pb-0.5">
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
        </div>
      ) : (
        <DataTable
          title="Jobs"
          data={jobs}
          exportFileName="jobs"
          emptyMessage={hasActiveFilters ? 'No jobs match your filters.' : 'No jobs yet. Create your first job to get started.'}
          onRowClick={(row) => navigate(`/jobs/${row.id}`)}
          columns={[
            { key: 'job_id', label: 'Job ID', render: (row) => <span className="font-mono text-indigo-600 font-medium">{row.job_id || '-'}</span> },
            { key: 'job_title', label: 'Job Title', render: (row) => (
              <div>
                <span className="font-medium text-gray-900">{row.priority ? <span className="text-red-500 mr-1">&#9679;</span> : null}{row.job_title || '-'}</span>
                {(row.bu_name || row.department_name) && <p className="text-xs text-gray-400 mt-0.5">{[row.bu_name, row.location_name, row.department_name].filter(Boolean).join(' · ')}</p>}
              </div>
            )},
            { key: 'status', label: 'Status', render: (row) => (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700'}`}>
                {(row.status || 'draft').replace('_', ' ')}
              </span>
            )},
            { key: 'total_positions', label: 'Positions', render: (row) => (
              <span className="font-semibold text-gray-700">
                {row.filled_positions != null && row.total_positions != null ? `${row.filled_positions}/${row.total_positions}` : row.total_positions || row.number_of_positions || 0}
              </span>
            )},
            { key: 'recruiter_email', label: 'Recruiter', render: (row) => <span className="text-gray-600">{row.recruiter_email?.split('@')[0] || '-'}</span> },
            { key: 'application_count', label: 'Applications', render: (row) => <span className="font-medium">{row.application_count ?? '-'}</span> },
            { key: 'created_at', label: 'Posted', render: (row) => <span className="text-gray-500">{row.created_at ? new Date(row.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</span> },
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => navigate(`/jobs/${row.id}`)} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">View</button>
                <button onClick={() => navigate(`/jobs/${row.id}/edit`)} className="text-sm text-gray-600 hover:text-gray-800 font-medium">Edit</button>
                <button onClick={(e) => handleArchive(e, row)} className="text-sm text-red-500 hover:text-red-700 font-medium">Archive</button>
              </div>
            )},
          ]}
        />
      )}
    </div>
  );
}
