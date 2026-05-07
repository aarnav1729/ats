// Shared candidate row used across the three role-home pages.
// Renders candidate identity, current status pill, optional secondary metadata,
// and the single next-action CTA (or a muted hint when nothing is required).

import { Link } from 'react-router-dom';
import { StatusPillV2, fmtIST } from '../ui/v2';
import { nextAction, TONE_CLASSES } from '../../utils/nextAction';

export default function CandidateRow({ app, role, dense = false, extra = null }) {
  const action = nextAction(app, role);
  return (
    <div className={`flex items-center justify-between gap-4 px-4 ${dense ? 'py-2' : 'py-3'} border-b border-slate-100 hover:bg-slate-50 transition-colors`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-slate-900 truncate">{app.candidate_name || '-'}</p>
          <StatusPillV2 status={app.status} />
          {extra}
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">
          {app.job_title || app.ats_job_id || 'No job'}
          {app.candidate_email ? ` · ${app.candidate_email}` : ''}
          {app.updated_at ? ` · ${fmtIST(app.updated_at)}` : ''}
        </p>
        {action?.hint && (
          <p className="text-[11px] text-slate-400 mt-0.5">{action.hint}</p>
        )}
      </div>
      {action ? (
        <Link
          to={action.to}
          title={action.hint}
          className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition shadow-sm ${TONE_CLASSES[action.tone] || TONE_CLASSES.brand}`}
        >
          {action.label}
          <span aria-hidden>→</span>
        </Link>
      ) : (
        <span className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-md bg-slate-100 text-slate-500 text-xs">
          No action
        </span>
      )}
    </div>
  );
}

export function Section({ title, count, accent = 'slate', children, hint }) {
  const accentClasses = {
    slate:    'bg-slate-50 text-slate-700',
    indigo:   'bg-indigo-50 text-indigo-700',
    amber:    'bg-amber-50 text-amber-700',
    emerald:  'bg-emerald-50 text-emerald-700',
    rose:     'bg-rose-50 text-rose-700',
    sky:      'bg-sky-50 text-sky-700',
  }[accent] || 'bg-slate-50 text-slate-700';
  return (
    <section className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-4 shadow-sm">
      <header className={`px-4 py-2.5 border-b border-slate-200 flex items-center justify-between ${accentClasses}`}>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-[11px] opacity-75 mt-0.5">{hint}</p>}
        </div>
        <span className="text-xs font-medium opacity-80 px-2 py-0.5 rounded-full bg-white/60">{count}</span>
      </header>
      {count === 0
        ? <div className="px-4 py-8 text-center text-sm text-slate-400">Nothing here right now.</div>
        : <div>{children}</div>}
    </section>
  );
}
