import { useEffect, useMemo, useState } from 'react';
import { orgAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import AppModal from '../components/AppModal';

function parseScope(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toScopeString(value) {
  return parseScope(value).join(', ');
}

const EMPTY_FORM = {
  employee_id: '',
  employee_name: '',
  employee_email: '',
  designation: '',
  department_name: '',
  sub_department_name: '',
  location_name: '',
  manager_id: '',
  department_scope: '',
  sub_department_scope: '',
  business_unit_scope: '',
  approval_order: '1',
  notes: '',
  active_flag: true,
};

function CxoModal({ open, onClose, onSave, loading, form, setForm, searchQuery, setSearchQuery, searchResults, canEdit }) {
  if (!open) return null;

  const handleSpotPick = (employee) => {
    setForm((prev) => ({
      ...prev,
      employee_id: employee.employee_id || '',
      employee_name: employee.employee_name || '',
      employee_email: employee.employee_email || '',
      designation: employee.designation || '',
      department_name: employee.department_name || '',
      sub_department_name: employee.sub_department_name || '',
      location_name: employee.location_name || '',
      manager_id: employee.manager_id || '',
      department_scope: prev.department_scope || employee.department_name || '',
      sub_department_scope: prev.sub_department_scope || '',
    }));
    setSearchQuery(employee.employee_name || '');
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="CXO Directory Entry"
      subtitle="Pick an employee from SPOT EMP to auto-fill the approval owner details and then refine the approval scope."
      width="wide"
      footer={(
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          {canEdit && (
            <button onClick={onSave} disabled={loading} className="btn-primary disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Entry'}
            </button>
          )}
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search SPOT employee</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field w-full"
              placeholder="Search by employee name, id, or email"
              disabled={!canEdit}
            />
            {searchResults.length > 0 && canEdit && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white">
                {searchResults.map((employee) => (
                  <button
                    type="button"
                    key={employee.employee_id}
                    onClick={() => handleSpotPick(employee)}
                    className="block w-full border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-indigo-50"
                  >
                    <p className="text-sm font-medium text-gray-900">{employee.employee_name}</p>
                    <p className="text-xs text-gray-500">
                      {employee.employee_id} | {employee.designation || 'No designation'} | {employee.department_name || 'No department'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {[
            ['Employee ID', 'employee_id'],
            ['Employee Name', 'employee_name'],
            ['Employee Email', 'employee_email'],
            ['Designation', 'designation'],
            ['Department', 'department_name'],
            ['Sub Department', 'sub_department_name'],
            ['Location', 'location_name'],
            ['Manager ID', 'manager_id'],
          ].map(([label, key]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                type="text"
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="input-field w-full"
                disabled={!canEdit}
              />
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department Scope</label>
            <input
              type="text"
              value={form.department_scope}
              onChange={(e) => setForm((prev) => ({ ...prev, department_scope: e.target.value }))}
              className="input-field w-full"
              placeholder="Comma-separated department names"
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sub Department Scope</label>
            <input
              type="text"
              value={form.sub_department_scope}
              onChange={(e) => setForm((prev) => ({ ...prev, sub_department_scope: e.target.value }))}
              className="input-field w-full"
              placeholder="Optional: comma-separated sub-department names"
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Business Unit Scope</label>
            <input
              type="text"
              value={form.business_unit_scope}
              onChange={(e) => setForm((prev) => ({ ...prev, business_unit_scope: e.target.value }))}
              className="input-field w-full"
              placeholder="Optional BU names"
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Approval Order</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.approval_order}
              onChange={(e) => setForm((prev) => ({ ...prev, approval_order: e.target.value.replace(/\D/g, '') }))}
              className="input-field w-full"
              disabled={!canEdit}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="input-field w-full"
              rows={3}
              disabled={!canEdit}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(form.active_flag)}
              onChange={(e) => setForm((prev) => ({ ...prev, active_flag: e.target.checked }))}
              disabled={!canEdit}
            />
            Active for approvals
          </label>
      </div>
    </AppModal>
  );
}

export default function CXODirectory() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('hr_admin');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [managingDirector, setManagingDirector] = useState(null);
  const [directReports, setDirectReports] = useState([]);
  const [entries, setEntries] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await orgAPI.cxoDirectory();
      setManagingDirector(res.data?.managing_director || null);
      setDirectReports(res.data?.direct_reports || []);
      setEntries(res.data?.items || res.data?.data || []);
    } catch {
      toast.error('Failed to load CXO directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!modalOpen || searchQuery.trim().length < 2 || !canEdit) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await orgAPI.employeeSearch(searchQuery.trim());
        setSearchResults(res.data?.items || res.data?.data || []);
      } catch {
        setSearchResults([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [modalOpen, searchQuery, canEdit]);

  const activeCount = useMemo(
    () => entries.filter((entry) => entry.active_flag !== false).length,
    [entries]
  );

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setSearchQuery('');
    setSearchResults([]);
    setModalOpen(true);
  };

  const openEdit = (entry) => {
    setEditingId(entry.id);
    setForm({
      employee_id: entry.employee_id || '',
      employee_name: entry.employee_name || '',
      employee_email: entry.employee_email || '',
      designation: entry.designation || '',
      department_name: entry.department_name || '',
      sub_department_name: entry.sub_department_name || '',
      location_name: entry.location_name || '',
      manager_id: entry.manager_id || '',
      department_scope: toScopeString(entry.department_scope),
      sub_department_scope: toScopeString(entry.sub_department_scope),
      business_unit_scope: toScopeString(entry.business_unit_scope),
      approval_order: String(entry.approval_order || 1),
      notes: entry.notes || '',
      active_flag: entry.active_flag !== false,
    });
    setSearchQuery(entry.employee_name || '');
    setSearchResults([]);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.employee_id || !form.employee_name) {
      toast.error('Select a SPOT employee or fill employee details first');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        approval_order: Number(form.approval_order || 1),
      };

      if (editingId) {
        await orgAPI.updateCxo(editingId, payload);
        toast.success('CXO entry updated');
      } else {
        await orgAPI.createCxo(payload);
        toast.success('CXO entry created');
      }

      closeModal();
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save CXO entry');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await orgAPI.syncCxoDirectory();
      toast.success('Synced MD direct reports from SPOT');
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to sync SPOT direct reports');
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Deactivate this CXO approval entry?')) return;
    try {
      await orgAPI.deleteCxo(id);
      toast.success('CXO entry deactivated');
      await loadData();
    } catch {
      toast.error('Failed to deactivate CXO entry');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 rounded-full border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <section className="workspace-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="workspace-eyebrow">Approval Directory</p>
            <h1 className="page-title mt-2">CXO Directory</h1>
            <p className="mt-3 text-sm leading-7 text-gray-600">
              Direct reports to the Managing Director from SPOT, with editable approval scope for new-position requisitions. This page now uses the full workspace width so the org map and approval directory can be reviewed without cramped cards.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {canEdit && (
              <>
                <button onClick={handleSync} disabled={syncing} className="btn-secondary disabled:opacity-50">
                  {syncing ? 'Syncing...' : 'Sync from SPOT'}
                </button>
                <button onClick={openCreate} className="btn-primary">+ Add CXO Entry</button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1.85fr]">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Managing Director</p>
          <h2 className="mt-3 text-2xl font-semibold text-gray-900">{managingDirector?.employee_name || 'Not found'}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {managingDirector?.designation || 'Managing Director'}{managingDirector?.employee_email ? ` | ${managingDirector.employee_email}` : ''}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Direct Reports</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{directReports.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Active Directory Entries</p>
              <p className="mt-2 text-2xl font-semibold text-indigo-700">{activeCount}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="section-title">Live Direct Reports from SPOT</h2>
              <p className="mt-1 text-sm text-gray-500">These employees currently report to the Managing Director in the EMP hierarchy.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {directReports.map((employee) => (
              <div key={employee.employee_id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="font-medium text-gray-900">{employee.employee_name}</p>
                <p className="mt-1 text-sm text-gray-600">{employee.designation || 'No designation'}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {employee.department_name || 'No department'}{employee.location_name ? ` | ${employee.location_name}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="workspace-card">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="section-title">Approval Directory</h2>
            <p className="mt-1 text-sm text-gray-500">New-position requisitions match departments and business units against this directory before routing to HR Admin.</p>
          </div>
        </div>

        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {['Name', 'Designation', 'Department Scope', 'BU Scope', 'Location', 'Status', 'Actions'].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left font-medium text-gray-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{entry.employee_name}</p>
                    <p className="text-xs text-gray-500">{entry.employee_email || entry.employee_id}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{entry.designation || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {toScopeString(entry.department_scope) || entry.department_name || '-'}
                    {toScopeString(entry.sub_department_scope) ? (
                      <p className="text-xs text-gray-500 mt-1">Sub: {toScopeString(entry.sub_department_scope)}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{toScopeString(entry.business_unit_scope) || 'All mapped BUs'}</td>
                  <td className="px-4 py-3 text-gray-600">{entry.location_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${entry.active_flag !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                      {entry.active_flag !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(entry)} className="text-indigo-600 hover:text-indigo-800 font-medium">View</button>
                      {canEdit && (
                        <>
                          <button onClick={() => openEdit(entry)} className="text-emerald-600 hover:text-emerald-800 font-medium">Edit</button>
                          <button onClick={() => handleDelete(entry.id)} className="text-red-600 hover:text-red-800 font-medium">Deactivate</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CxoModal
        open={modalOpen}
        onClose={closeModal}
        onSave={handleSave}
        loading={saving}
        form={form}
        setForm={setForm}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        canEdit={canEdit}
      />
    </div>
  );
}
