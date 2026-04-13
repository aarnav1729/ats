import { ConfidentialClientApplication } from '@azure/msal-node';
import pool from '../db.js';

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

async function createInAppNotification({ to, title, message = null, link = null }) {
  const email = String(to || '').trim().toLowerCase();
  if (!email || !title) return false;
  try {
    await pool.query(
      `INSERT INTO notifications (user_email, title, message, link)
       VALUES ($1, $2, $3, $4)`,
      [email, title, message || null, normalizeLink(link)]
    );
    return true;
  } catch (err) {
    console.error('Create notification error:', err.message);
    return false;
  }
}

export async function sendEmail(to, subject, htmlBody) {
  try {
    const token = await getToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${GRAPH.senderEmail}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: wrapInTemplate(subject, htmlBody) },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
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

function wrapInTemplate(title, body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#eef3f8;font-family:'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:700px;margin:0 auto;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 18px 54px rgba(15,23,42,0.12);border:1px solid #dbe4ef">
  <div style="background:linear-gradient(135deg,#0b1d36 0%,#123c74 52%,#0c8da3 100%);padding:28px 28px 24px;position:relative">
    <div style="position:absolute;right:-26px;top:-14px;width:160px;height:160px;border-radius:999px;background:rgba(255,255,255,0.06)"></div>
    <div style="position:absolute;left:-40px;bottom:-55px;width:180px;height:180px;border-radius:999px;background:rgba(255,255,255,0.05)"></div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td><p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.6)">Premier Energies</p>
      <h1 style="color:#fff;margin:0;font-size:24px;line-height:1.2;font-weight:700">${title}</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.76);font-size:13px;line-height:1.6">Hiring operations updates for Premier Energies solar cell and module manufacturing teams.</p></td>
      <td width="84" valign="top" align="right">
        <div style="display:inline-block;min-width:64px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.14);text-align:center">
          <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#dbeafe">ATS</p>
          <p style="margin:6px 0 0;font-size:12px;font-weight:700;color:#ffffff">SPOT</p>
        </div>
      </td>
    </tr></table>
  </div>
  <div style="padding:24px 28px 22px">
    ${body}
  </div>
  <div style="background:#f8fbff;padding:16px 28px;border-top:1px solid #e2e8f0">
    <p style="margin:0;font-size:11px;color:#64748b;line-height:1.7">Automated notification from Premier Energies ATS.</p>
    <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;line-height:1.7">Open ATS: <a href="${process.env.APP_URL || ''}" style="color:#1d4ed8;text-decoration:none;font-weight:600">${process.env.APP_URL || 'ATS workspace link not configured'}</a></p>
    <p style="margin:6px 0 0;font-size:11px;color:#cbd5e1">&copy; ${new Date().getFullYear()} Premier Energies Ltd.</p>
  </div>
</div>
</body>
</html>`;
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
