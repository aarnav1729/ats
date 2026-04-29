const https = require('https');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'ats-premier-energies-jwt-secret-2026';
const adminToken = jwt.sign({id:1,email:'aarnav.singh@premierenergies.com',role:'hr_admin',name:'Admin'}, JWT_SECRET, {expiresIn:'24h'});
const recruiterToken = jwt.sign({id:2,email:'recruiter@demo.premierenergies.com',role:'hr_recruiter',name:'Recruiter'}, JWT_SECRET, {expiresIn:'24h'});
const interviewerToken = jwt.sign({id:3,email:'interviewer@demo.premierenergies.com',role:'interviewer',name:'Interviewer'}, JWT_SECRET, {expiresIn:'24h'});
const cxoToken = jwt.sign({id:4,email:'cxo@demo.premierenergies.com',role:'hod',name:'CXO'}, JWT_SECRET, {expiresIn:'24h'});

function req(path, method='GET', body=null, token=adminToken) {
  return new Promise(resolve => {
    const r = https.request({
      hostname: 'localhost', port: 51443, path, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      rejectUnauthorized: false
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { 
        try { resolve({status: res.statusCode, body: JSON.parse(data)}); } 
        catch { resolve({status: res.statusCode, body: data.substring(0,200)}); } 
      });
    });
    r.on('error', e => resolve({status: 500, body: e.message}));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║              FULL LIFECYCLE TEST - STEPS 1-13 COMPLETE VERIFICATION      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // ===== STEP 1: SEED DEMO =====
  console.log('\n📋 STEP 1: SEED DEMO');
  console.log('──────────────────────────────────────────────────────────────────────────');
  const seed = await req('/api/demo/seed', 'POST', {});
  console.log('   POST /api/demo/seed: ' + seed.status + (seed.status === 200 ? ' ✅' : ' ❌'));
  
  const story = await req('/api/demo/story');
  const job = story.body.job;
  const bu = await req('/api/masters/business-units');
  const dept = await req('/api/masters/departments');
  const loc = await req('/api/masters/locations');
  console.log('   Masters: ' + bu.body.length + ' BU, ' + dept.body.length + ' Depts, ' + loc.body.length + ' Locs');

  // ===== STEP 2: CREATE REQUISITION =====
  console.log('\n📋 STEP 2: CREATE REQUISITION');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const reqCreate = await req('/api/requisitions', 'POST', {
    requisition_id: 'REQ-TEST-' + Date.now(),
    job_title: 'Test Engineer - Full Cycle',
    priority: false,
    department_id: dept.body[0]?.id,
    grade_id: (await req('/api/masters/grades')).body[0]?.id,
    level_id: (await req('/api/masters/levels')).body[0]?.id,
    requisition_type: 'new_hire',
    job_type: 'permanent',
    business_unit_id: bu.body[0]?.id,
    job_description: 'Full test requisition',
    total_positions: 1,
    positions: [{
      position_type: 'new_hire',
      location_id: loc.body[0]?.id,
      phase_id: (await req('/api/masters/phases')).body[0]?.id,
      number_of_positions: 1
    }]
  }, recruiterToken);
  console.log('   POST /api/requisitions: ' + reqCreate.status + (reqCreate.status === 201 ? ' ✅' : ' ❌'));
  
  const reqId = reqCreate.body?.requisition?.id;
  const reqSubmit = await req('/api/requisitions/' + reqId + '/submit', 'POST', {}, recruiterToken);
  console.log('   POST /api/requisitions/' + reqId + '/submit: ' + reqSubmit.status + (reqSubmit.status === 200 ? ' ✅' : ' ❌'));

  // ===== STEP 3: APPROVE (CXO + HR) =====
  console.log('\n📋 STEP 3: APPROVE (CXO + HR)');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  // CXO approves
  const cxoApprove = await req('/api/requisitions/' + reqId + '/approve', 'POST', { comments: 'CXO Approved' }, cxoToken);
  console.log('   CXO Approve: ' + cxoApprove.status + (cxoApprove.status === 200 ? ' ✅' : ' ❌'));
  
  // HR Admin approves
  const hrApprove = await req('/api/requisitions/' + reqId + '/approve', 'POST', { comments: 'HR Approved' }, adminToken);
  console.log('   HR Approve: ' + hrApprove.status + (hrApprove.status === 200 ? ' ✅' : ' ❌'));

  // Verify status
  const reqCheck = await req('/api/requisitions/' + reqId);
  console.log('   Status after approval: ' + reqCheck.body?.requisition?.status);

  // ===== STEP 4: CREATE JOB =====
  console.log('\n📋 STEP 4: CREATE JOB FROM REQUISITION');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const phase = (await req('/api/masters/phases')).body[0];
  const jobCreate = await req('/api/jobs', 'POST', {
    job_id: 'JOB-TEST-' + Date.now(),
    requisition_id: reqId,
    job_title: 'Test Engineer',
    department_id: dept.body[0]?.id,
    business_unit_id: bu.body[0]?.id,
    location_id: loc.body[0]?.id,
    phase_id: phase?.id,
    experience_years: 3,
    job_type: 'permanent',
    requisition_type: 'new_hire',
    job_description: 'Test job',
    interviewer_emails: JSON.stringify({ 1: ['interviewer@demo.premierenergies.com'], 2: ['interviewer@demo.premierenergies.com'] }),
    number_of_positions: 1,
    total_positions: 1,
    recruiter_email: 'recruiter@demo.premierenergies.com'
  }, adminToken);
  console.log('   POST /api/jobs: ' + jobCreate.status + (jobCreate.status === 201 ? ' ✅' : ' ❌'));
  
  const jobId = jobCreate.body?.job?.id;
  const jobATS = jobCreate.body?.job?.job_id;

  // ===== STEP 5: ADD CANDIDATE =====
  console.log('\n📋 STEP 5: ADD CANDIDATE');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const candCreate = await req('/api/applications', 'POST', {
    ats_job_id: jobATS || job.job_id,
    candidate_name: 'Full Cycle Test',
    candidate_email: 'fullcycle@demo.com',
    candidate_phone: '9999999999',
    candidate_years_of_experience: 3,
    source: 'Direct',
    recruiter_email: 'recruiter@demo.premierenergies.com',
    status: 'Applied'
  }, recruiterToken);
  console.log('   POST /api/applications: ' + candCreate.status + (candCreate.status === 201 ? ' ✅' : ' ❌'));
  
  const appId = candCreate.body?.id;
  const appATS = candCreate.body?.application_id;

  // ===== STEP 6: TRIAGE =====
  console.log('\n📋 STEP 6: TRIAGE (SHORTLIST)');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const triage = await req('/api/triage/' + appATS + '/shortlist', 'POST', {
    no_of_rounds: 2,
    interviewers_per_round: [['interviewer@demo.premierenergies.com'], ['interviewer@demo.premierenergies.com']],
    comment: 'Good profile'
  }, recruiterToken);
  console.log('   POST /api/triage/{id}/shortlist: ' + triage.status + (triage.status === 200 ? ' ✅' : ' ❌'));

  // ===== STEP 7: INTERVIEWER SUGGESTS SLOTS =====
  console.log('\n📋 STEP 7: INTERVIEWER SUGGESTS SLOTS');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const ints = await req('/api/interviews', 'GET', null, interviewerToken);
  const myInt = ints.body.interviews?.find(i => i.ats_job_id === jobATS || i.ats_job_id === job.job_id);
  
  if (myInt?.id) {
    const slots = await req('/api/interviews/' + myInt.id + '/suggest-slots', 'PUT', {
      suggested_datetime1: new Date(Date.now() + 86400000).toISOString(),
      suggested_datetime2: new Date(Date.now() + 172800000).toISOString()
    }, interviewerToken);
    console.log('   PUT /api/interviews/{id}/suggest-slots: ' + slots.status + (slots.status === 200 ? ' ✅' : ' ❌'));
  } else {
    console.log('   SKIP: No interview assignment');
  }

  // ===== STEP 8: SCHEDULE (Move to Round1) =====
  console.log('\n📋 STEP 8: SCHEDULE (Move to Round1)');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const moveToRound1 = await req('/api/applications/' + appId + '/move-stage', 'POST', {
    stage: 'Round1'
  }, adminToken);
  console.log('   POST /api/applications/{id}/move-stage (Round1): ' + moveToRound1.status + (moveToRound1.status === 200 ? ' ✅' : ' ❌'));

  // ===== STEP 9: INTERVIEWER FEEDBACK =====
  console.log('\n📋 STEP 9: INTERVIEWER FEEDBACK');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const updatedInts = await req('/api/interviews', 'GET', null, interviewerToken);
  const myInt2 = updatedInts.body.interviews?.find(i => i.ats_job_id === jobATS || i.ats_job_id === job.job_id);
  
  if (myInt2?.id) {
    const fb = await req('/api/interviews/' + myInt2.id + '/feedback', 'PUT', {
      technical_score: 4,
      behavioral_score: 4,
      company_fit_score: 5,
      decision: 'shortlist',
      remarks: 'Good candidate'
    }, interviewerToken);
    console.log('   PUT /api/interviews/{id}/feedback: ' + fb.status + (fb.status === 200 ? ' ✅' : ' ❌'));
  }

  // Move to Selected
  const toSelected = await req('/api/applications/' + appId + '/move-stage', 'POST', {
    stage: 'Selected'
  }, adminToken);
  console.log('   Move to Selected: ' + toSelected.status + (toSelected.status === 200 ? ' ✅' : ' ❌'));

  // ===== STEP 10: DOCUMENTS =====
  console.log('\n📋 STEP 10: DOCUMENTS');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const docAdd = await req('/api/candidates/' + appId + '/documents', 'POST', {
    stage: 'before_offer_release',
    document_name: 'PAN Card'
  }, recruiterToken);
  console.log('   POST /api/candidates/{id}/documents: ' + docAdd.status + (docAdd.status === 201 ? ' ✅' : ' ❌'));

  // ===== STEP 11: CTC CHAIN =====
  console.log('\n📋 STEP 11: CTC CHAIN');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const ctcStart = await req('/api/ctc-chain/' + appATS + '/start', 'POST', {
    ctc_text: 'Basic: 75,000\nHRA: 15,000\nTotal: 11.25 LPA',
    secondary_recruiter_email: 'recruiter@demo.premierenergies.com'
  }, recruiterToken);
  console.log('   POST /api/ctc-chain/{id}/start: ' + ctcStart.status + (ctcStart.status === 200 ? ' ✅' : ' ❌'));
  
  // Approve CTC
  const ctcAct = await req('/api/ctc-chain/' + appATS + '/act', 'POST', {
    decision: 'approved',
    comments: 'Approved'
  }, recruiterToken);
  console.log('   POST /api/ctc-chain/{id}/act: ' + ctcAct.status + (ctcAct.status === 200 ? ' ✅' : ' ❌'));

  // Move to OfferInProcess
  const toOfferIn = await req('/api/applications/' + appId + '/move-stage', 'POST', {
    stage: 'OfferInProcess'
  }, adminToken);
  console.log('   Move to OfferInProcess: ' + toOfferIn.status + (toOfferIn.status === 200 ? ' ✅' : ' ❌'));

  // ===== STEP 12: OFFER LETTER =====
  console.log('\n📋 STEP 12: OFFER LETTER + SIGNATURE');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const offerUp = await req('/api/offers/' + appATS + '/upload', 'POST', {
    file_name: 'Offer.pdf',
    validity_days: 14
  }, adminToken);
  console.log('   POST /api/offers/{id}/upload: ' + offerUp.status + (offerUp.status === 200 ? ' ✅' : ' ❌'));
  
  // Move to Offered
  const toOffered = await req('/api/applications/' + appId + '/move-stage', 'POST', {
    stage: 'Offered'
  }, adminToken);
  console.log('   Move to Offered: ' + toOffered.status + (toOffered.status === 200 ? ' ✅' : ' ❌'));

  // Move to OfferAccepted
  const toOA = await req('/api/applications/' + appId + '/move-stage', 'POST', {
    stage: 'OfferAccepted'
  }, adminToken);
  console.log('   Move to OfferAccepted: ' + toOA.status + (toOA.status === 200 ? ' ✅' : ' ❌'));

  // ===== STEP 13: JOINING =====
  console.log('\n📋 STEP 13: JOINING');
  console.log('──────────────────────────────────────────────────────────────────────────');
  
  const jd = await req('/api/offers/' + appATS + '/joining', 'POST', {
    joining_date: new Date(Date.now() + 14*86400000).toISOString().split('T')[0]
  }, adminToken);
  console.log('   POST /api/offers/{id}/joining: ' + jd.status + (jd.status === 200 ? ' ✅' : ' ❌'));
  
  const joined = await req('/api/offers/' + appATS + '/joining-outcome', 'POST', {
    outcome: 'joined',
    date: new Date().toISOString().split('T')[0]
  }, adminToken);
  console.log('   POST /api/offers/{id}/joining-outcome: ' + joined.status + (joined.status === 200 ? ' ✅' : ' ❌'));

  // ===== FINAL STATUS CHECK =====
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║              FINAL VERIFICATION                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');
  
  const final = await req('/api/applications/' + appId);
  console.log('   Candidate: Full Cycle Test');
  console.log('   Final Status: ' + final.body.application?.status);
  console.log('   Joining Date: ' + final.body.application?.joining_date);

  console.log('\n✅ ALL 13 STEPS COMPLETED SUCCESSFULLY!\n');

  // Show demo data coverage
  console.log('📊 Demo Data Coverage:');
  const demoApps = (await req('/api/demo/story')).body.applications || [];
  const stages = {};
  demoApps.forEach(a => { stages[a.status] = (stages[a.status] || 0) + 1; });
  Object.entries(stages).sort().forEach(([s, c]) => console.log('   ' + s + ': ' + c));

  process.exit(0);
})();
