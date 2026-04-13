import { ConfidentialClientApplication } from '@azure/msal-node';

const GRAPH = {
  tenantId: process.env.GRAPH_TENANT_ID || '1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1',
  clientId: process.env.GRAPH_CLIENT_ID || '3d310826-2173-44e5-b9a2-b21e940b67f7',
  clientSecret: process.env.GRAPH_CLIENT_SECRET || '2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog',
  senderEmail: process.env.GRAPH_SENDER_EMAIL || 'spot@premierenergies.com',
};

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_TIMEZONE = process.env.INTERVIEW_TIMEZONE || 'Asia/Kolkata';
const DEFAULT_DURATION_MINUTES = Number(process.env.INTERVIEW_DURATION_MINUTES || 60);

const cca = new ConfidentialClientApplication({
  auth: {
    clientId: GRAPH.clientId,
    authority: `https://login.microsoftonline.com/${GRAPH.tenantId}`,
    clientSecret: GRAPH.clientSecret,
  },
});

async function getGraphToken() {
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result?.accessToken || null;
}

function normalizeGraphDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    return raw.length === 16 ? `${raw}:00` : raw.slice(0, 19);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const localEquivalent = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60 * 1000);
  return localEquivalent.toISOString().slice(0, 19);
}

function addMinutes(graphDateTime, minutes) {
  const parsed = new Date(graphDateTime);
  if (Number.isNaN(parsed.getTime())) return graphDateTime;
  parsed.setMinutes(parsed.getMinutes() + minutes);
  const localEquivalent = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60 * 1000);
  return localEquivalent.toISOString().slice(0, 19);
}

function toUtcIsoString(graphDateTime) {
  const parsed = new Date(graphDateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizePersonList(value, fallbackType = 'required') {
  if (Array.isArray(value)) return value.map((item) => ({ ...item, type: item.type || fallbackType }));
  if (!value) return [];
  if (typeof value === 'string') {
    return value.split(',').map((email) => ({
      email: email.trim(),
      name: email.trim(),
      type: fallbackType,
    }));
  }
  if (typeof value === 'object') {
    return [{ ...value, type: value.type || fallbackType }];
  }
  return [];
}

function buildAttendees({
  candidateEmail,
  candidateName,
  recruiterEmail,
  recruiterName,
  secondaryRecruiterEmail,
  interviewerEmails = [],
}) {
  return uniqEmailPeople([
    { email: candidateEmail, name: candidateName || 'Candidate', type: 'required' },
    { email: recruiterEmail, name: recruiterName || 'Recruiter', type: 'optional' },
    { email: secondaryRecruiterEmail, name: 'Secondary Recruiter', type: 'optional' },
    ...normalizePersonList(interviewerEmails, 'required'),
  ])
    .map((item) => ({
      emailAddress: {
        address: item.email,
        name: item.name,
      },
      type: item.type,
    }));
}

function uniqEmailPeople(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const email = String(item?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBodyContent({
  candidateName,
  jobTitle,
  roundNumber,
  scheduledDateTime,
  interviewerEmail,
  interviewerEmails = [],
  joinUrl,
}) {
  const interviewerLabel = interviewerEmails.length
    ? interviewerEmails.join(', ')
    : interviewerEmail;
  const details = [
    ['Candidate', candidateName],
    ['Job', jobTitle],
    ['Round', roundNumber ? `Round ${roundNumber}` : null],
    ['Scheduled', scheduledDateTime],
    ['Interview Panel', interviewerLabel],
  ].filter(([, value]) => value);

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a">
      <p style="margin:0 0 12px">Premier Energies ATS scheduled this interview directly from the hiring workflow.</p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 16px">
        <tbody>
          ${details.map(([label, value]) => `
            <tr>
              <td style="padding:6px 10px 6px 0;font-weight:600;color:#475569;vertical-align:top">${escapeHtml(label)}</td>
              <td style="padding:6px 0;color:#0f172a">${escapeHtml(value)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${joinUrl ? `<p style="margin:12px 0 0"><a href="${escapeHtml(joinUrl)}" style="color:#2563eb;font-weight:600">Join Microsoft Teams meeting</a></p>` : ''}
    </div>
  `;
}

function buildEventPayload(context, { includeTeamsProvider }) {
  const payload = {
    subject: context.subject,
    body: {
      contentType: 'HTML',
      content: buildBodyContent(context),
    },
    start: {
      dateTime: context.startDateTime,
      timeZone: context.timeZone,
    },
    end: {
      dateTime: context.endDateTime,
      timeZone: context.timeZone,
    },
    attendees: buildAttendees(context),
    location: {
      displayName: 'Microsoft Teams',
    },
    allowNewTimeProposals: true,
    responseRequested: true,
    showAs: 'busy',
  };

  if (includeTeamsProvider) {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }

  return payload;
}

async function graphRequest(path, options = {}) {
  const token = await getGraphToken();
  if (!token) {
    throw new Error('Unable to acquire Microsoft Graph access token');
  }

  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.error?.message || payload?.message || `Graph request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function extractJoinUrl(payload) {
  return payload?.onlineMeeting?.joinUrl
    || payload?.joinWebUrl
    || payload?.onlineMeetingUrl
    || null;
}

async function createStandaloneOnlineMeeting(context) {
  const startDateTime = toUtcIsoString(context.startDateTime);
  const endDateTime = toUtcIsoString(context.endDateTime);
  if (!startDateTime || !endDateTime) {
    throw new Error('Unable to normalize interview datetime for Teams online meeting creation');
  }

  const payload = await graphRequest(
    `/users/${encodeURIComponent(context.organizerEmail)}/onlineMeetings`,
    {
      method: 'POST',
      body: JSON.stringify({
        startDateTime,
        endDateTime,
        subject: context.subject,
      }),
    }
  );

  return {
    id: payload?.id || null,
    joinUrl: extractJoinUrl(payload),
    provider: 'teams-onlineMeeting',
  };
}

export async function syncInterviewCalendarMeeting(input) {
  const organizerEmail = String(input?.organizerEmail || GRAPH.senderEmail).trim();
  const startDateTime = normalizeGraphDateTime(input?.scheduledDateTime);
  const timeZone = input?.timeZone || DEFAULT_TIMEZONE;
  const durationMinutes = Number(input?.durationMinutes || DEFAULT_DURATION_MINUTES);

  if (!organizerEmail) {
    return {
      status: 'skipped',
      message: 'Calendar sync skipped because no interviewer mailbox was available.',
    };
  }

  if (!startDateTime) {
    return {
      status: 'skipped',
      message: 'Calendar sync skipped because no scheduled datetime was provided.',
    };
  }

  const context = {
    organizerEmail,
    candidateName: input?.candidateName || 'Candidate',
    candidateEmail: input?.candidateEmail || null,
    recruiterEmail: input?.recruiterEmail || null,
    recruiterName: input?.recruiterName || 'Recruiter',
    secondaryRecruiterEmail: input?.secondaryRecruiterEmail || null,
    interviewerEmail: Array.isArray(input?.interviewerEmails) ? input.interviewerEmails[0] || null : organizerEmail,
    interviewerEmails: Array.isArray(input?.interviewerEmails) ? input.interviewerEmails.filter(Boolean) : [],
    jobTitle: input?.jobTitle || 'Premier Energies Interview',
    roundNumber: input?.roundNumber || null,
    scheduledDateTime: startDateTime,
    startDateTime,
    endDateTime: addMinutes(startDateTime, durationMinutes),
    timeZone,
    subject: input?.subject || `Premier Energies Interview | ${input?.candidateName || 'Candidate'} | Round ${input?.roundNumber || 1}`,
    joinUrl: input?.existingJoinUrl || null,
  };

  try {
    let eventPayload;

    if (input?.existingEventId) {
      await graphRequest(
        `/users/${encodeURIComponent(organizerEmail)}/events/${encodeURIComponent(input.existingEventId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(buildEventPayload(context, { includeTeamsProvider: false })),
        }
      );

      eventPayload = await graphRequest(
        `/users/${encodeURIComponent(organizerEmail)}/events/${encodeURIComponent(input.existingEventId)}?$select=id,webLink,isOnlineMeeting,onlineMeeting,onlineMeetingProvider`
      );
    } else {
      eventPayload = await graphRequest(
        `/users/${encodeURIComponent(organizerEmail)}/calendar/events`,
        {
          method: 'POST',
          body: JSON.stringify(buildEventPayload(context, { includeTeamsProvider: true })),
        }
      );
    }

    const joinUrl = extractJoinUrl(eventPayload);
    if (joinUrl) {
      return {
        status: 'synced',
        eventId: eventPayload?.id || input?.existingEventId || null,
        joinUrl,
        webLink: eventPayload?.webLink || null,
        provider: eventPayload?.onlineMeetingProvider || 'teamsForBusiness',
        message: 'Calendar blocked and Microsoft Teams meeting linked successfully.',
      };
    }

    try {
      const fallbackMeeting = await createStandaloneOnlineMeeting(context);
      if (fallbackMeeting?.joinUrl) {
        context.joinUrl = fallbackMeeting.joinUrl;

        if (eventPayload?.id) {
          await graphRequest(
            `/users/${encodeURIComponent(organizerEmail)}/events/${encodeURIComponent(eventPayload.id)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                body: {
                  contentType: 'HTML',
                  content: buildBodyContent(context),
                },
              }),
            }
          );
        }

        return {
          status: 'synced_fallback',
          eventId: eventPayload?.id || input?.existingEventId || null,
          joinUrl: fallbackMeeting.joinUrl,
          webLink: eventPayload?.webLink || null,
          provider: fallbackMeeting.provider,
          message: 'Calendar blocked and Teams link added through the online meeting fallback.',
        };
      }
    } catch (fallbackError) {
      return {
        status: 'partial',
        eventId: eventPayload?.id || input?.existingEventId || null,
        webLink: eventPayload?.webLink || null,
        provider: eventPayload?.onlineMeetingProvider || 'calendar',
        message: 'Calendar event was created, but Teams meeting creation needs additional Microsoft Graph permissions or policy.',
        error: fallbackError.message,
      };
    }

    return {
      status: 'partial',
      eventId: eventPayload?.id || input?.existingEventId || null,
      webLink: eventPayload?.webLink || null,
      provider: eventPayload?.onlineMeetingProvider || 'calendar',
      message: 'Calendar event was created, but Teams join details were not returned by Microsoft Graph.',
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error.message || 'Microsoft Graph calendar sync failed.',
      error: error.message || 'Microsoft Graph calendar sync failed.',
    };
  }
}
