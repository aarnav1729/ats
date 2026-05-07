import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { applicationsAPI } from '../services/api';

const EDUCATION_LEVELS = ['10th', '12th', 'Diploma', 'Bachelors', 'Masters', 'PhD', 'Other'];
const SOURCES = ['LinkedIn', 'Naukri', 'Indeed', 'Employee Referral', 'Consultant', 'Walk-in', 'Company Website', 'Other'];
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const DEFAULT_FORM = {
  candidate_name: '',
  candidate_email: '',
  candidate_phone: '',
  candidate_aadhar: '',
  candidate_pan: '',
  candidate_age: '',
  candidate_gender: '',
  candidate_years_of_experience: '',
  current_organization: '',
  current_ctc: '',
  current_location: '',
  willing_to_relocate: false,
  education_level: '',
  education_other: '',
  source: '',
  referrer_emp_id: '',
  consultant_code: '',
  dob: '',
};

function isPreviewableFile(filePath = '') {
  return /\.(pdf|png|jpe?g|gif|webp)$/i.test(filePath);
}

function renderInlinePreview(filePath, title) {
  if (!filePath || !isPreviewableFile(filePath)) return null;
  if (/\.(png|jpe?g|gif|webp)$/i.test(filePath)) {
    return <img src={filePath} alt={title} className="w-full rounded-[24px] border border-gray-200 object-contain max-h-[32rem] bg-white" />;
  }
  return <iframe src={filePath} title={title} className="w-full h-[32rem] rounded-[24px] border border-gray-200 bg-white" />;
}

function normalizeComparableValue(key, value) {
  if (key === 'willing_to_relocate') return Boolean(value);
  if (value === undefined || value === null) return '';
  return String(value);
}

function buildCandidateSnapshot(form, extra = {}) {
  return {
    ...DEFAULT_FORM,
    ...form,
    resume_path: extra.resume_path || '',
    resume_file_name: extra.resume_file_name || '',
    resume_flag: Boolean(extra.resume_path),
  };
}

function buildUpdatePayload({ form, originalSnapshot, uploadedResume, resumeRemoved }) {
  const candidateKeys = Object.keys(DEFAULT_FORM);
  const payload = {};

  candidateKeys.forEach((key) => {
    const currentValue = normalizeComparableValue(key, form[key]);
    const originalValue = normalizeComparableValue(key, originalSnapshot[key]);
    if (currentValue !== originalValue) {
      payload[key] = form[key];
    }
  });

  const nextResumePath = resumeRemoved ? '' : (uploadedResume?.path || '');
  const nextResumeName = resumeRemoved ? '' : (uploadedResume?.originalName || uploadedResume?.filename || '');
  if (normalizeComparableValue('resume_path', nextResumePath) !== normalizeComparableValue('resume_path', originalSnapshot.resume_path)) {
    payload.resume_path = nextResumePath || null;
  }
  if (normalizeComparableValue('resume_file_name', nextResumeName) !== normalizeComparableValue('resume_file_name', originalSnapshot.resume_file_name)) {
    payload.resume_file_name = nextResumeName || null;
  }
  if (resumeRemoved || Boolean(uploadedResume?.path) !== Boolean(originalSnapshot.resume_flag)) {
    payload.resume_flag = Boolean(nextResumePath);
  }

  return payload;
}

function preventScientificInput(event) {
  if (['e', 'E', '+', '-'].includes(event.key)) {
    event.preventDefault();
  }
}

function InsightPill({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  };

  return (
    <div className={`rounded-2xl px-3 py-3 ${tones[tone] || tones.slate}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

export default function AddCandidate() {
  const { jobId, id: candidateId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTalentPool = !jobId || jobId === 'pool';
  const isEdit = Boolean(candidateId);

  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [pendingDuplicate, setPendingDuplicate] = useState(null);
  const [resumeFile, setResumeFile] = useState(null);
  const [uploadedResume, setUploadedResume] = useState(null);
  const [resumeInsights, setResumeInsights] = useState(null);
  const [resumeRemoved, setResumeRemoved] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [originalSnapshot, setOriginalSnapshot] = useState(buildCandidateSnapshot(DEFAULT_FORM));

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    applicationsAPI.get(candidateId)
      .then((res) => {
        const candidate = res.data;
        const nextForm = {
          candidate_name: candidate.candidate_name || '',
          candidate_email: candidate.candidate_email || '',
          candidate_phone: candidate.candidate_phone || '',
          candidate_aadhar: candidate.candidate_aadhar || '',
          candidate_pan: candidate.candidate_pan || '',
          candidate_age: candidate.candidate_age ?? '',
          candidate_gender: candidate.candidate_gender || '',
          candidate_years_of_experience: candidate.candidate_years_of_experience ?? '',
          current_organization: candidate.current_organization || '',
          current_ctc: candidate.current_ctc ?? '',
          current_location: candidate.current_location || '',
          willing_to_relocate: Boolean(candidate.willing_to_relocate),
          education_level: candidate.education_level || '',
          education_other: candidate.education_other || '',
          source: candidate.source || '',
          referrer_emp_id: candidate.referrer_emp_id || '',
          consultant_code: candidate.consultant_code || '',
          dob: candidate.dob ? candidate.dob.split('T')[0] : '',
        };
        const nextResume = candidate.resume_path || candidate.resume_file_name
          ? {
              path: candidate.resume_path || null,
              filename: candidate.resume_file_name || null,
              originalName: candidate.resume_file_name || null,
            }
          : null;

        setForm(nextForm);
        setUploadedResume(nextResume);
        setResumeRemoved(false);
        setOriginalSnapshot(buildCandidateSnapshot(nextForm, {
          resume_path: nextResume?.path,
          resume_file_name: nextResume?.originalName || nextResume?.filename,
        }));
      })
      .catch(() => {
        toast.error('Failed to load candidate');
        navigate('/talent-pool');
      })
      .finally(() => setLoading(false));
  }, [candidateId, isEdit, navigate]);

  const onDrop = async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setResumeFile(file);
    setUploadedResume(null);
    setResumeRemoved(false);
    setResumeInsights(null);
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('resume', file);
      const res = await applicationsAPI.uploadResume(formData);
      setUploadedResume(res.data.file || null);
      if (res.data.parsed) {
        const parsed = res.data.parsed;
        setResumeInsights(parsed);
        setForm((prev) => ({
          ...prev,
          candidate_name: parsed.candidate_name ?? prev.candidate_name,
          candidate_email: parsed.candidate_email ?? prev.candidate_email,
          candidate_phone: parsed.candidate_phone ?? prev.candidate_phone,
          candidate_years_of_experience: parsed.candidate_years_of_experience ?? prev.candidate_years_of_experience,
          current_organization: parsed.current_organization ?? prev.current_organization,
          current_ctc: parsed.current_ctc ?? prev.current_ctc,
          current_location: parsed.current_location ?? prev.current_location,
          education_level: parsed.education_level ?? prev.education_level,
          education_other: parsed.education_other ?? prev.education_other,
          candidate_age: parsed.candidate_age ?? prev.candidate_age,
          candidate_gender: parsed.candidate_gender ?? prev.candidate_gender,
          candidate_aadhar: parsed.candidate_aadhar ?? prev.candidate_aadhar,
          candidate_pan: parsed.candidate_pan ?? prev.candidate_pan,
          willing_to_relocate: parsed.willing_to_relocate_flag ?? prev.willing_to_relocate,
        }));
        toast.success('Resume parsed and linked to this candidate profile');
      }
    } catch {
      toast.error('Failed to parse resume. You can still continue manually.');
    } finally {
      setParsing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
  });

  const submitCandidate = async ({ allowDuplicate = false } = {}) => {
    if (!form.candidate_name || !form.candidate_email) {
      toast.error('Name and email are required');
      return;
    }
    if (!form.source) {
      toast.error('Source is required - select how this candidate was sourced');
      return;
    }
    if (form.candidate_phone) {
      const digits = form.candidate_phone.replace(/\D/g, '');
      if (digits.length !== 10) {
        toast.error('Phone number must be exactly 10 digits');
        return;
      }
    }
    setDuplicateWarning('');
    setPendingDuplicate(null);

    setSaving(true);
    try {
      let shouldNavigate = true;
      const resumeMeta = resumeRemoved ? null : uploadedResume;
      if (isEdit) {
        const payload = buildUpdatePayload({
          form,
          originalSnapshot,
          uploadedResume: resumeMeta,
          resumeRemoved,
        });

        if (Object.keys(payload).length === 0) {
          toast('No changes to save');
          setSaving(false);
          return;
        }

        await applicationsAPI.update(candidateId, payload);
        toast.success('Candidate updated without overwriting untouched fields');
      } else {
        const data = {
          ...form,
          ats_job_id: isTalentPool ? undefined : jobId,
          talent_pool_only: isTalentPool,
          resume_flag: Boolean(resumeMeta?.path),
          resume_file_name: resumeMeta?.originalName || resumeMeta?.filename || resumeFile?.name,
          resume_path: resumeMeta?.path || undefined,
          created_by: user.email,
          recruiter_email: isTalentPool ? user.email : (form.recruiter_email || user.email),
          allow_duplicate: allowDuplicate,
        };
        const res = await applicationsAPI.create(data);
        const warnings = res.data?._warnings || [];
        if (warnings.length) {
          setDuplicateWarning(warnings[0]);
          if (allowDuplicate) {
            toast.success('Duplicate candidate added and audit details captured for admin');
          } else {
            toast('Candidate added - ' + warnings[0], { icon: '⚠️' });
            shouldNavigate = false;
          }
        } else {
          toast.success('Candidate added successfully');
        }
      }

      if (shouldNavigate) navigate(isTalentPool ? '/talent-pool' : `/jobs/${jobId}`);
    } catch (err) {
      if (!isEdit && err.response?.status === 409 && err.response?.data?.existing) {
        setPendingDuplicate(err.response.data.existing);
        setDuplicateWarning('This candidate already exists for this job. Admins will see both the original uploader and your duplicate upload if you continue.');
        toast('Duplicate candidate found. Review and continue only if this is intentional.', { icon: '⚠️' });
        return;
      }
      toast.error(err.response?.data?.error || `Failed to ${isEdit ? 'update' : 'add'} candidate`);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await submitCandidate();
  };

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const clearResume = () => {
    setResumeFile(null);
    setUploadedResume(null);
    setResumeInsights(null);
    setResumeRemoved(true);
  };

  const activeResume = resumeRemoved ? null : uploadedResume;
  const completionScore = useMemo(() => {
    const scoredFields = [
      form.candidate_name,
      form.candidate_email,
      form.candidate_phone,
      form.candidate_years_of_experience,
      form.current_organization,
      form.current_location,
      form.source,
    ];
    const completed = scoredFields.filter((item) => item !== '' && item !== null && item !== undefined).length;
    return Math.round((completed / scoredFields.length) * 100);
  }, [form]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="workspace-eyebrow">{isTalentPool ? 'Talent Pool Workspace' : 'Job Candidate Workspace'}</p>
          <h1 className="page-title mt-2">{isEdit ? 'Refine Candidate Profile' : 'Add Candidate with Resume Intelligence'}</h1>
          <p className="mt-3 max-w-3xl text-sm text-gray-600">
            Keep the resume visible while you edit, let AI pre-fill what it can, and save only the fields that changed so the rest of the profile stays intact.
          </p>
        </div>
        <button onClick={() => navigate(-1)} className="btn-secondary">&larr; Back</button>
      </div>

      <div className="workspace-grid">
        <div className="workspace-main space-y-6">
          <section className="workspace-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="workspace-kicker">Step 1</p>
                <h2 className="section-title mt-2">Attach and retain the resume</h2>
                <p className="mt-2 text-sm text-gray-600">
                  The uploaded resume is stored with this candidate record, previewable inline, and preserved on future edits unless you explicitly replace or remove it.
                </p>
              </div>
              {activeResume?.path && (
                <div className="flex gap-2">
                  <a href={activeResume.path} target="_blank" rel="noreferrer" className="btn-secondary">Open Resume</a>
                  <button type="button" onClick={clearResume} className="btn-secondary">Remove Resume</button>
                </div>
              )}
            </div>

            <div
              {...getRootProps()}
              className={`mt-5 rounded-[28px] border-2 border-dashed p-8 text-center transition-colors ${
                isDragActive
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-[#cfd6ee] bg-[#f8f9ff] hover:border-indigo-300 hover:bg-white'
              }`}
            >
              <input {...getInputProps()} />
              {parsing ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-indigo-600" />
                  <p className="text-sm font-semibold text-indigo-700">Parsing and linking the resume to this profile</p>
                </div>
              ) : activeResume?.path ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{activeResume.originalName || activeResume.filename || resumeFile?.name}</p>
                    <p className="text-xs text-gray-500">Drop another file here to replace it</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
                    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V4.5m0 0 4.5 4.5M12 4.5 7.5 9m-3 7.5v2.25A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25V16.5" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Drag and drop a resume, or click to browse</p>
                    <p className="text-xs text-gray-500">PDF, DOC, DOCX up to 10MB</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <form onSubmit={handleSubmit} className="workspace-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="workspace-kicker">Step 2</p>
                <h2 className="section-title mt-2">Complete the candidate profile</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Edit freely. This screen now saves only what changed, so later corrections no longer wipe out untouched fields or resume links.
                </p>
              </div>
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                Profile completeness: <span className="font-semibold">{completionScore}%</span>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="xl:col-span-1">
                <label className="block text-sm font-semibold text-gray-800 mb-2">Candidate Name *</label>
                <input type="text" value={form.candidate_name} onChange={(event) => updateForm('candidate_name', event.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Email *</label>
                <input type="email" value={form.candidate_email} onChange={(event) => updateForm('candidate_email', event.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Phone <span className="text-gray-400 font-normal text-xs">(10 digits)</span></label>
                <input
                  type="tel"
                  value={form.candidate_phone}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 10);
                    updateForm('candidate_phone', digits);
                  }}
                  className={`input-field ${form.candidate_phone && form.candidate_phone.replace(/\D/g,'').length !== 10 ? 'border-amber-400 focus:ring-amber-400' : ''}`}
                  maxLength={10}
                  placeholder="10-digit mobile number"
                />
                {form.candidate_phone && form.candidate_phone.replace(/\D/g,'').length !== 10 && (
                  <p className="mt-1 text-xs text-amber-600">Enter exactly 10 digits</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Gender</label>
                <select value={form.candidate_gender} onChange={(event) => updateForm('candidate_gender', event.target.value)} className="input-field">
                  <option value="">Select</option>
                  {GENDERS.map((gender) => <option key={gender} value={gender}>{gender}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Age</label>
                <input type="number" value={form.candidate_age} onChange={(event) => updateForm('candidate_age', event.target.value)} onKeyDown={preventScientificInput} className="input-field" min="16" max="70" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Years of Experience</label>
                <input type="number" value={form.candidate_years_of_experience} onChange={(event) => updateForm('candidate_years_of_experience', event.target.value)} onKeyDown={preventScientificInput} className="input-field" min="0" step="0.5" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Current Organization</label>
                <input type="text" value={form.current_organization} onChange={(event) => updateForm('current_organization', event.target.value)} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Current CTC</label>
                <input type="number" value={form.current_ctc} onChange={(event) => updateForm('current_ctc', event.target.value)} onKeyDown={preventScientificInput} className="input-field" min="0" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Current Location</label>
                <input type="text" value={form.current_location} onChange={(event) => updateForm('current_location', event.target.value)} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Aadhaar</label>
                <input type="text" value={form.candidate_aadhar} onChange={(event) => updateForm('candidate_aadhar', event.target.value)} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">PAN</label>
                <input type="text" value={form.candidate_pan} onChange={(event) => updateForm('candidate_pan', event.target.value)} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Education</label>
                <select value={form.education_level} onChange={(event) => updateForm('education_level', event.target.value)} className="input-field">
                  <option value="">Select</option>
                  {EDUCATION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>
              {form.education_level === 'Other' && (
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Education Details</label>
                  <input type="text" value={form.education_other} onChange={(event) => updateForm('education_other', event.target.value)} className="input-field" />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Source <span className="text-red-500">*</span></label>
                <select value={form.source} onChange={(event) => updateForm('source', event.target.value)} className={`input-field ${!form.source ? 'border-red-300 ring-1 ring-red-200' : ''}`} required>
                  <option value="">Select source - required</option>
                  {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
                </select>
                {!form.source && <p className="mt-1 text-xs text-red-500">Sourcing channel is required</p>}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">Date of Birth <span className="text-gray-400 font-normal text-xs">(optional)</span></label>
                <input type="date" value={form.dob} onChange={(event) => updateForm('dob', event.target.value)} className="input-field" max={new Date().toISOString().split('T')[0]} />
              </div>
              {form.source === 'Employee Referral' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Referrer Employee ID</label>
                  <input type="text" value={form.referrer_emp_id} onChange={(event) => updateForm('referrer_emp_id', event.target.value)} className="input-field" />
                </div>
              )}
              {form.source === 'Consultant' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">Consultant Code</label>
                  <input type="text" value={form.consultant_code} onChange={(event) => updateForm('consultant_code', event.target.value)} className="input-field" />
                </div>
              )}
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input type="checkbox" id="relocate" checked={form.willing_to_relocate} onChange={(event) => updateForm('willing_to_relocate', event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <label htmlFor="relocate" className="text-sm font-medium text-gray-700">Willing to Relocate</label>
              </div>
            </div>

            {duplicateWarning && (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                <div>
                  <p className="font-semibold">Duplicate phone detected</p>
                  <p className="mt-0.5">{duplicateWarning}</p>
                  {pendingDuplicate ? (
                    <button type="button" disabled={saving} onClick={() => submitCandidate({ allowDuplicate: true })} className="mt-2 font-semibold text-amber-700 underline underline-offset-2 disabled:opacity-50">
                      Continue anyway
                    </button>
                  ) : (
                    <button type="button" onClick={() => navigate(isTalentPool ? '/talent-pool' : `/jobs/${jobId}`)} className="mt-2 font-semibold text-amber-700 underline underline-offset-2">Close warning</button>
                  )}
                </div>
              </div>
            )}
            <div className="mt-8 flex flex-wrap gap-3 border-t border-gray-100 pt-5">
              <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving…' : isEdit ? 'Save Candidate Changes' : 'Create Candidate'}
              </button>
              <button type="button" onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>

        <aside className="workspace-rail">
          <section className="workspace-card">
            <p className="workspace-kicker">Profile Signal</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <InsightPill label="Destination" value={isTalentPool ? 'Talent Pool' : `Job ${jobId}`} tone="indigo" />
              <InsightPill label="Created By" value={user?.email || '-'} />
              <InsightPill label="Source" value={form.source || 'Awaiting selection'} tone="amber" />
              <InsightPill label="Resume" value={activeResume?.originalName || activeResume?.filename || 'Not attached'} tone={activeResume?.path ? 'emerald' : 'slate'} />
            </div>
          </section>

          {resumeInsights && (
            <section className="workspace-card">
              <p className="workspace-kicker">AI Summary</p>
              <h2 className="section-title mt-2">Resume intelligence</h2>
              <p className="mt-3 text-sm text-gray-700">{resumeInsights.resume_summary || 'No summary returned.'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(resumeInsights.skills || []).slice(0, 10).map((skill) => (
                  <span key={skill} className="badge bg-slate-100 text-slate-700">{skill}</span>
                ))}
              </div>
              {resumeInsights.missing_fields?.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Still missing: {resumeInsights.missing_fields.join(', ')}
                </div>
              )}
            </section>
          )}

          <section className="workspace-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="workspace-kicker">Stored Resume</p>
                <h2 className="section-title mt-2">Inline preview</h2>
              </div>
              {activeResume?.path && (
                <a href={activeResume.path} target="_blank" rel="noreferrer" className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">
                  Open
                </a>
              )}
            </div>
            <div className="mt-4">
              {activeResume?.path ? (
                renderInlinePreview(activeResume.path, activeResume.originalName || activeResume.filename || form.candidate_name || 'Resume') || (
                  <div className="rounded-[24px] border border-dashed border-gray-300 px-4 py-8 text-sm text-gray-500">
                    Inline preview works for PDFs and image files. Other formats can still be opened in a new tab.
                  </div>
                )
              ) : (
                <div className="rounded-[24px] border border-dashed border-gray-300 px-4 py-10 text-sm text-gray-500">
                  Upload a resume to keep it linked to this profile and available in later workflow screens.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
