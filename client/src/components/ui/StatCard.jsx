export default function StatCard({ label, value, delta, deltaTone = 'neutral', icon, hint, className = '' }) {
  const deltaColor =
    deltaTone === 'up' ? 'text-success-700' :
    deltaTone === 'down' ? 'text-rose-600' :
    'text-slate-500';
  return (
    <div className={`rounded-xl border border-line bg-white p-4 shadow-xs ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-navy-700">{value ?? '—'}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-600">
            {icon}
          </div>
        )}
      </div>
      {delta && (
        <p className={`mt-2 text-xs font-medium ${deltaColor}`}>
          {delta}
        </p>
      )}
    </div>
  );
}
