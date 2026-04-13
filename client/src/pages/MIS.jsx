import { useEffect, useMemo, useState } from 'react';
import { misAPI } from '../services/api';
import toast from 'react-hot-toast';
import InfoTip from '../components/InfoTip';
import AppModal from '../components/AppModal';
import DataTable from '../components/DataTable';
import * as XLSX from 'xlsx';

const RANGE_ORDER = ['1 - 30 days', '31 - 60 days', '61 - 90 days', 'More than 90 days'];
const FUNNEL_STAGES = ['InQueue', 'Applied', 'Shortlisted', 'Interview', 'Selected', 'Offered', 'Joined'];
const DRILLDOWN_OPTIONS = [
  ['business_unit', 'Entity / BU'],
  ['location', 'Location'],
  ['phase', 'Phase'],
  ['department', 'Department'],
  ['recruiter', 'Recruiter'],
];
const FUNNEL_COLORS = {
  InQueue: 'from-slate-500 to-slate-400',
  Applied: 'from-blue-600 to-blue-400',
  Shortlisted: 'from-indigo-600 to-indigo-400',
  Interview: 'from-violet-600 to-violet-400',
  Selected: 'from-emerald-600 to-emerald-400',
  Offered: 'from-teal-600 to-teal-400',
  Joined: 'from-green-700 to-green-500',
};
const FUNNEL_ACCENTS = {
  InQueue: '#64748b',
  Applied: '#2563eb',
  Shortlisted: '#4f46e5',
  Interview: '#7c3aed',
  Selected: '#059669',
  Offered: '#0d9488',
  Joined: '#15803d',
};
const METRIC_ACCENTS = [
  'from-blue-500 to-blue-400',
  'from-teal-500 to-teal-400',
  'from-indigo-500 to-indigo-400',
  'from-emerald-500 to-emerald-400',
  'from-amber-500 to-amber-400',
  'from-slate-500 to-slate-400',
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

function bucketForDays(days) {
  const value = toNumber(days);
  if (value <= 30) return '1 - 30 days';
  if (value <= 60) return '31 - 60 days';
  if (value <= 90) return '61 - 90 days';
  return 'More than 90 days';
}

function isReplacement(row) {
  return String(row?.requisition_type || '').toLowerCase() === 'backfill';
}

function buildTatSummary(rows, dayField) {
  const buckets = {
    overall: Object.fromEntries(RANGE_ORDER.map((range) => [range, 0])),
    replacement: Object.fromEntries(RANGE_ORDER.map((range) => [range, 0])),
    newPosition: Object.fromEntries(RANGE_ORDER.map((range) => [range, 0])),
  };

  rows.forEach((row) => {
    const bucket = bucketForDays(row?.[dayField]);
    buckets.overall[bucket] += 1;
    if (isReplacement(row)) buckets.replacement[bucket] += 1;
    else buckets.newPosition[bucket] += 1;
  });

  return buckets;
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${numeric.toFixed(1)}%`;
}

function exportToExcel(rows, filename = 'mis-report.xlsx') {
  if (!rows?.length) {
    toast.error('No data to export');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, filename);
  toast.success(`Exported ${rows.length} rows`);
}

/* ── Metric Card with gradient accent ── */
function MetricCard({ label, value, tip, tone = 'text-gray-900', accent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="metric-tile text-left group"
    >
      <div className={`absolute inset-x-0 top-0 h-1 rounded-t-[26px] bg-gradient-to-r ${accent || 'from-indigo-500 to-indigo-400'} opacity-70 group-hover:opacity-100 transition-opacity`} />
      <div className="flex items-center gap-2">
        <p className="workspace-kicker">{label}</p>
        {tip && <InfoTip text={tip} />}
      </div>
      <p className={`mt-3 text-3xl font-semibold tracking-[-0.03em] ${tone}`}>{value}</p>
    </button>
  );
}

/* ── TAT Range Summary ── */
function RangeSummary({ title, summary, onSelect }) {
  const total = RANGE_ORDER.reduce((sum, range) => sum + toNumber(summary?.[range]), 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">Total {total}</p>
        </div>
      </div>
      <div className="space-y-3">
        {RANGE_ORDER.map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => onSelect?.(range)}
            className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98]"
          >
            <span className="text-sm text-gray-700">{range}</span>
            <span className="text-sm font-semibold text-gray-900">{toNumber(summary?.[range])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Reusable lightweight summary table retained for small custom sections ── */
function StaticReportTable({ title, tip, rows, columns, onRowClick }) {
  return (
    <div className="workspace-card">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="section-title">{title}</h2>
        {tip && <InfoTip text={tip} />}
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No data available yet.</p>
      ) : (
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className="table-header px-4 py-3">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id || row.job_id || row.application_id || index}
                  className={`table-row ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3 text-gray-700">
                      {column.render ? column.render(row) : (row[column.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MIS() {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState({
    funnel: [],
    entitySummary: [],
    backfillSummary: [],
    newPositionsSummary: [],
    monthlyOffers: [],
    openPositionsTat: [],
    offersTat: [],
    selectionToOffer: [],
    recruiterSourcing: [],
    backoutsSummary: { details: [], summary: {} },
    timeToFill: { details: [], averages: [], average_days: null },
    timeToJoin: { details: [], average_days: null },
    offerAcceptance: { details: [], rate: null, accepted: 0, total: 0 },
    offerJoinRatio: { details: [], ratio: null, joined: 0, offered: 0 },
  });
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailRows, setDetailRows] = useState([]);
  const [groupBy, setGroupBy] = useState('department');
  const [groupSummaryRows, setGroupSummaryRows] = useState([]);
  const [groupSummaryLoading, setGroupSummaryLoading] = useState(false);
  const [activeFunnelStage, setActiveFunnelStage] = useState(null);

  useEffect(() => {
    const loadPage = async () => {
      setLoading(true);
      try {
        const [
          funnel,
          entitySummary,
          backfillSummary,
          newPositionsSummary,
          monthlyOffers,
          openPositionsTat,
          offersTat,
          selectionToOffer,
          recruiterSourcing,
          backoutsSummary,
          timeToFill,
          timeToJoin,
          offerAcceptance,
          offerJoinRatio,
        ] = await Promise.all([
          misAPI.funnel().catch(() => ({ data: [] })),
          misAPI.entitySummary().catch(() => ({ data: [] })),
          misAPI.backfillSummary().catch(() => ({ data: [] })),
          misAPI.newPositionsSummary().catch(() => ({ data: [] })),
          misAPI.monthlyOffers().catch(() => ({ data: [] })),
          misAPI.openPositionsTat().catch(() => ({ data: [] })),
          misAPI.offersTat().catch(() => ({ data: [] })),
          misAPI.selectionToOffer().catch(() => ({ data: [] })),
          misAPI.recruiterSourcing().catch(() => ({ data: [] })),
          misAPI.backoutsSummary().catch(() => ({ data: { details: [], summary: {} } })),
          misAPI.timeToFill().catch(() => ({ data: { details: [], averages: [], average_days: null } })),
          misAPI.timeToJoin().catch(() => ({ data: { details: [], average_days: null } })),
          misAPI.offerAcceptanceRate().catch(() => ({ data: { details: [], rate: null, accepted: 0, total: 0 } })),
          misAPI.offerJoinRatio().catch(() => ({ data: { details: [], ratio: null, joined: 0, offered: 0 } })),
        ]);

        setDatasets({
          funnel: Array.isArray(funnel.data) ? funnel.data : [],
          entitySummary: Array.isArray(entitySummary.data) ? entitySummary.data : [],
          backfillSummary: Array.isArray(backfillSummary.data) ? backfillSummary.data : [],
          newPositionsSummary: Array.isArray(newPositionsSummary.data) ? newPositionsSummary.data : [],
          monthlyOffers: Array.isArray(monthlyOffers.data) ? monthlyOffers.data : [],
          openPositionsTat: Array.isArray(openPositionsTat.data) ? openPositionsTat.data : [],
          offersTat: Array.isArray(offersTat.data) ? offersTat.data : [],
          selectionToOffer: Array.isArray(selectionToOffer.data) ? selectionToOffer.data : [],
          recruiterSourcing: Array.isArray(recruiterSourcing.data) ? recruiterSourcing.data : [],
          backoutsSummary: backoutsSummary.data || { details: [], summary: {} },
          timeToFill: timeToFill.data || { details: [], averages: [], average_days: null },
          timeToJoin: timeToJoin.data || { details: [], average_days: null },
          offerAcceptance: offerAcceptance.data || { details: [], rate: null, accepted: 0, total: 0 },
          offerJoinRatio: offerJoinRatio.data || { details: [], ratio: null, joined: 0, offered: 0 },
        });
      } catch {
        toast.error('Failed to load MIS analytics');
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadGroupSummary = async () => {
      try {
        setGroupSummaryLoading(true);
        const res = await misAPI.drilldownSummary(groupBy);
        if (!cancelled) {
          setGroupSummaryRows(res.data?.items || res.data?.data || []);
        }
      } catch {
        if (!cancelled) {
          setGroupSummaryRows([]);
        }
      } finally {
        if (!cancelled) setGroupSummaryLoading(false);
      }
    };

    loadGroupSummary();
    return () => { cancelled = true; };
  }, [groupBy]);

  const funnelTotal = useMemo(
    () => datasets.funnel.reduce((sum, row) => sum + toNumber(row.count), 0),
    [datasets.funnel]
  );
  const openTatSummary = useMemo(
    () => buildTatSummary(datasets.openPositionsTat, 'tat_days'),
    [datasets.openPositionsTat]
  );
  const offersTatSummary = useMemo(
    () => buildTatSummary(datasets.offersTat.filter((row) => row.first_offer_date), 'avg_days_to_offer'),
    [datasets.offersTat]
  );

  const topRecruiterClosers = useMemo(
    () => [...datasets.monthlyOffers].sort((left, right) => toNumber(right.closures) - toNumber(left.closures)).slice(0, 8),
    [datasets.monthlyOffers]
  );
  const topSourcing = useMemo(
    () => [...datasets.recruiterSourcing].sort((left, right) => toNumber(right.total) - toNumber(left.total)).slice(0, 8),
    [datasets.recruiterSourcing]
  );

  const maxRecruiterClosures = Math.max(...topRecruiterClosers.map((row) => toNumber(row.closures)), 1);
  const activeGroupLabel = DRILLDOWN_OPTIONS.find(([key]) => key === groupBy)?.[1] || 'Department';

  const showDrilldown = (title, rows) => {
    setDetailTitle(title);
    setDetailRows(rows.slice(0, 120));
    setDrilldownOpen(true);
  };

  const handleOpenTatRange = (label, groupKey) => {
    const source = groupKey === 'replacement'
      ? datasets.openPositionsTat.filter((row) => isReplacement(row))
      : groupKey === 'newPosition'
        ? datasets.openPositionsTat.filter((row) => !isReplacement(row))
        : datasets.openPositionsTat;
    showDrilldown(`Open Positions TAT | ${label} | ${groupKey === 'overall' ? 'Overall' : groupKey === 'replacement' ? 'Replacement' : 'New Position'}`, source.filter((row) => bucketForDays(row.tat_days) === label));
  };

  const handleOffersTatRange = (label, groupKey) => {
    const source = groupKey === 'replacement'
      ? datasets.offersTat.filter((row) => isReplacement(row))
      : groupKey === 'newPosition'
        ? datasets.offersTat.filter((row) => !isReplacement(row))
        : datasets.offersTat;
    showDrilldown(`Offers TAT | ${label} | ${groupKey === 'overall' ? 'Overall' : groupKey === 'replacement' ? 'Replacement' : 'New Position'}`, source.filter((row) => bucketForDays(row.avg_days_to_offer) === label));
  };

  const handleFunnelClick = (stage) => {
    setActiveFunnelStage(stage);
    misAPI.drilldownDetails({ group_by: 'department', stage_bucket: stage })
      .then((res) => showDrilldown(`Funnel Stage | ${stage}`, res.data?.rows || res.data?.items || []))
      .catch(() => toast.error('Failed to load funnel drilldown'))
      .finally(() => setActiveFunnelStage(null));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 rounded-full border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      {/* ── Hero ── */}
      <section className="aurora-panel">
        <div className="aurora-content grid gap-6 xl:grid-cols-[1.25fr,0.75fr]">
          <div className="max-w-4xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">MIS Reports</p>
            <h1 className="mt-3 font-['Fraunces'] text-[3rem] leading-[0.94] tracking-[-0.05em] text-white">
              Hiring operations intelligence shaped for daily review, workbook parity, and live drilldown
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="glass-chip border-white/15 bg-white/10 text-cyan-100">Workbook-parity reports</span>
              <span className="glass-chip border-white/15 bg-white/10 text-cyan-100">Live drilldowns</span>
              <span className="glass-chip border-white/15 bg-white/10 text-cyan-100">Offer + join conversion</span>
            </div>
          </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="signal-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/80">Drilldown Mode</p>
              <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">Click any stage, range, recruiter, or entity slice</p>
              </div>
              <div className="signal-card">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/80">Coverage</p>
              <p className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">TAT, offers, fill, joins, backouts, sourcing, closures, funnel depth</p>
              </div>
            </div>
          </div>
      </section>

      {/* ── Top Metrics ── */}
      <div className="operating-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <MetricCard
          label="Open Positions"
          value={compactNumber(datasets.openPositionsTat.length)}
          tip="Total jobs currently open and aging in the pipeline"
          tone="text-blue-700"
          accent={METRIC_ACCENTS[0]}
          onClick={() => showDrilldown('Open Positions', datasets.openPositionsTat.slice(0, 50))}
        />
        <MetricCard
          label="Offers Logged"
          value={compactNumber(datasets.offersTat.filter((row) => row.first_offer_date).length)}
          tip="Jobs where a first-offer timestamp has been recorded"
          tone="text-teal-700"
          accent={METRIC_ACCENTS[1]}
          onClick={() => showDrilldown('Offers Logged', datasets.offersTat.filter((r) => r.first_offer_date).slice(0, 50))}
        />
        <MetricCard
          label="Time to Fill"
          value={datasets.timeToFill.average_days != null ? `${datasets.timeToFill.average_days}d` : '--'}
          tip="Average days from requisition raised to first offer"
          tone="text-indigo-700"
          accent={METRIC_ACCENTS[2]}
          onClick={() => showDrilldown('Time to Fill Details', datasets.timeToFill.details || [])}
        />
        <MetricCard
          label="Time to Join"
          value={datasets.timeToJoin.average_days != null ? `${datasets.timeToJoin.average_days}d` : '--'}
          tip="Average days from offer acceptance to joining date"
          tone="text-emerald-700"
          accent={METRIC_ACCENTS[3]}
          onClick={() => showDrilldown('Time to Join Details', datasets.timeToJoin.details || [])}
        />
        <MetricCard
          label="Offer Acceptance"
          value={formatPercent(datasets.offerAcceptance.rate)}
          tip={`${datasets.offerAcceptance.accepted || 0} accepted / ${datasets.offerAcceptance.total || 0} offers`}
          tone="text-amber-700"
          accent={METRIC_ACCENTS[4]}
          onClick={() => showDrilldown('Offer Acceptance Details', datasets.offerAcceptance.details || [])}
        />
        <MetricCard
          label="Offer-to-Join"
          value={formatPercent(datasets.offerJoinRatio.ratio)}
          tip={`${datasets.offerJoinRatio.joined || 0} joined / ${datasets.offerJoinRatio.offered || 0} offers`}
          tone="text-slate-700"
          accent={METRIC_ACCENTS[5]}
          onClick={() => showDrilldown('Offer-to-Join Details', datasets.offerJoinRatio.details || [])}
        />
      </div>

      {/* ── Funnel ── */}
      <div className="funnel-board">
        <div className="flex items-center gap-2 mb-6">
          <h2 className="section-title">Funnel View</h2>
          <InfoTip text="Click any stage to drill down into the matching live candidate rows. Widths narrow proportionally by stage." />
        </div>
        {!datasets.funnel.length ? (
          <p className="py-10 text-center text-sm text-gray-400">No funnel data available.</p>
        ) : (
          <div className="space-y-3">
            {FUNNEL_STAGES.map((stage, index) => {
              const row = datasets.funnel.find((item) => item.stage === stage || item.status === stage);
              const count = toNumber(row?.count);
              const widthPct = Math.max(34, 100 - index * 9.5);
              const isActive = activeFunnelStage === stage;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => handleFunnelClick(stage)}
                  className="block w-full text-left group"
                >
                  <div className="mx-auto transition-all duration-300" style={{ width: `${widthPct}%` }}>
                    <div
                      className={`relative rounded-[26px] bg-gradient-to-r ${FUNNEL_COLORS[stage]} px-6 py-4 text-white transition-all duration-300 group-hover:scale-[1.015] group-hover:shadow-[0_22px_50px_rgba(15,23,42,0.18)] group-active:scale-[0.99] ${isActive ? 'animate-pulse' : ''}`}
                      style={{ boxShadow: `0 18px 40px ${FUNNEL_ACCENTS[stage]}22` }}
                    >
                      {/* Gradient transition connector */}
                      {index < FUNNEL_STAGES.length - 1 && (
                        <div
                          className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-0 h-0 opacity-40"
                          style={{
                            borderLeft: '12px solid transparent',
                            borderRight: '12px solid transparent',
                            borderTop: `12px solid ${FUNNEL_ACCENTS[stage]}`,
                          }}
                        />
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold uppercase tracking-[0.18em]">{stage}</p>
                          <p className="mt-1 text-xs text-white/80">
                            {funnelTotal ? `${Math.round((count / funnelTotal) * 100)}% of tracked` : 'No candidates yet'}
                          </p>
                        </div>
                        <p className="text-2xl font-semibold">{count}</p>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Operational Drilldowns ── */}
      <section className="workspace-card">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-center gap-2">
            <div>
              <p className="workspace-kicker">Operational Drilldowns</p>
              <h2 className="section-title mt-2">Live hiring picture by {activeGroupLabel.toLowerCase()}</h2>
            </div>
            <InfoTip text="Inspect demand, offers, interviews, and TAT buildup. Each card opens underlying live ATS rows in a detail panel." />
          </div>
          <div className="flex flex-wrap gap-2">
            {DRILLDOWN_OPTIONS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setGroupBy(key)}
                className={groupBy === key ? 'btn-primary' : 'btn-secondary'}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {groupSummaryLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin h-6 w-6 rounded-full border-b-2 border-indigo-600" />
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {groupSummaryRows.slice(0, 12).map((row, idx) => (
              <button
                key={`${groupBy}-${row.group_value}`}
                type="button"
                onClick={() => misAPI.drilldownDetails({ group_by: groupBy, group_value: row.group_value }).then((res) => showDrilldown(`${activeGroupLabel} | ${row.group_value}`, res.data?.rows || res.data?.items || [])).catch(() => toast.error('Failed to load drilldown details'))}
                className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)} rounded-[28px] border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-indigo-200 hover:bg-indigo-50/50 hover:shadow-md active:scale-[0.98]`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="workspace-kicker">{activeGroupLabel}</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-gray-950">{row.group_value}</h3>
                  </div>
                  <span className="glass-chip text-gray-700">{row.total_candidates} total</span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="surface-muted">
                    <p className="workspace-kicker">Open</p>
                    <p className="mt-2 text-xl font-semibold text-gray-900">{row.open_count}</p>
                  </div>
                  <div className="surface-muted">
                    <p className="workspace-kicker">Interview</p>
                    <p className="mt-2 text-xl font-semibold text-gray-900">{row.interview_count}</p>
                  </div>
                  <div className="surface-muted">
                    <p className="workspace-kicker">Offered</p>
                    <p className="mt-2 text-xl font-semibold text-teal-700">{row.offered_count}</p>
                  </div>
                  <div className="surface-muted">
                    <p className="workspace-kicker">Avg TAT</p>
                    <p className="mt-2 text-xl font-semibold text-indigo-700">{row.avg_tat_days != null ? `${row.avg_tat_days}d` : '--'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── TAT Panels ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="workspace-card">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="section-title">Open Positions TAT</h2>
            <InfoTip text="Aging distribution of open positions, split by overall, replacement, and new positions." />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <RangeSummary title="Overall Open Positions" summary={openTatSummary.overall} onSelect={(range) => handleOpenTatRange(range, 'overall')} />
            <RangeSummary title="Replacement Positions" summary={openTatSummary.replacement} onSelect={(range) => handleOpenTatRange(range, 'replacement')} />
            <RangeSummary title="New Positions" summary={openTatSummary.newPosition} onSelect={(range) => handleOpenTatRange(range, 'newPosition')} />
          </div>
        </div>

        <div className="workspace-card">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="section-title">Offers TAT</h2>
            <InfoTip text="Time-to-offer distribution, comparing replacement versus new-position pipelines." />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <RangeSummary title="Overall Offers" summary={offersTatSummary.overall} onSelect={(range) => handleOffersTatRange(range, 'overall')} />
            <RangeSummary title="Replacement Offers" summary={offersTatSummary.replacement} onSelect={(range) => handleOffersTatRange(range, 'replacement')} />
            <RangeSummary title="New Position Offers" summary={offersTatSummary.newPosition} onSelect={(range) => handleOffersTatRange(range, 'newPosition')} />
          </div>
        </div>
      </div>

      {/* ── Open Positions Detail ── */}
      <DataTable
        title="Open Positions Detail"
        subtitle="Top 20 most-aged open jobs, sorted by TAT descending."
        data={[...datasets.openPositionsTat].sort((left, right) => toNumber(right.tat_days) - toNumber(left.tat_days)).slice(0, 20)}
        onRowClick={(row) => showDrilldown(`Open Position | ${row.job_id}`, [row])}
        exportFileName="open-positions-detail"
        columns={[
          { key: 'job_title', label: 'Job Title' },
          { key: 'job_id', label: 'Job ID' },
          { key: 'requisition_type', label: 'Type', render: (row) => isReplacement(row) ? 'Replacement' : 'New' },
          { key: 'phase', label: 'Phase' },
          { key: 'business_unit', label: 'Entity' },
          { key: 'department', label: 'Department' },
          { key: 'sub_department', label: 'Sub Department' },
          { key: 'recruiter_email', label: 'Recruiter' },
          { key: 'tat_days', label: 'TAT (Days)' },
        ]}
      />

      {/* ── Offers Detail ── */}
      <DataTable
        title="Offers Detail"
        subtitle="Jobs with first-offer movement, sorted by offer TAT descending."
        data={[...datasets.offersTat].filter((row) => row.first_offer_date).sort((left, right) => toNumber(right.avg_days_to_offer) - toNumber(left.avg_days_to_offer)).slice(0, 20)}
        onRowClick={(row) => showDrilldown(`Offer TAT | ${row.job_id}`, [row])}
        exportFileName="offers-detail"
        columns={[
          { key: 'job_title', label: 'Job Title' },
          { key: 'job_id', label: 'Job ID' },
          { key: 'requisition_type', label: 'Type', render: (row) => isReplacement(row) ? 'Replacement' : 'New' },
          { key: 'phase', label: 'Phase' },
          { key: 'department', label: 'Department' },
          { key: 'recruiter_email', label: 'Recruiter' },
          { key: 'avg_days_to_offer', label: 'Offers TAT' },
          { key: 'still_open', label: 'Still Open' },
        ]}
      />

      {/* ── Entity + Replacement + New Position Summaries ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DataTable
          title="Entity / BU / Phase / Department Summary"
          subtitle="Open, offered, selected, joined, and rejected counts grouped by entity slice."
          data={datasets.entitySummary.slice(0, 20)}
          onRowClick={(row) => misAPI.drilldownDetails({ group_by: 'department', group_value: row.department }).then((res) => showDrilldown(`Entity Summary | ${row.department}`, res.data?.rows || res.data?.items || [])).catch(() => toast.error('Failed to load drilldown'))}
          exportFileName="entity-summary"
          columns={[
            { key: 'business_unit', label: 'Entity / BU' },
            { key: 'phase', label: 'Phase' },
            { key: 'department', label: 'Department' },
            { key: 'open_count', label: 'Open' },
            { key: 'offered_count', label: 'Offered' },
            { key: 'selected_count', label: 'Selected' },
            { key: 'joined_count', label: 'Joined' },
          ]}
        />

        <div className="grid grid-cols-1 gap-6">
          <DataTable
            title="Replacement Summary"
            subtitle="Unit-wise and department-wise replacement hiring progress."
            data={datasets.backfillSummary.slice(0, 12)}
            onRowClick={(row) => showDrilldown(`Replacement Summary | ${row.business_unit || row.phase || row.department}`, [row])}
            exportFileName="replacement-summary"
            columns={[
              { key: 'business_unit', label: 'Entity / BU' },
              { key: 'phase', label: 'Phase' },
              { key: 'department', label: 'Department' },
              { key: 'open_count', label: 'Open' },
              { key: 'offered_count', label: 'Offered' },
              { key: 'selected_count', label: 'Selected' },
            ]}
          />
          <DataTable
            title="New Positions Summary"
            subtitle="Unit-wise and department-wise new-position hiring progress."
            data={datasets.newPositionsSummary.slice(0, 12)}
            onRowClick={(row) => showDrilldown(`New Positions Summary | ${row.business_unit || row.phase || row.department}`, [row])}
            exportFileName="new-positions-summary"
            columns={[
              { key: 'business_unit', label: 'Entity / BU' },
              { key: 'phase', label: 'Phase' },
              { key: 'department', label: 'Department' },
              { key: 'open_count', label: 'Open' },
              { key: 'offered_count', label: 'Offered' },
              { key: 'selected_count', label: 'Selected' },
            ]}
          />
        </div>
      </div>

      {/* ── Recruiter Closers + Sourcing ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="workspace-card">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="section-title">Monthly Offers Closers by Recruiter</h2>
            <InfoTip text="Recruiter-wise offer closures and pending joins for the current month." />
          </div>
          {topRecruiterClosers.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No recruiter closure data available.</p>
          ) : (
            <div className="space-y-3">
              {topRecruiterClosers.map((row, idx) => (
                <button
                  key={row.recruiter}
                  type="button"
                  onClick={() => showDrilldown(`Recruiter Closures | ${row.recruiter}`, datasets.monthlyOffers.filter((item) => item.recruiter === row.recruiter))}
                  className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)} w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.99]`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{row.recruiter}</p>
                      <p className="mt-1 text-xs text-gray-500">Offers {row.offers || 0} | Closures {row.closures || 0} | Pending {row.pending_joins || 0}</p>
                    </div>
                    <div className="w-32 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
                        style={{ width: `${Math.max(8, Math.round((toNumber(row.closures) / maxRecruiterClosures) * 100))}%` }}
                      />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <DataTable
          title="Recruiter Wise Offers by Sourcing Type"
          subtitle="LinkedIn, referral, agency, campus, internal, and portal contribution by recruiter."
          data={topSourcing}
          onRowClick={(row) => showDrilldown(`Sourcing Mix | ${row.recruiter}`, [row])}
          exportFileName="recruiter-sourcing"
          columns={[
            { key: 'recruiter', label: 'Recruiter' },
            { key: 'job_portal', label: 'Portal / Direct' },
            { key: 'referral', label: 'Referral' },
            { key: 'campus', label: 'Campus' },
            { key: 'agency', label: 'Agency' },
            { key: 'internal', label: 'Internal' },
            { key: 'total', label: 'Total' },
          ]}
        />
      </div>

      {/* ── Selection-to-Offer + Backouts ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DataTable
          title="Selection to Offer TAT"
          subtitle="Average lag between final interview completion and first offer event."
          data={datasets.selectionToOffer.slice(0, 16)}
          onRowClick={(row) => showDrilldown(`Selection to Offer | ${row.department || row.recruiter_email || 'Summary'}`, [row])}
          exportFileName="selection-to-offer"
          columns={[
            { key: 'department', label: 'Department' },
            { key: 'recruiter_email', label: 'Recruiter' },
            { key: 'total', label: 'Profiles' },
            { key: 'avg_selection_to_offer_days', label: 'Avg Days' },
            { key: 'min_days', label: 'Min Days' },
            { key: 'max_days', label: 'Max Days' },
          ]}
        />

        <DataTable
          title="Backouts Summary"
          subtitle="Withdrawals, offer rejections, and dropouts with reasons."
          data={(datasets.backoutsSummary.details || []).slice(0, 16)}
          onRowClick={(row) => showDrilldown(`Backouts | ${row.reason}`, (datasets.backoutsSummary.details || []).filter((item) => item.reason === row.reason))}
          exportFileName="backouts-summary"
          columns={[
            { key: 'reason', label: 'Reason' },
            { key: 'recruiter', label: 'Recruiter' },
            { key: 'count', label: 'Count' },
          ]}
        />
      </div>

      {/* ── Drilldown Modal ── */}
      <AppModal
        open={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
        title={detailTitle}
        width="full"
        footer={
          detailRows.length > 0 ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{detailRows.length} row{detailRows.length !== 1 ? 's' : ''}</p>
              <button
                type="button"
                onClick={() => exportToExcel(detailRows, `${(detailTitle || 'mis-report').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.xlsx`)}
                className="btn-primary inline-flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export to Excel
              </button>
            </div>
          ) : null
        }
      >
        {detailRows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">Select a metric, range, or recruiter slice to inspect matching rows.</p>
        ) : (
          <DataTable
            title={detailTitle}
            subtitle="Use the built-in search, per-column filters, selection, export, and column visibility controls to inspect the clicked segment."
            data={detailRows}
            exportFileName={(detailTitle || 'mis-report').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}
            columns={Object.keys(detailRows[0]).slice(0, 12).map((key) => ({
              key,
              label: key.replace(/_/g, ' '),
            }))}
          />
        )}
      </AppModal>
    </div>
  );
}
