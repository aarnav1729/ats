# Premier Energies ATS  User Guide

**Version**: 2.1 (Phase 0–10 rebuild) · **Last updated**: April 2026

A complete, code-aligned manual for the Premier Energies Applicant Tracking System. Every screen, action, status, email, schema column, and TAT pair documented in one place.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Roles & Access Control](#2-roles--access-control)
3. [End-to-End Hiring Flow](#3-end-to-end-hiring-flow)
4. [Pages Reference](#4-pages-reference)
5. [Application Status Map](#5-application-status-map)
6. [TAT Engine](#6-tat-engine)
7. [Audit Deck](#7-audit-deck)
8. [Email System](#8-email-system)
9. [Database Schema Reference](#9-database-schema-reference)
10. [API Reference](#10-api-reference)
11. [Operations & Setup](#11-operations--setup)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Overview & Architecture

The Premier Energies ATS is a single-tenant, role-based hiring platform spanning the full lifecycle: **requisition → approval → job → sourcing → interview → selection → documents → CTC → offer → joining**.

**Stack**:
- **Server**: Node.js + Express, PostgreSQL via `pg`, JWT auth, Microsoft Graph for outbound email
- **Client**: React 18 + Vite + Tailwind CSS, design-token CSS layer (`v2.css`)
- **AI**: Local Ollama for resume parsing + analytics copilot (graceful fallback if unavailable)
- **Reminders**: Setinterval-based poll runner (`reminders.js`)  no external job queue
- **Brand**: `pel.png` logo + `l.png` wordmark, served at `/pel.png` and `/l.png`

**Top-level project layout**:
```
ats/
├─ server/
│  ├─ index.js              ← Express bootstrap
│  ├─ middleware/auth.js    ← JWT + role gates
│  ├─ migrations/run.js     ← Idempotent schema (npm run migrate)
│  ├─ routes/               ← One file per endpoint family
│  └─ services/             ← Email, AI, TAT, audit, timeline, reminders
└─ client/
   ├─ src/
   │  ├─ pages/             ← Top-level routes (28 pages)
   │  ├─ components/        ← Shared widgets (TriageMenu, SignaturePad, …)
   │  ├─ components/ui/     ← Design system primitives
   │  ├─ services/api.js    ← Axios + endpoint families
   │  └─ styles/            ← index.css + v2.css token layers
```

---

## 2. Roles & Access Control

Five built-in roles, defined in `users.role`:

| Role | Capabilities |
|---|---|
| **`hr_admin`** | Everything: masters, users, all approvals, all data, audit deck, demo seed, blacklist lift |
| **`hr_recruiter`** | Sourcing, triage, interviews, document reviews scoped to own assignments, CTC drafting |
| **`hod`** | Raise requisitions, approve at HOD/CXO stage when listed in `approvers_master`, view assigned candidates |
| **`interviewer`** | View assigned candidates, suggest slots, submit feedback, request more rounds |
| **`applicant`** | Candidate Portal  chat, document uploads, CTC accept, offer signature |

**Login**: passwordless OTP. `POST /api/auth/login` issues a 6-digit code expiring in 5 minutes via Graph email; `POST /api/auth/verify-otp` exchanges it for a JWT. Logout calls `POST /api/auth/logout` which writes a `session/delete` audit row.

**Default admin**: created on first migration with `is_default = true`. Cannot be deactivated or have role changed.

**Role gates** (defined in `middleware/auth.js`):
```js
requireRole('hr_admin')               // strict admin only
requireRole('hr_admin', 'hr_recruiter') // admin OR recruiter
```

---

## 3. End-to-End Hiring Flow

```
[ Requisition ] → [ Approval ] → [ Job ] → [ Sourcing ] → [ Triage ]
        ↓             ↓            ↓                         ↓
   created_by    cxo, hr_admin  recruiter assigned    public apply or upload

[ Triage ] → [ Shortlist ] → [ Interview rounds ] → [ Selected ]
                  ↓               ↓                       ↓
            override rounds   schedule, no-show,    documents loop
                              more rounds

[ Documents cleared ] → [ CTC chain ] → [ CTC accepted ] → [ Offer letter ]
                            ↓               ↓                     ↓
                     recruiter1 → 2 →   candidate accepts    digital signature
                     hr_admin →
                     optional approver

[ Offer signed ] → [ Joining date ] → [ Joined / Postpone / Dropout ]
```

### 3.1 Requisition raise

1. Navigate to `/requisitions/create`
2. Pick **type**: `new_hire` (routes through CXO + HR Admin) or `replacement` (HR Admin only)
3. Fill BU/Department/Sub-Department/Location/Phase/Grade/Level + position table
4. Submit:
   - Status set by `resolveSubmissionStatus()` based on type + role
   - `requisition_approvals` rows created via `replaceApprovalSteps()`
   - **Notifications**: admin alert email (`requisitionRaisedAdminEmail`), raiser confirmation email (`requisitionRaisedConfirmationEmail`), in-app to all approvers

### 3.2 Approval

- CXO approver acts via `POST /api/requisitions/:id/approve`
- After all CXO clear → status moves to `pending_hr_admin_approval` and HR Admin approval steps are inserted
- HR Admin approves → `status = approved`, `approved_at` set
- Either side can `POST /:id/reject` with comments → `rejected` or `cxo_rejected`

### 3.3 Job creation

After approval, HR Admin chooses one of three paths from the Requisition Detail page:

| Path | Result |
|---|---|
| **Create Job** | Opens `/jobs/create` prefilled with the requisition; recruiter can add `hr_one_job_id` + interviewer rounds. Notifies recruiter + admin + raiser on save. |
| **Assign Recruiter(s)** | `POST /:id/assign-recruiter`  writes `requisitions.assigned_recruiter_email`, emails them. |
| **Hold with reason** | `POST /api/requisition-holds`  TAT pause begins, hold reason emailed to raiser + recruiters. |

### 3.4 Sourcing  application intake

Two intake paths:

| Path | Initial status | Notes |
|---|---|---|
| **Self-apply** via `/careers/:jobId` | `InQueue` | Confirmation email sent (`applicationReceivedEmail`); recruiter notified |
| **Recruiter upload** | `Applied` | Source captured from upload form (LinkedIn / Naukri / Referral / etc.) |

**Public apply gate** (`server/routes/public.js`):
- Job must be `active_flag=true` AND status not in `closed/archived/on_hold/filled/cancelled`
- Phone is checked against `blacklisted_phones`; banned applicants get a generic 403 message
- Resume upload uses crypto-random filename so concurrent submissions can't collide

### 3.5 Triage actions

Available via `<TriageMenu>` on every candidate row (Job Detail, Talent Pool, Application Workflow):

| Action | Endpoint | Side effects |
|---|---|---|
| **Shortlist** | `POST /api/triage/:id/shortlist` | Status → `AwaitingHODResponse`. Optional per-candidate rounds + interviewer override saved to `application_round_overrides` with provenance. Round-1 interviewers emailed. |
| **Move to job** | `POST /api/triage/:id/move-to-job` | Status → `Applied` in target job. Searchable picker shows full label including HR One ID. |
| **Move to talent pool** | `POST /api/triage/:id/move-to-talent-pool` | `ats_job_id='TP-POOL'`, status `TalentPool`. Movement row in `talent_pool_movements` retains from-job + reason + actor. |
| **HR reject** | `POST /api/triage/:id/hr-reject` | Status → `HRRejected`. Goldman-style polite decline email auto-sent (`politeDeclineEmail`). |
| **Blacklist** | `POST /api/blacklist` | Phone banned in `blacklisted_phones`. Status → `Blacklisted`. Admins emailed with resume attached as Graph base64 attachment. |

### 3.6 Interview flow

1. **Shortlisted** → `AwaitingHODResponse` notifies first-round interviewers
2. Interviewer reviews via `/interviews` and either:
   - **Suggests slots** → status → `AwaitingInterviewScheduling`
   - **Rejects** with reason → `HODRejected` (option to retain in talent pool)
3. Recruiter confirms a slot OR overrides with own time picker → status → `Round1`
4. After interview + 10-minute buffer:
   - **No-show** allowed (425 returned if too early). Candidate gets the empathic 24h grace email (`noShowGraceEmail`). Application returns to `AwaitingInterviewScheduling`.
   - **Feedback submission** with technical/behavioral/fit scores + decision:
     - `shortlist` (mid-rounds) → next round, or → `Selected` if final round
     - `reject` → `Round{N}Rejected`
     - `request additional rounds` → adds rounds with new interviewers + suggested slots, status → `AwaitingInterviewScheduling`
5. Reminder runner (`reminders.js`) auto-schedules T-24h and T-30m candidate emails when a slot is confirmed

### 3.7 Documents loop

Triggered when status reaches `Selected`. Default document set is seeded by `ensureDefaultSelectedDocuments()`:

| Stage | Documents |
|---|---|
| `before_offer_release` | PAN, Aadhaar, Latest payslip / Bank statement, Offer letter / Employment proof |
| `before_joining` | (recruiter adds custom requests) |
| `joining_day` | (recruiter adds custom requests) |

**Loop**:
1. HR adds documents/questions via Document Review Queue
2. Candidate uploads via Candidate Portal (`POST /api/candidate-portal/documents/:docId/upload`)
3. Recruiter reviews via `/hr/document-queue`:
   - **Accept** → status `accepted`
   - **Reject with comment** → status `rejected`, candidate notified to re-upload
4. Candidate re-uploads → version bumps; cycle continues
5. Once all documents `accepted` → status moves to `DocumentsCleared` (recruiter manually advances)

### 3.8 CTC chain

Triggered after documents cleared. 2–4 step chain stored in `ctc_approval_chain`:

```
[Recruiter 1 drafts] → [Optional Recruiter 2] → [HR Admin] → [Optional Approver]
       ↓                       ↓                   ↓               ↓
  approve / reject /     same options          same options    same options
   renegotiate
```

Each step can **approve** (forward), **reject** (`SalaryRejected`, candidate returns to TP), or **renegotiate** (back to Recruiter 1). On final approval, candidate gets `ctcAcceptanceEmailV2` and status moves to `CTCAcceptance` (14-day validity).

### 3.9 Offer + signature + joining

1. After candidate accepts CTC (`ctc.accepted`), recruiter uploads offer letter PDF (`POST /api/offers/:id/upload`)
   - Default validity 14 days
   - Auto-schedules T-3d and T-1d reminder emails to candidate
   - Status → `SignaturePending`
2. Candidate views offer + signs digitally on `<SignaturePad>` canvas:
   - Captures base64 PNG signature, IP, UTC timestamp
   - Status → `OfferAccepted` (or `OfferRejected` / `OfferDropout` if declined)
   - Stakeholders emailed (recruiter, secondary, requisition creator, admin)
3. Recruiter sets tentative joining date (`POST /:id/joining`)
   - Schedules joining-day reminder for 09:00 IST
4. On joining day, recruiter records outcome (`POST /:id/joining-outcome`):
   - `joined` → status `Joined`
   - `postpone` → status `Postponed` with new date + reason
   - `dropout` → status `OfferDropout` with dropout reason

---

## 4. Pages Reference

### 4.1 `/`  Dashboard
Hero + KPIs (open jobs, applications, offer acceptance, avg time to fill) + funnel + recruiter momentum + needs-attention queue. Demo seeding controls for HR Admin.

### 4.2 `/requisitions`  Requisitions
List with status filters. Statuses: `draft / pending_approval / pending_cxo_approval / pending_hr_admin_approval / approved / rejected / cxo_rejected / closed / on_hold`.

### 4.3 `/requisitions/create` & `/:id/edit`  Create Requisition
Wizard: type → BU/Dept → Position table (per-row hire window + backfill data) → Approvers preview → Submit.

### 4.4 `/requisitions/:id`  Requisition Detail
Tabs: Overview, Approvals timeline, Holds, Audit. Approve/Reject buttons gate by role + pending step ownership.

### 4.5 `/jobs`  Jobs
Card and table view. Filters by status / BU / department. Bulk export with/without applicants via `/api/mis/jobs-export?include_applicants=true|false`.

### 4.6 `/jobs/create` & `/jobs/:id/edit`  Create Job
Multi-step wizard: Identity → Compensation → Description → Visibility → Interview Design (rounds + per-round interviewer chips). New `hr_one_job_id` field on Visibility step.

### 4.7 `/jobs/:id`  Job Detail
Three tabs:
- **Workflow Queue**  sticky search bar, full-width table with `<TriageMenu>` on every row
- **Pipeline View**  kanban with 5 lanes (Sourcing → Screening → Interview → Selection → Onboarding)
- **Job Settings**  full-width with Identity / Compensation / Description sections + Hold with reason CTA

### 4.8 `/talent-pool`  Talent Pool
Candidates with `ats_job_id='TP-POOL'`. Each card shows the movement history ("Moved here from ROLE-XYZ by alice@... on Apr 12").

### 4.9 `/applications/:id/workflow`  Application Workflow
Per-candidate command centre. Timeline rail, document checklist, CTC chain modal trigger, interview history, chat trigger.

### 4.10 `/interviews`  Interview Hub
Interviewer-facing list of assigned candidates. Suggest slots, submit feedback, request more rounds, mark no-show.

### 4.11 `/candidate`  Candidate Portal (applicants only)
Hero + offer signature panel + chat panel + document upload cards by stage + CTC acceptance section.

### 4.12 `/hr/document-queue`  Document Review Queue
Scoped to recruiter's own applications (full visibility for HR Admin). Approve / Reject with comment.

### 4.13 `/users`  User Management
Active + Inactive lists (Masters-style split). Applicants shown in their own table. Reactivate from inactive list.

### 4.14 `/masters`  Masters
Tabs for BUs, Departments, Sub-Departments, Locations, Phases, Grades, Levels, Sources, Approvers Master, Reasons.

### 4.15 `/aop`  AOP Dashboard
Annual Operating Plan headcount tracking by BU + grade.

### 4.16 `/mis`  MIS Reports
Multi-tab analytics: Funnel, Time-to-fill, Recruiter momentum, Source mix, Demographics, Detailed open positions, Raw export. Filters: date range, recruiter, **talent_pool (include / exclude / only)**, **hr_one_job_id**.

### 4.17 `/tat`  TAT Explorer
Hero + level toggle (Requisition / Job / Application) + pair picker + KPI tiles (P50, P90, missing) + full table + **"Show working"** modal that displays the actual rows used to compute each duration plus raw JSON.

### 4.18 `/audit`  Audit Deck
Thread-grouped cards. Filters by action type, entity, actor, date range, field-search. Stats KPIs. JSON export.

### 4.19 `/notifications`  Notifications inbox
In-app notifications with mark-read, mark-all-read.

### 4.20 `/analytics-copilot`  Analytics Copilot
Natural-language Q&A over MIS data. Falls back to data-driven summary if Ollama unavailable.

---

## 5. Application Status Map

All statuses defined in `server/services/interviewWorkflow.js`. Total: **31 statuses**.

| Status | Meaning | Reachable from | Reachable to |
|---|---|---|---|
| `InQueue` | Self-applied, awaiting first triage | (initial) | Applied, Shortlisted, HRRejected, Withdrawn, Blacklisted, TalentPool |
| `Applied` | Recruiter-uploaded or moved-from-other-job | InQueue, (initial) | Shortlisted, HRRejected, Withdrawn, Blacklisted, TalentPool |
| `Shortlisted` | Triaged in, awaiting HOD acknowledge | Applied | AwaitingHODResponse, HRRejected, Withdrawn, TalentPool, Blacklisted |
| `AwaitingHODResponse` | HOD/Interviewer needs to suggest slots or reject | Shortlisted | AwaitingInterviewScheduling, HODRejected, Withdrawn, TalentPool |
| `AwaitingInterviewScheduling` | Slots suggested, recruiter to confirm | AwaitingHODResponse, post-no-show, post-additional-rounds | Round1/2/3, HRRejected, Withdrawn, TalentPool |
| `Round1`, `Round2`, `Round3` | Confirmed interview | AwaitingInterviewScheduling, prior round | Round{N}Rejected, AwaitingFeedback, next round, Selected, Withdrawn, TalentPool |
| `Round{N}Rejected` | Round-specific rejection | Round{N} | TalentPool (re-entry) |
| `AwaitingFeedback` | Interview occurred, feedback pending | Round{N} | Selected, Round{N}Rejected, AwaitingInterviewScheduling, Withdrawn, TalentPool |
| `Selected` | Final-round shortlist confirmed | Round{final}, AwaitingFeedback | DocumentsInProgress, CTCSent, OfferInProcess, OfferRejected, Withdrawn, TalentPool |
| `DocumentsInProgress` | Doc uploads + reviews in flight | Selected | DocumentsCleared, Withdrawn, TalentPool, OfferDropout |
| `DocumentsCleared` | All required docs accepted | DocumentsInProgress | CTCSent, TalentPool, Withdrawn |
| `CTCSent` | CTC chain in motion | DocumentsCleared, Selected | CTCAcceptance, CTCAccepted, SalaryRejected, TalentPool, Withdrawn |
| `CTCAcceptance` | Candidate review, 14-day window | CTCSent | CTCAccepted, SalaryRejected, OfferDropout, TalentPool |
| `CTCAccepted` | Candidate accepted | CTCAcceptance | OfferInProcess, OfferDropout, Withdrawn |
| `SalaryRejected` | HR Admin / approver rejected the CTC | any CTC step | TalentPool, CTCSent (re-draft) |
| `OfferInProcess` | Recruiter preparing offer letter | CTCAccepted, Selected | SignaturePending, Offered, OfferRejected, OfferDropout, Withdrawn |
| `SignaturePending` | Letter uploaded, awaiting candidate signature | OfferInProcess | Offered, OfferRejected, OfferDropout |
| `Offered` | Candidate signed | SignaturePending, OfferInProcess | OfferAccepted, OfferRejected, OfferDropout |
| `OfferAccepted` | Explicit acceptance recorded | Offered | Postponed, Joined, OfferDropout |
| `Postponed` | Joining date pushed | OfferAccepted | Joined, OfferDropout, OfferAccepted |
| `Joined` | Candidate actually joined (terminal) | OfferAccepted, Postponed |  |
| `OfferRejected` | Candidate declined offer (terminal) | various |  |
| `OfferDropout` | No-show / pulled out (terminal) | various |  |
| `HRRejected` | HR rejected with reason (terminal) | InQueue, Applied, Shortlisted, etc. |  |
| `HODRejected` | HOD rejected (terminal) | AwaitingHODResponse | TalentPool (re-entry) |
| `Withdrawn` | Candidate withdrew (terminal) | many |  |
| `Blacklisted` | Phone-banned (terminal) | many |  |
| `TalentPool` | Parked, full history retained | many | Applied, Shortlisted, Withdrawn, Blacklisted |

The transition map is enforced server-side by `assertHrManagedTransition()` in `server/services/interviewWorkflow.js`. **Terminal states** cannot be transitioned out of (except `TalentPool`, `HODRejected`, `Round{N}Rejected`, `SalaryRejected` which allow re-entry into the active pipeline).

---

## 6. TAT Engine

Defined in `server/services/tat.js`. **16 named pairs** spanning three levels.

### 6.1 Pair structure

```js
{
  id: 'applied_to_joined',          // stable machine id
  label: 'Applied → Joined (end-to-end)',
  level: 'application',             // requisition | job | application
  description: 'Total candidate journey...',
  from: { source: 'audit_trail', entity_type: 'application', action_type: 'create' },
  to:   { source: 'timeline_events', entity: 'application', event_type: 'application.joined' },
  excludeWhen: ['job.status=on_hold'],  // optional pause conditions
}
```

### 6.2 Source resolvers

| `source` | Lookup | Example match shape |
|---|---|---|
| `column` | Reads a column from a single row | `{ table: 'requisitions', column: 'submitted_at' }` |
| `audit_trail` | First or last row in `audit_trail` matching entity + action | `{ entity_type: 'application', action_type: 'create' }` |
| `timeline_events` | First or last row in `timeline_events` matching entity + event_type | `{ entity: 'application', event_type: 'application.shortlisted' }` |

The `first: true` flag picks the earliest match (used for "first interview scheduled" etc.); default is most recent.

### 6.3 Defined pairs

**Requisition lifecycle**
- `req_raised_to_first_approval`  submitted_at → first approval audit row
- `req_raised_to_final_approval`  submitted_at → approved_at
- `req_approved_to_job_created`  approved_at → linked job.created_at

**Job lifecycle**
- `job_created_to_first_application`  job.created_at → first application creation audit
- `job_created_to_first_offer`  job.created_at → first `application.offered` event
- `job_created_to_first_join`  job.created_at → first `application.joined` event

**Per-application stage TATs**
- `applied_to_shortlisted`
- `shortlisted_to_first_interview`
- `shortlisted_to_selected`
- `selected_to_documents_cleared`
- `documents_cleared_to_ctc_sent`
- `ctc_sent_to_ctc_approved`
- `ctc_approved_to_candidate_accepted`
- `ctc_accepted_to_offer_released`
- `offer_released_to_candidate_signed`
- `offer_signed_to_joined`

**End-to-end**
- `applied_to_joined`  full journey

### 6.4 "Show working" modal

Every row in the TAT Explorer has a `Show working →` link that opens a modal containing:
1. The pair's plain-English description
2. The `from` and `to` timestamps (in IST) plus the source identifier
3. A `<details>` block with the raw row JSON used to derive each side

This makes every TAT number unambiguously auditable.

### 6.5 API

```
GET /api/tat/pairs?level=application
GET /api/tat/calculate?pair=...&entityId=...&entityType=...
GET /api/tat/grid?level=application&pair=...&limit=200
```

The grid endpoint returns one row per entity in scope with both the calculated duration and the source rows. Powers the explorer table.

---

## 7. Audit Deck

`/audit` (HR Admin only). Every mutation in the system writes to `audit_trail`:

```
audit_trail (
  id, action_by, action_type, entity_type, entity_id,
  before_state JSONB, after_state JSONB, metadata JSONB,
  created_at TIMESTAMP
)
```

### 7.1 Action types

Common values written by `logAudit()`:
- `create`, `update`, `delete`
- `approve`, `reject`, `cxo_reject`, `hr_reject`
- `blacklist`, `unblacklist`
- `assign_recruiter`, `clear_recruiter`
- `hold`, `resume`
- `move_job`, `move_talent_pool`
- `upload`, `approve_doc`, `reject_doc`
- `send_email`, `status_transition`, `schedule`

### 7.2 UI features

- **Thread grouping**: consecutive actions on the same entity within 30 minutes merge into one card
- **Diff pills**: red strike-through old value → emerald new value, key-prefixed
- **IST timestamps + relative time**: "Apr 25, 2026, 03:42 PM IST · 2h ago"
- **Field search**: full-text search inside `before_state`/`after_state` JSON
- **JSON export**: filtered entries exported as a single JSON file
- **Technical details `<details>`**: raw before/after/metadata JSON collapsed by default

---

## 8. Email System

### 8.1 Branded shell (`emailBrand.js`)

All transactional emails pass through `renderBrandedEmail({ title, bodyHtml, cta, context, preheader })`. Style is Goldman-recruiting-inspired:
- Single column, max 580px
- Header band with `pel.png` logo + wordmark
- Body in 15px serif-fallback sans, 1.65 line height
- Exactly one CTA per email
- Footer with IST timestamp + brand line

### 8.2 Transactional templates (`txEmails.js`)

| Template | When sent |
|---|---|
| `applicationReceivedEmail` | Self-applied candidate, immediately |
| `politeDeclineEmail` | HR / HOD reject with reason |
| `interviewScheduledEmail` | Slot confirmed |
| `interviewReminderEmail` | T-24h, T-30m via reminder runner |
| `noShowGraceEmail` | Candidate marked no-show |
| `ctcAcceptanceEmailV2` | CTC chain fully approved |
| `offerLetterReadyEmail` | Recruiter uploaded offer PDF |
| `offerExpiringEmail` | T-3d, T-1d before expiry |
| `joiningReminderEmail` | 09:00 IST on joining date |
| `blacklistAdminAlertEmail` | Phone blacklisted, with resume attached |
| `requisitionRaisedAdminEmail` | Req submitted (admin alert) |
| `requisitionRaisedConfirmationEmail` | Req submitted (raiser confirmation) |
| `jobAssignedRecruiterEmail` | Job assigned to recruiter |
| `jobOnHoldEmail` | Job placed on hold |
| `shortlistInterviewerEmail` | Candidate shortlisted, interviewer notified |
| `ctcReviewEmail` | CTC chain step assigned to a reviewer |
| `joiningOutcomeEmail` | Joined / Postponed / Dropout recorded |

### 8.3 Delivery

- Outbound via Microsoft Graph (`server/services/email.js`)
- Configured via env: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_EMAIL`
- Every send is logged to `email_log` with `template_id`, `to_addresses`, `cc_addresses`, `subject`, `delivery_status`
- All times rendered in IST via `formatIST()` (`Asia/Kolkata`, `Intl.DateTimeFormat`)

### 8.4 Reminder runner (`reminders.js`)

Polls `scheduled_reminders` every 30 seconds for due jobs. Handlers:
- `interview.t24h`, `interview.t30m` (candidate)
- `interview.t24h.internal` (recruiter/interviewer)
- `offer.expiring` (T-3d, T-1d)
- `joining.day` (recruiter)

Failed attempts retry up to 5 times then move to `failed`.

---

## 9. Database Schema Reference

All tables defined in `server/migrations/run.js`. **Idempotent**  safe to re-run. Below: every table grouped by domain.

### 9.1 Identity & Access

```sql
users (id, email UNIQUE, role, name, is_active, is_default, created_at, updated_at)
otps  (id, email, otp, expires_at, used, created_at)
notifications (id, user_email, title, message, link, read_flag, created_at)
```

### 9.2 Masters

```sql
business_units    (id, bu_name UNIQUE, bu_short_name, active_flag, …)
departments       (id, business_unit_id, department_name, active_flag)
sub_departments   (id, department_id, sub_department_name, active_flag)
locations         (id, location_name, active_flag)
phases            (id, location_id, phase_name, active_flag)
grades            (id, grade UNIQUE, active_flag)
levels            (id, level UNIQUE, active_flag)
sources           (id, source_name UNIQUE, active_flag)
reasons           (id, reason_type, reason_text, active_flag)
approvers_master  (id, employee_email, employee_name, role, business_unit_id, active_flag)
```

### 9.3 Hiring

```sql
requisitions (
  id, requisition_id UNIQUE, job_title, priority, requisition_type, job_type,
  business_unit_id, department_id, sub_department_id, location_id, phase_id,
  grade_id, level_id, experience_years, total_positions,
  start_hire_date, target_hire_date,
  status, current_approval_stage, approval_route JSONB, cxo_approval_required,
  approved_by, approved_at, approval_comments,
  submitted_by, submitted_at,
  created_by, created_at, updated_by, updated_at,
  active_flag, additional_comments, attachments JSONB
)

requisition_positions (id, requisition_id, position_type, location_id, phase_id,
  start_hire_date, target_hire_date, number_of_positions,
  backfill_employee_id, backfill_employee_name, backfill_employee_email, backfill_reason_id)

requisition_approvals (id, requisition_id, approver_email, approver_name, approver_role,
  approval_stage, status, comments, acted_by_email, acted_at, sequence)

requisition_holds (id, requisition_id, reason, placed_by_email, placed_at, lifted_at, lifted_by_email)

jobs (
  id, job_id UNIQUE, requisition_id, job_title, status,
  business_unit_id, department_id, sub_department_id, location_id, phase_id,
  grade_id, level_id, experience_years, job_type, requisition_type,
  job_description, additional_comments,
  compensation_currency, compensation_min, compensation_max,
  reapply_days, hiring_flow JSONB, interviewer_emails JSONB,
  publish_to_careers, allow_employee_apply, allow_employee_refer,
  number_of_positions, total_positions,
  hr_one_job_id,         -- Phase 0
  hr_one_job_ids JSONB,  -- legacy plural
  recruiter_email, secondary_recruiter_email,
  priority, active_flag,
  created_by, created_at, updated_by, updated_at
)

applications (
  id, application_id UNIQUE, ats_job_id, candidate_name, candidate_email, candidate_phone,
  candidate_age, candidate_gender, candidate_years_of_experience,
  current_organization, current_ctc, current_location, willing_to_relocate, education_level,
  source, referrer_emp_id, consultant_code, referral_flag,
  resume_path, resume_file_name, resume_flag, resume_text_preview,
  recruiter_email, secondary_recruiter_email,
  status, no_of_rounds, interviewers JSONB,
  suggested_interview_datetime1, suggested_interview_datetime2,
  interviewer_technical_score, interviewer_behavioral_score, interviewer_company_fit_score,
  interviewer_final_decision, interviewer_feedback_remarks,
  joining_date, rejected_by_email, rejection_reason, dropout_reason,
  talent_pool_only, talent_pool_expires_at,
  banned_flag, ban_scope, banned_reason,
  active_flag, is_duplicate, created_by, created_at, updated_at
)
```

### 9.4 Interview & Documents

```sql
interview_feedback (id, application_id, job_id, round_number, interviewer_email,
  scheduled_datetime, actual_datetime, status,
  technical_score, behavioral_score, company_fit_score,
  remarks, decision, rejection_reasons JSONB, attachments JSONB,
  no_show_reason, no_show_marked_by, …)

candidate_documents (id, application_id, stage, document_name, description,
  status, file_path, file_name, version, uploaded_at, uploaded_by_email,
  reviewed_by_email, reviewed_at, rejection_reason, …)

application_round_overrides (id, application_id, round_number, interviewer_emails JSONB,
  added_by_email, added_by_role, added_at, reason,
  UNIQUE(application_id, round_number))
```

### 9.5 CTC, Offers, Joining

```sql
candidate_clearance (id, application_id, status, ctc_data JSONB, ctc_text,
  primary_cleared_by, primary_cleared_at, secondary_cleared_by, secondary_cleared_at,
  hr_action, hr_action_by, hr_action_at, hr_comments,
  cxo_email, cxo_action, cxo_action_at, cxo_comments,
  aop_inline, aop_exceeded_amount, renegotiation_count)

ctc_acceptance_requests (id, application_id, requested_by, ctc_snapshot JSONB, ctc_text,
  status, responded_at, response_notes, token UNIQUE, expires_at)  -- Phase 0

ctc_approval_chain (id, application_id, step_index, role_required, assignee_email,
  assignee_name, status, acted_at, comments, ctc_text, ctc_snapshot JSONB, created_at)

offer_letters (id, application_id, file_path, file_name, uploaded_by_email, uploaded_at,
  candidate_signed_at, candidate_signature_data, candidate_signature_ip,
  candidate_decision, candidate_decision_notes, decision_at,
  validity_days, expires_at)

joining_events (id, application_id, event_type, old_date, new_date, reason,
  committed_by_email, committed_at)
```

### 9.6 Talent Pool & Blacklist

```sql
talent_pool_movements (id, application_id, candidate_email, candidate_phone,
  from_job_id, to_job_id DEFAULT 'TP-POOL', from_status,
  moved_by_email, moved_by_role, reason, moved_at)

blacklisted_phones (id, phone UNIQUE, candidate_email, candidate_name,
  reason, blacklisted_by_email, blacklisted_at, lifted_at, lifted_by_email)

-- Synthetic job seeded by the migration so applications can carry ats_job_id='TP-POOL':
INSERT INTO jobs (job_id, job_title, status, active_flag, total_positions, created_by)
SELECT 'TP-POOL', 'Talent Pool', 'open', true, 0, 'system@premierenergies.com'
WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE job_id = 'TP-POOL');
```

### 9.7 Chat

```sql
candidate_chat_messages (id, application_id, sender_email, sender_role,
  body, attachment_path, attachment_name, read_by_recipient, created_at)
```

### 9.8 Audit, Timeline, Email log

```sql
audit_trail (id, action_by, action_type, entity_type, entity_id,
  before_state JSONB, after_state JSONB, metadata JSONB, created_at)

timeline_events (id, entity_type, entity_id, event_type, stage,
  actor_email, actor_role, summary, payload JSONB,
  from_state, to_state, created_at)

email_log (id, sent_by, to_addresses JSONB, cc_addresses JSONB,
  subject, body_html, context_type, context_id, sent_at,
  template_id, delivery_status, error_message)  -- last 3 are Phase 0
```

### 9.9 Scheduling

```sql
scheduled_reminders (id, kind, run_at, payload JSONB, status,
  attempts, last_error, processed_at, created_at)
```

`status` = `pending | sent | cancelled | failed`. Polled every 30s by `services/reminders.js`.

---

## 10. API Reference

All endpoints prefixed with `/api`. Auth via `Authorization: Bearer <jwt>` on protected routes.

### 10.1 Public

```
POST   /auth/login                         { email } → OTP sent
POST   /auth/verify-otp                    { email, otp } → { token, user }
GET    /auth/me                            → user profile
POST   /auth/logout                        → 200 + audit row
GET    /public/jobs/:jobId                 → public job detail (404 if closed)
POST   /public/parse-resume                multipart, returns parsed fields
POST   /public/jobs/:jobId/apply           multipart or JSON, creates application
```

### 10.2 Hiring

```
GET    /requisitions                       paginated list
POST   /requisitions                       create
PUT    /requisitions/:id                   update (re-routes approvals)
GET    /requisitions/:id                   detail with approval steps
POST   /requisitions/:id/approve           CXO or HR Admin approve
POST   /requisitions/:id/reject            with reason
POST   /requisitions/:id/assign-recruiter  assign recruiter
GET    /requisition-holds/:requisitionId   list holds
POST   /requisition-holds                  place hold
POST   /requisition-holds/:id/lift         lift hold

GET    /jobs                               paginated list
POST   /jobs                                create
PUT    /jobs/:id                           update (incl. hr_one_job_id, hold flow)
GET    /jobs/:id                           detail
DELETE /jobs/:id                           archive (sets status='archived')
POST   /jobs/:id/publish                   toggle publish_to_careers
GET    /jobs/:id/qr-code                   QR code image

GET    /applications                       paginated list
POST   /applications                        create
PUT    /applications/:id                   update
PUT    /applications/:id/status            transition (validates against map)
DELETE /applications/:id                   soft-delete
POST   /applications/parse-excel           multipart bulk parse
POST   /applications/upload-resume         multipart resume upload
POST   /applications/bulk-upload-excel     multipart bulk
POST   /applications/bulk-upload-resumes   multipart bulk
PUT    /applications/:id/interview-plan    update no_of_rounds + interviewers
POST   /applications/:id/move-stage        legacy stage move
```

### 10.3 Triage & Blacklist

```
POST   /triage/:id/shortlist               { no_of_rounds, interviewers_per_round }
POST   /triage/:id/move-to-job             { target_job_id }
POST   /triage/:id/move-to-talent-pool     { reason }
POST   /triage/:id/hr-reject               { reason }
GET    /triage/jobs/searchable             ?q= → live search

GET    /blacklist                          list bans
POST   /blacklist                          { application_id, reason }
POST   /blacklist/check                    { phone } → { blacklisted, reason }
DELETE /blacklist/:phone                   lift (admin only)
```

### 10.4 Interviews

```
GET    /interviews                          per-user assigned candidates
PUT    /interviews/:id/suggest-slots       interviewer suggests two
PUT    /interviews/:id/confirm-slot        recruiter confirms or overrides
PUT    /interviews/:id/feedback            scores + decision
PUT    /interviews/:id/mark-no-show        with 10-min lockout
PUT    /interviews/:id/request-additional-rounds  with new interviewers + slots
```

### 10.5 Documents & Chat

```
GET    /candidate-portal/me                candidate's own application + docs
POST   /candidate-portal/documents/:docId/upload  multipart
GET    /candidate-portal/review-queue      HR review queue (recruiter-scoped)
POST   /candidate-portal/documents/:docId/review  { decision, review_notes }
POST   /candidate-portal/:applicationId/ctc-request  HR sends CTC
POST   /candidate-portal/ctc-request/:id/respond  candidate accepts / declines / renegotiates

GET    /chat/:applicationId/thread          recruiter view
POST   /chat/:applicationId/send            recruiter send (multipart)
GET    /chat/me/thread                      candidate view
POST   /chat/me/send                        candidate send (multipart)
```

### 10.6 CTC chain & Offers

```
POST   /ctc-chain/:applicationId/start      { ctc_text, ctc_snapshot, secondary_recruiter_email, approver_email }
GET    /ctc-chain/:applicationId/chain      list steps
POST   /ctc-chain/:applicationId/act        { decision: approved|rejected|renegotiate, comments }
POST   /ctc-chain/me/accept                 candidate accepts CTC

POST   /offers/:applicationId/upload        multipart, recruiter uploads PDF
GET    /offers/me/current                   candidate's active offer
POST   /offers/me/sign                      { signature_data, decision, decision_notes }
POST   /offers/:applicationId/joining       { joining_date, reason, event_type }
POST   /offers/:applicationId/joining-outcome  { outcome: joined|postpone|dropout, reason }
```

### 10.7 Analytics

```
GET    /mis/headline                        org-level KPIs
GET    /mis/funnel                          stage distribution
GET    /mis/monthly-offers                  recruiter × month
GET    /mis/recruiter-sourcing              recruiter × source
GET    /mis/time-to-fill                    job-level fill TAT
GET    /mis/source-mix                      source-wise totals
GET    /mis/department-health               per-department metrics
GET    /mis/backouts-summary                rejected/dropout reasons
GET    /mis/raw-export                      one row per application  every column
GET    /mis/jobs-export?include_applicants= one row per job (or job × app)
GET    /mis/detailed-open-positions         workbook-style aging report
POST   /mis/assistant                       { question } → AI answer

GET    /tat/pairs?level=                    catalog
GET    /tat/calculate                       single calc
GET    /tat/grid?level=&pair=               table for explorer

GET    /audit                               list with filters
GET    /audit/stats                         KPI summary
GET    /audit/export                        filtered JSON export

GET    /timeline?entity_type=&entity_id=    polymorphic timeline
```

### 10.8 Filters available on MIS

Every MIS endpoint shares `buildFilters()`:

```
date_from, date_to             ISO date strings, inclusive
recruiter_email | recruiter
business_unit_id, department_id, location_id, phase_id
hr_one_job_id                  exact match
status                          string or array
source                          string
talent_pool                    'include' (default) | 'exclude' | 'only'
```

---

## 11. Operations & Setup

### 11.1 First-time setup

```bash
# 1. Install all deps
npm run install:all

# 2. Set up Ollama for resume parsing (optional but recommended)
npm run setup:ai

# 3. Create .env in project root with:
#    PG_URL=postgres://user:pass@host/db?sslmode=require
#    JWT_SECRET=<random 64 hex>
#    APP_URL=https://ats.premierenergies.com
#    GRAPH_TENANT_ID=...
#    GRAPH_CLIENT_ID=...
#    GRAPH_CLIENT_SECRET=...
#    GRAPH_SENDER_EMAIL=spot@premierenergies.com

# 4. Apply schema
npm run migrate

# 5. Seed defaults
npm run seed

# 6. Boot
npm run dev
```

### 11.2 Daily operations

| Task | How |
|---|---|
| Add a recruiter | `/users` → + Add User |
| Configure org chart | `/masters` → BU / Dept / Location tabs |
| Define approver mapping | `/masters` → Approvers Master |
| Open a job | Approve a requisition → "Create Job" |
| Bulk-upload candidates | `/jobs/:id` → "+ Add Candidate" → "Bulk from Excel" or "Bulk from Resumes" |
| Ban a phone | Candidate row → Triage → Blacklist (with reason) |
| Lift a ban | `/audit` shows blacklist row; HR Admin uses `DELETE /api/blacklist/:phone` |
| Move multiple candidates to TP | One at a time via Triage menu (intentional, audited) |
| Run a TAT analysis | `/tat` → pick level + pair → Show working on any row |
| Export raw data | `/mis` → Raw Export tab → Export CSV |
| Review document loop | `/hr/document-queue` |

### 11.3 Demo data

HR Admin can:
- **Seed demo**  populates BUs, jobs, applicants for screenshots/demos
- **Clear demo**  wipes all demo-tagged data
- **Run full demo**  animates a candidate through the entire flow

### 11.4 Logs & monitoring

- `email_log`  every outbound email with delivery status
- `audit_trail`  every mutation
- `timeline_events`  polymorphic event log for entity timelines
- `scheduled_reminders`  pending + sent + failed reminders

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run migrate` fails with NOT NULL on `created_by` | Old jobs row missing `system@…` | Migration now seeds it; re-run after pulling latest |
| Public apply returns 410 "no longer accepting" | Job status is `closed/archived/on_hold/filled/cancelled` | Check job status on `/jobs` |
| Public apply returns 403 "could not be processed" | Phone matches an active blacklist entry | Lift via `/audit` → DELETE `/api/blacklist/:phone` |
| Candidate self-apply gets "duplicate" message | Same email already applied to this exact job | Recruiter checks talent pool; can re-engage |
| Offer signature 410 expired | More than `validity_days` since upload | Recruiter re-uploads offer letter |
| No-show button returns 425 | Less than 10 minutes past scheduled time | Wait for the lockout to clear |
| Reminder runner not firing | `index.js` not invoking `remindersService.start()` | Verify import + call in server bootstrap |
| Status transition rejected | Move violates the transition map | See [§5 Application Status Map](#5-application-status-map) |
| TAT shows "missing" for "from" or "to" | The required event hasn't been emitted yet | Confirm the underlying transition wrote a `timeline_events` or `audit_trail` row |
| Email log shows `delivery_status='failed'` | Graph credentials invalid or sender not licensed | Verify `GRAPH_*` env vars |
| MIS shows wrong recruiter rows | GROUP BY mismatch between SELECT and aggregation | Already fixed in `routes/mis.js`  uses `COALESCE(...)` consistently |

---

## Appendix A  File Map

### Server
| File | Purpose |
|---|---|
| `server/index.js` | Boot, routes mount, static brand assets, reminder runner start |
| `server/middleware/auth.js` | JWT verify, `requireRole` factory |
| `server/services/email.js` | Graph send + in-app notification |
| `server/services/emailBrand.js` | Branded email shell + IST helpers |
| `server/services/txEmails.js` | 14 transactional templates |
| `server/services/timeline.js` | `logTimeline`, polymorphic event service |
| `server/services/audit.js` | `logAudit` |
| `server/services/tat.js` | TAT pair definitions + resolver |
| `server/services/reminders.js` | Setinterval-based reminder runner |
| `server/services/interviewWorkflow.js` | `assertHrManagedTransition`, `HR_MANAGED_TRANSITIONS`, `ALL_APPLICATION_STATUSES` |
| `server/services/requisitionApproval.js` | Resolve type → status, build approval route |
| `server/services/ai.js` | Ollama-backed resume parsing + assistant |
| `server/routes/triage.js` | Move-to-pool / move-to-job / shortlist / hr-reject |
| `server/routes/blacklist.js` | Phone ban + admin alerts |
| `server/routes/chat.js` | Two-sided message thread |
| `server/routes/offers.js` | Offer upload, signature, joining outcome |
| `server/routes/ctcChain.js` | Recruiter1→Recruiter2→HR Admin→Approver chain |
| `server/routes/tat.js` | `/pairs`, `/calculate`, `/grid` |

### Client
| File | Purpose |
|---|---|
| `client/src/styles/index.css` | Base tokens  Workday/Greenhouse-flavoured |
| `client/src/styles/v2.css` | Premium animations, gradients, primitives layer |
| `client/src/components/ui/v2.jsx` | Hero, KPI, StatusPillV2, TimelineRail, WorkingModal |
| `client/src/components/ui/v2plus.jsx` | AuroraHero, LoudKPI, RingProgress, Sparkline, Marquee, AnimatedNumber, MagneticButton |
| `client/src/components/TriageMenu.jsx` | 5-modal triage dispatcher |
| `client/src/components/SignaturePad.jsx` | Canvas signature capture |
| `client/src/components/OfferSignaturePanel.jsx` | Candidate offer view + sign |
| `client/src/components/CandidateChatPanel.jsx` | Candidate↔Recruiter chat |
| `client/src/components/CtcChainModal.jsx` | HR-side CTC chain UI |
| `client/src/pages/TatExplorer.jsx` | TAT page with Show working modal |
| `client/src/pages/AuditDeck.jsx` | Audit deck with thread grouping + diff pills |

---

*End of guide. Questions or gaps? Open `/audit` to see exactly what happened  every action ever taken in the system is documented there in plain English with IST timestamps.*
