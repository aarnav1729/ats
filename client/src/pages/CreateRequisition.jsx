import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { requisitionsAPI, mastersAPI, aopAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import haptic from '../utils/haptic';

const STEPS = ['Basic Info', 'Position Details', 'Review & Submit'];
const JOB_TYPES = ['permanent', 'internship', 'contractual'];
const REQ_TYPES = ['new_hire', 'backfill'];
const getReqTypeLabel = (type) => (type === 'new_hire' ? 'New Hire' : 'Replacement');

const emptyRow = (type) => ({
  type,
  location: '',
  phase: '',
  number_of_positions: 1,
  ...(type === 'backfill' ? { employee_id: '', employee_name: '', employee_email: '', backfill_reason: '' } : {}),
});

const extractItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

export default function CreateRequisition() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Master data
  const [masters, setMasters] = useState({
    designations: [], departments: [], subDepartments: [],
    businessUnits: [], locations: [], phases: [], backfillReasons: [],
  });
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [aopRows, setAopRows] = useState([]);

  // Filtered options
  const [filteredSubDepts, setFilteredSubDepts] = useState([]);
  const [locationsByBU, setLocationsByBU] = useState([]);
  const [phasesByLocation, setPhasesByLocation] = useState({});

  // Form state
  const [form, setForm] = useState({
    job_title: '', priority: false, department: '', sub_department: '',
    experience_years: '', requisition_type: [],
    job_type: 'permanent', business_unit: '', job_description: '',
    additional_comments: '', attachments: [], active_flag: true,
    requisition_id: '', created_by: '', created_at: '', updated_by: '', updated_at: '',
    approved_by: '', approved_at: '', approval_comments: '', status: 'draft',
  });

  // Position rows
  const [positions, setPositions] = useState([]);

  // AI Modal
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [previewReqIdLoading, setPreviewReqIdLoading] = useState(false);
  const [masterLoadWarnings, setMasterLoadWarnings] = useState([]);
  const [approvalPreview, setApprovalPreview] = useState({ route: [], cxo_approvers: [], hr_admin_approvers: [] });

  // Load master data on mount
  useEffect(() => {
    loadMasters();
  }, []);

  // Load existing requisition if editing
  useEffect(() => {
    if (isEdit) loadRequisition();
  }, [id]);

  useEffect(() => {
    if (isEdit || !form.business_unit) return;

    let cancelled = false;
    const loadPreviewId = async () => {
      setPreviewReqIdLoading(true);
      try {
        const res = await requisitionsAPI.previewId({ business_unit: form.business_unit });
        if (!cancelled) {
          setForm((prev) => ({
            ...prev,
            requisition_id: res.data?.requisition_id || prev.requisition_id,
          }));
        }
      } catch {
        if (!cancelled) {
          setForm((prev) => ({ ...prev, requisition_id: '' }));
        }
      } finally {
        if (!cancelled) setPreviewReqIdLoading(false);
      }
    };

    loadPreviewId();
    return () => {
      cancelled = true;
    };
  }, [form.business_unit, isEdit]);

  useEffect(() => {
    const requiresCxo = form.requisition_type.includes('new_hire');
    const requisitionerEmail = form.created_by || user?.email || '';
    if (!requisitionerEmail) {
      setApprovalPreview({ route: [], cxo_approvers: [], hr_admin_approvers: [] });
      return;
    }

    let cancelled = false;
    requisitionsAPI.approvalPreview({
      requisitioner_email: requisitionerEmail,
      requires_cxo: requiresCxo,
    }).then((res) => {
      if (!cancelled) {
        setApprovalPreview(res.data || { route: [], cxo_approvers: [], hr_admin_approvers: [] });
      }
    }).catch(() => {
      if (!cancelled) {
        setApprovalPreview({ route: [], cxo_approvers: [], hr_admin_approvers: [] });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [form.created_by, form.requisition_type, user?.email]);

  const loadMasters = async () => {
    const masterRequests = [
      { key: 'designations', label: 'Designations', request: mastersAPI.list('designations', { limit: 500, active_only: true }) },
      { key: 'departments', label: 'Departments', request: mastersAPI.list('departments', { limit: 500, active_only: true }) },
      { key: 'subDepartments', label: 'Sub-departments', request: mastersAPI.list('sub-departments', { limit: 500, active_only: true }) },
      { key: 'businessUnits', label: 'Business units', request: mastersAPI.list('business-units', { limit: 500, active_only: true }) },
      { key: 'locations', label: 'Locations', request: mastersAPI.list('locations', { limit: 500, active_only: true }) },
      { key: 'phases', label: 'Phases', request: mastersAPI.list('phases', { limit: 500, active_only: true }) },
      { key: 'backfillReasons', label: 'Replacement reasons', request: mastersAPI.list('backfill-reasons', { limit: 500, active_only: true }) },
      { key: 'employeeOptions', label: 'Employees', request: mastersAPI.employees() },
      { key: 'aopRows', label: 'AOP summary', request: aopAPI.summary() },
    ];

    const results = await Promise.allSettled(masterRequests.map((item) => item.request));

    const nextMasters = {
      designations: [],
      departments: [],
      subDepartments: [],
      businessUnits: [],
      locations: [],
      phases: [],
      backfillReasons: [],
    };
    const warnings = [];

    masterRequests.forEach((item, index) => {
      const result = results[index];
      if (result.status !== 'fulfilled') {
        warnings.push(item.label);
        return;
      }

      const items = extractItems(result.value?.data);

      if (item.key === 'employeeOptions') {
        setEmployeeOptions(items);
        return;
      }

      if (item.key === 'aopRows') {
        setAopRows(items);
        return;
      }

      nextMasters[item.key] = items;
    });

    setMasters(nextMasters);
    setMasterLoadWarnings(warnings);

    if (
      nextMasters.designations.length === 0
      && nextMasters.departments.length === 0
      && nextMasters.businessUnits.length === 0
    ) {
      toast.error('Core requisition dropdowns could not be loaded');
      return;
    }

    if (warnings.length > 0) {
      toast.error(`Some requisition helpers could not be loaded: ${warnings.join(', ')}`);
    }
  };

  const loadRequisition = async () => {
    setLoading(true);
    try {
      const res = await requisitionsAPI.get(id);
      const data = res.data;
      const requisitionTypes = data.requisition_type === 'both'
        ? ['new_hire', 'backfill']
        : data.requisition_type
          ? [data.requisition_type]
          : [];
      setForm({
        job_title: data.job_title || '',
        priority: data.priority || false,
        department: data.department || data.department_name || '',
        sub_department: data.sub_department || data.sub_department_name || '',
        experience_years: data.experience_years ?? '',
        requisition_type: requisitionTypes,
        job_type: data.job_type || 'permanent',
        business_unit: data.business_unit || data.bu_name || '',
        job_description: data.job_description || '',
        additional_comments: data.additional_comments || '',
        attachments: data.attachments || [],
        active_flag: data.active_flag !== false,
        requisition_id: data.requisition_id || '',
        created_by: data.created_by || '',
        created_at: data.created_at || '',
        updated_by: data.updated_by || '',
        updated_at: data.updated_at || '',
        approved_by: data.approved_by_name || data.approved_by || '',
        approved_at: data.approved_at || '',
        approval_comments: data.approval_comments || '',
        status: data.status || 'draft',
      });
      if (data.positions?.length) {
        setPositions(data.positions.map((position) => ({
          type: position.position_type,
          location: position.location_name || '',
          phase: position.phase_name || '',
          number_of_positions: position.number_of_positions || 1,
          employee_id: position.backfill_employee_id || '',
          employee_name: position.backfill_employee_name || '',
          employee_email: position.backfill_employee_email || '',
          backfill_reason: position.backfill_reason_name || '',
        })));
      }
    } catch (err) {
      toast.error('Failed to load requisition');
      navigate('/requisitions');
    } finally {
      setLoading(false);
    }
  };

  // Filter sub-departments when department changes
  useEffect(() => {
    if (form.department) {
      const filtered = masters.subDepartments.filter(
        (sd) => sd.department_name === form.department && sd.active_flag !== false
      );
      setFilteredSubDepts(filtered);
      if (!filtered.find((sd) => sd.sub_department_name === form.sub_department)) {
        setForm((prev) => ({ ...prev, sub_department: '' }));
      }
    } else {
      setFilteredSubDepts([]);
    }
  }, [form.department, masters.subDepartments]);

  // Filter locations when BU changes
  useEffect(() => {
    if (form.business_unit) {
      const bu = masters.businessUnits.find((b) => b.bu_name === form.business_unit);
      if (bu) {
        const filtered = masters.locations.filter(
          (l) => l.bu_short_name === bu.bu_short_name && l.active_flag !== false
        );
        setLocationsByBU(filtered);
      } else {
        setLocationsByBU([]);
      }
    } else {
      setLocationsByBU(masters.locations.filter((l) => l.active_flag !== false));
    }
  }, [form.business_unit, masters.businessUnits, masters.locations]);

  // Keep position rows in sync with the selected requisition types
  useEffect(() => {
    setPositions((prev) => {
      const normalizedPrev = prev.map((row) => ({
        ...row,
        type: row.type || row.position_type,
      }));
      const next = normalizedPrev.filter((row) => form.requisition_type.includes(row.type));

      form.requisition_type.forEach((type) => {
        if (!next.some((row) => row.type === type)) {
          next.push(emptyRow(type));
        }
      });

      return JSON.stringify(next) === JSON.stringify(normalizedPrev) ? prev : next;
    });
  }, [form.requisition_type]);

  const totalPositions = useMemo(
    () => positions.reduce((sum, p) => sum + (parseInt(p.number_of_positions) || 0), 0),
    [positions]
  );

  const selectedDesignation = useMemo(
    () => masters.designations.find((item) => item.designation === form.job_title),
    [masters.designations, form.job_title]
  );

  const aopSummary = useMemo(() => {
    if (!form.business_unit || !form.department) return null;
    return aopRows.find(
      (row) => row.bu_name === form.business_unit && row.department_name === form.department
    ) || null;
  }, [aopRows, form.business_unit, form.department]);

  const currentHeadcount = Number(aopSummary?.current_headcount || 0);
  const aopLimit = aopSummary ? Number(aopSummary.max_headcount || 0) : null;
  const projectedHeadcount = currentHeadcount + totalPositions;

  const metadata = {
    requisitionId: previewReqIdLoading ? 'Generating preview...' : (form.requisition_id || 'Select a business unit to preview'),
    createdBy: form.created_by || user?.email || 'Auto-captured on submit',
    createdAt: form.created_at ? new Date(form.created_at).toLocaleString() : 'Auto-captured on submit',
    updatedBy: form.updated_by || user?.email || 'Auto-captured on submit',
    updatedAt: form.updated_at ? new Date(form.updated_at).toLocaleString() : 'Auto-captured on submit',
    approvedBy: form.approved_by || (form.requisition_type.includes('new_hire') ? 'Pending CXO and HR Admin approvals' : 'Pending HR Admin approval'),
    approvedAt: form.approved_at ? new Date(form.approved_at).toLocaleString() : 'Pending approval',
  };

  const typeSummaries = useMemo(() => {
    return REQ_TYPES.filter((type) => form.requisition_type.includes(type)).map((type) => ({
      type,
      label: getReqTypeLabel(type),
      rows: positions.filter((row) => row.type === type).length,
    }));
  }, [form.requisition_type, positions]);

  const sanitizeWholeNumber = (value) => String(value || '').replace(/\D/g, '');

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleReqType = (type) => {
    setForm((prev) => {
      const types = prev.requisition_type.includes(type)
        ? prev.requisition_type.filter((t) => t !== type)
        : [...prev.requisition_type, type];
      return { ...prev, requisition_type: types };
    });
  };

  const handlePositionChange = (index, field, value) => {
    setPositions((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const handleEmployeeSelect = (index, selectedValue) => {
    const employee = employeeOptions.find((option) => option.employee_id === selectedValue);
    setPositions((prev) => prev.map((row, i) => {
      if (i !== index) return row;
      if (!selectedValue) {
        return {
          ...row,
          employee_id: '',
          employee_name: '',
          employee_email: '',
        };
      }
      if (!employee) {
        return {
          ...row,
          employee_id: '',
          employee_name: selectedValue,
          employee_email: '',
        };
      }
      return {
        ...row,
        employee_id: employee.employee_id,
        employee_name: employee.employee_name,
        employee_email: employee.employee_email || '',
      };
    }));
  };

  const addPositionRow = (type) => {
    setPositions((prev) => [...prev, emptyRow(type)]);
  };

  const removePositionRow = (index) => {
    setPositions((prev) => prev.filter((_, i) => i !== index));
  };

  const loadPhasesForLocation = async (location) => {
    if (phasesByLocation[location]) return;
    try {
      const res = await mastersAPI.phasesByLocation(location);
      setPhasesByLocation((prev) => ({ ...prev, [location]: res.data?.data || res.data || [] }));
    } catch {
      setPhasesByLocation((prev) => ({ ...prev, [location]: [] }));
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...files] }));
  };

  const removeAttachment = (index) => {
    setForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  // AI JD Generation
  const handleGenerateJD = async () => {
    if (!form.job_title || !form.department) {
      return toast.error('Select designation and department first');
    }
    setAiLoading(true);
    try {
      const res = await requisitionsAPI.generateJD({
        designation: form.job_title,
        job_title: form.job_title,
        department: form.department,
        sub_department: form.sub_department || undefined,
        additional_context: aiContext || undefined,
      });
      setAiResult(res.data?.job_description || res.data?.jd || '');
    } catch (err) {
      toast.error('Failed to generate JD');
    } finally {
      setAiLoading(false);
    }
  };

  const acceptAIResult = () => {
    setForm((prev) => ({ ...prev, job_description: aiResult }));
    setShowAIModal(false);
    setAiContext('');
    setAiResult('');
    toast.success('Job description updated');
  };

  const handleUseTemplate = () => {
    if (!selectedDesignation?.jd_template) {
      toast.error('No saved JD template found for this designation');
      return;
    }

    setForm((prev) => ({
      ...prev,
      job_description: selectedDesignation.jd_template,
    }));
    toast.success('JD template loaded');
  };

  // Validation
  const validateStep = (s) => {
    if (s === 0) {
      if (!form.job_title) return 'Job title is required';
      if (!form.department) return 'Department is required';
      if (!form.business_unit) return 'Business unit is required';
      if (form.experience_years !== '' && !Number.isInteger(Number(form.experience_years))) {
        return 'Experience must be a whole number';
      }
      if (form.requisition_type.length === 0) return 'Select at least one requisition type';
      return null;
    }
    if (s === 1) {
      if (positions.length === 0) return 'Add at least one position row';
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (!p.location) return `Row ${i + 1}: Location is required`;
        if (!p.phase) return `Row ${i + 1}: Phase is required`;
        if (!p.number_of_positions || p.number_of_positions < 1) return `Row ${i + 1}: Number of positions must be at least 1`;
        if (p.type === 'backfill' && !p.employee_name) return `Row ${i + 1}: Employee name is required for replacement`;
        if (p.type === 'backfill' && !p.backfill_reason) return `Row ${i + 1}: Replacement reason is required`;
      }
      return null;
    }
    return null;
  };

  const handleNext = () => {
    const error = validateStep(step);
    if (error) { haptic.warning(); return toast.error(error); }
    haptic.light();
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    haptic.light();
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (nextStatus) => {
    const error = validateStep(0) || validateStep(1);
    if (error) { haptic.error(); return toast.error(error); }
    haptic.medium();
    setSubmitting(true);
    try {
      const payload = { ...form, positions };
      if (nextStatus) {
        payload.status = nextStatus;
      }
      if (isEdit) {
        await requisitionsAPI.update(id, payload);
        haptic.success();
        if (nextStatus === 'draft') {
          toast.success('Requisition saved as draft');
        } else if (nextStatus === 'pending_approval') {
          toast.success('Requisition updated and routed into approval workflow');
        } else {
          toast.success('Requisition updated successfully');
        }
      } else {
        await requisitionsAPI.create(payload);
        haptic.success();
        toast.success(nextStatus === 'pending_approval' ? 'Requisition submitted into approval workflow' : 'Requisition saved as draft');
      }
      navigate('/requisitions');
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to save requisition');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // ----- Render Helpers -----

  const renderProgressBar = () => (
    <div className="mb-6">
      {/* Step indicators */}
      <div className="flex items-center">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`step-dot ${i < step ? 'step-dot-completed' : i === step ? 'step-dot-active' : 'step-dot-pending'}`}>
                {i < step ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span className={`text-[11px] font-semibold whitespace-nowrap hidden sm:block ${i === step ? 'text-indigo-700' : i < step ? 'text-emerald-700' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step-connector mx-2 sm:mx-3 ${i < step ? 'step-connector-completed' : i === step ? 'step-connector-active' : ''}`} />
            )}
          </div>
        ))}
      </div>
      {/* Mobile step label */}
      <p className="sm:hidden mt-2 text-sm font-semibold text-indigo-700 text-center">{STEPS[step]}</p>
      {/* Progress bar */}
      <div className="progress-bar-track mt-4">
        <div className="progress-bar-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-1.5">Step {step + 1} of {STEPS.length}</p>
    </div>
  );

  const renderBasicInfo = () => (
    <div className="space-y-6">
      {masterLoadWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some supporting dropdowns could not be loaded right now: {masterLoadWarnings.join(', ')}.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <ReviewField label="Requisition ID" value={metadata.requisitionId} />
        <ReviewField label="Status" value={form.status?.replace('_', ' ')} />
        <ReviewField label="Created By" value={metadata.createdBy} />
        <ReviewField label="Approval Mapping Uses" value={form.created_by || user?.email || 'Current user'} />
        <ReviewField label="Created At" value={metadata.createdAt} />
        <ReviewField label="Updated By" value={metadata.updatedBy} />
        <ReviewField label="Updated At" value={metadata.updatedAt} />
        <ReviewField label="Approved By" value={metadata.approvedBy} />
        <ReviewField label="Approved At" value={metadata.approvedAt} />
      </div>

      {approvalPreview.route?.length > 0 && (
        <div className="rounded-[18px] border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <p className="text-sm font-semibold text-indigo-900">Approval Route Preview</p>
          </div>
          <div className="space-y-2">
            {approvalPreview.route.map((routeStep, idx) => (
              <div key={routeStep.stage} className="flex items-start gap-3 rounded-xl bg-white/80 px-3.5 py-2.5 border border-white shadow-sm">
                <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                  {idx + 1}
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{routeStep.label}</span>
                  <p className="text-sm text-gray-800 mt-0.5">
                    {routeStep.approvers?.length
                      ? routeStep.approvers.map((a) => a.name || a.email).join(', ')
                      : <span className="text-amber-600">No approver mapped yet</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {form.requisition_type.includes('new_hire') && approvalPreview.cxo_approvers?.length === 0 && (
            <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
              <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>
                {form.created_by && form.created_by.toLowerCase() === (approvalPreview.cxo_approvers?.[0]?.email || '').toLowerCase()
                  ? 'You are the mapped CXO approver — CXO stage is skipped, going directly to HR Admin.'
                  : 'No CXO approver mapping found for this requisitioner. The requisition will go directly to HR Admin.'}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Job Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
          <select className="input w-full" value={form.job_title} onChange={(e) => handleChange('job_title', e.target.value)}>
            <option value="">Select designation</option>
            {masters.designations.filter((d) => d.active_flag !== false).map((d) => (
              <option key={d.id} value={d.designation}>{d.designation}</option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div className="flex items-center pt-6">
          <input type="checkbox" id="priority" checked={form.priority} onChange={(e) => handleChange('priority', e.target.checked)}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
          <label htmlFor="priority" className="ml-2 text-sm font-medium text-gray-700">Priority Requisition</label>
        </div>

        {/* Department */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
          <select className="input w-full" value={form.department} onChange={(e) => handleChange('department', e.target.value)}>
            <option value="">Select department</option>
            {masters.departments.filter((d) => d.active_flag !== false).map((d) => (
              <option key={d.id} value={d.department_name}>{d.department_name}</option>
            ))}
          </select>
        </div>

        {/* Sub Department */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Department</label>
          <select className="input w-full" value={form.sub_department} onChange={(e) => handleChange('sub_department', e.target.value)}
            disabled={!form.department}>
            <option value="">Select sub-department</option>
            {filteredSubDepts.map((sd) => (
              <option key={sd.id} value={sd.sub_department_name}>{sd.sub_department_name}</option>
            ))}
          </select>
        </div>

        {/* Experience */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Experience (Years)</label>
          <input type="text" inputMode="numeric" pattern="[0-9]*" className="input w-full" value={form.experience_years}
            onChange={(e) => handleChange('experience_years', sanitizeWholeNumber(e.target.value))} placeholder="e.g. 3" />
        </div>

        {/* Requisition Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Requisition Type *</label>
          <div className="flex gap-4 mt-2">
            {REQ_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.requisition_type.includes(type)}
                  onChange={() => toggleReqType(type)}
                  className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                <span className="text-sm text-gray-700">{getReqTypeLabel(type)}</span>
              </label>
            ))}
          </div>
          {form.requisition_type.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
              Step 2 captures row-level fields for each selected type: location, phase, and number of positions. Replacement rows also require employee name and replacement reason.
          </p>
        )}
      </div>

        {/* Job Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Job Type</label>
          <select className="input w-full" value={form.job_type} onChange={(e) => handleChange('job_type', e.target.value)}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Business Unit */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Business Unit *</label>
          <select className="input w-full" value={form.business_unit} onChange={(e) => handleChange('business_unit', e.target.value)}>
            <option value="">Select business unit</option>
            {masters.businessUnits.filter((b) => b.active_flag !== false).map((b) => (
              <option key={b.id} value={b.bu_name}>{b.bu_name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center pt-6">
          <input type="checkbox" id="active_flag" checked={form.active_flag}
            onChange={(e) => handleChange('active_flag', e.target.checked)}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
          <label htmlFor="active_flag" className="ml-2 text-sm font-medium text-gray-700">Active Flag</label>
        </div>
      </div>

      {/* Job Description */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">Job Description</label>
          <div className="flex items-center gap-3">
            {selectedDesignation?.jd_template && (
              <button type="button" onClick={handleUseTemplate}
                className="text-sm text-emerald-600 hover:text-emerald-800 font-medium">
                Use Template
              </button>
            )}
            <button type="button" onClick={() => setShowAIModal(true)}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate with AI
            </button>
          </div>
        </div>
        {selectedDesignation?.jd_template && (
          <p className="mb-2 text-xs text-gray-500">
            A saved JD template is available for this designation and can be loaded directly.
          </p>
        )}
        <textarea className="input w-full" rows={5} value={form.job_description}
          onChange={(e) => handleChange('job_description', e.target.value)}
          placeholder="Enter job description or use AI to generate..." />
      </div>

      {/* Additional Comments */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Comments</label>
        <textarea className="input w-full" rows={3} value={form.additional_comments}
          onChange={(e) => handleChange('additional_comments', e.target.value)}
          placeholder="Any additional notes..." />
      </div>

      {/* Attachments */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-indigo-400 transition-colors">
          <input type="file" multiple onChange={handleFileChange} className="hidden" id="file-upload" />
          <label htmlFor="file-upload" className="cursor-pointer">
            <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-1 text-sm text-gray-500">Click to upload or drag and drop</p>
          </label>
        </div>
        {form.attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {form.attachments.map((file, i) => (
              <li key={i} className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 rounded px-3 py-1">
                <span>{file.name || file}</span>
                <button type="button" onClick={() => removeAttachment(i)} className="text-red-500 hover:text-red-700 ml-2">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const renderPositionDetails = () => {
    const availableLocations = locationsByBU.length > 0 ? locationsByBU : masters.locations.filter((l) => l.active_flag !== false);

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Position Configuration</p>
              <p className="text-xs text-gray-500">
                Add one or more rows under each requisition type. Each row captures location, phase, and number of positions. Replacement rows also require employee name and replacement reason.
              </p>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">Requisition ID:</span>{' '}
              <span className="font-mono text-indigo-600">{metadata.requisitionId}</span>
            </div>
          </div>
          {typeSummaries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {typeSummaries.map((summary) => (
                <span key={summary.type} className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-700 border border-gray-200">
                  {summary.label}: {summary.rows} row{summary.rows === 1 ? '' : 's'}
                </span>
              ))}
            </div>
          )}
        </div>

        {form.requisition_type.length === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700">
            Please select a requisition type in Step 1 first.
          </div>
        )}

        {form.requisition_type.map((type) => {
          const typeLabel = getReqTypeLabel(type);

          return (
            <div key={type} className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b">
                <h3 className="font-semibold text-gray-800">{typeLabel} Positions</h3>
                <button type="button" onClick={() => addPositionRow(type)}
                  className="btn-primary text-sm px-3 py-1">+ Add Row</button>
              </div>
              <div className="overflow-hidden">
                <table className="w-full table-fixed text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Location</th>
                      <th className="px-3 py-2 text-left">Phase</th>
                      {type === 'backfill' && <th className="px-3 py-2 text-left">Employee Name</th>}
                      {type === 'backfill' && <th className="px-3 py-2 text-left">Replacement Reason</th>}
                      <th className="px-3 py-2 text-left">Positions</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((row, idx) => {
                      if (row.type !== type) return null;
                      const locPhases = phasesByLocation[row.location] || masters.phases.filter((p) => p.location_name === row.location);

                      return (
                        <tr key={idx} className="border-t">
                          <td className="px-3 py-2">
                            <select className="input w-full text-sm" value={row.location}
                              onChange={(e) => {
                                handlePositionChange(idx, 'location', e.target.value);
                                handlePositionChange(idx, 'phase', '');
                                if (e.target.value) loadPhasesForLocation(e.target.value);
                              }}>
                              <option value="">Select</option>
                              {availableLocations.map((l) => (
                                <option key={l.id} value={l.location_name}>{l.location_name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select className="input w-full text-sm" value={row.phase}
                              onChange={(e) => handlePositionChange(idx, 'phase', e.target.value)}
                              disabled={!row.location}>
                              <option value="">Select</option>
                              {locPhases.filter((p) => p.active_flag !== false).map((p) => (
                                <option key={p.id} value={p.phase_name}>{p.phase_name}</option>
                              ))}
                            </select>
                          </td>
                          {type === 'backfill' && (
                            <td className="px-3 py-2">
                              <select
                                className="input w-full text-sm"
                                value={row.employee_id || row.employee_name || ''}
                                onChange={(e) => handleEmployeeSelect(idx, e.target.value)}
                              >
                                <option value="">Select employee</option>
                                {(row.employee_id || row.employee_name) && !employeeOptions.some((employee) => employee.employee_id === row.employee_id) && (
                                  <option value={row.employee_id || row.employee_name}>
                                    {row.employee_name}{row.employee_id ? ` (${row.employee_id})` : ''}
                                  </option>
                                )}
                                {employeeOptions.map((employee) => (
                                  <option key={employee.employee_id} value={employee.employee_id}>
                                    {employee.employee_name} ({employee.employee_id}){employee.department_name ? ` - ${employee.department_name}` : ''}{employee.location_name ? ` / ${employee.location_name}` : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          {type === 'backfill' && (
                            <td className="px-3 py-2">
                              <select className="input w-full text-sm" value={row.backfill_reason || ''}
                                onChange={(e) => handlePositionChange(idx, 'backfill_reason', e.target.value)}>
                                <option value="">Select</option>
                                {masters.backfillReasons.filter((r) => r.active_flag !== false).map((r) => (
                                  <option key={r.id} value={r.reason}>{r.reason}</option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <input type="text" inputMode="numeric" pattern="[0-9]*" className="input w-20 text-sm" value={row.number_of_positions}
                              onChange={(e) => handlePositionChange(idx, 'number_of_positions', parseInt(sanitizeWholeNumber(e.target.value) || '0', 10) || 0)} />
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => removePositionRow(idx)}
                              className="text-red-500 hover:text-red-700 text-sm">Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* Total & AOP Alert */}
        <div className="rounded-lg bg-gray-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium text-gray-700">Total Positions: <span className="text-indigo-600 font-bold">{totalPositions}</span></span>
            {aopSummary && (
              <span className="text-sm text-gray-600">
                Current Headcount: <span className="font-semibold text-gray-800">{currentHeadcount}</span> | AOP Limit: <span className="font-semibold text-gray-800">{aopLimit}</span> | Projected: <span className="font-semibold text-gray-800">{projectedHeadcount}</span>
              </span>
            )}
          </div>
          {aopSummary && (
            <p className="mt-2 text-xs text-gray-500">
              Projected headcount is calculated using current employees plus requested positions. Existing open requisitions may further increase the final approval impact.
            </p>
          )}
        </div>

        {aopLimit !== null && projectedHeadcount > aopLimit && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="font-semibold text-amber-800">AOP Limit Exceeded</p>
              <p className="text-sm text-amber-700">
                Current headcount ({currentHeadcount}) plus requested positions ({totalPositions}) projects to {projectedHeadcount}, which exceeds the approved AOP limit of {aopLimit}. The requisition can still be submitted, but it should be reviewed by HR Admin and Recruiters.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderReview = () => (
    <div className="space-y-6">
      {form.status !== 'approved' && (
        <div className="rounded-[14px] border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <div className="text-sm text-blue-800">
              {form.requisition_type.includes('new_hire') && approvalPreview.cxo_approvers?.length > 0
                ? 'New-hire requisitions require CXO approval first, then HR Admin approval before they can become jobs.'
                : form.requisition_type.includes('new_hire') && approvalPreview.cxo_approvers?.length === 0
                  ? 'CXO stage is skipped (self-approval). This will go directly to HR Admin approval.'
                  : 'Replacement-only requisitions require only HR Admin approval before they can become jobs.'}
            </div>
          </div>
        </div>
      )}

      {/* Basic Info Card */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-800">Basic Information</h3>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <ReviewField label="Requisition ID" value={metadata.requisitionId} />
          <ReviewField label="Status" value={form.status?.replace('_', ' ')} />
          <ReviewField label="Job Title" value={form.job_title} />
          <ReviewField label="Priority" value={form.priority ? 'Yes' : 'No'} />
          <ReviewField label="Department" value={form.department} />
          <ReviewField label="Sub-Department" value={form.sub_department} />
          <ReviewField label="Experience" value={form.experience_years ? `${form.experience_years} years` : '-'} />
          <ReviewField label="Requisition Type" value={form.requisition_type.map((t) => getReqTypeLabel(t)).join(', ')} />
          <ReviewField label="Job Type" value={form.job_type} />
          <ReviewField label="Business Unit" value={form.business_unit} />
          <ReviewField label="Active Flag" value={form.active_flag ? 'Active' : 'Inactive'} />
          <ReviewField label="Created By" value={metadata.createdBy} />
          <ReviewField label="Created At" value={metadata.createdAt} />
          <ReviewField label="Updated By" value={metadata.updatedBy} />
          <ReviewField label="Updated At" value={metadata.updatedAt} />
          <ReviewField label="Approved By" value={metadata.approvedBy} />
          <ReviewField label="Approved At" value={metadata.approvedAt} />
        </div>
        {form.approval_comments && (
          <div className="px-4 pb-4">
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Approval Comments</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded p-3">{form.approval_comments}</p>
          </div>
        )}
        {form.job_description && (
          <div className="px-4 pb-4">
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Job Description</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-3">{form.job_description}</p>
          </div>
        )}
        {form.additional_comments && (
          <div className="px-4 pb-4">
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Additional Comments</p>
            <p className="text-sm text-gray-700 bg-gray-50 rounded p-3">{form.additional_comments}</p>
          </div>
        )}
        {form.attachments.length > 0 && (
          <div className="px-4 pb-4">
            <p className="text-xs font-medium text-gray-500 uppercase mb-1">Attachments</p>
            <p className="text-sm text-gray-700">{form.attachments.length} file(s) attached</p>
          </div>
        )}
      </div>

      {/* Positions Card */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b flex justify-between">
          <h3 className="font-semibold text-gray-800">Position Details</h3>
          <span className="text-sm text-indigo-600 font-medium">Total: {totalPositions} position(s)</span>
        </div>
        <div className="p-4 space-y-3">
          {positions.map((row, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm grid grid-cols-2 md:grid-cols-4 gap-2">
              <ReviewField label="Type" value={getReqTypeLabel(row.type)} />
              <ReviewField label="Location" value={row.location} />
              <ReviewField label="Phase" value={row.phase} />
              <ReviewField label="Positions" value={row.number_of_positions} />
              {row.employee_name && <ReviewField label="Employee" value={row.employee_id ? `${row.employee_name} (${row.employee_id})` : row.employee_name} />}
              {row.backfill_reason && <ReviewField label="Reason" value={row.backfill_reason} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderAIModal = () => {
    if (!showAIModal) return null;
    return (
      <div className="app-modal-backdrop">
        <div className="app-modal-panel app-modal-panel-wide">
          <div className="app-modal-header">
            <div className="flex items-center justify-between gap-4">
              <div>
            <h3 className="text-lg font-semibold text-gray-800">Generate Job Description with AI</h3>
                <p className="mt-1 text-sm text-gray-500">Generate a Premier Energies-aligned draft and then edit it before accepting.</p>
              </div>
              <button onClick={() => setShowAIModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
          </div>
          <div className="app-modal-body space-y-4">
            {!aiResult ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Optional Notes</label>
                  <textarea className="input w-full" rows={4} value={aiContext} onChange={(e) => setAiContext(e.target.value)}
                    placeholder="Add optional shift details, plant context, tools, or hiring nuances." />
                </div>
                <button onClick={handleGenerateJD} disabled={aiLoading}
                  className="btn-primary w-full flex items-center justify-center gap-2">
                  {aiLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Generating...
                    </>
                  ) : 'Generate JD'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Generated Job Description</label>
                  <textarea className="input w-full" rows={8} value={aiResult}
                    onChange={(e) => setAiResult(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <button onClick={acceptAIResult} className="btn-primary flex-1">Accept</button>
                  <button onClick={() => { setAiResult(''); }} className="btn-secondary flex-1">Regenerate</button>
                  <button onClick={() => { setShowAIModal(false); setAiResult(''); setAiContext(''); }}
                    className="btn-secondary flex-1">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="workspace-shell animate-fade-in-up">
      <section className="workspace-hero">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="workspace-eyebrow">{isEdit ? 'Refine Demand' : 'Create Demand'}</p>
            <h1 className="page-title mt-3">{isEdit ? 'Edit Requisition' : 'New Requisition'}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
              {step === 0 && 'Capture the role, ownership, and hiring intent before it enters the approval lane.'}
              {step === 1 && 'Lay out positions by type, location, and phase so downstream conversion stays clean.'}
              {step === 2 && 'Review the request, check routing, and submit a polished requisition package.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {STEPS.map((label, index) => (
                <span
                  key={label}
                  className={`glass-chip border-[rgba(29,33,41,0.08)] ${step === index ? 'bg-slate-900 text-white' : 'bg-white/84 text-slate-600'}`}
                >
                  {index + 1}. {label}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => { haptic.light(); navigate('/requisitions'); }}
            className="btn-secondary"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel
          </button>
        </div>
      </section>

      <div className="workspace-card">
        {renderProgressBar()}
      </div>

      <div className="workspace-card animate-scale-in">
        {step === 0 && renderBasicInfo()}
        {step === 1 && renderPositionDetails()}
        {step === 2 && renderReview()}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-5 border-t border-gray-100">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all
              ${step === 0
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button onClick={handleNext} className="btn-primary flex items-center gap-1.5">
              {step === 0 ? 'Position Details' : 'Review & Submit'}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSubmit('draft')}
                disabled={submitting}
                className="btn-secondary flex items-center gap-2"
              >
                {submitting && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />}
                Save Draft
              </button>
              <button
                onClick={() => handleSubmit(form.status === 'approved' && user?.role === 'hr_admin' ? undefined : 'pending_approval')}
                disabled={submitting}
                className="btn-primary flex items-center gap-2"
              >
                {submitting && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {form.status === 'approved' && user?.role === 'hr_admin'
                  ? 'Update Requisition'
                  : 'Submit for Approval'}
              </button>
            </div>
          )}
        </div>
      </div>

      {renderAIModal()}
    </div>
  );
}

function ReviewField({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
      <p className="text-gray-800">{value || '-'}</p>
    </div>
  );
}
