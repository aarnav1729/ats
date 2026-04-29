import { ConfidentialClientApplication } from '@azure/msal-node';
import pool from '../db.js';
import { renderBrandedEmail, paragraph, detailTable, quoteBlock, formatIST, esc } from './emailBrand.js';

// Re-export brand helpers so any caller can import them via the email facade.
export { renderBrandedEmail, paragraph, detailTable, quoteBlock, formatIST, esc };

const GRAPH = {
  tenantId: process.env.GRAPH_TENANT_ID || '1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1',
  clientId: process.env.GRAPH_CLIENT_ID || '3d310826-2173-44e5-b9a2-b21e940b67f7',
  clientSecret: process.env.GRAPH_CLIENT_SECRET || '2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog',
  senderEmail: process.env.GRAPH_SENDER_EMAIL || 'spot@premierenergies.com',
};

const msalConfig = {
  auth: {
    clientId: GRAPH.clientId,
    authority: `https://login.microsoftonline.com/${GRAPH.tenantId}`,
    clientSecret: GRAPH.clientSecret,
  },
};

const cca = new ConfidentialClientApplication(msalConfig);

async function getToken() {
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

function normalizeLink(link) {
  const value = String(link || '').trim();
  if (!value) return null;
  if (value === '/dashboard') return '/';
  return value;
}

// Convert HTML to readable plain text for in-app notifications. The bell-tray
// shows the message as a single-line summary, so we collapse whitespace,
// strip tags, decode the common entities, and trim to a sensible length.
function htmlToPlain(input) {
  if (!input) return null;
  let s = String(input);
  // Convert common block tags into newlines, then strip everything else.
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  // Decode the entities we actually emit (esc() in emailBrand.js).
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&[a-z]+;/gi, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  return s.length > 600 ? s.slice(0, 597) + '…' : s;
}

async function createInAppNotification({ to, title, message = null, link = null }) {
  const email = String(to || '').trim().toLowerCase();
  if (!email || !title) return false;
  try {
    await pool.query(
      `INSERT INTO notifications (user_email, title, message, link)
       VALUES ($1, $2, $3, $4)`,
      [email, htmlToPlain(title), htmlToPlain(message), normalizeLink(link)]
    );
    return true;
  } catch (err) {
    console.error('Create notification error:', err.message);
    return false;
  }
}

export async function sendEmail(to, subject, htmlBody, { cc = [], attachments } = {}) {
  try {
    const { getLogoAttachment } = await import('./emailBrand.js');
    const token = await getToken();
    const toList = Array.isArray(to) ? to : [to];
    const ccList = Array.isArray(cc) ? cc : cc ? [cc] : [];
    const message = {
      subject,
      body: { contentType: 'HTML', content: wrapInTemplate(subject, htmlBody) },
      toRecipients: toList.filter(Boolean).map((a) => ({ emailAddress: { address: a } })),
    };
    if (ccList.length) {
      message.ccRecipients = ccList.filter(Boolean).map((a) => ({ emailAddress: { address: a } }));
    }
    // Always attach the inline logo so cid:pel-logo resolves. Append any
    // caller-supplied attachments (e.g. resumes for blacklist alert).
    const att = [];
    const logo = getLogoAttachment();
    if (logo) att.push(logo);
    if (Array.isArray(attachments)) att.push(...attachments);
    if (att.length) message.attachments = att;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${GRAPH.senderEmail}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Graph API error:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    return false;
  }
}

export async function sendCustomEmail({ to, cc = [], subject, htmlBody, sentBy, contextType, contextId }, dbPool) {
  const toList = Array.isArray(to) ? to : [to];
  const ccList = Array.isArray(cc) ? cc : cc ? [cc] : [];
  const result = await sendEmail(toList, subject, htmlBody, { cc: ccList });
  if (dbPool && sentBy) {
    try {
      await dbPool.query(
        `INSERT INTO email_log (sent_by, to_addresses, cc_addresses, subject, body_html, context_type, context_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sentBy, JSON.stringify(toList), JSON.stringify(ccList), subject, htmlBody, contextType || null, contextId || null]
      );
    } catch (err) {
      console.error('Email log error:', err.message);
    }
  }
  return result;
}

// Legacy wrapper retained for callers that already pass full HTML bodies.
// New callers should use renderBrandedEmail() directly with a CTA spec.
function wrapInTemplate(title, body) {
  return renderBrandedEmail({ title, bodyHtml: body });
}

export async function sendOTPEmail(to, otp) {
  const html = `
    <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-size:14px">Your one-time password for the ATS portal:</p>
    <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;border:1px solid #c7d2fe">
      <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#4338ca">${otp}</span>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin:0">Expires in 5 minutes. Do not share this code.</p>
  `;
  return sendEmail(to, 'Your OTP for Premier Energies ATS', html);
}

export async function sendNotificationEmail(toOrPayload, titleArg, messageArg, actionUrlArg) {
  const payload = typeof toOrPayload === 'object' && toOrPayload !== null
    ? {
        to: toOrPayload.to,
        title: toOrPayload.title || toOrPayload.subject,
        message: toOrPayload.message || toOrPayload.body,
        htmlBody: toOrPayload.htmlBody || toOrPayload.html_body || null,
        actionUrl: toOrPayload.actionUrl || toOrPayload.link,
      }
    : {
        to: toOrPayload,
        title: titleArg,
        message: messageArg,
        htmlBody: null,
        actionUrl: actionUrlArg,
      };

  const actionUrl = normalizeLink(payload.actionUrl);
  const html = payload.htmlBody || `
    <div style="margin:0 0 18px;border:1px solid #dbeafe;border-radius:18px;background:linear-gradient(135deg,#eef4ff,#f8fbff);padding:18px 20px;">
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#1d4ed8">Action summary</p>
      <p style="margin:10px 0 0;color:#334155;line-height:1.75;font-size:14px">${payload.message}</p>
    </div>
    ${actionUrl ? `<div style="margin:18px 0 0"><a href="${actionUrl}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#0891b2);color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700;font-size:13px;letter-spacing:0.01em">Open in ATS</a></div>` : ''}
  `;
  await createInAppNotification({
    to: payload.to,
    title: payload.title,
    message: payload.message || null,
    link: actionUrl,
  });
  return sendEmail(payload.to, payload.title, html);
}

export async function sendStatusUpdateEmail(toOrPayload, candidateNameArg, newStatusArg, jobTitleArg) {
  const payload = typeof toOrPayload === 'object' && toOrPayload !== null
    ? {
        to: toOrPayload.to,
        candidateName: toOrPayload.candidateName,
        newStatus: toOrPayload.newStatus,
        jobTitle: toOrPayload.jobTitle || toOrPayload.applicationId || 'Talent Pool',
      }
    : {
        to: toOrPayload,
        candidateName: candidateNameArg,
        newStatus: newStatusArg,
        jobTitle: jobTitleArg,
      };

  const html = `
    <p style="color:#475569;line-height:1.6;margin:0 0 16px;font-size:14px">The application status for <strong style="color:#1e293b">${payload.candidateName}</strong> has been updated.</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin:0 0 16px">
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;width:120px"><p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">Candidate</p></td>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0"><p style="margin:0;font-size:14px;font-weight:600;color:#1e293b">${payload.candidateName}</p></td>
      </tr>
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0"><p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">Job</p></td>
        <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0"><p style="margin:0;font-size:14px;font-weight:600;color:#1e293b">${payload.jobTitle || 'Talent Pool'}</p></td>
      </tr>
      <tr>
        <td style="padding:14px 20px"><p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8">New Status</p></td>
        <td style="padding:14px 20px"><p style="margin:0"><span style="display:inline-block;background:linear-gradient(135deg,#eef2ff,#e0e7ff);color:#4338ca;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:700">${payload.newStatus}</span></p></td>
      </tr>
    </table>
  `;
  await createInAppNotification({
    to: payload.to,
    title: `Application Update: ${payload.candidateName}`,
    message: `${payload.candidateName} moved to ${payload.newStatus}.`,
    link: '/talent-pool',
  });
  return sendEmail(payload.to, `Application Update: ${payload.candidateName}`, html);
}

export { createInAppNotification };
