# Addendum 01 (multi-profession) — audit and migration plan

Status: **approved by the owner and implemented**.
Resolved decision: **A1 — `BRAND_DOMAIN=coverageoncall.com`**. `BRAND_NAME` stays at the working value `CoverageOnCall` unless the owner says otherwise.

## 1. What exists today

The addendum arrived early in Phase 1. Nothing has been deployed and there is no production data, so no data backfill is needed. Built so far:

| Area | Files | State |
|---|---|---|
| Settings/env | `packages/config/src/settings.ts`, `env.ts` | Complete for SPEC v1.0 |
| Domain logic | `packages/core/src/*` (eligibility, pricing, promo, scoring, deadlines, state machines, cancellation, screening, payouts, credentials) | Complete for SPEC v1.0; 72 unit tests passing |
| Schema | `packages/db/prisma/schema.prisma`, `migrations/0001_init`, `migrations/0002_invariants` | Applied to a local dev DB only |
| Integrations | `packages/integrations/src/geo.ts` | In progress (profession-neutral) |
| Web app, worker, DB invariant test suite | — | Not started |

The existing PHP sites (`public_html/`, `thefloridachiropractor.com/`) are **not** touched by this plan.

## 2. Approach

Because nothing has shipped, **rewrite in place instead of stacking rename migrations**:

- Regenerate `0001_init` from the revised schema.
- Rewrite `0002_invariants` with the addendum §5.4 triggers.
- The §15 backfill steps don't apply (there are no rows). The seed creates the launch configuration directly.

## 3. Changes by file

### packages/config
- `env.ts`: add `BRAND_NAME` (default `CoverageOnCall`), `BRAND_DOMAIN` (default `coverageoncall.com`), `BRAND_TAGLINE`, `BRAND_SUPPORT_EMAIL` (default `support@coverageoncall.com`). Change the `APP_BASE_URL` production default to `https://coverageoncall.com` and the email "from" address to the brand domain.
- `settings.ts`:
  - Remove the global malpractice minimums. They move to `Profession` defaults and `ProfessionStateConfig` overrides (seed data, OWNER DECISION A4).
  - Add `matching.weightsByProfession` (optional per-profession overrides that fall back to `matching.weights`).
  - Add `pricing.hourlyMinHours` (seed 2).
  - Add optional per-profession premium overrides.

### packages/core
- **Rename:** Doctor → Provider in types, functions and copy. `assertDoctorEligibleForShift` → `assertProviderEligibleForShift`; `getEligibleDoctors` → `getEligibleProviders`.
- **`errors.ts`:** add `LICENSE_PROFESSION_MISMATCH`, `SUPERVISION_NOT_ATTESTED`, `PROFESSION_NOT_ENABLED`, `SKILL_NOT_IN_SCOPE`.
- **`eligibility.ts`:**
  - **F0:** the profession is enabled in the state.
  - **F1:** match on profession + state. Report `LICENSE_PROFESSION_MISMATCH` when the provider has a license in the right state but the wrong profession.
  - **F1b:** supervision attestation (INV-8), including the rule that the supervisor's profession must be in `supervisingProfessionCodes`.
  - **F2:** the policy must list the profession and meet the profession-state minimums.
  - **F3:** use `ProviderProfession.status` for the shift's profession.
  - **F6:** skills. Certification-required skills need a verified, unexpired cert; scope-sensitive skills need an allowing `SkillStateRule` (missing rule = not allowed).
  - **Unchanged:** F4, F5 (spans all professions), F7–F10.
- **`pricing.ts`:** `Profession.pricingModel`. TIERED works as today. HOURLY is `max(hours, minHours) × hourly rate` on both sides. Premiums, mileage and lodging are unchanged.
- **`scoring.ts`:**
  - `technique` becomes `skills`.
  - Per-profession rating when the provider has 3+ ratings in that profession. Otherwise use the overall rating, reduced by 10% of its distance above the platform mean.
  - The "worked together" bonus counts same-profession shifts only.
  - The new-provider boost is per profession.
  - Weight overrides per profession.
- **New `supervision.ts`:** validates attestation shape (name, profession, license number, on-site checkbox).
- **Unchanged:** promo, payouts ledger (rename only), cancellation, screening, deadlines, state machines.
- **Tests:** rename the existing cases. Add addendum §13.2 cases 1–11 at unit level. Case 12 (property test) goes in the DB suite.

### packages/db (schema + migrations)
- **Renames:** `Doctor` → `Provider`, role `DOCTOR` → `PROVIDER`, `DoctorStats` → `ProviderStats` (+ `ratingByProfession Json`), `Technique` → `Skill`, `DoctorTechnique` → `ProviderSkill` (+ certification fields). `doctorId` → `providerId` on every table, including the pay ledger (`Payout`, `PayoutTransfer`), threads, favorites and blocks (`PartyType.DOCTOR` → `PROVIDER`).
- **New models:** `Profession`, `ProfessionStateConfig`, `ProviderProfession`, `SkillStateRule`, and enum `PricingModel`.
- **`License`:** add `professionCode` and `credentialTitle`; drop `licenseType`; unique key becomes `(providerId, professionCode, state)`; add an index on `(professionCode, state, status, expiresAt)`.
- **`MalpracticePolicy`:** add `coveredProfessionCodes`. Limits go back to **cents** (`perOccurrenceCents`, `aggregateCents`) as the addendum requires. Note: Int cents caps a limit at about $21.4M, which is fine for $1M/$3M-style minimums; say if you need higher and I'll switch to BigInt.
- **`Shift`:** add `professionCode` (required) and the supervision fields; rename to `requiredSkillIds`/`preferredSkillIds`; add an index on `(professionCode, state, status, startsAt)`.
- **`Assignment`:** add `professionCode`.
- **`ClinicLocation`:** add `professionCodes`.
- **`RateCard`:** add `professionCode`, the `HOURLY` tier, `minHours`, and hourly rate columns.
- **`Lead`:** add `professionCode`, and `source = "waitlist"` for the coming-soon forms.
- **Promo landing pages:** audience `CLINIC | PROVIDER`.
- **`0002_invariants`:**
  - Assignment trigger replaced with the addendum §5.4 version (malpractice limits compared in cents on both sides).
  - Application and Offer triggers get the same profession + state + malpractice check.
  - The Shift trigger blocks leaving DRAFT unless both `StateConfig` and `ProfessionStateConfig` are enabled, and a required supervision attestation is present. It also rejects required or preferred skills that are scope-sensitive without an allowing `SkillStateRule`.
  - New CHECK: `ProfessionStateConfig.enabled` requires `legalReviewComplete`.
  - Exclusion constraint (INV-2) unchanged; it already spans all professions because it keys on the provider.
- **Seed:**
  - The 8 professions from §3.1, with only DC active.
  - `StateConfig(FL)` enabled and `ProfessionStateConfig(DC, FL)` enabled; every other pair disabled.
  - The §6.1 skills catalog, with Dry Needling scope-sensitive and no allowing rules.
  - FL DC rate cards from SPEC §8.3.

### Not yet built (will be built profession-aware from the start)
- **Web app:**
  - Provider portal with the profession-grouped credentials page and the "You can take: …" header.
  - Clinic wizard: profession step, then a supervision attestation step, then skills filtered by profession and state.
  - Admin: state × profession matrix; analytics and the pay ledger broken down by profession.
  - Public `/chiropractic`, `/physical-therapy`, `/massage-therapy`, `/acupuncture`, … pages; inactive professions show a waitlist form.
  - All brand strings come from config.
- **Agreements:** profession-neutral Provider Agreement, per-profession addenda, and the clinic supervision clause. These stay behind flags until attorney review (A7).
- **DB invariant suite:** SPEC §20.1 plus addendum §13.2 cases 1–12.

## 4. Open question for the owner

- **`coveragechiropractor.com` → `/chiropractic` 301 (§12).** The current PHP booking site lives on that domain today. I plan to ship the redirect as a documented cutover step (a web-server rule applied at launch), not in code that takes effect immediately, so the current site keeps working until you switch.

## 5. Order of work after approval

1. Config and core rewrite, with the unit tests.
2. Schema, triggers and seed, plus the DB invariant suite (including the 1,000-case property test).
3. Integrations.
4. Web app.
5. Worker.
