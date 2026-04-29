// Candidate-facing chat panel. Polls every 8 seconds. Recruiter side uses
// the same component pattern but talks to /chat/:id/{thread,send}.

import { useEffect, useRef, useState } from 'react';
import { chatAPI } from '../services/api';
import { fmtIST } from './ui/v2';
import toast from 'react-hot-toast';

export default function CandidateChatPanel({ side = 'candidate', applicationId, sender }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef(null);

  const load = async () => {
    try {
      const r = side === 'candidate'
        ? await chatAPI.myThread()
        : await chatAPI.thread(applicationId);
      setMessages(r.data.messages || []);
    } catch { /* silent on poll */ }
  };

  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); /* eslint-disable-next-line */ }, [applicationId, side]);
  useEffect(() => { scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' }); }, [messages.length]);

  const send = async (e) => {
    e?.preventDefault();
    if (!body.trim() && !file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('body', body);
      if (file) fd.append('file', file);
      if (side === 'candidate') await chatAPI.mySend(fd);
      else await chatAPI.send(applicationId, fd);
      setBody(''); setFile(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Send failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col" style={{ height: 460 }}>
      <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">Conversation with {side === 'candidate' ? 'recruiting team' : 'candidate'}</p>
        <p className="text-xs text-slate-500">Replies usually within one business day.</p>
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
        {messages.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-12">No messages yet. Say hi.</p>
        ) : messages.map((m) => {
          const mine = side === 'candidate'
            ? m.sender_role === 'applicant'
            : m.sender_role !== 'applicant';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm v2-fade-up ${mine ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'}`}>
                {!mine && <p className="text-[10px] font-bold uppercase tracking-[0.1em] opacity-70 mb-0.5">{m.sender_email}</p>}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                {m.attachment_path && (
                  <a href={m.attachment_path} target="_blank" rel="noreferrer" className={`mt-1 inline-block text-[11px] font-semibold underline ${mine ? 'text-indigo-100' : 'text-indigo-600'}`}>
                    📎 {m.attachment_name || 'attachment'}
                  </a>
                )}
                <p className={`mt-1 text-[10px] ${mine ? 'text-indigo-200' : 'text-slate-400'}`}>{fmtIST(m.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="border-t border-slate-100 p-3 flex items-center gap-2">
        <input
          className="input-field flex-1"
          placeholder="Write a message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy}
        />
        <label className="text-xs text-slate-500 cursor-pointer hover:text-slate-800">
          📎{file && <span className="ml-1 font-semibold text-indigo-600">1</span>}
          <input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <button type="submit" className="v2-btn-primary" disabled={busy} style={{ padding: '8px 16px' }}>{busy ? '…' : 'Send'}</button>
      </form>
    </div>
  );
}
