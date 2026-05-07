// v2.1 primitives  drop-in companions to v2.jsx that consume the new
// award-tier styles. These are CSS-driven; the JS only handles state +
// mounting effects.

import { useEffect, useMemo, useRef, useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// AnimatedNumber  counts up to a target when it scrolls into view.
// Used for KPIs, totals, raw export counts.
// ──────────────────────────────────────────────────────────────────────────
export function AnimatedNumber({ value, decimals = 0, prefix = '', suffix = '', duration = 900 }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(0);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setArmed(true); obs.disconnect(); } });
    }, { threshold: 0.1 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    const target = Number(value) || 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setShown(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [armed, value, duration]);

  const display = useMemo(() => {
    const v = Number(shown) || 0;
    const fixed = decimals > 0 ? v.toFixed(decimals) : Math.round(v);
    return Number(fixed).toLocaleString();
  }, [shown, decimals]);

  return <span ref={ref} className="v2-count">{prefix}{display}{suffix}</span>;
}

// ──────────────────────────────────────────────────────────────────────────
// Aurora hero  used at the top of marquee pages (Dashboard, Login, TAT, MIS)
// ──────────────────────────────────────────────────────────────────────────
export function AuroraHero({ eyebrow, title, subtitle, actions, kpis }) {
  return (
    <div className="v2-aurora v2-grain">
      {eyebrow && <div className="v2-hero-eyebrow" style={{ color: 'rgba(255,255,255,0.7)' }}>{eyebrow}</div>}
      <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-[1.1] mt-1">{title}</h1>
      {subtitle && <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed opacity-85">{subtitle}</p>}
      {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      {kpis && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <div key={k.label} className="v2-tilt-in rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm px-4 py-3" style={{ animationDelay: `${i * 80}ms` }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-70">{k.label}</p>
              <p className="mt-1 text-[22px] font-bold leading-tight">
                <AnimatedNumber value={k.value} prefix={k.prefix} suffix={k.suffix} />
              </p>
              {k.foot && <p className="text-[11px] opacity-70 mt-0.5">{k.foot}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Loud KPI  full-bleed primary metric with aurora background
// ──────────────────────────────────────────────────────────────────────────
export function LoudKPI({ eyebrow, value, foot, prefix, suffix }) {
  return (
    <div className="v2-kpi-loud v2-grain">
      <p className="v2-kpi-loud-eyebrow">{eyebrow}</p>
      <p className="v2-kpi-loud-value">
        <AnimatedNumber value={value} prefix={prefix} suffix={suffix} />
      </p>
      {foot && <p className="text-xs opacity-70 mt-2">{foot}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// RingProgress  conic-gradient ring with center label
// ──────────────────────────────────────────────────────────────────────────
export function RingProgress({ value = 0, label, color = '#4f46e5' }) {
  const ref = useRef(null);
  useEffect(() => {
    // Animate the conic angle on mount.
    if (!ref.current) return;
    const start = performance.now();
    const target = Math.max(0, Math.min(100, value));
    let raf = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - t, 3);
      ref.current.style.setProperty('--p', `${target * eased}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} className="v2-ring" style={{ '--c': color }}>
        <span>{Math.round(value)}<span className="text-sm opacity-60">%</span></span>
      </div>
      {label && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Marquee  horizontal scroll of chips/messages (status ticker)
// ──────────────────────────────────────────────────────────────────────────
export function Marquee({ items }) {
  const doubled = [...items, ...items];
  return (
    <div className="v2-marquee py-2">
      <div className="v2-marquee-track">
        {doubled.map((item, i) => (
          <div key={i} className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 whitespace-nowrap">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// GradientBorderCard  animated border for premium content
// ──────────────────────────────────────────────────────────────────────────
export function GradientBorderCard({ children, className = '' }) {
  return (
    <div className={`v2-grad-border p-5 ${className}`}>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MagneticButton  exaggerated lift + glow on hover
// ──────────────────────────────────────────────────────────────────────────
export function MagneticButton({ children, onClick, type = 'button', tone = 'primary' }) {
  const cls = tone === 'primary' ? 'v2-btn-primary v2-magnetic' : 'v2-btn-ghost v2-magnetic';
  return <button type={type} className={cls} onClick={onClick}>{children}</button>;
}

// ──────────────────────────────────────────────────────────────────────────
// Sparkline  tiny inline SVG chart for trend lines on KPIs
// ──────────────────────────────────────────────────────────────────────────
export function Sparkline({ values = [], width = 90, height = 26, color = '#4f46e5' }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1 || 1);
  const points = values.map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 2) - 1}`).join(' ');
  const last = values[values.length - 1];
  const lastX = (values.length - 1) * stepX;
  const lastY = height - ((last - min) / range) * (height - 2) - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#sg-${color.slice(1)})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} className="v2-pulse-ring" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ScrollReveal  IntersectionObserver-driven enter animation.
// Drop around any block to fade it in when it scrolls into view.
// ──────────────────────────────────────────────────────────────────────────
export function ScrollReveal({ children, delay = 0, as: Tag = 'div', className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
    }, { threshold: 0.1 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return <Tag ref={ref} data-reveal style={{ transitionDelay: `${delay}ms` }} className={className}>{children}</Tag>;
}

// ──────────────────────────────────────────────────────────────────────────
// SectionEyebrow  small leading-bar text used above section headers
// ──────────────────────────────────────────────────────────────────────────
export function SectionEyebrow({ children }) {
  return <p className="v2-eyebrow">{children}</p>;
}

// ──────────────────────────────────────────────────────────────────────────
// FloatingField  input with a floating label
// ──────────────────────────────────────────────────────────────────────────
export function FloatingField({ label, value, onChange, type = 'text', name, placeholder = ' ' }) {
  return (
    <div className="v2-field">
      <input className="v2-input" type={type} name={name} placeholder={placeholder} value={value || ''} onChange={onChange} />
      <label>{label}</label>
    </div>
  );
}
