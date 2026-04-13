import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { requisitionsAPI, usersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
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

function formatDate(value, includeTime = false) {
  if (!value) return '-';
  const parsed = new Date(value);
  return includeTime ? parsed.toLocaleString() : parsed.toLocaleDateString();
}

function formatRequisitionType(value) {
  if (value === 'new_hire') return 'New Hire';
  if (value === 'backfill') return 'Replacement';
  if (value === 'both') return 'New Hire, Replacement';
  return value || '-';
}

function DetailField({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
      <p className="text-sm text-gray-800">{value || '-'}</p>
    </div>
  );
}

export default function RequisitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [requisition, setRequisition] = useState(null);
  const [recruiters, setRecruiters] = useState([]);
  const [selectedRecruiterEmail, setSelectedRecruiterEmail] = useState('');
  const [assigningRecruiter, setAssigningRecruiter] = useState(false);

  useEffect(() => {
    const loadRequisition = async () => {
      setLoading(true);
      try {
        const res = await requisitionsAPI.get(id);
        setRequisition(res.data);
        setSelectedRecruiterEmail(res.data?.assigned_recruiter_email || '');
      } catch {
        toast.error('Failed to load requisition');
        navigate('/requisitions');
      } finally {
        setLoading(false);
      }
    };

    loadRequisition();
  }, [id, navigate]);

  useEffect(() => {
    if (user?.role !== 'hr_admin') return;
    usersAPI.recruiterOptions()
      .then((res) => setRecruiters(res.data?.users || []))
      .catch(() => setRecruiters([]));
  }, [user?.role]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!requisition) {
    return <div className="text-center py-12 text-gray-500">Requisition not found</div>;
  }

  const normalizedUserEmail = String(user?.email || '').trim().toLowerCase();
  const pendingApprovalSteps = Array.isArray(requisition.approval_steps) ? requisition.approval_steps.filter((step) => step.status === 'pending') : [];
  const canApproveAsCxo = requisition.status === 'pending_cxo_approval'
    && pendingApprovalSteps.some((step) => step.approval_stage === 'cxo' && String(step.approver_email || '').trim().toLowerCase() === normalizedUserEmail);
  const canApproveAsAdmin = ['pending_hr_admin_approval', 'pending_approval'].includes(requisition.status) && user?.role === 'hr_admin';
  const canAssignRecruiter = user?.role === 'hr_admin' && requisition.status === 'approved';

  const handleApprove = async () => {
    try {
      await requisitionsAPI.approve(id);
      const refreshed = await requisitionsAPI.get(id);
      setRequisition(refreshed.data);
      setSelectedRecruiterEmail(refreshed.data?.assigned_recruiter_email || '');
      toast.success('Requisition approval recorded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to approve requisition');
    }
  };

  const handleReject = async () => {
    const comments = window.prompt('Add rejection comments (optional):', '');
    if (comments === null) return;
    try {
      await requisitionsAPI.reject(id, { comments });
      const refreshed = await requisitionsAPI.get(id);
      setRequisition(refreshed.data);
      setSelectedRecruiterEmail(refreshed.data?.assigned_recruiter_email || '');
      toast.success('Requisition rejection recorded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reject requisition');
    }
  };

  const handleAssignRecruiter = async () => {
    setAssigningRecruiter(true);
    try {
      const res = await requisitionsAPI.assignRecruiter(id, {
        recruiter_email: selectedRecruiterEmail || null,
      });
      setRequisition(res.data);
      setSelectedRecruiterEmail(res.data?.assigned_recruiter_email || '');
      toast.success(selectedRecruiterEmail ? 'Recruiter assigned' : 'Recruiter assignment cleared');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update recruiter assignment');
    } finally {
      setAssigningRecruiter(false);
    }
  };

  return (
    <div className="mx-auto max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <button
            onClick={() => navigate('/requisitions')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            Back to Requisitions
          </button>
          <h1 className="page-title">{requisition.job_title || 'Requisition Details'}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="font-mono text-sm text-indigo-600">{requisition.requisition_id}</span>
            <span className={`badge ${STATUS_COLORS[requisition.status] || 'bg-gray-100 text-gray-700'}`}>
              {requisition.status?.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
            </span>
          </div>
        </div>
        <button
          onClick={() => navigate(`/requisitions/${requisition.id}/edit`)}
          className="btn-secondary"
        >
          Edit Requisition
        </button>
      </div>

      {canAssignRecruiter && (
        <div className="mb-6 rounded-[28px] border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/70 to-sky-50 p-5 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-[1fr,320px,auto] xl:items-end">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-600">Post Approval Handoff</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-gray-950">Assign the recruiter who is allowed to create the job from this requisition</h2>
              <p className="mt-2 text-sm text-gray-600">
                HR Admin can create the job directly, or nominate a recruiter here. Recruiters will only see approved requisitions assigned to them on the job-creation screen.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Assigned Recruiter</label>
              <select
                value={selectedRecruiterEmail}
                onChange={(event) => setSelectedRecruiterEmail(event.target.value)}
                className="input-field w-full"
              >
                <option value="">Keep with HR Admin</option>
                {recruiters.map((recruiter) => (
                  <option key={recruiter.id || recruiter.email} value={recruiter.email}>
                    {recruiter.name || recruiter.email} ({recruiter.email})
                  </option>
                ))}
              </select>
            </div>
            <button onClick={handleAssignRecruiter} disabled={assigningRecruiter} className="btn-primary disabled:opacity-50">
              {assigningRecruiter ? 'Saving...' : 'Save Assignment'}
            </button>
          </div>
        </div>
      )}

      {(canApproveAsCxo || canApproveAsAdmin) && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm text-indigo-800">
            {canApproveAsCxo ? 'You are the pending CXO approver for this requisition.' : 'This requisition is awaiting HR Admin approval.'}
          </p>
          <button onClick={handleApprove} className="btn-primary">Approve</button>
          <button onClick={handleReject} className="btn-secondary">Reject</button>
        </div>
      )}

      <div className="space-y-6">
        <div className="card">
          <h2 className="section-title mb-4">Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DetailField label="Department" value={requisition.department_name} />
            <DetailField label="Sub-Department" value={requisition.sub_department_name} />
            <DetailField label="Business Unit" value={requisition.bu_name} />
            <DetailField label="Experience" value={requisition.experience_years !== null && requisition.experience_years !== undefined ? `${requisition.experience_years} years` : '-'} />
            <DetailField label="Requisition Type" value={formatRequisitionType(requisition.requisition_type)} />
            <DetailField label="Job Type" value={requisition.job_type} />
            <DetailField label="Priority" value={requisition.priority ? 'Yes' : 'No'} />
            <DetailField label="Total Positions" value={requisition.total_positions} />
          </div>
        </div>

        <div className="card">
          <h2 className="section-title mb-4">Audit & Approval</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DetailField label="Created By" value={requisition.created_by_name || requisition.created_by} />
            <DetailField label="Created At" value={formatDate(requisition.created_at, true)} />
            <DetailField label="Updated By" value={requisition.updated_by_name || requisition.updated_by} />
            <DetailField label="Updated At" value={formatDate(requisition.updated_at, true)} />
            <DetailField label="Approved By" value={requisition.approved_by_name || requisition.approved_by} />
            <DetailField label="Approved At" value={formatDate(requisition.approved_at, true)} />
            <DetailField label="Active Flag" value={requisition.active_flag ? 'Active' : 'Inactive'} />
            <DetailField label="Assigned Recruiter" value={requisition.assigned_recruiter_name ? `${requisition.assigned_recruiter_name} (${requisition.assigned_recruiter_email})` : (requisition.assigned_recruiter_email || 'HR Admin')} />
          </div>
          {Array.isArray(requisition.approval_steps) && requisition.approval_steps.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Approval Route</p>
              <div className="space-y-3">
                {requisition.approval_steps.map((step) => (
                  <div key={step.id} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {step.approver_name || step.approver_email}
                        </p>
                        <p className="text-xs text-gray-500">
                          {step.approval_stage === 'cxo' ? 'CXO approval' : 'HR Admin approval'}{step.approver_email ? ` | ${step.approver_email}` : ''}
                        </p>
                      </div>
                      <span className={`badge ${
                        step.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                        step.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        step.status === 'skipped' ? 'bg-gray-100 text-gray-600' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {step.status}
                      </span>
                    </div>
                    {step.comments && (
                      <p className="mt-2 text-sm text-gray-600">{step.comments}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {requisition.approval_comments && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Approval Comments</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{requisition.approval_comments}</p>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="section-title mb-4">Position Rows</h2>
          <div className="space-y-3">
            {requisition.positions?.length ? requisition.positions.map((position, index) => (
              <div key={position.id || index} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <DetailField label="Type" value={formatRequisitionType(position.position_type)} />
                  <DetailField label="Location" value={position.location_name} />
                  <DetailField label="Phase" value={position.phase_name} />
                  <DetailField label="Positions" value={position.number_of_positions} />
                  <DetailField label="Replacement Employee" value={position.backfill_employee_id ? `${position.backfill_employee_name || '-'} (${position.backfill_employee_id})` : position.backfill_employee_name} />
                  <DetailField label="Replacement Reason" value={position.backfill_reason_name} />
                </div>
              </div>
            )) : (
              <p className="text-sm text-gray-500">No position rows found.</p>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title mb-4">Description & Notes</h2>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Job Description</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-4">
                {requisition.job_description || '-'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Additional Comments</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-4">
                {requisition.additional_comments || '-'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Attachments</p>
              {Array.isArray(requisition.attachments) && requisition.attachments.length > 0 ? (
                <ul className="space-y-2">
                  {requisition.attachments.map((attachment, index) => (
                    <li key={`${attachment}-${index}`} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                      {attachment}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No attachments added.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
