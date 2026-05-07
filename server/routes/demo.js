import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
const adminOnly = requireRole('hr_admin');
const DEMO_OWNER = 'demo.seed@premierenergies.com';
const DEMO_EMAIL_DOMAIN = '@demo.premierenergies.com';

async function buildDemoStory(client) {
  const [requisitionResult, jobResult, applicationsResult, docsResult] = await Promise.all([
    client.query(
      `SELECT id, requisition_id, job_title, status, created_at
       FROM requisitions
       WHERE created_by = $1
       ORDER BY created_at DESC`,
      [DEMO_OWNER]
    ),
    client.query(
      `SELECT id, job_id, job_title, status, created_at
       FROM jobs
       WHERE created_by = $1
       ORDER BY created_at DESC`,
      [DEMO_OWNER]
    ),
    client.query(
      `SELECT id, application_id, candidate_name, candidate_email, status, ats_job_id, created_at, updated_at
       FROM applications
       WHERE created_by = $1 OR candidate_email LIKE $2
       ORDER BY created_at ASC`,
      [DEMO_OWNER, `%${DEMO_EMAIL_DOMAIN}`]
    ),
    client.query(
      `SELECT cd.application_id, cd.document_name, cd.stage, cd.status
       FROM candidate_documents cd
       JOIN applications a ON cd.application_id = a.id
       WHERE a.created_by = $1 OR a.candidate_email LIKE $2
       ORDER BY cd.created_at ASC`,
      [DEMO_OWNER, `%${DEMO_EMAIL_DOMAIN}`]
    ),
  ]);

  const requisition = requisitionResult.rows[0] || null;
  const job = jobResult.rows[0] || null;
  const applications = applicationsResult.rows;
  const documentsByApplication = docsResult.rows.reduce((acc, row) => {
    const key = String(row.application_id);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const byStatus = Object.fromEntries(
    applications.map((row) => [
      row.status,
      {
        id: row.id,
        application_id: row.application_id,
        candidate_name: row.candidate_name,
        status: row.status,
        route: `/applications/${row.id}/workflow`,
      },
    ])
  );

  return {
    requisition: requisition ? {
      ...requisition,
      route: `/requisitions/${requisition.id}`,
    } : null,
    job: job ? {
      ...job,
      route: `/jobs/${job.id}`,
      public_route: `/careers/${job.id}`,
    } : null,
    applications: applications.map((row) => ({
      ...row,
      route: `/applications/${row.id}/workflow`,
      documents: documentsByApplication[String(row.id)] || [],
    })),
    stage_map: byStatus,
  };
}

function buildHrOneJobIds(jobId, totalPositions) {
  return Array.from({ length: totalPositions }, (_, index) =>
    `${jobId}-${String(index + 1).padStart(2, '0')}`
  );
}

async function ensureBusinessUnit(client, buName, buShortName) {
  const existing = await client.query(
    'SELECT * FROM business_units WHERE bu_short_name = $1 LIMIT 1',
    [buShortName]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO business_units (bu_name, bu_short_name, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [buName, buShortName]
  );
  return inserted.rows[0];
}

async function ensureDepartment(client, departmentName) {
  const existing = await client.query(
    'SELECT * FROM departments WHERE department_name = $1 LIMIT 1',
    [departmentName]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO departments (department_name, active_flag)
     VALUES ($1, true)
     RETURNING *`,
    [departmentName]
  );
  return inserted.rows[0];
}

async function ensureSubDepartment(client, departmentName, subDepartmentName) {
  const existing = await client.query(
    `SELECT * FROM sub_departments
     WHERE department_name = $1 AND sub_department_name = $2
     LIMIT 1`,
    [departmentName, subDepartmentName]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO sub_departments (department_name, sub_department_name, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [departmentName, subDepartmentName]
  );
  return inserted.rows[0];
}

async function ensureLocation(client, buShortName, locationName) {
  const existing = await client.query(
    `SELECT * FROM locations
     WHERE bu_short_name = $1 AND location_name = $2
     LIMIT 1`,
    [buShortName, locationName]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO locations (bu_short_name, location_name, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [buShortName, locationName]
  );
  return inserted.rows[0];
}

async function ensurePhase(client, locationName, phaseName) {
  const existing = await client.query(
    `SELECT * FROM phases
     WHERE location_name = $1 AND phase_name = $2
     LIMIT 1`,
    [locationName, phaseName]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO phases (location_name, phase_name, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [locationName, phaseName]
  );
  return inserted.rows[0];
}

async function ensureGrade(client, grade, description) {
  const existing = await client.query('SELECT * FROM grades WHERE grade = $1 LIMIT 1', [grade]);
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO grades (grade, description, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [grade, description]
  );
  return inserted.rows[0];
}

async function ensureLevel(client, level, description) {
  const existing = await client.query('SELECT * FROM levels WHERE level = $1 LIMIT 1', [level]);
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO levels (level, description, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [level, description]
  );
  return inserted.rows[0];
}

async function ensureDesignation(client, designation, jdTemplate) {
  const existing = await client.query(
    'SELECT * FROM designations WHERE designation = $1 LIMIT 1',
    [designation]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO designations (designation, jd_template, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [designation, jdTemplate]
  );
  return inserted.rows[0];
}

async function ensureBackfillReason(client, reason, preview) {
  const existing = await client.query(
    'SELECT * FROM backfill_reasons WHERE reason = $1 LIMIT 1',
    [reason]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO backfill_reasons (reason, reason_preview, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [reason, preview]
  );
  return inserted.rows[0];
}

async function ensureRejectionReason(client, reason, preview) {
  const existing = await client.query(
    'SELECT * FROM rejection_reasons WHERE reason = $1 LIMIT 1',
    [reason]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO rejection_reasons (reason, reason_preview, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [reason, preview]
  );
  return inserted.rows[0];
}

async function ensureDropoutReason(client, reason, preview) {
  const existing = await client.query(
    'SELECT * FROM offer_dropout_reasons WHERE reason = $1 LIMIT 1',
    [reason]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO offer_dropout_reasons (reason, reason_preview, active_flag)
     VALUES ($1, $2, true)
     RETURNING *`,
    [reason, preview]
  );
  return inserted.rows[0];
}

async function ensureUser(client, email, role, name) {
  const existing = await client.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);
  if (existing.rows[0]) {
    const updated = await client.query(
      `UPDATE users
       SET role = $1, name = $2, is_active = true, updated_at = NOW()
       WHERE email = $3
       RETURNING *`,
      [role, name, email]
    );
    return updated.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO users (email, role, name, is_active, is_default)
     VALUES ($1, $2, $3, true, false)
     RETURNING *`,
    [email, role, name]
  );
  return inserted.rows[0];
}

async function clearDemoData(client) {
  const demoApplications = await client.query(
    `SELECT id
     FROM applications
     WHERE created_by = $1 OR candidate_email LIKE $2`,
    [DEMO_OWNER, `%${DEMO_EMAIL_DOMAIN}`]
  );
  const applicationIds = demoApplications.rows.map((row) => row.id);

  const demoJobs = await client.query(
    `SELECT id
     FROM jobs
     WHERE created_by = $1`,
    [DEMO_OWNER]
  );
  const jobIds = demoJobs.rows.map((row) => row.id);

  const demoRequisitions = await client.query(
    `SELECT id
     FROM requisitions
     WHERE created_by = $1`,
    [DEMO_OWNER]
  );
  const requisitionIds = demoRequisitions.rows.map((row) => row.id);

  if (applicationIds.length > 0) {
    await client.query('DELETE FROM interview_feedback WHERE application_id = ANY($1::int[])', [applicationIds]);
    await client.query('DELETE FROM candidate_documents WHERE application_id = ANY($1::int[])', [applicationIds]);
    await client.query('DELETE FROM messages WHERE application_id = ANY($1::int[])', [applicationIds]);
  }

  await client.query(
    'DELETE FROM notifications WHERE user_email LIKE $1 OR user_email = $2',
    [`%${DEMO_EMAIL_DOMAIN}`, DEMO_OWNER]
  );
  await client.query(
    'DELETE FROM otps WHERE email LIKE $1 OR email = $2',
    [`%${DEMO_EMAIL_DOMAIN}`, DEMO_OWNER]
  );

  if (applicationIds.length > 0) {
    await client.query('DELETE FROM applications WHERE id = ANY($1::int[])', [applicationIds]);
    await client.query(
      `DELETE FROM audit_trail
       WHERE entity_type = 'application'
         AND entity_id = ANY($1::text[])`,
      [applicationIds.map(String)]
    );
  }

  if (jobIds.length > 0) {
    await client.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIds]);
    await client.query(
      `DELETE FROM audit_trail
       WHERE entity_type = 'job'
         AND entity_id = ANY($1::text[])`,
      [jobIds.map(String)]
    );
  }

  if (requisitionIds.length > 0) {
    await client.query('DELETE FROM requisitions WHERE id = ANY($1::int[])', [requisitionIds]);
    await client.query(
      `DELETE FROM audit_trail
       WHERE entity_type = 'requisition'
         AND entity_id = ANY($1::text[])`,
      [requisitionIds.map(String)]
    );
  }

  await client.query(
    `DELETE FROM audit_trail
     WHERE action_by = $1 OR action_by LIKE $2`,
    [DEMO_OWNER, `%${DEMO_EMAIL_DOMAIN}`]
  );

  await client.query(
    `DELETE FROM users
     WHERE email LIKE $1
       AND is_default = false`,
    [`%${DEMO_EMAIL_DOMAIN}`]
  );
}

router.post('/seed', adminOnly, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await clearDemoData(client);

    const businessUnit = await ensureBusinessUnit(client, 'Solar Modules', 'SMOD');
    const manufacturing = await ensureDepartment(client, 'Manufacturing');
    const quality = await ensureDepartment(client, 'Quality');
    const moduleProduction = await ensureSubDepartment(client, manufacturing.department_name, 'Module Production');
    const cellQuality = await ensureSubDepartment(client, quality.department_name, 'Cell Quality');
    const hyderabad = await ensureLocation(client, businessUnit.bu_short_name, 'Hyderabad Manufacturing Campus');
    const moduleAssembly = await ensurePhase(client, hyderabad.location_name, 'Module Assembly');
    const cellInspection = await ensurePhase(client, hyderabad.location_name, 'Cell Inspection');
    const grade = await ensureGrade(client, 'M6', 'Frontline manufacturing and process execution');
    const level = await ensureLevel(client, 'L3', 'Functional lead for line ownership');
    await ensureDesignation(
      client,
      'Shift Engineer - Module Assembly',
      `Role Summary
Lead the shift-level execution of solar module assembly at Premier Energies.

Key Responsibilities
- Own line readiness, manpower deployment, and output delivery for module assembly.
- Coordinate with quality and maintenance teams to reduce downtime and defects.
- Drive adherence to EHS, process discipline, and traceability requirements.

Required Qualifications
- Degree or diploma in electrical, mechanical, or production engineering.
- Experience in high-volume manufacturing operations.

Preferred Skills
- Solar module manufacturing exposure.
- Lean manufacturing and root cause analysis.`
    );
    await ensureDesignation(
      client,
      'Quality Engineer - Solar Cell',
      `Role Summary
Own process quality, defect containment, and continuous improvement for solar cell manufacturing.

Key Responsibilities
- Monitor line quality metrics and outgoing quality checks.
- Drive CAPA and yield improvement initiatives.

Required Qualifications
- Engineering background in quality, electrical, or mechanical domains.

Preferred Skills
- Solar cell manufacturing quality systems and statistical process control.`
    );

    const backfillReason = await ensureBackfillReason(client, 'Internal movement', 'Employee moved to another production line');
    await ensureRejectionReason(client, 'Role-fit mismatch', 'Candidate experience did not align with manufacturing scope');
    await ensureDropoutReason(client, 'Accepted counter offer', 'Candidate accepted a counter offer from current employer');

    const recruiter = await ensureUser(client, `recruiter${DEMO_EMAIL_DOMAIN}`, 'hr_recruiter', 'Demo Recruiter');
    const interviewer = await ensureUser(client, `interviewer${DEMO_EMAIL_DOMAIN}`, 'interviewer', 'Demo Interviewer');
    const hod = await ensureUser(client, `hod${DEMO_EMAIL_DOMAIN}`, 'hod', 'Demo HOD');
    await ensureUser(client, `applicant${DEMO_EMAIL_DOMAIN}`, 'applicant', 'Demo Applicant');

    await client.query(
      `INSERT INTO aop (business_unit_id, department_id, max_headcount, fiscal_year, active_flag)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (business_unit_id, department_id, fiscal_year)
       DO UPDATE SET max_headcount = EXCLUDED.max_headcount, active_flag = true, updated_at = NOW()`,
      [businessUnit.id, manufacturing.id, 180, new Date().getFullYear().toString()]
    );

    const requisitionResult = await client.query(
      `INSERT INTO requisitions (
          requisition_id,
          created_by,
          updated_by,
          job_title,
          priority,
          department_id,
          sub_department_id,
          experience_years,
          grade_id,
          level_id,
          requisition_type,
          job_type,
          business_unit_id,
          job_description,
          additional_comments,
          attachments,
          total_positions,
          status,
          active_flag
        ) VALUES (
          $1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true
        )
        RETURNING *`,
      [
        'SMOD-DEMO-001',
        DEMO_OWNER,
        DEMO_OWNER,
        'Shift Engineer - Module Assembly',
        manufacturing.id,
        moduleProduction.id,
        4,
        grade.id,
        level.id,
        'both',
        'permanent',
        businessUnit.id,
        `Own end-to-end execution of solar module assembly for Premier Energies with emphasis on throughput, safety, traceability, and first-pass yield.`,
        'Demo requisition seeded for workflow validation.',
        JSON.stringify(['shift-plan.xlsx', 'line-capacity-note.pdf']),
        3,
        'approved',
      ]
    );

    const requisition = requisitionResult.rows[0];

    await client.query(
      `INSERT INTO requisition_positions (
          requisition_id,
          position_type,
          location_id,
          phase_id,
          start_hire_date,
          target_hire_date,
          number_of_positions,
          backfill_employee_name,
          backfill_reason_id
        ) VALUES
        ($1, 'new_hire', $2, $3, CURRENT_DATE + INTERVAL '7 day', CURRENT_DATE + INTERVAL '35 day', 2, NULL, NULL),
        ($1, 'backfill', $2, $4, CURRENT_DATE + INTERVAL '5 day', CURRENT_DATE + INTERVAL '28 day', 1, 'Arun Kumar', $5)`,
      [requisition.id, hyderabad.id, moduleAssembly.id, cellInspection.id, backfillReason.id]
    );

    const jobResult = await client.query(
      `INSERT INTO jobs (
          job_id,
          requisition_id,
          status,
          job_title,
          department_id,
          sub_department_id,
          business_unit_id,
          location_id,
          phase_id,
          grade_id,
          level_id,
          experience_years,
          job_type,
          requisition_type,
          job_description,
          additional_comments,
          compensation_currency,
          compensation_min,
          compensation_max,
          reapply_days,
          hiring_flow,
          interviewer_emails,
          publish_to_careers,
          allow_employee_apply,
          allow_employee_refer,
          number_of_positions,
          hr_one_job_ids,
          recruiter_email,
          priority,
          total_positions,
          created_by,
          updated_by
        ) VALUES (
          $1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'INR',$16,$17,$18,
          $19,$20,true,true,true,$21,$22,$23,true,$21,$24,$24
        )
        RETURNING *`,
      [
        'ATS-DEMO-001',
        requisition.id,
        'Shift Engineer - Module Assembly',
        manufacturing.id,
        moduleProduction.id,
        businessUnit.id,
        hyderabad.id,
        moduleAssembly.id,
        grade.id,
        level.id,
        4,
        'permanent',
        'both',
        `Lead shift-level execution for solar module assembly lines with responsibility for output, yield, traceability, and coordination with quality and maintenance teams.`,
        'Demo job seeded for interviews, applications, and document workflows.',
        600000,
        900000,
        90,
        JSON.stringify(['Sourced', 'Screening', 'Interview Round 1', 'Interview Round 2', 'Interview Round 3', 'Preboarding', 'Hired', 'Archived']),
        JSON.stringify({
          2: interviewer.email,
          3: hod.email,
          4: interviewer.email,
        }),
        3,
        JSON.stringify(buildHrOneJobIds('ATS-DEMO-001', 3)),
        recruiter.email,
        DEMO_OWNER,
      ]
    );

    const job = jobResult.rows[0];

    const applicationSeeds = [
      ['ATS-DEMO-APP-001', 'InQueue', 'Ananya Rao', 'ananya'],
      ['ATS-DEMO-APP-002', 'Applied', 'Rahul Dev', 'rahul'],
      ['ATS-DEMO-APP-003', 'Shortlisted', 'Meghana Varma', 'meghana'],
      ['ATS-DEMO-APP-004', 'AwaitingHODResponse', 'Karthik Sai', 'karthik'],
      ['ATS-DEMO-APP-005', 'Round1', 'Nikhil Sharma', 'nikhil'],
      ['ATS-DEMO-APP-006', 'AwaitingFeedback', 'Lavanya Iyer', 'lavanya'],
      ['ATS-DEMO-APP-007', 'Selected', 'Sowmya Reddy', 'sowmya'],
      ['ATS-DEMO-APP-008', 'OfferInProcess', 'Harish Kumar', 'harish'],
      ['ATS-DEMO-APP-009', 'Offered', 'Pallavi Nair', 'pallavi'],
      ['ATS-DEMO-APP-010', 'OfferAccepted', 'Sanjay Menon', 'sanjay'],
      ['ATS-DEMO-APP-011', 'Joined', 'Arun Kumar', 'arun'],
      ['ATS-DEMO-APP-012', 'Joined', 'Divya Singh', 'divya'],
      ['ATS-DEMO-APP-013', 'HRRejected', 'Vikram Joshi', 'vikram'],
    ];

    const insertedApplications = [];
    for (const [applicationId, status, candidateName, handle] of applicationSeeds) {
      const result = await client.query(
        `INSERT INTO applications (
            application_id,
            ats_job_id,
            status,
            candidate_name,
            candidate_email,
            candidate_phone,
            candidate_years_of_experience,
            current_organization,
            current_location,
            education_level,
            source,
            recruiter_email,
            created_by,
            active_flag,
            talent_pool_only
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,false
          )
          RETURNING *`,
        [
          applicationId,
          job.job_id,
          status,
          candidateName,
          `${handle}${DEMO_EMAIL_DOMAIN}`,
          `9000000${String(insertedApplications.length + 101).slice(-3)}`,
          2 + (insertedApplications.length % 5),
          'Premier Energies Partner Plant',
          'Hyderabad',
          'B.Tech',
          insertedApplications.length % 2 === 0 ? 'LinkedIn' : 'Employee Referral',
          recruiter.email,
          DEMO_OWNER,
        ]
      );
      insertedApplications.push(result.rows[0]);
    }

    const applicantWithDocs = insertedApplications.find((item) => item.status === 'OfferAccepted');
    const documentStages = [
      ['before_offer_release', 'Government ID Proof', 'accepted'],
      ['after_offer_release', 'Offer Letter Acknowledgement', 'uploaded'],
      ['after_offer_acceptance', 'Relocation Confirmation', 'pending'],
      ['before_joining', 'Medical Fitness Certificate', 'pending'],
      ['joining_day', 'Bank Account Details', 'rejected'],
      ['after_joining', 'ESI and PF Nomination Forms', 'pending'],
    ];

    for (const [stage, documentName, status] of documentStages) {
      await client.query(
        `INSERT INTO candidate_documents (
            application_id,
            stage,
            document_name,
            description,
            status,
            rejection_reason,
            requested_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          applicantWithDocs.id,
          stage,
          documentName,
          'Demo onboarding request seeded for document workflow walkthrough.',
          status,
          status === 'rejected' ? 'Document image was unclear; please upload a clearer copy.' : null,
          recruiter.email,
        ]
      );
    }

    const roundOneCandidate = insertedApplications.find((item) => item.status === 'Round1');
    await client.query(
      `INSERT INTO interview_feedback (
          application_id,
          job_id,
          round_number,
          interviewer_email,
          scheduled_datetime,
          actual_datetime,
          technical_score,
          behavioral_score,
          company_fit_score,
          remarks,
          decision,
          rejection_reasons,
          status
        ) VALUES (
          $1,$2,1,$3,NOW() + INTERVAL '1 day', NULL,NULL,NULL,NULL,
          'Demo round seeded for interviewer workflow.',
          'pending','[]','scheduled'
        )`,
      [roundOneCandidate.id, job.job_id, interviewer.email]
    );

    await client.query(
      `INSERT INTO notifications (user_email, title, message, link)
       VALUES
       ($1, 'Demo Journey Ready', 'A complete requisition-to-hired demo lifecycle is ready to open from the dashboard.', '/'),
       ($2, 'Demo Data Ready', 'Demo requisitions, jobs, candidates, and document tasks have been seeded.', '/'),
       ($3, 'Demo Interview Scheduled', 'A demo interview has been assigned for review.', '/interviews')`,
      [req.user.email, recruiter.email, interviewer.email]
    );

    await client.query('COMMIT');
    const story = await buildDemoStory(client);

    res.json({
      message: 'Demo data seeded successfully',
      counts: {
        requisitions: 1,
        jobs: 1,
        applications: insertedApplications.length,
        documents: documentStages.length,
      },
      story,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed demo data error:', err);
    res.status(500).json({ error: 'Failed to seed demo data' });
  } finally {
    client.release();
  }
});

router.get('/story', adminOnly, async (_req, res) => {
  const client = await pool.connect();
  try {
    const story = await buildDemoStory(client);
    res.json(story);
  } catch (err) {
    console.error('Demo story error:', err);
    res.status(500).json({ error: 'Failed to load demo story' });
  } finally {
    client.release();
  }
});

router.delete('/seed', adminOnly, async (_req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await clearDemoData(client);
    await client.query('COMMIT');
    res.json({ message: 'Demo data cleared successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Clear demo data error:', err);
    res.status(500).json({ error: 'Failed to clear demo data' });
  } finally {
    client.release();
  }
});

// POST /demo/run-full  runs a complete demo flow: requisition → approval → job → candidates → interviews → selected → offered → joined
router.post('/run-full', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create requisition
    const bu = await ensureBusinessUnit(client, 'Premier Energies (Demo)', 'PEDEMO');
    const loc = await client.query(
      `INSERT INTO locations (bu_short_name, location_name, active_flag)
       VALUES ($1, 'Demo City', true) ON CONFLICT DO NOTHING RETURNING *`,
      [bu.bu_short_name]
    );
    const locRow = loc.rows[0] || (await client.query("SELECT * FROM locations WHERE location_name = 'Demo City' LIMIT 1")).rows[0];

    const dept = await client.query(
      `INSERT INTO departments (department_name, active_flag)
       VALUES ('Demo Engineering', true) ON CONFLICT DO NOTHING RETURNING *`
    );
    const deptRow = dept.rows[0] || (await client.query("SELECT * FROM departments WHERE department_name = 'Demo Engineering' LIMIT 1")).rows[0];

    const reqId = `REQ-DEMO-${Date.now()}`;
    const reqResult = await client.query(
      `INSERT INTO requisitions (
        requisition_id, raised_by, business_unit_id, department_id, location_id,
        job_title, requisition_type, status, positions_requested, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'Solar Cell Engineer (Demo)', 'new', 'approved', 1, NOW())
      RETURNING *`,
      [reqId, req.user.email, bu.id, deptRow?.id, locRow?.id]
    );
    const requisition = reqResult.rows[0];

    // 2. Create job from requisition
    const jobIdStr = `JOB-DEMO-${Date.now()}`;
    const jobResult = await client.query(
      `INSERT INTO jobs (
        job_id, job_title, requisition_id, business_unit_id, department_id, location_id,
        status, total_positions, experience_years, job_type, publish_to_careers,
        hiring_stages, interviewer_emails, recruiter_email, active_flag, created_at
      ) VALUES ($1, 'Solar Cell Engineer (Demo)', $2, $3, $4, $5,
        'open', 1, '3', 'permanent', true,
        $6, $7, $8, true, NOW())
      RETURNING *`,
      [jobIdStr, requisition.id, bu.id, deptRow?.id, locRow?.id,
       JSON.stringify(['Sourced', 'Screening', 'Interview Round 1', 'Preboarding', 'Hired', 'Archived']),
       JSON.stringify({ '1': [req.user.email] }),
       req.user.email]
    );
    const job = jobResult.rows[0];

    // 3. Add candidate
    const candidateName = 'Demo Candidate ' + Date.now().toString().slice(-4);
    const candidateEmail = `demo.candidate.${Date.now()}@demo.premierenergies.com`;
    const appResult = await client.query(
      `INSERT INTO applications (
        job_id, candidate_name, candidate_email, candidate_phone,
        source, status, active_flag, recruiter_email, created_at
      ) VALUES ($1, $2, $3, '9999900000', 'Direct', 'Joined', true, $4, NOW())
      RETURNING *`,
      [job.id, candidateName, candidateEmail, req.user.email]
    );
    const application = appResult.rows[0];

    // 4. Create interview feedback (completed)
    await client.query(
      `INSERT INTO interview_feedback (
        application_id, job_id, round_number, interviewer_email,
        scheduled_datetime, actual_datetime,
        technical_score, behavioral_score, company_fit_score,
        decision, remarks, status, created_at
      ) VALUES ($1, $2, 1, $3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days',
        5, 4, 5, 'shortlist', 'Excellent demo candidate', 'completed', NOW())`,
      [application.id, job.job_id, req.user.email]
    );

    // 5. Request default documents
    const defaultDocs = ['PAN Card', 'Aadhaar Card', 'Latest Payslip', 'Offer Letter / Employment Proof'];
    for (const docName of defaultDocs) {
      await client.query(
        `INSERT INTO candidate_documents (application_id, stage, document_name, status, requested_by)
         VALUES ($1, 'before_offer_release', $2, 'accepted', $3)`,
        [application.id, docName, req.user.email]
      );
    }

    await client.query('COMMIT');

    res.json({
      message: 'Full demo flow completed: Requisition → Approved → Job → Candidate → Interview → Selected → Offered → Joined',
      requisition_id: requisition.id,
      job_id: job.id,
      application_id: application.id,
      steps_completed: [
        'requisition', 'approved', 'job_opened', 'candidates',
        'interviews', 'selected', 'offered', 'joined'
      ],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Run full demo error:', err);
    res.status(500).json({ error: 'Failed to run full demo flow' });
  } finally {
    client.release();
  }
});

export default router;
