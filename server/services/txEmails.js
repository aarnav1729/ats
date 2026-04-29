// Transactional email library - every status/flow gets a named function so
// callers never hand-roll HTML and copy stays consistent. Tone modeled on the
// Goldman recruiting style: brief, considered, no exclamation points.

import { renderBrandedEmail, paragraph, detailTable, quoteBlock, formatIST } from './emailBrand.js';

const APP = () => process.env.APP_URL || '';

// ─────────────────────────────────────────────────────────────────────────────
// Candidate-facing
// ─────────────────────────────────────────────────────────────────────────────

export function applicationReceivedEmail({ candidateName, jobTitle, applicationId }) {
  return renderBrandedEmail({
    preheader: `Your application for ${jobTitle} has been received.`,
    title: `We've received your application`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`Thank you for your interest in joining Premier Energies. We have received your application for the ${jobTitle} position and our recruiting team has begun the initial review.`),
      paragraph(`You will hear from us once a hiring decision has been made for the next stage. In the meantime, you can track your application status anytime through the candidate portal.`),
      paragraph(`We appreciate the time you have invested in applying with us.`),
    ].join(''),
    cta: { label: 'Track your application', href: `${APP()}/candidate` },
    context: `Application ${applicationId}`,
  });
}

// Goldman-style "we'll keep your profile" rejection (used by HR reject and HOD reject).
export function politeDeclineEmail({ candidateName, jobTitle, reason }) {
  return renderBrandedEmail({
    preheader: `Update on your Premier Energies application.`,
    title: `An update on your application`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`Thank you for taking the time to apply for the ${jobTitle} position at Premier Energies and for the opportunity to consider your candidacy.`),
      paragraph(`After careful review, we have decided not to move forward with your application for this particular role. The decision was difficult and reflects only the specific requirements of this opening - not your accomplishments or potential.`),
      paragraph(`We would like to keep your profile on file. As new opportunities open across our solar manufacturing, engineering, and corporate functions, our team will reach out directly if your background aligns. You are also welcome to apply to any future role on our careers page.`),
      paragraph(`We wish you continued success in your career and thank you again for considering Premier Energies.`),
    ].join(''),
    context: jobTitle ? `Position: ${jobTitle}` : undefined,
  });
}

export function interviewScheduledEmail({ candidateName, jobTitle, roundLabel, scheduledAt, interviewerNames, joinNote }) {
  return renderBrandedEmail({
    preheader: `${roundLabel} scheduled for ${formatIST(scheduledAt)}.`,
    title: `Your ${roundLabel} is scheduled`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`We are pleased to confirm your ${roundLabel} for the ${jobTitle} position.`),
      detailTable([
        ['When', formatIST(scheduledAt)],
        ['Round', roundLabel],
        ['Interviewers', (interviewerNames || []).join(', ') || 'To be confirmed'],
        joinNote ? ['Joining instructions', joinNote] : null,
      ].filter(Boolean)),
      paragraph(`If anything urgent comes up that prevents you from attending, please reply to this email so we can find a workable time.`),
    ].join(''),
    cta: { label: 'View interview details', href: `${APP()}/candidate` },
    context: `Application · ${jobTitle}`,
  });
}

export function interviewReminderEmail({ candidateName, jobTitle, roundLabel, scheduledAt, leadLabel }) {
  return renderBrandedEmail({
    preheader: `${leadLabel} reminder · ${roundLabel} for ${jobTitle}`,
    title: `Reminder: ${roundLabel} ${leadLabel}`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`This is a friendly reminder of your ${roundLabel} for the ${jobTitle} position scheduled at ${formatIST(scheduledAt)}.`),
      paragraph(`Please join a few minutes before the start time. If you experience any last-minute issue, reply to this thread and we will help.`),
    ].join(''),
    cta: { label: 'Open candidate portal', href: `${APP()}/candidate` },
  });
}

export function noShowGraceEmail({ candidateName, jobTitle }) {
  return renderBrandedEmail({
    preheader: `We missed you - let us know within 24 hours if you'd like to reschedule.`,
    title: `We missed you at the interview`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`We understand that emergencies happen. Your scheduled interview for the ${jobTitle} position has been marked as a no-show.`),
      paragraph(`If you would like to reschedule, please reply to this email within the next 24 hours and our team will work with you to find a new time. After that window, the application will be closed.`),
      paragraph(`We hope everything is alright and look forward to hearing from you.`),
    ].join(''),
    context: `Application · ${jobTitle}`,
  });
}

export function ctcAcceptanceEmailV2({ candidateName, jobTitle, validityDays }) {
  return renderBrandedEmail({
    preheader: `Your compensation summary is ready for review.`,
    title: `Your compensation summary is ready`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`We are pleased to share the proposed compensation structure for your offer for the ${jobTitle} position. Please review the breakdown carefully in the candidate portal.`),
      paragraph(`This summary is valid for ${validityDays || 14} days from the date of this email. We are happy to discuss any aspect of the structure with you before you confirm.`),
      paragraph(`Once you accept, we will move forward with the formal offer letter.`),
    ].join(''),
    cta: { label: 'Review compensation', href: `${APP()}/candidate` },
    context: `Application · ${jobTitle}`,
  });
}

export function offerLetterReadyEmail({ candidateName, jobTitle }) {
  return renderBrandedEmail({
    preheader: `Your offer letter is ready for digital signature.`,
    title: `Your offer letter is ready`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`We are delighted to extend a formal offer for the ${jobTitle} position at Premier Energies. The letter is now available for your review and digital signature in the candidate portal.`),
      paragraph(`Please take your time to read it through carefully. Once you sign and submit, your recruiter will be in touch to coordinate the joining formalities.`),
    ].join(''),
    cta: { label: 'View and sign offer', href: `${APP()}/candidate` },
    context: `Application · ${jobTitle}`,
  });
}

export function offerExpiringEmail({ candidateName, jobTitle, daysLeft }) {
  return renderBrandedEmail({
    preheader: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to respond to your offer.`,
    title: `Reminder: please respond to your offer`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`A quick reminder that your offer letter for the ${jobTitle} position is awaiting your decision. There ${daysLeft === 1 ? 'is 1 day' : `are ${daysLeft} days`} remaining in the response window.`),
      paragraph(`If you have any questions before you sign, please reply to this email and we will respond promptly.`),
    ].join(''),
    cta: { label: 'Open offer letter', href: `${APP()}/candidate` },
  });
}

export function joiningReminderEmail({ candidateName, jobTitle, joiningDate }) {
  return renderBrandedEmail({
    preheader: `Welcome to Premier Energies - joining details inside.`,
    title: `Looking forward to your joining`,
    bodyHtml: [
      paragraph(`Dear ${candidateName},`),
      paragraph(`We are looking forward to welcoming you to Premier Energies on ${formatIST(joiningDate)} for the ${jobTitle} role.`),
      paragraph(`If anything has changed regarding your availability, please reach out to your recruiter as early as possible so we can plan accordingly.`),
    ].join(''),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal (recruiter / admin / approver / interviewer) facing
// ─────────────────────────────────────────────────────────────────────────────

export function blacklistAdminAlertEmail({ candidate, recruiter, reason, resumeUrl }) {
  return renderBrandedEmail({
    preheader: `Candidate blacklisted by ${recruiter.name || recruiter.email}.`,
    title: `Candidate blacklisted`,
    bodyHtml: [
      paragraph(`A candidate has been blacklisted from the Premier Energies ATS. Their phone number is now banned from future applications.`),
      detailTable([
        ['Candidate', candidate.name],
        ['Email', candidate.email],
        ['Phone', candidate.phone],
        ['Blacklisted by', `${recruiter.name || ''} <${recruiter.email}>`],
        ['Timestamp', formatIST()],
      ]),
      quoteBlock(reason || 'No reason provided.'),
      resumeUrl ? paragraph(`Resume on file: ${resumeUrl}`) : '',
    ].join(''),
    cta: { label: 'Review in ATS', href: `${APP()}/audit` },
    context: 'Compliance alert',
  });
}

export function requisitionRaisedAdminEmail({ requisitionId, raisedBy, jobTitle, type }) {
  return renderBrandedEmail({
    preheader: `New requisition ${requisitionId} raised by ${raisedBy}.`,
    title: `New requisition raised - ${requisitionId}`,
    bodyHtml: [
      paragraph(`A new ${type === 'replacement' ? 'replacement' : 'new-hire'} requisition has been submitted and is awaiting approval.`),
      detailTable([
        ['Requisition', requisitionId],
        ['Position', jobTitle],
        ['Raised by', raisedBy],
        ['Type', type === 'replacement' ? 'Replacement' : 'New hire'],
      ]),
    ].join(''),
    cta: { label: 'Open requisition', href: `${APP()}/requisitions/${requisitionId}` },
    context: `Requisition ${requisitionId}`,
  });
}

export function requisitionRaisedConfirmationEmail({ requisitionId, jobTitle, type }) {
  return renderBrandedEmail({
    preheader: `${requisitionId} submitted and routed for approval.`,
    title: `Requisition ${requisitionId} submitted`,
    bodyHtml: [
      paragraph(`Your ${type === 'replacement' ? 'replacement' : 'new-hire'} requisition for the ${jobTitle} position has been submitted successfully.`),
      paragraph(type === 'replacement'
        ? `It will route to HR Admin for approval. You will be notified once a decision is made.`
        : `It will route through your secondary approver and then to HR Admin. You will be notified at each stage.`
      ),
    ].join(''),
    cta: { label: 'View status', href: `${APP()}/requisitions/${requisitionId}` },
    context: `Requisition ${requisitionId}`,
  });
}

export function jobAssignedRecruiterEmail({ jobTitle, jobId, requisitionId, primary, secondary }) {
  return renderBrandedEmail({
    preheader: `Job ${jobId} assigned to you for sourcing.`,
    title: `New job assigned - ${jobTitle}`,
    bodyHtml: [
      paragraph(`The following job has been assigned to you for sourcing and pipeline management.`),
      detailTable([
        ['Job ID', jobId],
        ['Position', jobTitle],
        ['From requisition', requisitionId || '—'],
        ['Primary recruiter', primary || '—'],
        ['Secondary recruiter', secondary || '—'],
      ]),
    ].join(''),
    cta: { label: 'Open job', href: `${APP()}/jobs/${jobId}` },
    context: `Job ${jobId}`,
  });
}

export function jobOnHoldEmail({ jobTitle, jobId, reason, placedBy }) {
  return renderBrandedEmail({
    preheader: `Job ${jobId} placed on hold.`,
    title: `Job placed on hold - ${jobTitle}`,
    bodyHtml: [
      paragraph(`The following job has been placed on hold. TAT will be excluded from active metrics during the pause.`),
      detailTable([
        ['Job ID', jobId],
        ['Position', jobTitle],
        ['Placed on hold by', placedBy],
        ['When', formatIST()],
      ]),
      quoteBlock(reason || 'No reason provided.'),
    ].join(''),
    cta: { label: 'Open job', href: `${APP()}/jobs/${jobId}` },
    context: `Job ${jobId}`,
  });
}

export function shortlistInterviewerEmail({ candidateName, jobTitle, roundLabel, applicationId }) {
  return renderBrandedEmail({
    preheader: `${candidateName} shortlisted for ${roundLabel}.`,
    title: `Candidate ready for your review`,
    bodyHtml: [
      paragraph(`A candidate has been shortlisted for the ${jobTitle} position and routed to you for ${roundLabel}.`),
      detailTable([
        ['Candidate', candidateName],
        ['Position', jobTitle],
        ['Round', roundLabel],
      ]),
      paragraph(`Please review the profile and either suggest two interview slots or share initial feedback in the Interview Hub.`),
    ].join(''),
    cta: { label: 'Open interview hub', href: `${APP()}/interviews` },
    context: `Application ${applicationId}`,
  });
}

export function ctcReviewEmail({ candidateName, jobTitle, applicationId, role }) {
  return renderBrandedEmail({
    preheader: `Compensation package awaiting your ${role} review.`,
    title: `Compensation package - ${candidateName}`,
    bodyHtml: [
      paragraph(`A compensation package for ${candidateName} (${jobTitle}) is awaiting your review and clearance.`),
      paragraph(`Please open the application in the ATS to review the breakdown, candidate documents, interview history, and timeline before clearing or sending back for renegotiation.`),
    ].join(''),
    cta: { label: 'Review package', href: `${APP()}/applications/${applicationId}` },
    context: `Application ${applicationId}`,
  });
}

export function joiningOutcomeEmail({ candidateName, jobTitle, outcome }) {
  return renderBrandedEmail({
    preheader: `${candidateName} - joining outcome: ${outcome}.`,
    title: `Joining update for ${candidateName}`,
    bodyHtml: [
      paragraph(`The joining outcome for ${candidateName} on the ${jobTitle} role has been recorded as: ${outcome}.`),
    ].join(''),
    context: `Joining update`,
  });
}
