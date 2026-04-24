import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { misAPI, applicationsAPI, demoAPI } from '../services/api';
import InfoTip from '../components/InfoTip';
import AppModal from '../components/AppModal';
import DataTable from '../components/DataTable';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import SectionCard from '../components/ui/SectionCard';
import EmptyState from '../components/ui/EmptyState';
import StatusPill, { toneForStatus } from '../components/ui/StatusPill';
import toast from 'react-hot-toast';

const EMPTY_INSIGHTS = {
  funnel: [],
  entitySummary: [],
  monthlyOffers: [],
  backouts: { details: [], summary: {} },
  timeToFill: { details: [], averages: [], average_days: 0 },
};

const DEMO_STEPS = [
  { key: 'requisition', label: 'Requisition Created' },
  { key: 'approved',    label: 'Approved' },
  { key: 'job_opened',  label: 'Job Opened' },
  { key: 'candidates',  label: 'Candidates Added' },
  { key: 'interviews',  label: 'Interviews Scheduled' },
  { key: 'selected',    label: 'Selected' },
  { key: 'offered',     label: 'Offer Made' },
  { key: 'joined',      label: 'Joined' },
];

const DEMO_STAGE_ORDER = [
  'InQueue', 'Applied', 'Shortlisted', 'AwaitingHODResponse',
  'Round1', 'AwaitingFeedback', 'Selected', 'OfferInProcess',
  'Offered', 'OfferAccepted', 'Joined', 'HRRejected',
];

function toNumber(v) { return Number(v || 0); }
function compactNumber(v) { return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(toNumber(v)); }
function asPercent(v, total) { return total ? Math.round((toNumber(v) / total) * 100) : 0; }
function getBarWidth(v, max, min = 8) { return v && max ? `${Math.max(min, Math.round((toNumber(v) / max) * 100))}%` : '0%'; }

function buildRecruiterMomentum(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const k = row.recruiter || 'Unassigned';
    const c = map.get(k) || { recruiter: k, offers: 0, closures: 0, pendingJoins: 0, backouts: 0 };
    c.offers += toNumber(row.offers);
    c.closures += toNumber(row.closures);
    c.pendingJoins += toNumber(row.pending_joins);
    c.backouts += toNumber(row.backouts);
    map.set(k, c);
  }
  return Array.from(map.values()).sort((a, b) => toNumber(b.closures) - toNumber(a.closures) || toNumber(b.offers) - toNumber(a.offers)).slice(0, 5);
}

function buildDepartmentHealth(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const k = row.department || 'Unassigned';
    const c = map.get(k) || { department: k, open: 0, offered: 0, selected: 0, joined: 0, total: 0 };
    c.open += toNumber(row.open_count);
    c.offered += toNumber(row.offered_count);
    c.selected += toNumber(row.selected_count);
    c.joined += toNumber(row.joined_count);
    c.total += toNumber(row.total);
    map.set(k, c);
  }
  return Array.from(map.values()).sort((a, b) => (toNumber(b.open) + toNumber(b.selected)) - (toNumber(a.open) + toNumber(a.selected))).slice(0, 6);
}

function DemoProgressModal({ open, onClose, currentStep, demoRunning, demoError, demoStory }) {
  return (
    <AppModal open={open} onClose={onClose} title="Full Demo Walkthrough" subtitle="Walking through the complete hiring lifecycle end-to-end." width="compact">
      <div className="space-y-1.5">
        {DEMO_STEPS.map((step, index) => {
          const isComplete = index < currentStep;
          const isActive = index === currentStep && demoRunning;
          return (
            <div key={step.key} className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
              isComplete ? 'border-emerald-200 bg-emerald-50' : isActive ? 'border-primary-200 bg-primary-50' : 'border-line bg-white'
            }`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                isComplete ? 'bg-emerald-600 text-white' : isActive ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-400'
              }`}>
                {isComplete ? '✓' : index + 1}
              </span>
              <span className={`text-sm ${isComplete ? 'font-medium text-emerald-800' : isActive ? 'font-medium text-primary-800' : 'text-slate-500'}`}>{step.label}</span>
              {isActive && <span className="ml-auto text-xs text-primary-600">Running…</span>}
              {isComplete && <span className="ml-auto text-xs text-emerald-700">Done</span>}
            </div>
          );
        })}
        {demoError && <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{demoError}</div>}
        {!demoRunning && currentStep >= DEMO_STEPS.length && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-800">
            Demo complete — dashboard refreshing.
          </div>
        )}
        {!demoRunning && demoStory?.stage_map && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ['Requisition', demoStory.requisition?.route, demoStory.requisition?.requisition_id || 'Demo requisition'],
              ['Job', demoStory.job?.route, demoStory.job?.job_id || 'Demo job'],
              ['Selected', demoStory.stage_map?.Selected?.route, demoStory.stage_map?.Selected?.candidate_name || '—'],
              ['Joined', demoStory.stage_map?.Joined?.route, demoStory.stage_map?.Joined?.candidate_name || '—'],
            ].map(([label, route, val]) => (
              <div key={label} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-slate-900">{val}</p>
                <p className="text-xs text-slate-400">{route || '—'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppModal>
  );
}

export default function Dashboard() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [insights, setInsights] = useState(EMPTY_INSIGHTS);
  const [recentApps, setRecentApps] = useState([]);
  const [demoStory, setDemoStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [demoAction, setDemoAction] = useState(null);
  const [tatPhases, setTatPhases] = useState(null);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoError, setDemoError] = useState(null);

  useEffect(() => {
    loadDashboard();
    misAPI.tatPhases().then((r) => setTatPhases(r.data)).catch(() => {});
  }, []);

  const loadDashboard = async () => {
    try {
      if (hasRole('hr_admin', 'hr_recruiter')) {
        const [dashRes, appsRes, funnelRes, entityRes, monthlyOffersRes, backoutsRes, timeToFillRes] = await Promise.all([
          misAPI.dashboard().catch(() => ({ data: null })),
          applicationsAPI.list({ limit: 10, sort_by: 'a.created_at', sort_order: 'desc' }).catch(() => ({ data: { data: [] } })),
          misAPI.funnel().catch(() => ({ data: [] })),
          misAPI.entitySummary().catch(() => ({ data: [] })),
          misAPI.monthlyOffers().catch(() => ({ data: [] })),
          misAPI.backoutsSummary().catch(() => ({ data: { details: [], summary: {} } })),
          misAPI.timeToFill().catch(() => ({ data: { details: [], averages: [], average_days: 0 } })),
        ]);
        setStats(dashRes.data || {});
        setAiStatus(dashRes.data?.ai_status || null);
        setRecentApps(appsRes.data?.data || appsRes.data?.applications || []);
        setInsights({
          funnel: Array.isArray(funnelRes.data) ? funnelRes.data : [],
          entitySummary: Array.isArray(entityRes.data) ? entityRes.data : [],
          monthlyOffers: Array.isArray(monthlyOffersRes.data) ? monthlyOffersRes.data : [],
          backouts: backoutsRes.data || { details: [], summary: {} },
          timeToFill: timeToFillRes.data || { details: [], averages: [], average_days: 0 },
        });
        try { const s = await demoAPI.story(); setDemoStory(s.data || null); } catch { setDemoStory(null); }
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAction = async (action) => {
    setDemoAction(action);
    try {
      if (action === 'seed') { const r = await demoAPI.seed(); setDemoStory(r.data?.story || null); toast.success('Demo data seeded'); }
      else { await demoAPI.clear(); setDemoStory(null); toast.success('Demo data cleared'); }
      await loadDashboard();
    } catch (err) { toast.error(err.response?.data?.error || 'Demo action failed'); }
    finally { setDemoAction(null); }
  };

  const runFullDemo = useCallback(async () => {
    setDemoModalOpen(true); setDemoStep(0); setDemoRunning(true); setDemoError(null);
    try {
      const interval = setInterval(() => setDemoStep((p) => p < DEMO_STEPS.length - 1 ? p + 1 : p), 1200);
      const r = await demoAPI.seed();
      setDemoStory(r.data?.story || null);
      clearInterval(interval);
      setDemoStep(DEMO_STEPS.length);
      setDemoRunning(false);
      toast.success('Full demo completed');
      setTimeout(loadDashboard, 1500);
    } catch (err) {
      setDemoRunning(false);
      const msg = err.response?.data?.error || 'Full demo failed. Try seeding demo data first.';
      setDemoError(msg); toast.error(msg);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  /* ── Role-specific minimal dashboards ── */
  if (hasRole('interviewer')) {
    return (
      <div className="page-shell">
        <PageHeader
          title={`Welcome, ${user?.name || 'Interviewer'}`}
          subtitle="Your review queue, slot suggestions, and decision capture all live in Interview Hub."
        />
        <SectionCard title="Primary action" subtitle="Open your interview queue">
          <p className="text-sm text-slate-600">Review candidates, suggest slots, and submit structured feedback from one focused workspace.</p>
          <button className="btn-primary mt-4" onClick={() => navigate('/interviews?tab=Needs%20Review')}>
            Open Interview Hub
          </button>
        </SectionCard>
      </div>
    );
  }

  if (hasRole('applicant')) {
    return (
      <div className="page-shell">
        <PageHeader
          title={`Welcome, ${user?.name || 'Candidate'}`}
          subtitle="Complete onboarding steps, upload documents, and keep your hiring journey moving."
        />
        <SectionCard title="Primary action" subtitle="Open your task list">
          <p className="text-sm text-slate-600">View pending actions, upload required documents, and complete the remaining onboarding requirements.</p>
          <button className="btn-primary mt-4" onClick={() => navigate('/my-tasks')}>
            Open My Tasks
          </button>
        </SectionCard>
      </div>
    );
  }

  if (hasRole('hod') && !hasRole('hr_admin', 'hr_recruiter')) {
    return (
      <div className="page-shell">
        <PageHeader
          title={`Welcome, ${user?.name || 'HOD'}`}
          subtitle="Create demand for your team, review active interviews, and keep department hiring decisions moving."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SectionCard title="Department demand" subtitle="Manage requisitions">
            <p className="text-sm text-slate-600">Create and review requisitions for your department with clearer approval routing.</p>
            <button className="btn-primary mt-4" onClick={() => navigate('/requisitions')}>Manage Requisitions</button>
          </SectionCard>
          <SectionCard title="Candidate decisions" subtitle="Open interview hub">
            <p className="text-sm text-slate-600">Review profiles, suggest slots, and submit interview outcomes without context switching.</p>
            <button className="btn-primary mt-4" onClick={() => navigate('/interviews?tab=Needs%20Review')}>Open Interview Hub</button>
          </SectionCard>
        </div>
      </div>
    );
  }

  /* ── Full HR Admin / Recruiter dashboard ── */
  const funnelRows = Array.isArray(insights.funnel) ? insights.funnel : [];
  const funnelTotal = funnelRows.reduce((s, r) => s + toNumber(r.count), 0);
  const recruiterMomentum = buildRecruiterMomentum(insights.monthlyOffers);
  const departmentHealth = buildDepartmentHealth(insights.entitySummary);
  const maxFunnelCount = Math.max(...funnelRows.map((r) => toNumber(r.count)), 1);
  const maxRecruiterOffers = Math.max(...recruiterMomentum.map((r) => toNumber(r.offers)), 1);
  const maxDeptOpen = Math.max(...departmentHealth.map((r) => toNumber(r.open)), 1);
  const topBackout = insights.backouts?.details?.[0] || null;
  const backoutSummary = insights.backouts?.summary || {};

  return (
    <div className="page-shell space-y-8">
      <DemoProgressModal
        open={demoModalOpen}
        onClose={() => { if (!demoRunning) setDemoModalOpen(false); }}
        currentStep={demoStep}
        demoRunning={demoRunning}
        demoError={demoError}
        demoStory={demoStory}
      />

      <PageHeader
        title={`Welcome, ${user?.name || user?.email?.split('@')[0]}`}
        subtitle="Demand, screening pressure, interviewer follow-through, offer health, and conversion signal — at a glance."
        meta={
          <>
            <span className="badge badge-blue">{compactNumber(stats?.open_jobs)} open jobs</span>
            <span className="badge badge-gray">{compactNumber(stats?.total_applications)} applications</span>
            <span className="badge badge-green">{toNumber(stats?.offer_acceptance_rate)}% offer acceptance</span>
          </>
        }
        actions={
          <>
            <button onClick={() => navigate('/requisitions/create')} className="btn-primary">+ Requisition</button>
            <button onClick={() => navigate('/jobs/create')} className="btn-secondary">+ Job</button>
            {hasRole('hr_admin') && (
              <>
                <button onClick={() => handleDemoAction('seed')} disabled={demoAction !== null} className="btn-ghost btn-sm">
                  {demoAction === 'seed' ? 'Seeding…' : 'Seed demo'}
                </button>
                <button onClick={() => handleDemoAction('clear')} disabled={demoAction !== null} className="btn-ghost btn-sm">
                  {demoAction === 'clear' ? 'Clearing…' : 'Clear demo'}
                </button>
                <button onClick={runFullDemo} disabled={demoAction !== null || demoRunning} className="btn-secondary btn-sm">
                  {demoRunning ? 'Running…' : 'Run full demo'}
                </button>
              </>
            )}
          </>
        }
      />

      {/* Stat strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Open jobs" value={compactNumber(stats?.open_jobs)} hint={`${toNumber(stats?.screening) + toNumber(stats?.interviewing)} in evaluation`} />
        <StatCard label="Applications" value={compactNumber(stats?.total_applications)} hint={`${toNumber(stats?.in_queue)} in queue`} />
        <StatCard label="Offers made" value={compactNumber(stats?.offers_made)} hint={`${toNumber(stats?.offered)} in offer stage`} />
        <StatCard label="Joined / month" value={compactNumber(stats?.joined_this_month)} hint={`${toNumber(backoutSummary.total_backouts)} backouts`} />
        <StatCard label="Offer acceptance" value={`${toNumber(stats?.offer_acceptance_rate)}%`} hint="Accepted vs issued" />
        <StatCard label="Avg time to fill" value={`${toNumber(insights.timeToFill?.average_days || stats?.avg_time_to_fill)}d`} hint="Req → first offer" />
      </div>

      {/* Funnel + Needs Attention */}
      <div className="grid gap-5 xl:grid-cols-[1.3fr,0.9fr]">
        <SectionCard
          title="Pipeline composition"
          subtitle="Where the funnel is building up right now"
          actions={<button onClick={() => navigate('/mis')} className="btn-ghost btn-sm">Open MIS →</button>}
        >
          {funnelRows.length === 0 ? (
            <EmptyState title="No funnel data" description="Populates as applications are created and moved." />
          ) : (
            <div className="space-y-2">
              {funnelRows.map((row) => (
                <button
                  key={row.stage}
                  type="button"
                  onClick={() => navigate('/mis')}
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-300 hover:bg-surface-hover"
                >
                  <StatusPill tone={toneForStatus(row.stage)} className="shrink-0">{row.stage}</StatusPill>
                  <div className="min-w-0 flex-1">
                    <div className="line-meter">
                      <div className="line-meter-fill" style={{ width: getBarWidth(row.count, maxFunnelCount, 6) }} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-navy-700">{compactNumber(row.count)}</p>
                    <p className="text-[10px] text-slate-500">{asPercent(row.count, funnelTotal)}%</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="Needs attention"
            subtitle="Queues that will move the week"
            actions={<InfoTip text="These cards pull the most actionable pressure points so the team can decide where to intervene first." />}
          >
            <div className="space-y-2">
              {[
                { label: 'Screening queue', value: compactNumber(toNumber(stats?.screening) + toNumber(stats?.in_queue)), note: 'Profiles waiting on recruiter qualification or routing.', route: '/jobs' },
                { label: 'Interview load', value: compactNumber(stats?.interviewing), note: 'Active reviews, panels, and follow-ups in motion.', route: '/interviews?tab=Needs%20Review' },
                { label: 'Offer risk', value: compactNumber(backoutSummary.total_backouts), note: topBackout?.reason || 'No active backout reason captured yet.', route: '/mis' },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => navigate(item.route)}
                  className="flex w-full items-start justify-between gap-3 rounded-md border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-300 hover:bg-surface-hover"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-700">{item.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.note}</p>
                  </div>
                  <p className="text-lg font-semibold text-navy-800">{item.value}</p>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Quick actions" subtitle="Move from signal to action without hunting">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Create Requisition', route: '/requisitions/create' },
                { label: 'Open Jobs', route: '/jobs' },
                { label: 'Interview Hub', route: '/interviews?tab=Needs%20Review' },
                { label: 'MIS Reports', route: '/mis' },
              ].map((item) => (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => navigate(item.route)}
                  className="rounded-md border border-line bg-white px-3 py-2.5 text-left text-sm font-medium text-navy-700 transition-colors hover:border-primary-300 hover:bg-surface-hover"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Process TAT Timeline */}
      {tatPhases && (
        <SectionCard
          title="Process TAT timeline"
          subtitle="Velocity across each phase of the hiring lifecycle"
          actions={<button onClick={() => navigate('/mis')} className="btn-ghost btn-sm">Full report →</button>}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              { label: 'Req created', sub: 'Start', value: null },
              { label: 'Approved', sub: `${tatPhases.requisition_tat?.avg_req_to_approval_days ?? '—'}d`, value: tatPhases.requisition_tat?.avg_req_to_approval_days },
              { label: 'Job created', sub: `${tatPhases.job_creation_tat?.avg_approval_to_job_days ?? '—'}d`, value: tatPhases.job_creation_tat?.avg_approval_to_job_days },
              { label: '1st candidate', sub: `${tatPhases.candidate_milestone_tat?.avg_days_to_first_candidate ?? '—'}d`, value: tatPhases.candidate_milestone_tat?.avg_days_to_first_candidate },
              { label: '5th candidate', sub: `${tatPhases.candidate_milestone_tat?.avg_days_to_fifth_candidate ?? '—'}d`, value: tatPhases.candidate_milestone_tat?.avg_days_to_fifth_candidate },
              { label: '10th candidate', sub: `${tatPhases.candidate_milestone_tat?.avg_days_to_tenth_candidate ?? '—'}d`, value: tatPhases.candidate_milestone_tat?.avg_days_to_tenth_candidate },
            ].map((phase, i) => (
              <div key={phase.label} className="rounded-xl border border-line bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                    i === 0 ? 'border border-slate-200 bg-white text-slate-600' : 'border border-primary-200 bg-primary-50 text-primary-700'
                  }`}>
                    {i + 1}
                  </div>
                  {phase.value != null ? <span className="text-[10px] font-semibold text-slate-500">{phase.value}d</span> : null}
                </div>
                <p className="mt-3 text-sm font-semibold leading-tight text-slate-800">{phase.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{phase.sub}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Department + Recruiter */}
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Department hiring pressure" subtitle="Where demand is concentrated right now">
          {departmentHealth.length === 0 ? (
            <EmptyState title="No department data yet" description="Populates once jobs and applications are active." />
          ) : (
            <div className="space-y-2">
              {departmentHealth.map((dept) => (
                <div key={dept.department} className="rounded-md border border-line bg-white px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-navy-700">{dept.department}</p>
                    <div className="flex gap-3 text-[11px] text-slate-500">
                      <span>{compactNumber(dept.open)} open</span>
                      <span>{compactNumber(dept.joined)} joined</span>
                    </div>
                  </div>
                  <div className="line-meter">
                    <div className="line-meter-fill" style={{ width: getBarWidth(dept.open, maxDeptOpen, 8) }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recruiter delivery" subtitle="Monthly offer momentum per recruiter">
          {recruiterMomentum.length === 0 ? (
            <EmptyState title="No recruiter data yet" description="Populates as offers and closures are recorded." />
          ) : (
            <div className="space-y-2">
              {recruiterMomentum.map((r) => (
                <div key={r.recruiter} className="rounded-md border border-line bg-white px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-navy-700">{r.recruiter}</p>
                    <div className="flex gap-3 text-[11px] text-slate-500">
                      <span>{compactNumber(r.offers)} offers</span>
                      <span>{compactNumber(r.closures)} closes</span>
                    </div>
                  </div>
                  <div className="line-meter">
                    <div className="line-meter-fill" style={{ width: getBarWidth(r.offers, maxRecruiterOffers, 8) }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Conversion + AI status */}
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Conversion signals" subtitle="A tighter read on what converts">
          <div className="space-y-1.5">
            {[
              ['Selected to offered', toNumber(stats?.selected) > 0 ? `${Math.round((toNumber(stats?.offered) / Math.max(toNumber(stats?.selected), 1)) * 100)}%` : '0%'],
              ['Join potential', compactNumber(toNumber(stats?.offers_made) - toNumber(backoutSummary.total_backouts))],
              ['Time to fill', `${toNumber(insights.timeToFill?.average_days || stats?.avg_time_to_fill)} days`],
              ['Avg time to join', `${toNumber(stats?.avg_time_to_join)} days`],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-2">
                <p className="text-sm text-slate-600">{label}</p>
                <p className="text-sm font-semibold text-navy-800">{val}</p>
              </div>
            ))}
          </div>
          {topBackout && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Backout snapshot</p>
              <p className="mt-1 text-sm font-semibold text-amber-900">{topBackout.reason}</p>
              <p className="mt-0.5 text-xs text-amber-700">{compactNumber(topBackout.count)} candidates impacted</p>
            </div>
          )}
        </SectionCard>

        {aiStatus && (
          <SectionCard title="AI runtime" subtitle="Model powering JD generation, analytics, and parsing">
            <div className="flex flex-wrap gap-2">
              <span className={`status-pill ${aiStatus.available ? 'status-pill-success' : 'status-pill-warning'}`}>
                {aiStatus.available ? `Connected · ${aiStatus.model}` : `Fallback · ${aiStatus.model || 'Ollama'}`}
              </span>
              {aiStatus.base_url && <span className="glass-chip font-mono text-[11px]">{aiStatus.base_url}</span>}
            </div>
            {aiStatus.last_error
              ? <p className="mt-3 text-sm text-amber-700">{aiStatus.last_error}</p>
              : <p className="mt-3 text-sm leading-relaxed text-slate-600">Supports JD generation, analytics answers, reminders, and parsing enhancements across the stack.</p>}
          </SectionCard>
        )}
      </div>

      {/* Demo Journey */}
      {(demoStory?.job || demoStory?.requisition) && (
        <SectionCard
          title="Demo journey"
          subtitle="Click-through walk of the seeded demo data"
          actions={hasRole('hr_admin') && (
            <button onClick={runFullDemo} disabled={demoRunning} className="btn-ghost btn-sm disabled:opacity-50">
              {demoRunning ? 'Preparing…' : 'Rebuild demo'}
            </button>
          )}
        >
          {demoStory?.stage_map ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['Requisition', demoStory.requisition?.route, demoStory.requisition?.requisition_id || 'Not ready'],
                  ['Job', demoStory.job?.route, demoStory.job?.job_id || 'Not ready'],
                  ['Public Job', demoStory.job?.public_route, demoStory.job?.job_title || 'Not ready'],
                  ['Joined', demoStory.stage_map?.Joined?.route, demoStory.stage_map?.Joined?.candidate_name || 'Not ready'],
                ].map(([label, route, val]) => (
                  <button key={label} type="button" onClick={() => route && navigate(route)}
                    className="rounded-md border border-line bg-surface-muted px-3 py-2 text-left transition-colors hover:bg-surface-hover">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-slate-900">{val}</p>
                    <p className="text-xs text-slate-400">{route || 'Seed demo data'}</p>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {DEMO_STAGE_ORDER.map((stage) => {
                  const entry = demoStory.stage_map?.[stage];
                  return (
                    <button key={stage} type="button" onClick={() => entry?.route && navigate(entry.route)}
                      className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                        entry?.route ? 'border-line bg-white hover:bg-surface-hover' : 'border-dashed border-line bg-surface-muted'
                      }`}>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{stage}</p>
                      <p className="mt-0.5 font-medium text-slate-900">{entry?.candidate_name || '—'}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Seed demo data to unlock a click-through journey.</p>
          )}
        </SectionCard>
      )}

      {/* Recent Applications */}
      <DataTable
        title="Recent applications"
        subtitle="Latest candidate movement across the active hiring system"
        data={recentApps}
        exportFileName="recent-applications"
        emptyMessage="No applications yet."
        onRowClick={(row) => navigate(`/applications/${row.id}/workflow`)}
        columns={[
          { key: 'candidate_name', label: 'Candidate', render: (row) => (
            <div>
              <p className="text-sm font-medium text-slate-900">{row.candidate_name}</p>
              <p className="text-xs text-slate-500">{row.candidate_email}</p>
            </div>
          )},
          { key: 'ats_job_id', label: 'Job', render: (row) => <span className="text-sm text-slate-700">{row.ats_job_id || 'Talent Pool'}</span> },
          { key: 'status', label: 'Status', render: (row) => <StatusPill tone={toneForStatus(row.status)}>{row.status}</StatusPill> },
          { key: 'created_at', label: 'Applied', render: (row) => <span className="text-sm text-slate-500">{new Date(row.created_at).toLocaleDateString()}</span> },
        ]}
      />
    </div>
  );
}
