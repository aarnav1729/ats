// Design-system v2 primitives. Layered on top of the existing UI kit so older
// pages keep working while new pages adopt these. Animations are CSS-driven
// (see /styles/v2.css) so the bundle stays small.

import { useEffect, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Hero strip with parallax mesh gradient
// ──────────────────────────────────────────────────────────────────────────
export function Hero({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="v2-hero v2-parallax v2-fade-up">
      {eyebrow && <div className="v2-hero-eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPI tile  gradient accent bar, hover lift, optional click-through
// ──────────────────────────────────────────────────────────────────────────
export function KPI({ eyebrow, value, foot, tone = 'brand', onClick, hint, animationDelay = 0 }) {
  return (
    <div
      className={`v2-kpi ${onClick ? 'v2-kpi-clickable v2-fade-up' : 'v2-fade-up'}`}
      data-tone={tone}
      style={{ animationDelay: `${animationDelay}ms` }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={hint}
    >
      <div className="v2-kpi-accent" />
      <div className="v2-kpi-eyebrow">{eyebrow}</div>
      <div className="v2-kpi-value">{value ?? ''}</div>
      {foot && <div className="v2-kpi-foot">{foot}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Status pill  semantic stage colours
// ──────────────────────────────────────────────────────────────────────────
const STAGE_MAP = {
  InQueue: 'queue', Applied: 'applied',
  Shortlisted: 'shortlisted',
  AwaitingHODResponse: 'shortlisted',
  AwaitingInterviewScheduling: 'interview',
  Round1: 'interview', Round2: 'interview', Round3: 'interview',
  AwaitingFeedback: 'interview',
  Selected: 'selected',
  DocumentsInProgress: 'docs', DocumentsCleared: 'docs',
  CTCSent: 'ctc', CTCAcceptance: 'ctc', CTCAccepted: 'ctc',
  OfferInProcess: 'offer', SignaturePending: 'offer', Offered: 'offer', OfferAccepted: 'offer',
  Postponed: 'offer',
  Joined: 'joined',
  HRRejected: 'rejected', HODRejected: 'rejected',
  Round1Rejected: 'rejected', Round2Rejected: 'rejected', Round3Rejected: 'rejected',
  OfferRejected: 'rejected', OfferDropout: 'rejected', SalaryRejected: 'rejected', Withdrawn: 'rejected',
  Blacklisted: 'blacklist',
  TalentPool: 'talentpool',
};
const HUMAN_LABEL = {
  InQueue: 'In Queue',
  AwaitingHODResponse: 'Awaiting HOD',
  AwaitingInterviewScheduling: 'Scheduling',
  AwaitingFeedback: 'Feedback Pending',
  DocumentsInProgress: 'Docs in Progress',
  DocumentsCleared: 'Docs Cleared',
  CTCSent: 'CTC Sent',
  CTCAcceptance: 'CTC Pending',
  CTCAccepted: 'CTC Accepted',
  OfferInProcess: 'Offer Prep',
  SignaturePending: 'Signature Pending',
  OfferAccepted: 'Offer Accepted',
  OfferRejected: 'Offer Rejected',
  OfferDropout: 'Dropout',
  SalaryRejected: 'CTC Rejected',
  HRRejected: 'HR Rejected',
  HODRejected: 'HOD Rejected',
  Round1Rejected: 'R1 Rejected',
  Round2Rejected: 'R2 Rejected',
  Round3Rejected: 'R3 Rejected',
  TalentPool: 'Talent Pool',
};
export function StatusPillV2({ status, children }) {
  const stage = STAGE_MAP[status] || 'queue';
  const label = children || HUMAN_LABEL[status] || status || '';
  return <span className="v2-pill" data-stage={stage}>{label}</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// Timeline rail  vertical actor/action/timestamp display
// ──────────────────────────────────────────────────────────────────────────
export function TimelineRail({ items }) {
  if (!items?.length) {
    return (
      <div className="v2-empty">
        <div className="v2-empty-icon">⏱</div>
        <p className="text-sm text-slate-700 font-medium">Nothing in the timeline yet.</p>
        <p className="mt-1 text-xs text-slate-500">Actions taken on this record will appear here.</p>
      </div>
    );
  }
  return (
    <div className="v2-timeline">
      {items.map((item, idx) => (
        <div key={item.id || idx} className="v2-tl-item" data-tone={item.tone || 'info'}>
          <div className="v2-tl-time">{item.timeLabel}</div>
          <div className="v2-tl-headline">
            {item.headline}
            {item.actor && <span className="v2-tl-actor"> · {item.actor}</span>}
          </div>
          {item.meta && <div className="v2-tl-meta">{item.meta}</div>}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Working modal  used by TAT explorer to show calculation provenance
// ──────────────────────────────────────────────────────────────────────────
export function WorkingModal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="app-modal-backdrop" onClick={onClose}>
      <div className="app-modal-panel app-modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-header">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="app-modal-body overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
          {children}
        </div>
        <div className="app-modal-footer">
          <button className="v2-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// IST timestamp  uses Intl.DateTimeFormat in Asia/Kolkata
// ──────────────────────────────────────────────────────────────────────────
const IST_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: true,
});
export function fmtIST(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${IST_FMT.format(d)} IST`;
}

// Relative ("3 days ago")  quick glance
export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = Math.floor(diff / 86400000);
  return `${d}d ago`;
}

export function humanDuration(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ──────────────────────────────────────────────────────────────────────────
// Vibrant CTA button
// ──────────────────────────────────────────────────────────────────────────
export function PrimaryCTA({ children, onClick, type = 'button', disabled }) {
  return (
    <button type={type} className="v2-btn-primary" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
export function GhostBtn({ children, onClick, type = 'button' }) {
  return <button type={type} className="v2-btn-ghost" onClick={onClick}>{children}</button>;
}

// ──────────────────────────────────────────────────────────────────────────
// In-view fade-up  auto-applies animation when element scrolls into view
// ──────────────────────────────────────────────────────────────────────────
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); obs.disconnect(); } });
    }, { threshold: 0.1 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`${className} ${shown ? 'v2-fade-up' : ''}`} style={{ animationDelay: `${delay}ms`, opacity: shown ? undefined : 0 }}>
      {children}
    </Tag>
  );
}
