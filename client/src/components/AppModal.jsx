export default function AppModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'wide',
  bodyClassName = '',
  panelClassName = '',
}) {
  if (!open) return null;

  const widthClass = width === 'compact'
    ? 'app-modal-panel-compact'
    : width === 'full'
      ? 'app-modal-panel-full'
      : 'app-modal-panel-wide';

  return (
    <div className="app-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`app-modal-panel ${widthClass} ${panelClassName}`.trim()}
        onClick={(event) => event.stopPropagation()}
        style={{ overscrollBehavior: 'contain' }}
      >
        {(title || subtitle) && (
          <div className="app-modal-header">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {title ? <h3 className="text-2xl font-semibold tracking-[-0.03em] text-gray-950">{title}</h3> : null}
                {subtitle ? <p className="mt-2 max-w-3xl text-sm text-gray-500">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex-shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        )}
        <div className={`app-modal-body overflow-y-auto ${bodyClassName}`.trim()} style={{ maxHeight: footer ? 'calc(94vh - 168px)' : 'calc(94vh - 104px)' }}>{children}</div>
        {footer ? <div className="app-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
