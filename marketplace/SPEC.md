# CoverageChiropractor.com — Chiropractic Coverage Marketplace
## Full Build Specification (v1.0)

Owner: Michael L. McPherson, D.C. (BCE)
Contracting entity (agreements/documents only, never shown publicly on the site): Key Global LLC
Target domain: coveragechiropractor.com

---

## 0. Instructions for Claude Code

- Save this file at the repo root as `SPEC.md`. Section 21 contains a short `CLAUDE.md` to also place at the root.
- Build **phase by phase** (Section 19). Do not start a phase until the previous phase's acceptance criteria pass.
- Section 2 lists **platform invariants**. They are non-negotiable. Every one of them must be enforced in code AND covered by automated tests (Section 20). If a design choice would weaken an invariant, stop and ask the owner.
- Anything marked `OWNER DECISION` is a placeholder value. Implement it as a config value, seed it with the placeholder shown, and list it in the admin settings screen. Never hard-code it.
- Anything marked `ATTORNEY REVIEW` must ship behind a feature flag or admin toggle that is OFF by default.
- Prefer boring, well-documented libraries. No custom crypto, no custom payment handling, no custom e-signature.

---

## 1. Product overview

A two-sided marketplace that connects chiropractic clinics needing coverage (a doctor to see patients when the regular doctor is absent) with licensed chiropractors who have open days.

**Clinics** register, post coverage shifts, review applicants and system-recommended doctors, select a doctor (or let the system auto-select), message the doctor, pay through the platform, and rate the doctor.

**Doctors** register, build a verified profile (licenses, malpractice, techniques), set availability, browse and apply to shifts, receive and accept offers, message clinics, get paid through the platform, and rate clinics.

**The platform (owner/admin)** sets all clinic prices and doctor pay (automated rate engine), verifies credentials, keeps the margin between clinic price and doctor pay, and passes 100% of mileage and lodging through to the doctor.

The owner is also a doctor on the platform. His existing office-coverage bookings migrate onto the marketplace as shifts. Home visits and events (thefloridachiropractor.com) are out of scope and remain a separate site.

### 1.1 User roles

| Role | Description |
|---|---|
| `CLINIC_OWNER` | Creates the clinic organization, manages billing, locations, and staff users. Full clinic permissions. |
| `CLINIC_STAFF` | Can post shifts, review/select doctors, message, and rate. Cannot change billing or delete the organization. |
| `DOCTOR` | Independent chiropractor. One account per person. |
| `PLATFORM_ADMIN` | Owner and future staff. Verification, disputes, rates, state enablement, overrides. MFA required. |

### 1.2 Geographic scope

The platform is built for all 50 states + DC from day one, but each state is individually enabled by an admin (Section 14). Launch state: Florida.

---

## 2. Platform invariants (non-negotiable)

### INV-1: Licensure (most important rule in the system)

**A doctor may only be shown, apply to, be offered, be selected for, be confirmed for, or work a shift located in a state where that doctor holds a license that is `VERIFIED` and whose expiration date is after the shift's end time.**

Definitions:
- The shift's state is the state of the `ClinicLocation` it is posted at. That state comes from the **geocoded, verified address** of the location, never from free text typed by a user.
- A doctor's home state, mailing address, or proximity is irrelevant. A Georgia-licensed doctor living 5 miles from a Florida clinic is NOT eligible for that clinic unless they also hold a verified Florida license.
- Licenses with status `PENDING_VERIFICATION`, `EXPIRED`, `SUSPENDED`, `REVOKED`, or `REJECTED` do not count.

Enforcement must exist at **every** layer below (defense in depth):
1. **Shift board / search query**: doctors only see shifts in states where they hold a qualifying license.
2. **Application endpoint**: rejects with `403 LICENSE_STATE_MISMATCH` if not eligible.
3. **Match engine**: hard filter before any scoring (Section 7.1).
4. **Offer creation**: re-checks eligibility.
5. **Selection/confirmation**: re-checks eligibility inside the confirmation transaction.
6. **Database trigger**: an `INSERT`/`UPDATE` trigger on `assignments` raises an exception unless a qualifying license exists (Section 5.3). This is the last line of defense if application code has a bug.
7. **Nightly re-check job**: if a doctor's license stops qualifying, every future assignment in that state is flagged `LICENSE_LAPSED`, the admin is alerted, the clinic and doctor are notified, and backfill starts automatically (Section 7.9).
8. **Pre-shift check**: 24 hours before each shift, re-verify eligibility. Same handling as #7 if it fails.

All eligibility checks must call **one shared function**: `assertDoctorEligibleForShift(doctorId, shiftId)` (plus a set-based version for queries). No other code path may implement its own eligibility logic.

### INV-2: No double-booking
A doctor can never hold two active assignments whose time ranges overlap (including travel buffer, Section 7.8). Enforced by a Postgres exclusion constraint.

### INV-3: Malpractice coverage
A doctor must have a `VERIFIED` malpractice certificate whose expiration is after the shift end. Same enforcement layers as INV-1 (shared function covers both).

### INV-4: No PHI on the platform
The platform never collects, stores, or transmits patient names, patient records, diagnoses, or any protected health information. Message content is screened (Section 10.3). Free-text fields show a notice: "Do not include patient information."

### INV-5: Money flows only through the platform
Clinic payments and doctor payouts happen only through Stripe Connect. The platform never asks doctors or clinics for bank account numbers directly.

### INV-6: A state must be enabled
No shift can be posted at a location in a state whose `StateConfig.enabled = false`. A state cannot be enabled unless `legalReviewComplete = true` (Section 14).

### INV-7: Prices come from the rate engine
Clinics and doctors never set rates. All prices and payouts come from the rate engine (Section 8), with admin override logged in the audit log.

---

## 3. Technical architecture

### 3.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, shared types |
| Frontend | Next.js (App Router) + Tailwind + shadcn/ui | Web app for clinics, doctors, admin; mobile-responsive |
| API | Next.js route handlers or a separate NestJS service (pick one and stay consistent) | |
| Database | PostgreSQL 16 + PostGIS + btree_gist | Geo queries, exclusion constraints, triggers |
| ORM | Prisma (raw SQL migrations for triggers/constraints) | |
| Jobs/timers | BullMQ on Redis | Selection deadlines, offer expirations, cascades, reminders |
| Auth | Auth.js (or Clerk) with email/password + TOTP MFA | MFA mandatory for `PLATFORM_ADMIN` |
| Payments | Stripe Connect (Express accounts) + Stripe Billing customers | Marketplace payouts + 1099s |
| E-signature | Dropbox Sign (HelloSign) API or DocuSign | Legal-grade audit trail |
| Routing/distance | Google Routes API (compute route matrix) + Geocoding API | Real drive time and miles |
| Email | SendGrid (or Postmark) | |
| SMS | Twilio | Urgent shift alerts, offers |
| File storage | Google Cloud Storage (private buckets, signed URLs) | License/malpractice documents |
| Hosting | Google Cloud Run (web + worker) + Cloud SQL (Postgres) + Memorystore (Redis) | Owner already uses GCP |
| Monitoring | Sentry + Cloud Logging + uptime checks | |

Shared hosting (cPanel) is **not** suitable: the matching engine depends on reliable background workers and timers.

### 3.2 Services

- `web`: Next.js app (clinic portal, doctor portal, admin panel, public marketing pages).
- `worker`: BullMQ workers for every scheduled or delayed job (Section 16).
- `db`: Postgres.
- `redis`: queues + short-lived caches (drive-time cache).

### 3.3 Repository layout

```
/apps/web            Next.js app
/apps/worker         BullMQ workers
/packages/db         Prisma schema, migrations, SQL triggers/constraints, seed
/packages/core       Domain logic: eligibility, matching, rate engine, state machines (pure, heavily tested)
/packages/integrations  Stripe, Google Routes, SendGrid, Twilio, e-sign wrappers
/packages/config     Typed config + admin-editable settings loader
/tests               e2e (Playwright) + invariant test suites
```

All business rules live in `/packages/core` as pure functions with no I/O, so they can be unit tested exhaustively.

### 3.4 Time

- Store all timestamps in UTC (`timestamptz`).
- Every `ClinicLocation` has an IANA `timeZone` (derived from geocode). Shift start/end are entered and displayed in the location's time zone.
- All deadline math happens in UTC.

---

## 4. Profiles and onboarding

### 4.1 Doctor profile

Required before a doctor can apply to any shift ("profile complete" gate):
- Legal name, preferred display name, photo, phone (SMS-verified), email (verified)
- Home base address (geocoded; used for drive time and mileage; **never shown to clinics**, only city/state)
- NPI number (auto-validated against the public NPPES NPI Registry API; name must match)
- At least one state license (Section 4.3), verified
- Malpractice certificate of insurance: carrier, policy number, per-occurrence/aggregate limits, expiration date, uploaded PDF, verified
- Techniques (multi-select from `Technique` catalog, with self-rated proficiency 1–3)
- Years in practice, graduation school/year
- Max travel: max one-way drive minutes (default 90), willing to stay overnight (yes/no)
- Stripe Connect Express account onboarded (payouts + W-9/1099 handled by Stripe)
- Signed Doctor Platform Agreement (e-sign, Section 13)

Optional: bio, languages spoken, EHR systems familiar with, X-ray/imaging comfort, patient volume comfort (max patients/day), specialties (sports, pediatrics, prenatal, etc.).

### 4.2 Clinic profile

Organization level:
- Legal business name, display name, logo, owner contact
- Stripe customer with saved payment method (card or ACH)
- Signed Clinic Platform Agreement (e-sign)

Location level (a clinic organization can have many locations, in different states):
- Address (geocoded; state and time zone derived from geocode — see INV-1)
- Location phone, on-site contact name
- Typical patient volume per day, EHR used, techniques used at the practice, equipment (tables, X-ray, modalities)
- Parking/arrival instructions, dress code, notes for covering doctors (shown only after confirmation)

### 4.3 License records (one per state)

Fields: state, license number, license type (default `DC`), issue date, expiration date, status, verification method, verified by, verified at, next re-verification date, uploaded document (optional), board lookup URL.

Statuses: `PENDING_VERIFICATION`, `VERIFIED`, `EXPIRED`, `SUSPENDED`, `REVOKED`, `REJECTED`.

Verification workflow (Phase 1: admin-assisted):
1. Doctor enters state + license number.
2. Admin panel shows a verification task with a direct link to that state's board license lookup (store per-state lookup URLs in `StateConfig.boardLookupUrl`).
3. Admin confirms name, number, status, and expiration match, and records a screenshot/PDF of the board result.
4. Status becomes `VERIFIED`; `nextReverifyAt` = earlier of (expiration − 30 days) or (now + 90 days).

Phase 3: add automated checks where available (FCLB board-action data / CIN-BAD access if obtainable, or a third-party primary-source verification vendor). Keep the admin workflow as the fallback.

Doctors never choose which states they can work in. **Their shift-eligible states are exactly the states with a qualifying license** (INV-1). The UI shows "You can take shifts in: FL, GA" derived from licenses, with a button to add a license.

### 4.4 Techniques catalog

Admin-managed list. Seed: Diversified, Gonstead, Activator, Thompson Drop, Cox Flexion-Distraction, SOT, Logan Basic, Upper Cervical (NUCCA/Atlas Orthogonal/Blair), Graston/IASTM, Active Release Technique, Kinesio Taping, Webster, Torque Release, Instrument adjusting (general), Extremity adjusting, Dry needling (state-dependent scope), Rehab/Corrective exercise.

---

## 5. Data model

Prisma-style schema. Raw SQL for PostGIS columns, triggers, and exclusion constraints lives in migration files.

```prisma
enum Role { CLINIC_OWNER CLINIC_STAFF DOCTOR PLATFORM_ADMIN }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  phone         String?
  passwordHash  String?
  mfaEnabled    Boolean  @default(false)
  role          Role
  doctor        Doctor?
  clinicMembers ClinicMember[]
  createdAt     DateTime @default(now())
  lastLoginAt   DateTime?
}

model Doctor {
  id                   String   @id @default(cuid())
  userId               String   @unique
  legalName            String
  displayName          String
  photoUrl             String?
  npi                  String   @unique
  npiVerifiedAt        DateTime?
  homeAddress          String
  homeLat              Float
  homeLng              Float
  homeCity             String
  homeState            String   // display only; NEVER used for eligibility
  maxDriveMinutes      Int      @default(90)
  willingOvernight     Boolean  @default(false)
  bio                  String?
  yearsInPractice      Int?
  stripeAccountId      String?  @unique
  stripePayoutsEnabled Boolean  @default(false)
  agreementSignedAt    DateTime?
  profileCompleteAt    DateTime?
  status               DoctorStatus @default(ONBOARDING)
  licenses             License[]
  malpractice          MalpracticePolicy[]
  techniques           DoctorTechnique[]
  availability         AvailabilityRule[]
  blackouts            AvailabilityBlackout[]
  applications         Application[]
  offers               Offer[]
  assignments          Assignment[]
  stats                DoctorStats?
}
enum DoctorStatus { ONBOARDING ACTIVE PAUSED SUSPENDED DEACTIVATED }

model License {
  id              String   @id @default(cuid())
  doctorId        String
  state           String   // 2-letter USPS code
  licenseNumber   String
  licenseType     String   @default("DC")
  issuedAt        DateTime?
  expiresAt       DateTime
  status          LicenseStatus @default(PENDING_VERIFICATION)
  verifiedById    String?
  verifiedAt      DateTime?
  verificationEvidenceUrl String?
  nextReverifyAt  DateTime?
  @@unique([doctorId, state, licenseType])
  @@index([state, status, expiresAt])
}
enum LicenseStatus { PENDING_VERIFICATION VERIFIED EXPIRED SUSPENDED REVOKED REJECTED }

model MalpracticePolicy {
  id             String   @id @default(cuid())
  doctorId       String
  carrier        String
  policyNumber   String
  perOccurrence  Int
  aggregate      Int
  expiresAt      DateTime
  documentUrl    String
  status         LicenseStatus @default(PENDING_VERIFICATION) // reuse enum
  verifiedAt     DateTime?
}

model Technique { id String @id @default(cuid()) name String @unique active Boolean @default(true) }
model DoctorTechnique { doctorId String techniqueId String proficiency Int @@id([doctorId, techniqueId]) }

model AvailabilityRule {        // recurring weekly availability
  id        String @id @default(cuid())
  doctorId  String
  weekday   Int     // 0=Sun..6=Sat
  startMin  Int     // minutes from midnight, doctor's home time zone
  endMin    Int
  timeZone  String
}
model AvailabilityBlackout { id String @id @default(cuid()) doctorId String startsAt DateTime endsAt DateTime reason String? }
model AvailabilityOpenDate { id String @id @default(cuid()) doctorId String startsAt DateTime endsAt DateTime } // one-off extra availability

model ClinicOrg {
  id                String   @id @default(cuid())
  legalName         String
  displayName       String
  logoUrl           String?
  stripeCustomerId  String?  @unique
  hasPaymentMethod  Boolean  @default(false)
  agreementSignedAt DateTime?
  status            ClinicStatus @default(ONBOARDING)
  members           ClinicMember[]
  locations         ClinicLocation[]
}
enum ClinicStatus { ONBOARDING ACTIVE SUSPENDED DEACTIVATED }

model ClinicMember { id String @id @default(cuid()) clinicOrgId String userId String role Role }

model ClinicLocation {
  id              String  @id @default(cuid())
  clinicOrgId     String
  name            String
  addressLine1    String
  city            String
  state           String   // FROM GEOCODE ONLY. Changing requires re-geocode + audit log.
  zip             String
  lat             Float
  lng             Float
  timeZone        String
  geocodedAt      DateTime
  rateRegionId    String   // resolved from zip (Section 8)
  patientsPerDay  Int?
  ehr             String?
  arrivalNotes    String?  // visible to confirmed doctor only
  techniques      LocationTechnique[]
}
model LocationTechnique { locationId String techniqueId String @@id([locationId, techniqueId]) }

model ShiftGroup {              // a multi-day coverage request (e.g., a week of vacation coverage)
  id              String  @id @default(cuid())
  locationId      String
  sameDoctorRequired Boolean @default(false)
  shifts          Shift[]
}

model Shift {
  id                 String   @id @default(cuid())
  locationId         String
  shiftGroupId       String?
  state              String   // denormalized copy of location.state at post time; trigger keeps in sync
  startsAt           DateTime
  endsAt             DateTime
  status             ShiftStatus @default(DRAFT)
  requiredTechniqueIds  String[]
  preferredTechniqueIds String[]
  expectedPatients   Int?
  notes              String?
  instantBook        Boolean  @default(false)
  maxTravelBudgetCents Int?    // optional cap on mileage+lodging
  lodgingAllowed     Boolean  @default(false)
  lodgingCapCentsPerNight Int?
  // Pricing snapshot (from rate engine at posting; re-priced at confirmation for mileage)
  clinicPriceCents   Int
  doctorPayCents     Int
  premiumsApplied    Json
  // Matching timeline
  postedAt           DateTime?
  favoritesWindowEndsAt DateTime?
  selectionDeadline  DateTime?
  cascadeStartedAt   DateTime?
  createdById        String
  applications       Application[]
  offers             Offer[]
  assignment         Assignment?
  @@index([state, status, startsAt])
}
enum ShiftStatus { DRAFT OPEN FAVORITES_ONLY SELECTING CASCADING CONFIRMED IN_PROGRESS COMPLETED UNFILLED CANCELLED }

model Application {
  id          String   @id @default(cuid())
  shiftId     String
  doctorId    String
  note        String?
  status      ApplicationStatus @default(ACTIVE)
  scoreAtApply Float
  createdAt   DateTime @default(now())
  withdrawnAt DateTime?
  @@unique([shiftId, doctorId])
}
enum ApplicationStatus { ACTIVE WITHDRAWN SELECTED NOT_SELECTED AUTO_WITHDRAWN_CONFLICT INELIGIBLE }

model Offer {
  id          String   @id @default(cuid())
  shiftId     String
  doctorId    String
  source      OfferSource
  expiresAt   DateTime
  status      OfferStatus @default(PENDING)
  respondedAt DateTime?
  rank        Int?
}
enum OfferSource { CLINIC_PICK CASCADE URGENT_PARALLEL ADMIN }
enum OfferStatus { PENDING ACCEPTED DECLINED EXPIRED WITHDRAWN }

model Assignment {
  id              String   @id @default(cuid())
  shiftId         String   @unique
  doctorId        String
  state           String   // copy of shift.state; checked by trigger
  startsAt        DateTime
  endsAt          DateTime
  bufferedRange   Unsupported("tstzrange")  // start - travel buffer .. end + travel buffer
  status          AssignmentStatus @default(CONFIRMED)
  selectionMethod SelectionMethod
  driveMinutes    Int
  driveMiles      Float
  mileageCents    Int
  lodgingEstimateCents Int @default(0)
  lodgingApprovedCents Int @default(0)
  clinicTotalCents Int
  doctorTotalCents Int
  confirmedAt     DateTime @default(now())
  completedAt     DateTime?
  cancelledAt     DateTime?
  cancelledBy     CancelParty?
  cancelReason    String?
}
enum AssignmentStatus { CONFIRMED IN_PROGRESS COMPLETED CANCELLED LICENSE_LAPSED DISPUTED NO_SHOW }
enum SelectionMethod { CLINIC_PICKED_APPLICANT CLINIC_PICKED_OFFER AUTO_APPLICANT CASCADE_ACCEPT INSTANT_BOOK ADMIN }
enum CancelParty { CLINIC DOCTOR PLATFORM }

model Favorite {                 // directional
  id         String @id @default(cuid())
  fromType   PartyType
  fromId     String   // clinicOrgId or doctorId
  toType     PartyType
  toId       String
  @@unique([fromType, fromId, toType, toId])
}
model Block { id String @id @default(cuid()) fromType PartyType fromId String toType PartyType toId String reason String? }
enum PartyType { CLINIC DOCTOR }

model Rating {
  id            String @id @default(cuid())
  assignmentId  String
  raterType     PartyType
  stars         Int     // 1-5
  categories    Json    // e.g. { punctuality, professionalism, clinicalSkill, communication } or clinic: { organization, staff, accuracyOfPosting }
  comment       String?
  submittedAt   DateTime @default(now())
  revealedAt    DateTime?
  @@unique([assignmentId, raterType])
}

model DoctorStats {             // recomputed by job; read by matcher
  doctorId          String @id
  completedShifts   Int
  lateCancels       Int     // doctor-cancelled < 72h before start, trailing 12 months
  noShows           Int
  ratingSum         Int
  ratingCount       Int
  lastShiftAt       DateTime?
  shiftsThisMonth   Int
}

model MessageThread { id String @id @default(cuid()) clinicOrgId String doctorId String shiftId String? createdAt DateTime @default(now()) }
model Message {
  id        String @id @default(cuid())
  threadId  String
  senderUserId String
  body      String
  redacted  Boolean @default(false)
  flagged   Boolean @default(false)
  createdAt DateTime @default(now())
}

model Payment {                 // clinic-side money
  id               String @id @default(cuid())
  assignmentId     String
  type             PaymentType
  amountCents      Int
  stripePaymentIntentId String?
  status           String
  createdAt        DateTime @default(now())
}
enum PaymentType { DEPOSIT BALANCE CANCELLATION_FEE CONVERSION_FEE REFUND ADJUSTMENT }

model Payout {                  // doctor-side money
  id               String @id @default(cuid())
  assignmentId     String
  amountCents      Int      // pay + mileage + approved lodging
  stripeTransferId String?
  status           String
  releaseAt        DateTime
}

model LodgingReceipt { id String @id @default(cuid()) assignmentId String amountCents Int fileUrl String status String }

model StateConfig {
  state               String  @id    // USPS code
  enabled             Boolean @default(false)
  legalReviewComplete Boolean @default(false)
  legalReviewNotes    String?
  contractorModelNotes String?
  staffingRegistrationRequired Boolean @default(false)
  salesTaxOnStaffing  Boolean @default(false)
  boardLookupUrl      String?
  enabledAt           DateTime?
  enabledById         String?
}

model RateRegion {
  id          String @id @default(cuid())
  state       String
  name        String      // e.g., "FL-Central"
  zip3List    String[]    // ZIP3 prefixes mapped to this region
  tier        Int         // 1 = lowest cost, 4 = highest
}
model RateCard {
  id              String @id @default(cuid())
  rateRegionId    String
  durationTier    DurationTier
  clinicPriceCents Int
  doctorPayCents   Int
  effectiveFrom   DateTime
  effectiveTo     DateTime?
}
enum DurationTier { HALF_DAY FULL_DAY }   // < 4h, 4-8h; >8h = FULL_DAY + overtime

model Setting { key String @id value Json updatedById String updatedAt DateTime @updatedAt }
model AuditLog { id String @id @default(cuid()) actorUserId String? action String entityType String entityId String before Json? after Json? createdAt DateTime @default(now()) }
model Notification { id String @id @default(cuid()) userId String channel String template String payload Json sentAt DateTime? readAt DateTime? }
```

### 5.1 Geo

Add a PostGIS `geography(Point)` column on `Doctor` (home) and `ClinicLocation`, with GiST indexes, for the straight-line prefilter.

### 5.2 Double-booking exclusion constraint (INV-2)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Assignment"
  ADD CONSTRAINT no_doctor_overlap
  EXCLUDE USING gist ("doctorId" WITH =, "bufferedRange" WITH &&)
  WHERE (status IN ('CONFIRMED','IN_PROGRESS'));
```

### 5.3 Licensure trigger (INV-1, INV-3 last line of defense)

```sql
CREATE OR REPLACE FUNCTION enforce_assignment_eligibility() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('CONFIRMED','IN_PROGRESS') THEN
    -- shift state must match assignment state
    IF NEW.state <> (SELECT s.state FROM "Shift" s WHERE s.id = NEW."shiftId") THEN
      RAISE EXCEPTION 'INV-1: assignment state does not match shift state';
    END IF;
    -- verified, unexpired license in the shift's state
    IF NOT EXISTS (
      SELECT 1 FROM "License" l
      WHERE l."doctorId" = NEW."doctorId"
        AND l.state = NEW.state
        AND l.status = 'VERIFIED'
        AND l."expiresAt" > NEW."endsAt"
    ) THEN
      RAISE EXCEPTION 'INV-1: doctor % has no verified license in % valid through shift end', NEW."doctorId", NEW.state;
    END IF;
    -- verified, unexpired malpractice
    IF NOT EXISTS (
      SELECT 1 FROM "MalpracticePolicy" m
      WHERE m."doctorId" = NEW."doctorId"
        AND m.status = 'VERIFIED'
        AND m."expiresAt" > NEW."endsAt"
    ) THEN
      RAISE EXCEPTION 'INV-3: doctor % has no verified malpractice valid through shift end', NEW."doctorId";
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER assignment_eligibility
BEFORE INSERT OR UPDATE ON "Assignment"
FOR EACH ROW EXECUTE FUNCTION enforce_assignment_eligibility();
```

Add a companion trigger on `Shift` that sets `Shift.state` from `ClinicLocation.state` on insert and blocks any update that would make them differ. Add a trigger on `Application` that raises if no qualifying license exists at insert time.

---

## 6. State machines

### 6.1 Shift

```
DRAFT ──post──► FAVORITES_ONLY ──window ends──► OPEN ──selection deadline──► SELECTING
   │                 │                            │                             │
   │                 └──── clinic picks / instant book ─────────────────────────┤
   │                                                                            ▼
   │                                    (auto-pick applicant) ──────────► CONFIRMED
   │                                    (no qualifying applicant) ──► CASCADING ──accept──► CONFIRMED
   │                                                                     │
   │                                                          exhausted ─┴─► UNFILLED (at start time if still unfilled)
   ▼
CANCELLED (from any pre-IN_PROGRESS state)

CONFIRMED ──start time──► IN_PROGRESS ──end time + 2h, no dispute──► COMPLETED
```

Rules:
- `FAVORITES_ONLY` is skipped when the clinic has no eligible favorites or lead time < 48h.
- Posting requires: clinic ACTIVE, payment method on file, location state enabled (INV-6), start ≥ now + 2h.
- If an assignment is cancelled by the doctor or lapses (INV-1), the shift returns to `OPEN` with urgent handling (Section 7.9).

### 6.2 Application
`ACTIVE` → `SELECTED` | `NOT_SELECTED` (when another doctor is confirmed) | `WITHDRAWN` (doctor) | `AUTO_WITHDRAWN_CONFLICT` (doctor confirmed elsewhere for overlapping time) | `INELIGIBLE` (license/malpractice lapsed before selection).

A doctor can withdraw an `ACTIVE` application any time before selection. Once `SELECTED`, withdrawing is a doctor cancellation (reliability impact).

### 6.3 Offer
`PENDING` → `ACCEPTED` | `DECLINED` | `EXPIRED` | `WITHDRAWN` (shift filled by someone else, or eligibility lost).

### 6.4 Assignment
`CONFIRMED` → `IN_PROGRESS` → `COMPLETED`; or → `CANCELLED` | `LICENSE_LAPSED` | `NO_SHOW` | `DISPUTED`.

All state transitions go through a single transition function per entity in `/packages/core` that validates the transition and writes an `AuditLog` row.

---

## 7. Matching engine

All logic lives in `/packages/core/matching`. Pure functions take plain data; the worker/API layers load data and persist results.

### 7.1 Hard filters (eligibility)

A doctor is a **candidate** for a shift only if ALL pass. Implemented once in `getEligibleDoctors(shift)` (set-based SQL) and `assertDoctorEligibleForShift(doctorId, shiftId)` (single check). Both must return identical results for the same data; a test enforces this.

| # | Filter | Rule |
|---|---|---|
| F1 | **State licensure (INV-1)** | Doctor has a `License` with `state = shift.state`, `status = VERIFIED`, `expiresAt > shift.endsAt` |
| F2 | Malpractice (INV-3) | `VERIFIED` policy with `expiresAt > shift.endsAt` |
| F3 | Doctor status | `Doctor.status = ACTIVE`, profile complete, Stripe payouts enabled |
| F4 | Availability | Shift time (plus travel buffer) falls inside an availability rule or open date, and not inside a blackout |
| F5 | No conflict | No overlapping active assignment (INV-2) |
| F6 | Required techniques | Doctor has every technique in `shift.requiredTechniqueIds` |
| F7 | Distance | Drive minutes ≤ doctor's `maxDriveMinutes`, OR doctor `willingOvernight` and shift `lodgingAllowed` |
| F8 | Travel budget | If `shift.maxTravelBudgetCents` is set: estimated mileage + lodging ≤ budget |
| F9 | Blocks | Neither party has blocked the other |
| F10 | Not previously declined | Doctor hasn't declined an offer for this same shift |

**Order of evaluation for performance:** F1 → F2 → F3 → F9 → F6 → F5 → F4 in SQL, then a PostGIS straight-line prefilter (`ST_DWithin` at `maxDriveMinutes × 1.2 miles` as a generous bound), then Google Routes matrix for real drive times on the remaining set only (F7, F8). F1 always runs first and in SQL, so out-of-state doctors never reach the routing API or scoring.

### 7.2 Drive-time cache

Cache drive results in Redis keyed by `(doctorId, locationId, departure-hour bucket)` for 30 days. Invalidate when the doctor's home address changes. Use traffic-aware departure time = shift start − estimated drive.

### 7.3 Scoring

Each candidate gets `score ∈ [0, 1]`:

```
score = 0.25·drive + 0.20·technique + 0.20·reliability + 0.15·rating + 0.15·relationship + 0.05·newDoctor
```

Weights live in `Setting` (`matching.weights`) and are editable in the admin panel. They must sum to 1.0 (validated).

| Component | Formula |
|---|---|
| `drive` | `1 − (driveMinutes / maxAllowed)`, clamped 0–1, where `maxAllowed = min(doctor.maxDriveMinutes, setting matching.maxDriveMinutes [default 180])`. Overnight-eligible candidates beyond that limit get `drive = 0.1`. |
| `technique` | If shift has preferred techniques: `matchedPreferred / totalPreferred`. Else: `min(1, overlap(doctor techniques, location techniques) / 3)`. If no data: 0.5. |
| `reliability` | `(completed + 5) / (completed + 5 + 2·lateCancels + 5·noShows)` over trailing 12 months. The +5 prior means new doctors start near 1.0 and one cancellation doesn't destroy them. |
| `rating` | Bayesian average: `(C·m + ratingSum) / (C + ratingCount)` with `C = 5`, `m = platform mean`; normalized `(avg − 1) / 4`. |
| `relationship` | `0.6·(clinic favorited doctor) + 0.2·(doctor favorited clinic) + 0.05·min(pastCompletedShiftsTogether, 4)`, clamped to 1. |
| `newDoctor` | `1` if `completedShifts < 3`, else `0`. |

**Tie-breakers** (in order): earlier application time → fewer `shiftsThisMonth` (spreads work) → shorter drive → random (seeded by shift ID for reproducibility).

Store the score and its component breakdown on each Application and in a `MatchRun` log (JSON) so the admin can see exactly why a doctor was or wasn't chosen.

### 7.4 Posting and the favorites window

When a clinic posts a shift:
1. Validate INV-6 (state enabled) and price it (Section 8).
2. Compute `leadTime = startsAt − now`.
3. If `leadTime ≥ 48h` and the clinic has ≥1 **eligible** favorite doctor: status `FAVORITES_ONLY` for `matching.favoritesWindowHours` (default 2h). Only eligible favorites see it and are notified (push + SMS + email).
4. Otherwise go straight to `OPEN`.
5. When `OPEN`: notify eligible doctors who have favorited this clinic, plus the top N scored candidates (default 15), plus doctors with a saved alert matching the region. Every notified doctor must pass F1–F10.
6. Set `selectionDeadline` from the table below.

| Lead time at posting | Selection deadline | Offer accept window (cascade) |
|---|---|---|
| ≥ 7 days | posted + 24h | 4h |
| 2–7 days | posted + 6h | 2h |
| < 48h (urgent) | posted + 1h | 30 min, parallel offers (7.7) |

All values are settings. Deadline is also capped so that at least 3 cascade rounds fit before `startsAt − 2h`.

### 7.5 Doctor applies

- Endpoint re-runs `assertDoctorEligibleForShift` (INV-1 etc.). Out-of-state or unlicensed → `403 LICENSE_STATE_MISMATCH` (the shift should never have been visible, so also log a security warning).
- Application stores `scoreAtApply` and an optional note (≤ 500 chars, PHI notice, contact-info redaction, Section 10.3).
- Applying is a commitment: the doctor confirms a checkbox "If selected, I commit to working this shift." They can withdraw freely until selected.
- If `shift.instantBook = true` and the applicant's score ≥ `matching.instantBookMinScore` (default 0.55): confirm immediately (Section 7.8). First qualifying applicant wins.
- A doctor may hold many active applications at once, including overlapping ones. Only one can be confirmed; the rest auto-withdraw (`AUTO_WITHDRAWN_CONFLICT`).

### 7.6 Clinic review and selection

Clinic review screen shows two lists for the shift:
- **Applicants**, sorted by score, with badges (Favorite, Worked here before, New to platform), star rating, reliability, techniques, drive time, city/state, and application note.
- **Recommended**: top eligible non-applicants by score.

Clinic actions:
- **Select an applicant** → confirm immediately.
- **Invite a recommended doctor** → creates an `Offer` (source `CLINIC_PICK`) with the tier's accept window. Clinic can invite up to 3 at once; first to accept wins, the others are withdrawn.
- **Favorite / block** a doctor from the card.

### 7.7 Deadline passes: auto-select and cascade

At `selectionDeadline` (BullMQ delayed job, idempotent):
1. If shift is already confirmed, exit.
2. Re-evaluate every `ACTIVE` application for eligibility (mark failures `INELIGIBLE`) and recompute scores.
3. If the best applicant's score ≥ `matching.autoSelectMinScore` (default 0.45) → confirm that applicant (`AUTO_APPLICANT`).
4. Otherwise → `CASCADING`:
   - Build ranked candidate list (eligible, not already declined), excluding applicants below the threshold only if the clinic has marked them "not a fit."
   - Non-urgent: offer to rank #1, wait the accept window; on decline/expire, offer to #2, etc.
   - Urgent (< 48h to start): send parallel offers to the top 3; first accept wins; others withdrawn. Refill to 3 as offers are declined/expire.
   - Clinic can still pick anyone during cascade; that immediately wins.
5. If the list is exhausted: notify clinic + admin; offer the clinic a one-click "Urgent rate boost" (+ `pricing.boostPercent`, default 15%, applied to both price and doctor pay), which re-runs the cascade with widened distance (`maxDriveMinutes × 1.5` for overnight-willing doctors). F1 licensure is never relaxed.
6. If still unfilled at `startsAt`: status `UNFILLED`, deposit refunded in full.

### 7.8 Confirmation transaction

```
BEGIN;
  SELECT ... FROM "Shift" WHERE id = $1 FOR UPDATE;          -- lock shift
  assert shift status allows confirmation
  assertDoctorEligibleForShift(doctorId, shiftId)            -- INV-1, INV-3 re-check
  compute drive/mileage/lodging, final prices (Section 8)
  INSERT INTO "Assignment" (...)                              -- trigger re-checks INV-1/3; exclusion constraint checks INV-2
  UPDATE Shift → CONFIRMED; Application → SELECTED; others → NOT_SELECTED
  withdraw pending offers for this shift
  auto-withdraw this doctor's overlapping applications/offers elsewhere
COMMIT;
then (outside txn, via queue): charge deposit, create message thread, send notifications, schedule reminders
```

`bufferedRange` = `[startsAt − travelBuffer, endsAt + travelBuffer)` where `travelBuffer` = drive minutes + 30 min.

If the deposit charge fails: notify clinic, give 12h (or 1h if urgent) to fix payment; otherwise cancel assignment (no doctor penalty) and re-open.

### 7.9 Backfill (doctor cancels or license lapses)

- Assignment → `CANCELLED` (doctor) or `LICENSE_LAPSED`.
- Shift → `OPEN` with urgent timing from the table based on time remaining; previous applicants (still eligible) are notified first, then cascade.
- Clinic is notified immediately with a "we're finding a replacement" status.
- Doctor cancellation < 72h counts as `lateCancel`; no-show counts as `noShow` (Section 7.3).

### 7.10 Multi-day shift groups

- `sameDoctorRequired = false`: each day is an independent shift.
- `sameDoctorRequired = true`: doctors apply to the group; eligibility (including INV-1 per day, which is identical since location is fixed, and license expiry after the **last** day) must pass for every day; confirmation creates all assignments in one transaction or none.

---

## 8. Rate engine (pricing)

Clinics and doctors never set prices (INV-7). All logic in `/packages/core/pricing`.

### 8.1 Region resolution
`ClinicLocation.zip` → ZIP3 → `RateRegion`. Unmapped ZIP3 → fall back to the state's default region and create an admin task.

### 8.2 Base price and pay

| Shift length | Tier |
|---|---|
| < 4h | `HALF_DAY` |
| 4–8h | `FULL_DAY` |
| > 8h | `FULL_DAY` + overtime per hour beyond 8 |

`clinicPrice = RateCard.clinicPriceCents(region, tier) + overtimeHours × pricing.overtimeClinicCentsPerHour`
`doctorPay = RateCard.doctorPayCents(region, tier) + overtimeHours × pricing.overtimeDoctorCentsPerHour`

### 8.3 Florida seed (from the owner's current rate card)

| Region | HALF_DAY clinic price | FULL_DAY clinic price | Doctor pay |
|---|---|---|---|
| FL-Central | $325 | $575 | OWNER DECISION |
| FL-North | $375 | $625 | OWNER DECISION |
| FL-South | $375 | $625 | OWNER DECISION |

Overtime clinic price: $100/hour beyond 8h. Overtime doctor pay: OWNER DECISION.
ZIP3 → region mapping for FL: OWNER DECISION (admin screen to assign ZIP3s to regions).

Other states: admin creates regions and rate cards before enabling the state. A state cannot be enabled without a complete rate card for every region (validation).

### 8.4 Premiums
Applied multiplicatively to both clinic price and doctor pay (settings, defaults are OWNER DECISION placeholders):
- Urgent (< 48h at posting): +15%
- Weekend (Sat/Sun in location time zone): +10%
- Federal holiday: +25%
- Clinic-initiated urgent boost (7.7): +15%

Store the list of applied premiums on the Shift (`premiumsApplied`).

### 8.5 Mileage and lodging (100% pass-through to doctor)

- **Mileage** = one-way driving miles (Google Routes, doctor home → location) × `pricing.mileageRatePerMile`. Seed: $0.20/mile one-way (owner's current policy). OWNER DECISION: confirm rate and one-way vs round-trip for the marketplace. Charged to the clinic and paid 100% to the doctor.
- Because mileage depends on which doctor is chosen, the posting screen shows the clinic an **estimated travel range** (from the nearest to the farthest likely candidates), and the exact amount is locked at confirmation. The clinic's optional `maxTravelBudgetCents` is a hard filter (F8).
- **Lodging**: only if `shift.lodgingAllowed`. Triggered when one-way drive > `pricing.lodgingTriggerMinutes` (default 120) or for consecutive days in a shift group. Doctor uploads receipt after the shift; reimbursed up to `lodgingCapCentsPerNight × nights`; clinic charged the same amount; 100% to doctor.

### 8.6 Platform margin
`margin = clinicPrice − doctorPay` (after premiums). Mileage and lodging carry no margin. Admin dashboard reports margin per shift, region, and month.

### 8.7 Display rules
- Clinics see: coverage price, travel (mileage/lodging), total. They do not see doctor pay.
- Doctors see: their pay, mileage, lodging, total. They do not see clinic price.

---

## 9. Payments (Stripe Connect)

### 9.1 Accounts
- Platform: Stripe account under Key Global LLC.
- Doctors: Stripe Connect **Express** accounts (Stripe collects identity, bank details, W-9; issues 1099s).
- Clinics: Stripe Customers with saved card or ACH (SetupIntent at onboarding).

### 9.2 Charge flow (separate charges and transfers)
1. **At confirmation**: charge clinic a deposit of `payments.depositPercent` (seed 10%, matching current booking terms) of the clinic total.
2. **At completion** (`endsAt + 2h`, auto-complete unless the clinic reports a problem): charge the balance, including final mileage.
3. **Lodging**: charged to the clinic when the admin approves the receipt.
4. **Doctor payout**: `Transfer` to the doctor's connected account for doctor pay + mileage + approved lodging, released `payments.payoutHoldHours` (default 48h) after completion if no dispute is open.

### 9.3 Cancellations (all values are settings; seeds follow the owner's current terms)
| Who cancels | When | Clinic | Doctor |
|---|---|---|---|
| Clinic | ≥ 48h before start | Deposit refunded | Nothing owed |
| Clinic | < 48h before start | Deposit forfeited | Receives `payments.lateCancelDoctorShare` of forfeited deposit (OWNER DECISION, seed 50%) |
| Doctor | any time | Full refund; backfill starts | `lateCancel` if < 72h; repeated late cancels → admin review / suspension |
| Doctor no-show | — | Full refund + backfill | `noShow` recorded; admin review |
| Platform (license lapse, safety) | any time | Full refund | No penalty unless doctor failed to report a known lapse |

### 9.4 Disputes
Either party can open a dispute within 48h of shift end. Payout hold extends until an admin resolves it. Admin can issue partial refunds/adjustments (logged).

### 9.5 Conversion fee (non-circumvention)
If a clinic hires or books a doctor outside the platform within 12 months of their first introduction on the platform, the Clinic Agreement allows a conversion fee (amount: ATTORNEY REVIEW / OWNER DECISION). Admin can charge it manually (`PaymentType.CONVERSION_FEE`). No automated detection in v1.

### 9.6 Webhooks
Handle Stripe webhooks server-side with signature verification. Payment/payout state in the database changes only from verified webhooks or server-side API responses, never from client claims. Idempotency keys on every Stripe call.

---

## 10. Messaging

### 10.1 Threads
- One thread per (clinic org, doctor) pair, with messages optionally tagged to a shift.
- Before confirmation: a clinic can message applicants; a doctor can message a clinic about a shift they applied to. Both sides are anonymized to display name + city/state.
- After confirmation: full thread, location arrival notes revealed, on-site contact name revealed. Phone numbers are **still not exchanged** through profile data; the in-app thread and platform SMS relay (Twilio masked numbers, Phase 2) handle day-of communication.

### 10.2 Real-time
WebSocket or server-sent events for live chat; email/SMS digest for unread messages after 10 minutes.

### 10.3 Content screening
Before storing a message:
- **Contact info**: regex-detect phone numbers, emails, URLs, and "text me at" patterns in pre-confirmation messages. Redact and show a notice ("For your protection, contact details are shared through the platform."). After confirmation, allow but flag for admin review if repeated (circumvention signal).
- **PHI (INV-4)**: warn if message contains likely patient identifiers (e.g., "patient" + capitalized name, DOB patterns, "MRN"). Show a warning banner and allow the sender to edit before sending. Log a counter, not the content.
- Attachments: none in v1.

---

## 11. Notifications

Channels: in-app, email, SMS (opt-in, required for urgent alerts), web push (Phase 2). Users set per-event preferences, but offer and confirmation notices cannot be disabled.

| Event | Clinic | Doctor |
|---|---|---|
| Shift posted in your licensed state(s), matching your alerts | — | email/push (SMS if urgent) |
| Favorites-window shift posted | — | SMS + email |
| New application | in-app + email digest | — |
| Offer received | — | SMS + email (with accept/decline links) |
| Offer expiring in 25% of window | — | SMS |
| Selection deadline in 2h, no pick yet | email | — |
| Shift confirmed | email + SMS | email + SMS (with arrival notes) |
| 24h reminder | email | SMS + email |
| Cascade exhausted / unfilled | email + SMS | — |
| Doctor cancelled / license lapsed, backfilling | email + SMS | — |
| Please rate your shift | email | email |
| License or malpractice expiring in 60/30/7 days | — | email (+ SMS at 7 days) |
| Payout sent | — | email |

Every "shift available" notification to a doctor must pass F1–F10 at send time (INV-1).

---

## 12. Ratings and reputation

- After `COMPLETED`, both sides are asked to rate within 14 days.
- **Double-blind**: ratings are revealed only when both are submitted or 14 days pass.
- Doctor rated on: punctuality, professionalism, clinical skill, communication, patient feedback (as reported by clinic). Clinic rated on: accuracy of posting, staff support, organization, would-return.
- Clinic ratings shown to doctors on shift cards; doctor ratings shown to clinics on candidate cards.
- Ratings ≤ 2 stars trigger an admin review task.
- A clinic can favorite a doctor only after a completed shift with them, or from a profile the doctor shared. A doctor can favorite a clinic only after a completed shift there.

---

## 13. Agreements (e-signature)

- **Clinic Platform Agreement** (clinic owner signs at onboarding): services, pricing via rate engine, deposit/cancellation terms, payment authorization, non-circumvention and conversion fee, no PHI on platform, clinic responsibilities (on-site supervision/structure, billing under its own policies, informing patients of covering doctor), ratings, disputes.
- **Doctor Platform Agreement** (doctor signs at onboarding): independent contractor status, duty to keep licenses and malpractice current and to report any board action or lapse within 24 hours, commitment when applying, cancellation/no-show policy, non-circumvention, payment terms, conduct standards.
- Both are templates in the e-sign vendor, versioned. New versions require re-acceptance before the next application or posting.
- Per-shift confirmation emails reference the signed master agreement and summarize the shift terms. No per-shift signature.
- Contracting party on all documents: Key Global LLC. The public site shows only the CoverageChiropractor.com brand.
- ATTORNEY REVIEW: both agreements, per state, before that state is enabled.

---

## 14. State enablement

`StateConfig` per state + DC. Admin "States" screen shows each state with a checklist:

- [ ] Legal review complete (contractor classification, fee-splitting/patient brokering, staffing registration, sales tax) — notes field
- [ ] Rate regions and rate cards complete for all ZIP3s
- [ ] Board license lookup URL set
- [ ] At least N verified doctors (setting, default 10) — warning only, not a hard block

`enabled = true` requires the first three. Enabling/disabling is audit-logged. Disabling a state blocks new postings there but does not cancel confirmed assignments (admin gets a list to review).

---

## 15. Admin panel

- **Dashboard**: open shifts by state, fill rate, time-to-fill, unfilled count, cancellations, revenue, margin, payouts pending.
- **Verification queue**: licenses, malpractice, NPI mismatches; one-click open the state board lookup; approve/reject with evidence upload.
- **Shifts**: search/filter, view match run log (every candidate's score breakdown and why filtered), manual assign (still passes INV-1 via shared function + trigger), cancel, reprice.
- **Doctors / Clinics**: profiles, status changes, suspension, notes, reliability stats, messages flagged for circumvention.
- **Rates**: regions, ZIP3 mapping, rate cards (effective-dated), premiums, mileage rate.
- **Matching settings**: weights, thresholds, windows (all Section 7 settings).
- **States**: Section 14.
- **Disputes & payments**: refunds, adjustments, conversion fees, payout holds.
- **Audit log**: searchable.
- MFA required; every admin write logged with before/after.

---

## 16. Background jobs (BullMQ)

All jobs idempotent and safe to retry.

| Job | Trigger | Action |
|---|---|---|
| `favoritesWindowEnd` | delayed, per shift | `FAVORITES_ONLY` → `OPEN`, notify wider pool |
| `selectionDeadline` | delayed, per shift | Section 7.7 steps 1–4 |
| `offerExpire` | delayed, per offer | Expire; advance cascade |
| `cascadeAdvance` | on decline/expire | Send next offer(s) |
| `shiftStart` | delayed | `CONFIRMED` → `IN_PROGRESS`; if unfilled → `UNFILLED` + refund |
| `shiftAutoComplete` | delayed, end + 2h | → `COMPLETED`; charge balance; schedule payout |
| `payoutRelease` | delayed | Transfer to doctor if no dispute |
| `preShiftEligibilityCheck` | delayed, start − 24h | Re-run INV-1/INV-3; lapse handling |
| `nightlyCredentialSweep` | cron 2:00 AM ET | Expire licenses/policies past `expiresAt`; flag future assignments that no longer qualify (INV-1); create reverify tasks; send expiry reminders |
| `reminders` | delayed | 24h reminders, rating requests |
| `statsRecompute` | cron hourly + on events | `DoctorStats` |
| `alertDigest` | cron | Unread messages, new matching shifts |

---

## 17. API outline

REST (or tRPC) under `/api`. Every doctor-facing shift endpoint filters through the shared eligibility function.

**Auth & onboarding**
- `POST /auth/signup` (role: clinic or doctor), `POST /auth/login`, `POST /auth/mfa/verify`
- `POST /doctors/me/licenses`, `PATCH /doctors/me/licenses/:id`
- `POST /doctors/me/malpractice`
- `PUT /doctors/me/techniques`, `PUT /doctors/me/availability`, `POST /doctors/me/blackouts`
- `POST /doctors/me/stripe/onboarding-link`
- `POST /clinics`, `POST /clinics/:id/locations` (server geocodes; state from geocode only)
- `POST /clinics/:id/payment-method/setup-intent`
- `POST /agreements/:type/sign-link`

**Shifts (clinic)**
- `POST /shifts/quote` → price + travel estimate range
- `POST /shifts` (draft) → `POST /shifts/:id/post`
- `GET /shifts/:id/candidates` → applicants + recommended (scored)
- `POST /shifts/:id/select` { doctorId } (applicant) → confirm
- `POST /shifts/:id/invite` { doctorIds[] } → offers
- `POST /shifts/:id/boost`, `POST /shifts/:id/cancel`

**Shifts (doctor)**
- `GET /shift-board` → **only shifts in the doctor's verified-license states**, passing F1–F10, sorted by score/date, filterable
- `POST /shifts/:id/apply`, `DELETE /applications/:id`
- `POST /offers/:id/accept`, `POST /offers/:id/decline`
- `POST /assignments/:id/cancel`, `POST /assignments/:id/lodging-receipt`

**Shared**
- `POST /favorites`, `DELETE /favorites/:id`, `POST /blocks`
- `GET /threads`, `GET /threads/:id/messages`, `POST /threads/:id/messages`
- `POST /assignments/:id/rating`, `POST /assignments/:id/dispute`

**Webhooks**: `POST /webhooks/stripe`, `POST /webhooks/esign`

**Admin**: `/admin/*` for everything in Section 15.

Errors use a consistent shape: `{ code, message, details }`. Eligibility failures return a specific code (`LICENSE_STATE_MISMATCH`, `LICENSE_EXPIRES_BEFORE_SHIFT`, `MALPRACTICE_INVALID`, `SCHEDULE_CONFLICT`, `STATE_NOT_ENABLED`, etc.).

---

## 18. Key screens

**Public**: home (clinic and doctor value props), how it works, pricing explainer (for clinics), for doctors page, state availability map, FAQ, sign up.

**Clinic portal**: dashboard (upcoming coverage, open shifts, action needed) → post shift wizard (location, date/time, requirements, instant book toggle, lodging, travel budget, price preview) → shift detail (applicants + recommended, countdown to auto-select) → messages → favorites → billing/invoices → locations → team.

**Doctor portal**: dashboard (upcoming shifts, offers with countdown, earnings) → shift board (list + map; header shows "Showing shifts in your licensed states: FL, GA") → shift detail (pay breakdown, clinic rating, apply with commitment checkbox) → availability calendar → credentials (licenses per state with status/expiry, malpractice, "add a state license") → messages → favorites → payouts.

**Admin**: Section 15.

Mobile-first responsive design. Doctors will mostly use phones.

---

## 19. Build phases and acceptance criteria

### Phase 1 — Florida MVP (admin-assisted matching)
Scope: auth + MFA for admins; doctor and clinic onboarding; license/malpractice/NPI verification queue; StateConfig with FL enabled; FL rate regions and rate cards; post shift; shift board; apply; scored candidate list; clinic select; **admin can also select/assign**; confirmation transaction; Stripe Connect deposit/balance/payout; e-sign agreements; basic messaging with contact redaction; email notifications; DB trigger + exclusion constraint; audit log.

Acceptance:
- All INV-1 tests in Section 20 pass.
- A doctor licensed only in GA cannot see, apply to, be invited to, or be assigned to an FL shift through any UI, API, admin action, or direct DB insert.
- End-to-end: clinic posts → doctor applies → clinic selects → deposit charged → shift completes → balance charged → payout transferred (Stripe test mode).
- Clinic never sees doctor pay; doctor never sees clinic price.

### Phase 2 — Automation
Scope: favorites window; selection deadline auto-select; cascade (sequential + urgent parallel); instant book; offer SMS with accept links; backfill on cancellation; ratings (double-blind); favorites/blocks; reliability stats; urgent boost; lodging receipts; disputes; SMS relay; real-time chat; web push.

Acceptance:
- Simulated clock tests for every row of the deadline table.
- Cascade never offers to an ineligible doctor; when all candidates decline, the shift ends `UNFILLED` with a full refund.
- Concurrency test: 20 simultaneous accepts/selections on one shift produce exactly one assignment.

### Phase 3 — Multi-state expansion
Scope: state enablement checklist UI; rate region/ZIP3 tooling; per-state board lookup URLs; automated/primary-source license verification integration; multi-location clinics across states; state sales tax handling if required; state availability map; reporting by state.

Acceptance:
- Doctor with FL + GA licenses sees shifts in both; letting the GA license expire removes GA shifts from their board within one sweep, flags future GA assignments, and starts backfill, while FL shifts are unaffected.
- A clinic org with locations in FL and AL: AL shifts are blocked until AL is enabled.

---

## 20. Testing requirements

### 20.1 Licensure invariant suite (required, must run in CI on every commit)
For each of these, assert the doctor is excluded from the board, candidate list, notifications, offers, and applications, and that a direct `INSERT` into `Assignment` fails at the trigger:
1. Doctor has no license in the shift's state (licensed in a different state only).
2. Doctor lives in the shift's state but is licensed only elsewhere.
3. License in the correct state but `PENDING_VERIFICATION`.
4. License `VERIFIED` but `expiresAt` is before shift end (including expiring mid-shift).
5. License `SUSPENDED` / `REVOKED` / `REJECTED` / `EXPIRED`.
6. Multi-day group where the license expires before the last day.
7. License lapses after confirmation → nightly sweep and 24h pre-check flag it and start backfill.
8. Admin manual assign of an ineligible doctor → blocked with `LICENSE_STATE_MISMATCH`.
9. Attempt to change a location's state field without re-geocoding → blocked.
10. `getEligibleDoctors` (set) and `assertDoctorEligibleForShift` (single) return consistent results across a randomized dataset (property-based test with fast-check, ≥ 1,000 generated cases).

### 20.2 Other required tests
- Pricing: every rate card/premium combination; overtime; mileage; clinic/doctor display separation.
- Matching: score components, weights sum, tie-breakers, favorites window, deadlines (fake timers), cascade ordering, urgent parallel offers.
- Concurrency: double-selection race, double-booking across two shifts (exclusion constraint).
- Payments: Stripe test mode flows, webhook signature verification, idempotency, cancellation matrix.
- Messaging: contact info redaction, PHI warning.
- E2E (Playwright): full clinic and doctor journeys for each phase.

---

## 21. CLAUDE.md (place at repo root)

```md
# CLAUDE.md
This repo builds the CoverageChiropractor.com marketplace. SPEC.md is the source of truth.

Non-negotiables (see SPEC.md Section 2):
- INV-1: A doctor can only be matched to shifts in states where they hold a VERIFIED license valid through the shift's end. Always use assertDoctorEligibleForShift / getEligibleDoctors from packages/core. Never write new eligibility logic elsewhere. Never weaken the DB trigger.
- No PHI stored anywhere. No client-trusted payment amounts. Prices come only from the rate engine.
- Any value marked OWNER DECISION in SPEC.md is a Setting, never hard-coded.

Workflow:
- Work one phase at a time (SPEC.md Section 19). Write tests first for anything in packages/core.
- Run the licensure invariant suite before every commit.
- Ask before adding a new dependency or changing the data model beyond SPEC.md.
```

---

## 22. Environment variables

```
DATABASE_URL=
REDIS_URL=
NEXTAUTH_SECRET=
APP_BASE_URL=https://coveragechiropractor.com
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
GOOGLE_MAPS_API_KEY=            # Routes + Geocoding
SENDGRID_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
ESIGN_API_KEY=
ESIGN_CLINIC_TEMPLATE_ID=
ESIGN_DOCTOR_TEMPLATE_ID=
GCS_BUCKET_CREDENTIALS=
SENTRY_DSN=
NPPES_API_BASE=https://npiregistry.cms.hhs.gov/api/
```

---

## 23. Open decisions for the owner

| # | Decision | Where used |
|---|---|---|
| 1 | Doctor pay per region/tier (FL first) and overtime doctor pay | 8.3 |
| 2 | FL ZIP3 → Central/North/South mapping | 8.3 |
| 3 | Marketplace mileage rate and one-way vs round-trip (current policy: $0.20/mi one-way) | 8.5 |
| 4 | Premium percentages (urgent, weekend, holiday, boost) | 8.4 |
| 5 | Doctor's share of a clinic's forfeited late-cancel deposit | 9.3 |
| 6 | Conversion fee amount and window | 9.5 |
| 7 | Whether the owner's existing coverage clients migrate onto the marketplace or stay on direct booking | 1 |
| 8 | Minimum malpractice limits required (e.g., $1M/$3M) | 4.1, F2 |
| 9 | Whether background checks are required (and which vendor) | Phase 3 |
| 10 | Attorney review: both agreements, contractor model, fee structure, and per-state compliance before each state launch | 13, 14 |
