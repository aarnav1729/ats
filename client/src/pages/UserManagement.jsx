import { useState, useEffect, useCallback } from 'react';
import { usersAPI } from '../services/api';
import toast from 'react-hot-toast';
import DataTable from '../components/DataTable';
import { PageHeader, StatusPill } from '../components/ui';

const ROLES = [
  { value: 'hr_admin', label: 'HR Admin', tone: 'purple' },
  { value: 'hr_recruiter', label: 'HR Recruiter', tone: 'info' },
  { value: 'interviewer', label: 'Interviewer', tone: 'warning' },
  { value: 'applicant', label: 'Applicant', tone: 'success' },
  { value: 'hod', label: 'HOD', tone: 'info' },
];

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'hr_recruiter' });
  const [deleteModal, setDeleteModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await usersAPI.list({ page, limit: 20, search, role: roleFilter || undefined });
      setUsers(res.data.users);
      setTotal(res.data.total);
    } catch (err) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editUser) {
        await usersAPI.update(editUser.id, form);
        toast.success('User updated');
      } else {
        await usersAPI.create(form);
        toast.success('User created');
      }
      setModalOpen(false);
      setEditUser(null);
      setForm({ email: '', name: '', role: 'hr_recruiter' });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await usersAPI.delete(deleteModal.id);
      toast.success('User deactivated');
      setDeleteModal(null);
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({ email: user.email, name: user.name || '', role: user.role });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditUser(null);
    setForm({ email: '', name: '', role: 'hr_recruiter' });
    setModalOpen(true);
  };

  const getRoleInfo = (role) => ROLES.find(r => r.value === role) || { label: role, tone: 'neutral' };

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'User Management' }]}
        title="User Management"
        subtitle="Invite colleagues, assign roles, and govern access to the ATS."
        meta={[{ label: `${total} users` }]}
        actions={<button onClick={openCreate} className="btn-primary">+ Add User</button>}
      />

      <div className="flex flex-wrap gap-2.5">
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email…"
          className="input-field"
          style={{ maxWidth: 280, height: 36 }}
        />
        <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }} className="input-field" style={{ maxWidth: 200, height: 36 }}>
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 48, display: 'flex', justifyContent: 'center' }}>
          <div className="animate-spin rounded-full h-6 w-6" style={{ borderBottom: '2px solid var(--accent-blue)' }} />
        </div>
      ) : (
        <DataTable
          title="Users"
          data={users}
          exportFileName="users"
          emptyMessage="No users found"
          columns={[
            { key: 'name', label: 'Name', render: (row) => <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{row.name || '-'}</span> },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role', render: (row) => <StatusPill tone={getRoleInfo(row.role).tone}>{getRoleInfo(row.role).label}</StatusPill> },
            { key: 'is_active', label: 'Status', render: (row) => <StatusPill tone={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'Active' : 'Inactive'}</StatusPill> },
            { key: 'created_at', label: 'Created', render: (row) => <span style={{ color: 'var(--text-faint)' }}>{new Date(row.created_at).toLocaleDateString()}</span> },
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <div className="flex gap-2">
                <button onClick={() => openEdit(row)} className="table-link">Edit</button>
                {!row.is_default && (
                  <button onClick={() => setDeleteModal(row)} className="table-link" style={{ color: 'var(--danger-text)' }}>Delete</button>
                )}
              </div>
            )},
          ]}
        />
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="app-modal-backdrop">
          <div className="app-modal-panel app-modal-panel-wide">
            <div className="app-modal-body overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
            <h2 className="text-lg font-semibold mb-4">{editUser ? 'Edit User' : 'Create User'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field" required disabled={!!editUser} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="input-field">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              {editUser && (
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="active" checked={form.is_active !== false} onChange={e => setForm({...form, is_active: e.target.checked})} />
                  <label htmlFor="active" className="text-sm text-gray-700">Active</label>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-50">{saving ? 'Saving...' : editUser ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => { setModalOpen(false); setEditUser(null); }} className="btn-secondary flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteModal && (
        <div className="app-modal-backdrop">
          <div className="app-modal-panel app-modal-panel-wide">
            <div className="app-modal-body text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Deactivate User</h3>
            <p className="text-sm text-gray-500 mb-4">Are you sure you want to deactivate <strong>{deleteModal.email}</strong>?</p>
            <div className="flex gap-3">
              <button onClick={handleDelete} className="btn-danger flex-1">Deactivate</button>
              <button onClick={() => setDeleteModal(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
