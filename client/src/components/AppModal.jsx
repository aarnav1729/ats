import { useEffect } from 'react';
import haptic from '../utils/haptic';

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
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        haptic.light();
        onClose?.();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = width === 'compact'
    ? 'app-modal-panel-compact'
    : width === 'full'
      ? 'app-modal-panel-full'
      : 'app-modal-panel-wide';

  const handleClose = () => {
    haptic.light();
    onClose?.();
  };

  return (
    <div className="app-modal-backdrop" onClick={handleClose} role="dialog" aria-modal="true">
      <div
        className={`app-modal-panel ${widthClass} ${panelClassName}`.trim()}
        onClick={(event) => event.stopPropagation()}
        style={{ overscrollBehavior: 'contain' }}
      >
        {(title || subtitle) && (
          <div className="app-modal-header">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {title ? (
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
                    {title}
                  </h3>
                ) : null}
                {subtitle ? (
                  <p style={{ marginTop: 4, fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.5 }}>{subtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close modal"
                style={{
                  width: 32,
                  height: 32,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--text-faint)',
                }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        <div
          className={`app-modal-body overflow-y-auto ${bodyClassName}`.trim()}
          style={{ maxHeight: footer ? 'calc(94vh - 168px)' : 'calc(94vh - 104px)' }}
        >
          {children}
        </div>
        {footer ? <div className="app-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
