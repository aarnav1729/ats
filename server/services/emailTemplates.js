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
          <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;line-height:1.55">${value == null || value === '' ? '<span style="color:#94a3b8"></span>' : esc(value)}</p>
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
    eyebrow: 'Your Premier Energies Candidate Portal',
    headline: `Welcome, ${candidateName}!`,
    lead: `Congratulations on being shortlisted for the <strong>${jobTitle}</strong> position. We've created your personalized candidate portal where you can track your application status, upload required documents, and stay updated throughout the hiring process.`,
    sections: [
      { type: 'heading', text: 'Your Access Credentials' },
      { type: 'facts', rows: [
        ['Portal URL', portalUrl],
        ['Username', username],
        ['Temporary Password', tempPassword],
      ]},
      {
        type: 'callout',
        tone: 'warning',
        title: 'Important: Set Your Password',
        body: 'On your first login, you will be prompted to create a new password. Please choose a strong password to secure your account.',
      },
      { type: 'heading', text: 'What You Can Do in Your Portal' },
      {
        type: 'steps',
        steps: [
          { title: 'Track Your Application', body: 'See where you are in the hiring process and what\'s coming next.' },
          { title: 'Upload Documents', body: 'Submit any documents we request - resumes, certificates, ID proofs, etc.' },
          { title: 'View CTC Offers', body: 'Review and respond to any compensation offers we share with you.' },
          { title: 'Stay Updated', body: 'Receive notifications at each stage of your application.' },
        ],
      },
    ],
    cta: { label: 'Access Your Portal', url: portalUrl, secondary: 'This link is unique to you - please do not share it with others' },
    footerNote: 'Need assistance? Reply to this email or contact your assigned recruiter. We\'re here to help!',
  });
}

export function documentRequestedEmail({ candidateName, jobTitle, stage, items, portalUrl }) {
  const stageLabel = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return renderBrandedEmail({
    eyebrow: 'Document Requirement',
    headline: `Documents required for your ${jobTitle} application`,
    lead: `Dear ${candidateName}, to proceed with your application at Premier Energies, we need you to upload the following documents. This is required for the <strong>${stageLabel}</strong> stage of our hiring process.`,
    sections: [
      {
        type: 'heading',
        text: 'Required Documents',
      },
      {
        type: 'table',
        headers: ['Document', 'Description'],
        rows: items.map((i) => [i.document_name || i.name, i.description || 'Please upload the latest version']),
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Upload Instructions',
        body: 'Log in to your candidate portal, navigate to the documents section, and upload each file. If a document needs correction, you can re-upload a new version at any time.',
      },
      {
        type: 'facts',
        rows: [
          ['Portal Link', portalUrl],
          ['Help', 'Contact your recruiter if you face any issues'],
        ],
      },
    ],
    cta: { label: 'Upload Documents Now', url: portalUrl, secondary: 'Please upload within 3 days to keep your application on track' },
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
    eyebrow: 'Offer Decision Required',
    headline: `Your CTC Breakup is ready for your review, ${candidateName}`,
    lead: `Thank you for your time and the discussions we've had throughout the interview process. We are pleased to extend the offer for the <strong>${jobTitle}</strong> position at Premier Energies. Please review the compensation details below.`,
    sections: [
      {
        type: 'raw',
        html: `<pre style="margin:0 0 18px;padding:16px 18px;background:#f8fbff;border:1px solid #dbe4ef;border-radius:12px;font-family:Menlo,Consolas,monospace;font-size:12.5px;line-height:1.7;color:#0f172a;white-space:pre-wrap;word-break:break-word">${esc(ctcText || '')}</pre>`,
      },
      {
        type: 'callout',
        tone: 'info',
        title: 'Your Response Options',
        body: '<strong>Accept</strong> - Confirm your acceptance and sign to proceed.<br><strong>Decline</strong> - Let us know if you are not able to accept this offer.<br><strong>Renegotiate</strong> - Share your concerns or expectations and our team will get back to you.',
      },
      {
        type: 'facts',
        rows: [
          ['Response Deadline', 'Please respond within 5 business days'],
          ['Contact', 'Reach out to your recruiting contact for any questions'],
        ],
      },
    ],
    cta: { label: 'Review & Respond', url: portalUrl, secondary: 'Your prompt response helps us plan the joining date accordingly' },
    footerNote: 'We look forward to welcoming you to the Premier Energies team.',
  });
}

export function requisitionOnHoldEmail({ requisitionId, jobTitle, reason, notes, placedBy }) {
  return renderBrandedEmail({
    eyebrow: 'Requisition update',
    headline: `${requisitionId} placed on hold`,
    lead: `<strong>${jobTitle}</strong> is temporarily paused. Sourcing activity should stop until the hold is released. TAT for this window will be excluded from reporting.`,
    sections: [
      { type: 'facts', rows: [['Requisition', requisitionId], ['Placed by', placedBy], ['Reason', reason], ['Notes', notes || '']] },
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
