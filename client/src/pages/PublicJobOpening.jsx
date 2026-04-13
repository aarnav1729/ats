import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';

export default function PublicJobOpening() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/public/jobs/${jobId}`);
        if (mounted) setJob(res.data || null);
      } catch {
        if (mounted) setJob(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [jobId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-[#0f2745] to-[#12335d] text-white">
        <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
          <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-white" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-[#0f2745] to-[#12335d] text-white">
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 text-center">
          <p className="workspace-eyebrow text-cyan-200">Premier Energies Careers</p>
          <h1 className="mt-3 font-['Fraunces'] text-5xl tracking-[-0.05em]">This job opening is no longer available</h1>
          <p className="mt-4 max-w-2xl text-base text-white/75">
            The QR link is valid, but this role may have been archived, unpublished, or removed from the careers page.
          </p>
          <button type="button" onClick={() => navigate('/login')} className="btn-primary mt-8">
            Go to ATS Login
          </button>
        </div>
      </div>
    );
  }

  const title = [
    job.bu_short_name || job.bu_name,
    job.location_name,
    job.phase_name,
    job.department_name,
    job.job_title,
  ].filter(Boolean).join(' - ');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-[#0f2745] to-[#12335d] text-white">
      <div className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
        <div className="rounded-[36px] border border-white/10 bg-white/8 p-8 shadow-2xl backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">Premier Energies Careers</p>
          <h1 className="mt-3 font-['Fraunces'] text-[3.4rem] leading-[0.95] tracking-[-0.05em]">{title || job.job_title || job.job_id}</h1>
          <p className="mt-4 max-w-3xl text-base text-white/75">
            Explore this live job opening from Premier Energies. This page is served specifically for shared links and QR scans so candidates and internal referrals have a real destination.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['Job ID', job.job_id],
              ['Business Unit', job.bu_name || '-'],
              ['Location / Phase', [job.location_name, job.phase_name].filter(Boolean).join(' / ') || '-'],
              ['Department', [job.department_name, job.sub_department_name].filter(Boolean).join(' / ') || '-'],
              ['Employment Type', job.job_type || '-'],
              ['Experience', job.experience_years != null ? `${job.experience_years} years` : '-'],
              ['Positions', job.total_positions || '-'],
              ['Status', job.status || '-'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[24px] border border-white/10 bg-white/7 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">{label}</p>
                <p className="mt-3 text-lg font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
            <div className="rounded-[28px] border border-white/10 bg-white/7 p-6">
              <h2 className="text-xl font-semibold text-white">Job Description</h2>
              <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/80">
                {job.job_description || 'The role details will be shared by the Premier Energies recruiting team.'}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[28px] border border-cyan-400/20 bg-gradient-to-br from-cyan-400/8 to-indigo-400/8 p-6">
                <h2 className="text-xl font-semibold text-white">Interested in this role?</h2>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  Log in to the ATS with your email OTP to continue your interaction with Premier Energies. The recruiting team can then route you through the same workflow used internally.
                </p>
                <button type="button" onClick={() => navigate('/login')} className="btn-primary mt-5">
                  Continue to ATS
                </button>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/7 p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">Public link ready</p>
                <p className="mt-3 text-sm leading-6 text-white/75">
                  This page now gives QR and shared links a valid destination instead of a dead route.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
