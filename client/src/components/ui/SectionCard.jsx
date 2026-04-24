export default function SectionCard({ title, subtitle, actions, children, padding = 'md', className = '', noBody = false }) {
  const pad = padding === 'sm' ? 'p-3' : padding === 'lg' ? 'p-6' : 'p-5';
  return (
    <section className={`rounded-xl border border-line bg-white shadow-xs ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            {title && <h3 className="panel-title">{title}</h3>}
            {subtitle && <p className="panel-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {noBody ? children : <div className={pad}>{children}</div>}
    </section>
  );
}
