import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

function buildPgConfigFromUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

function buildSsl(host, url) {
  if (process.env.PG_CA_CERT_PATH) {
    try {
      const ca = fs.readFileSync(path.resolve(__dirname, '..', process.env.PG_CA_CERT_PATH), 'utf8');
      return { rejectUnauthorized: true, ca };
    } catch { /* fall through */ }
  }
  if (url.includes('sslmode=require') || url.includes('aivencloud.com')) {
    return { rejectUnauthorized: false };
  }
  return false;
}

export async function ensureSchema() {
  const url = process.env.PG_URL;
  if (!url) {
    console.error('PG_URL is not set in .env');
    process.exit(1);
  }

  const pgConfig = buildPgConfigFromUrl(url);
  const ssl = buildSsl(pgConfig.host, url);
  const pool = new Pool({
    ...pgConfig,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT || 15000),
  });

  console.log('Running migrations...');

  const sql = `
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      role VARCHAR(50) NOT NULL CHECK (role IN ('hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod')),
      name VARCHAR(255),
      is_active BOOLEAN DEFAULT true,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- OTP table
    CREATE TABLE IF NOT EXISTS otps (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      otp VARCHAR(6) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Business Units
    CREATE TABLE IF NOT EXISTS business_units (
      id SERIAL PRIMARY KEY,
      bu_name VARCHAR(255) NOT NULL,
      bu_short_name VARCHAR(50) NOT NULL UNIQUE,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Locations
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      bu_short_name VARCHAR(50) REFERENCES business_units(bu_short_name),
      location_name VARCHAR(255) NOT NULL,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Phases
    CREATE TABLE IF NOT EXISTS phases (
      id SERIAL PRIMARY KEY,
      location_name VARCHAR(255) NOT NULL,
      phase_name VARCHAR(255) NOT NULL,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Departments
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      department_name VARCHAR(255) NOT NULL UNIQUE,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- SubDepartments
    CREATE TABLE IF NOT EXISTS sub_departments (
      id SERIAL PRIMARY KEY,
      department_name VARCHAR(255) REFERENCES departments(department_name),
      sub_department_name VARCHAR(255) NOT NULL,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Grades
    CREATE TABLE IF NOT EXISTS grades (
      id SERIAL PRIMARY KEY,
      grade VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Levels
    CREATE TABLE IF NOT EXISTS levels (
      id SERIAL PRIMARY KEY,
      level VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Designations
    CREATE TABLE IF NOT EXISTS designations (
      id SERIAL PRIMARY KEY,
      designation VARCHAR(255) NOT NULL UNIQUE,
      jd_template TEXT,
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Rejection Reasons
    CREATE TABLE IF NOT EXISTS rejection_reasons (
      id SERIAL PRIMARY KEY,
      reason VARCHAR(500) NOT NULL,
      reason_preview VARCHAR(255),
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Backfill Reasons
    CREATE TABLE IF NOT EXISTS backfill_reasons (
      id SERIAL PRIMARY KEY,
      reason VARCHAR(500) NOT NULL,
      reason_preview VARCHAR(255),
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Offer Dropout Reasons
    CREATE TABLE IF NOT EXISTS offer_dropout_reasons (
      id SERIAL PRIMARY KEY,
      reason VARCHAR(500) NOT NULL,
      reason_preview VARCHAR(255),
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- AOP (Annual Operating Plan)
    CREATE TABLE IF NOT EXISTS aop (
      id SERIAL PRIMARY KEY,
      business_unit_id INTEGER REFERENCES business_units(id),
      department_id INTEGER REFERENCES departments(id),
      max_headcount INTEGER NOT NULL DEFAULT 0,
      fiscal_year VARCHAR(20),
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(business_unit_id, department_id, fiscal_year)
    );

    -- Requisitions
    CREATE TABLE IF NOT EXISTS requisitions (
      id SERIAL PRIMARY KEY,
      requisition_id VARCHAR(100) UNIQUE NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      updated_by VARCHAR(255),
      job_title VARCHAR(255),
      priority BOOLEAN DEFAULT false,
      department_id INTEGER REFERENCES departments(id),
      sub_department_id INTEGER REFERENCES sub_departments(id),
      experience_years INTEGER,
      grade_id INTEGER REFERENCES grades(id),
      level_id INTEGER REFERENCES levels(id),
      requisition_type VARCHAR(50) CHECK (requisition_type IN ('new_hire', 'backfill', 'both')),
      job_type VARCHAR(50) CHECK (job_type IN ('permanent', 'internship', 'contractual')),
      business_unit_id INTEGER REFERENCES business_units(id),
      start_hire_date DATE,
      target_hire_date DATE,
      submitted_at TIMESTAMP,
      submitted_by VARCHAR(255),
      cxo_approval_required BOOLEAN DEFAULT false,
      current_approval_stage VARCHAR(50),
      approval_route JSONB DEFAULT '[]',
      approved_by VARCHAR(255),
      approved_at TIMESTAMP,
      approval_comments TEXT,
      job_description TEXT,
      additional_comments TEXT,
      attachments JSONB DEFAULT '[]',
      total_positions INTEGER DEFAULT 0,
      assigned_recruiter_email VARCHAR(255),
      assigned_recruiter_assigned_by VARCHAR(255),
      assigned_recruiter_assigned_at TIMESTAMP,
      status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'pending_cxo_approval', 'pending_hr_admin_approval', 'approved', 'rejected', 'cxo_rejected', 'closed', 'on_hold')),
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Requisition Position Details
    CREATE TABLE IF NOT EXISTS requisition_positions (
      id SERIAL PRIMARY KEY,
      requisition_id INTEGER REFERENCES requisitions(id) ON DELETE CASCADE,
      position_type VARCHAR(20) CHECK (position_type IN ('new_hire', 'backfill')),
      location_id INTEGER REFERENCES locations(id),
      phase_id INTEGER REFERENCES phases(id),
      start_hire_date DATE,
      target_hire_date DATE,
      number_of_positions INTEGER DEFAULT 1,
      backfill_employee_id VARCHAR(100),
      backfill_employee_name VARCHAR(255),
      backfill_employee_email VARCHAR(255),
      backfill_reason_id INTEGER REFERENCES backfill_reasons(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS start_hire_date DATE;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS target_hire_date DATE;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(255);
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS cxo_approval_required BOOLEAN DEFAULT false;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS current_approval_stage VARCHAR(50);
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approval_route JSONB DEFAULT '[]';
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255);
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS approval_comments TEXT;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS assigned_recruiter_email VARCHAR(255);
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS assigned_recruiter_assigned_by VARCHAR(255);
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS assigned_recruiter_assigned_at TIMESTAMP;
    ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_status_check;
    ALTER TABLE requisitions ADD CONSTRAINT requisitions_status_check
      CHECK (status IN ('draft', 'pending_approval', 'pending_cxo_approval', 'pending_hr_admin_approval', 'approved', 'rejected', 'cxo_rejected', 'closed', 'on_hold'));

    ALTER TABLE requisition_positions ADD COLUMN IF NOT EXISTS backfill_employee_id VARCHAR(100);
    ALTER TABLE requisition_positions ADD COLUMN IF NOT EXISTS backfill_employee_email VARCHAR(255);

    -- CXO Directory
    CREATE TABLE IF NOT EXISTS cxo_directory (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(100) UNIQUE NOT NULL,
      employee_name VARCHAR(255) NOT NULL,
      employee_email VARCHAR(255),
      designation VARCHAR(255),
      department_name VARCHAR(255),
      sub_department_name VARCHAR(255),
      location_name VARCHAR(255),
      manager_id VARCHAR(100),
      department_scope JSONB DEFAULT '[]',
      sub_department_scope JSONB DEFAULT '[]',
      business_unit_scope JSONB DEFAULT '[]',
      approval_order INTEGER DEFAULT 1,
      notes TEXT,
      is_direct_report BOOLEAN DEFAULT true,
      source VARCHAR(50) DEFAULT 'spot',
      active_flag BOOLEAN DEFAULT true,
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Approvers Master
    CREATE TABLE IF NOT EXISTS approvers_master (
      id SERIAL PRIMARY KEY,
      requisitioner_employee_id VARCHAR(100),
      requisitioner_name VARCHAR(255) NOT NULL,
      requisitioner_email VARCHAR(255) NOT NULL,
      requisitioner_designation VARCHAR(255),
      cxo_employee_id VARCHAR(100),
      cxo_name VARCHAR(255) NOT NULL,
      cxo_email VARCHAR(255) NOT NULL,
      cxo_designation VARCHAR(255),
      active_flag BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requisitioner_email, cxo_email)
    );

    -- Requisition Approval Steps
    CREATE TABLE IF NOT EXISTS requisition_approvals (
      id SERIAL PRIMARY KEY,
      requisition_id INTEGER REFERENCES requisitions(id) ON DELETE CASCADE,
      approval_stage VARCHAR(50) NOT NULL CHECK (approval_stage IN ('cxo', 'hr_admin')),
      approver_email VARCHAR(255) NOT NULL,
      approver_name VARCHAR(255),
      approver_employee_id VARCHAR(100),
      approver_role VARCHAR(50),
      sequence_no INTEGER DEFAULT 1,
      status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
      comments TEXT,
      acted_by_email VARCHAR(255),
      acted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requisition_id, approval_stage, approver_email)
    );

    -- Jobs
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      job_id VARCHAR(100) UNIQUE NOT NULL,
      requisition_id INTEGER REFERENCES requisitions(id),
      status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'on_hold', 'closed', 'archived')),
      job_title VARCHAR(255),
      department_id INTEGER REFERENCES departments(id),
      sub_department_id INTEGER REFERENCES sub_departments(id),
      business_unit_id INTEGER REFERENCES business_units(id),
      location_id INTEGER REFERENCES locations(id),
      phase_id INTEGER REFERENCES phases(id),
      grade_id INTEGER REFERENCES grades(id),
      level_id INTEGER REFERENCES levels(id),
      experience_years INTEGER,
      job_type VARCHAR(50),
      requisition_type VARCHAR(50),
      job_description TEXT,
      additional_comments TEXT,
      compensation_currency VARCHAR(10) DEFAULT 'INR',
      compensation_min NUMERIC(15,2),
      compensation_max NUMERIC(15,2),
      reapply_days INTEGER DEFAULT 90,
      hiring_flow JSONB DEFAULT '["Sourced","Screening","Interview Round 1","Interview Round 2","Interview Round 3","Preboarding","Hired","Archived"]',
      interviewer_emails JSONB DEFAULT '[]',
      publish_to_careers BOOLEAN DEFAULT false,
      allow_employee_apply BOOLEAN DEFAULT false,
      allow_employee_refer BOOLEAN DEFAULT false,
      number_of_positions INTEGER DEFAULT 1,
      hr_one_job_ids JSONB DEFAULT '[]',
      recruiter_email VARCHAR(255),
      secondary_recruiter_email VARCHAR(255),
      priority BOOLEAN DEFAULT false,
      total_positions INTEGER DEFAULT 0,
      active_flag BOOLEAN DEFAULT true,
      created_by VARCHAR(255) NOT NULL,
      updated_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Applications / Talent Pool
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      application_id VARCHAR(100) UNIQUE NOT NULL,
      ats_job_id VARCHAR(100),
      status VARCHAR(50) DEFAULT 'InQueue',
      candidate_name VARCHAR(255) NOT NULL,
      candidate_aadhar VARCHAR(20),
      candidate_pan VARCHAR(20),
      candidate_email VARCHAR(255) NOT NULL,
      candidate_phone VARCHAR(20),
      candidate_age INTEGER,
      candidate_gender VARCHAR(20),
      candidate_years_of_experience NUMERIC(5,1),
      current_organization VARCHAR(255),
      current_ctc NUMERIC(15,2),
      current_location VARCHAR(255),
      willing_to_relocate BOOLEAN DEFAULT false,
      resume_flag BOOLEAN DEFAULT false,
      resume_path TEXT,
      resume_file_name VARCHAR(255),
      education_level VARCHAR(100),
      education_other TEXT,
      source VARCHAR(100),
      referrer_emp_id VARCHAR(100),
      consultant_code VARCHAR(100),
      no_of_rounds INTEGER DEFAULT 3,
      interviewers JSONB DEFAULT '[]',
      interview_datetimes JSONB DEFAULT '[]',
      referral_flag BOOLEAN DEFAULT false,
      multi_apply_flag BOOLEAN DEFAULT false,
      joining_date DATE,
      rejected_by_email VARCHAR(255),
      rejection_reason TEXT,
      suggested_interview_datetime1 TIMESTAMP,
      suggested_interview_datetime2 TIMESTAMP,
      dropout_reason TEXT,
      interviewer_feedback_remarks TEXT,
      interviewer_technical_score INTEGER CHECK (interviewer_technical_score BETWEEN 1 AND 5),
      interviewer_behavioral_score INTEGER CHECK (interviewer_behavioral_score BETWEEN 1 AND 5),
      interviewer_company_fit_score INTEGER CHECK (interviewer_company_fit_score BETWEEN 1 AND 5),
      interviewer_final_decision VARCHAR(50),
      recruiter_email VARCHAR(255),
      talent_pool_only BOOLEAN DEFAULT false,
      talent_pool_expires_at TIMESTAMP,
      banned_flag BOOLEAN DEFAULT false,
      ban_scope VARCHAR(20) CHECK (ban_scope IN ('global', 'role')),
      banned_role VARCHAR(255),
      banned_reason TEXT,
      banned_at TIMESTAMP,
      banned_by VARCHAR(255),
      active_flag BOOLEAN DEFAULT true,
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Candidate Documents
    CREATE TABLE IF NOT EXISTS candidate_documents (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      stage VARCHAR(100) NOT NULL CHECK (stage IN ('before_offer_release', 'after_offer_release', 'after_offer_acceptance', 'before_joining', 'joining_day', 'after_joining')),
      document_name VARCHAR(255) NOT NULL,
      description TEXT,
      file_path TEXT,
      file_name VARCHAR(255),
      status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'accepted', 'rejected')),
      rejection_reason TEXT,
      requested_by VARCHAR(255),
      uploaded_at TIMESTAMP,
      reviewed_at TIMESTAMP,
      reviewed_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Interview Feedback
    CREATE TABLE IF NOT EXISTS interview_feedback (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      job_id VARCHAR(100),
      round_number INTEGER NOT NULL,
      interviewer_email VARCHAR(255) NOT NULL,
      scheduled_datetime TIMESTAMP,
      actual_datetime TIMESTAMP,
      calendar_event_id VARCHAR(255),
      calendar_event_organizer VARCHAR(255),
      meeting_join_url TEXT,
      meeting_provider VARCHAR(100),
      calendar_sync_status VARCHAR(50),
      calendar_sync_error TEXT,
      calendar_last_synced_at TIMESTAMP,
      technical_score INTEGER CHECK (technical_score BETWEEN 1 AND 5),
      behavioral_score INTEGER CHECK (behavioral_score BETWEEN 1 AND 5),
      company_fit_score INTEGER CHECK (company_fit_score BETWEEN 1 AND 5),
      remarks TEXT,
      attachments JSONB DEFAULT '[]',
      decision VARCHAR(50) CHECK (decision IN ('shortlist', 'reject', 'no_show', 'pending')),
      rejection_reasons JSONB DEFAULT '[]',
      no_show_reason TEXT,
      no_show_marked_by VARCHAR(255),
      requested_additional_rounds INTEGER DEFAULT 0,
      additional_round_requested_by VARCHAR(255),
      additional_round_requested_at TIMESTAMP,
      additional_round_request_remarks TEXT,
      status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE interview_feedback DROP CONSTRAINT IF EXISTS interview_feedback_status_check;
    ALTER TABLE interview_feedback
      ADD CONSTRAINT interview_feedback_status_check
      CHECK (status IN ('review_pending', 'awaiting_hr_schedule', 'scheduled', 'completed', 'cancelled', 'no_show'));

    -- Audit Trail
    CREATE TABLE IF NOT EXISTS audit_trail (
      id SERIAL PRIMARY KEY,
      action_by VARCHAR(255) NOT NULL,
      action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('create', 'read', 'update', 'delete', 'approve', 'reject', 'reminder', 'message', 'schedule', 'upload')),
      entity_type VARCHAR(100) NOT NULL,
      entity_id VARCHAR(255),
      field_edited VARCHAR(255),
      before_state TEXT,
      after_state TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Messages/Chat
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id),
      sender_email VARCHAR(255) NOT NULL,
      recipient_email VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      read_flag BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT,
      link VARCHAR(500),
      read_flag BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS secondary_recruiter_email VARCHAR(255);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS calendar_event_id VARCHAR(255);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS calendar_event_organizer VARCHAR(255);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS meeting_join_url TEXT;
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS meeting_provider VARCHAR(100);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS calendar_sync_status VARCHAR(50);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT;
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS calendar_last_synced_at TIMESTAMP;
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS no_show_reason TEXT;
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS no_show_marked_by VARCHAR(255);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS requested_additional_rounds INTEGER DEFAULT 0;
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS additional_round_requested_by VARCHAR(255);
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS additional_round_requested_at TIMESTAMP;
    ALTER TABLE interview_feedback ADD COLUMN IF NOT EXISTS additional_round_request_remarks TEXT;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS banned_flag BOOLEAN DEFAULT false;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS ban_scope VARCHAR(20);
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS banned_role VARCHAR(255);
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS banned_reason TEXT;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS banned_by VARCHAR(255);
    ALTER TABLE audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_type_check;
    ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_action_type_check
      CHECK (action_type IN ('create', 'read', 'update', 'delete', 'approve', 'reject', 'reminder', 'message', 'schedule', 'upload'));

    -- Candidate Clearance (post-document approval flow)
    CREATE TABLE IF NOT EXISTS candidate_clearance (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      -- CTC / compensation table
      ctc_data JSONB DEFAULT '{}',
      -- AOP inline check
      aop_inline BOOLEAN DEFAULT true,
      aop_exceeded_amount DECIMAL(14,2) DEFAULT 0,
      -- Primary recruiter clearance
      primary_cleared BOOLEAN DEFAULT false,
      primary_cleared_by VARCHAR(255),
      primary_cleared_at TIMESTAMP,
      -- Secondary recruiter clearance
      secondary_cleared BOOLEAN DEFAULT false,
      secondary_cleared_by VARCHAR(255),
      secondary_cleared_at TIMESTAMP,
      -- HR Admin action
      hr_action VARCHAR(50) DEFAULT 'pending' CHECK (hr_action IN ('pending', 'approved', 'rejected', 'renegotiation', 'sent_to_cxo')),
      hr_action_by VARCHAR(255),
      hr_action_at TIMESTAMP,
      hr_comments TEXT,
      -- CXO approval
      cxo_email VARCHAR(255),
      cxo_action VARCHAR(50) CHECK (cxo_action IN ('pending', 'approved', 'rejected')),
      cxo_action_at TIMESTAMP,
      cxo_comments TEXT,
      -- Renegotiation tracking
      renegotiation_count INTEGER DEFAULT 0,
      -- Status
      status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'primary_review', 'secondary_review', 'hr_review', 'cxo_review', 'approved', 'rejected', 'renegotiation')),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    -- Add secondary_recruiter_email to applications if not exists
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS secondary_recruiter_email VARCHAR(255);

    -- Candidate profile enhancements
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS dob DATE;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(255);
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT false;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS duplicate_of_id INTEGER REFERENCES applications(id);

    -- Email log for configurable email sends
    CREATE TABLE IF NOT EXISTS email_log (
      id SERIAL PRIMARY KEY,
      sent_by VARCHAR(255) NOT NULL,
      to_addresses JSONB NOT NULL DEFAULT '[]',
      cc_addresses JSONB NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL,
      body_html TEXT,
      context_type VARCHAR(100),
      context_id VARCHAR(255),
      sent_at TIMESTAMP DEFAULT NOW()
    );

    -- Universal timeline events: every meaningful action on any entity
    -- (requisition, job, application, clearance, document, offer, hold).
    -- Powers detail-page timelines and TAT-per-step analytics on MIS.
    CREATE TABLE IF NOT EXISTS timeline_events (
      id BIGSERIAL PRIMARY KEY,
      entity_type VARCHAR(40) NOT NULL,
      entity_id VARCHAR(100) NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      stage VARCHAR(80),
      actor_email VARCHAR(255),
      actor_role VARCHAR(50),
      summary TEXT,
      payload JSONB DEFAULT '{}',
      from_state VARCHAR(80),
      to_state VARCHAR(80),
      duration_since_prev_seconds BIGINT,
      hold_paused BOOLEAN DEFAULT false,
      occurred_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_entity ON timeline_events (entity_type, entity_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_timeline_event_type ON timeline_events (event_type, occurred_at);

    -- Requisition holds
    CREATE TABLE IF NOT EXISTS requisition_holds (
      id SERIAL PRIMARY KEY,
      requisition_id INTEGER REFERENCES requisitions(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      notes TEXT,
      placed_by VARCHAR(255) NOT NULL,
      placed_at TIMESTAMP DEFAULT NOW(),
      released_by VARCHAR(255),
      released_at TIMESTAMP,
      notified_emails JSONB DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_req_holds_active ON requisition_holds (requisition_id) WHERE released_at IS NULL;

    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS on_hold BOOLEAN DEFAULT false;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS hold_reason TEXT;
    ALTER TABLE requisitions ADD COLUMN IF NOT EXISTS cumulative_hold_seconds BIGINT DEFAULT 0;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cumulative_hold_seconds BIGINT DEFAULT 0;

    -- Candidate portal linking
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS portal_user_id INTEGER REFERENCES users(id);
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMP;
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS portal_first_login_at TIMESTAMP;

    -- Extend candidate_documents for candidate-initiated uploads + versions + review notes
    ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS uploaded_by_email VARCHAR(255);
    ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
    ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS review_notes TEXT;
    ALTER TABLE candidate_documents ADD COLUMN IF NOT EXISTS kind VARCHAR(40) DEFAULT 'document';
    ALTER TABLE candidate_documents DROP CONSTRAINT IF EXISTS candidate_documents_stage_check;
    ALTER TABLE candidate_documents ADD CONSTRAINT candidate_documents_stage_check
      CHECK (stage IN (
        'before_offer_release', 'after_offer_release', 'after_offer_acceptance',
        'before_joining', 'joining_day', 'after_joining',
        'post_selection', 'ctc_acceptance'
      ));

    -- Dedicated CTC acceptance requests
    CREATE TABLE IF NOT EXISTS ctc_acceptance_requests (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      requested_by VARCHAR(255) NOT NULL,
      requested_at TIMESTAMP DEFAULT NOW(),
      ctc_snapshot JSONB DEFAULT '{}',
      ctc_text TEXT,
      status VARCHAR(40) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'renegotiated')),
      responded_at TIMESTAMP,
      response_notes TEXT,
      token VARCHAR(128) UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_ctc_req_app ON ctc_acceptance_requests (application_id);
    ALTER TABLE ctc_acceptance_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

    -- Store CTC as formatted text alongside JSON
    ALTER TABLE candidate_clearance ADD COLUMN IF NOT EXISTS ctc_text TEXT;
  `;

  try {
    await pool.query(sql);
    console.log('All tables created successfully.');
  } catch (err) {
    console.error('Migration failed:', err?.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  ensureSchema();
}
