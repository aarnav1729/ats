import XLSX from 'xlsx';
import pool from '../db.js';
import { listSpotEmployees } from '../services/spot.js';

const WORKBOOK_PATH = process.env.TRACKER_XLSX || '/Users/aarrated/Desktop/Open And offered tracker (1).xlsx';
const KEEP_JOB_ID = 'ATS-20260427-001';
const ACTOR = 'codex-maintenance-2026-05-07';

const DEPARTMENTS = [
  'Human Resources', 'MDs Office', 'Procurement - Manufacturing', 'Company Secretary', 'Tenders', 'Sales',
  'Business Development', 'Procurement - Projects', 'Insurance', 'Maintenance', 'Digital Marketing', 'Management',
  'Quality', 'Safety', 'Process', 'Utility', 'Facility', 'Civil', 'IT', 'Design', 'O&M', 'Technical', 'Production',
  'Stores', 'IT & Administration', 'Procurement', 'GEM Trainees', 'Automation - Cell Line', 'Chairman Office',
  'ESG', 'PPC', 'Sales & Operations', 'Marketing & Communication', 'Projects', 'Channel Sales', 'International Sales',
  'Government Relations', 'Legal', 'Analytics', 'R&D', 'Service - Manufacturing', 'Strategic Projects',
  'Investor Relations', 'Finance & Accounts', 'EPC', 'CS & Legal', 'Engineering', 'Battery Manufacturing',
  'Business Analytics', 'Cloud Technology', 'Program Management', 'Battery Technology',
  'Product Management & Engineering', 'Capital Projects', 'Logistics', 'Administration', 'Taxation', 'Service - Projects',
];

const SUB_DEPARTMENTS = `
Human Resources|Human Resources
Civil|Civil
CS & Legal|CS & Legal
Engineering|Engineering
Management|BESS
Battery Manufacturing|Battery Manufacturing
Business Analytics|Business Analytics
Cloud Technology|Cloud Technology
Program Management|Program Management
Battery Technology|Battery Technology
Product Management & Engineering|Product Management & Engineering
Capital Projects|Capital Projects
Company Secretary|Company Secretary
Capital Projects|Capital Projects - Civil
Capital Projects|Capital Projects - Electrical
Capital Projects|Capital Projects - Fire & Plumbing
Design|Design
Design|Design - General
Digital Marketing|Digital Marketing
Digital Marketing|Digital Marketing - General
Facility|Facility
Insurance|Insurance - General
IT|IT
IT|IT - General
Human Resources|Human Resources - General
Logistics|Logistics
Logistics|Logistics - General
Maintenance|Maintenance
Management|Management
Management|Management - General
Management|Taxation
Management|Projects
Management|Human Resource
Management|Business Operations
EPC|E P C
Finance & Accounts|Accounts
MDs Office|EA
MDs Office|MDs Office
O&M|O&M - General
O&M|O&M
Process|Process
Procurement - Manufacturing|Procurement-Manufacturing
Procurement - Manufacturing|Procurement - Manufacturing - General
Procurement - Projects|Procurement-Projects
Procurement - Projects|Procurement - Projects - General
Production|Production - General
Finance & Accounts|Accounts & Finance - General
Production|Production
Production|Stores
Production|Maintenances
Projects|Project
Projects|Projects - General
Quality|Quality
Safety|Safety
Sales|Sales
Sales|Sales - General
Finance & Accounts|Treasury Compliances
Service - Projects|Service - Projects
Service - Projects|Marketing
Service - Projects|Services - General
Taxation|Taxations
Tenders|Tenders
Tenders|Tenders - General
Utility|Utility
Utility|Utility - General
Stores|Store
Technical|Technical
Administration|Administration - General
Production|Production - Cell Line
Maintenance|Maintenance - Cell Line
Utility|Utility - Cell Line
Facility|Facility - Cell Line
Quality|Quality - Cell Line
Production|Production - Module Line
Maintenance|Maintenance - Module Line
Technical|Technical - Module Line
Administration|Administration
Quality|Quality - Module Line
Utility|Utility - Module Line
Stores|Stores - Module Line
IT & Administration|IT & Administration
Procurement|Procurement
Projects|Projects - Civil
Stores|Stores - Cell Line
GEM Trainees|GEM Trainees
Automation - Cell Line|Automation - Cell Line
Chairman Office|Chairman Office
Business Development|Business Development
ESG|ESG
Finance & Accounts|Treasury Transactions
PPC|PPC
Insurance|Insurance
Sales & Operations|Sales & Operations
Management|Finance & Accounts
Procurement|Procurement - Projects
Procurement|Procurement - Manufacturing
Marketing & Communication|Marketing & Communication
Channel Sales|Channel Sales
Business Development|EPC
International Sales|International Sales
Projects|Projects - Electrical
Projects|Projects - Fire & Plumbing
Government Relations|Government Relations
Legal|Legal
Analytics|Analytics
R&D|R&D
Service - Manufacturing|Service - Manufacturing
Investor Relations|Investor Relations
Projects|Projects - Manufacturing
`.trim().split('\n').map((line) => {
  const [department, subDepartment] = line.split('|');
  return { department, subDepartment };
});

const GRADES = 'A1 A2 A3 A4 AT B1 B2 B3 B4 B5 C1 C2 C3 C4 D1 D2 D3 D4 D5 E1 E2 E3 E4 E5 E6 F SS TT'.split(' ');
const LEVELS = [
  'Administrative Trainee', 'Assistant Engineer', 'Assistant General Manager', 'Assistant Manager', 'Assistant Vice President',
  'Associate', 'Associate Manager', 'Coordinator', 'CXO', 'Deputy Engineer', 'Deputy General Manager', 'Deputy Manager',
  'Driver', 'Engineer', 'Executive', 'Fork Lift Driver', 'General Manager', 'Graduate Engineer Trainee', 'Helper',
  'Junior Associate', 'Junior Engineer', 'Junior Executive', 'Junior Officer', 'Junior Technician', 'Management Trainee',
  'Manager', 'Officer', 'Operator', 'Senior Associate', 'Senior Engineer', 'Senior Executive', 'Senior General Manager',
  'Senior Manager', 'Senior Operator', 'Senior Shift Incharge', 'Senior Technician', 'Senior Vice President',
  'Technical Trainee', 'Technician', 'Vice President',
];

const BUSINESS_UNITS = [
  ['PEL', 'Premier Energies Limited'],
  ['PSPPL', 'Premier Solar Powertech Private Limited'],
  ['PEPPL', 'Premier Energies Photovoltaic Private Limited'],
  ['BDPL', 'Brightstone Developers Private Limited'],
  ['PEGEPL', 'Premier Energies Global Environment Private Limited'],
  ['PEIPL', 'Premier Energies International Private Limited'],
  ['PESSPL', 'Premier Energies Storage Solutions Private Limited'],
];

const HODS = [
  ['PEGEPL1519', 'Ajumal S S', 'ajumal@premierenergies.com'], ['PEPPL1625', 'Manmohan Singh', 'manmohan.singh@premierenergies.com'],
  ['PEPPL0004', 'Shivjee Sharma', 'shivjee.s@premierenergies.com'], ['PEGEPL1520', 'Prakash Chandra', 'prakash.chandra@premierenergies.com'],
  ['PEPPL0606', 'Kishor Kamal', 'kamal.kishor@premierenergies.com'], ['PEIPL0707', 'Sandip Rameshrao Gorle', 'sandip.gorle@premierenergies.com'],
  ['PEGEPL1521', 'Khajan Chandra Kandpal', 'kchandra@premierenergies.com'], ['PEIPL0035', 'Indersen Kumar Singh', 'indersen.singh@premierenergies.com'],
  ['PEIPL0030', 'Meenakshi Bhaisare', 'meenakshi.bhaisare@premierenergies.com'], ['PSS0147', 'Mallikarjun J', 'jmr@premierenergies.com'],
  ['PEGEPL1402', 'Devata Venkata Rama Latcha Rao', 'lrao@premierenergies.com'], ['PEGEPL1508', 'Subhankar Dutta', 'subhankar.dutta@premierenergies.com'],
  ['PSS0309', 'K.Radha Krishna Murthy', 'radhakrishna.k@premierenergies.com'], ['PEGEPL0117', 'Govada Siva Babu', 'sivababu.g@premierenergies.com'],
  ['PEGEPL1389', 'Gudimella Sriram', 'sriram.gudimella@premierenergies.com'], ['PEGEPL1424', 'Boddu Ramu', 'bramu@premierenergies.com'],
  ['PEPPL0111', 'Manoj Kumar', 'manoj.kumar@premierenergies.com'], ['PEPPL0404', 'Shaik Abbas', 'shaik.abbas@premierenergies.com'],
  ['PEPPL0126', 'Rahul Mishra', 'rahul.mishra@premierenergies.com'], ['PEPPL0821', 'Ajit Kumar Mishra', 'Ajit.m@premierenergies.com'],
  ['PEGEPL1523', 'Karthikeyan M', 'karthikeyan.m@premierenergies.com'], ['PEPPL1653', 'Papa Venkat Reddy', 'venkat.p@premierenergies.com'],
  ['PEPPL0604', 'Bandarupalli Krishna Chaitanya', 'krishnachaitanya.b@premierenergies.com'], ['PEPPL0660', 'Kesaram Subash Reddy', 'subash.kesaram@premierenergies.com'],
  ['PEGEPL0138', 'Punuguti  Venkat Narapareddy', 'narapareddy.p@premierenergies.com'], ['PEPPL0125', 'DURGA KUMAR AVVARU', 'avvaru.kumar@premierenergies.com'],
  ['PSS1121', 'Shashank Kumar Yadav', 'shashank.kumar@premierenergies.com'], ['PEPPL0912', 'Soubhagya Ranjan Swain', 'soubhagya.swain@premierenergies.com'],
  ['PEPPL0545', 'Shaik Firoz Ahmed', 'firozahmed@premierenergies.com'], ['PEPPL0814', 'Sivabala Subramanian', 'sivabala.sm@premierenergies.com'],
];

const CXOS = [
  ['PEPPL1105', 'Ramesh Naidu Madasu', 'ramesh.naidu@premierenergies.com'],
  ['PSS0142', 'Dodda Nageswara Rao', 'nrao@premierenergies.com'],
  ['PEPPL0548', 'Chandra Mauli Kumar', 'chandra.kumar@premierenergies.com'],
  ['PSS1080', 'Niyathi Madasu', 'niyathi@premierenergies.com'],
  ['PSS1373', 'Nand Kishore Khandelwal', 'nk.khandelwal@premierenergies.com'],
  ['PEGEPL1472', 'Baskara Pandian T', 'baskara.pandian@premierenergies.com'],
];

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function dateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'candidate';
}

async function getOrCreate(client, table, keyCol, value, extra = {}) {
  const normalized = clean(value);
  if (!normalized) return null;
  const found = await client.query(`SELECT id FROM ${table} WHERE LOWER(${keyCol}) = LOWER($1) LIMIT 1`, [normalized]);
  if (found.rows[0]) return found.rows[0].id;
  const cols = [keyCol, ...Object.keys(extra), 'active_flag'];
  const vals = [normalized, ...Object.values(extra), true];
  const params = vals.map((_, idx) => `$${idx + 1}`).join(',');
  const inserted = await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${params}) RETURNING id`, vals);
  return inserted.rows[0].id;
}

async function getBusinessUnitId(client, shortName, name) {
  if (!shortName) return null;
  await client.query(
    `INSERT INTO business_units (bu_short_name, bu_name, active_flag)
     VALUES ($1,$2,true)
     ON CONFLICT (bu_short_name) DO UPDATE SET bu_name = EXCLUDED.bu_name, active_flag = true`,
    [shortName, name || shortName]
  );
  const result = await client.query(`SELECT id FROM business_units WHERE bu_short_name = $1 LIMIT 1`, [shortName]);
  return result.rows[0]?.id || null;
}

async function getLocationId(client, locationName, buShortName) {
  const normalized = clean(locationName);
  if (!normalized) return null;
  const found = await client.query(
    `SELECT id FROM locations WHERE LOWER(location_name) = LOWER($1) LIMIT 1`,
    [normalized]
  );
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO locations (location_name, bu_short_name, "LocationName", "CompanyCode", active_flag)
     VALUES ($1,$2,$1,0,true)
     RETURNING id`,
    [normalized, buShortName || null]
  );
  return inserted.rows[0].id;
}

async function getPhaseId(client, phaseName, locationName) {
  const normalized = clean(phaseName);
  if (!normalized) return null;
  const found = await client.query(
    `SELECT id FROM phases WHERE LOWER(phase_name) = LOWER($1) AND LOWER(COALESCE(location_name,'')) = LOWER($2) LIMIT 1`,
    [normalized, clean(locationName)]
  );
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO phases (phase_name, location_name, active_flag) VALUES ($1,$2,true) RETURNING id`,
    [normalized, clean(locationName)]
  );
  return inserted.rows[0].id;
}

async function getSubDepartmentId(client, departmentName, subDepartmentName) {
  const normalized = clean(subDepartmentName);
  if (!normalized) return null;
  const found = await client.query(
    `SELECT id FROM sub_departments WHERE LOWER(sub_department_name) = LOWER($1) AND LOWER(COALESCE(department_name,'')) = LOWER($2) LIMIT 1`,
    [normalized, clean(departmentName)]
  );
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO sub_departments (department_name, sub_department_name, active_flag) VALUES ($1,$2,true) RETURNING id`,
    [clean(departmentName), normalized]
  );
  return inserted.rows[0].id;
}

async function syncMasters(client) {
  for (const [shortName, name] of BUSINESS_UNITS) {
    await client.query(
      `INSERT INTO business_units (bu_short_name, bu_name, active_flag)
       VALUES ($1,$2,true)
       ON CONFLICT (bu_short_name) DO UPDATE SET bu_name = EXCLUDED.bu_name, active_flag = true`,
      [shortName, name]
    );
  }
  await client.query(`UPDATE business_units SET active_flag = false WHERE bu_short_name <> ALL($1::text[])`, [BUSINESS_UNITS.map(([s]) => s)]);

  for (const name of DEPARTMENTS) {
    await client.query(
      `INSERT INTO departments (department_name, active_flag) VALUES ($1,true)
       ON CONFLICT DO NOTHING`,
      [name]
    );
    await client.query(`UPDATE departments SET active_flag = true WHERE LOWER(department_name) = LOWER($1)`, [name]);
  }
  await client.query(`UPDATE departments SET active_flag = false WHERE department_name <> ALL($1::text[])`, [DEPARTMENTS]);

  await client.query(`UPDATE sub_departments SET active_flag = false`);
  for (const { department, subDepartment } of SUB_DEPARTMENTS) {
    await getOrCreate(client, 'departments', 'department_name', department);
    const existing = await client.query(
      `SELECT id FROM sub_departments WHERE LOWER(department_name) = LOWER($1) AND LOWER(sub_department_name) = LOWER($2) LIMIT 1`,
      [department, subDepartment]
    );
    if (existing.rows[0]) {
      await client.query(`UPDATE sub_departments SET active_flag = true WHERE id = $1`, [existing.rows[0].id]);
    } else {
      await client.query(
        `INSERT INTO sub_departments (department_name, sub_department_name, active_flag) VALUES ($1,$2,true)`,
        [department, subDepartment]
      );
    }
  }

  for (const grade of GRADES) {
    await client.query(`INSERT INTO grades (grade, active_flag) VALUES ($1,true) ON CONFLICT DO NOTHING`, [grade]);
    await client.query(`UPDATE grades SET active_flag = true WHERE LOWER(grade) = LOWER($1)`, [grade]);
  }
  await client.query(`UPDATE grades SET active_flag = false WHERE grade <> ALL($1::text[])`, [GRADES]);

  for (const level of LEVELS) {
    await client.query(`INSERT INTO levels (level, active_flag) VALUES ($1,true) ON CONFLICT DO NOTHING`, [level]);
    await client.query(`UPDATE levels SET active_flag = true WHERE LOWER(level) = LOWER($1)`, [level]);
  }
  await client.query(`UPDATE levels SET active_flag = false WHERE level <> ALL($1::text[])`, [LEVELS]);
}

async function syncApprovers(client) {
  await client.query(`UPDATE approvers_master SET active_flag = false`);
  const employees = await listSpotEmployees().catch((err) => {
    console.warn(`SPOT lookup unavailable, CXO mappings will use explicit CXO directory only: ${err.message}`);
    return [];
  });
  const byId = new Map(employees.map((employee) => [employee.employee_id, employee]));
  const cxoById = new Map(CXOS.map(([id, name, email]) => [id, { employee_id: id, employee_name: name, employee_email: email }]));

  for (const [id, name, email] of [...HODS, ...CXOS]) {
    const spot = byId.get(id) || {};
    await client.query(
      `INSERT INTO cxo_directory (
        employee_id, employee_name, employee_email, designation, manager_id, source, active_flag, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,'manual',true,$6,$6)
      ON CONFLICT (employee_id) DO UPDATE SET
        employee_name = EXCLUDED.employee_name,
        employee_email = EXCLUDED.employee_email,
        designation = COALESCE(EXCLUDED.designation, cxo_directory.designation),
        manager_id = COALESCE(EXCLUDED.manager_id, cxo_directory.manager_id),
        active_flag = true,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()`,
      [id, spot.employee_name || name, spot.employee_email || email, spot.designation || (cxoById.has(id) ? 'CXO' : 'HOD'), spot.manager_id || null, ACTOR]
    );
  }

  for (const [id, name, email] of HODS) {
    const managerId = byId.get(id)?.manager_id;
    const cxo = cxoById.get(managerId);
    if (!cxo) continue;
    await client.query(
      `INSERT INTO approvers_master (
        requisitioner_employee_id, requisitioner_name, requisitioner_email,
        cxo_employee_id, cxo_name, cxo_email, cxo_designation, active_flag
      ) VALUES ($1,$2,$3,$4,$5,$6,'CXO',true)
      ON CONFLICT (requisitioner_email, cxo_email) DO UPDATE SET active_flag = true, updated_at = NOW()`,
      [id, byId.get(id)?.employee_name || name, byId.get(id)?.employee_email || email, cxo.employee_id, cxo.employee_name, cxo.employee_email]
    );
  }
}

async function cleanupOperationalData(client) {
  const keep = await client.query(`SELECT id, department_id, sub_department_id FROM jobs WHERE job_id = $1 LIMIT 1`, [KEEP_JOB_ID]);
  if (!keep.rows[0]) throw new Error(`Keep job ${KEEP_JOB_ID} not found`);

  await client.query(`UPDATE applications SET duplicate_of_id = NULL`);
  await client.query(`DELETE FROM messages WHERE application_id IN (SELECT id FROM applications WHERE COALESCE(ats_job_id,'') <> $1)`, [KEEP_JOB_ID]);
  await client.query(`DELETE FROM applications WHERE COALESCE(ats_job_id,'') <> $1`, [KEEP_JOB_ID]);
  await client.query(`UPDATE jobs SET requisition_id = NULL`);
  await client.query(`DELETE FROM requisition_approvals`);
  await client.query(`DELETE FROM requisition_positions`);
  await client.query(`DELETE FROM requisitions`);
  await client.query(`DELETE FROM aop`);
  await client.query(`DELETE FROM jobs WHERE job_id <> $1`, [KEEP_JOB_ID]);

  const deptId = await getOrCreate(client, 'departments', 'department_name', 'Procurement');
  const subDeptId = await getSubDepartmentId(client, 'Procurement', 'Procurement');
  await client.query(`UPDATE jobs SET department_id = $1, sub_department_id = $2, active_flag = true WHERE job_id = $3`, [deptId, subDeptId, KEEP_JOB_ID]);
}

function readTrackerRows() {
  const workbook = XLSX.readFile(WORKBOOK_PATH, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

async function buildEmployeeIndex() {
  const employees = await listSpotEmployees().catch(() => []);
  const byName = new Map();
  for (const employee of employees) {
    byName.set(clean(employee.employee_name).toLowerCase(), employee);
  }
  return byName;
}

async function backfillTracker(client) {
  const rows = readTrackerRows();
  const employeeByName = await buildEmployeeIndex();
  let jobsCreated = 0;
  let applicationsCreated = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const departmentName = clean(row.Department);
    const subDepartmentName = clean(row['Sub Department']) || departmentName;
    const companyName = clean(row.Company);
    const bu = BUSINESS_UNITS.find(([, name]) => name.toLowerCase() === companyName.toLowerCase());
    const buId = bu ? await getBusinessUnitId(client, bu[0], bu[1]) : null;
    const departmentId = departmentName ? await getOrCreate(client, 'departments', 'department_name', departmentName) : null;
    const subDepartmentId = subDepartmentName ? await getSubDepartmentId(client, departmentName, subDepartmentName) : null;
    const locationId = await getLocationId(client, clean(row.Branch), bu?.[0]);
    const phaseId = await getPhaseId(client, clean(row.Phase), clean(row.Branch));
    const levelId = LEVELS.includes(clean(row.Designation)) ? await getOrCreate(client, 'levels', 'level', clean(row.Designation)) : null;
    const recruiter = employeeByName.get(clean(row.Recruiter).toLowerCase());
    const secondary = employeeByName.get(clean(row['Another recriter']).toLowerCase());
    const rawJobId = clean(row['Job ID']);
    const jobId = rawJobId && !['extra position', 'need'].includes(rawJobId.toLowerCase())
      ? rawJobId
      : `BACKFILL-${String(index + 2).padStart(5, '0')}`;
    const jobTitle = clean(row['Job Title']) || [departmentName, subDepartmentName, clean(row.Designation), clean(row.Phase)].filter(Boolean).join(' - ');

    await client.query(
      `INSERT INTO jobs (
        job_id, status, job_title, department_id, sub_department_id, business_unit_id, location_id, phase_id,
        level_id, job_type, requisition_type, number_of_positions, total_positions, recruiter_email,
        secondary_recruiter_email, created_by, created_at, updated_by
      ) VALUES ($1,'open',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,COALESCE($15::date,NOW()),$14)
      ON CONFLICT (job_id) DO UPDATE SET
        job_title = EXCLUDED.job_title,
        department_id = EXCLUDED.department_id,
        sub_department_id = EXCLUDED.sub_department_id,
        business_unit_id = EXCLUDED.business_unit_id,
        location_id = EXCLUDED.location_id,
        phase_id = EXCLUDED.phase_id,
        level_id = EXCLUDED.level_id,
        recruiter_email = EXCLUDED.recruiter_email,
        secondary_recruiter_email = EXCLUDED.secondary_recruiter_email,
        active_flag = true,
        status = 'open',
        updated_at = NOW()`,
      [
        jobId,
        jobTitle,
        departmentId,
        subDepartmentId,
        buId,
        locationId,
        phaseId,
        levelId,
        clean(row['Permanent/Contractual']).toLowerCase() || 'permanent',
        clean(row['New/ Replacement']).toLowerCase().includes('replacement') ? 'replacement' : 'new',
        Number(row['Number of openings']) || 1,
        recruiter?.employee_email || null,
        secondary?.employee_email || clean(row['Another recriter']) || null,
        ACTOR,
        dateOnly(row['Position Opened on']),
      ]
    );
    jobsCreated += 1;

    const candidateName = clean(row['Candidate Name']);
    if (!candidateName) continue;
    const applicationId = `BACKFILL-APP-${String(index + 2).padStart(5, '0')}`;
    const status = clean(row.Status).toLowerCase() === 'offered'
      ? 'Offered'
      : clean(row.Selected).toLowerCase() === 'selected'
        ? 'Selected'
        : 'Applied';
    const candidateEmail = `backfill+${slug(candidateName)}.${index + 2}@premierenergies.invalid`;
    const remarks = [
      clean(row.Remarks),
      clean(row['Solar/Non Solar']) ? `Solar tag: ${clean(row['Solar/Non Solar'])}` : '',
      dateOnly(row['Selection Date']) ? `Selection date: ${dateOnly(row['Selection Date'])}` : '',
      dateOnly(row['Offered Date']) ? `Offered date: ${dateOnly(row['Offered Date'])}` : '',
    ].filter(Boolean).join('\n');

    await client.query(
      `INSERT INTO applications (
        application_id, ats_job_id, status, candidate_name, candidate_email, source, recruiter_email,
        joining_date, interviewer_feedback_remarks, created_by, uploaded_by, talent_pool_only, active_flag
      ) VALUES ($1,$2,$3,$4,$5,'Open and offered tracker',$6,$7,$8,$9,$9,false,true)
      ON CONFLICT (application_id) DO UPDATE SET
        ats_job_id = EXCLUDED.ats_job_id,
        status = EXCLUDED.status,
        candidate_name = EXCLUDED.candidate_name,
        recruiter_email = EXCLUDED.recruiter_email,
        joining_date = EXCLUDED.joining_date,
        interviewer_feedback_remarks = EXCLUDED.interviewer_feedback_remarks,
        active_flag = true,
        updated_at = NOW()`,
      [applicationId, jobId, status, candidateName, candidateEmail, recruiter?.employee_email || null, dateOnly(row.EDOJ), remarks || null, ACTOR]
    );
    applicationsCreated += 1;
  }

  return { rows: rows.length, jobsCreated, applicationsCreated };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await syncMasters(client);
    await syncApprovers(client);
    await cleanupOperationalData(client);
    const backfill = process.argv.includes('--skip-backfill') ? null : await backfillTracker(client);
    await syncMasters(client);
    await client.query('COMMIT');
    console.log(JSON.stringify({ ok: true, backfill }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
