import { useState } from 'react';

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
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#d6def7] bg-[linear-gradient(135deg,#ffffff_0%,#f4f7ff_100%)] text-[11px] font-semibold text-indigo-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
        aria-label="More information"
      >
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-30 mt-2 w-72 -translate-x-1/2 rounded-2xl border border-slate-700 bg-slate-950/95 px-4 py-3 text-xs font-medium leading-6 text-white shadow-[0_20px_50px_rgba(15,23,42,0.35)] backdrop-blur">
          {text}
        </span>
      )}
    </span>
  );
}
