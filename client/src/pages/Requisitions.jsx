import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { requisitionsAPI, mastersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import DataTable from '../components/DataTable';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  pending_cxo_approval: 'bg-fuchsia-100 text-fuchsia-700',
  pending_hr_admin_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cxo_rejected: 'bg-rose-100 text-rose-700',
  closed: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-purple-100 text-purple-700',
};

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const DAY_IN_MS = 86400000;

function formatDate(value) {
  const parsed = value ? new Date(value) : null;
  return parsed ? parsed.toLocaleDateString() : '-';
}

function formatTimeSinceRaised(value) {
  if (!value) return '-';
  const diff = Math.floor((Date.now() - new Date(value).getTime()) / DAY_IN_MS);
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function statusLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function Requisitions() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [requisitions, setRequisitions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [departments, setDepartments] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const showRecruitmentMetrics = user?.role === 'hr_admin' || user?.role === 'hr_recruiter';

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const [dRes, bRes] = await Promise.all([
          mastersAPI.list('departments', { active_only: 'true' }),
          mastersAPI.list('business-units', { active_only: 'true' }),
        ]);
        setDepartments(extractItems(dRes.data));
        setBusinessUnits(extractItems(bRes.data));
      } catch {
        toast.error('Failed to load requisition filters');
      }
    };

    loadFilters();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await requisitionsAPI.list({
        page, limit: 20, search: search || undefined, status: statusFilter || undefined,
        department_id: deptFilter || undefined, business_unit_id: buFilter || undefined,
        sort_by: sortBy, sort_order: sortOrder,
      });
      setRequisitions(res.data.requisitions || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      toast.error('Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, deptFilter, buFilter, sortBy, sortOrder]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortOrder('asc'); }
  };

  const handleExport = async () => {
    try {
      const res = await requisitionsAPI.export({ status: statusFilter || undefined });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'requisitions.json'; a.click();
      toast.success('Exported');
    } catch { toast.error('Export failed'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this requisition?')) return;
    try { await requisitionsAPI.delete(id); toast.success('Deleted'); loadData(); }
    catch { toast.error('Failed to delete'); }
  };

  const handleApprove = async (req) => {
    try {
      await requisitionsAPI.approve(req.id);
      toast.success(`Requisition ${req.requisition_id} approved`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to approve requisition');
    }
  };

  const handleReject = async (req) => {
    const comments = window.prompt(`Add rejection comments for ${req.requisition_id} (optional):`, req.approval_comments || '');
    if (comments === null) return;
    try {
      await requisitionsAPI.reject(req.id, { comments });
      toast.success(`Requisition ${req.requisition_id} rejected`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reject requisition');
    }
  };

  const totalPages = Math.ceil(total / 20);
  const SortIcon = ({ field }) => sortBy === field ? <span className="ml-1">{sortOrder === 'asc' ? '\u2191' : '\u2193'}</span> : null;
  const columnCount = showRecruitmentMetrics ? 11 : 10;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Requisitions</h1>
          <p className="text-sm text-gray-500 mt-1">{total} requisitions total</p>
        </div>
        <button onClick={() => navigate('/requisitions/create')} className="btn-primary">+ Create New Requisition</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search ID or title..." className="input-field max-w-[200px]" />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input-field max-w-[180px]">
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <select value={deptFilter} onChange={e => { setDeptFilter(e.target.value); setPage(1); }} className="input-field max-w-[180px]">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
        </select>
        <select value={buFilter} onChange={e => { setBuFilter(e.target.value); setPage(1); }} className="input-field max-w-[180px]">
          <option value="">All Business Units</option>
          {businessUnits.map(b => <option key={b.id} value={b.id}>{b.bu_name}</option>)}
        </select>
        <button onClick={handleExport} className="btn-secondary">Export</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" /></div>
      ) : (
        <DataTable
          title="Requisitions"
          data={requisitions}
          exportFileName="requisitions"
          emptyMessage="No requisitions found"
          onRowClick={(row) => navigate(`/requisitions/${row.id}`)}
          columns={[
            { key: 'requisition_id', label: 'Req ID', render: (row) => <span className="font-mono text-indigo-600 font-medium">{row.requisition_id}</span> },
            { key: 'job_title', label: 'Job Title', render: (row) => <span className="font-medium">{row.priority ? <span className="text-red-500 mr-1">{'\u25CF'}</span> : null}{row.job_title || '-'}</span> },
            { key: 'department_name', label: 'Department' },
            { key: 'bu_name', label: 'BU' },
            { key: 'requisition_type', label: 'Type', render: (row) => <span className="badge bg-indigo-100 text-indigo-700">{row.requisition_type === 'new_hire' ? 'New Hire' : row.requisition_type === 'backfill' ? 'Replacement' : row.requisition_type === 'both' ? 'New + Replace' : '-'}</span> },
            { key: 'total_positions', label: 'Positions', render: (row) => <span className="font-semibold">{row.total_positions || 0}</span> },
            ...(showRecruitmentMetrics ? [{ key: 'created_at_age', label: 'Age', render: (row) => formatTimeSinceRaised(row.created_at) }] : []),
            { key: 'status', label: 'Status', render: (row) => (
              <div className="space-y-1">
                <span className={`badge ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700'}`}>{statusLabel(row.status)}</span>
                {row.pending_approver_emails?.length > 0 && <p className="text-[11px] text-gray-500">Pending: {row.pending_approver_emails.length}</p>}
              </div>
            )},
            { key: 'assigned_recruiter_email', label: 'Recruiter', render: (row) => <span className="text-gray-600">{row.assigned_recruiter_name ? `${row.assigned_recruiter_name}` : row.assigned_recruiter_email || '-'}</span> },
            { key: 'created_by', label: 'Created By', render: (row) => <span className="text-gray-500">{row.created_by?.split('@')[0]}</span> },
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => navigate(`/requisitions/${row.id}/edit`)} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                {row.status === 'pending_cxo_approval' && row.pending_approver_emails?.map(normalizeEmail).includes(normalizeEmail(user?.email)) && (
                  <>
                    <button onClick={() => handleApprove(row)} className="text-sm text-emerald-600 font-medium">Approve</button>
                    <button onClick={() => handleReject(row)} className="text-sm text-amber-600 font-medium">Reject</button>
                  </>
                )}
                {user?.role === 'hr_admin' && ['pending_hr_admin_approval', 'pending_approval'].includes(row.status) && (
                  <>
                    <button onClick={() => handleApprove(row)} className="text-sm text-emerald-600 font-medium">Approve</button>
                    <button onClick={() => handleReject(row)} className="text-sm text-amber-600 font-medium">Reject</button>
                  </>
                )}
                {user?.role === 'hr_admin' && <button onClick={() => handleDelete(row.id)} className="text-sm text-red-600 font-medium">Delete</button>}
              </div>
            )},
          ]}
        />
      )}
    </div>
  );
}
