// TAT Explorer - premium analytics page that renders any defined TAT pair
// across Requisitions / Jobs / Applications. Each row offers a "Show working"
// modal that reveals the exact rows used to compute the duration.

import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { Hero, KPI, StatusPillV2, WorkingModal, fmtIST, humanDuration, GhostBtn, PrimaryCTA } from '../components/ui/v2';
import { PageHeader } from '../components/ui';
import toast from 'react-hot-toast';

export default function TatExplorer() {
  const [pairs, setPairs] = useState([]);
  const [level, setLevel] = useState('application');
  const [pairId, setPairId] = useState('applied_to_joined');
  const [data, setData] = useState({ pair: null, results: [] });
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(null);
  const [search, setSearch] = useState('');

  // Load pair catalog once.
  useEffect(() => {
    api.get('/tat/pairs').then((r) => setPairs(r.data.pairs || [])).catch(() => {});
  }, []);

  // Reset pairId when level changes to the first available pair for that level.
  useEffect(() => {
    const first = pairs.find((p) => p.level === level);
    if (first && !pairs.find((p) => p.id === pairId && p.level === level)) {
      setPairId(first.id);
    }
  }, [level, pairs]);

  const loadGrid = async () => {
    if (!pairId) return;
    setLoading(true);
    try {
      const r = await api.get('/tat/grid', { params: { level, pair: pairId, limit: 500 } });
      setData(r.data);
    } catch (err) {
      toast.error('Failed to load TAT grid');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGrid(); /* eslint-disable-next-line */ }, [pairId, level]);

  const filtered = useMemo(() => {
    if (!search.trim()) return data.results;
    const s = search.toLowerCase();
    return data.results.filter((row) => JSON.stringify(row.entity).toLowerCase().includes(s));
  }, [data.results, search]);

  // KPI: count, missing, p50, p90 (in seconds)
  const stats = useMemo(() => {
    const completed = filtered.filter((r) => r.tat.duration_seconds != null);
    const sorted = completed.map((r) => r.tat.duration_seconds).sort((a, b) => a - b);
    const p = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;
    return {
      total: filtered.length,
      missing: filtered.length - completed.length,
      p50: p(0.5),
      p90: p(0.9),
    };
  }, [filtered]);

  const exportCsv = () => {
    const cols = ['entity_id', 'label', 'from_ts', 'to_ts', 'duration_seconds', 'duration_human'];
    const rows = filtered.map((r) => [
      r.entity._entityId,
      JSON.stringify({
        candidate: r.entity.candidate_name,
        email: r.entity.candidate_email,
        status: r.entity.status,
        job: r.entity.job_title,
      }),
      r.tat.from?.ts || '',
      r.tat.to?.ts || '',
      r.tat.duration_seconds ?? '',
      r.tat.duration_human || '',
    ]);
    const csv = [cols.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tat-${pairId}-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container space-y-5">
      <Hero
        eyebrow="Analytics"
        title="TAT Explorer"
        subtitle="Every TAT number in the product, fully defined and traceable. Pick a level, pick a pair, see distribution, and click any row to see the exact rows we used to compute the duration."
        actions={(
          <>
            <PrimaryCTA onClick={loadGrid}>↻ Refresh</PrimaryCTA>
            <GhostBtn onClick={exportCsv}>↓ Export CSV</GhostBtn>
          </>
        )}
      />

      {/* Level + pair pickers */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Level</p>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {['requisition', 'job', 'application'].map((lv) => (
              <button
                key={lv}
                onClick={() => setLevel(lv)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition ${level === lv ? 'bg-white shadow text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}
              >{lv}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[260px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">TAT pair</p>
          <select
            className="input-field w-full"
            value={pairId}
            onChange={(e) => setPairId(e.target.value)}
          >
            {pairs.filter((p) => p.level === level).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Filter rows</p>
          <input className="input-field w-full" placeholder="Candidate, job, status…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Active pair definition + KPIs */}
      {data.pair && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-white p-5 v2-fade-up">
          <div className="flex items-start gap-3">
            <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500 v2-pulse-ring" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">{data.pair.label}</p>
              <p className="mt-1 text-sm text-slate-700 leading-relaxed">{data.pair.description}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI eyebrow="Records" tone="brand" value={stats.total} animationDelay={0} />
        <KPI eyebrow="With data" tone="success" value={stats.total - stats.missing} foot={`${stats.missing} missing`} animationDelay={60} />
        <KPI eyebrow="P50" tone="vibrant" value={humanDuration(stats.p50)} hint="Median duration" animationDelay={120} />
        <KPI eyebrow="P90" tone="warn" value={humanDuration(stats.p90)} hint="90th percentile - slowest tail" animationDelay={180} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="v2-empty"><div className="v2-empty-icon">∅</div>
            <p className="text-sm font-medium text-slate-700">No records in scope.</p>
            <p className="mt-1 text-xs text-slate-500">Adjust your filters or pick a different level.</p>
          </div>
        ) : (
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Stage</th>
                  <th>From</th>
                  <th>To</th>
                  <th style={{ textAlign: 'right' }}>Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr key={idx}>
                    <td>
                      <p className="font-semibold text-slate-900">
                        {r.entity.candidate_name || r.entity.job_title || r.entity.requisition_id || r.entity._entityId}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.entity.candidate_email || r.entity.job_code || r.entity.business_unit_id}
                      </p>
                    </td>
                    <td>{r.entity.status ? <StatusPillV2 status={r.entity.status} /> : '—'}</td>
                    <td className="text-xs">{r.tat.from?.ts ? fmtIST(r.tat.from.ts) : <span className="text-slate-400">missing</span>}</td>
                    <td className="text-xs">{r.tat.to?.ts ? fmtIST(r.tat.to.ts) : <span className="text-slate-400">missing</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.tat.duration_human
                        ? <span className="font-mono text-sm font-semibold text-slate-800">{r.tat.duration_human}</span>
                        : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => setWorking({ row: r, pair: data.pair })}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                      >Show working →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WorkingModal
        open={!!working}
        onClose={() => setWorking(null)}
        title={working ? `Working: ${working.pair.label}` : ''}
      >
        {working && <WorkingDetail row={working.row} pair={working.pair} />}
      </WorkingModal>
    </div>
  );
}

function WorkingDetail({ row, pair }) {
  const f = row.tat.from || {};
  const t = row.tat.to || {};
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3">
        <p className="text-sm text-slate-800 leading-relaxed">{pair.description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ProvenanceCard label="From" tone="indigo" data={f} />
        <ProvenanceCard label="To" tone="emerald" data={t} />
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Computed duration</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{row.tat.duration_human || '—'}</p>
        </div>
        <p className="text-xs text-slate-500 font-mono">
          {row.tat.duration_seconds != null ? `${row.tat.duration_seconds.toLocaleString()} seconds` : 'not computable'}
        </p>
      </div>
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-50">Raw rows used</summary>
        <pre className="v2-working m-0">
{JSON.stringify({ from: f, to: t }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function ProvenanceCard({ label, tone, data }) {
  const ts = data.ts;
  const src = data.source;
  return (
    <div className={`rounded-lg border p-4 bg-white ${tone === 'indigo' ? 'border-indigo-200' : 'border-emerald-200'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${tone === 'indigo' ? 'text-indigo-700' : 'text-emerald-700'}`}>{label}</p>
      <p className="text-base font-semibold text-slate-900 mt-2">{ts ? fmtIST(ts) : <span className="text-slate-400">missing</span>}</p>
      <p className="text-xs text-slate-500 mt-1">Source: <span className="font-mono">{src || '—'}</span></p>
    </div>
  );
}
