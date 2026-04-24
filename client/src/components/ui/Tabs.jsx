export default function Tabs({ tabs = [], value, onChange, variant = 'underline' }) {
  if (variant === 'pills') {
    return (
      <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-muted p-1">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onChange?.(tab.value)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count != null && (
                <span className={`inline-flex min-w-[18px] justify-center rounded-full px-1.5 text-[10px] font-semibold ${active ? 'bg-navy-800 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="tab-list" role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(tab.value)}
            className="tab-item"
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && (
              <span className={`inline-flex min-w-[18px] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-600'}`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
