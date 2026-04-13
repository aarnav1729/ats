import { useState, useEffect, useCallback } from 'react';
import { aopAPI, mastersAPI } from '../services/api';
import toast from 'react-hot-toast';
import DataTable from '../components/DataTable';

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Annual Operating Plan</h1>
          <p className="text-sm text-gray-500 mt-1">Manage headcount allocation by business unit and department</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary">+ Add AOP Entry</button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card"><p className="text-sm text-gray-500">Total Provisioned</p><p className="text-3xl font-bold text-gray-900 mt-1">{totalProvisioned}</p></div>
        <div className="card"><p className="text-sm text-gray-500">Current Headcount</p><p className="text-3xl font-bold text-indigo-600 mt-1">{totalCurrent}</p></div>
        <div className="card"><p className="text-sm text-gray-500">Remaining Capacity</p><p className={`text-3xl font-bold mt-1 ${totalProvisioned - totalCurrent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{totalProvisioned - totalCurrent}</p></div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select value={buFilter} onChange={e => setBuFilter(e.target.value)} className="input-field max-w-[250px]">
          <option value="">All Business Units</option>
          {businessUnits.map(bu => <option key={bu.id} value={bu.id}>{bu.bu_name}</option>)}
        </select>
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="input-field max-w-[150px]">
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
              const remaining = row.max_headcount - parseInt(row.current_headcount || 0);
              return <span className={`badge ${remaining >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{remaining}</span>;
            }},
            { key: 'fiscal_year', label: 'Year' },
            { key: 'actions', label: 'Actions', sortable: false, filterable: false, render: (row) => (
              <button onClick={async () => { await aopAPI.delete(row.id); toast.success('Deleted'); loadData(); }} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
            )},
          ]}
        />
      )}

      {/* Create Modal */}
      {modalOpen && (
        <div className="app-modal-backdrop">
          <div className="app-modal-panel app-modal-panel-wide">
            <div className="app-modal-body">
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
