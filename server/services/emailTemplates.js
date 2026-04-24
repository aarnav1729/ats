/**
 * Marketing-style email composition helpers. Every outbound transactional
 * email in the ATS is built from these primitives so the visual language
 * stays consistent.
 *
 * Palette: deep navy (#0a1d30) → cyan (#0c8da3) → emerald accents.
 * Layout: hero band + structured sections + call-to-action button + footer.
 *
 * Usage:
 *   import { renderBrandedEmail } from './emailTemplates.js';
 *   const html = renderBrandedEmail({
 *     eyebrow: 'Requisition on hold',
 *     headline: 'REQ-2026-042 placed on hold',
 *     lead: 'HR has temporarily paused sourcing activity. TAT will be excluded from metrics.',
 *     sections: [
 *       { type: 'facts', rows: [['Reason', reason], ['Hold placed by', placedBy]] },
 *       { type: 'callout', tone: 'warning', title: 'What this means', body: '...' },
 *     ],
 *     cta: { label: 'View requisition', url: `${APP}/requisitions/${id}` },
 *   });
 */

const NAVY = '#0a1d30';
const ACCENT = '#0c8da3';
const MINT = '#10b981';
const WARN = '#ea7a18';
const DANGER = '#dc2626';

const TONE_COLORS = {
  info: { bg: '#eef4ff', border: '#c7d8ff', text: '#1d4ed8' },
  success: { bg: '#e8fbf1', border: '#a7e9c5', text: '#047857' },
  warning: { bg: '#fff5e6', border: '#f8cf99', text: '#ad4e00' },
  danger: { bg: '#fee7e7', border: '#f5b3b3', text: '#b91c1c' },
  neutral: { bg: '#f1f5f9', border: '#dbe4ef', text: '#334155' },
};

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderFacts(rows) {
  const tds = rows
    .map(
      ([label, value], i) => `
      <tr>
        <td style="padding:12px 18px;border-bottom:${i === rows.length - 1 ? '0' : '1px solid #e2e8f0'};width:38%;background:#f8fbff">
          <p style="margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#64748b">${esc(label)}</p>
        </td>
        <td style="padding:12px 18px;border-bottom:${i === rows.length - 1 ? '0' : '1px solid #e2e8f0'};word-break:break-word">
          <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;line-height:1.55">${value == null || value === '' ? '<span style="color:#94a3b8">—</span>' : esc(value)}</p>
        </td>
      </tr>`
    )
    .join('');
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;margin:0 0 18px;background:#ffffff">
    ${tds}
  </table>`;
}

function renderCallout({ tone = 'info', title, body }) {
  const c = TONE_COLORS[tone] || TONE_COLORS.info;
  return `
  <div style="margin:0 0 18px;border:1px solid ${c.border};border-radius:14px;background:${c.bg};padding:16px 18px">
    ${title ? `<p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${c.text}">${esc(title)}</p>` : ''}
    <p style="margin:0;color:#334155;font-size:13.5px;line-height:1.7">${body || ''}</p>
  </div>`;
}

function renderSteps(steps) {
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px">
    ${steps
      .map(
        (s, i) => `
      <tr>
        <td valign="top" width="34" style="padding:0 12px 14px 0">
          <div style="width:28px;height:28px;line-height:28px;border-radius:999px;background:${NAVY};color:#fff;text-align:center;font-size:12px;font-weight:700">${i + 1}</div>
        </td>
        <td valign="top" style="padding:0 0 14px">
          <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a">${esc(s.title || '')}</p>
          ${s.body ? `<p style="margin:4px 0 0;font-size:13px;color:#475569;line-height:1.65">${s.body}</p>` : ''}
        </td>
      </tr>`
      )
      .join('')}
  </table>`;
}

function renderCTA({ label, url, secondary }) {
  if (!url) return '';
  return `
  <div style="margin:22px 0 6px;text-align:center">
    <a href="${esc(url)}" style="display:inline-block;background:linear-gradient(135deg,${NAVY},${ACCENT});color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:14px;font-weight:700;font-size:14px;letter-spacing:0.01em;box-shadow:0 10px 26px -10px rgba(10,29,48,0.55)">${esc(label || 'Open ATS')}</a>
    ${secondary ? `<p style="margin:10px 0 0;font-size:11.5px;color:#94a3b8">${esc(secondary)}</p>` : ''}
  </div>`;
}

function renderTable({ headers, rows }) {
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:0 0 18px;font-size:12.5px">
    <thead>
      <tr style="background:${NAVY};color:#fff">
        ${headers.map((h) => `<th align="left" style="padding:10px 12px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase">${esc(h)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row, i) => `
        <tr style="background:${i % 2 ? '#f8fbff' : '#ffffff'}">
          ${row.map((cell) => `<td style="padding:10px 12px;border-top:1px solid #e2e8f0;color:#334155;word-break:break-word">${esc(cell)}</td>`).join('')}
        </tr>`
        )
        .join('')}
    </tbody>
  </table>`;
}

export function renderBrandedEmail(opts) {
  const {
    eyebrow = 'Premier Energies',
    headline,
    lead,
    sections = [],
    cta,
    footerNote,
    appUrl = process.env.APP_URL || '',
  } = opts;

  const sectionHtml = sections
    .map((s) => {
      if (s.type === 'facts') return renderFacts(s.rows || []);
      if (s.type === 'callout') return renderCallout(s);
      if (s.type === 'steps') return renderSteps(s.steps || []);
      if (s.type === 'table') return renderTable(s);
      if (s.type === 'paragraph') return `<p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.75">${s.body || ''}</p>`;
      if (s.type === 'heading') return `<p style="margin:22px 0 10px;color:#0f172a;font-size:16px;font-weight:700;letter-spacing:-0.01em">${esc(s.text)}</p>`;
      if (s.type === 'divider') return `<div style="margin:18px 0;height:1px;background:linear-gradient(90deg,transparent,#dbe4ef,transparent)"></div>`;
      if (s.type === 'raw') return s.html || '';
      return '';
    })
    .join('');

  return `
<div>
  <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:${ACCENT}">${esc(eyebrow)}</p>
  <h2 style="margin:0 0 10px;color:${NAVY};font-size:22px;font-weight:800;line-height:1.25;letter-spacing:-0.02em">${esc(headline || '')}</h2>
  ${lead ? `<p style="margin:0 0 20px;color:#475569;font-size:14.5px;line-height:1.7">${lead}</p>` : ''}
  ${sectionHtml}
  ${cta ? renderCTA(cta) : ''}
  ${footerNote ? `<p style="margin:22px 0 0;padding-top:16px;border-top:1px dashed #e2e8f0;color:#94a3b8;font-size:11.5px;line-height:1.7">${footerNote}</p>` : ''}
</div>`.trim();
}

// ─── Pre-built templates ────────────────────────────────────────────────────

export function candidatePortalInviteEmail({ candidateName, jobTitle, portalUrl, username, tempPassword }) {
  return renderBrandedEmail({
    eyebrow: 'You are joining Premier Energies',
    headline: `Welcome aboard, ${candidateName}!`,
    lead: `You've been selected for the <strong>${jobTitle}</strong> role. We've set up your onboarding portal so you can track documents, share information, and complete pre-joining steps in one place.`,
    sections: [
      { type: 'heading', text: 'Your login credentials' },
      { type: 'facts', rows: [['Login URL', portalUrl], ['Username', username], ['Temporary password', tempPassword]] },
      {
        type: 'callout',
        tone: 'warning',
        title: 'First login',
        body: 'For your security, you will be asked to set a new password the first time you sign in.',
      },
      { type: 'heading', text: 'What to do next' },
      {
        type: 'steps',
        steps: [
          { title: 'Sign in to the candidate portal', body: 'Use the credentials above at the login URL.' },
          { title: 'Review your stage checklist', body: 'We\'ll show you every document we need at each stage — pre-offer, offer, joining, and beyond.' },
          { title: 'Upload documents', body: 'Drag-and-drop files directly in the portal. Our recruiters will review and get back to you.' },
          { title: 'Respond to CTC acceptance', body: 'If we share a CTC offer sheet, you can accept, ask questions, or request renegotiation right in the portal.' },
        ],
      },
    ],
    cta: { label: 'Go to your portal', url: portalUrl, secondary: 'Bookmark this link — you will come back often during onboarding.' },
    footerNote: 'Questions? Reply to this email or reach out to your recruiter. Welcome to the Premier Energies family.',
  });
}

export function documentRequestedEmail({ candidateName, jobTitle, stage, items, portalUrl }) {
  return renderBrandedEmail({
    eyebrow: 'Document request',
    headline: `Action needed: ${items.length} document${items.length === 1 ? '' : 's'}`,
    lead: `Hi ${candidateName}, we need a few documents from you to progress the <strong>${jobTitle}</strong> application through the <em>${stage.replace(/_/g, ' ')}</em> stage.`,
    sections: [
      {
        type: 'table',
        headers: ['Document', 'Notes'],
        rows: items.map((i) => [i.document_name || i.name, i.description || '—']),
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Reupload anytime',
        body: 'If a reviewer asks for a correction, you can upload a fresh version — we keep version history automatically.',
      },
    ],
    cta: { label: 'Upload documents', url: portalUrl },
  });
}

export function documentReviewedEmail({ candidateName, documentName, decision, reviewerNotes, portalUrl }) {
  const ok = decision === 'accepted';
  return renderBrandedEmail({
    eyebrow: ok ? 'Document approved' : 'Needs changes',
    headline: ok ? `${documentName} accepted` : `${documentName} needs changes`,
    lead: ok
      ? `Hi ${candidateName}, your <strong>${documentName}</strong> has been accepted. No further action needed on this item.`
      : `Hi ${candidateName}, we need a few tweaks before we can accept <strong>${documentName}</strong>.`,
    sections: reviewerNotes
      ? [{ type: 'callout', tone: ok ? 'success' : 'warning', title: ok ? 'Reviewer note' : 'What to change', body: esc(reviewerNotes) }]
      : [],
    cta: { label: ok ? 'Open portal' : 'Upload a corrected version', url: portalUrl },
  });
}

export function ctcAcceptanceEmail({ candidateName, jobTitle, ctcText, portalUrl }) {
  return renderBrandedEmail({
    eyebrow: 'CTC offer sheet',
    headline: `Your CTC offer is ready, ${candidateName}`,
    lead: `We've prepared the detailed compensation summary for the <strong>${jobTitle}</strong> role. Please review and confirm at your convenience.`,
    sections: [
      {
        type: 'raw',
        html: `<pre style="margin:0 0 18px;padding:16px 18px;background:#f8fbff;border:1px solid #dbe4ef;border-radius:12px;font-family:Menlo,Consolas,monospace;font-size:12.5px;line-height:1.7;color:#0f172a;white-space:pre-wrap;word-break:break-word">${esc(ctcText || '')}</pre>`,
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Three options',
        body: '<strong>Accept</strong> to confirm the offer, <strong>Decline</strong> if you cannot proceed, or <strong>Renegotiate</strong> with a short note and our recruiter will come back to you.',
      },
    ],
    cta: { label: 'Respond to offer', url: portalUrl },
  });
}

export function requisitionOnHoldEmail({ requisitionId, jobTitle, reason, notes, placedBy }) {
  return renderBrandedEmail({
    eyebrow: 'Requisition update',
    headline: `${requisitionId} placed on hold`,
    lead: `<strong>${jobTitle}</strong> is temporarily paused. Sourcing activity should stop until the hold is released. TAT for this window will be excluded from reporting.`,
    sections: [
      { type: 'facts', rows: [['Requisition', requisitionId], ['Placed by', placedBy], ['Reason', reason], ['Notes', notes || '—']] },
      { type: 'callout', tone: 'warning', title: 'Heads up', body: 'The hold window is still tracked separately in MIS so leadership can see the real cost of pauses.' },
    ],
    cta: { label: 'Open requisition', url: `${process.env.APP_URL || ''}/requisitions` },
  });
}

export function requisitionReleasedEmail({ requisitionId, jobTitle, elapsedDays, releasedBy }) {
  return renderBrandedEmail({
    eyebrow: 'Requisition update',
    headline: `${requisitionId} is live again`,
    lead: `<strong>${jobTitle}</strong> has been released from hold. Sourcing activity can resume.`,
    sections: [
      { type: 'facts', rows: [['Hold duration', `${elapsedDays} days`], ['Released by', releasedBy]] },
    ],
    cta: { label: 'Open requisition', url: `${process.env.APP_URL || ''}/requisitions` },
  });
}

export default {
  renderBrandedEmail,
  candidatePortalInviteEmail,
  documentRequestedEmail,
  documentReviewedEmail,
  ctcAcceptanceEmail,
  requisitionOnHoldEmail,
  requisitionReleasedEmail,
};
