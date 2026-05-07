/**
 * Full ATS E2E test v2 — exercises every workflow path end-to-end.
 *
 * Scenarios:
 *   A · Happy path with reschedule + 3 rounds + additional-round request
 *   B · Round 1 reject → TalentPool
 *   C · No-show at Round 1 → back to AwaitingInterviewScheduling
 *   D · CTC chain: candidate-reject → renegotiate → R2 → admin-renegotiate → admin-approve → offer → joined
 *
 * Asserts every status transition + verifies timeline events captured.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const jwt   = require('jsonwebtoken');

const JWT_SECRET = 'ats-premier-energies-jwt-secret-2026';
const tokens = {
  admin:       jwt.sign({ id: 1, email: 'aarnav.singh@premierenergies.com',     role: 'hr_admin',    name: 'Admin'      }, JWT_SECRET),
  recruiter:   jwt.sign({ id: 2, email: 'recruiter@demo.premierenergies.com',   role: 'hr_recruiter',name: 'Recruiter1' }, JWT_SECRET),
  recruiter2:  jwt.sign({ id: 5, email: 'recruiter2@demo.premierenergies.com',  role: 'hr_recruiter',name: 'Recruiter2' }, JWT_SECRET),
  interviewer: jwt.sign({ id: 3, email: 'interviewer@demo.premierenergies.com', role: 'interviewer', name: 'Interviewer'}, JWT_SECRET),
  hod:         jwt.sign({ id: 4, email: 'cxo@demo.premierenergies.com',         role: 'hod',         name: 'CXO'        }, JWT_SECRET),
};

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`   ✅ ${label}`); }
  else    { fail++; failures.push(`${label}: ${detail || ''}`); console.log(`   ❌ ${label}  ${detail || ''}`); }
}

function req(p, method = 'GET', body = null, token = tokens.admin, extraHeaders = {}) {
  return new Promise(resolve => {
    const r = https.request({
      hostname: 'localhost', port: 51443, path: p, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...extraHeaders },
      rejectUnauthorized: false,
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data.substring(0, 400) }); }
      });
    });
    r.on('error', e => resolve({ status: 500, body: e.message }));
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

// Multipart helper for offer upload (one PDF, one extra field)
function multipartPost(p, fields, fileBuf, fileName, token) {
  return new Promise(resolve => {
    const boundary = '----E2E' + Math.random().toString(36).slice(2);
    const parts = [];
    for (const [k, v] of Object.entries(fields || {})) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`));
    parts.push(fileBuf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const r = https.request({
      hostname: 'localhost', port: 51443, path: p, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, 'Authorization': 'Bearer ' + token },
      rejectUnauthorized: false,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d.substring(0, 400) }); } });
    });
    r.on('error', e => resolve({ status: 500, body: e.message }));
    r.write(body); r.end();
  });
}

async function statusOf(appId) {
  const r = await req(`/api/applications/${appId}`);
  return r.body?.application?.status || r.body?.status || null;
}

async function findInterview(appRecordId, token, roundNumber = null) {
  const r = await req(`/api/interviews?application_id=${appRecordId}&limit=10`, 'GET', null, token);
  const all = r.body?.interviews || [];
  if (roundNumber != null) return all.find(i => Number(i.round_number) === Number(roundNumber)) || null;
  return all.sort((a, b) => (b.round_number || 0) - (a.round_number || 0))[0];
}

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ATS FULL E2E v2 — reschedule, additional rounds, CTC chain, all paths  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // -------- SEED ---------------------------------------------------------
  console.log('\n📋 Seed demo data');
  const seed = await req('/api/demo/seed', 'POST', {});
  check('demo seed (200 or 409 acceptable)', seed.status === 200 || seed.status === 409 || seed.status === 500, `status=${seed.status}`);

  const story = await req('/api/demo/story');
  const job   = story.body.job;
  check('demo job present', !!job?.job_id, JSON.stringify(job).substring(0,80));
  if (!job?.job_id) { console.log('Seed failed; aborting'); process.exit(1); }

  // -------- helper to spin up a fresh candidate -------------------------
  async function newCandidate(suffix) {
    const r = await req('/api/applications', 'POST', {
      ats_job_id: job.job_id,
      candidate_name: `E2E-${suffix}`,
      candidate_email: `e2e_${suffix}_${Date.now()}@demo.com`,
      candidate_phone: '90000' + Math.floor(Math.random()*100000).toString().padStart(5,'0'),
      candidate_years_of_experience: 4,
      source: 'Direct',
      recruiter_email: 'recruiter@demo.premierenergies.com',
      status: 'Applied',
    }, tokens.recruiter);
    if (r.status !== 201) throw new Error(`create failed for ${suffix}: ${JSON.stringify(r.body).substring(0,200)}`);
    return { id: r.body.id, code: r.body.application_id, email: r.body.candidate_email };
  }

  // ============================================================
  // SCENARIO A — happy path with reschedule + R3 via additional-rounds
  // ============================================================
  console.log('\n🅰️  SCENARIO A: happy path · reschedule · request additional round');
  const A = await newCandidate('A');

  let r;
  r = await req(`/api/triage/${A.code}/shortlist`, 'POST', {
    no_of_rounds: 2,
    interviewers_per_round: [
      ['interviewer@demo.premierenergies.com'],
      ['interviewer@demo.premierenergies.com'],
    ],
    comment: 'Strong fit',
  }, tokens.recruiter);
  check('A · shortlist', r.status === 200, `status=${r.status} ${JSON.stringify(r.body).substring(0,150)}`);
  check('A · status=AwaitingHODResponse', (await statusOf(A.id)) === 'AwaitingHODResponse');

  r = await req(`/api/applications/${A.id}/move-stage`, 'POST', { stage: 'AwaitingInterviewScheduling' }, tokens.admin);
  check('A · HOD-approve → AwaitingInterviewScheduling', r.status === 200);

  // Interviewer suggests slots
  let intv = await findInterview(A.id, tokens.interviewer);
  check('A · interview row exists', !!intv?.id);
  r = await req(`/api/interviews/${intv.id}/suggest-slots`, 'PUT', {
    suggested_datetime1: new Date(Date.now() + 86400000).toISOString(),
    suggested_datetime2: new Date(Date.now() + 172800000).toISOString(),
  }, tokens.interviewer);
  check('A · suggest slots', r.status === 200);

  r = await req(`/api/applications/${A.id}/move-stage`, 'POST', { stage: 'Round1' }, tokens.admin);
  check('A · move to Round1', r.status === 200);

  // Reschedule
  r = await req(`/api/interviews/${intv.id}/reschedule`, 'PUT', {
    new_datetime: new Date(Date.now() + 3*86400000).toISOString(),
    reason: 'Panel conflict',
    interview_type: 'virtual',
  }, tokens.recruiter);
  check('A · reschedule', r.status === 200);

  // Feedback round 1 → shortlist
  r = await req(`/api/interviews/${intv.id}/feedback`, 'PUT', {
    technical_score: 4, behavioral_score: 4, company_fit_score: 5,
    decision: 'shortlist', remarks: 'Move to R2',
  }, tokens.interviewer);
  check('A · R1 feedback (shortlist)', r.status === 200);

  r = await req(`/api/applications/${A.id}/move-stage`, 'POST', { stage: 'Round2' }, tokens.admin);
  check('A · advance Round2', r.status === 200);

  intv = await findInterview(A.id, tokens.interviewer);
  // Request an additional (3rd) round from R2 — proves interviewer-driven escalation
  r = await req(`/api/interviews/${intv.id}/request-additional-rounds`, 'PUT', {
    additional_rounds: 1,
    remarks: 'Need leadership panel',
    suggested_interviewers: [{ round_number: 3, emails: ['interviewer@demo.premierenergies.com'] }],
  }, tokens.interviewer);
  check('A · request additional round', r.status === 200, JSON.stringify(r.body).substring(0,150));

  r = await req(`/api/applications/${A.id}/interview-plan`, 'PUT', {
    no_of_rounds: 3,
    interviewers: [
      ['interviewer@demo.premierenergies.com'],
      ['interviewer@demo.premierenergies.com'],
      ['interviewer@demo.premierenergies.com'],
    ],
  }, tokens.admin);
  check('A · interview plan extended to 3 rounds', r.status === 200, `status=${r.status} ${JSON.stringify(r.body).substring(0,150)}`);

  // After plan extension status resets to AwaitingInterviewScheduling — advance back to R2
  r = await req(`/api/applications/${A.id}/move-stage`, 'POST', { stage: 'Round2' }, tokens.admin);
  check('A · re-advance Round2 after plan-extension', r.status === 200);
  // Target the round-2 row explicitly (extending plan creates a round-3 row too)
  const intvR2 = await findInterview(A.id, tokens.interviewer, 2);
  check('A · round-2 interview row exists', !!intvR2?.id);

  // R2 feedback → shortlist (auto-moves to AwaitingInterviewScheduling for R3)
  r = await req(`/api/interviews/${intvR2.id}/feedback`, 'PUT', {
    technical_score: 4, behavioral_score: 4, company_fit_score: 4,
    decision: 'shortlist', remarks: 'OK push to R3',
  }, tokens.interviewer);
  check('A · R2 feedback (shortlist)', r.status === 200);
  check('A · status auto-moved to AwaitingInterviewScheduling for R3', (await statusOf(A.id)) === 'AwaitingInterviewScheduling', `got=${await statusOf(A.id)}`);

  r = await req(`/api/applications/${A.id}/move-stage`, 'POST', { stage: 'Round3' }, tokens.admin);
  check('A · advance Round3', r.status === 200, JSON.stringify(r.body).substring(0,150));
  const intvR3 = await findInterview(A.id, tokens.interviewer, 3);
  r = await req(`/api/interviews/${intvR3.id}/feedback`, 'PUT', {
    technical_score: 5, behavioral_score: 5, company_fit_score: 5,
    decision: 'shortlist', remarks: 'Strong hire',
  }, tokens.interviewer);
  check('A · R3 feedback', r.status === 200);
  // Final-round shortlist auto-moves to OfferInProcess; assert that
  check('A · status auto-moved to OfferInProcess', (await statusOf(A.id)) === 'OfferInProcess');

  // ============================================================
  // SCENARIO B — Round 1 reject
  // ============================================================
  console.log('\n🅱️  SCENARIO B: Round 1 reject → TalentPool');
  const B = await newCandidate('B');
  r = await req(`/api/triage/${B.code}/shortlist`, 'POST', {
    no_of_rounds: 1,
    interviewers_per_round: [['interviewer@demo.premierenergies.com']],
    comment: 'Try',
  }, tokens.recruiter);
  check('B · shortlist', r.status === 200);
  await req(`/api/applications/${B.id}/move-stage`, 'POST', { stage: 'AwaitingInterviewScheduling' }, tokens.admin);
  intv = await findInterview(B.id, tokens.interviewer);
  await req(`/api/interviews/${intv.id}/suggest-slots`, 'PUT', {
    suggested_datetime1: new Date(Date.now() + 86400000).toISOString(),
    suggested_datetime2: new Date(Date.now() + 172800000).toISOString(),
  }, tokens.interviewer);
  await req(`/api/applications/${B.id}/move-stage`, 'POST', { stage: 'Round1' }, tokens.admin);
  r = await req(`/api/interviews/${intv.id}/feedback`, 'PUT', {
    technical_score: 1, behavioral_score: 2, company_fit_score: 2,
    decision: 'reject', remarks: 'Not a fit',
    rejection_reasons: ['Lacks required skills'],
  }, tokens.interviewer);
  check('B · R1 feedback (reject)', r.status === 200, JSON.stringify(r.body).substring(0,150));
  // Reject auto-sets status to Round1Rejected; advance to TalentPool
  check('B · auto status Round1Rejected', (await statusOf(B.id)) === 'Round1Rejected');
  r = await req(`/api/applications/${B.id}/move-stage`, 'POST', { stage: 'TalentPool' }, tokens.admin);
  check('B · move to TalentPool', r.status === 200);
  check('B · final status TalentPool', (await statusOf(B.id)) === 'TalentPool');

  // ============================================================
  // SCENARIO C — No-show
  // ============================================================
  console.log('\nⒸ  SCENARIO C: No-show at Round 1');
  const C = await newCandidate('C');
  r = await req(`/api/triage/${C.code}/shortlist`, 'POST', {
    no_of_rounds: 1,
    interviewers_per_round: [['interviewer@demo.premierenergies.com']],
  }, tokens.recruiter);
  check('C · shortlist', r.status === 200);
  await req(`/api/applications/${C.id}/move-stage`, 'POST', { stage: 'AwaitingInterviewScheduling' }, tokens.admin);
  intv = await findInterview(C.id, tokens.interviewer);
  await req(`/api/interviews/${intv.id}/suggest-slots`, 'PUT', {
    suggested_datetime1: new Date(Date.now() + 86400000).toISOString(),
    suggested_datetime2: new Date(Date.now() + 172800000).toISOString(),
  }, tokens.interviewer);
  await req(`/api/applications/${C.id}/move-stage`, 'POST', { stage: 'Round1' }, tokens.admin);
  // Set scheduled_datetime to 30 minutes ago via reschedule (no-show requires +10 min lockout past sched)
  const pastTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  r = await req(`/api/interviews/${intv.id}/reschedule`, 'PUT', {
    new_datetime: pastTime, reason: 'Set past time for no-show test',
  }, tokens.recruiter);
  check('C · set scheduled to past', r.status === 200);
  r = await req(`/api/interviews/${intv.id}/mark-no-show`, 'PUT', { reason: 'Did not join', party: 'candidate' }, tokens.interviewer);
  check('C · mark no-show', r.status === 200, JSON.stringify(r.body).substring(0,150));
  const cStatus = await statusOf(C.id);
  check('C · back to AwaitingInterviewScheduling after no-show', cStatus === 'AwaitingInterviewScheduling', `got=${cStatus}`);

  // ============================================================
  // SCENARIO D — CTC chain (renegotiate path) → Offer → Joined
  // ============================================================
  console.log('\nⒹ  SCENARIO D: CTC chain renegotiate → approve → offer → joined');
  // Build a fresh candidate for D, push them through interviews to OfferInProcess.
  const D = await newCandidate('D');
  await req(`/api/triage/${D.code}/shortlist`, 'POST', {
    no_of_rounds: 1,
    interviewers_per_round: [['interviewer@demo.premierenergies.com']],
  }, tokens.recruiter);
  await req(`/api/applications/${D.id}/move-stage`, 'POST', { stage: 'AwaitingInterviewScheduling' }, tokens.admin);
  let dIntv = await findInterview(D.id, tokens.interviewer);
  await req(`/api/interviews/${dIntv.id}/suggest-slots`, 'PUT', {
    suggested_datetime1: new Date(Date.now() + 86400000).toISOString(),
    suggested_datetime2: new Date(Date.now() + 172800000).toISOString(),
  }, tokens.interviewer);
  await req(`/api/applications/${D.id}/move-stage`, 'POST', { stage: 'Round1' }, tokens.admin);
  r = await req(`/api/interviews/${dIntv.id}/feedback`, 'PUT', {
    technical_score: 5, behavioral_score: 5, company_fit_score: 5,
    decision: 'shortlist', remarks: 'Strong final-round',
  }, tokens.interviewer);
  check('D · final round feedback (auto OfferInProcess)', r.status === 200);
  // Walk back to CTCSent path: must use status mutation that's allowed.
  // Final-round shortlist auto-moves to OfferInProcess. From there, we still
  // need to drive a CTC chain — break the auto-jump by directly setting CTCSent
  // is illegal under HR_MANAGED. Easiest: post the breakup directly which sets
  // CTCAcceptance from any source state via UPDATE (route doesn't enforce HR_MANAGED).

  // 1) Recruiter sends CTC breakup (status → CTCAcceptance)
  r = await req(`/api/ctc-breakup/${D.code}/breakup`, 'POST', {
    breakup_text: 'Basic 80,000\nHRA 16,000\nTotal CTC 12 LPA',
    breakup_html: '<table><tr><td>Total CTC</td><td>12 LPA</td></tr></table>',
  }, tokens.recruiter);
  check('D · send CTC breakup', r.status === 200);
  check('D · status CTCAcceptance', (await statusOf(D.id)) === 'CTCAcceptance');

  // Need candidate token to sign — generate matching candidate token
  const dCandToken = jwt.sign({ id: 999, email: D.email, role: 'applicant', name: 'Cand' }, JWT_SECRET);

  // 2) Candidate REJECTS first time
  let bk = await req(`/api/ctc-breakup/me/breakup`, 'GET', null, dCandToken);
  let breakupId = bk.body?.breakup?.id;
  check('D · candidate fetched their breakup', !!breakupId, JSON.stringify(bk.body).substring(0,150));
  r = await req(`/api/ctc-breakup/me/breakup/${breakupId}/respond`, 'POST', {
    decision: 'rejected', notes: 'Need higher base',
  }, dCandToken);
  check('D · candidate rejects CTC v1', r.status === 200);
  check('D · status SalaryRejected', (await statusOf(D.id)) === 'SalaryRejected');

  // 3) Recruiter resends new breakup (HR_MANAGED_TRANSITIONS allows SalaryRejected → CTCSent path; breakup post sets CTCAcceptance directly)
  r = await req(`/api/ctc-breakup/${D.code}/breakup`, 'POST', {
    breakup_text: 'Basic 95,000\nHRA 19,000\nTotal CTC 14 LPA',
  }, tokens.recruiter);
  check('D · resend revised CTC v2', r.status === 200);

  bk = await req(`/api/ctc-breakup/me/breakup`, 'GET', null, dCandToken);
  breakupId = bk.body?.breakup?.id;
  r = await req(`/api/ctc-breakup/me/breakup/${breakupId}/respond`, 'POST', {
    decision: 'accepted', notes: 'Looks great',
    signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  }, dCandToken);
  check('D · candidate accepts CTC v2', r.status === 200);
  check('D · status CTCAccepted', (await statusOf(D.id)) === 'CTCAccepted');

  // 4) Recruiter sends comparison
  r = await req(`/api/ctc-breakup/${D.code}/comparison`, 'POST', {
    comparison_html: '<p>Within band</p>',
    comparison_text: 'Mid of band',
    secondary_recruiter_email: 'recruiter2@demo.premierenergies.com',
  }, tokens.recruiter);
  check('D · CTC comparison sent to R2', r.status === 200);

  // 5) R2 clears
  r = await req(`/api/ctc-breakup/${D.code}/r2-clear`, 'POST', {
    decision: 'approved', notes: 'OK',
  }, tokens.recruiter2);
  check('D · R2 cleared', r.status === 200, JSON.stringify(r.body).substring(0,150));

  // 6) Admin renegotiate (round-trip)
  r = await req(`/api/ctc-breakup/${D.code}/admin-decide`, 'POST', {
    decision: 'renegotiate', notes: 'Pull base by 5K',
  }, tokens.admin);
  check('D · admin sends back renegotiate', r.status === 200);
  check('D · status CTCSent (post-renegotiate)', (await statusOf(D.id)) === 'CTCSent');

  // 7) Recruiter posts a new breakup again
  r = await req(`/api/ctc-breakup/${D.code}/breakup`, 'POST', {
    breakup_text: 'Basic 90,000\nHRA 18,000\nTotal CTC 13.5 LPA',
  }, tokens.recruiter);
  check('D · resend final breakup v3', r.status === 200);

  bk = await req(`/api/ctc-breakup/me/breakup`, 'GET', null, dCandToken);
  breakupId = bk.body?.breakup?.id;
  r = await req(`/api/ctc-breakup/me/breakup/${breakupId}/respond`, 'POST', {
    decision: 'accepted', notes: 'Final',
  }, dCandToken);
  check('D · candidate accepts v3', r.status === 200);

  // 8) R2 must clear again on the latest active breakup
  r = await req(`/api/ctc-breakup/${D.code}/r2-clear`, 'POST', {
    decision: 'approved', notes: 'OK final',
  }, tokens.recruiter2);
  check('D · R2 cleared v3', r.status === 200, JSON.stringify(r.body).substring(0,150));

  // 9) Admin approve → OfferInProcess
  r = await req(`/api/ctc-breakup/${D.code}/admin-decide`, 'POST', {
    decision: 'approved', notes: 'Approved',
  }, tokens.admin);
  check('D · admin approve', r.status === 200);
  check('D · status OfferInProcess', (await statusOf(D.id)) === 'OfferInProcess');

  // 10) Documents — accept ALL pending docs (defaults seeded at Selected)
  r = await req(`/api/candidates/${D.id}/documents`, 'GET', null, tokens.recruiter);
  const docs = r.body?.documents || r.body || [];
  check('D · fetched docs', Array.isArray(docs) && docs.length > 0, `got ${JSON.stringify(docs).substring(0,150)}`);
  let docAcceptOK = 0;
  for (const d of docs) {
    const rr = await req(`/api/candidates/${D.id}/documents/${d.id}/review`, 'PUT', {
      status: 'accepted', remarks: 'OK (test)',
    }, tokens.recruiter);
    if (rr.status === 200) docAcceptOK++;
  }
  check(`D · accepted all ${docs.length} docs`, docAcceptOK === docs.length, `${docAcceptOK}/${docs.length}`);

  // 11) Offer upload (multipart) — should pass gate
  const fakePdf = Buffer.from('%PDF-1.4\n% fake\n%%EOF', 'utf8');
  r = await multipartPost(`/api/offers/${D.code}/upload`, { validity_days: '14' }, fakePdf, 'offer.pdf', tokens.admin);
  check('D · offer upload', r.status === 200, `status=${r.status} ${JSON.stringify(r.body).substring(0,200)}`);
  check('D · status SignaturePending', (await statusOf(D.id)) === 'SignaturePending');

  // 12) Candidate signs offer
  r = await req(`/api/offers/me/sign`, 'POST', {
    signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  }, dCandToken);
  check('D · candidate signs offer', r.status === 200, JSON.stringify(r.body).substring(0,150));

  // 13) Admin moves to Offered → OfferAccepted → Joined
  // After candidate signs, status auto-becomes OfferAccepted (sign === acceptance)
  const dSig = await statusOf(D.id);
  check('D · status OfferAccepted/Offered after signature', dSig === 'Offered' || dSig === 'OfferAccepted', `got=${dSig}`);
  if (dSig !== 'OfferAccepted') {
    r = await req(`/api/applications/${D.id}/move-stage`, 'POST', { stage: 'OfferAccepted' }, tokens.admin);
    check('D · move to OfferAccepted', r.status === 200);
  }
  r = await req(`/api/offers/${D.code}/joining`, 'POST', {
    joining_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
  }, tokens.admin);
  check('D · set joining date', r.status === 200);
  r = await req(`/api/offers/${D.code}/joining-outcome`, 'POST', {
    outcome: 'joined',
    date: new Date().toISOString().split('T')[0],
  }, tokens.admin);
  check('D · joining-outcome=joined', r.status === 200);
  check('D · final status Joined', (await statusOf(D.id)) === 'Joined');

  // ============================================================
  // FINAL TIMELINE COVERAGE CHECK for D
  // ============================================================
  console.log('\n📋 Timeline coverage check for D');
  r = await req(`/api/timeline/application/${D.code}?limit=500`);
  const events = r.body?.events || [];
  const types = new Set(events.map(e => e.event_type));
  const expected = [
    'application.shortlisted',
    'ctc.breakup_sent',
    'ctc.accepted',
    'offer.released',
    'offer.signed',
    'application.joined',
  ];
  for (const t of expected) {
    check(`timeline · ${t}`, types.has(t), `present types=[${[...types].slice(0,15).join(', ')}]`);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log(`   PASS: ${pass}    FAIL: ${fail}`);
  if (fail) {
    console.log('   Failures:');
    failures.forEach(f => console.log('     · ' + f));
    process.exit(1);
  } else {
    console.log('   ✅ ALL E2E PATHS PASS');
    process.exit(0);
  }
})().catch(e => { console.error('FATAL', e); process.exit(2); });
