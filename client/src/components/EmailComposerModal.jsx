import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import AppModal from './AppModal';
import { notificationsAPI } from '../services/api';

export default function EmailComposerModal({
  open,
  onClose,
  title,
  subtitle,
  recipients = [],
  draftContext = {},
  onSend,
  sending = false,
}) {
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(draftContext.defaultSubject || '');
    setHtmlBody(draftContext.defaultHtmlBody || '');
    setPrompt(draftContext.defaultPrompt || '');
  }, [draftContext.defaultHtmlBody, draftContext.defaultPrompt, draftContext.defaultSubject, open]);

  const generateDraft = async () => {
    try {
      setGenerating(true);
      const res = await notificationsAPI.draftEmail({
        purpose: draftContext.purpose || 'reminder',
        prompt,
        context: draftContext.context || {},
        recipients,
      });
      setSubject(res.data?.subject || '');
      setHtmlBody(res.data?.html_body || '');
      toast.success('Draft generated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate AI draft');
    } finally {
      setGenerating(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
      <button
        type="button"
        onClick={() => onSend?.({ subject, html_body: htmlBody, prompt })}
        disabled={sending || !subject.trim() || !htmlBody.trim()}
        className="btn-primary disabled:opacity-50"
      >
        {sending ? 'Sending...' : 'Send Email'}
      </button>
    </>
  );

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={footer}
      width="wide"
    >
      <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="space-y-4">
          <div className="metric-tile">
            <p className="workspace-kicker">Recipients</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {recipients.length ? recipients.map((recipient) => (
                <span key={recipient} className="glass-chip">{recipient}</span>
              )) : <span className="subtle-info">Recipients will be resolved from the workflow context.</span>}
            </div>
          </div>

          <div className="metric-tile">
            <label className="block text-sm font-semibold text-gray-900 mb-2">Tell AI what this email should communicate</label>
            <textarea
              rows={8}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="input-field"
              placeholder="Example: Draft a concise but polished reminder asking the candidate to confirm the Round 1 interview slot by EOD, mention the role, recruiter, and that a Teams invite follows once confirmed."
            />
            <button type="button" onClick={generateDraft} disabled={generating} className="btn-secondary mt-4 disabled:opacity-50">
              {generating ? 'Generating...' : 'Draft with AI'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="metric-tile">
            <label className="block text-sm font-semibold text-gray-900 mb-2">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="input-field"
              placeholder="Email subject"
            />
          </div>

          <div className="metric-tile">
            <label className="block text-sm font-semibold text-gray-900 mb-2">HTML body</label>
            <textarea
              rows={18}
              value={htmlBody}
              onChange={(event) => setHtmlBody(event.target.value)}
              className="input-field font-mono text-[13px] leading-6"
              placeholder="<p>Your formatted HTML body will appear here.</p>"
            />
            <p className="mt-2 text-xs text-gray-500">
              Rich formatting is supported. The mailer will wrap this inside the Premier Energies branded email template.
            </p>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
