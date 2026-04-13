import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import EmailAutocompleteTags from '../components/EmailAutocompleteTags';
import InfoTip from '../components/InfoTip';
import { jobsAPI, mastersAPI, requisitionsAPI, usersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'details', label: 'Job Details' },
  { key: 'compensation', label: 'Compensation & Settings' },
  { key: 'review', label: 'Interview Design & Review' },
];

const MAX_INTERVIEW_ROUNDS = 3;
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
const JOB_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'internship', label: 'Internship' },
  { value: 'contractual', label: 'Contractual' },
];

const EMPTY_FORM = {
  requisition_id: '',
  job_title: '',
  department: '',
  sub_department: '',
  business_unit: '',
  location: '',
  phase: '',
  grade: '',
  level: '',
  experience_years: '',
  job_type: 'permanent',
  job_description: '',
  additional_comments: '',
  currency: 'INR',
  compensation_min: '',
  compensation_max: '',
  reapply_days: '90',
  publish_to_careers: true,
  allow_employee_apply: false,
  allow_employee_refer: true,
  recruiter_email: '',
  secondary_recruiter_email: '',
  interview_rounds: '3',
  hiring_stages: [],
  interviewer_emails: { 1: [], 2: [], 3: [] },
  number_of_positions: '1',
};

function buildHiringFlow(roundCount) {
  const count = Math.max(1, Math.min(MAX_INTERVIEW_ROUNDS, Number(roundCount || 1)));
  return [
    'Sourced',
    'Screening',
    ...Array.from({ length: count }, (_, index) => `Interview Round ${index + 1}`),
    'Preboarding',
    'Hired',
    'Archived',
  ];
}

function parseRoundAssignments(interviewerEmails = {}, roundCount = MAX_INTERVIEW_ROUNDS) {
  return Array.from({ length: MAX_INTERVIEW_ROUNDS }, (_, index) => {
    const roundNumber = String(index + 1);
    const raw = interviewerEmails?.[roundNumber]
      ?? interviewerEmails?.[Number(roundNumber)]
      ?? interviewerEmails?.[`Round${roundNumber}`]
      ?? [];
    const values = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? raw.split(',').map((item) => item.trim()).filter(Boolean)
        : [];
    if (index + 1 > Number(roundCount || 1)) return [];
    return values.map((email) => ({ label: email, email, source: 'manual' }));
  });
}

function detectRoundCount(hiringFlow = [], interviewerEmails = {}) {
  const flowCount = Array.isArray(hiringFlow)
    ? hiringFlow.filter((stage) => String(stage || '').toLowerCase().includes('interview round')).length
    : 0;
  const assignmentCount = Object.keys(interviewerEmails || {}).reduce((max, key) => {
    const parsed = Number(String(key).replace(/\D/g, ''));
    return Number.isInteger(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return String(Math.max(1, Math.min(MAX_INTERVIEW_ROUNDS, flowCount || assignmentCount || 3)));
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function toInputString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function StepProgress({ step, onStepClick }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {STEPS.map((stage, index) => (
          <div key={stage.key} className="flex flex-1 items-center">
            <button
              type="button"
              onClick={() => index < step && onStepClick?.(index)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                index < step
                  ? 'bg-emerald-500 text-white'
                  : index === step
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-500'
              }`}
            >
              {index < step ? 'OK' : index + 1}
            </button>
            <span className={`ml-3 hidden text-sm font-medium sm:inline ${index === step ? 'text-indigo-600' : 'text-gray-500'}`}>
              {stage.label}
            </span>
            {index < STEPS.length - 1 && (
              <div className={`mx-3 h-0.5 flex-1 ${index < step ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FormField({ label, required, children, hint }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function ToggleField({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {description && <p className="text-xs text-gray-400">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function ReviewItem({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value || '-'}</p>
    </div>
  );
}

export default function CreateJob() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [sourceMode, setSourceMode] = useState('fresh');
  const [form, setForm] = useState({ ...EMPTY_FORM, hiring_stages: buildHiringFlow(3) });
  const [submitting, setSubmitting] = useState(false);
  const [generatingJD, setGeneratingJD] = useState(false);

  const [requisitions, setRequisitions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [subDepartments, setSubDepartments] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [locations, setLocations] = useState([]);
  const [phases, setPhases] = useState([]);
  const [grades, setGrades] = useState([]);
  const [levels, setLevels] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [recruiters, setRecruiters] = useState([]);
  const [showSecondaryRecruiter, setShowSecondaryRecruiter] = useState(false);

  const importableRequisitions = requisitions.filter((requisition) => {
    if (requisition.status !== 'approved') return false;
    if (user?.role !== 'hr_recruiter') return true;
    return normalizeEmail(requisition.assigned_recruiter_email) === normalizeEmail(user?.email);
  });

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const sanitizeWholeNumber = (value) => String(value || '').replace(/\D/g, '');

  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [deptRes, buRes, gradeRes, levelRes, desigRes, userRes] = await Promise.all([
          mastersAPI.list('departments').catch(() => ({ data: [] })),
          mastersAPI.list('business-units').catch(() => ({ data: [] })),
          mastersAPI.list('grades').catch(() => ({ data: [] })),
          mastersAPI.list('levels').catch(() => ({ data: [] })),
          mastersAPI.list('designations').catch(() => ({ data: [] })),
          usersAPI.recruiterOptions().catch(() => ({ data: { users: [] } })),
        ]);
        setDepartments(extractItems(deptRes.data));
        setBusinessUnits(extractItems(buRes.data));
        setGrades(extractItems(gradeRes.data));
        setLevels(extractItems(levelRes.data));
        setDesignations(extractItems(desigRes.data));
        setRecruiters(userRes.data?.users || []);
      } catch {
        /* ignore */
      }
    };

    const loadRequisitions = async () => {
      try {
        const res = await requisitionsAPI.list({
          limit: 200,
          sort_by: 'created_at',
          sort_order: 'desc',
        });
        setRequisitions(res.data?.requisitions || []);
      } catch {
        /* ignore */
      }
    };

    loadMasters();
    loadRequisitions();
  }, []);

  useEffect(() => {
    if (!isEdit) return;

    const loadJob = async () => {
      try {
        const res = await jobsAPI.get(id);
        const job = res.data;
        const roundCount = detectRoundCount(job.hiring_flow, job.interviewer_emails);
        setForm({
          ...EMPTY_FORM,
          requisition_id: job.requisition_id || '',
          job_title: job.job_title || '',
          department: job.department_name || '',
          sub_department: job.sub_department_name || '',
          business_unit: job.bu_short_name || '',
          location: job.location_name || '',
          phase: job.phase_name || '',
          grade: job.grade || '',
          level: job.level || '',
          experience_years: toInputString(job.experience_years),
          job_type: job.job_type || 'permanent',
          job_description: job.job_description || '',
          additional_comments: job.additional_comments || '',
          currency: job.compensation_currency || 'INR',
          compensation_min: toInputString(job.compensation_min),
          compensation_max: toInputString(job.compensation_max),
          reapply_days: toInputString(job.reapply_days ?? 90),
          publish_to_careers: Boolean(job.publish_to_careers),
          allow_employee_apply: Boolean(job.allow_employee_apply),
          allow_employee_refer: Boolean(job.allow_employee_refer),
          recruiter_email: job.recruiter_email || '',
          secondary_recruiter_email: job.secondary_recruiter_email || '',
          interview_rounds: roundCount,
          hiring_stages: Array.isArray(job.hiring_flow) ? job.hiring_flow : buildHiringFlow(roundCount),
          interviewer_emails: {
            1: parseRoundAssignments(job.interviewer_emails, roundCount)[0],
            2: parseRoundAssignments(job.interviewer_emails, roundCount)[1],
            3: parseRoundAssignments(job.interviewer_emails, roundCount)[2],
          },
          number_of_positions: toInputString(job.total_positions || job.number_of_positions || 1),
        });
        setShowSecondaryRecruiter(Boolean(job.secondary_recruiter_email));
      } catch {
        toast.error('Failed to load job');
        navigate('/jobs');
      }
    };

    loadJob();
  }, [id, isEdit, navigate]);

  useEffect(() => {
    if (!form.department) {
      setSubDepartments([]);
      return;
    }
    mastersAPI.subDepartmentsByDept(form.department)
      .then((res) => {
        const items = extractItems(res.data);
        setSubDepartments(items);
        if (form.sub_department && !items.some((item) => item.sub_department_name === form.sub_department)) {
          updateForm('sub_department', '');
        }
      })
      .catch(() => setSubDepartments([]));
  }, [form.department, form.sub_department]);

  useEffect(() => {
    if (!form.business_unit) {
      setLocations([]);
      return;
    }
    mastersAPI.locationsByBU(form.business_unit)
      .then((res) => {
        const items = extractItems(res.data);
        setLocations(items);
        if (form.location && !items.some((item) => item.location_name === form.location)) {
          setForm((prev) => ({ ...prev, location: '', phase: '' }));
        }
      })
      .catch(() => setLocations([]));
  }, [form.business_unit, form.location]);

  useEffect(() => {
    if (!form.location) {
      setPhases([]);
      return;
    }
    mastersAPI.phasesByLocation(form.location)
      .then((res) => {
        const items = extractItems(res.data);
        setPhases(items);
        if (form.phase && !items.some((item) => item.phase_name === form.phase)) {
          updateForm('phase', '');
        }
      })
      .catch(() => setPhases([]));
  }, [form.location, form.phase]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      hiring_stages: buildHiringFlow(prev.interview_rounds),
    }));
  }, [form.interview_rounds]);

  const handleRequisitionSelect = useCallback(async (reqId) => {
    if (!reqId) {
      updateForm('requisition_id', '');
      return;
    }

    const selectedRequisition = requisitions.find((item) => String(item.id) === String(reqId));
    if (selectedRequisition && selectedRequisition.status !== 'approved') {
      toast.error('This requisition must be approved by HR Admin before it can be converted into a job');
      updateForm('requisition_id', '');
      return;
    }
    if (selectedRequisition && user?.role === 'hr_recruiter' && normalizeEmail(selectedRequisition.assigned_recruiter_email) !== normalizeEmail(user?.email)) {
      toast.error('This requisition is not assigned to you');
      updateForm('requisition_id', '');
      return;
    }

    try {
      const res = await requisitionsAPI.get(reqId);
      const req = res.data;
      const primaryPosition = req.positions?.[0];
      setForm((prev) => ({
        ...prev,
        requisition_id: req.id,
        job_title: req.job_title || prev.job_title,
        department: req.department_name || prev.department,
        sub_department: req.sub_department_name || prev.sub_department,
        business_unit: req.bu_short_name || prev.business_unit,
        location: primaryPosition?.location_name || prev.location,
        phase: primaryPosition?.phase_name || prev.phase,
        experience_years: req.experience_years !== null && req.experience_years !== undefined ? toInputString(req.experience_years) : prev.experience_years,
        job_type: req.job_type || prev.job_type,
        job_description: req.job_description || prev.job_description,
        additional_comments: req.additional_comments || prev.additional_comments,
        number_of_positions: toInputString(req.total_positions || prev.number_of_positions),
      }));
      toast.success('Fields populated from requisition');
    } catch {
      toast.error('Failed to load requisition details');
    }
  }, [requisitions, user?.email, user?.role]);

  const generateJD = async () => {
    if (!form.job_title || !form.department) {
      toast.error('Select designation and department first');
      return;
    }

    setGeneratingJD(true);
    try {
      const res = await requisitionsAPI.generateJD({
        designation: form.job_title,
        department: form.department,
        sub_department: form.sub_department || undefined,
      });
      updateForm('job_description', res.data?.job_description || res.data?.jd || '');
      toast.success('Job description generated');
    } catch {
      toast.error('Failed to generate JD');
    } finally {
      setGeneratingJD(false);
    }
  };

  const updateRoundAssignments = (roundNumber, items) => {
    setForm((prev) => ({
      ...prev,
      interviewer_emails: {
        ...prev.interviewer_emails,
        [roundNumber]: items,
      },
    }));
  };

  const canProceed = () => {
    switch (step) {
      case 0: {
        if (sourceMode === 'fresh') return true;
        const selectedRequisition = importableRequisitions.find((item) => String(item.id) === String(form.requisition_id));
        return Boolean(selectedRequisition);
      }
      case 1:
        return form.job_title && form.department && form.business_unit && form.location && form.phase;
      case 2:
        return form.recruiter_email;
      case 3:
        return Array.isArray(form.interviewer_emails?.[1]) && form.interviewer_emails[1].length > 0;
      default:
        return true;
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const roundCount = Number(form.interview_rounds || 1);
      const payload = {
        ...form,
        experience_years: form.experience_years ? Number(form.experience_years) : undefined,
        compensation_min: form.compensation_min ? Number(form.compensation_min) : undefined,
        compensation_max: form.compensation_max ? Number(form.compensation_max) : undefined,
        reapply_days: Number(form.reapply_days),
        number_of_positions: Number(form.number_of_positions),
        hiring_stages: buildHiringFlow(roundCount),
        interviewer_emails: Object.fromEntries(
          Array.from({ length: roundCount }, (_, index) => {
            const roundNumber = String(index + 1);
            const members = Array.isArray(form.interviewer_emails?.[roundNumber] || form.interviewer_emails?.[index + 1])
              ? (form.interviewer_emails[roundNumber] || form.interviewer_emails[index + 1]).map((item) => item.email).filter(Boolean)
              : [];
            return [roundNumber, members];
          })
        ),
      };
      const res = isEdit ? await jobsAPI.update(id, payload) : await jobsAPI.create(payload);
      toast.success(isEdit ? 'Job updated successfully!' : 'Job created successfully!');
      navigate(`/jobs/${res.data?.id || res.data?.job?.id || ''}`);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${isEdit ? 'update' : 'create'} job`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderSourceStep = () => (
    <div className="card">
      <h2 className="section-title mb-4">Choose Source</h2>
      <p className="mb-6 text-sm text-gray-500">Start fresh or import the job foundation from an approved requisition.</p>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setSourceMode('fresh');
            updateForm('requisition_id', '');
          }}
          className={`rounded-2xl border-2 p-5 text-left transition-all ${
            sourceMode === 'fresh' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-base font-semibold text-gray-900">Create Fresh</p>
          <p className="mt-2 text-sm text-gray-500">Fill the job manually and define the interview design in the later steps.</p>
        </button>
        <button
          type="button"
          onClick={() => {
            setSourceMode('requisition');
            if (!form.requisition_id) updateForm('requisition_id', 'pick');
          }}
          className={`rounded-2xl border-2 p-5 text-left transition-all ${
            sourceMode === 'requisition' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <p className="text-base font-semibold text-gray-900">Import from Requisition</p>
          <p className="mt-2 text-sm text-gray-500">Use an HR Admin approved requisition and continue from there.</p>
        </button>
      </div>

      {sourceMode === 'requisition' && (
        <FormField label="Select Requisition" required>
          <select
            value={form.requisition_id === 'pick' ? '' : form.requisition_id}
            onChange={(event) => handleRequisitionSelect(event.target.value)}
            className="input-field w-full"
          >
            <option value="">-- Select a Requisition --</option>
            {importableRequisitions.map((requisition) => (
              <option key={requisition.id} value={requisition.id}>
                {(requisition.requisition_id || `REQ-${requisition.id}`)} - {requisition.job_title || 'Untitled'}{requisition.assigned_recruiter_email ? ` | ${requisition.assigned_recruiter_email}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-500">
            Only requisitions approved by HR Admin can be converted into jobs. Recruiters only see requisitions assigned to them.
          </p>
        </FormField>
      )}
    </div>
  );

  const renderJobDetailsStep = () => (
    <div className="card">
      <h2 className="section-title mb-6">Job Details</h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <FormField label="Designation / Job Title" required>
          <select value={form.job_title} onChange={(event) => updateForm('job_title', event.target.value)} className="input-field w-full">
            <option value="">Select designation</option>
            {designations.map((designation) => (
              <option key={designation.id} value={designation.designation}>{designation.designation}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Number of Positions" required>
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={form.number_of_positions} onChange={(event) => updateForm('number_of_positions', sanitizeWholeNumber(event.target.value))} className="input-field w-full" />
        </FormField>
        <FormField label="Department" required>
          <select value={form.department} onChange={(event) => updateForm('department', event.target.value)} className="input-field w-full">
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.id} value={department.department_name}>{department.department_name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Sub Department">
          <select value={form.sub_department} onChange={(event) => updateForm('sub_department', event.target.value)} className="input-field w-full" disabled={!form.department}>
            <option value="">Select Sub Department</option>
            {subDepartments.map((department) => (
              <option key={department.id} value={department.sub_department_name}>{department.sub_department_name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Business Unit" required>
          <select value={form.business_unit} onChange={(event) => updateForm('business_unit', event.target.value)} className="input-field w-full">
            <option value="">Select BU</option>
            {businessUnits.map((unit) => (
              <option key={unit.id} value={unit.bu_short_name}>{unit.bu_name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Location" required>
          <select value={form.location} onChange={(event) => updateForm('location', event.target.value)} className="input-field w-full" disabled={!form.business_unit}>
            <option value="">Select Location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.location_name}>{location.location_name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Phase" required>
          <select value={form.phase} onChange={(event) => updateForm('phase', event.target.value)} className="input-field w-full" disabled={!form.location}>
            <option value="">Select Phase</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.phase_name}>{phase.phase_name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Grade">
          <select value={form.grade} onChange={(event) => updateForm('grade', event.target.value)} className="input-field w-full">
            <option value="">Select Grade</option>
            {grades.map((grade) => (
              <option key={grade.id} value={grade.grade}>{grade.grade}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Level">
          <select value={form.level} onChange={(event) => updateForm('level', event.target.value)} className="input-field w-full">
            <option value="">Select Level</option>
            {levels.map((level) => (
              <option key={level.id} value={level.level}>{level.level}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Job Type">
          <select value={form.job_type} onChange={(event) => updateForm('job_type', event.target.value)} className="input-field w-full">
            {JOB_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </FormField>
        <FormField label="Experience (Years)">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={form.experience_years} onChange={(event) => updateForm('experience_years', sanitizeWholeNumber(event.target.value))} className="input-field w-full" placeholder="e.g. 4" />
        </FormField>
      </div>

      <div className="mt-6">
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">Job Description</label>
          <button onClick={generateJD} disabled={generatingJD || !form.job_title} className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
            {generatingJD ? 'Generating...' : 'AI Generate'}
          </button>
        </div>
        <textarea
          value={form.job_description}
          onChange={(event) => updateForm('job_description', event.target.value)}
          rows={8}
          className="input-field w-full"
          placeholder="Enter job description, responsibilities, qualifications..."
        />
      </div>

      <div className="mt-4">
        <FormField label="Additional Comments">
          <textarea
            value={form.additional_comments}
            onChange={(event) => updateForm('additional_comments', event.target.value)}
            rows={3}
            className="input-field w-full"
            placeholder="Internal notes, special requirements..."
          />
        </FormField>
      </div>
    </div>
  );

  const renderCompensationStep = () => (
    <div className="card">
      <h2 className="section-title mb-6">Compensation & Settings</h2>

      <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-3">
        <FormField label="Currency">
          <select value={form.currency} onChange={(event) => updateForm('currency', event.target.value)} className="input-field w-full">
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </FormField>
        <FormField label="Min Compensation">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={form.compensation_min} onChange={(event) => updateForm('compensation_min', sanitizeWholeNumber(event.target.value))} className="input-field w-full" placeholder="e.g. 500000" />
        </FormField>
        <FormField label="Max Compensation">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={form.compensation_max} onChange={(event) => updateForm('compensation_max', sanitizeWholeNumber(event.target.value))} className="input-field w-full" placeholder="e.g. 1500000" />
        </FormField>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <FormField label="Primary Recruiter" required hint="Assign the lead recruiter for this job">
            <div className="flex items-start gap-2">
              <select value={form.recruiter_email} onChange={(event) => updateForm('recruiter_email', event.target.value)} className="input-field w-full">
                <option value="">Select Recruiter</option>
                {recruiters.map((user) => (
                  <option key={user.id || user.email} value={user.email}>{user.name || user.email} ({user.email})</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowSecondaryRecruiter(true)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-lg font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                title="Add secondary recruiter"
              >
                +
              </button>
            </div>
          </FormField>

          {showSecondaryRecruiter && (
            <FormField label="Secondary Recruiter" hint="Optional backup recruiter for collaboration and coverage">
              <div className="flex items-start gap-2">
                <select
                  value={form.secondary_recruiter_email}
                  onChange={(event) => updateForm('secondary_recruiter_email', event.target.value)}
                  className="input-field w-full"
                >
                  <option value="">Select Secondary Recruiter</option>
                  {recruiters
                    .filter((user) => user.email !== form.recruiter_email)
                    .map((user) => (
                      <option key={`secondary-${user.id || user.email}`} value={user.email}>
                        {user.name || user.email} ({user.email})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    updateForm('secondary_recruiter_email', '');
                    setShowSecondaryRecruiter(false);
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50"
                  title="Remove secondary recruiter"
                >
                  ×
                </button>
              </div>
            </FormField>
          )}
        </div>

        <FormField label="Reapply Period (days)" hint="Days before a rejected candidate can reapply">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={form.reapply_days} onChange={(event) => updateForm('reapply_days', sanitizeWholeNumber(event.target.value))} className="input-field w-full" />
        </FormField>
      </div>

      <div className="border-t border-gray-100 pt-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Publishing Settings</h3>
        <div className="space-y-4">
          <ToggleField label="Publish to Careers Page" description="Make this job visible on the public careers page" checked={form.publish_to_careers} onChange={(value) => updateForm('publish_to_careers', value)} />
          <ToggleField label="Allow Employee Applications" description="Employees can apply for this position internally" checked={form.allow_employee_apply} onChange={(value) => updateForm('allow_employee_apply', value)} />
          <ToggleField label="Allow Employee Referrals" description="Employees can refer candidates for this position" checked={form.allow_employee_refer} onChange={(value) => updateForm('allow_employee_refer', value)} />
        </div>
      </div>
    </div>
  );

  const renderInterviewDesignStep = () => (
    <div className="space-y-6">
      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="section-title">Interview Design</h2>
          <InfoTip text="Recruiters configure interview rounds and panel members here. The ATS generates the underlying stage flow automatically so the job setup matches how hiring teams actually work." />
        </div>
        <p className="mb-4 text-sm text-gray-500">
          Stop thinking in terms of raw stage labels. Decide how many rounds are needed and who should be in each round.
        </p>

        <div className="grid gap-5 lg:grid-cols-[0.32fr,1fr]">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Number of Interview Rounds</label>
            <select value={form.interview_rounds} onChange={(event) => updateForm('interview_rounds', event.target.value)} className="input-field w-full">
              {[1, 2, 3].map((round) => (
                <option key={round} value={String(round)}>{round} round{round > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
            <p className="text-sm font-semibold text-gray-900">ATS flow preview</p>
            <p className="mt-2 text-sm text-gray-600">{buildHiringFlow(form.interview_rounds).join('  ›  ')}</p>
          </div>
        </div>

        <div className="mt-6 border-t border-gray-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Round-wise Interviewers</h3>
          <p className="mb-3 text-xs text-gray-500">
            Search SPOT EMP by name just like an email recipient picker. If someone is external, type the email and press Enter.
          </p>
          <div className="space-y-4">
            {Array.from({ length: Number(form.interview_rounds || 1) }).map((_, index) => {
              const roundNumber = String(index + 1);
              return (
                <div key={roundNumber} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">Round {roundNumber}</span>
                    <InfoTip text={index === 0 ? 'Round 1 must have at least one reviewer so shortlisted candidates can immediately route into reviewer screening.' : 'Multiple interviewers can be assigned to the same round. Recruiters can reuse the same interviewer in later rounds if required.'} />
                  </div>
                  <EmailAutocompleteTags
                    value={form.interviewer_emails?.[roundNumber] || []}
                    onChange={(items) => updateRoundAssignments(roundNumber, items)}
                    helperText="Search by name from SPOT or add an external email manually."
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title mb-4">Review Summary</h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          <ReviewItem label="Job Title" value={form.job_title} />
          <ReviewItem label="Department" value={form.department} />
          <ReviewItem label="Sub Department" value={form.sub_department} />
          <ReviewItem label="Business Unit" value={form.business_unit} />
          <ReviewItem label="Location" value={form.location} />
          <ReviewItem label="Phase" value={form.phase} />
          <ReviewItem label="Grade" value={form.grade} />
          <ReviewItem label="Level" value={form.level} />
          <ReviewItem label="Job Type" value={JOB_TYPES.find((type) => type.value === form.job_type)?.label} />
          <ReviewItem label="Positions" value={form.number_of_positions} />
          <ReviewItem label="Experience" value={form.experience_years ? `${form.experience_years} years` : null} />
          <ReviewItem label="Compensation" value={form.compensation_min || form.compensation_max ? `${form.currency} ${form.compensation_min || 0} - ${form.compensation_max || 'N/A'}` : null} />
          <ReviewItem label="Primary Recruiter" value={form.recruiter_email} />
          <ReviewItem label="Secondary Recruiter" value={form.secondary_recruiter_email} />
          <ReviewItem label="Reapply Days" value={form.reapply_days} />
          <ReviewItem label="Interview Rounds" value={form.interview_rounds} />
          <ReviewItem label="ATS Flow" value={buildHiringFlow(form.interview_rounds).join(' > ')} className="md:col-span-2" />
          <ReviewItem
            label="Round Panels"
            value={Array.from({ length: Number(form.interview_rounds || 1) }).map((_, index) => {
              const roundNumber = String(index + 1);
              const members = Array.isArray(form.interviewer_emails?.[roundNumber]) ? form.interviewer_emails[roundNumber] : [];
              return `Round ${roundNumber}: ${members.map((item) => item.email).join(', ') || '-'}`;
            }).join(' | ')}
            className="md:col-span-2"
          />
          <ReviewItem label="Careers Page" value={form.publish_to_careers ? 'Yes' : 'No'} />
          <ReviewItem label="Employee Apply" value={form.allow_employee_apply ? 'Yes' : 'No'} />
          <ReviewItem label="Employee Refer" value={form.allow_employee_refer ? 'Yes' : 'No'} />
        </div>
        {form.job_description && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="mb-1 text-xs font-medium text-gray-500">Job Description</p>
            <p className="line-clamp-6 whitespace-pre-wrap text-sm text-gray-700">{form.job_description}</p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => navigate('/jobs')} className="text-gray-400 hover:text-gray-600">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h1 className="page-title">{isEdit ? 'Edit Job' : 'Create New Job'}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{isEdit ? 'Update the job details and interview design' : 'Create a recruiter-ready job configuration'}</p>
        </div>
      </div>

      <StepProgress step={step} onStepClick={setStep} />

      {step === 0 && renderSourceStep()}
      {step === 1 && renderJobDetailsStep()}
      {step === 2 && renderCompensationStep()}
      {step === 3 && renderInterviewDesignStep()}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => (step === 0 ? navigate('/jobs') : setStep((current) => current - 1))} className="btn-secondary">
          {step === 0 ? 'Cancel' : 'Back'}
        </button>

        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep((current) => current + 1)} disabled={!canProceed()} className="btn-primary disabled:opacity-50">
            Next Step
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting || !canProceed()} className="btn-primary min-w-[160px] disabled:opacity-50">
            {submitting ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Job' : 'Create Job')}
          </button>
        )}
      </div>
    </div>
  );
}
