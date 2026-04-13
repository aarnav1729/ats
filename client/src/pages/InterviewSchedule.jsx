import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { applicationsAPI, interviewsAPI } from '../services/api';
import InfoTip from '../components/InfoTip';
import EmailComposerModal from '../components/EmailComposerModal';
import { getCurrentRoundTask } from '../workflow/applicationWorkflow';
import { canMarkNoShow, formatDateTime, toDatetimeLocalValue } from '../utils/dateTime';

function QuickStat({ label, value, detail }) {
  return (
    <div className="metric-tile">
      <p className="workspace-kicker">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-gray-950">{value}</p>
      {detail ? <p className="mt-2 text-sm text-gray-500">{detail}</p> : null}
    </div>
  );
}

export default function InterviewSchedule() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailModal, setEmailModal] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({
    datetime: '',
    note: '',
    source_slot: '',
  });
  const [noShowReasons, setNoShowReasons] = useState({
    candidate: '',
    panel: '',
  });

  const activeTask = useMemo(() => getCurrentRoundTask(application), [application]);
  const suggestedSlots = useMemo(
    () => [application?.suggested_interview_datetime1, application?.suggested_interview_datetime2].filter(Boolean),
    [application]
  );
  const panelMembers = useMemo(() => {
    if (!application?.interview_feedback?.length) return [];
    const roundNumber = activeTask?.round_number;
    return application.interview_feedback
      .filter((task) => !roundNumber || Number(task.round_number) === Number(roundNumber))
      .map((task) => task.interviewer_email)
      .filter(Boolean);
  }, [activeTask?.round_number, application]);
  const noShowEnabled = canMarkNoShow(activeTask?.scheduled_datetime);
  const selectedDatetimePreview = scheduleForm.datetime
    ? formatDateTime(scheduleForm.datetime)
    : 'No confirmed slot selected yet';
  const slotOptions = useMemo(
    () => suggestedSlots.map((slot, index) => ({
      key: `${index + 1}`,
      value: toDatetimeLocalValue(slot),
      label: `Suggested slot ${index + 1} · ${formatDateTime(slot)}`,
      raw: slot,
    })),
    [suggestedSlots]
  );


  useEffect(() => {
    if (!scheduleForm.datetime || !slotOptions.length) return;
    const matched = slotOptions.find((option) => option.value === scheduleForm.datetime);
    if (matched?.key && scheduleForm.source_slot !== matched.key) {
      setScheduleForm((prev) => ({ ...prev, source_slot: matched.key }));
    }
  }, [scheduleForm.datetime, scheduleForm.source_slot, slotOptions]);

  const useSuggestedSlot = (slot) => {
    const inputValue = toDatetimeLocalValue(slot);
    const matched = slotOptions.find((option) => option.value === inputValue);
    setScheduleForm((prev) => ({
      ...prev,
      datetime: inputValue,
      note: prev.note || 'Confirmed from recruiter-approved suggested slot.',
      source_slot: matched?.key || '',
    }));
  };

  const loadApplication = async () => {
    const res = await applicationsAPI.get(id);
    const app = res.data;
    const task = getCurrentRoundTask(app);
    setApplication(app);
    const initialDatetime = task?.scheduled_datetime
      ? toDatetimeLocalValue(task.scheduled_datetime)
      : toDatetimeLocalValue(app?.suggested_interview_datetime1);
    const initialSourceSlot = [app?.suggested_interview_datetime1, app?.suggested_interview_datetime2]
      .map((slot, index) => ({ key: `${index + 1}`, value: toDatetimeLocalValue(slot) }))
      .find((slot) => slot.value && slot.value === initialDatetime)?.key || '';

    setScheduleForm({
      datetime: initialDatetime,
      note: task?.scheduled_datetime
        ? 'Interview rescheduled after recruiter-candidate confirmation.'
        : 'Interview confirmed after candidate and panel alignment.',
      source_slot: initialSourceSlot,
    });
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await loadApplication();
      } catch {
        toast.error('Failed to load scheduling workspace');
        navigate('/interviews');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, navigate]);

  const confirmSchedule = async () => {
    if (!activeTask?.id) return;
    if (!scheduleForm.datetime) {
      toast.error('Choose or enter the confirmed interview slot');
      return;
    }

    try {
      setSubmitting(true);
      const res = await interviewsAPI.reschedule(activeTask.id, {
        new_datetime: scheduleForm.datetime,
        reason: scheduleForm.note || 'Scheduled from the dedicated scheduling workspace',
      });
      const sync = res.data?.calendar_sync;
      if (sync?.status === 'synced' || sync?.status === 'synced_fallback') {
        toast.success(sync.message || 'Interview scheduled and Teams invite sent');
      } else if (sync?.status === 'partial') {
        toast(sync.message || 'Interview scheduled, but Teams linking needs more Microsoft permissions');
      } else if (sync?.status === 'failed') {
        toast(sync.message || 'Interview scheduled locally, but Microsoft sync failed');
      } else {
        toast.success('Interview schedule updated');
      }
      await loadApplication();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to confirm schedule');
    } finally {
      setSubmitting(false);
    }
  };

  const markNoShow = async (party) => {
    if (!activeTask?.id) return;
    const reason = String(noShowReasons[party] || '').trim();
    if (!reason) {
      toast.error(`Add a no-show reason for the ${party}`);
      return;
    }

    try {
      setSubmitting(true);
      await interviewsAPI.markNoShow(activeTask.id, {
        party,
        reason,
      });
      setNoShowReasons((prev) => ({ ...prev, [party]: '' }));
      toast.success('No-show captured');
      await loadApplication();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to mark no-show');
    } finally {
      setSubmitting(false);
    }
  };

  const sendComposedReminder = async ({ subject, html_body }) => {
    if (!emailModal?.recipientType || !activeTask?.id) return;
    try {
      setEmailSending(true);
      await interviewsAPI.remind(activeTask.id, {
        recipient_type: emailModal.recipientType,
        subject,
        html_body,
        note: scheduleForm.note,
      });
      toast.success('Reminder sent');
      setEmailModal(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send reminder');
    } finally {
      setEmailSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary">Back</button>
        <div className="flex flex-wrap gap-2">
          {activeTask?.id && (
            <button onClick={() => navigate(`/interviews/${activeTask.id}/workspace`)} className="btn-secondary">
              Reviewer Workspace
            </button>
          )}
          <button onClick={() => navigate(`/applications/${application.id}/workflow`)} className="btn-primary">
            Candidate Workflow
          </button>
        </div>
      </div>

      <section className="workspace-hero">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="workspace-eyebrow">Interview Scheduling</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-gray-950">{application?.candidate_name || 'Schedule Interview'}</h1>
            <p className="mt-1 text-sm text-gray-500">Round {activeTask?.round_number || 1} &middot; {activeTask?.interviewer_email || 'Panel not assigned'}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <QuickStat label="Candidate" value={application?.candidate_name || '-'} detail={application?.candidate_email || ''} />
            <QuickStat label="Round" value={`Round ${activeTask?.round_number || 1}`} detail={activeTask?.interviewer_email || 'Panel scheduling'} />
            <QuickStat label="Candidate Stage" value={application?.status || '-'} detail={suggestedSlots.length ? `${suggestedSlots.length} suggested slot(s)` : 'Waiting for reviewer slots'} />
            <QuickStat label="Confirmed Slot" value={selectedDatetimePreview} detail={activeTask?.meeting_join_url ? 'Teams invite linked' : 'Calendar sync pending'} />
          </div>
        </div>
      </section>

      <div className="space-y-6">
          <section className="workspace-card">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Suggested interview slots</h2>
              <InfoTip text="The HOD or assigned interviewer proposes the starting options. Recruiters confirm with the candidate and then lock the final meeting time from here." />
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {suggestedSlots.length > 0 ? suggestedSlots.map((slot, index) => {
                const inputValue = toDatetimeLocalValue(slot);
                const selected = scheduleForm.datetime === inputValue;
                return (
                  <button
                    key={`${slot}-${index}`}
                    type="button"
                    onClick={() => useSuggestedSlot(slot)}
                    className={`interactive-card rounded-[28px] border px-5 py-5 text-left ${
                      selected
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200 bg-gray-50 hover:border-indigo-200 hover:bg-indigo-50/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="workspace-kicker">Suggested slot {index + 1}</p>
                        <p className="mt-3 text-lg font-semibold tracking-[-0.03em] text-gray-950">{formatDateTime(slot)}</p>
                      </div>
                      {selected ? <span className="glass-chip text-indigo-700">Selected</span> : null}
                    </div>
                  </button>
                );
              }) : (
                <div className="rounded-[28px] border border-dashed border-gray-300 px-5 py-10 text-sm text-gray-500 lg:col-span-2">
                  No reviewer-suggested slots are available yet. Ask the assigned interviewer or HOD to open the reviewer workspace and share two slot options first.
                </div>
              )}
            </div>
          </section>

          <section className="workspace-card">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Final confirmation</h2>
              <InfoTip text="Once this is confirmed, the ATS updates the candidate stage and attempts Microsoft calendar plus Teams sync for the candidate, recruiter, and interview panel." />
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr,1.05fr]">
              <div className="space-y-4">
                <div>
                  {slotOptions.length > 0 ? (
                    <div className="mb-4">
                      <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                        Pick from suggested slots
                        <InfoTip text="Choosing a reviewer-suggested slot fills the final confirmation field below. You can still override it manually if the candidate confirms a different time." />
                      </label>
                      <select
                        value={scheduleForm.source_slot}
                        onChange={(event) => {
                          const option = slotOptions.find((item) => item.key === event.target.value);
                          if (!option) {
                            setScheduleForm((prev) => ({ ...prev, source_slot: '' }));
                            return;
                          }
                          setScheduleForm((prev) => ({
                            ...prev,
                            source_slot: option.key,
                            datetime: option.value,
                            note: prev.note || 'Confirmed from recruiter-approved suggested slot.',
                          }));
                        }}
                        className="input-field"
                      >
                        <option value="">Select a suggested slot</option>
                        {slotOptions.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Confirmed interview date and time</label>
                  <input
                    type="datetime-local"
                    value={scheduleForm.datetime}
                    onChange={(event) => setScheduleForm((prev) => ({ ...prev, datetime: event.target.value, source_slot: '' }))}
                    className="input-field"
                  />
                  <p className="mt-2 text-sm font-medium text-indigo-700">{selectedDatetimePreview}</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Recruiter note</label>
                  <textarea
                    rows={5}
                    value={scheduleForm.note}
                    onChange={(event) => setScheduleForm((prev) => ({ ...prev, note: event.target.value }))}
                    className="input-field"
                    placeholder="Capture the final candidate confirmation, panel coordination note, or any exception that matters."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={confirmSchedule} disabled={submitting} className="btn-primary w-full disabled:opacity-50">
                    {submitting ? 'Scheduling...' : 'Confirm Schedule & Trigger Teams Invite'}
                  </button>
                  <InfoTip text="The final slot drives the candidate stage, the calendar attempt, and the reminder context shown below." />
                </div>
              </div>

              <div className="rounded-[28px] border border-gray-200 bg-gray-50 p-5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Meeting recipients</h3>
                  <InfoTip text="The ATS schedules from the configured SPOT mailbox and includes the candidate, recruiter, secondary recruiter when present, and the round panel." />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="surface-muted">
                    <p className="workspace-kicker">Candidate</p>
                    <p className="mt-2 text-sm text-gray-800">{application?.candidate_email || '-'}</p>
                  </div>
                  <div className="surface-muted">
                    <p className="workspace-kicker">Recruiter</p>
                    <p className="mt-2 text-sm text-gray-800">{application?.recruiter_email || '-'}</p>
                  </div>
                  <div className="surface-muted sm:col-span-2">
                    <p className="workspace-kicker">Panel</p>
                    <p className="mt-2 text-sm text-gray-800">{panelMembers.length ? panelMembers.join(', ') : 'No panel members assigned yet'}</p>
                  </div>
                  <div className="surface-muted sm:col-span-2">
                    <p className="workspace-kicker">Teams / calendar</p>
                    {activeTask?.meeting_join_url ? (
                      <a href={activeTask.meeting_join_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-indigo-700 hover:text-indigo-900">
                        Open latest Teams meeting
                      </a>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">The meeting link appears here after Microsoft sync completes.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="workspace-card">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Reminders and exceptions</h2>
              <InfoTip text="Use AI-assisted reminder drafting when you need a polished communication instead of a generic nudge. No-show capture stays blocked until the interview time actually starts or passes." />
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr,1.1fr]">
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setEmailModal({
                    recipientType: 'candidate',
                    recipients: [application?.candidate_email].filter(Boolean),
                    title: 'Draft Candidate Reminder',
                    subtitle: 'Ask AI to draft a polished reminder for the candidate, then edit and send it from this workflow.',
                    purpose: 'interview',
                    context: {
                      candidate_name: application?.candidate_name,
                      job_title: application?.job_title,
                      recruiter_email: application?.recruiter_email,
                      round_number: activeTask?.round_number,
                    },
                    defaultPrompt: `Draft a concise but polished reminder to ${application?.candidate_name || 'the candidate'} about the scheduled interview for ${application?.job_title || 'the current role'}. Mention the confirmed slot and ask them to be ready a few minutes early.`,
                  })}
                  className="btn-secondary w-full justify-center"
                >
                  Compose Candidate Reminder
                </button>
                <button
                  type="button"
                  onClick={() => setEmailModal({
                    recipientType: 'panel',
                    recipients: panelMembers,
                    title: 'Draft Panel Reminder',
                    subtitle: 'Create a recruiter-grade reminder for the interviewer panel using the ATS context.',
                    purpose: 'interview',
                    context: {
                      candidate_name: application?.candidate_name,
                      job_title: application?.job_title,
                      recruiter_email: application?.recruiter_email,
                      round_number: activeTask?.round_number,
                    },
                    defaultPrompt: `Draft a crisp interviewer reminder for the panel about the upcoming Round ${activeTask?.round_number || 1} interview with ${application?.candidate_name || 'the candidate'}, including the role context and a request to join on time.`,
                  })}
                  className="btn-secondary w-full justify-center"
                >
                  Compose Panel Reminder
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className={`rounded-[28px] border p-5 ${noShowEnabled ? 'border-red-200 bg-red-50/80' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">Candidate no-show</h3>
                    <InfoTip text="This stays disabled until the interview slot has actually started or passed, so the ATS does not record no-shows prematurely." />
                  </div>
                  <textarea
                    rows={4}
                    value={noShowReasons.candidate}
                    onChange={(event) => setNoShowReasons((prev) => ({ ...prev, candidate: event.target.value }))}
                    className="input-field mt-4"
                    placeholder="Capture what happened, who confirmed it, and what the recruiter will do next."
                    disabled={!noShowEnabled}
                  />
                  {!noShowEnabled ? (
                    <p className="mt-3 text-xs text-gray-500">Available after {activeTask?.scheduled_datetime ? formatDateTime(activeTask.scheduled_datetime) : 'the interview is scheduled'}.</p>
                  ) : null}
                  <button
                    onClick={() => markNoShow('candidate')}
                    disabled={submitting || !noShowEnabled}
                    className="mt-4 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    Mark Candidate No-Show
                  </button>
                </div>

                <div className={`rounded-[28px] border p-5 ${noShowEnabled ? 'border-amber-200 bg-amber-50/80' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">Panel no-show</h3>
                    <InfoTip text="Use this only if the panel or interviewer missed the confirmed slot after it started. The ATS routes the record back into scheduling without dropping context." />
                  </div>
                  <textarea
                    rows={4}
                    value={noShowReasons.panel}
                    onChange={(event) => setNoShowReasons((prev) => ({ ...prev, panel: event.target.value }))}
                    className="input-field mt-4"
                    placeholder="Capture who missed the slot and what needs to be coordinated again."
                    disabled={!noShowEnabled}
                  />
                  {!noShowEnabled ? (
                    <p className="mt-3 text-xs text-gray-500">Available after {activeTask?.scheduled_datetime ? formatDateTime(activeTask.scheduled_datetime) : 'the interview is scheduled'}.</p>
                  ) : null}
                  <button
                    onClick={() => markNoShow('panel')}
                    disabled={submitting || !noShowEnabled}
                    className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Mark Panel No-Show
                  </button>
                </div>
              </div>
            </div>
          </section>
      </div>

      <EmailComposerModal
        open={!!emailModal}
        onClose={() => setEmailModal(null)}
        title={emailModal?.title || 'Draft reminder'}
        subtitle={emailModal?.subtitle || 'Draft and send a formatted reminder'}
        recipients={emailModal?.recipients || []}
        draftContext={{
          purpose: emailModal?.purpose,
          context: {
            ...emailModal?.context,
            candidate_name: application?.candidate_name,
            recruiter_email: application?.recruiter_email,
            job_title: application?.job_title,
          },
          defaultPrompt: emailModal?.defaultPrompt,
          defaultSubject: emailModal?.defaultSubject,
        }}
        onSend={sendComposedReminder}
        sending={emailSending}
      />
    </div>
  );
}
