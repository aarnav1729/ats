// Branded email shell - Goldman-style: single column, restrained palette,
// generous whitespace, exactly one primary CTA per email, IST timestamps.
//
// All outbound mail flows through `renderBrandedEmail()` so the look stays
// consistent and any future rebrand happens in one place.

// Read the logo at module-load time so we can attach it inline (CID). Most
// corporate mail clients (incl. Outlook on Win/Mac) block external image URLs
// by default. Falls back to a text-only header if the file is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readLogo() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'l.png'),
    path.resolve(__dirname, '..', '..', 'pel.png'),
    path.resolve(__dirname, '..', '..', 'logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return { contentBytes: fs.readFileSync(p).toString('base64'), name: path.basename(p) };
      }
    } catch { /* keep looking */ }
  }
  return null;
}

const LOGO_FILE = readLogo();
export const LOGO_CID = LOGO_FILE ? 'pel-logo' : null;
export function getLogoAttachment() {
  if (!LOGO_FILE) return null;
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: LOGO_FILE.name,
    contentType: 'image/png',
    contentBytes: LOGO_FILE.contentBytes,
    contentId: LOGO_CID,
    isInline: true,
  };
}

const BRAND = {
  name: 'Premier Energies',
  product: 'Talent Operations',
  primary: '#0b1d36',     // deep navy - header band
  accent: '#0c8da3',      // teal - links + secondary highlight
  ink: '#1f2937',         // body text
  mute: '#6b7280',        // secondary text
  divider: '#e5e7eb',
  bg: '#f8fafc',
  white: '#ffffff',
  // CID reference  Graph swaps this for the inline attachment named above.
  logoCid: LOGO_CID,
  // Public-URL fallback so the same shell works for any future SMTP transport.
  logoUrl: process.env.BRAND_LOGO_URL || `${process.env.APP_URL || ''}/l.png`,
  wordmarkUrl: process.env.BRAND_WORDMARK_URL || `${process.env.APP_URL || ''}/l.png`,
};

// IST formatter - used everywhere we render a timestamp.
const IST_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export function formatIST(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${IST_FMT.format(d)} IST`;
}

// Escape any user-supplied string before it lands in the HTML.
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// One CTA per email. Pass `null`/`undefined` to omit.
function ctaButton({ label, href }) {
  if (!label || !href) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0">
      <tr><td style="border-radius:8px;background:${BRAND.primary}">
        <a href="${esc(href)}" style="display:inline-block;padding:12px 28px;font-family:-apple-system,'Segoe UI',Roboto,Inter,Arial,sans-serif;font-size:14px;font-weight:600;color:${BRAND.white};text-decoration:none;letter-spacing:0.01em">${esc(label)}</a>
      </td></tr>
    </table>`;
}

/**
 * Render a branded HTML email.
 *
 * @param {object} opts
 * @param {string} opts.preheader  Hidden preview text shown by mail clients
 * @param {string} opts.title      Bold opening headline
 * @param {string} opts.bodyHtml   Pre-rendered body HTML - caller is trusted
 * @param {object} [opts.cta]      { label, href }
 * @param {string} [opts.context]  Footer context line (e.g., "Application APP-1234 · Premier Energies")
 */
export function renderBrandedEmail({ preheader = '', title, bodyHtml, cta, context }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,'Segoe UI',Roboto,Inter,Arial,sans-serif;color:${BRAND.ink};-webkit-font-smoothing:antialiased">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background:${BRAND.white};border:1px solid ${BRAND.divider};border-radius:6px">

        <!-- Header band: thin navy strip with logo + wordmark -->
        <tr><td style="padding:28px 36px 22px;border-bottom:1px solid ${BRAND.divider}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" width="48">
                ${BRAND.logoCid
                  ? `<img src="cid:${BRAND.logoCid}" alt="${esc(BRAND.name)}" width="40" height="40" style="display:block;border:0;border-radius:8px;vertical-align:middle">`
                  : BRAND.logoUrl
                    ? `<img src="${BRAND.logoUrl}" alt="${esc(BRAND.name)}" width="40" height="40" style="display:block;border:0;border-radius:8px;vertical-align:middle">`
                    : `<div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,${BRAND.primary},${BRAND.accent});display:inline-block;text-align:center;line-height:40px;color:#fff;font-weight:800;font-size:18px;letter-spacing:-0.02em">P</div>`}
              </td>
              <td valign="middle" style="padding-left:14px">
                <p style="margin:0;font-size:13px;font-weight:600;color:${BRAND.primary};letter-spacing:0.01em">${esc(BRAND.name)}</p>
                <p style="margin:2px 0 0;font-size:11px;color:${BRAND.mute};letter-spacing:0.04em;text-transform:uppercase">${esc(BRAND.product)}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Title + body -->
        <tr><td style="padding:36px 36px 24px">
          <h1 style="margin:0 0 18px;font-size:22px;line-height:1.35;font-weight:600;color:${BRAND.ink};letter-spacing:-0.005em">${esc(title)}</h1>
          <div style="font-size:15px;line-height:1.65;color:${BRAND.ink}">${bodyHtml}</div>
          ${ctaButton(cta || {})}
        </td></tr>

        <!-- Footer: IST timestamp + product line. Deliberately quiet. -->
        <tr><td style="padding:24px 36px 28px;border-top:1px solid ${BRAND.divider};background:${BRAND.bg}">
          <p style="margin:0;font-size:12px;color:${BRAND.mute};line-height:1.6">
            ${context ? `${esc(context)} | ` : ''}Sent ${formatIST()}
          </p>
          <p style="margin:8px 0 0;font-size:11px;color:${BRAND.mute};line-height:1.6">
            This is an automated message from the ${esc(BRAND.name)} ${esc(BRAND.product)} platform. For help, reply to this email and our recruiting team will respond within one business day.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Convenience builders for repeated body shapes.
export function paragraph(text) {
  return `<p style="margin:0 0 14px">${esc(text)}</p>`;
}

export function rawHtml(html) {
  return html; // caller already escaped
}

export function detailRow(label, value) {
  return `<tr>
    <td style="padding:10px 16px 10px 0;font-size:13px;color:${BRAND.mute};vertical-align:top;width:140px">${esc(label)}</td>
    <td style="padding:10px 0;font-size:14px;color:${BRAND.ink};vertical-align:top;font-weight:500">${esc(value || '')}</td>
  </tr>`;
}

export function detailTable(rows) {
  const tbody = rows.map(([l, v]) => detailRow(l, v)).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BRAND.divider};border-bottom:1px solid ${BRAND.divider};margin:8px 0 4px">${tbody}</table>`;
}

export function quoteBlock(text) {
  return `<div style="margin:18px 0;padding:14px 18px;border-left:3px solid ${BRAND.accent};background:${BRAND.bg};border-radius:0 4px 4px 0">
    <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND.ink};font-style:italic">${esc(text)}</p>
  </div>`;
}

export const brand = BRAND;
