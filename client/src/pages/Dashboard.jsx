import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { misAPI, applicationsAPI, demoAPI } from '../services/api';
import InfoTip from '../components/InfoTip';
import AppModal from '../components/AppModal';
import DataTable from '../components/DataTable';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  InQueue: 'bg-gray-100 text-gray-700',
  Applied: 'bg-blue-100 text-blue-700',
  Shortlisted: 'bg-indigo-100 text-indigo-700',
  Selected: 'bg-emerald-100 text-emerald-700',
  Offered: 'bg-teal-100 text-teal-700',
  Joined: 'bg-green-200 text-green-800',
  HRRejected: 'bg-red-100 text-red-700',
  Withdrawn: 'bg-gray-200 text-gray-600',
};

const FUNNEL_COLORS = [
  'bg-slate-400',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-green-600',
];

const EMPTY_INSIGHTS = {
  funnel: [],
  entitySummary: [],
  monthlyOffers: [],
  backouts: { details: [], summary: {} },
  timeToFill: { details: [], averages: [], average_days: 0 },
};

const DEMO_STEPS = [
  { key: 'requisition', label: 'Requisition Created', icon: '1' },
  { key: 'approved', label: 'Approved', icon: '2' },
  { key: 'job_opened', label: 'Job Opened', icon: '3' },
  { key: 'candidates', label: 'Candidates Added', icon: '4' },
  { key: 'interviews', label: 'Interviews Scheduled', icon: '5' },
  { key: 'selected', label: 'Selected', icon: '6' },
  { key: 'offered', label: 'Offer Made', icon: '7' },
  { key: 'joined', label: 'Joined', icon: '8' },
];
const DEMO_STAGE_ORDER = [
  'InQueue',
  'Applied',
  'Shortlisted',
  'AwaitingHODResponse',
  'Round1',
  'AwaitingFeedback',
  'Selected',
  'OfferInProcess',
  'Offered',
  'OfferAccepted',
  'Joined',
  'HRRejected',
];

function toNumber(value) {
  return Number(value || 0);
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(toNumber(value));
}

function asPercent(value, total) {
  if (!total) return 0;
  return Math.round((toNumber(value) / total) * 100);
}

function getBarWidth(value, maxValue, minimum = 10) {
  if (!value || !maxValue) return '0%';
  return `${Math.max(minimum, Math.round((toNumber(value) / maxValue) * 100))}%`;
}

function buildRecruiterMomentum(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const recruiter = row.recruiter || 'Unassigned';
    const current = grouped.get(recruiter) || {
      recruiter,
      offers: 0,
      closures: 0,
      pendingJoins: 0,
      backouts: 0,
    };

    current.offers += toNumber(row.offers);
    current.closures += toNumber(row.closures);
    current.pendingJoins += toNumber(row.pending_joins);
    current.backouts += toNumber(row.backouts);
    grouped.set(recruiter, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => (
      toNumber(right.closures) - toNumber(left.closures)
      || toNumber(right.offers) - toNumber(left.offers)
    ))
    .slice(0, 5);
}

function buildDepartmentHealth(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const key = row.department || 'Unassigned';
    const current = grouped.get(key) || {
      department: key,
      open: 0,
      offered: 0,
      selected: 0,
      joined: 0,
      total: 0,
    };

    current.open += toNumber(row.open_count);
    current.offered += toNumber(row.offered_count);
    current.selected += toNumber(row.selected_count);
    current.joined += toNumber(row.joined_count);
    current.total += toNumber(row.total);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => (
      (toNumber(right.open) + toNumber(right.selected)) - (toNumber(left.open) + toNumber(left.selected))
    ))
    .slice(0, 6);
}

function EmptyState({ message }) {
  return <p className="text-sm text-gray-400 py-8 text-center">{message}</p>;
}

function DemoProgressModal({ open, onClose, currentStep, demoRunning, demoError, demoStory }) {
  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Full Demo Walkthrough"
      subtitle="Walking through the complete hiring lifecycle end-to-end."
      width="compact"
    >
      <div className="py-2">
        <div className="space-y-1">
          {DEMO_STEPS.map((step, index) => {
            const isComplete = index < currentStep;
            const isActive = index === currentStep && demoRunning;
            const isPending = index > currentStep || (index === currentStep && !demoRunning && !isComplete);

            let statusClass = 'border-gray-200 bg-white text-gray-400';
            let iconClass = 'border-gray-200 bg-gray-50 text-gray-400';
            let labelClass = 'text-gray-400';

            if (isComplete) {
              statusClass = 'border-emerald-200 bg-emerald-50/50';
              iconClass = 'border-emerald-300 bg-emerald-500 text-white';
              labelClass = 'text-emerald-800 font-medium';
            } else if (isActive) {
              statusClass = 'border-indigo-300 bg-indigo-50/60';
              iconClass = 'border-indigo-400 bg-indigo-500 text-white animate-pulse';
              labelClass = 'text-indigo-900 font-semibold';
            }

            return (
              <div key={step.key} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-300 ${statusClass}`}>
                <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all duration-300 ${iconClass}`}>
                  {isComplete ? '\u2713' : step.icon}
                </span>
                <span className={`text-sm transition-colors duration-300 ${labelClass}`}>
                  {step.label}
                </span>
                {isActive && (
                  <span className="ml-auto text-xs text-indigo-500 font-medium">Processing...</span>
                )}
                {isComplete && (
                  <span className="ml-auto text-xs text-emerald-600">Done</span>
                )}
              </div>
            );
          })}
        </div>

        {demoError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {demoError}
          </div>
        )}

        {!demoRunning && currentStep >= DEMO_STEPS.length && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 font-medium text-center">
            Demo complete -- all stages populated. Dashboard will refresh.
          </div>
        )}

        {!demoRunning && demoStory?.stage_map ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              ['requisition', demoStory.requisition?.route, demoStory.requisition?.requisition_id || 'Demo requisition'],
              ['job_opened', demoStory.job?.route, demoStory.job?.job_id || 'Demo job'],
              ['selected', demoStory.stage_map?.Selected?.route, demoStory.stage_map?.Selected?.candidate_name || 'Selected candidate'],
              ['joined', demoStory.stage_map?.Joined?.route, demoStory.stage_map?.Joined?.candidate_name || 'Joined candidate'],
            ].map(([key, route, label]) => (
              <div key={key} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{key.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{label}</p>
                <p className="mt-1 text-xs text-gray-500">{route || 'No route available'}</p>
              </div>
            ))}
          </div>
        ) : null}
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

  // Full demo state machine
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoError, setDemoError] = useState(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      if (hasRole('hr_admin', 'hr_recruiter')) {
        const [
          dashRes,
          appsRes,
          funnelRes,
          entityRes,
          monthlyOffersRes,
          backoutsRes,
          timeToFillRes,
        ] = await Promise.all([
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
        try {
          const storyRes = await demoAPI.story();
          setDemoStory(storyRes.data || null);
        } catch {
          setDemoStory(null);
        }
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
      if (action === 'seed') {
        const seedRes = await demoAPI.seed();
        setDemoStory(seedRes.data?.story || null);
        toast.success('Demo data seeded');
      } else {
        await demoAPI.clear();
        setDemoStory(null);
        toast.success('Demo data cleared');
      }
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Demo action failed');
    } finally {
      setDemoAction(null);
    }
  };

  const runFullDemo = useCallback(async () => {
    setDemoModalOpen(true);
    setDemoStep(0);
    setDemoRunning(true);
    setDemoError(null);

    try {
      // Simulate step progression while the API call runs
      const stepInterval = setInterval(() => {
        setDemoStep((prev) => {
          if (prev < DEMO_STEPS.length - 1) return prev + 1;
          return prev;
        });
      }, 1200);

      const seedRes = await demoAPI.seed();
      setDemoStory(seedRes.data?.story || null);

      clearInterval(stepInterval);
      // Mark all steps complete
      setDemoStep(DEMO_STEPS.length);
      setDemoRunning(false);
      toast.success('Full demo completed successfully');

      // Refresh dashboard after short delay
      setTimeout(async () => {
        await loadDashboard();
      }, 1500);
    } catch (err) {
      setDemoRunning(false);
      const message = err.response?.data?.error || 'Full demo failed. Try seeding demo data first.';
      setDemoError(message);
      toast.error(message);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // -- Interviewer view --
  if (hasRole('interviewer')) {
    return (
      <div className="workspace-shell">
        <div className="aurora-panel animate-fade-in-up" style={{ padding: '2rem' }}>
          <div className="aurora-content">
            <h1 className="page-title" style={{ color: 'white' }}>Welcome, {user?.name || 'Interviewer'}</h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
              Your interview tasks and candidate reviews are in the Interview Hub.
            </p>
          </div>
        </div>
        <div className="workspace-card mt-6 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/interviews?tab=Needs%20Review')}>
          <h3 className="section-title">Interview Hub</h3>
          <p className="text-gray-500 mt-2 text-sm">Review candidates, suggest slots, and submit structured feedback.</p>
          <button className="btn-primary mt-4">Open Interview Hub</button>
        </div>
      </div>
    );
  }

  // -- Applicant view --
  if (hasRole('applicant')) {
    return (
      <div className="workspace-shell">
        <div className="aurora-panel animate-fade-in-up" style={{ padding: '2rem' }}>
          <div className="aurora-content">
            <h1 className="page-title" style={{ color: 'white' }}>Welcome, {user?.name || 'Candidate'}</h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
              Complete your onboarding tasks and upload required documents.
            </p>
          </div>
        </div>
        <div className="workspace-card mt-6 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/my-tasks')}>
          <h3 className="section-title">My Tasks</h3>
          <p className="text-gray-500 mt-2 text-sm">View and complete your onboarding tasks, upload required documents.</p>
          <button className="btn-primary mt-4">Open My Tasks</button>
        </div>
      </div>
    );
  }

  // -- HOD view (non-HR) --
  if (hasRole('hod') && !hasRole('hr_admin', 'hr_recruiter')) {
    return (
      <div className="workspace-shell">
        <div className="aurora-panel animate-fade-in-up" style={{ padding: '2rem' }}>
          <div className="aurora-content">
            <h1 className="page-title" style={{ color: 'white' }}>Welcome, {user?.name || 'HOD'}</h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
              Manage requisitions for your department and review interview candidates.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <div className="workspace-card cursor-pointer hover:shadow-md transition-shadow animate-fade-in-up" onClick={() => navigate('/requisitions')}>
            <h3 className="section-title">Requisitions</h3>
            <p className="text-gray-500 mt-2 text-sm">Create and manage hiring requisitions for your department.</p>
            <button className="btn-primary mt-4">Manage Requisitions</button>
          </div>
          <div className="workspace-card cursor-pointer hover:shadow-md transition-shadow animate-fade-in-up" style={{ animationDelay: '80ms' }} onClick={() => navigate('/interviews?tab=Needs%20Review')}>
            <h3 className="section-title">Interview Hub</h3>
            <p className="text-gray-500 mt-2 text-sm">Review candidates, suggest slots, and submit interview decisions.</p>
            <button className="btn-primary mt-4">Open Interview Hub</button>
          </div>
        </div>
      </div>
    );
  }

  // -- Full HR Admin / Recruiter dashboard --
  const funnelRows = Array.isArray(insights.funnel) ? insights.funnel : [];
  const funnelTotal = funnelRows.reduce((sum, row) => sum + toNumber(row.count), 0);
  const recruiterMomentum = buildRecruiterMomentum(insights.monthlyOffers);
  const departmentHealth = buildDepartmentHealth(insights.entitySummary);
  const maxFunnelCount = Math.max(...funnelRows.map((row) => toNumber(row.count)), 1);
  const maxRecruiterOffers = Math.max(...recruiterMomentum.map((row) => toNumber(row.offers)), 1);
  const maxDeptOpen = Math.max(...departmentHealth.map((row) => toNumber(row.open)), 1);
  const topBackout = insights.backouts?.details?.[0] || null;
  const backoutSummary = insights.backouts?.summary || {};

  const headlineCards = [
    {
      label: 'Open Jobs',
      value: compactNumber(stats?.open_jobs),
      tone: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
      detail: `${toNumber(stats?.screening) + toNumber(stats?.interviewing)} in active evaluation`,
      code: 'JB',
    },
    {
      label: 'Total Applications',
      value: compactNumber(stats?.total_applications),
      tone: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
      detail: `${toNumber(stats?.in_queue)} waiting in queue`,
      code: 'AP',
    },
    {
      label: 'Offers Made',
      value: compactNumber(stats?.offers_made),
      tone: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      detail: `${toNumber(stats?.offered)} in offer stages`,
      code: 'OF',
    },
    {
      label: 'Joined This Month',
      value: compactNumber(stats?.joined_this_month),
      tone: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
      detail: `${toNumber(backoutSummary.total_backouts)} backouts tracked`,
      code: 'JN',
    },
    {
      label: 'Offer Acceptance',
      value: `${toNumber(stats?.offer_acceptance_rate)}%`,
      tone: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      detail: 'Accepted or joined vs all offers',
      code: 'AR',
    },
    {
      label: 'Avg. Time to Fill',
      value: `${toNumber(insights.timeToFill?.average_days || stats?.avg_time_to_fill)}d`,
      tone: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
      detail: 'Requisition raised to first offer',
      code: 'TF',
    },
  ];

  const liveSignals = [
    {
      label: 'Screening Pressure',
      value: compactNumber(toNumber(stats?.screening) + toNumber(stats?.in_queue)),
      note: 'Awaiting recruiter action',
    },
    {
      label: 'Interview Load',
      value: compactNumber(stats?.interviewing),
      note: 'In HOD/interview progression',
    },
    {
      label: 'Selection Bench',
      value: compactNumber(stats?.selected),
      note: 'Ready for offers',
    },
    {
      label: 'Offer to Join',
      value: `${toNumber(stats?.avg_time_to_join)}d`,
      note: 'Avg days offer to join',
    },
  ];

  return (
    <div className="workspace-shell">
      {/* Demo progress modal */}
      <DemoProgressModal
        open={demoModalOpen}
        onClose={() => { if (!demoRunning) setDemoModalOpen(false); }}
        currentStep={demoStep}
        demoRunning={demoRunning}
        demoError={demoError}
        demoStory={demoStory}
      />

      {/* Hero section */}
      <div className="aurora-panel animate-fade-in-up" style={{ padding: '1.75rem 2rem', marginBottom: '1.5rem' }}>
        <div className="aurora-content">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="workspace-eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>Dashboard</p>
              <h1 className="page-title" style={{ color: 'white', marginTop: '0.25rem' }}>
                Welcome back, {user?.name || user?.email?.split('@')[0]}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => navigate('/requisitions/create')} className="btn-primary">
                + Requisition
              </button>
              <button onClick={() => navigate('/jobs/create')} className="btn-secondary" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', borderColor: 'rgba(255,255,255,0.25)' }}>
                + Job
              </button>
              {hasRole('hr_admin') && (
                <>
                  <button
                    onClick={() => handleDemoAction('seed')}
                    disabled={demoAction !== null}
                    className="btn-secondary disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }}
                  >
                    {demoAction === 'seed' ? 'Seeding...' : 'Seed Demo'}
                  </button>
                  <button
                    onClick={() => handleDemoAction('clear')}
                    disabled={demoAction !== null}
                    className="btn-secondary disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }}
                  >
                    {demoAction === 'clear' ? 'Clearing...' : 'Clear Demo'}
                  </button>
                  <button
                    onClick={runFullDemo}
                    disabled={demoAction !== null || demoRunning}
                    className="btn-primary disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', borderColor: '#d97706' }}
                  >
                    {demoRunning ? 'Running...' : 'Run Full Demo'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick nav actions */}
      <div className="flex flex-wrap gap-2 mb-6 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
        {[
          { label: 'Requisitions', route: '/requisitions', tip: 'Raise demand, route approvals, convert to jobs' },
          { label: 'Jobs', route: '/jobs', tip: 'Open jobs, shortlist candidates, manage stages' },
          { label: 'Interview Hub', route: '/interviews?tab=Needs%20Review', tip: 'Review profiles, suggest slots, submit feedback' },
          { label: 'Talent Pool', route: '/talent-pool', tip: 'Source and import candidates into the ATS' },
          { label: 'Analytics Copilot', route: '/analytics-copilot', tip: 'Ask natural-language questions about your hiring data' },
          { label: 'MIS', route: '/mis', tip: 'Funnel analytics, recruiter performance, sourcing quality' },
          { label: 'Audit', route: '/audit', tip: 'Full audit trail of all ATS actions' },
        ].map((item) => (
          <span key={item.route} className="inline-flex items-center gap-1">
            <button
              onClick={() => navigate(item.route)}
              className="glass-chip"
              style={{ cursor: 'pointer' }}
            >
              {item.label}
            </button>
            <InfoTip text={item.tip} />
          </span>
        ))}
      </div>

      {(aiStatus || demoStory?.job || demoStory?.requisition) && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr] mb-6 animate-fade-in-up" style={{ animationDelay: '90ms' }}>
          <div className="workspace-card">
            <div className="flex items-center gap-2">
              <h3 className="section-title">AI Runtime</h3>
              <InfoTip text="This tells you whether the app is currently using the local Ollama model or the grounded built-in fallback path." />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <span className={`glass-chip ${aiStatus?.available ? 'text-emerald-700' : 'text-amber-700'}`}>
                {aiStatus?.available ? `Local model connected · ${aiStatus.model}` : `Fallback active · ${aiStatus?.model || 'Ollama'}`}
              </span>
              {aiStatus?.base_url ? <span className="glass-chip text-gray-700">{aiStatus.base_url}</span> : null}
            </div>
            {aiStatus?.last_error ? (
              <p className="mt-3 text-sm text-amber-700">{aiStatus.last_error}</p>
            ) : (
              <p className="mt-3 text-sm text-gray-600">The ATS can generate job descriptions, analytics answers, reminders, and parsing enhancements with the configured local model.</p>
            )}
          </div>

          <div className="workspace-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="section-title">Demo Journey</h3>
                <p className="mt-1 text-sm text-gray-600">Jump directly into a seeded requisition-to-hired storyline and open each stage-specific workflow page from here.</p>
              </div>
              {hasRole('hr_admin') && (
                <button onClick={runFullDemo} disabled={demoRunning} className="btn-primary disabled:opacity-50">
                  {demoRunning ? 'Preparing...' : 'Rebuild Demo'}
                </button>
              )}
            </div>
            {demoStory?.stage_map ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Requisition', demoStory.requisition?.route, demoStory.requisition?.requisition_id || 'Not ready'],
                    ['Job', demoStory.job?.route, demoStory.job?.job_id || 'Not ready'],
                    ['Public Job', demoStory.job?.public_route, demoStory.job?.job_title || 'Not ready'],
                    ['Joined', demoStory.stage_map?.Joined?.route, demoStory.stage_map?.Joined?.candidate_name || 'Not ready'],
                  ].map(([label, route, value]) => (
                    <button key={label} type="button" onClick={() => route && navigate(route)} className="surface-muted text-left hover:border-indigo-200 hover:bg-indigo-50/50">
                      <p className="workspace-kicker">{label}</p>
                      <p className="mt-2 text-sm font-semibold text-gray-900">{value}</p>
                      <p className="mt-1 text-xs text-gray-500">{route || 'Seed demo data to generate this path'}</p>
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {DEMO_STAGE_ORDER.map((stage) => {
                    const entry = demoStory.stage_map?.[stage];
                    return (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => entry?.route && navigate(entry.route)}
                        className={`text-left rounded-[24px] border px-4 py-4 transition-all ${
                          entry?.route
                            ? 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50/50'
                            : 'border-dashed border-gray-200 bg-gray-50'
                        }`}
                      >
                        <p className="workspace-kicker">{stage}</p>
                        <p className="mt-2 text-sm font-semibold text-gray-900">{entry?.candidate_name || 'Not seeded'}</p>
                        <p className="mt-1 text-xs text-gray-500">{entry?.application_id || 'Stage route unavailable'}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">Seed demo data to unlock a click-through journey across requisition, job, interview, document, and hire stages.</p>
            )}
          </div>
        </div>
      )}

      {/* Headline metrics -- 4-column operating grid */}
      <div className="operating-grid mb-6 animate-fade-in-up" style={{ animationDelay: '120ms' }}>
        {headlineCards.map((card) => (
          <div key={card.label} className="metric-tile">
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold tracking-widest shadow-lg"
                style={{ background: card.tone }}
              >
                {card.code}
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-gray-900 leading-tight">{card.value}</p>
                <p className="text-sm font-medium text-gray-700">{card.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{card.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Live signals -- horizontal row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-6 animate-fade-in-up" style={{ animationDelay: '180ms' }}>
        {liveSignals.map((signal) => (
          <div key={signal.label} className="signal-card-light">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{signal.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{signal.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{signal.note}</p>
          </div>
        ))}
        <div className="signal-card-light" style={{ borderColor: 'rgb(199, 210, 254)', background: 'rgb(238, 242, 255)' }}>
          <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">Top Backout</p>
          <p className="text-sm font-semibold text-indigo-950 mt-1 leading-snug">
            {topBackout?.reason || 'None captured'}
          </p>
          <p className="text-xs text-indigo-700 mt-0.5">
            {topBackout ? `${compactNumber(topBackout.count)} impacted` : 'Updates as dropouts are captured'}
          </p>
        </div>
      </div>

      {/* Funnel + Dept Health side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-6">
        <div className="workspace-card xl:col-span-3 animate-fade-in-up" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title">Hiring Funnel</h3>
            <button onClick={() => navigate('/mis')} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Open MIS</button>
          </div>
          {funnelRows.length === 0 ? (
            <EmptyState message="No funnel data available yet." />
          ) : (
            <div className="space-y-3">
              {funnelRows.map((row, index) => (
                <div key={row.stage} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`inline-flex h-2.5 w-2.5 rounded-full ${FUNNEL_COLORS[index % FUNNEL_COLORS.length]}`}></span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{row.stage}</p>
                        <p className="text-xs text-gray-500">{asPercent(row.count, funnelTotal)}% of funnel</p>
                      </div>
                    </div>
                    <p className="text-lg font-semibold text-gray-900">{compactNumber(row.count)}</p>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${FUNNEL_COLORS[index % FUNNEL_COLORS.length]}`}
                      style={{ width: getBarWidth(row.count, maxFunnelCount, 6) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="workspace-card xl:col-span-2 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <h3 className="section-title mb-4">Department Health</h3>
          {departmentHealth.length === 0 ? (
            <EmptyState message="Department data appears once jobs and applications are active." />
          ) : (
            <div className="space-y-3">
              {departmentHealth.map((dept) => (
                <div key={dept.department} className="rounded-xl border border-gray-200 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">{dept.department}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-1.5">
                    <span><strong className="text-gray-800">{compactNumber(dept.open)}</strong> open</span>
                    <span><strong className="text-gray-800">{compactNumber(dept.selected)}</strong> sel</span>
                    <span><strong className="text-gray-800">{compactNumber(dept.offered)}</strong> off</span>
                    <span><strong className="text-gray-800">{compactNumber(dept.joined)}</strong> joined</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: getBarWidth(dept.open, maxDeptOpen, 8) }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recruiter Momentum + Conversion + Backouts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        <div className="workspace-card animate-fade-in-up" style={{ animationDelay: '360ms' }}>
          <h3 className="section-title mb-4">Recruiter Momentum</h3>
          {recruiterMomentum.length === 0 ? (
            <EmptyState message="Populates as offers and closures are recorded." />
          ) : (
            <div className="space-y-3">
              {recruiterMomentum.map((recruiter) => (
                <div key={recruiter.recruiter} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{recruiter.recruiter}</p>
                      <p className="text-xs text-gray-500">{compactNumber(recruiter.closures)} closures</p>
                    </div>
                    <p className="text-sm font-semibold text-indigo-700">{compactNumber(recruiter.offers)} offers</p>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: getBarWidth(recruiter.offers, maxRecruiterOffers, 8) }} />
                  </div>
                  <div className="mt-2 flex gap-3 text-xs text-gray-500">
                    <span>Pending: {compactNumber(recruiter.pendingJoins)}</span>
                    <span>Backouts: {compactNumber(recruiter.backouts)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="workspace-card animate-fade-in-up" style={{ animationDelay: '420ms' }}>
          <h3 className="section-title mb-4">Conversion Signals</h3>
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Selected to Offered</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">
                {toNumber(stats?.selected) > 0 ? `${Math.round((toNumber(stats?.offered) / Math.max(toNumber(stats?.selected), 1)) * 100)}%` : '0%'}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Join Potential</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{compactNumber(toNumber(stats?.offers_made) - toNumber(backoutSummary.total_backouts))}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Time to Fill</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{toNumber(insights.timeToFill?.average_days || stats?.avg_time_to_fill)} days</p>
            </div>
          </div>
        </div>

        <div className="workspace-card animate-fade-in-up" style={{ animationDelay: '480ms' }}>
          <h3 className="section-title mb-4">Backout Snapshot</h3>
          {!insights.backouts?.details?.length ? (
            <EmptyState message="No backouts or withdrawals captured yet." />
          ) : (
            <div className="space-y-3">
              {insights.backouts.details.slice(0, 4).map((item) => (
                <div key={`${item.reason}-${item.recruiter}`} className="rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{item.reason}</p>
                      <p className="text-xs text-gray-500">{item.recruiter || 'Unassigned'}</p>
                    </div>
                    <p className="text-lg font-semibold text-red-600">{compactNumber(item.count)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Applications -- compact table */}
      <div className="animate-fade-in-up" style={{ animationDelay: '540ms' }}>
        <DataTable
          title="Recent Applications"
          subtitle="Search, filter, export, and open the most recent candidate records from the dashboard itself."
          data={recentApps}
          exportFileName="recent-applications"
          emptyMessage="No applications yet."
          onRowClick={(row) => navigate(`/applications/${row.id}/workflow`)}
          columns={[
            {
              key: 'candidate_name',
              label: 'Candidate',
              render: (row) => (
                <div>
                  <p className="font-medium text-sm text-gray-900">{row.candidate_name}</p>
                  <p className="text-xs text-gray-500">{row.candidate_email}</p>
                </div>
              ),
            },
            { key: 'ats_job_id', label: 'Job', render: (row) => row.ats_job_id || 'Talent Pool' },
            {
              key: 'status',
              label: 'Status',
              render: (row) => <span className={`badge ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700'}`}>{row.status}</span>,
            },
            {
              key: 'created_at',
              label: 'Applied',
              render: (row) => new Date(row.created_at).toLocaleDateString(),
            },
          ]}
        />
      </div>
    </div>
  );
}
