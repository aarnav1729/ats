import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { requisitionsAPI, mastersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import DataTable from '../components/DataTable';
import { PageHeader, StatCard, SectionCard, StatusPill, toneForStatus } from '../components/ui';
import toast from 'react-hot-toast';

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const STATUS_OPTIONS = [
  'draft', 'pending_approval', 'pending_cxo_approval', 'pending_hr_admin_approval',
  'approved', 'rejected', 'cxo_rejected', 'closed', 'on_hold',
];

const DAY_IN_MS = 86400000;

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
        sort_by: 'created_at', sort_order: 'desc',
      });
      setRequisitions(res.data.requisitions || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      toast.error('Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, deptFilter, buFilter]);

  useEffect(() => { loadData(); }, [loadData]);

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

  const summary = useMemo(() => {
    const pendingStatuses = ['pending_approval', 'pending_cxo_approval', 'pending_hr_admin_approval'];
    const mine = requisitions.filter((item) =>
      normalizeEmail(item.created_by) === normalizeEmail(user?.email) ||
      normalizeEmail(item.assigned_recruiter_email) === normalizeEmail(user?.email)
    ).length;

    return {
      pending: requisitions.filter((item) => pendingStatuses.includes(item.status)).length,
      approved: requisitions.filter((item) => item.status === 'approved').length,
      priority: requisitions.filter((item) => item.priority).length,
      mine,
    };
  }, [requisitions, user?.email]);

  return (
    <div className="page-container space-y-8">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Requisitions' }]}
        title="Hiring Demand"
        subtitle="Review open hiring requests, approval status, ownership, and aging from one operating queue."
        meta={[
          { label: `${total} total` },
          { label: `${summary.pending} pending`, tone: 'warning' },
          { label: `${summary.priority} priority`, tone: 'danger' },
        ]}
        actions={
          <>
            <button className="btn-secondary" onClick={handleExport}>Export</button>
            <button className="btn-primary" onClick={() => navigate('/requisitions/create')}>+ Create Requisition</button>
          </>
        }
      />

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 16 }}>
        <StatCard label="Total demand" value={total} hint="All requisitions matching the current view." />
        <StatCard label="Approved" value={summary.approved} deltaTone="success" hint="Ready to convert or already converted." />
        <StatCard label="Priority roles" value={summary.priority} deltaTone="warning" hint="High-priority demand requiring faster coordination." />
        <StatCard label="Your queue" value={summary.mine} hint="Created by you or assigned to your pipeline." />
      </div>

      <SectionCard
        title="Filter the queue"
        subtitle="Refine requisitions by demand shape, owner, or approval status."
      >
        <div className="flex flex-wrap gap-2.5">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search ID or title…"
            className="input-field"
            style={{ maxWidth: 240, height: 36 }}
          />
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-field"
            style={{ maxWidth: 200, height: 36 }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select
            value={deptFilter}
            onChange={e => { setDeptFilter(e.target.value); setPage(1); }}
            className="input-field"
            style={{ maxWidth: 200, height: 36 }}
          >
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
          </select>
          <select
            value={buFilter}
            onChange={e => { setBuFilter(e.target.value); setPage(1); }}
            className="input-field"
            style={{ maxWidth: 200, height: 36 }}
          >
            <option value="">All business units</option>
            {businessUnits.map(b => <option key={b.id} value={b.id}>{b.bu_name}</option>)}
          </select>
        </div>
      </SectionCard>

      {loading ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 48, display: 'flex', justifyContent: 'center' }}>
          <div className="animate-spin rounded-full h-6 w-6" style={{ borderBottom: '2px solid var(--accent-blue)' }} />
        </div>
      ) : (
        <DataTable
          title="Open demand queue"
          subtitle="Inspect approvals, recruiters, aging, and next actions without leaving the list view."
          data={requisitions}
          exportFileName="requisitions"
          emptyMessage="No requisitions found"
          onRowClick={(row) => navigate(`/requisitions/${row.id}`)}
          columns={[
            { key: 'requisition_id', label: 'Req ID', render: (row) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--accent-blue)' }}>{row.requisition_id}</span> },
            { key: 'job_title', label: 'Job Title', render: (row) => (
              <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                {row.priority ? <span style={{ color: 'var(--danger-text)', marginRight: 6 }}>●</span> : null}
                {row.job_title || '-'}
              </span>
            )},
            { key: 'department_name', label: 'Department' },
            { key: 'bu_name', label: 'BU' },
            { key: 'requisition_type', label: 'Type', render: (row) => (
              <StatusPill tone="info">
                {row.requisition_type === 'new_hire' ? 'New Hire'
                  : row.requisition_type === 'backfill' ? 'Replacement'
                  : row.requisition_type === 'both' ? 'New + Replace' : '-'}
              </StatusPill>
            )},
            { key: 'total_positions', label: 'Positions', render: (row) => <span style={{ fontWeight: 600 }}>{row.total_positions || 0}</span> },
            ...(showRecruitmentMetrics ? [{ key: 'created_at_age', label: 'Age', render: (row) => formatTimeSinceRaised(row.created_at) }] : []),
            { key: 'status', label: 'Status', render: (row) => (
              <div className="space-y-1">
                <StatusPill tone={toneForStatus(row.status)}>{statusLabel(row.status)}</StatusPill>
                {row.pending_approver_emails?.length > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>Pending: {row.pending_approver_emails.length}</p>
                )}
              </div>
            )},
            { key: 'assigned_recruiter_email', label: 'Recruiter', render: (row) => (
              <span style={{ color: 'var(--text-body)' }}>{row.assigned_recruiter_name || row.assigned_recruiter_email || '-'}</span>
            )},
            { key: 'created_by', label: 'Created By', render: (row) => (
              <span style={{ color: 'var(--text-faint)' }}>{row.created_by?.split('@')[0]}</span>
            )},
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => navigate(`/requisitions/${row.id}/edit`)} className="table-link">Edit</button>
                {row.status === 'pending_cxo_approval' && row.pending_approver_emails?.map(normalizeEmail).includes(normalizeEmail(user?.email)) && (
                  <>
                    <button onClick={() => handleApprove(row)} className="table-link" style={{ color: 'var(--success-text)' }}>Approve</button>
                    <button onClick={() => handleReject(row)} className="table-link" style={{ color: 'var(--warning-text)' }}>Reject</button>
                  </>
                )}
                {user?.role === 'hr_admin' && ['pending_hr_admin_approval', 'pending_approval'].includes(row.status) && (
                  <>
                    <button onClick={() => handleApprove(row)} className="table-link" style={{ color: 'var(--success-text)' }}>Approve</button>
                    <button onClick={() => handleReject(row)} className="table-link" style={{ color: 'var(--warning-text)' }}>Reject</button>
                  </>
                )}
                {user?.role === 'hr_admin' && (
                  <button onClick={() => handleDelete(row.id)} className="table-link" style={{ color: 'var(--danger-text)' }}>Delete</button>
                )}
              </div>
            )},
          ]}
        />
      )}
    </div>
  );
}
