import { useState, useEffect, useCallback } from 'react';
import { aopAPI, mastersAPI } from '../services/api';
import toast from 'react-hot-toast';
import DataTable from '../components/DataTable';
import { PageHeader, StatCard, StatusPill } from '../components/ui';

export default function AOP() {
  const [data, setData] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buFilter, setBuFilter] = useState('');
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ business_unit_id: '', department_id: '', max_headcount: 0, fiscal_year: new Date().getFullYear().toString() });
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aopRes, buRes, deptRes] = await Promise.all([
        aopAPI.summary(),
        mastersAPI.list('business-units', { active_only: 'true' }),
        mastersAPI.list('departments', { active_only: 'true' }),
      ]);
      setData(aopRes.data);
      setBusinessUnits(buRes.data);
      setDepartments(deptRes.data);
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredData = data.filter(item => {
    if (buFilter && item.business_unit_id !== parseInt(buFilter)) return false;
    if (yearFilter && item.fiscal_year !== yearFilter) return false;
    return true;
  });

  const totalProvisioned = filteredData.reduce((sum, d) => sum + (d.max_headcount || 0), 0);
  const totalCurrent = filteredData.reduce((sum, d) => sum + parseInt(d.current_headcount || 0), 0);

  const handleInlineEdit = async (id) => {
    try {
      await aopAPI.update(id, { max_headcount: parseInt(editValue) });
      toast.success('Updated');
      setEditingId(null);
      loadData();
    } catch (err) {
      toast.error('Failed to update');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await aopAPI.create(form);
      toast.success('AOP entry created');
      setModalOpen(false);
      setForm({ business_unit_id: '', department_id: '', max_headcount: 0, fiscal_year: new Date().getFullYear().toString() });
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const remaining = totalProvisioned - totalCurrent;

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'AOP' }]}
        title="Annual Operating Plan"
        subtitle="Manage headcount allocation by business unit and department."
        actions={<button onClick={() => setModalOpen(true)} className="btn-primary">+ Add AOP Entry</button>}
      />

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))' }}>
        <StatCard label="Total provisioned" value={totalProvisioned} hint="Approved maximum headcount." />
        <StatCard label="Current headcount" value={totalCurrent} deltaTone="info" hint="Currently filled positions." />
        <StatCard label="Remaining capacity" value={remaining} deltaTone={remaining >= 0 ? 'success' : 'danger'} hint="Available runway to hire." />
      </div>

      <div className="flex flex-wrap gap-2.5">
        <select value={buFilter} onChange={e => setBuFilter(e.target.value)} className="input-field" style={{ maxWidth: 260, height: 36 }}>
          <option value="">All business units</option>
          {businessUnits.map(bu => <option key={bu.id} value={bu.id}>{bu.bu_name}</option>)}
        </select>
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="input-field" style={{ maxWidth: 140, height: 36 }}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" /></div>
      ) : (
        <DataTable
          title="AOP Plan"
          data={filteredData}
          exportFileName="aop"
          emptyMessage="No AOP data found"
          columns={[
            { key: 'bu_name', label: 'Business Unit', render: (row) => <span className="font-medium">{row.bu_name} ({row.bu_short_name})</span> },
            { key: 'department_name', label: 'Department' },
            { key: 'max_headcount', label: 'Max Headcount', render: (row) => (
              editingId === row.id ? (
                <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                  onBlur={() => handleInlineEdit(row.id)} onKeyDown={e => e.key === 'Enter' && handleInlineEdit(row.id)}
                  className="input-field w-20" autoFocus />
              ) : (
                <span className="font-semibold cursor-pointer hover:text-indigo-600" onClick={() => { setEditingId(row.id); setEditValue(row.max_headcount); }}>{row.max_headcount}</span>
              )
            )},
            { key: 'current_headcount', label: 'Current', render: (row) => row.current_headcount || 0 },
            { key: 'remaining', label: 'Remaining', render: (row) => {
              const rem = row.max_headcount - parseInt(row.current_headcount || 0);
              return <StatusPill tone={rem >= 0 ? 'success' : 'danger'}>{rem}</StatusPill>;
            }},
            { key: 'fiscal_year', label: 'Year' },
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <button onClick={async () => { await aopAPI.delete(row.id); toast.success('Deleted'); loadData(); }} className="table-link" style={{ color: 'var(--danger-text)' }}>Delete</button>
            )},
          ]}
        />
      )}

      {/* Create Modal */}
      {modalOpen && (
        <div className="app-modal-backdrop">
          <div className="app-modal-panel app-modal-panel-wide">
            <div className="app-modal-body overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
            <h2 className="text-lg font-semibold mb-4">Add AOP Entry</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Unit</label>
                <select value={form.business_unit_id} onChange={e => setForm({...form, business_unit_id: e.target.value})} className="input-field" required>
                  <option value="">Select BU</option>
                  {businessUnits.map(bu => <option key={bu.id} value={bu.id}>{bu.bu_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select value={form.department_id} onChange={e => setForm({...form, department_id: e.target.value})} className="input-field" required>
                  <option value="">Select Department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Headcount</label>
                <input type="number" value={form.max_headcount} onChange={e => setForm({...form, max_headcount: parseInt(e.target.value) || 0})} className="input-field" required min="0" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fiscal Year</label>
                <select value={form.fiscal_year} onChange={e => setForm({...form, fiscal_year: e.target.value})} className="input-field">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-50">{saving ? 'Saving...' : 'Create'}</button>
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
