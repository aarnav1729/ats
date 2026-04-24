import { useState } from 'react';
import haptic from '../utils/haptic';

export default function InfoTip({ text }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => {
          haptic.light();
          setOpen((value) => !value);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(29,33,41,0.08)] bg-white/90 text-[11px] font-semibold text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_12px_22px_-18px_rgba(18,19,24,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(82,103,255,0.22)] hover:text-[var(--brand-primary)] hover:shadow-[0_18px_30px_-20px_rgba(82,103,255,0.28)]"
        aria-label="More information"
      >
        ?
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-30 mt-3 w-72 -translate-x-1/2 rounded-[22px] border border-white/10 bg-[rgba(20,22,30,0.95)] px-4 py-3 text-xs font-medium leading-6 text-white shadow-[0_28px_60px_-28px_rgba(8,10,16,0.6)] backdrop-blur-xl">
          {text}
        </span>
      )}
    </span>
  );
}
