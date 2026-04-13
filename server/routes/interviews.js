import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { sendNotificationEmail } from '../services/email.js';
import { syncInterviewCalendarMeeting } from '../services/teamsCalendar.js';
import { ensureInterviewTasksForRound } from '../services/interviewWorkflow.js';

const router = Router();
const adminOrInterviewer = requireRole('hr_admin', 'hr_recruiter', 'interviewer', 'hod');

function canSuggestSlots(status) {
  return ['AwaitingHODResponse', 'AwaitingInterviewScheduling', 'Round1', 'Round2', 'Round3'].includes(status);
}

function canSubmitInterviewFeedback(status) {
  return /^Round\d+$/.test(String(status || '')) || status === 'AwaitingFeedback';
}

function uniqueEmails(items = []) {
  return [...new Set(
    items
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

async function getRoundInterviewContext(interviewId) {
  const interviewResult = await pool.query('SELECT * FROM interview_feedback WHERE id = $1', [interviewId]);
  if (interviewResult.rows.length === 0) return null;

  const interview = interviewResult.rows[0];
  const applicationResult = await pool.query(
    `SELECT
        a.*,
        j.job_title,
        j.secondary_recruiter_email
     FROM applications a
     LEFT JOIN jobs j ON a.ats_job_id = j.job_id
     WHERE a.id = $1`,
    [interview.application_id]
  );
  const application = applicationResult.rows[0];
  if (!application) return null;

  const roundTasksResult = await pool.query(
    `SELECT * FROM interview_feedback WHERE application_id = $1 AND round_number = $2 ORDER BY id ASC`,
    [interview.application_id, interview.round_number]
  );

  return {
    interview,
    application,
    roundTasks: roundTasksResult.rows,
    panelEmails: uniqueEmails(roundTasksResult.rows.map((task) => task.interviewer_email)),
  };
}

async function getHrStakeholders() {
  const result = await pool.query(
    `SELECT email FROM users WHERE role IN ('hr_admin', 'hr_recruiter') AND is_active = true`
  );
  return uniqueEmails(result.rows.map((row) => row.email));
}

router.get('/', adminOrInterviewer, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, date_from, date_to, application_id, app_status } = req.query;
    const offset = (page - 1) * limit;
    const canViewAll = req.user.role === 'hr_admin' || req.user.role === 'hr_recruiter';

    let query = `
      SELECT ifb.*,
             ifb.id as _id,
             ifb.round_number as round,
             ifb.scheduled_datetime as scheduled_at,
             a.id as application_record_id,
             a.candidate_name,
             a.candidate_email,
             a.candidate_phone,
             a.recruiter_email,
             a.ats_job_id,
             a.status as app_status,
             a.suggested_interview_datetime1,
             a.suggested_interview_datetime2,
             j.job_title,
             j.job_id as job_code,
             j.id as job_record_id
      FROM interview_feedback ifb
      JOIN applications a ON ifb.application_id = a.id
      LEFT JOIN jobs j ON ifb.job_id = j.job_id
      WHERE 1=1
    `;
    const params = [];

    if (!canViewAll) {
      params.push(req.user.email);
      query += ` AND ifb.interviewer_email = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND ifb.status = $${params.length}`;
    }
    if (application_id) {
      params.push(application_id);
      query += ` AND a.id = $${params.length}`;
    }
    if (app_status) {
      params.push(app_status);
      query += ` AND a.status = $${params.length}`;
    }
    if (date_from) {
      params.push(date_from);
      query += ` AND ifb.scheduled_datetime >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      query += ` AND ifb.scheduled_datetime <= $${params.length}`;
    }

    let countQ = `SELECT COUNT(*) FROM interview_feedback ifb JOIN applications a ON ifb.application_id = a.id LEFT JOIN jobs j ON ifb.job_id = j.job_id WHERE 1=1`;
    if (!canViewAll) countQ += ` AND ifb.interviewer_email = $1`;
    const countParams = !canViewAll ? [req.user.email] : [];
    // Apply same filters for count
    let cIdx = countParams.length;
    if (status) { cIdx++; countQ += ` AND ifb.status = $${cIdx}`; countParams.push(status); }
    if (application_id) { cIdx++; countQ += ` AND a.id = $${cIdx}`; countParams.push(application_id); }
    if (app_status) { cIdx++; countQ += ` AND a.status = $${cIdx}`; countParams.push(app_status); }
    if (date_from) { cIdx++; countQ += ` AND ifb.scheduled_datetime >= $${cIdx}`; countParams.push(date_from); }
    if (date_to) { cIdx++; countQ += ` AND ifb.scheduled_datetime <= $${cIdx}`; countParams.push(date_to); }
    const countResult = await pool.query(countQ, countParams);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit);
    query += ` ORDER BY COALESCE(ifb.scheduled_datetime, ifb.updated_at, ifb.created_at) DESC LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    res.json({ interviews: result.rows, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('List interviews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', adminOrInterviewer, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ifb.*,
             ifb.id as _id,
             ifb.round_number as round,
             ifb.scheduled_datetime as scheduled_at,
             a.id as application_record_id,
             a.application_id as application_code,
             a.candidate_name,
             a.candidate_email,
             a.candidate_phone,
             a.candidate_aadhar,
             a.candidate_pan,
             a.candidate_age,
             a.candidate_gender,
             a.candidate_years_of_experience,
             a.current_organization,
             a.current_ctc,
             a.current_location,
             a.willing_to_relocate,
             a.education_level,
             a.education_other,
             a.source,
             a.referrer_emp_id,
             a.consultant_code,
             a.recruiter_email,
             a.ats_job_id,
             a.status as app_status,
             a.suggested_interview_datetime1,
             a.suggested_interview_datetime2,
             a.resume_path,
             a.resume_file_name,
             a.interviewer_feedback_remarks,
             a.interviewer_technical_score,
             a.interviewer_behavioral_score,
             a.interviewer_company_fit_score,
             a.interviewer_final_decision,
             j.job_title,
             j.job_id as job_code,
             j.id as job_record_id,
             j.job_description
      FROM interview_feedback ifb
      JOIN applications a ON ifb.application_id = a.id
      LEFT JOIN jobs j ON ifb.job_id = j.job_id
      WHERE ifb.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = result.rows[0];
    if (!['hr_admin', 'hr_recruiter'].includes(req.user.role) && row.interviewer_email !== req.user.email) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const docsResult = await pool.query(
      `SELECT *
       FROM candidate_documents
       WHERE application_id = $1
       ORDER BY created_at DESC`,
      [row.application_record_id]
    );

    res.json({
      ...row,
      candidate_documents: docsResult.rows,
    });
  } catch (err) {
    console.error('Get interview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/suggest-slots', adminOrInterviewer, async (req, res) => {
  try {
    const { suggested_datetime1, suggested_datetime2, suggested_slots } = req.body;
    const slot1 = suggested_datetime1 || suggested_slots?.[0] || null;
    const slot2 = suggested_datetime2 || suggested_slots?.[1] || null;
    const existing = await pool.query('SELECT * FROM interview_feedback WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const interview = existing.rows[0];
    const appResult = await pool.query('SELECT id, status, recruiter_email, candidate_name FROM applications WHERE id = $1', [interview.application_id]);
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!slot1 || !slot2) {
      return res.status(400).json({ error: 'Two suggested interview slots are required' });
    }
    if (!canSuggestSlots(application.status)) {
      return res.status(400).json({ error: `Slots cannot be suggested while the candidate is in ${application.status}` });
    }

    await pool.query(
      `UPDATE applications
       SET suggested_interview_datetime1 = $1,
           suggested_interview_datetime2 = $2,
           status = 'AwaitingInterviewScheduling',
           updated_at = NOW()
       WHERE id = $3`,
      [slot1, slot2, interview.application_id]
    );

    await pool.query(
      `UPDATE interview_feedback
       SET status = 'awaiting_hr_schedule',
           updated_at = NOW()
       WHERE application_id = $1 AND round_number = $2`,
      [interview.application_id, interview.round_number]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'schedule',
      entityType: 'interview',
      entityId: req.params.id,
      afterState: { suggested_datetime1: slot1, suggested_datetime2: slot2 }
    });

    if (application.recruiter_email) {
      await sendNotificationEmail(
        application.recruiter_email,
        'Interview Slot Suggested',
        `<p>${req.user.email} has suggested two interview slots for <strong>${application.candidate_name}</strong>. HR should now confirm the final schedule from Interview Hub.</p>`
      );
    }

    res.json({ message: 'Slots suggested' });
  } catch (err) {
    console.error('Suggest slots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/feedback', adminOrInterviewer, async (req, res) => {
  try {
    const { technical_score, behavioral_score, company_fit_score, remarks, decision, rejection_reasons, attachments } = req.body;
    if (decision === 'reject' && (!Array.isArray(rejection_reasons) || rejection_reasons.length === 0)) {
      return res.status(400).json({ error: 'At least one rejection reason is required' });
    }

    const existing = await pool.query('SELECT * FROM interview_feedback WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const app = await pool.query('SELECT * FROM applications WHERE id = $1', [existing.rows[0].application_id]);
    const application = app.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (decision !== 'reject' && !canSubmitInterviewFeedback(application.status)) {
      return res.status(400).json({ error: 'Suggest slots and wait for HR to confirm the interview before submitting feedback' });
    }

    await pool.query(`
      UPDATE interview_feedback SET technical_score = $1, behavioral_score = $2, company_fit_score = $3,
        remarks = $4, decision = $5, rejection_reasons = $6, attachments = COALESCE($7, attachments),
        status = 'completed', actual_datetime = NOW(), updated_at = NOW()
      WHERE id = $8
    `, [
      technical_score, behavioral_score, company_fit_score, remarks, decision,
      JSON.stringify(rejection_reasons || []),
      attachments ? JSON.stringify(attachments) : null,
      req.params.id
    ]);

    if (decision === 'reject') {
      const round = existing.rows[0].round_number;
      const rejectStatus = ['AwaitingHODResponse', 'AwaitingInterviewScheduling'].includes(application.status)
        ? 'HODRejected'
        : `Round${round}Rejected`;
      await pool.query(
        'UPDATE applications SET status = $1, interviewer_final_decision = $2, updated_at = NOW() WHERE id = $3',
        [rejectStatus, 'reject', application.id]
      );
    } else if (decision === 'no_show') {
      await pool.query("UPDATE interview_feedback SET status = 'no_show' WHERE id = $1", [req.params.id]);
    } else if (decision === 'shortlist') {
      const round = existing.rows[0].round_number;
      const totalRounds = application.no_of_rounds || 3;
      if (round >= totalRounds) {
        await pool.query(
          "UPDATE applications SET status = 'Selected', interviewer_final_decision = 'shortlist', updated_at = NOW() WHERE id = $1",
          [application.id]
        );
      } else {
        await pool.query(
          "UPDATE applications SET status = 'AwaitingInterviewScheduling', updated_at = NOW() WHERE id = $1",
          [application.id]
        );
        await ensureInterviewTasksForRound(
          pool,
          { ...application, status: 'AwaitingInterviewScheduling' },
          round + 1,
          'AwaitingInterviewScheduling'
        );
      }
    }

    await logAudit({
      actionBy: req.user.email,
      actionType: decision === 'reject' ? 'reject' : 'update',
      entityType: 'interview_feedback',
      entityId: req.params.id,
      beforeState: existing.rows[0],
      afterState: { technical_score, behavioral_score, company_fit_score, decision }
    });

    if (application.recruiter_email) {
      await sendNotificationEmail(
        application.recruiter_email,
        'Interview Feedback Submitted',
        `<p>Feedback for <strong>${application.candidate_name}</strong> (Round ${existing.rows[0].round_number}) has been submitted by ${req.user.email}. Decision: <strong>${decision}</strong></p>`
      );
    }

    res.json({ message: 'Feedback submitted' });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/reschedule', adminOrInterviewer, async (req, res) => {
  try {
    const { reason, new_datetime, scheduled_at } = req.body;
    const nextDatetime = new_datetime || scheduled_at || null;
    if (!nextDatetime) {
      return res.status(400).json({ error: 'A confirmed interview date and time is required' });
    }
    const context = await getRoundInterviewContext(req.params.id);
    if (!context) return res.status(404).json({ error: 'Not found' });
    const { interview, application, roundTasks, panelEmails } = context;

    await pool.query(`
      UPDATE interview_feedback
      SET status = 'scheduled',
          scheduled_datetime = COALESCE($1, scheduled_datetime),
          remarks = CONCAT(COALESCE(remarks, ''), E'\nSchedule updated: ', COALESCE($2::text, 'Requested from UI')),
          updated_at = NOW()
      WHERE application_id = $3 AND round_number = $4
    `, [nextDatetime, reason || null, interview.application_id, interview.round_number]);

    const existingTimes = Array.isArray(application?.interview_datetimes)
      ? application.interview_datetimes
      : [];
    const nextTimes = [...existingTimes];
    nextTimes[Math.max(0, (interview.round_number || 1) - 1)] = nextDatetime;
    await pool.query(
      `UPDATE applications
       SET status = $1,
           interview_datetimes = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [`Round${interview.round_number || 1}`, JSON.stringify(nextTimes), interview.application_id]
    );

    const calendarSync = await syncInterviewCalendarMeeting({
      organizerEmail: process.env.GRAPH_SENDER_EMAIL || 'spot@premierenergies.com',
      existingEventId: roundTasks[0]?.calendar_event_id || interview.calendar_event_id,
      existingJoinUrl: roundTasks[0]?.meeting_join_url || interview.meeting_join_url,
      scheduledDateTime: nextDatetime || interview.scheduled_datetime,
      roundNumber: interview.round_number,
      candidateName: application.candidate_name,
      candidateEmail: application.candidate_email,
      recruiterEmail: application.recruiter_email,
      secondaryRecruiterEmail: application.secondary_recruiter_email,
      interviewerEmails: panelEmails,
      jobTitle: application.job_title,
      subject: `Premier Energies Interview | ${application.candidate_name || 'Candidate'} | Round ${interview.round_number || 1}`,
    });

    await pool.query(
      `UPDATE interview_feedback
       SET calendar_event_id = COALESCE($1, calendar_event_id),
           calendar_event_organizer = COALESCE($2, calendar_event_organizer),
           meeting_join_url = COALESCE($3, meeting_join_url),
           meeting_provider = COALESCE($4, meeting_provider),
           calendar_sync_status = $5,
           calendar_sync_error = $6,
           calendar_last_synced_at = NOW(),
           updated_at = NOW()
       WHERE application_id = $7 AND round_number = $8`,
      [
        calendarSync.eventId || null,
        process.env.GRAPH_SENDER_EMAIL || 'spot@premierenergies.com',
        calendarSync.joinUrl || null,
        calendarSync.provider || null,
        calendarSync.status || 'failed',
        calendarSync.error || null,
        interview.application_id,
        interview.round_number,
      ]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'schedule',
      entityType: 'interview',
      entityId: req.params.id,
      afterState: {
        reason,
        new_datetime: nextDatetime,
        calendar_sync_status: calendarSync.status || 'failed',
        meeting_join_url: calendarSync.joinUrl || null,
      }
    });

    if (application.recruiter_email) {
      await sendNotificationEmail(
        application.recruiter_email,
        'Interview Schedule Confirmed',
        `<p>The interview for <strong>${application.candidate_name}</strong> has been confirmed for ${nextDatetime}.</p>${
          calendarSync.joinUrl ? `<p><a href="${calendarSync.joinUrl}">Open Teams meeting</a></p>` : ''
        }`
      );
    }
    if (application.candidate_email) {
      await sendNotificationEmail(
        application.candidate_email,
        'Interview Schedule Updated',
        `<p>Your interview for <strong>${application.candidate_name}</strong> has been scheduled or rescheduled for ${nextDatetime || 'the latest shared slot'}.</p>${
          calendarSync.joinUrl ? `<p><a href="${calendarSync.joinUrl}">Join Microsoft Teams meeting</a></p>` : ''
        }`
      );
    }
    for (const panelEmail of panelEmails) {
      await sendNotificationEmail(
        panelEmail,
        'Interview Schedule Confirmed',
        `<p>Your interview with <strong>${application.candidate_name}</strong> has been scheduled for ${nextDatetime}.</p>${
          calendarSync.joinUrl ? `<p><a href="${calendarSync.joinUrl}">Join Microsoft Teams meeting</a></p>` : ''
        }`
      ).catch((err) => console.error('Panel schedule email error:', err.message));
    }

    res.json({
      message: 'Interview schedule confirmed',
      calendar_sync: calendarSync,
    });
  } catch (err) {
    console.error('Reschedule error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/mark-no-show', adminOrInterviewer, async (req, res) => {
  try {
    const { party = 'candidate', reason } = req.body;
    if (!reason) {
      return res.status(400).json({ error: 'A no-show reason is required' });
    }

    const context = await getRoundInterviewContext(req.params.id);
    if (!context) return res.status(404).json({ error: 'Not found' });
    const { interview, application } = context;
    if (!interview.scheduled_datetime) {
      return res.status(400).json({ error: 'No-show can only be recorded after a confirmed interview has been scheduled' });
    }
    const updateResult = await pool.query(
      `WITH eligible_round AS (
         SELECT application_id, round_number
         FROM interview_feedback
         WHERE id = $4
           AND scheduled_datetime IS NOT NULL
           AND scheduled_datetime <= NOW()
       )
       UPDATE interview_feedback AS feedback
       SET status = 'no_show',
           decision = 'no_show',
           no_show_reason = $1,
           no_show_marked_by = $3,
           remarks = CONCAT(COALESCE(feedback.remarks, ''), E'\nNo-show recorded for ', $2::text, ': ', $1::text),
           updated_at = NOW()
       FROM eligible_round
       WHERE feedback.application_id = eligible_round.application_id
         AND feedback.round_number = eligible_round.round_number
       RETURNING feedback.id`,
      [reason, party, req.user.email, req.params.id]
    );

    if (updateResult.rowCount === 0) {
      return res.status(400).json({ error: 'No-show can only be recorded after the scheduled interview time has started or passed' });
    }

    await pool.query(
      `UPDATE applications
       SET status = 'AwaitingInterviewScheduling',
           updated_at = NOW()
       WHERE id = $1`,
      [interview.application_id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'interview',
      entityId: req.params.id,
      afterState: {
        no_show_party: party,
        no_show_reason: reason,
        application_status: 'AwaitingInterviewScheduling',
      },
    });

    const recipients = uniqueEmails([
      application.recruiter_email,
      application.secondary_recruiter_email,
      application.candidate_email,
      ...context.panelEmails,
    ]);

    for (const email of recipients) {
      await sendNotificationEmail(
        email,
        'Interview No-Show Recorded',
        `<p>The interview for <strong>${application.candidate_name}</strong> was marked as a no-show for the ${party}.</p><p>Reason: ${reason}</p><p>The ATS has moved the candidate back into scheduling so the recruiter can coordinate a fresh slot.</p>`
      ).catch((err) => console.error('No-show email error:', err.message));
    }

    res.json({ message: 'No-show recorded and candidate moved back to scheduling' });
  } catch (err) {
    console.error('Mark no-show error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/request-additional-rounds', adminOrInterviewer, async (req, res) => {
  try {
    const additionalRounds = Math.max(1, Number(req.body.additional_rounds || 1));
    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) {
      return res.status(400).json({ error: 'Remarks are required when requesting additional rounds' });
    }

    const context = await getRoundInterviewContext(req.params.id);
    if (!context) return res.status(404).json({ error: 'Not found' });
    const { interview, application } = context;
    const currentRounds = Number(application.no_of_rounds || 1);
    const requestedTotal = Math.min(3, currentRounds + additionalRounds);
    if (requestedTotal <= currentRounds) {
      return res.status(400).json({ error: 'This candidate is already configured for the maximum number of rounds' });
    }

    await pool.query(
      `UPDATE interview_feedback
       SET requested_additional_rounds = $1,
           additional_round_requested_by = $2,
           additional_round_requested_at = NOW(),
           additional_round_request_remarks = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [requestedTotal - currentRounds, req.user.email, remarks, req.params.id]
    );

    await logAudit({
      actionBy: req.user.email,
      actionType: 'update',
      entityType: 'interview',
      entityId: req.params.id,
      afterState: {
        requested_additional_rounds: requestedTotal - currentRounds,
        requested_total_rounds: requestedTotal,
        remarks,
      },
    });

    const hrStakeholders = uniqueEmails([
      application.recruiter_email,
      application.secondary_recruiter_email,
      ...(await getHrStakeholders()),
    ]);

    for (const email of hrStakeholders) {
      await sendNotificationEmail(
        email,
        'Additional Interview Round Requested',
        `<p>${req.user.email} has requested ${requestedTotal - currentRounds} more round(s) for <strong>${application.candidate_name}</strong>.</p><p>Reason: ${remarks}</p><p>Open the candidate workflow to revise the interview plan.</p>`
      ).catch((err) => console.error('Additional round email error:', err.message));
    }

    res.json({ message: 'Additional round request sent', requested_total_rounds: requestedTotal });
  } catch (err) {
    console.error('Request additional rounds error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/remind', adminOrInterviewer, async (req, res) => {
  try {
    const { recipient_type = 'candidate', note = '', subject, html_body } = req.body || {};
    const context = await getRoundInterviewContext(req.params.id);
    if (!context) return res.status(404).json({ error: 'Not found' });
    const { application, panelEmails } = context;

    let recipients = [];
    if (recipient_type === 'candidate') {
      recipients = [application.candidate_email];
    } else if (recipient_type === 'recruiter') {
      recipients = [application.recruiter_email, application.secondary_recruiter_email];
    } else if (recipient_type === 'panel') {
      recipients = panelEmails;
    } else {
      recipients = [application.candidate_email, application.recruiter_email, application.secondary_recruiter_email, ...panelEmails];
    }

    const normalizedRecipients = uniqueEmails(recipients);
    if (!normalizedRecipients.length) {
      return res.status(400).json({ error: 'No recipients were available for this reminder' });
    }

    for (const email of normalizedRecipients) {
      await sendNotificationEmail(
        {
          to: email,
          subject: subject || 'Premier Energies Interview Reminder',
          htmlBody: html_body || `
            <p style="margin:0 0 14px;color:#475569;line-height:1.7;">This is a reminder regarding <strong>${application.candidate_name}</strong>.</p>
            <p style="margin:0 0 14px;color:#475569;line-height:1.7;">${note || 'Please review the ATS workflow for the next required action.'}</p>
            ${application.job_title ? `<div style="margin-top:18px;border:1px solid #dbeafe;border-radius:18px;background:linear-gradient(135deg,#eef4ff,#f8fbff);padding:18px 20px;"><p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#1d4ed8;">Interview Context</p><p style="margin:10px 0 0;color:#1e293b;line-height:1.7;">Candidate: <strong>${application.candidate_name}</strong><br />Role: <strong>${application.job_title}</strong><br />Recruiter: <strong>${application.recruiter_email || 'Premier Energies ATS'}</strong></p></div>` : ''}
          `,
        }
      ).catch((err) => console.error('Interview reminder email error:', err.message));
    }

    await logAudit({
      actionBy: req.user.email,
      actionType: 'reminder',
      entityType: 'interview',
      entityId: req.params.id,
      afterState: {
        recipient_type,
        recipients: normalizedRecipients,
        note,
      },
    });

    res.json({ message: 'Reminder sent', recipients: normalizedRecipients });
  } catch (err) {
    console.error('Interview reminder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/message', adminOrInterviewer, async (req, res) => {
  try {
    const { recipient_email, message } = req.body;
    const interview = await pool.query('SELECT application_id FROM interview_feedback WHERE id = $1', [req.params.id]);
    if (interview.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const app = await pool.query(
      'SELECT recruiter_email, candidate_email FROM applications WHERE id = $1',
      [interview.rows[0].application_id]
    );
    const fallbackRecipient = req.user.role === 'hr_admin'
      ? app.rows[0]?.candidate_email
      : app.rows[0]?.recruiter_email;
    const resolvedRecipient = recipient_email || fallbackRecipient;
    if (!resolvedRecipient) {
      return res.status(400).json({ error: 'recipient_email is required' });
    }

    const result = await pool.query(
      'INSERT INTO messages (application_id, sender_email, recipient_email, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [interview.rows[0].application_id, req.user.email, resolvedRecipient, message]
    );

    await sendNotificationEmail(
      resolvedRecipient,
      'New Message - ATS',
      `<p>You have a new message from ${req.user.email} regarding an interview.</p><blockquote style="border-left:3px solid #6366f1;padding:8px 16px;margin:16px 0;background:#f8fafc">${message}</blockquote>`
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/messages', adminOrInterviewer, async (req, res) => {
  try {
    const interview = await pool.query('SELECT application_id FROM interview_feedback WHERE id = $1', [req.params.id]);
    if (interview.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const result = await pool.query(
      'SELECT * FROM messages WHERE application_id = $1 ORDER BY created_at ASC',
      [interview.rows[0].application_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
