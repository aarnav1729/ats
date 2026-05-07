/**
 * ONE-TIME SETUP / RESET / BACKFILL SCRIPT
 *
 * Run with:  cd server && node scripts/one_time_setup.cjs
 *
 * What this does (in a single transaction per phase):
 *   1. Cleanup
 *      - Delete ALL requisitions
 *      - Delete ALL jobs except ATS-20260427-001 (Procurement Manager)
 *      - Delete ALL candidates / applications / talent-pool entries
 *      - Delete ALL AOP entries
 *      - Cascading: timeline_events, ctc_*, candidate_documents, interview_feedback, etc.
 *   2. Masters sync
 *      - Departments, sub_departments, grades, levels, business_units rebuilt
 *        from the canonical lists (active_flag preserved if existed, else true)
 *   3. Approvers configuration
 *      - HODs (level 1) inserted into users with role=hod
 *      - CXOs (level 2) inserted into cxo_directory + users with role=cxo
 *      - approvers_master rows wire each HOD -> default CXO (Chandra Mauli Kumar)
 *   4. Applications backfill (one-time legacy import)
 *      - Reads docs/legacy_applications.tsv (if present) and inserts each row
 *        as an application with source='Legacy Backfill'
 */

const path = require('path');
const fs   = require('fs');
const { Pool } = require('pg');

// --- DB config (mirror server/db.js) ---
const pool = new Pool({
  host: 'pelats-pelats.j.aivencloud.com',
  port: 15667,
  database: 'defaultdb',
  user: process.env.PGUSER || 'avnadmin',
  password: process.env.PGPASSWORD || '',
  ssl: { rejectUnauthorized: false },
});

// --- Canonical reference data ---
const DEPARTMENTS = [
  'Human Resources','MDs Office','Procurement - Manufacturing','Company Secretary','Tenders',
  'Sales','Business Development','Procurement - Projects','Insurance','Maintenance',
  'Digital Marketing','Management','Quality','Safety','Process','Utility','Facility','Civil',
  'IT','Design','O&M','Technical','Production','Stores','IT & Administration','Procurement',
  'GEM Trainees','Automation - Cell Line','Chairman Office','ESG','PPC','Sales & Operations',
  'Marketing & Communication','Projects','Channel Sales','International Sales',
  'Government Relations','Legal','Analytics','R&D','Service - Manufacturing',
  'Strategic Projects','Investor Relations','Finance & Accounts','EPC','CS & Legal',
  'Engineering','Battery Manufacturing','Business Analytics','Cloud Technology',
  'Program Management','Battery Technology','Product Management & Engineering',
  'Capital Projects','Logistics','Administration','Taxation','Service - Projects',
];

// Each row is [department_name, sub_department_name]. Duplicates de-duped at insert.
const SUB_DEPARTMENTS = [
  ['Human Resources','Human Resources'],['Civil','Civil'],['CS & Legal','CS & Legal'],
  ['Engineering','Engineering'],['Management','BESS'],['Battery Manufacturing','Battery Manufacturing'],
  ['Business Analytics','Business Analytics'],['Cloud Technology','Cloud Technology'],
  ['Program Management','Program Management'],['Battery Technology','Battery Technology'],
  ['Product Management & Engineering','Product Management & Engineering'],
  ['Capital Projects','Capital Projects'],['Company Secretary','Company Secretary'],
  ['Capital Projects','Capital Projects - Civil'],['Capital Projects','Capital Projects - Electrical'],
  ['Capital Projects','Capital Projects - Fire & Plumbing'],['Design','Design'],
  ['Design','Design - General'],['Digital Marketing','Digital Marketing'],
  ['Digital Marketing','Digital Marketing - General'],['Facility','Facility'],
  ['Insurance','Insurance - General'],['IT','IT'],['IT','IT - General'],
  ['Human Resources','Human Resources - General'],['Logistics','Logistics'],
  ['Logistics','Logistics - General'],['Maintenance','Maintenance'],['Management','Management'],
  ['Management','Management - General'],['Management','Taxation'],['Management','Projects'],
  ['Management','Human Resource'],['Management','Business Operations'],['EPC','E P C'],
  ['Finance & Accounts','Accounts'],['MDs Office','EA'],['MDs Office','MDs Office'],
  ['O&M','O&M - General'],['O&M','O&M'],['Process','Process'],
  ['Procurement - Manufacturing','Procurement-Manufacturing'],
  ['Procurement - Manufacturing','Procurement - Manufacturing - General'],
  ['Procurement - Projects','Procurement-Projects'],
  ['Procurement - Projects','Procurement - Projects - General'],
  ['Production','Production - General'],['Finance & Accounts','Accounts & Finance - General'],
  ['Production','Production'],['Production','Stores'],['Production','Maintenances'],
  ['Projects','Project'],['Projects','Projects - General'],['Quality','Quality'],
  ['Safety','Safety'],['Sales','Sales'],['Sales','Sales - General'],
  ['Finance & Accounts','Treasury Compliances'],['Service - Projects','Service - Projects'],
  ['Service - Projects','Marketing'],['Service - Projects','Services - General'],
  ['Taxation','Taxations'],['Tenders','Tenders'],['Tenders','Tenders - General'],
  ['Utility','Utility'],['Utility','Utility - General'],['Stores','Store'],
  ['Technical','Technical'],['Administration','Administration - General'],
  ['Production','Production - Cell Line'],['Maintenance','Maintenance - Cell Line'],
  ['Utility','Utility - Cell Line'],['Facility','Facility - Cell Line'],
  ['Quality','Quality - Cell Line'],['Production','Production - Module Line'],
  ['Maintenance','Maintenance - Module Line'],['Technical','Technical - Module Line'],
  ['Administration','Administration'],['Quality','Quality - Module Line'],
  ['Utility','Utility - Module Line'],['Stores','Stores - Module Line'],
  ['IT & Administration','IT & Administration'],['Procurement','Procurement'],
  ['Projects','Projects - Civil'],['Stores','Stores - Cell Line'],
  ['GEM Trainees','GEM Trainees'],['Automation - Cell Line','Automation - Cell Line'],
  ['Chairman Office','Chairman Office'],['Business Development','Business Development'],
  ['ESG','ESG'],['Finance & Accounts','Treasury Transactions'],['PPC','PPC'],
  ['Insurance','Insurance'],['Sales & Operations','Sales & Operations'],
  ['Management','Finance & Accounts'],['Procurement','Procurement - Projects'],
  ['Procurement','Procurement - Manufacturing'],
  ['Marketing & Communication','Marketing & Communication'],
  ['Channel Sales','Channel Sales'],['Business Development','EPC'],
  ['International Sales','International Sales'],['Projects','Projects - Electrical'],
  ['Projects','Projects - Fire & Plumbing'],['Government Relations','Government Relations'],
  ['Legal','Legal'],['Analytics','Analytics'],['R&D','R&D'],
  ['Service - Manufacturing','Service - Manufacturing'],
  ['Investor Relations','Investor Relations'],['Projects','Projects - Manufacturing'],
];

const GRADES = [
  'A1','A2','A3','A4','AT','B1','B2','B3','B4','B5','C1','C2','C3','C4',
  'D1','D2','D3','D4','D5','E1','E2','E3','E4','E5','E6','F','SS','TT',
];

const LEVELS = [
  'Administrative Trainee','Assistant Engineer','Assistant General Manager','Assistant Manager',
  'Assistant Vice President','Associate','Associate Manager','Coordinator','CXO',
  'Deputy Engineer','Deputy General Manager','Deputy Manager','Driver','Engineer','Executive',
  'Fork Lift Driver','General Manager','Graduate Engineer Trainee','Helper','Junior Associate',
  'Junior Engineer','Junior Executive','Junior Officer','Junior Technician','Management Trainee',
  'Manager','Officer','Operator','Senior Associate','Senior Engineer','Senior Executive',
  'Senior General Manager','Senior Manager','Senior Operator','Senior Shift Incharge',
  'Senior Technician','Senior Vice President','Technical Trainee','Technician','Vice President',
];

const BUSINESS_UNITS = [
  ['Premier Energies Limited',                          'PEL'],
  ['Premier Solar Powertech Private Limited',           'PSS'],
  ['Premier Energies Photovoltaic Private Limited',     'PEPPL'],
  ['Brightstone Developers Private Limited',            'BSDPL'],
  ['Premier Energies Global Environment Private Limited','PEGEPL'],
  ['Premier Energies International Private Limited',    'PEIPL'],
  ['Premier Energies Storage Solutions Private Limited','PESS'],
];

const HODS = [
  ['PEGEPL1519','Ajumal S S','ajumal@premierenergies.com'],
  ['PEPPL1625','Manmohan Singh','manmohan.singh@premierenergies.com'],
  ['PEPPL0004','Shivjee Sharma','shivjee.s@premierenergies.com'],
  ['PEGEPL1520','Prakash Chandra','prakash.chandra@premierenergies.com'],
  ['PEPPL0606','Kishor Kamal','kamal.kishor@premierenergies.com'],
  ['PEIPL0707','Sandip Rameshrao Gorle','sandip.gorle@premierenergies.com'],
  ['PEGEPL1521','Khajan Chandra Kandpal','kchandra@premierenergies.com'],
  ['PEIPL0035','Indersen Kumar Singh','indersen.singh@premierenergies.com'],
  ['PEIPL0030','Meenakshi Bhaisare','meenakshi.bhaisare@premierenergies.com'],
  ['PSS0147','Mallikarjun J','jmr@premierenergies.com'],
  ['PEGEPL1402','Devata Venkata Rama Latcha Rao','lrao@premierenergies.com'],
  ['PEGEPL1508','Subhankar Dutta','subhankar.dutta@premierenergies.com'],
  ['PSS0309','K.Radha Krishna Murthy','radhakrishna.k@premierenergies.com'],
  ['PEGEPL0117','Govada Siva Babu','sivababu.g@premierenergies.com'],
  ['PEGEPL1389','Gudimella Sriram','sriram.gudimella@premierenergies.com'],
  ['PEGEPL1424','Boddu Ramu','bramu@premierenergies.com'],
  ['PEPPL0111','Manoj Kumar','manoj.kumar@premierenergies.com'],
  ['PEPPL0404','Shaik Abbas','shaik.abbas@premierenergies.com'],
  ['PEPPL0126','Rahul Mishra','rahul.mishra@premierenergies.com'],
  ['PEPPL0821','Ajit Kumar Mishra','ajit.m@premierenergies.com'],
  ['PEGEPL1523','Karthikeyan M','karthikeyan.m@premierenergies.com'],
  ['PEPPL1653','Papa Venkat Reddy','venkat.p@premierenergies.com'],
  ['PEPPL0604','Bandarupalli Krishna Chaitanya','krishnachaitanya.b@premierenergies.com'],
  ['PEPPL0660','Kesaram Subash Reddy','subash.kesaram@premierenergies.com'],
  ['PEGEPL0138','Punuguti Venkat Narapareddy','narapareddy.p@premierenergies.com'],
  ['PEPPL0125','Durga Kumar Avvaru','avvaru.kumar@premierenergies.com'],
  ['PSS1121','Shashank Kumar Yadav','shashank.kumar@premierenergies.com'],
  ['PEPPL0912','Soubhagya Ranjan Swain','soubhagya.swain@premierenergies.com'],
  ['PEPPL0545','Shaik Firoz Ahmed','firozahmed@premierenergies.com'],
  ['PEPPL0814','Sivabala Subramanian','sivabala.sm@premierenergies.com'],
];

const CXOS = [
  ['PEPPL1105','Ramesh Naidu Madasu','ramesh.naidu@premierenergies.com'],
  ['PSS0142','Dodda Nageswara Rao','nrao@premierenergies.com'],
  ['PEPPL0548','Chandra Mauli Kumar','chandra.kumar@premierenergies.com'],
  ['PSS1080','Niyathi Madasu','niyathi@premierenergies.com'],
  ['PSS1373','Nand Kishore Khandelwal','nk.khandelwal@premierenergies.com'],
  ['PEGEPL1472','Baskara Pandian T','baskara.pandian@premierenergies.com'],
];
// Default L2 approver (CXO) for every HOD until per-org-unit hierarchy is provided.
const DEFAULT_L2_CXO_EMAIL = 'chandra.kumar@premierenergies.com';

const KEEP_JOB_ID = 'ATS-20260427-001';

// ---------------------------------------------------------------------------
async function step(label, fn) {
  process.stdout.write(`▶ ${label}…  `);
  const t = Date.now();
  try { await fn(); console.log(`done · ${Date.now() - t}ms`); }
  catch (e) { console.log(`FAIL\n  ${e.message}`); throw e; }
}

async function cleanup(c) {
  // Delete dependents first
  await c.query(`DELETE FROM timeline_events WHERE entity_type IN ('application','job','requisition')`);
  await c.query(`DELETE FROM ctc_breakups`);
  await c.query(`DELETE FROM ctc_comparisons`);
  await c.query(`DELETE FROM ctc_approvers`);
  await c.query(`DELETE FROM offer_letters`);
  await c.query(`DELETE FROM candidate_documents`);
  await c.query(`DELETE FROM interview_feedback`);
  await c.query(`DELETE FROM duplicate_upload_audit`);
  await c.query(`DELETE FROM talent_pool_movements`);
  await c.query(`DELETE FROM applications`);
  await c.query(`DELETE FROM jobs WHERE job_id <> $1`, [KEEP_JOB_ID]);
  await c.query(`DELETE FROM requisition_approvals`);
  await c.query(`DELETE FROM requisition_positions`);
  await c.query(`DELETE FROM requisitions`);
  await c.query(`DELETE FROM aop`);
}

async function syncMasters(c) {
  // Departments
  for (const d of DEPARTMENTS) {
    await c.query(
      `INSERT INTO departments (department_name) VALUES ($1)
       ON CONFLICT (department_name) DO UPDATE SET active_flag = true`,
      [d]
    );
  }
  // Sub-departments (skip duplicates)
  const seen = new Set();
  for (const [dept, sub] of SUB_DEPARTMENTS) {
    const key = `${dept}|${sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dq = await c.query(`SELECT id FROM departments WHERE department_name = $1`, [dept]);
    if (!dq.rows[0]) continue;
    await c.query(
      `INSERT INTO sub_departments (department_id, sub_department_name)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [dq.rows[0].id, sub]
    );
  }
  // Grades
  for (const g of GRADES) {
    await c.query(
      `INSERT INTO grades (grade) VALUES ($1)
        ON CONFLICT (grade) DO UPDATE SET active_flag = true`,
      [g]
    );
  }
  // Levels
  for (const lv of LEVELS) {
    await c.query(
      `INSERT INTO levels (level) VALUES ($1)
        ON CONFLICT (level) DO UPDATE SET active_flag = true`,
      [lv]
    );
  }
  // Business units
  for (const [bu, short] of BUSINESS_UNITS) {
    await c.query(
      `INSERT INTO business_units (bu_name, bu_short_name) VALUES ($1, $2)
        ON CONFLICT (bu_short_name) DO UPDATE SET bu_name = EXCLUDED.bu_name, active_flag = true`,
      [bu, short]
    );
  }
}

async function syncApprovers(c) {
  for (const [empId, name, email] of HODS) {
    await c.query(
      `INSERT INTO users (email, name, role, employee_id, is_active)
         VALUES ($1, $2, 'hod', $3, true)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = 'hod', employee_id = EXCLUDED.employee_id, is_active = true`,
      [email.toLowerCase(), name, empId]
    );
  }
  for (const [empId, name, email] of CXOS) {
    await c.query(
      `INSERT INTO users (email, name, role, employee_id, is_active)
         VALUES ($1, $2, 'hod', $3, true)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, employee_id = EXCLUDED.employee_id, is_active = true`,
      [email.toLowerCase(), name, empId]
    );
    // also into cxo_directory if table exists
    try {
      await c.query(
        `INSERT INTO cxo_directory (cxo_name, cxo_email, designation, active_flag)
           VALUES ($1, $2, 'CXO', true)
           ON CONFLICT (cxo_email) DO UPDATE SET cxo_name = EXCLUDED.cxo_name, active_flag = true`,
        [name, email.toLowerCase()]
      );
    } catch (e) { /* table may not have unique on email */ }
  }
  // approvers_master: each HOD as level 1, default CXO as their level 2 escalation
  await c.query(`DELETE FROM approvers_master`);
  for (const [, name, email] of HODS) {
    await c.query(
      `INSERT INTO approvers_master (approver_email, approver_name, level, escalation_email, active_flag)
         VALUES ($1, $2, 1, $3, true)`,
      [email.toLowerCase(), name, DEFAULT_L2_CXO_EMAIL]
    );
  }
  for (const [, name, email] of CXOS) {
    await c.query(
      `INSERT INTO approvers_master (approver_email, approver_name, level, active_flag)
         VALUES ($1, $2, 2, true)`,
      [email.toLowerCase(), name]
    );
  }
}

async function backfillApplications(c) {
  const tsv = path.resolve(__dirname, '..', '..', 'docs', 'legacy_applications.tsv');
  if (!fs.existsSync(tsv)) {
    console.log(`  (skip: ${tsv} not found - paste the legacy table there to enable backfill)`);
    return;
  }
  const lines = fs.readFileSync(tsv, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split('\t');
  const idx = (k) => header.indexOf(k);
  let ok = 0, skip = 0;
  for (const ln of lines) {
    const f = ln.split('\t');
    const candidateName = (f[idx('Candidate Name')] || '').trim();
    if (!candidateName) { skip++; continue; }
    const status = (f[idx('Status')] || '').trim().toLowerCase();
    const appStatus = status === 'offered' ? 'Offered'
                    : status === 'open'    ? 'Applied'
                    : 'Applied';
    const phase = (f[idx('Phase')] || '').trim();
    const jobTitle = (f[idx('Job Title')] || '').trim();
    const recruiter = (f[idx('Recruiter')] || '').trim();
    const offeredDate = (f[idx('Offered Date')] || '').trim();
    const edoj = (f[idx('EDOJ')] || '').trim();
    const remarks = (f[idx('Remarks')] || '').trim();

    const appId = `LEGACY-${Date.now()}-${ok}`;
    const candEmail = `legacy_${ok}_${Date.now()}@premierenergies.local`;
    try {
      await c.query(
        `INSERT INTO applications
           (application_id, ats_job_id, status, candidate_name, candidate_email, source,
            recruiter_email, joining_date, dropout_reason, created_by, active_flag)
         VALUES ($1, 'TP-POOL', $2, $3, $4, 'Legacy Backfill', $5, $6, $7, 'system@premierenergies.com', true)`,
        [appId, appStatus, candidateName, candEmail, recruiter || null,
         edoj ? new Date(edoj) : null, [phase, jobTitle, remarks].filter(Boolean).join(' / ')]
      );
      ok++;
    } catch (e) { skip++; }
  }
  console.log(`  backfill: ${ok} inserted · ${skip} skipped`);
}

(async () => {
  console.log('\n══ ATS one-time setup ══\n');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await step('Cleanup (requisitions, jobs, candidates, AOP, talent pool)', () => cleanup(c));
    await step('Sync masters (departments, sub_departments, grades, levels, BUs)', () => syncMasters(c));
    await step('Sync approvers (HODs L1, CXOs L2 default)', () => syncApprovers(c));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('\nABORTED:', e.message);
    process.exit(1);
  } finally {
    c.release();
  }

  // Backfill is best-effort, separate transaction
  const c2 = await pool.connect();
  try {
    await c2.query('BEGIN');
    await step('Backfill legacy applications (one-time)', () => backfillApplications(c2));
    await c2.query('COMMIT');
  } catch (e) {
    await c2.query('ROLLBACK');
    console.error('Backfill failed:', e.message);
  } finally {
    c2.release();
  }

  await pool.end();
  console.log('\n✅ all done\n');
})();
