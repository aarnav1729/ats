import { useState, useEffect, useCallback, useMemo } from 'react';
import { mastersAPI } from '../services/api';
import toast from 'react-hot-toast';
import EmployeeAutocompleteField from '../components/EmployeeAutocompleteField';
import DataTable from '../components/DataTable';
import { PageHeader, Tabs, StatusPill } from '../components/ui';

const MASTER_TYPES = [
  { key: 'business-units', label: 'Business Units', fields: [
    { name: 'bu_name', label: 'BU Name', type: 'text', required: true },
    { name: 'bu_short_name', label: 'Short Name', type: 'text', required: true },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'locations', label: 'Locations', fields: [
    { name: 'bu_short_name', label: 'Business Unit', type: 'select', required: true, optionsFrom: 'business-units', optionValue: 'bu_short_name', optionLabel: 'bu_name' },
    { name: 'location_name', label: 'Location Name', type: 'text', required: true },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'phases', label: 'Phases', fields: [
    { name: 'location_name', label: 'Location', type: 'select', required: true, optionsFrom: 'locations', optionValue: 'location_name', optionLabel: 'location_name' },
    { name: 'phase_name', label: 'Phase Name', type: 'text', required: true },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'departments', label: 'Departments', fields: [
    { name: 'department_name', label: 'Department Name', type: 'text', required: true },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'sub-departments', label: 'Sub-Departments', fields: [
    { name: 'department_name', label: 'Department', type: 'select', required: true, optionsFrom: 'departments', optionValue: 'department_name', optionLabel: 'department_name' },
    { name: 'sub_department_name', label: 'Sub-Department Name', type: 'text', required: true },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'grades', label: 'Grades', fields: [
    { name: 'grade', label: 'Grade', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'levels', label: 'Levels', fields: [
    { name: 'level', label: 'Level', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'designations', label: 'Designations', fields: [
    { name: 'designation', label: 'Designation', type: 'text', required: true },
    { name: 'jd_template', label: 'JD Template', type: 'textarea' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'rejection-reasons', label: 'Rejection Reasons', fields: [
    { name: 'reason', label: 'Reason', type: 'text', required: true },
    { name: 'reason_preview', label: 'Preview', type: 'text' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'backfill-reasons', label: 'Replacement Reasons', fields: [
    { name: 'reason', label: 'Reason', type: 'text', required: true },
    { name: 'reason_preview', label: 'Preview', type: 'text' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'offer-dropout-reasons', label: 'Dropout Reasons', fields: [
    { name: 'reason', label: 'Reason', type: 'text', required: true },
    { name: 'reason_preview', label: 'Preview', type: 'text' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
  { key: 'approvers', label: 'Approvers', fields: [
    { name: 'requisitioner_name', label: 'Requisitioner', type: 'employee_lookup', required: true, emailField: 'requisitioner_email', idField: 'requisitioner_employee_id', designationField: 'requisitioner_designation' },
    { name: 'cxo_name', label: 'CXO Approver', type: 'employee_lookup', required: true, emailField: 'cxo_email', idField: 'cxo_employee_id', designationField: 'cxo_designation' },
    { name: 'active_flag', label: 'Active', type: 'checkbox', default: true },
  ]},
];

function buildInitialForm(type, item = null) {
  const formData = {};
  type.fields.forEach((field) => {
    formData[field.name] = item ? (item[field.name] ?? '') : (field.default !== undefined ? field.default : '');
    if (field.type === 'employee_lookup') {
      formData[field.emailField] = item ? (item[field.emailField] ?? '') : '';
      formData[field.idField] = item ? (item[field.idField] ?? '') : '';
      if (field.designationField) {
        formData[field.designationField] = item ? (item[field.designationField] ?? '') : '';
      }
    }
  });
  return formData;
}

function getFieldDisplayValue(item, field) {
  if (field.type === 'employee_lookup') {
    const name = item[field.name];
    const email = item[field.emailField];
    if (!name && !email) return '-';
    return name && email ? `${name} (${email})` : name || email;
  }
  return item[field.name] || '-';
}

function isActiveRow(item) {
  return item?.active_flag !== false
    && item?.active_flag !== 0
    && item?.active_flag !== '0'
    && item?.active_flag !== 'false';
}

export default function Masters() {
  const [activeTab, setActiveTab] = useState(MASTER_TYPES[0].key);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [selectOptions, setSelectOptions] = useState({});
  const [search, setSearch] = useState('');

  const currentType = MASTER_TYPES.find(t => t.key === activeTab);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await mastersAPI.list(activeTab);
      setData(res.data);
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { loadData(); setSearch(''); }, [loadData]);

  // Load options for select fields
  useEffect(() => {
    const selectFields = currentType.fields.filter(f => f.type === 'select' && f.optionsFrom);
    selectFields.forEach(async (field) => {
      try {
        const res = await mastersAPI.list(field.optionsFrom, { active_only: 'true' });
        setSelectOptions(prev => ({ ...prev, [field.optionsFrom]: res.data }));
      } catch {}
    });
  }, [activeTab]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const submitData = { ...form };
      const missingField = currentType.fields.find((field) => (
        field.required
        && (submitData[field.name] === '' || submitData[field.name] === null || submitData[field.name] === undefined)
      ));
      if (missingField) {
        toast.error(`${missingField.label} is required`);
        setSaving(false);
        return;
      }
      // Set active_flag default
      if (submitData.active_flag === undefined) submitData.active_flag = true;

      if (editItem) {
        await mastersAPI.update(activeTab, editItem.id, submitData);
        toast.success('Updated successfully');
      } else {
        await mastersAPI.create(activeTab, submitData);
        toast.success('Created successfully');
      }
      setModalOpen(false);
      setEditItem(null);
      setForm({});
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this item?')) return;
    try {
      await mastersAPI.delete(activeTab, id);
      toast.success('Deactivated');
      loadData();
    } catch (err) {
      toast.error('Failed to deactivate');
    }
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm(buildInitialForm(currentType, item));
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditItem(null);
    setForm(buildInitialForm(currentType));
    setModalOpen(true);
  };

  const filteredData = data.filter(item => {
    if (!search) return true;
    return Object.values(item).some(v => String(v).toLowerCase().includes(search.toLowerCase()));
  });
  const [activeRows, inactiveRows] = useMemo(() => {
    const active = [];
    const inactive = [];

    filteredData.forEach((item) => {
      if (isActiveRow(item)) active.push(item);
      else inactive.push(item);
    });

    return [active, inactive];
  }, [filteredData]);

  const displayFields = currentType.fields.filter(f => f.type !== 'checkbox' && f.type !== 'textarea');

  const tabsConfig = MASTER_TYPES.map(t => ({ value: t.key, label: t.label }));
  const tableColumns = [
    ...displayFields.map(f => ({
      key: f.name,
      label: f.label,
      render: (row) => getFieldDisplayValue(row, f),
    })),
    {
      key: 'active_flag',
      label: 'Status',
      render: (row) => (
        <StatusPill tone={isActiveRow(row) ? 'success' : 'danger'}>
          {isActiveRow(row) ? 'Active' : 'Inactive'}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      filterable: false,
      render: (row) => (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <button onClick={() => openEdit(row)} className="table-link">Edit</button>
          {isActiveRow(row) && (
            <button onClick={() => handleDelete(row.id)} className="table-link" style={{ color: 'var(--danger-text)' }}>Deactivate</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page-container space-y-8">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Masters' }]}
        title="Masters"
        subtitle="Maintain the dropdowns, reasons, and approval mappings that drive the ATS workflow."
        meta={[
          { label: `${activeRows.length} active`, tone: 'success' },
          { label: `${inactiveRows.length} inactive` },
        ]}
        actions={
          <button onClick={openCreate} className="btn-primary">
            + Add {currentType.label.replace(/s$/, '')}
          </button>
        }
      />

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <Tabs
          tabs={tabsConfig}
          value={activeTab}
          onChange={setActiveTab}
          variant="underline"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="input-field flex-1 min-w-[180px]"
          style={{ maxWidth: 280, height: 36 }}
        />
      </div>

      {loading ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: 48, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
          Loading…
        </div>
      ) : (
        <div className="space-y-6">
          <DataTable
            title={`Active ${currentType.label}`}
            subtitle="Primary values currently available across the ATS."
            data={activeRows}
            columns={tableColumns}
            emptyMessage="No active records found"
            exportFileName={`masters-${activeTab}-active`}
            collapsible
          />

          <DataTable
            title={`Inactive ${currentType.label}`}
            subtitle="Retained for reference and reactivation decisions."
            data={inactiveRows}
            columns={tableColumns}
            emptyMessage="No inactive records found"
            exportFileName={`masters-${activeTab}-inactive`}
            collapsible
          />
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="app-modal-backdrop" onClick={() => { setModalOpen(false); setEditItem(null); }}>
          <div 
            className="app-modal-panel app-modal-panel-wide" 
            onClick={e => e.stopPropagation()}
            style={{ 
              width: 'min(90vw, 480px)',
              maxWidth: '100%',
              margin: 'auto',
            }}
          >
            <div className="app-modal-header flex items-center justify-between">
              <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-main)' }}>
                {editItem ? 'Edit' : 'Create'} {currentType.label.replace(/s$/, '')}
              </h2>
              <button 
                type="button" 
                onClick={() => { setModalOpen(false); setEditItem(null); }}
                className="md:hidden p-1 -mr-2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="app-modal-body overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
            <form onSubmit={handleSubmit} className="space-y-4">
              {currentType.fields.map(field => (
                <div key={field.name}>
                  {field.type === 'checkbox' ? (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id={field.name} checked={form[field.name] !== false} onChange={e => setForm({...form, [field.name]: e.target.checked})} />
                      <label htmlFor={field.name} className="text-sm font-medium text-gray-700">{field.label}</label>
                    </div>
                  ) : field.type === 'select' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <select value={form[field.name] || ''} onChange={e => setForm({...form, [field.name]: e.target.value})} className="input-field" required={field.required}>
                        <option value="">Select {field.label}</option>
                        {(selectOptions[field.optionsFrom] || []).map(opt => (
                          <option key={opt[field.optionValue]} value={opt[field.optionValue]}>{opt[field.optionLabel]}</option>
                        ))}
                      </select>
                    </div>
                  ) : field.type === 'textarea' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <textarea value={form[field.name] || ''} onChange={e => setForm({...form, [field.name]: e.target.value})} className="input-field h-32" />
                    </div>
                  ) : field.type === 'employee_lookup' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <EmployeeAutocompleteField
                        value={{
                          employee_id: form[field.idField],
                          employee_name: form[field.name],
                          employee_email: form[field.emailField],
                          designation: field.designationField ? form[field.designationField] : '',
                        }}
                        onSelect={(employee) => {
                          setForm((prev) => ({
                            ...prev,
                            [field.name]: employee?.employee_name || '',
                            [field.emailField]: employee?.employee_email || '',
                            [field.idField]: employee?.employee_id || '',
                            ...(field.designationField ? { [field.designationField]: employee?.designation || '' } : {}),
                          }));
                        }}
                        placeholder={`Search ${field.label.toLowerCase()}`}
                      />
                      <p className="mt-1 text-xs text-gray-500">Search SPOT EMP and select the mapped person.</p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                      <input type="text" value={form[field.name] || ''} onChange={e => setForm({...form, [field.name]: e.target.value})} className="input-field" required={field.required} />
                    </div>
                  )}
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-50">{saving ? 'Saving...' : editItem ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => { setModalOpen(false); setEditItem(null); }} className="btn-secondary flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
