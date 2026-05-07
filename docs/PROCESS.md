# Premier Energies ATS — Operating Process

Canonical end-to-end process for the four operator roles plus the candidate
counterpart. This document is the single source of truth: every page,
endpoint, and state transition must match it. Mismatches are bugs.

> Validated against the live system on 2026-05-07 by `server/full_e2e_v2.cjs`
> — 62/62 paths pass.

---

## 1 · Roles at a glance

| Role | Home screen | Primary responsibility | Special powers |
|------|-------------|------------------------|----------------|
| **HR Recruiter** (`hr_recruiter`) | `/inbox` → `RecruiterHome` | Owns each candidate end-to-end: triage, scheduling, CTC, offer, joining | Cannot approve CTC, cannot release offer without admin |
| **HR Admin** (`hr_admin`) | `/inbox` → `AdminHome` | Final CTC decision, oversight, talent-pool curation | Approve / reject / renegotiate / forward CTC; override stalled items |
| **Interviewer** (`interviewer`) | `/inbox` → `InterviewerHome` | Suggest slots, conduct round, submit feedback | Request additional rounds; mark no-show |
| **Approver** (any role with a forwarded task) | `/ctc-approvals` → `ApproverInbox` | Sign-off on CTC packages forwarded by HR Admin | All forwarded approvers must approve before offer release |
| Candidate (`applicant`) | `/candidate` → `CandidatePortal` | Sign CTC breakup, upload documents, sign offer | n/a |

The home screen is a thin dispatcher (`pages/Inbox.jsx`) that picks the right
dedicated page from the role. Each role's home shows **only the next action**
required per candidate — never a menu of options. The mapping lives in
`utils/nextAction.js`.

---

## 2 · Application status state machine

Single source: `server/services/interviewWorkflow.js` →
`HR_MANAGED_TRANSITIONS`. Every UI move-stage button must satisfy this map.

```
InQueue / Applied
  → Shortlisted          (recruiter triage)
  → HRRejected | TalentPool | Withdrawn | Blacklisted
Shortlisted
  → AwaitingHODResponse  (recruiter sends to HOD)
AwaitingHODResponse
  → AwaitingInterviewScheduling | HODRejected
AwaitingInterviewScheduling
  → Round1 | Round2 | Round3   (HR confirms a slot)
Round{N}
  → Round{N}Rejected | AwaitingFeedback | AwaitingInterviewScheduling | Round{N+1} | Selected
AwaitingFeedback
  → Selected | Round{N}Rejected | AwaitingInterviewScheduling
Selected
  → DocumentsInProgress | CTCSent | OfferInProcess
DocumentsInProgress → DocumentsCleared | OfferDropout
DocumentsCleared    → CTCSent
CTCSent             → CTCAcceptance | CTCAccepted | SalaryRejected
CTCAcceptance       → CTCAccepted | SalaryRejected | OfferDropout
CTCAccepted         → OfferInProcess (after admin/approver approval)
SalaryRejected      → CTCSent | CTCAcceptance | CTCAccepted | TalentPool
OfferInProcess      → SignaturePending (offer letter uploaded)
SignaturePending    → Offered | OfferAccepted (signature captured)
Offered             → OfferAccepted | OfferRejected | OfferDropout
OfferAccepted       → Postponed | Joined | OfferDropout
Postponed           → Joined | OfferAccepted | OfferDropout
```

**Terminal states** (data-correction only): `Joined`, `HRRejected`,
`OfferRejected`, `OfferDropout`, `Withdrawn`, `Blacklisted`.

**Auto-transitions** (the system applies these without an explicit move):

| Trigger | From | To |
|---------|------|-----|
| Final-round shortlist feedback | `Round{final}` | `OfferInProcess` |
| Mid-round shortlist feedback | `Round{N}` | `AwaitingInterviewScheduling` |
| Reject feedback | `Round{N}` | `Round{N}Rejected` |
| CTC breakup posted | any | `CTCAcceptance` |
| Candidate accepts CTC | `CTCAcceptance` | `CTCAccepted` |
| Candidate rejects CTC | `CTCAcceptance` | `SalaryRejected` |
| Admin approves CTC | `CTCAccepted` | `OfferInProcess` |
| Admin renegotiates CTC | `CTCAccepted` | `CTCSent` |
| All approvers approve | `CTCAccepted` | `OfferInProcess` |
| Any approver rejects | any | `TalentPool` |
| Offer letter uploaded | `OfferInProcess` | `SignaturePending` |
| Candidate signs offer | `SignaturePending` | `OfferAccepted` |
| Joining outcome confirmed | `Postponed`/`OfferAccepted` | `Joined` |

---

## 3 · HR Recruiter — process

Recruiter is the candidate's pilot from sourcing through joining.

### 3.1 Source & triage
1. **Receive** a candidate via `Talent Pool → Add Candidate`, public job
   apply (`/careers/:jobId`), bulk Excel upload, or job-detail page.
2. Open the candidate from `RecruiterHome → Triage queue`. Click
   **Triage resume** → opens `/applications/:id/workflow`.
3. From the triage menu, choose:
   - **Shortlist** — `POST /api/triage/:id/shortlist` with
     `no_of_rounds` and `interviewers_per_round`. Defaults pre-fill from the
     parent job. Status → `AwaitingHODResponse`.
   - **HR Reject** — `POST /api/triage/:id/hr-reject` with reason. Status →
     `HRRejected`.
   - **Move to Talent Pool** — `POST /api/triage/:id/move-to-talent-pool`.

### 3.2 Send to HOD
1. After shortlist the application sits in `AwaitingHODResponse`. The HOD
   receives an email; recruiter can chase via the workflow page.
2. HOD approval moves status to `AwaitingInterviewScheduling`
   (`POST /api/applications/:id/move-stage`).

### 3.3 Coordinate interviews
1. Each round creates an `interview_feedback` row per assigned interviewer.
2. Interviewer suggests slots; recruiter confirms one and moves status to
   `Round{N}` (`POST /api/applications/:id/move-stage`).
3. **Reschedule** — `PUT /api/interviews/:id/reschedule` with `new_datetime`,
   `reason`, optional `interview_type`. Calendar event syncs to Outlook.
4. **Wait for feedback**. Recruiter dashboard surfaces "Chase feedback" CTAs.
5. If interviewer requests an additional round
   (`PUT /api/interviews/:id/request-additional-rounds`), recruiter (or admin)
   updates the plan via
   `PUT /api/applications/:id/interview-plan` with new `no_of_rounds` and
   `interviewers`.

### 3.4 Documents
1. On `Selected`, the system auto-seeds a default document set
   (`DEFAULT_SELECTED_DOCUMENTS` — PAN, Aadhaar, payslip, employment proof,
   resignation acceptance, etc.).
2. Add ad-hoc requests via `POST /api/candidates/:id/documents`.
3. Candidate uploads via portal → recruiter accepts/rejects each via
   `PUT /api/candidates/:id/documents/:docId/review`.
4. Status moves to `DocumentsCleared` once all required docs are accepted.

### 3.5 CTC chain
This is the **mandatory** sequence. No step is skippable.

| Step | Endpoint | Status after |
|------|----------|--------------|
| 1. Recruiter posts breakup | `POST /api/ctc-breakup/:id/breakup` | `CTCAcceptance` |
| 2. Candidate signs accept/reject | `POST /api/ctc-breakup/me/breakup/:id/respond` | `CTCAccepted` / `SalaryRejected` |
| 3. Recruiter posts comparison | `POST /api/ctc-breakup/:id/comparison` | unchanged |
| 4. Recruiter 2 clears | `POST /api/ctc-breakup/:id/r2-clear` | unchanged (sets `r2_decision`) |
| 5. HR Admin decides | `POST /api/ctc-breakup/:id/admin-decide` | see §4.2 |
| 6. (optional) Approvers act | `POST /api/ctc-breakup/:id/approver-act` | `OfferInProcess` if all approve |

If candidate rejects (step 2), recruiter posts a revised breakup (step 1
again — versioning is automatic). If admin renegotiates, status returns to
`CTCSent` and the loop restarts.

### 3.6 Offer letter
1. Pre-flight gate (server-enforced in `routes/offers.js`):
   - status must be `OfferInProcess`
   - all required documents accepted
   - active breakup `candidate_decision = accepted`
   - `r2_decision = approved`
   - `admin_decision = approved` **or** all `ctc_approvers` approved
2. Recruiter (or admin) uploads offer PDF via `POST /api/offers/:id/upload`
   (multipart). Status → `SignaturePending`. Reminders auto-scheduled at
   T-3d / T-1d.
3. Candidate signs in portal → `POST /api/offers/me/sign`. Status →
   `OfferAccepted`.

### 3.7 Joining
1. Set joining date: `POST /api/offers/:id/joining`.
2. Confirm outcome: `POST /api/offers/:id/joining-outcome` with
   `outcome: joined | postponed | dropout`. Status → `Joined` /
   `Postponed` / `OfferDropout`.

---

## 4 · HR Admin — process

Admin owns the global view + final CTC decision + recovery tools.

### 4.1 Daily dashboard
`AdminHome` renders 5 KPI tiles + sections in priority order:
1. **Awaiting your approval** — CTC packages waiting on `admin_decision`.
2. **Stalled (>5 days)** — non-terminal candidates with no movement.
3. Sourcing / Interview / Clearance / Offer / Talent-pool stage groups.

### 4.2 CTC admin decision
On any `CTCAccepted` candidate, admin opens `CtcAdminReviewModal` from
the workflow page or `/ctc-approvals` and chooses one of four:

| Decision | Effect | Endpoint payload |
|----------|--------|------------------|
| **Approve** | status → `OfferInProcess`; recruiter notified to release offer | `{ decision: 'approved', notes? }` |
| **Reject** | status → `TalentPool`; talent-pool movement recorded; rejection_reason "CTC too high" auto-selected | `{ decision: 'rejected', notes }` (notes required) |
| **Renegotiate** | status → `CTCSent`; recruiter notified to revise breakup | `{ decision: 'renegotiate', notes }` |
| **Forward** | creates `ctc_approvers` rows; emails picker; awaits all | `{ decision: 'forward', approver_emails: [..] }` (≥1 required) |

### 4.3 Override / recovery
- **Move stage** — admin can move any non-terminal candidate to any
  state allowed by `HR_MANAGED_TRANSITIONS`.
- **Talent pool** — `POST /api/triage/:id/move-to-talent-pool`.
- **Blacklist** — `POST /api/applications/:id/ban`.
- **Bulk status change** — `POST /api/applications/bulk-status` (limited).
- **User management** — `/users` (admin-only).

---

## 5 · Interviewer — process

Interviewer never sees pipelines, candidates outside their assignments, or
CTC data.

### 5.1 Daily dashboard
`InterviewerHome` shows three stacks:
1. **Slots to suggest** — `AwaitingInterviewScheduling` rows the
   interviewer is assigned to.
2. **Feedback you owe** — `Round{N}` / `AwaitingFeedback` rows.
3. **Recent outcomes** — read-only, post-interview context.

### 5.2 Suggest slots
1. Click **Suggest slots** → opens `/interviews/:id/workspace`.
2. Provide two datetimes via
   `PUT /api/interviews/:id/suggest-slots`. HR confirms one; calendar event
   created.

### 5.3 Conduct round & submit feedback
1. After HR confirms a slot, interviewer attends the call (Teams link
   in invite).
2. Submit via `PUT /api/interviews/:id/feedback`:
   - `decision: shortlist` — auto-advances per §2.
   - `decision: reject` — requires `rejection_reasons: string[]`. Status →
     `Round{N}Rejected`.
   - `decision: no_show` — soft-fail, see §5.5.

### 5.4 Request additional rounds
If a round reveals more depth is needed, interviewer can request another
round via `PUT /api/interviews/:id/request-additional-rounds`. Recruiter or
admin then formally extends the plan.

### 5.5 Mark no-show
After scheduled time + 10 minutes lockout, interviewer can mark no-show via
`PUT /api/interviews/:id/mark-no-show` with `reason` (required). Status
reverts to `AwaitingInterviewScheduling` so a fresh slot can be confirmed.

### 5.6 Reschedule (interviewer-driven)
Interviewer can reschedule on their own via the workspace. Same endpoint
as recruiter (`PUT /api/interviews/:id/reschedule`); calendar updates and
invitee notification automatic.

---

## 6 · Approver — process

Approvers are non-HR stakeholders (CFO, BU Head, etc.) that HR Admin
forwards a CTC package to. They have no broader access.

### 6.1 Receive task
- Email arrives with deep link to `/ctc-approvals` (`ApproverInbox` page).
- The page lists "Awaiting your decision" + "Already acted" sections.
- Each card shows the candidate, the breakup HTML inline, and any
  comparison.

### 6.2 Decide
1. Click **Approve** → `POST /api/ctc-breakup/:id/approver-act`
   `{ decision: 'approved' }`.
2. Click **Reject** → requires `comments`.
3. Aggregation rule (server-enforced):
   - **Any approver rejects** → status → `TalentPool` immediately.
   - **All approvers approve** → status → `OfferInProcess`.
   - Otherwise the package stays in `CTCAccepted` waiting on remaining
     decisions.

### 6.3 Visibility
Approvers do **not** see other candidates, the pipeline, or any data
beyond the CTC packages assigned to them. Their dashboard is the
`/ctc-approvals` page only.

---

## 7 · Cross-cutting guarantees

These invariants are enforced server-side and surface in the UI as gates.

1. **Offer release gate** — see §3.6. The upload endpoint will return
   `409` until every condition is satisfied. The recruiter UI greys out
   the upload button and shows the unmet condition.
2. **HR-managed transitions** — every UI button that calls move-stage is
   pre-validated against `HR_MANAGED_TRANSITIONS` server-side. Invalid
   moves return `400`.
3. **Audit + timeline** — every action emits both an `audit_trail` row
   and (for milestone events) a `timeline_events` row. The latter drives
   the in-app timeline rail and TAT explorer.
4. **Email + calendar** — every status change with external impact
   triggers a branded notification (Microsoft Graph, IST timestamps,
   inline-CID logo). Calendar events sync to Outlook for interviews.
5. **Role gating** — every endpoint requires the right role middleware:
   - `requireRole('hr_admin')` — admin-only (e.g., admin-decide, ban)
   - `adminOrRecruiter` — recruiter actions
   - `adminOrInterviewer` — interview operations
   - `candidateOnly` — `/me/...` candidate self-service
6. **Single-action UI** — every role's home page surfaces ONE next CTA
   per candidate. The mapping is in `client/src/utils/nextAction.js`
   and is unit-validated for all 26 statuses × 3 roles = 78 paths.

---

## 8 · Page → endpoint map (alignment table)

| Role | Page | Action | Endpoint |
|------|------|--------|----------|
| Recruiter | `RecruiterHome` | view scoped pipeline | `GET /api/applications?recruiter_email=me` |
| Recruiter | `ApplicationWorkflow` | shortlist | `POST /api/triage/:id/shortlist` |
| Recruiter | `ApplicationWorkflow` | hr-reject | `POST /api/triage/:id/hr-reject` |
| Recruiter | `ApplicationWorkflow` | move stage | `POST /api/applications/:id/move-stage` |
| Recruiter | `ApplicationWorkflow` | post breakup | `POST /api/ctc-breakup/:id/breakup` |
| Recruiter | `ApplicationWorkflow` | post comparison | `POST /api/ctc-breakup/:id/comparison` |
| Recruiter | `DocumentReviewQueue` | review document | `PUT /api/candidates/:id/documents/:docId/review` |
| Recruiter | `ApplicationWorkflow` | offer upload | `POST /api/offers/:id/upload` |
| Recruiter | `ApplicationWorkflow` | joining-outcome | `POST /api/offers/:id/joining-outcome` |
| Recruiter (R2) | `ApplicationWorkflow` | r2-clear | `POST /api/ctc-breakup/:id/r2-clear` |
| Admin | `AdminHome` | full pipeline | `GET /api/applications` |
| Admin | `CtcAdminReviewModal` | admin-decide | `POST /api/ctc-breakup/:id/admin-decide` |
| Admin | `UserManagement` | manage users | `/api/users` |
| Interviewer | `InterviewerHome` | scoped feed | `GET /api/interviews` |
| Interviewer | `InterviewWorkspace` | suggest slots | `PUT /api/interviews/:id/suggest-slots` |
| Interviewer | `InterviewWorkspace` | feedback | `PUT /api/interviews/:id/feedback` |
| Interviewer | `InterviewWorkspace` | reschedule | `PUT /api/interviews/:id/reschedule` |
| Interviewer | `InterviewWorkspace` | mark no-show | `PUT /api/interviews/:id/mark-no-show` |
| Interviewer | `InterviewWorkspace` | request additional rounds | `PUT /api/interviews/:id/request-additional-rounds` |
| Approver | `ApproverInbox` | list tasks | `GET /api/ctc-breakup/me/approver-tasks` |
| Approver | `ApproverInbox` | act | `POST /api/ctc-breakup/:id/approver-act` |
| Candidate | `CandidatePortal` | sign breakup | `POST /api/ctc-breakup/me/breakup/:id/respond` |
| Candidate | `CandidatePortal` | upload doc | `POST /api/candidates/:id/documents/:docId/upload` |
| Candidate | `CandidatePortal` | sign offer | `POST /api/offers/me/sign` |

---

## 9 · Test coverage

The end-to-end suite at `server/full_e2e_v2.cjs` exercises every path in
this document against a live server. Run:

```bash
cd server && node full_e2e_v2.cjs
```

Latest run: **62 / 62 pass** (Scenario A happy path with reschedule +
additional rounds, B Round-1 reject, C no-show, D full CTC chain with
candidate-reject + admin-renegotiate + offer + joining).

Front-end next-action correctness is verified by static simulation —
all 78 (status × role) combinations resolve to a registered route.
