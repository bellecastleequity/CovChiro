# SPEC Addendum 01 — Multi-Profession Marketplace

Applies to: `SPEC.md` v1.0 (CoverageChiropractor.com Coverage Marketplace)
Addendum version: 1.0

---

## 0. Instructions for Claude Code

1. Save this file at the repo root as `SPEC_ADDENDUM_01_MULTI_PROFESSION.md`.
2. **Where this addendum conflicts with SPEC.md, this addendum wins.** Everything in SPEC.md not changed here still applies.
3. Before editing any code, **audit what has already been built** against this addendum and write a short migration plan (files, schema changes, data backfill, tests affected) in `docs/migrations/addendum-01-plan.md`. Show it to the owner before implementing.
4. Update `CLAUDE.md` with the block in Section 14.
5. All new values marked `OWNER DECISION` are Settings or seed data, never hard-coded. All items marked `ATTORNEY REVIEW` ship disabled by default.

---

## 1. Summary of changes

The marketplace expands from chiropractors only to **multiple licensed professions**: chiropractic, physical therapy, occupational therapy, massage therapy, acupuncture, athletic training, and others added later by an admin.

| Area | Change |
|---|---|
| Terminology | "Doctor" becomes **"Provider"** everywhere (code, DB, UI, API) |
| Licensure rule (INV-1) | Now keyed on **profession + state**, not just state |
| New invariant | **INV-8 Supervision**: professions that require supervision can't be matched unless the clinic attests to qualifying on-site supervision |
| Shifts | Every shift requires exactly one profession |
| Credentials | Licenses, malpractice minimums, NPI requirement, and skill certifications vary by profession |
| Skills | "Techniques" become profession-scoped **Skills**, with scope-of-practice rules per state |
| Pricing | Rate cards per **profession × region × tier**; some professions priced hourly |
| Enablement | New **profession × state** enablement matrix on top of state enablement |
| Branding | Brand name becomes a config value (working name: CoverageOnCall) |
| Launch order | Build profession-aware from day one; launch with chiropractic (DC) only in Florida |

---

## 2. Terminology rename

- `Doctor` → `Provider` (model, tables, types, routes, UI copy).
- `DOCTOR` role → `PROVIDER`.
- `DoctorTechnique` → `ProviderSkill`; `Technique` → `Skill`.
- `DoctorStats` → `ProviderStats`.
- API: `/doctors/*` → `/providers/*`.
- UI copy uses the provider's credential title where shown (e.g., "Dr. Jane Smith, DC", "John Lee, LMT", "Ana Ruiz, PT, DPT").
- Error codes: `LICENSE_STATE_MISMATCH` stays; add `LICENSE_PROFESSION_MISMATCH` and `SUPERVISION_NOT_ATTESTED` (Section 5).

---

## 3. Professions

### 3.1 Profession catalog (admin-managed)

```prisma
model Profession {
  code                 String   @id           // e.g. "DC"
  displayName          String                  // "Chiropractor"
  credentialSuffix     String                  // default suffix shown after name, e.g. "DC"
  npiRequired          Boolean                 // NPI required for this profession?
  pricingModel         PricingModel            // TIERED or HOURLY
  defaultMalpracticeMinOccurrenceCents Int
  defaultMalpracticeMinAggregateCents  Int
  requiresSupervisionDefault Boolean @default(false)
  active               Boolean  @default(false)
  sortOrder            Int
}
enum PricingModel { TIERED HOURLY }
```

Seed (only `DC` active at launch; all malpractice minimums and pricing models are OWNER DECISION placeholders):

| Code | Display name | Suffix | NPI required | Pricing model | Supervision default |
|---|---|---|---|---|---|
| DC | Chiropractor | DC | Yes | TIERED | No |
| PT | Physical Therapist | PT | Yes | TIERED | No |
| PTA | Physical Therapist Assistant | PTA | Yes | TIERED | **Yes** (supervising: PT) |
| OT | Occupational Therapist | OT | Yes | TIERED | No |
| OTA | Occupational Therapy Assistant | OTA | Yes | TIERED | **Yes** (supervising: OT) |
| LMT | Massage Therapist | LMT | No | HOURLY | No |
| LAC | Acupuncturist | L.Ac. | Yes | TIERED | No |
| ATC | Athletic Trainer | ATC | Yes | HOURLY | Varies by state (configure per state) |

Credential titles vary by state (e.g., LMT vs. LMBT vs. CMT; L.Ac. vs. A.P. in Florida). Store the state-specific title on `ProfessionStateConfig.credentialTitle` and on the provider's `License`, and display the license's title.

### 3.2 Profession × state configuration

```prisma
model ProfessionStateConfig {
  professionCode           String
  state                    String
  enabled                  Boolean  @default(false)
  legalReviewComplete      Boolean  @default(false)
  legalReviewNotes         String?
  licensedAtStateLevel     Boolean  @default(true)
  credentialTitle          String?          // state-specific title
  boardLookupUrl           String?
  supervisionRequired      Boolean
  supervisingProfessionCodes String[]       // e.g. ["PT"] for PTA
  supervisionNotes         String?
  malpracticeMinOccurrenceCents Int?        // overrides profession default
  malpracticeMinAggregateCents  Int?
  scopeNotes               String?
  enabledAt                DateTime?
  enabledById              String?
  @@id([professionCode, state])
}
```

**A shift can be posted only if BOTH `StateConfig(state).enabled` AND `ProfessionStateConfig(profession, state).enabled` are true.**

`ProfessionStateConfig.enabled = true` requires:
- `legalReviewComplete = true` (ATTORNEY REVIEW)
- `licensedAtStateLevel = true`, unless the owner explicitly approves an alternative-credential policy for that pair (see 3.3)
- Board lookup URL set
- Complete rate card for that profession in every rate region of the state (Section 7)
- Supervision fields filled in (even if `supervisionRequired = false`)

### 3.3 Professions not licensed at the state level

Some states do not license certain professions statewide (this is most common for massage therapy, where a few states regulate only locally or not at all). Default policy: **the profession is disabled in that state.** OWNER DECISION: optionally allow an alternative credential (e.g., a national certification plus any local license) for a specific profession-state pair. That policy must be stored on the config record, and it ships disabled.

---

## 4. Provider profile changes

- A provider selects one or more professions at signup. Each selected profession creates a `ProviderProfession` record:

```prisma
model ProviderProfession {
  providerId      String
  professionCode  String
  yearsInPractice Int?
  specialties     String[]
  status          ProviderProfessionStatus @default(ONBOARDING)   // ONBOARDING, ACTIVE, PAUSED
  @@id([providerId, professionCode])
}
```

- **Dual-licensed providers** (e.g., DC + LAc, or PT + LMT) have one account, one availability calendar, one payout account, and one reliability record. They are eligible for each profession's shifts independently. INV-2 (no double-booking) applies across all professions.
- NPI is required only if `Profession.npiRequired` is true for at least one of the provider's active professions.
- Malpractice: one policy may cover several professions. Add `coveredProfessionCodes String[]` to `MalpracticePolicy`; the policy must list the profession and meet that profession-state's minimum limits.
- The "profile complete" gate is evaluated **per profession**: a provider can be ACTIVE for DC shifts while their LMT profile is still onboarding.
- The credentials page groups licenses by profession, then by state.
- The shift board header reads, for example: "You can take: Chiropractic shifts in FL, GA · Massage shifts in FL."

---

## 5. Invariant changes

### 5.1 INV-1 (revised): Licensure by profession and state

**A provider may only be shown, apply to, be offered, be selected for, be confirmed for, or work a shift if they hold a license where:**
- `license.professionCode = shift.professionCode`, AND
- `license.state = shift.state`, AND
- `license.status = VERIFIED`, AND
- `license.expiresAt > shift.endsAt`.

A license in one profession never qualifies a provider for another profession, even in the same state and even if scopes overlap (e.g., a DC license does not qualify for an LMT or PT shift). A license in one state never qualifies for another state. Every enforcement layer in SPEC.md Section 2 (INV-1, items 1–8) applies unchanged, now using profession + state.

`assertDoctorEligibleForShift` → `assertProviderEligibleForShift(providerId, shiftId)` and `getEligibleDoctors` → `getEligibleProviders(shiftId)`. These remain the only eligibility implementation.

### 5.2 INV-3 (revised): Malpractice by profession

The provider must have a `VERIFIED` malpractice policy that lists `shift.professionCode` in `coveredProfessionCodes`, expires after `shift.endsAt`, and meets the minimum limits for that profession-state pair.

### 5.3 INV-8 (new): Supervision

If `ProfessionStateConfig(shift.professionCode, shift.state).supervisionRequired = true`:
- The clinic must complete a supervision attestation when posting the shift: the name, profession, and license number of the on-site supervising provider, and a checkbox confirming that person will be on site and available for the entire shift, as that state requires.
- The supervising provider's profession must be in `supervisingProfessionCodes`.
- The shift cannot move out of `DRAFT` without the attestation. Store it on the shift (`supervisionAttestation Json`, `supervisionAttestedById`, `supervisionAttestedAt`).
- If the clinic edits or withdraws the attestation after confirmation, the assignment is flagged for admin review and the provider is notified.
- The platform records the attestation but does not supervise; clinic responsibility is stated in the Clinic Agreement (ATTORNEY REVIEW).

Error code when missing: `SUPERVISION_NOT_ATTESTED`.

### 5.4 Updated DB trigger

Replace the SPEC.md Section 5.3 trigger function with:

```sql
CREATE OR REPLACE FUNCTION enforce_assignment_eligibility() RETURNS trigger AS $$
DECLARE
  s RECORD;
  psc RECORD;
BEGIN
  IF NEW.status IN ('CONFIRMED','IN_PROGRESS') THEN
    SELECT * INTO s FROM "Shift" WHERE id = NEW."shiftId";

    IF NEW.state <> s.state OR NEW."professionCode" <> s."professionCode" THEN
      RAISE EXCEPTION 'INV-1: assignment state/profession does not match shift';
    END IF;

    SELECT * INTO psc FROM "ProfessionStateConfig"
      WHERE "professionCode" = s."professionCode" AND state = s.state;
    IF psc IS NULL OR psc.enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'INV-6: profession % not enabled in %', s."professionCode", s.state;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "License" l
      WHERE l."providerId" = NEW."providerId"
        AND l."professionCode" = s."professionCode"
        AND l.state = s.state
        AND l.status = 'VERIFIED'
        AND l."expiresAt" > NEW."endsAt"
    ) THEN
      RAISE EXCEPTION 'INV-1: provider % lacks verified % license in % valid through shift end',
        NEW."providerId", s."professionCode", s.state;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "MalpracticePolicy" m
      WHERE m."providerId" = NEW."providerId"
        AND s."professionCode" = ANY(m."coveredProfessionCodes")
        AND m.status = 'VERIFIED'
        AND m."expiresAt" > NEW."endsAt"
        AND m."perOccurrence" >= COALESCE(psc."malpracticeMinOccurrenceCents", 0)
        AND m.aggregate      >= COALESCE(psc."malpracticeMinAggregateCents", 0)
    ) THEN
      RAISE EXCEPTION 'INV-3: provider % lacks qualifying malpractice for %', NEW."providerId", s."professionCode";
    END IF;

    IF psc."supervisionRequired" AND s."supervisionAttestedAt" IS NULL THEN
      RAISE EXCEPTION 'INV-8: supervision not attested for shift %', s.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

The profession-level minimum is resolved in application code and written to `ProfessionStateConfig` so the trigger can read one place. Make sure the units match (cents in both). Update the `Application` insert trigger the same way (profession + state + license check).

---

## 6. Data model changes (diff against SPEC.md Section 5)

```prisma
// RENAMED
model Provider { /* was Doctor; same fields */ professions ProviderProfession[] }

// CHANGED
model License {
  // + professionCode
  professionCode  String
  credentialTitle String?        // title as issued in that state
  @@unique([providerId, professionCode, state])   // replaces [doctorId, state, licenseType]
  @@index([professionCode, state, status, expiresAt])
}
// licenseType is removed; professionCode replaces it.

model MalpracticePolicy {
  // + coveredProfessionCodes; perOccurrence/aggregate stored in CENTS
  coveredProfessionCodes String[]
}

model Shift {
  // + professionCode (required), supervision fields
  professionCode          String
  supervisionAttestation  Json?
  supervisionAttestedById String?
  supervisionAttestedAt   DateTime?
  requiredSkillIds        String[]   // was requiredTechniqueIds
  preferredSkillIds       String[]   // was preferredTechniqueIds
  @@index([professionCode, state, status, startsAt])
}

model Assignment {
  // + professionCode (copied from shift; checked by trigger)
  professionCode String
}

model ClinicLocation {
  // + professions this location posts shifts for
  professionCodes String[]
}

model RateCard {
  // + professionCode; + HOURLY support
  professionCode     String
  durationTier       DurationTier     // HALF_DAY, FULL_DAY, HOURLY
  minHours           Int?             // for HOURLY
}
enum DurationTier { HALF_DAY FULL_DAY HOURLY }

model ProviderStats {
  // global reliability stays here; add per-profession rating aggregates
  ratingByProfession Json   // { "DC": { sum, count }, "LMT": { sum, count } }
}

// RENAMED + CHANGED
model Skill {
  id                    String  @id @default(cuid())
  name                  String
  professionCode        String?          // null = cross-profession (e.g., Kinesio Taping)
  scopeSensitive        Boolean @default(false)
  requiresCertification Boolean @default(false)
  active                Boolean @default(true)
  @@unique([name, professionCode])
}
model ProviderSkill {
  providerId     String
  skillId        String
  proficiency    Int
  certificationUrl   String?
  certificationStatus LicenseStatus?     // required if skill.requiresCertification
  certificationExpiresAt DateTime?
  @@id([providerId, skillId])
}

// NEW
model SkillStateRule {             // scope-of-practice rules for scope-sensitive skills
  skillId        String
  professionCode String
  state          String
  allowed        Boolean
  notes          String?
  @@id([skillId, professionCode, state])
}
```

Also add the `Profession`, `ProfessionStateConfig`, and `ProviderProfession` models from Sections 3 and 4.

### 6.1 Skills catalog seed

- **DC**: Diversified, Gonstead, Activator, Thompson Drop, Cox Flexion-Distraction, SOT, Logan Basic, Upper Cervical, Torque Release, Webster, Extremity Adjusting
- **PT / PTA**: Orthopedic/Outpatient, Sports, Neuro, Vestibular, Pelvic Health, Pediatrics, Geriatrics, Manual Therapy, Aquatic
- **OT / OTA**: Hand Therapy, Pediatrics, Neuro Rehab, Ergonomics
- **LMT**: Swedish, Deep Tissue, Sports Massage, Myofascial Release, Neuromuscular, Prenatal, Lymphatic Drainage, Trigger Point
- **LAC**: TCM Acupuncture, Japanese Style, Auricular, Cupping, Gua Sha, Electro-Acupuncture, Herbal Consultation
- **ATC**: Event Coverage, Taping/Bracing, Injury Evaluation, Return-to-Play
- **Cross-profession**: Kinesio Taping, IASTM/Graston, Active Release Technique, Corrective Exercise
- **Scope-sensitive** (`scopeSensitive = true`, `requiresCertification = true`): Dry Needling (DC, PT), plus any skill the admin flags

For a scope-sensitive skill, a shift may require or prefer it only if `SkillStateRule(skill, shift.profession, shift.state).allowed = true`. **The default for a missing rule is "not allowed."** A provider matches a certification-required skill only if the certification is `VERIFIED` and unexpired.

---

## 7. Matching changes (diff against SPEC.md Section 7)

### 7.1 Hard filters

| # | Filter | Change |
|---|---|---|
| F0 (new) | Profession enabled | `ProfessionStateConfig(shift.profession, shift.state).enabled = true` |
| F1 | Licensure | **Profession + state** (Section 5.1). Still evaluated first, in SQL. |
| F1b (new) | Supervision | If supervision required, shift has a valid attestation (INV-8) |
| F2 | Malpractice | Covers the profession and meets the profession-state minimum (Section 5.2) |
| F3 | Status | `ProviderProfession.status = ACTIVE` for the shift's profession |
| F6 | Required skills | Provider has every required skill; certification-required skills must be verified; scope-sensitive skills must be allowed in the state |

F4, F5, F7–F10 are unchanged. INV-2 overlap checks span all professions.

### 7.2 Scoring

- `technique` → `skills`: same formula, using skills scoped to the shift's profession plus cross-profession skills.
- `rating`: use the provider's rating in the shift's profession if they have ≥ 3 ratings there; otherwise use their overall rating, discounted by 10% of its distance above the platform mean (a provider new to a profession shouldn't ride a rating earned in another).
- `relationship`: a clinic favorite applies across professions, but the "worked together before" bonus counts only past shifts in the same profession.
- `newProvider` boost: applies per profession (a veteran DC who just added an LMT license gets the boost for LMT shifts).
- Weights and thresholds can be overridden per profession: `matching.weights.<PROFESSION>` falls back to `matching.weights`.

### 7.3 Notifications
"New shift" alerts go only to providers who pass F0–F10 for that shift's profession and state.

---

## 8. Pricing changes (diff against SPEC.md Section 8)

- Rate cards are keyed on **profession × region × tier**.
- `Profession.pricingModel`:
  - `TIERED`: SPEC.md 8.2 as written (HALF_DAY < 4h, FULL_DAY 4–8h, overtime beyond 8h).
  - `HOURLY`: `clinicPrice = max(hours, minHours) × clinicHourlyCents`; `providerPay = max(hours, minHours) × providerHourlyCents`. Seed `minHours = 2`, rates are OWNER DECISION.
- Premiums (urgent, weekend, holiday, boost) apply to all professions; per-profession overrides allowed via settings.
- Mileage and lodging pass-through rules are unchanged for all professions.
- The Florida DC seed from SPEC.md 8.3 stays as is. All other professions' rate cards are OWNER DECISION and must exist before that profession-state pair can be enabled.

---

## 9. Clinic-side changes

- Locations list which professions they post shifts for (`professionCodes`).
- Post-shift wizard, step 1: **choose profession**, limited to the location's professions AND pairs enabled in the location's state. Disabled options show "Not yet available in [state]."
- If supervision is required: an attestation step (Section 5.3) appears before pricing.
- Skill selection shows only skills for that profession plus cross-profession skills allowed in that state.
- The candidate list shows credential title, profession-specific rating, and profession-specific skills.
- Multi-profession clinics (e.g., a chiropractic office that also employs massage therapists) post each profession as a separate shift. A future "team coverage" feature (e.g., a DC + LMT for one day) is out of scope for this addendum.

---

## 10. Agreements (diff against SPEC.md Section 13)

- The Provider Platform Agreement replaces the Doctor Platform Agreement, written to be profession-neutral.
- **Profession addenda** (one per profession, ATTORNEY REVIEW): scope-of-practice acknowledgment, supervision terms where relevant, profession-specific documentation and conduct expectations. A provider signs the addendum for each profession they activate.
- The Clinic Platform Agreement adds a **supervision attestation clause**: the clinic is solely responsible for providing supervision required by law and for the accuracy of each attestation.
- Clinic agreement clause: the clinic must only request services within the provider's legal scope in that state.

---

## 11. State and profession enablement (diff against SPEC.md Section 14)

Admin "States" screen becomes a **matrix**: rows = states, columns = professions. Each cell shows its status (Disabled / Ready to enable / Enabled) and opens the checklist from Section 3.2. The state-level checklist from SPEC.md 14 still applies (state enabled is a prerequisite for any cell in that row).

Launch configuration: `StateConfig(FL).enabled = true`, `ProfessionStateConfig(DC, FL).enabled = true`, everything else disabled.

---

## 12. Branding

- Add `BRAND_NAME`, `BRAND_DOMAIN`, `BRAND_TAGLINE`, and `BRAND_SUPPORT_EMAIL` to config. No brand name hard-coded in UI, emails, or SMS templates.
- Working values: `BRAND_NAME=CoverageOnCall`, `BRAND_DOMAIN=coverageoncall.com` (OWNER DECISION: final name and domain after availability and trademark checks).
- Public site: profession landing pages at `/chiropractic`, `/physical-therapy`, `/massage-therapy`, `/acupuncture`, etc., for SEO. Pages for inactive professions show a "Coming soon — join the waitlist" form (captures email, profession, state).
- `coveragechiropractor.com` redirects to `/chiropractic` on the main domain (301).
- Legal entity on agreements remains Key Global LLC, not displayed publicly.

---

## 13. Phase and test changes

### 13.1 Phases (diff against SPEC.md Section 19)

- **Phase 1**: build profession-aware from the start (all Section 3–6 models, revised INV-1, INV-3, INV-8, trigger). Only DC in FL enabled. Acceptance criteria from SPEC.md still apply, plus the tests in 13.2.
- **Phase 2**: unchanged, plus per-profession rating aggregates and per-profession matching weight overrides.
- **Phase 3**: unchanged (multi-state), plus the state × profession matrix UI.
- **Phase 4 (new) — profession rollout**: activate professions one at a time (suggested order: LMT → LAC → ATC → PT/PTA → OT/OTA, OWNER DECISION), each requiring its rate cards, skills, agreement addendum, and legal review. Supervision workflow must be fully tested before PTA/OTA go live.

### 13.2 Licensure invariant suite additions (required in CI)

Each case asserts exclusion from board, candidates, notifications, offers, applications, and that a direct `Assignment` insert fails at the trigger:

1. Provider has a verified **DC license in FL** → excluded from an **LMT shift in FL**.
2. Provider has a verified **LMT license in FL** → excluded from a **DC shift in FL**.
3. Provider has a **DC license in GA** and an **LMT license in FL** → excluded from DC shifts in FL and LMT shifts in GA; eligible only for DC-GA and LMT-FL.
4. Dual-licensed DC + LAc in FL is eligible for both FL shift types, but cannot hold overlapping DC and LAc assignments (INV-2 across professions).
5. PTA shift with no supervision attestation → cannot be posted; direct assignment insert fails (INV-8).
6. PTA shift whose attestation names a supervising OT (not PT) → rejected.
7. Profession disabled in a state where the state itself is enabled → cannot post; direct insert fails.
8. Malpractice policy doesn't list the shift's profession → excluded.
9. Malpractice below the profession-state minimum → excluded.
10. Shift requiring Dry Needling in a state with no `SkillStateRule` allowing it for that profession → cannot be posted.
11. Required certification-based skill with expired certification → provider excluded.
12. Property-based test from SPEC.md 20.1 #10, extended with random professions: `getEligibleProviders` and `assertProviderEligibleForShift` agree on ≥ 1,000 generated cases.

---

## 14. CLAUDE.md additions

Append to `CLAUDE.md`:

```md
## Addendum 01 — Multi-profession (SPEC_ADDENDUM_01_MULTI_PROFESSION.md)
This addendum overrides SPEC.md where they conflict.
- "Doctor" is now "Provider". Shifts belong to exactly one profession.
- INV-1 is profession + state: a provider needs a VERIFIED license for the shift's profession, in the shift's state, valid through shift end. A license in another profession or state never qualifies.
- INV-8: supervision-required professions (e.g., PTA, OTA) need a clinic supervision attestation before posting or assignment.
- Posting requires StateConfig AND ProfessionStateConfig enabled.
- All eligibility goes through assertProviderEligibleForShift / getEligibleProviders. Never duplicate it.
- Brand name is config (BRAND_NAME), never hard-coded.
```

---

## 15. Migration notes (if Phase 1 code already exists)

1. Rename models, tables, routes, and types `Doctor*` → `Provider*` in one migration; update all imports.
2. Add `Profession`, `ProfessionStateConfig`, `ProviderProfession`, `SkillStateRule`; seed Section 3.1 professions (only DC active) and the `DC × FL` config (enabled once its checklist passes).
3. Backfill: all existing `License.professionCode = 'DC'`; all `Shift.professionCode = 'DC'`; all `Assignment.professionCode = 'DC'`; all `RateCard.professionCode = 'DC'`; all `MalpracticePolicy.coveredProfessionCodes = ['DC']`; one `ProviderProfession(DC)` per existing provider, copying status.
4. Convert malpractice limit columns to cents if they aren't already.
5. Migrate `Technique` → `Skill` (`professionCode = 'DC'` for chiropractic techniques; cross-profession ones set to null), and `DoctorTechnique` → `ProviderSkill`.
6. Replace both triggers (Section 5.4) in the same migration as the backfill, so there's never a window with the old trigger and new columns.
7. Run the full licensure suite (SPEC.md 20.1 + this addendum's 13.2) before merging.

---

## 16. New open decisions for the owner

| # | Decision | Where |
|---|---|---|
| A1 | Final brand name and domain (CoverageOnCall vs. CoverageBoard) | 12 |
| A2 | Profession rollout order after DC | 13.1 |
| A3 | Rate cards and pricing model (tiered vs. hourly) for each new profession | 8 |
| A4 | Malpractice minimums per profession | 3.1 |
| A5 | Whether to allow alternative credentials where a profession isn't state-licensed (default: no) | 3.3 |
| A6 | Supervision rules per state for PTA, OTA, ATC | 3.2, 5.3 |
| A7 | Attorney review: Provider Agreement, each profession addendum, clinic supervision clause, per profession-state legal review | 10, 11 |
