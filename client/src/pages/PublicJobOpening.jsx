import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';

// Weighted fields drive the "% complete" meter.
const FORM_FIELDS = [
  { key: 'candidate_name', label: 'Full name', required: true, weight: 2 },
  { key: 'candidate_email', label: 'Email', required: true, weight: 2, type: 'email' },
  { key: 'candidate_phone', label: 'Phone (10 digits)', required: true, weight: 2, type: 'tel' },
  { key: 'candidate_years_of_experience', label: 'Years of experience', weight: 1, type: 'number', step: 0.5 },
  { key: 'current_organization', label: 'Current employer', weight: 1 },
  { key: 'current_designation', label: 'Current designation', weight: 1 },
  { key: 'current_ctc', label: 'Current CTC (₹ LPA)', weight: 1, type: 'number', step: 0.1 },
  { key: 'current_location', label: 'Current location', weight: 1 },
  { key: 'willing_to_relocate', label: 'Willing to relocate?', weight: 1, type: 'select', options: ['Yes', 'No'] },
  { key: 'education_level', label: 'Education level', weight: 1, type: 'select', options: ['PhD', 'Masters', 'Bachelors', 'Diploma', '12th', '10th', 'Other'] },
  { key: 'candidate_gender', label: 'Gender', weight: 1, type: 'select', options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
  { key: 'candidate_age', label: 'Age', weight: 1, type: 'number' },
  { key: 'skills', label: 'Key skills (comma separated)', weight: 1, full: true },
  { key: 'linkedin', label: 'LinkedIn profile (optional)', weight: 1, full: true },
];

function normalizePhone(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 10);
}

// Map whatever parseResume returns into our form state.
function mapParsedToForm(parsed) {
  if (!parsed || typeof parsed !== 'object') return {};
  const p = parsed;

  const relocate = p.willing_to_relocate_flag ?? p.willing_to_relocate;
  const willing =
    relocate === true || relocate === 'true' || relocate === 1 ? 'Yes' :
    relocate === false || relocate === 'false' || relocate === 0 ? 'No' : '';

  const skillsArr = Array.isArray(p.skills) ? p.skills
    : Array.isArray(p.key_skills) ? p.key_skills
      : typeof p.skills === 'string' ? p.skills.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
        : [];

  return {
    candidate_name: p.candidate_name || p.name || p.full_name || '',
    candidate_email: p.candidate_email || p.email || '',
    candidate_phone: normalizePhone(p.candidate_phone || p.phone || p.mobile),
    candidate_years_of_experience:
      p.candidate_years_of_experience ?? p.total_experience_years ?? p.experience_years ?? p.experience ?? '',
    current_organization: p.current_organization || p.current_company || p.company || '',
    current_designation: p.current_designation || p.designation || p.job_title || '',
    current_ctc: p.current_ctc ?? p.ctc ?? '',
    current_location: p.current_location || p.location || p.city || '',
    willing_to_relocate: willing,
    education_level: p.education_level || '',
    candidate_gender: p.candidate_gender || p.gender || '',
    candidate_age: p.candidate_age ?? p.age ?? '',
    skills: skillsArr.slice(0, 20).join(', '),
    linkedin: p.linkedin || p.linkedin_url || '',
  };
}

export default function PublicJobOpening() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({});
  const [parsing, setParsing] = useState(false);
  const [parseQuality, setParseQuality] = useState(null);
  const [resumeFileName, setResumeFileName] = useState('');
  const [resumePath, setResumePath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [dragging, setDragging] = useState(false);

  // ── Load job ────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/public/jobs/${jobId}`);
        if (mounted) setJob(res.data || null);
      } catch {
        if (mounted) setJob(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [jobId]);

  // ── Completion % ────────────────────────────────────────────────────────
  const completion = useMemo(() => {
    const totalWeight = FORM_FIELDS.reduce((s, f) => s + f.weight, 0);
    let filled = 0;
    FORM_FIELDS.forEach((f) => {
      const v = form[f.key];
      if (v !== undefined && v !== null && String(v).trim() !== '') filled += f.weight;
    });
    const resumeWeight = 3;
    const withResume = resumePath ? resumeWeight : 0;
    const pct = Math.round(((filled + withResume) / (totalWeight + resumeWeight)) * 100);
    return Math.min(100, Math.max(0, pct));
  }, [form, resumePath]);

  const tone = completion >= 80 ? 'emerald' : completion >= 50 ? 'sky' : 'amber';
  const message = completion >= 80
    ? 'Excellent - recruiters love complete profiles. Your application stands out.'
    : completion >= 50
      ? 'Good start. A few more fields and you significantly improve your chances.'
      : 'The more details you share, the better we can match you to this role. Upload your resume to auto-fill.';

  // ── Upload + parse ──────────────────────────────────────────────────────
  async function handleResume(file) {
    if (!file) return;
    if (!/\.(pdf|docx?|rtf|txt)$/i.test(file.name)) {
      toast.error('Upload a PDF, DOC, DOCX, RTF, or TXT resume');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Resume must be under 10 MB');
      return;
    }

    setParsing(true);
    setResumeFileName(file.name);
    try {
      const fd = new FormData();
      fd.append('resume', file);
      const res = await axios.post('/api/public/parse-resume', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000,
      });
      const parsed = res.data?.parsed || {};
      const parsedMap = mapParsedToForm(parsed);
      // Preserve anything the user already typed; fill blanks with parsed data.
      setForm((prev) => {
        const next = { ...parsedMap };
        Object.entries(prev).forEach(([k, v]) => {
          if (v && String(v).trim() !== '') next[k] = v;
        });
        return next;
      });
      setResumePath(res.data?.file?.path || '');
      setParseQuality(parsed.parse_quality || null);
      const q = parsed.parse_quality;
      if (q === 'high') toast.success('Resume parsed - please review and confirm');
      else if (q === 'medium') toast.success('Resume parsed - please fill any missing details');
      else toast('Resume read, but some fields need manual input', { icon: '📝' });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to parse resume. You can still apply manually.');
      setResumePath('');
    } finally {
      setParsing(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleResume(file);
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();

    if (!form.candidate_name || !form.candidate_email) {
      toast.error('Name and email are required');
      return;
    }
    const phoneClean = normalizePhone(form.candidate_phone);
    if (phoneClean && phoneClean.length !== 10) {
      toast.error('Phone must be 10 digits');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        candidate_phone: phoneClean || null,
        willing_to_relocate: form.willing_to_relocate === 'Yes',
        resume_path: resumePath || null,
        resume_file_name: resumeFileName || null,
        resume_flag: Boolean(resumePath),
        source: 'Company Website',
      };
      const res = await axios.post(`/api/public/jobs/${jobId}/apply`, payload, { timeout: 45000 });
      setSubmitted(res.data);
      toast.success(res.data?.message || 'Application submitted');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  function setField(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  // ── Render guards ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="flex min-h-screen w-full items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-sky-600" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="flex min-h-screen w-full flex-col items-center justify-center px-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Premier Energies Careers</p>
          <h1 className="mt-3 font-['Fraunces'] text-4xl tracking-[-0.04em] md:text-5xl">This job opening is no longer available</h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">
            The link is valid, but this role may have been archived or unpublished.
          </p>
          <button type="button" onClick={() => navigate('/login')} className="mt-8 rounded-full bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">Go to ATS Login</button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="flex min-h-screen w-full flex-col items-center justify-center px-6 text-center">
          <div className="rounded-full bg-emerald-100 p-4">
            <svg className="h-10 w-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Premier Energies Careers</p>
          <h1 className="mt-3 font-['Fraunces'] text-4xl tracking-[-0.04em] md:text-5xl">
            {submitted.already_applied ? 'You have already applied' : 'Application received'}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-600">{submitted.message}</p>
          {submitted.application_id && (
            <p className="mt-6 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm">
              Reference: <span className="font-mono font-semibold text-slate-900">{submitted.application_id}</span>
            </p>
          )}
          <button type="button" onClick={() => navigate('/login')} className="mt-8 rounded-full border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Return to ATS</button>
        </div>
      </div>
    );
  }

  const title = [job.bu_short_name || job.bu_name, job.location_name, job.phase_name, job.department_name, job.job_title].filter(Boolean).join(' · ');
  const compRange = (job.compensation_min || job.compensation_max)
    ? `${job.currency || 'INR'} ${job.compensation_min || '?'} – ${job.compensation_max || '?'}`
    : null;

  const toneBar = tone === 'emerald' ? 'bg-emerald-500' : tone === 'sky' ? 'bg-sky-500' : 'bg-amber-500';
  const toneText = tone === 'emerald' ? 'text-emerald-700' : tone === 'sky' ? 'text-sky-700' : 'text-amber-700';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white">
        <div className="w-full px-6 py-8 lg:px-12 lg:py-10">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Premier Energies Careers</p>
            <button type="button" onClick={() => navigate('/login')} className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 hover:text-slate-900">
              ATS Sign-in →
            </button>
          </div>
          <h1 className="mt-3 font-['Fraunces'] text-3xl leading-[1.05] tracking-[-0.04em] md:text-[2.75rem] lg:text-[3.25rem]">
            {title || job.job_title || job.job_id}
          </h1>
          <p className="mt-3 max-w-4xl text-sm text-slate-600 md:text-base">
            Build India's solar manufacturing future. Drop your resume below and we'll auto-fill the details for you - the more you share, the stronger your application.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['Job ID', job.job_id],
              ['Business Unit', job.bu_name || '—'],
              ['Location', [job.location_name, job.phase_name].filter(Boolean).join(' · ') || '—'],
              ['Department', [job.department_name, job.sub_department_name].filter(Boolean).join(' · ') || '—'],
              ['Employment', job.job_type || '—'],
              ['Experience', job.experience_years != null ? `${job.experience_years} yrs` : '—'],
              ['Positions', job.total_positions || '—'],
              ['Compensation', compRange || 'On discussion'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 break-words">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main: JD + apply form ──────────────────────────────────────── */}
      <main className="w-full px-6 py-8 lg:px-12 lg:py-10">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* JD card */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:sticky xl:top-6">
            <h2 className="text-lg font-semibold text-slate-900">About the role</h2>
            <div className="mt-3 whitespace-pre-wrap text-[13.5px] leading-7 text-slate-700">
              {job.job_description || 'The role details will be shared by the Premier Energies recruiting team.'}
            </div>
          </section>

          {/* Apply form */}
          <form onSubmit={handleSubmit} className="rounded-2xl border border-sky-200 bg-white p-6 shadow-sm">
            {/* Completion meter */}
            <div className="mb-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-900">Application completion</span>
                <span className={`font-mono text-base font-bold ${toneText}`}>{completion}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full transition-all duration-500 ${toneBar}`} style={{ width: `${completion}%` }} />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{message}</p>
            </div>

            {/* Resume drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mb-6 cursor-pointer rounded-2xl border-2 border-dashed px-5 py-6 text-center transition ${
                dragging ? 'border-sky-500 bg-sky-50'
                : resumePath ? 'border-emerald-400 bg-emerald-50'
                  : 'border-slate-300 bg-slate-50 hover:border-sky-400 hover:bg-sky-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.rtf,.txt"
                onChange={(e) => handleResume(e.target.files?.[0])}
                className="hidden"
              />
              {parsing ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-sky-600" />
                  <p className="text-sm text-slate-700">Parsing your resume with AI…</p>
                  <p className="text-xs text-slate-500">This can take up to a minute</p>
                </div>
              ) : resumePath ? (
                <div>
                  <p className="text-sm font-semibold text-emerald-700">✓ Resume uploaded & parsed</p>
                  <p className="mt-1 break-all text-xs text-slate-600">{resumeFileName}</p>
                  {parseQuality && (
                    <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      parseQuality === 'high' ? 'bg-emerald-100 text-emerald-800'
                      : parseQuality === 'medium' ? 'bg-sky-100 text-sky-800'
                      : 'bg-amber-100 text-amber-800'
                    }`}>
                      Parse quality: {parseQuality}
                    </span>
                  )}
                  <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">Click to replace</p>
                </div>
              ) : (
                <div>
                  <p className="text-base font-semibold text-slate-900">Drop your resume here</p>
                  <p className="mt-1 text-sm text-slate-600">or click to browse · PDF, DOC, DOCX, RTF, TXT · up to 10 MB</p>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-sky-700">AI auto-fills the form below</p>
                </div>
              )}
            </div>

            {/* Form fields */}
            <div className="grid gap-4 sm:grid-cols-2">
              {FORM_FIELDS.map((f) => {
                const value = form[f.key] ?? '';
                const common = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100';
                return (
                  <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                      {f.label} {f.required && <span className="text-rose-500">*</span>}
                    </label>
                    {f.type === 'select' ? (
                      <select value={value} onChange={(e) => setField(f.key, e.target.value)} className={common}>
                        <option value="">—</option>
                        {f.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.type || 'text'}
                        step={f.step}
                        value={value}
                        onChange={(e) => setField(f.key, f.key === 'candidate_phone' ? normalizePhone(e.target.value) : e.target.value)}
                        className={common}
                        required={f.required}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={submitting || parsing}
              className="mt-7 w-full rounded-full bg-gradient-to-r from-sky-600 to-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:from-sky-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : `Submit application · ${completion}% complete`}
            </button>
            <p className="mt-3 text-center text-[11px] text-slate-500">
              By applying, you consent to Premier Energies processing your details for recruitment purposes only.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
