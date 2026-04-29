// Premium StatCard. Gradient accent bar at the top, hover lift + glow,
// tabular figures so trailing digits don't shift. Used everywhere a KPI is
// shown — Dashboard, MIS tabs, drilldowns.

const TONE_GRAD = {
  brand: 'linear-gradient(90deg, #1e3a8a, #0c8da3)',
  success: 'linear-gradient(90deg, #047857, #10b981)',
  warn: 'linear-gradient(90deg, #b45309, #f59e0b)',
  danger: 'linear-gradient(90deg, #991b1b, #ef4444)',
  vibrant: 'linear-gradient(90deg, #4f46e5, #ec4899)',
  cool: 'linear-gradient(90deg, #0c4a6e, #06b6d4)',
  neutral: 'linear-gradient(90deg, #334155, #94a3b8)',
};

export default function StatCard({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  icon,
  hint,
  tone = 'brand',
  className = '',
  onClick,
}) {
  const deltaColor =
    deltaTone === 'up' ? 'text-emerald-700' :
    deltaTone === 'down' ? 'text-rose-600' :
    'text-slate-500';
  const accent = TONE_GRAD[tone] || TONE_GRAD.brand;
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 transition will-change-transform ${onClick ? 'cursor-pointer' : ''} hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] hover:border-slate-300 ${className}`}
    >
      {/* Animated gradient accent bar */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: accent, transformOrigin: 'left', animation: 'v2-grow-bar 480ms cubic-bezier(.34,1.2,.64,1) both' }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-1.5 text-[26px] font-bold leading-[1.05] tracking-tight text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value ?? <span className="text-slate-300">—</span>}
          </p>
          {hint && <p className="mt-1 text-xs text-slate-500 leading-relaxed">{hint}</p>}
        </div>
        {icon && (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: accent }}
          >
            {icon}
          </div>
        )}
      </div>
      {delta && (
        <p className={`mt-2 inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-semibold ${deltaColor}`}>
          {delta}
        </p>
      )}
    </div>
  );
}
