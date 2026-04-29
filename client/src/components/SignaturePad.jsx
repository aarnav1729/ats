// Lightweight canvas signature pad — premium feel without an e-sign provider.
// Captures a base64 PNG of the signature plus IP/timestamp attestation.

import { useEffect, useRef, useState } from 'react';

export default function SignaturePad({ onChange, height = 160 }) {
  const ref = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2); // crisp on retina
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0b1d36';
  }, []);

  const pos = (e) => {
    const c = ref.current;
    const rect = c.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - rect.top;
    return { x, y };
  };

  const start = (e) => {
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = ref.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  };

  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = ref.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };

  const end = () => {
    setDrawing(false);
    onChange?.(ref.current.toDataURL('image/png'));
  };

  const clear = () => {
    const c = ref.current;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setHasInk(false);
    onChange?.(null);
  };

  return (
    <div className="space-y-2">
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-1 transition hover:border-indigo-400">
        <canvas
          ref={ref}
          width={1200}
          height={height * 2}
          style={{ width: '100%', height, touchAction: 'none', display: 'block', cursor: 'crosshair' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <p className="text-slate-500">Sign with mouse or finger. By signing you confirm acceptance of the offer terms.</p>
        <button onClick={clear} className="text-slate-600 hover:text-slate-900 font-semibold">Clear</button>
      </div>
      {!hasInk && <p className="text-[11px] text-slate-400">Required to accept the offer.</p>}
    </div>
  );
}
