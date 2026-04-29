import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { misAPI, timelineAPI } from '../services/api';
import DataTable from '../components/DataTable';
import AppModal from '../components/AppModal';
import { PageHeader, Tabs, StatCard, SectionCard, EmptyState } from '../components/ui';
import haptic from '../utils/haptic';

/**
 * MIS - Redesigned from scratch (v2).
 *
 * Design principles
 *  - Tabbed hub: Executive Overview · TAT & Funnel · Recruiter Output · Backouts & Join Risk · Raw Data · Step TAT
 *  - Every report exposes both visual summary AND a raw dataset with filters, sort, search, and .xlsx export
 *  - "Show workings" drawer for every metric: the exact SQL logic in English plus the underlying rows
 *  - Step TAT explorer: pick any two consecutive events and see avg/min/max days across the organisation
 *  - Every page surface is responsive (flex-wrap, stat-grid, table horizontal-scroll)
 */

const FUNNEL_STAGES = ['InQueue', 'Applied', 'Shortlisted', 'Interview', 'Selected', 'Offered', 'Joined'];
const RANGE_ORDER = ['1 - 30 days', '31 - 60 days', '61 - 90 days', 'More than 90 days'];

const TABS = [
  { value: 'overview', label: 'Executive Overview' },
  { value: 'tat', label: 'TAT & Funnel' },
  { value: 'recruiter', label: 'Recruiter Output' },
  { value: 'backouts', label: 'Backouts & Risk' },
  { value: 'steptat', label: 'Step TAT Explorer' },
  { value: 'raw', label: 'Raw Data' },
];

// ── utils ────────────────────────────────────────────────────────────────
const toNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const compact = (v) => {
  const n = Number(v || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const days = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}d`);
const bucketForDays = (d) => {
  const n = toNumber(d);
  if (n <= 30) return RANGE_ORDER[0];
  if (n <= 60) return RANGE_ORDER[1];
  if (n <= 90) return RANGE_ORDER[2];
  return RANGE_ORDER[3];
};
function exportToExcel(rows, filename = 'mis-report.xlsx') {
  if (!rows?.length) { toast('No rows to export'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename);
  haptic.success();
}

// ── Report card with "show workings" drawer ─────────────────────────────
function ReportCard({ title, subtitle, children, working, rows, filename, actions }) {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {rows && rows.length > 0 && (
            <button
              type="button"
              onClick={() => exportToExcel(rows, filename)}
              className="btn-secondary btn-sm"
            >
              Export .xlsx ({rows.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-secondary btn-sm"
          >
            Show working
          </button>
          {actions}
        </div>
      }
    >
      {children}
      <AppModal open={open} onClose={() => setOpen(false)} title={`How this is calculated · ${title}`} width="full">
        {working && (
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>
              Method
            </p>
            <div
              style={{
                padding: 14,
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-muted)',
                fontSize: 13,
                lineHeight: 1.75,
                color: 'var(--text-body)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {working}
            </div>
          </div>
        )}
        {rows && rows.length > 0 ? (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '18px 0 8px' }}>
              Underlying rows ({rows.length})
            </p>
            <DataTable
              title="Underlying data"
              data={rows}
              exportFileName={filename || 'report'}
              columns={Object.keys(rows[0]).map((key) => ({ key, label: key.replace(/_/g, ' ') }))}
              collapsible
            />
          </>
        ) : (
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No underlying rows for this metric.</p>
        )}
      </AppModal>
    </SectionCard>
  );
}

// ── Funnel bars ──────────────────────────────────────────────────────────
function FunnelBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => (
        <div key={row.stage} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, max-content) 1fr auto', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>{row.stage}</span>
          <div style={{ height: 8, background: 'var(--surface-muted)', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--line-subtle)' }}>
            <div style={{ width: `${(row.count / max) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-blue), #0c8da3)', borderRadius: 999 }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-body)', minWidth: 48, textAlign: 'right' }}>{compact(row.count)}</span>
        </div>
      ))}
    </div>
  );
}

function RangeTable({ summary, onCellClick, valueLabel = 'count' }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ width: '100%', minWidth: 520 }}>
        <thead>
          <tr>
            <th>Range</th>
            <th>Overall</th>
            <th>Replacement</th>
            <th>New Position</th>
          </tr>
        </thead>
        <tbody>
          {RANGE_ORDER.map((label) => {
            const cells = ['overall', 'replacement', 'newPosition'];
            return (
              <tr key={label}>
                <td style={{ fontWeight: 600 }}>{label}</td>
                {cells.map((key) => (
                  <td key={key}>
                    <button
                      type="button"
                      onClick={() => onCellClick?.(label, key)}
                      style={{ color: 'var(--accent-blue)', fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none' }}
                    >
                      {toNumber(summary?.[key]?.[label]?.[valueLabel] || 0)}
                    </button>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function buildRangeSummary(rows, dayField) {
  const empty = () => Object.fromEntries(RANGE_ORDER.map((r) => [r, { count: 0 }]));
  const isReplacement = (row) => String(row.requisition_type || '').toLowerCase().includes('replace');
  const summary = { overall: empty(), replacement: empty(), newPosition: empty() };
  rows.forEach((row) => {
    const bucket = bucketForDays(row[dayField]);
    summary.overall[bucket].count += 1;
    if (isReplacement(row)) summary.replacement[bucket].count += 1;
    else summary.newPosition[bucket].count += 1;
  });
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
export default function MIS() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  // Shared filter bar
  const [filters, setFilters] = useState({ date_from: '', date_to: '', recruiter: '', talent_pool: 'include', hr_one_job_id: '' });

  // Datasets
  const [ds, setDs] = useState({
    funnel: [], openPositionsTat: [], offersTat: [], monthlyOffers: [], recruiterSourcing: [],
    backoutsSummary: { details: [], summary: {} },
    timeToFill: { details: [], averages: [], average_days: null },
    timeToJoin: { details: [], average_days: null },
    offerAcceptance: { details: [], rate: null, accepted: 0, total: 0 },
    offerJoinRatio: { details: [], ratio: null, joined: 0, offered: 0 },
    ninetyDaysRecruiter: { summary: [], details: [] },
  });

  // Step TAT explorer state
  const [stepTat, setStepTat] = useState([]);
  const [stepTatLoading, setStepTatLoading] = useState(false);
  const [stepEntity, setStepEntity] = useState('application');

  // Raw data
  const [rawRows, setRawRows] = useState([]);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawLoaded, setRawLoaded] = useState(false);

  // Drilldown modal
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState('');
  const [drillRows, setDrillRows] = useState([]);

  const showDrill = (title, rows) => {
    haptic.medium();
    setDrillTitle(title);
    setDrillRows(rows || []);
    setDrillOpen(true);
  };

  // Load core datasets
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [funnel, openTat, offersTat, monthly, sourcing, backouts, ttf, ttj, oar, ojr, ninety] = await Promise.all([
          misAPI.funnel(filters).catch(() => ({ data: [] })),
          misAPI.openPositionsTat(filters).catch(() => ({ data: [] })),
          misAPI.offersTat(filters).catch(() => ({ data: [] })),
          misAPI.monthlyOffers(filters).catch(() => ({ data: [] })),
          misAPI.recruiterSourcing(filters).catch(() => ({ data: [] })),
          misAPI.backoutsSummary(filters).catch(() => ({ data: { details: [], summary: {} } })),
          misAPI.timeToFill(filters).catch(() => ({ data: { details: [], averages: [], average_days: null } })),
          misAPI.timeToJoin(filters).catch(() => ({ data: { details: [], average_days: null } })),
          misAPI.offerAcceptanceRate(filters).catch(() => ({ data: { details: [], rate: null, accepted: 0, total: 0 } })),
          misAPI.offerJoinRatio(filters).catch(() => ({ data: { details: [], ratio: null, joined: 0, offered: 0 } })),
          misAPI.ninetyDaysRecruiter(filters).catch(() => ({ data: { summary: [], details: [] } })),
        ]);
        setDs({
          funnel: Array.isArray(funnel.data) ? funnel.data : [],
          openPositionsTat: Array.isArray(openTat.data) ? openTat.data : [],
          offersTat: Array.isArray(offersTat.data) ? offersTat.data : [],
          monthlyOffers: Array.isArray(monthly.data) ? monthly.data : [],
          recruiterSourcing: Array.isArray(sourcing.data) ? sourcing.data : [],
          backoutsSummary: backouts.data || { details: [], summary: {} },
          timeToFill: ttf.data || { details: [], averages: [], average_days: null },
          timeToJoin: ttj.data || { details: [], average_days: null },
          offerAcceptance: oar.data || { details: [], rate: null, accepted: 0, total: 0 },
          offerJoinRatio: ojr.data || { details: [], ratio: null, joined: 0, offered: 0 },
          ninetyDaysRecruiter: ninety.data || { summary: [], details: [] },
        });
      } catch {
        toast.error('Failed to load MIS');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [filters]);

  // Derived
  const funnelRows = useMemo(
    () => FUNNEL_STAGES.map((stage) => {
      const row = ds.funnel.find((r) => r.stage === stage || r.status === stage);
      return { stage, count: toNumber(row?.count) };
    }),
    [ds.funnel]
  );
  const totalFunnel = funnelRows.reduce((s, r) => s + r.count, 0);
  const offerRows = ds.offersTat.filter((r) => r.first_offer_date);
  const openTatSummary = useMemo(() => buildRangeSummary(ds.openPositionsTat, 'tat_days'), [ds.openPositionsTat]);
  const offersTatSummary = useMemo(() => buildRangeSummary(offerRows, 'avg_days_to_offer'), [offerRows]);

  const topRecruiters = useMemo(
    () => [...ds.monthlyOffers].sort((a, b) => toNumber(b.closures) - toNumber(a.closures)).slice(0, 10),
    [ds.monthlyOffers]
  );

  // ── Load step TAT ──────────────────────────────────────────────────────
  async function loadStepTat(entityType = stepEntity) {
    try {
      setStepTatLoading(true);
      const res = await timelineAPI.stepTat({ entity_type: entityType, ...filters });
      setStepTat(res.data?.pairs || []);
    } catch {
      toast.error('Failed to load step TAT');
    } finally {
      setStepTatLoading(false);
    }
  }
  useEffect(() => {
    if (activeTab === 'steptat') loadStepTat(stepEntity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, stepEntity]);

  // ── Raw export ─────────────────────────────────────────────────────────
  async function loadRaw() {
    try {
      setRawLoading(true);
      const res = await misAPI.rawExport(filters);
      const rows = res.data?.rows || [];
      setRawRows(rows);
      setRawLoaded(true);
      haptic.success();
      toast.success(`${rows.length} rows loaded`);
    } catch {
      haptic.error();
      toast.error('Failed to load raw export');
    } finally {
      setRawLoading(false);
    }
  }

  // Executive metrics list
  const execMetrics = [
    { label: 'Open requisitions', value: compact(ds.openPositionsTat.length), onClick: () => showDrill('Open requisitions', ds.openPositionsTat) },
    { label: 'Offers in pipeline', value: compact(offerRows.length), onClick: () => showDrill('Offers in pipeline', offerRows) },
    { label: 'Avg time to fill', value: days(ds.timeToFill.average_days), onClick: () => showDrill('Time to fill', ds.timeToFill.details) },
    { label: 'Avg time to join', value: days(ds.timeToJoin.average_days), onClick: () => showDrill('Time to join', ds.timeToJoin.details) },
    { label: 'Offer acceptance', value: pct(ds.offerAcceptance.rate), note: `${ds.offerAcceptance.accepted}/${ds.offerAcceptance.total}`, onClick: () => showDrill('Offer acceptance', ds.offerAcceptance.details) },
    { label: 'Offer → join', value: pct(ds.offerJoinRatio.ratio), note: `${ds.offerJoinRatio.joined}/${ds.offerJoinRatio.offered}`, onClick: () => showDrill('Offer to join', ds.offerJoinRatio.details) },
  ];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="workspace-shell">
      <PageHeader
        eyebrow="MIS Reports"
        title="Hiring performance"
        subtitle="Executive metrics, TAT analysis, recruiter output, backout risk, and a fully filterable raw dataset - every number explained with its working."
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'MIS Reports' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { if (!rawLoaded) loadRaw(); setActiveTab('raw'); }}
              className="btn-primary"
            >
              Raw data + export
            </button>
          </div>
        }
      />

      <SectionCard title="Filters" subtitle="All tabs respect the filters below. Leave blank for organisation-wide totals.">
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Date from</label>
            <input type="date" className="input-field" value={filters.date_from} onChange={(e) => setFilters((p) => ({ ...p, date_from: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Date to</label>
            <input type="date" className="input-field" value={filters.date_to} onChange={(e) => setFilters((p) => ({ ...p, date_to: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Recruiter email</label>
            <input type="text" className="input-field" placeholder="name@premierenergies.com" value={filters.recruiter} onChange={(e) => setFilters((p) => ({ ...p, recruiter: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Talent pool</label>
            <select className="input-field" value={filters.talent_pool} onChange={(e) => setFilters((p) => ({ ...p, talent_pool: e.target.value }))}>
              <option value="include">Include parked candidates</option>
              <option value="exclude">Exclude parked candidates</option>
              <option value="only">Only parked candidates</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>HR One job ID</label>
            <input type="text" className="input-field" placeholder="HR1-…" value={filters.hr_one_job_id} onChange={(e) => setFilters((p) => ({ ...p, hr_one_job_id: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setFilters({ date_from: '', date_to: '', recruiter: '', talent_pool: 'include', hr_one_job_id: '' })}>
              Reset
            </button>
          </div>
        </div>
      </SectionCard>

      <div style={{ marginTop: 16 }}>
        <Tabs tabs={TABS} value={activeTab} onChange={setActiveTab} variant="underline" />
      </div>

      {loading && activeTab !== 'steptat' && activeTab !== 'raw' && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading reports…</div>
      )}

      {/* ── OVERVIEW ───────────────────────────────────────────────── */}
      {activeTab === 'overview' && !loading && (
        <>
          <div className="stat-grid" style={{ marginTop: 16 }}>
            {execMetrics.map((m) => (
              <StatCard
                key={m.label}
                label={m.label}
                value={m.value}
                delta={m.note}
                onClick={m.onClick}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 16 }}>
            <ReportCard
              title="Candidate funnel"
              subtitle={`${totalFunnel} candidates tracked across the active pipeline.`}
              rows={funnelRows}
              filename="mis-funnel"
              working={`Counts by application status, grouped into canonical stages.
SQL: SELECT status, COUNT(*) FROM applications WHERE active_flag = true [+ filters] GROUP BY status
Stages are mapped as InQueue, Applied, Shortlisted, Interview (Round1/2/3 + AwaitingHOD), Selected, Offered, Joined.`}
            >
              <FunnelBars rows={funnelRows} />
            </ReportCard>

            <ReportCard
              title="Time to fill vs time to join"
              subtitle="Two speed reads that matter most to leadership."
              rows={[
                { metric: 'Avg days - requisition → first offer', value: ds.timeToFill.average_days },
                { metric: 'Avg days - offer accepted → joined', value: ds.timeToJoin.average_days },
                { metric: 'Offer acceptance %', value: ds.offerAcceptance.rate },
                { metric: 'Offer → join %', value: ds.offerJoinRatio.ratio },
              ]}
              filename="mis-speed-reads"
              working={`Time to fill = AVG(first_offer_date - requisition_created_at) across offered applications.
Time to join = AVG(joining_date - offer_accepted_at) across joined applications.
Offer acceptance % = COUNT(status IN OfferAccepted|Joined) / COUNT(OFFER_STATUSES).
Offer → join % = COUNT(Joined) / COUNT(Offered).
All four exclude applications where the parent requisition was on_hold during the relevant window (hold time subtracted from denominator).`}
            >
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  ['Time to fill', days(ds.timeToFill.average_days), 'var(--accent-blue)'],
                  ['Time to join', days(ds.timeToJoin.average_days), '#0c8da3'],
                  ['Offer acceptance', pct(ds.offerAcceptance.rate), 'var(--success-text)'],
                  ['Offer → join', pct(ds.offerJoinRatio.ratio), '#10b981'],
                ].map(([label, value, color]) => (
                  <div key={label} className="flex items-center justify-between" style={{ padding: '10px 14px', border: '1px solid var(--line-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text-body)' }}>{label}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</span>
                  </div>
                ))}
              </div>
            </ReportCard>
          </div>
        </>
      )}

      {/* ── TAT & FUNNEL ──────────────────────────────────────────── */}
      {activeTab === 'tat' && !loading && (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <ReportCard
            title="Open positions TAT"
            subtitle="Ageing distribution of currently-open jobs by days since requisition creation."
            rows={ds.openPositionsTat}
            filename="mis-open-positions-tat"
            working={`TAT days = ROUND((NOW() - COALESCE(r.created_at, j.created_at)) / 86400) for each open job.
Bucketed into 0–30 / 31–60 / 61–90 / 90+ day ranges.
Split by requisition_type: "Replacement" vs "New Position" (anything else).
Hold-paused days are excluded if the parent requisition had an active hold window - those seconds are deducted from the TAT before bucketing.`}
          >
            <RangeTable
              summary={openTatSummary}
              onCellClick={(range, group) => {
                const src = group === 'replacement'
                  ? ds.openPositionsTat.filter((r) => /replace/i.test(r.requisition_type || ''))
                  : group === 'newPosition'
                    ? ds.openPositionsTat.filter((r) => !/replace/i.test(r.requisition_type || ''))
                    : ds.openPositionsTat;
                showDrill(`Open positions · ${range} · ${group}`, src.filter((r) => bucketForDays(r.tat_days) === range));
              }}
            />
          </ReportCard>

          <ReportCard
            title="Offers TAT"
            subtitle="Days from requisition creation to first offer, bucketed."
            rows={offerRows}
            filename="mis-offers-tat"
            working={`Only jobs where first_offer_date IS NOT NULL are included.
avg_days_to_offer = (first_offer_date - requisition_created_at) in days.
Bucketed identically to open positions TAT. Hold windows excluded.`}
          >
            <RangeTable
              summary={offersTatSummary}
              onCellClick={(range, group) => {
                const src = group === 'replacement'
                  ? offerRows.filter((r) => /replace/i.test(r.requisition_type || ''))
                  : group === 'newPosition'
                    ? offerRows.filter((r) => !/replace/i.test(r.requisition_type || ''))
                    : offerRows;
                showDrill(`Offers · ${range} · ${group}`, src.filter((r) => bucketForDays(r.avg_days_to_offer) === range));
              }}
            />
          </ReportCard>

          <ReportCard
            title="Funnel detail"
            subtitle="Click any stage bar to see the underlying candidate rows."
            rows={funnelRows}
            filename="mis-funnel"
            working="Counts of applications in each canonical funnel stage. Use this view with the Raw Data tab to see which applications sit in each stage."
          >
            <FunnelBars rows={funnelRows} />
          </ReportCard>
        </div>
      )}

      {/* ── RECRUITER OUTPUT ──────────────────────────────────────── */}
      {activeTab === 'recruiter' && !loading && (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <ReportCard
            title="Top recruiters · closures & pending"
            subtitle="Ranked by closures in the selected window."
            rows={ds.monthlyOffers}
            filename="mis-recruiter-monthly"
            working={`SELECT recruiter_email, COUNT(Joined) AS closures, COUNT(OFFER_STATUSES) - COUNT(Joined) AS pending_joins
FROM applications GROUP BY recruiter_email ORDER BY closures DESC.
Only counts applications within the filter window. Hold-paused days are excluded when computing per-recruiter TAT elsewhere.`}
          >
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', minWidth: 640 }}>
                <thead><tr><th>Recruiter</th><th>Email</th><th style={{ textAlign: 'right' }}>Closures</th><th style={{ textAlign: 'right' }}>Pending joins</th><th>Bar</th></tr></thead>
                <tbody>
                  {topRecruiters.map((row) => {
                    const max = topRecruiters[0]?.closures || 1;
                    const name = row.recruiter_name || row.recruiter || row.recruiter_email || 'Unassigned';
                    return (
                      <tr key={`${row.month || ''}-${row.recruiter_email || row.recruiter}`}>
                        <td style={{ fontWeight: 600 }}>{name}</td>
                        <td style={{ color: 'var(--text-faint)', fontSize: 12 }}>{row.recruiter_email || '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{toNumber(row.closures)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{toNumber(row.pending_joins)}</td>
                        <td style={{ width: '30%' }}>
                          <div style={{ height: 6, background: 'var(--surface-muted)', borderRadius: 999, border: '1px solid var(--line-subtle)' }}>
                            <div style={{ width: `${(toNumber(row.closures) / toNumber(max)) * 100}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 999 }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ReportCard>

          <ReportCard
            title="Sourcing volume by recruiter"
            subtitle="Total applications added by each recruiter."
            rows={ds.recruiterSourcing}
            filename="mis-recruiter-sourcing"
            working={`SELECT recruiter_email, COUNT(*) AS total FROM applications GROUP BY recruiter_email ORDER BY total DESC.
Counts every application where recruiter_email is attributed. Uses filters above.`}
          >
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', minWidth: 820 }}>
                <thead>
                  <tr>
                    <th>Recruiter</th>
                    <th>Email</th>
                    <th style={{ textAlign: 'right' }}>Job portal</th>
                    <th style={{ textAlign: 'right' }}>Referral</th>
                    <th style={{ textAlign: 'right' }}>Campus</th>
                    <th style={{ textAlign: 'right' }}>Agency</th>
                    <th style={{ textAlign: 'right' }}>Internal</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ds.recruiterSourcing.slice(0, 20).map((row) => {
                    const name = row.recruiter_name || row.recruiter || row.recruiter_email || 'Unassigned';
                    return (
                      <tr key={row.recruiter_email || row.recruiter}>
                        <td style={{ fontWeight: 600 }}>{name}</td>
                        <td style={{ color: 'var(--text-faint)', fontSize: 12 }}>{row.recruiter_email || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row.job_portal)}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row.referral)}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row.campus)}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row.agency)}</td>
                        <td style={{ textAlign: 'right' }}>{toNumber(row.internal)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{toNumber(row.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ReportCard>

          <ReportCard
            title="90+ day aged candidates by recruiter"
            subtitle="Candidates still in active pipeline past 90 days - allocation review."
            rows={ds.ninetyDaysRecruiter.details || []}
            filename="mis-ninety-days-recruiter"
            working={`SELECT a.recruiter_email, a.application_id, a.candidate_name, (NOW() - a.created_at) AS age
FROM applications a WHERE a.active_flag AND a.status NOT IN (TERMINAL_STATUSES) AND (NOW() - a.created_at) > INTERVAL '90 days'.
These candidates should be escalated or disposed of - they drag the overall TAT up.`}
          >
            {(ds.ninetyDaysRecruiter.details || []).length === 0 ? (
              <EmptyState title="All candidates within 90 days" description="No aged candidates - healthy pipeline state." />
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-body)', margin: 0 }}>
                <strong>{ds.ninetyDaysRecruiter.details.length}</strong> candidates aged over 90 days. Open &ldquo;Show working&rdquo; to export the full list.
              </p>
            )}
          </ReportCard>
        </div>
      )}

      {/* ── BACKOUTS & RISK ───────────────────────────────────────── */}
      {activeTab === 'backouts' && !loading && (
        <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <ReportCard
            title="Backout reasons"
            subtitle="Where candidates drop out and why."
            rows={ds.backoutsSummary?.details || []}
            filename="mis-backouts"
            working={`SELECT dropout_reason AS reason, COUNT(*) AS count FROM applications
WHERE status IN ('OfferDropout','Withdrawn') AND dropout_reason IS NOT NULL
GROUP BY dropout_reason ORDER BY count DESC.
Shows top concentrated reasons for drop-out so HR can design interventions.`}
          >
            {(ds.backoutsSummary?.details || []).length === 0 ? (
              <EmptyState title="No backouts recorded" description="Either no dropouts or dropout_reason not yet captured." />
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {ds.backoutsSummary.details.slice(0, 10).map((row) => (
                  <div key={row.reason} className="flex items-center justify-between" style={{ padding: '10px 14px', background: 'var(--surface-muted)', border: '1px solid var(--line-subtle)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-main)' }}>{row.reason}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning-text)' }}>{toNumber(row.count)}</span>
                  </div>
                ))}
              </div>
            )}
          </ReportCard>
        </div>
      )}

      {/* ── STEP TAT EXPLORER ─────────────────────────────────────── */}
      {activeTab === 'steptat' && (
        <div style={{ marginTop: 16 }}>
          <SectionCard
            title="Step TAT explorer"
            subtitle="Average days between every consecutive event type, across every entity in the system. Hold-paused transitions are excluded."
            actions={
              <div className="flex items-center gap-2">
                <select className="input-field" value={stepEntity} onChange={(e) => setStepEntity(e.target.value)} style={{ minWidth: 160 }}>
                  <option value="application">Applications</option>
                  <option value="requisition">Requisitions</option>
                  <option value="job">Jobs</option>
                  <option value="clearance">Clearance</option>
                  <option value="document">Documents</option>
                </select>
                <button type="button" onClick={() => loadStepTat()} className="btn-secondary btn-sm" disabled={stepTatLoading}>
                  {stepTatLoading ? 'Loading…' : 'Reload'}
                </button>
                {stepTat.length > 0 && (
                  <button type="button" onClick={() => exportToExcel(stepTat, `step-tat-${stepEntity}.xlsx`)} className="btn-primary btn-sm">
                    Export .xlsx
                  </button>
                )}
              </div>
            }
          >
            {stepTatLoading ? (
              <p style={{ fontSize: 13, color: 'var(--text-faint)', padding: 20 }}>Computing step TAT…</p>
            ) : stepTat.length === 0 ? (
              <EmptyState title="No step pairs yet" description="Events will populate as actions happen. New events are logged automatically." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>Step pair (from → to)</th>
                      <th style={{ textAlign: 'right' }}>Count</th>
                      <th style={{ textAlign: 'right' }}>Avg days</th>
                      <th style={{ textAlign: 'right' }}>Min</th>
                      <th style={{ textAlign: 'right' }}>Max</th>
                      <th>Spread</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepTat.map((row) => {
                      const max = stepTat[0]?.avg_days || 1;
                      return (
                        <tr key={row.pair}>
                          <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, wordBreak: 'break-word' }}>{row.pair}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-blue)' }}>{row.avg_days}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{row.min_days}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{row.max_days}</td>
                          <td style={{ width: '20%' }}>
                            <div style={{ height: 6, background: 'var(--surface-muted)', borderRadius: 999, border: '1px solid var(--line-subtle)' }}>
                              <div style={{ width: `${Math.min(100, (row.avg_days / max) * 100)}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 999 }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 12, lineHeight: 1.6 }}>
              <strong>Working:</strong> For each entity of the selected type, we walk its timeline chronologically and compute the gap between every consecutive event. We group gaps by (previous event type → current event type) and report average, min, and max. Events that fell entirely inside a requisition hold window are dropped from the calculation so holds don&rsquo;t pollute TAT.
            </p>
          </SectionCard>
        </div>
      )}

      {/* ── RAW DATA ──────────────────────────────────────────────── */}
      {activeTab === 'raw' && (
        <div style={{ marginTop: 16 }}>
          <SectionCard
            title="Raw data export"
            subtitle="One row per application with ~90 columns spanning requisition creation through current state. Respects the filters above. Capped at 5000 rows."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={loadRaw} disabled={rawLoading}>
                  {rawLoading ? 'Loading…' : rawLoaded ? 'Reload' : 'Load data'}
                </button>
                {rawRows.length > 0 && (
                  <button type="button" className="btn-primary btn-sm" onClick={() => exportToExcel(rawRows, `mis-raw-${new Date().toISOString().slice(0, 10)}.xlsx`)}>
                    Download .xlsx ({rawRows.length})
                  </button>
                )}
              </div>
            }
          >
            {!rawLoaded ? (
              <EmptyState title="Click Load data to populate" description="Heavy query - kept out of initial page load. Use filters to narrow before loading." />
            ) : rawRows.length === 0 ? (
              <EmptyState title="No rows match filters" description="Widen the date range or clear recruiter filter." />
            ) : (
              <DataTable
                title="Raw data"
                subtitle={`${rawRows.length} rows · ${Object.keys(rawRows[0]).length} columns · scroll horizontally to browse all columns.`}
                data={rawRows}
                exportFileName="mis-raw-export"
                columns={Object.keys(rawRows[0]).map((key) => ({ key, label: key }))}
                collapsible
              />
            )}
          </SectionCard>
        </div>
      )}

      {/* ── Drilldown Modal ───────────────────────────────────────── */}
      <AppModal open={drillOpen} onClose={() => setDrillOpen(false)} title={drillTitle} width="full">
        {drillRows.length === 0 ? (
          <p style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No rows in this slice.</p>
        ) : (
          <DataTable
            title={drillTitle}
            subtitle={`${drillRows.length} row${drillRows.length === 1 ? '' : 's'} - use search, sort, column visibility, and export.`}
            data={drillRows}
            exportFileName={(drillTitle || 'mis-drilldown').replace(/[^a-z0-9]/gi, '-').toLowerCase()}
            columns={Object.keys(drillRows[0]).slice(0, 18).map((key) => ({ key, label: key.replace(/_/g, ' ') }))}
            collapsible
          />
        )}
      </AppModal>
    </div>
  );
}
