import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { notificationsAPI } from '../services/api';

function TagInput({ label, values, onChange, placeholder }) {
  const [input, setInput] = useState('');

  const addTag = (raw) => {
    const email = raw.trim().toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email)) return;
    if (!values.includes(email)) onChange([...values, email]);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key)) {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === 'Backspace' && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    pasted.split(/[\s,;]+/).forEach(addTag);
  };

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <div className="flex min-h-[42px] flex-wrap gap-1.5 rounded-2xl border border-gray-300 bg-white px-3 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="ml-0.5 text-indigo-400 hover:text-indigo-700">×</button>
          </span>
        ))}
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => addTag(input)}
          placeholder={values.length ? '' : placeholder}
          className="min-w-[160px] flex-1 border-none bg-transparent p-0 text-sm text-gray-800 outline-none placeholder:text-gray-400"
        />
      </div>
      <p className="mt-1 text-xs text-gray-400">Press Enter, comma, or Tab to add each address</p>
    </div>
  );
}

export default function EmailComposer({
  open,
  onClose,
  defaultTo = [],
  defaultCc = [],
  defaultSubject = '',
  defaultBody = '',
  contextType,
  contextId,
  onSent,
  title = 'Compose Email',
}) {
  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTo(Array.isArray(defaultTo) ? defaultTo : defaultTo ? [defaultTo] : []);
      setCc(Array.isArray(defaultCc) ? defaultCc : defaultCc ? [defaultCc] : []);
      setSubject(defaultSubject || '');
      setBody(defaultBody || '');
    }
  }, [open, defaultTo, defaultCc, defaultSubject, defaultBody]);

  const insertTag = (tag) => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + tag + el.value.slice(end);
    setBody(next);
    setTimeout(() => {
      el.selectionStart = start + tag.length;
      el.selectionEnd = start + tag.length;
      el.focus();
    }, 0);
  };

  const handleSend = async () => {
    if (!to.length) { toast.error('At least one recipient is required'); return; }
    if (!subject.trim()) { toast.error('Subject is required'); return; }
    setSending(true);
    try {
      const htmlBody = body
        .split('\n')
        .map((line) => line.trim() ? `<p style="margin:0 0 10px;color:#334155;line-height:1.75;font-size:14px">${line}</p>` : '<br/>')
        .join('');
      await notificationsAPI.sendEmail({ to, cc, subject: subject.trim(), html_body: htmlBody, context_type: contextType, context_id: contextId });
      toast.success('Email sent');
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="relative flex w-full max-w-2xl flex-col rounded-[28px] border border-white/70 bg-white shadow-[0_32px_80px_-16px_rgba(15,23,42,0.28)]" style={{ maxHeight: '92vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-600">Premier Energies ATS</p>
            <h2 className="mt-0.5 text-lg font-semibold text-gray-900">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          <TagInput label="To *" values={to} onChange={setTo} placeholder="recipient@company.com" />
          <TagInput label="CC" values={cc} onChange={setCc} placeholder="optional@company.com" />

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input-field"
              placeholder="Email subject line"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">Message Body</label>
              <div className="flex gap-1">
                {['[Candidate Name]', '[Job Title]', '[Interview Date]', '[ATS Link]'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="input-field resize-none font-mono text-sm"
              placeholder="Type your email body here. Each paragraph will be wrapped automatically. Use the tag buttons above to insert placeholders."
            />
            <p className="mt-1 text-xs text-gray-400">Plain text  each line becomes a paragraph in the final email. Premier Energies branding header/footer is added automatically.</p>
          </div>

          {/* Preview hint */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Preview note</p>
            <p className="text-xs text-blue-600">The email will be sent from <strong>spot@premierenergies.com</strong> with Premier Energies header, footer, and brand colours applied automatically.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <div className="text-xs text-gray-400">
            {to.length} recipient{to.length !== 1 ? 's' : ''}{cc.length ? ` · ${cc.length} cc` : ''}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary">Discard</button>
            <button type="button" onClick={handleSend} disabled={sending || !to.length} className="btn-primary disabled:opacity-50">
              {sending ? (
                <span className="flex items-center gap-2"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Sending…</span>
              ) : 'Send Email'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
