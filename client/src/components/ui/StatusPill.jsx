const TONE_MAP = {
  success: 'status-pill-success',
  info: 'status-pill-info',
  warning: 'status-pill-warning',
  danger: 'status-pill-danger',
  purple: 'status-pill-purple',
  neutral: 'status-pill-neutral',
};

export default function StatusPill({ tone = 'neutral', children, dot = true, className = '' }) {
  const toneClass = TONE_MAP[tone] || TONE_MAP.neutral;
  return (
    <span className={`${dot ? 'status-pill' : 'badge'} ${toneClass} ${className}`}>
      {children}
    </span>
  );
}

export function toneForStatus(status) {
  if (!status) return 'neutral';
  const s = String(status);
  if (/(Rejected|Withdrawn|Dropout|Cancelled|Failed)/i.test(s)) return 'danger';
  if (/(Awaiting|Pending|In ?Progress|Process)/i.test(s)) return 'warning';
  if (/(Shortlisted|Applied|Draft|Submitted|Scheduled|Round)/i.test(s)) return 'info';
  if (/(Approved|Accepted|Joined|Selected|Complete|Published|Active|Offered)/i.test(s)) return 'success';
  return 'neutral';
}
