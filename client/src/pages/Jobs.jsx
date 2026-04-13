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
      <div className="table-container">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer select-none" onClick={() => handleSort('job_id')}>
                Job ID <SortIcon field="job_id" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Job Title</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Positions</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Recruiter</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Applications</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer select-none" onClick={() => handleSort('created_at')}>
                Posted <SortIcon field="created_at" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <div className="flex items-center justify-center gap-2 text-gray-400">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                    Loading jobs...
                  </div>
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  No jobs found. {hasActiveFilters ? 'Try adjusting your filters.' : 'Create your first job to get started.'}
                </td>
              </tr>
            ) : jobs.map(job => (
              <tr
                key={job.id}
                className="table-row cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                <td className="px-4 py-3 text-sm font-mono text-indigo-600 font-medium">{job.job_id || '-'}</td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">
                    {job.priority && <span className="text-red-500 mr-1" title="High Priority">&#9679;</span>}
                    {job.job_title || '-'}
                  </div>
                  {(job.bu_name || job.department_name || job.location_name) && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      [job.bu_name, job.location_name, job.phase_name, job.department_name, job.sub_department_name].filter(Boolean).join(' - ')
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-700'}`}>
                    {(job.status || 'draft').replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-center font-semibold text-gray-700">
                  {job.filled_positions != null && job.total_positions != null
                    ? `${job.filled_positions}/${job.total_positions}`
                    : job.total_positions || job.number_of_positions || 0}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{job.recruiter_email?.split('@')[0] || '-'}</td>
                <td className="px-4 py-3 text-sm text-center font-medium text-gray-700">{job.application_count ?? '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {job.created_at ? new Date(job.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      View
                    </button>
                    <button
                      onClick={() => navigate(`/jobs/${job.id}/edit`)}
                      className="text-sm text-gray-600 hover:text-gray-800 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => handleArchive(e, job)}
                      className="text-sm text-red-500 hover:text-red-700 font-medium"
                    >
                      Archive
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, total)} of {total} jobs
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              First
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary disabled:opacity-40"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              if (p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium ${p === page ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary disabled:opacity-40"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
