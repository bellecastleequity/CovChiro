# CLAUDE.md
This directory builds the marketplace (working brand CoverageOnCall, coverageoncall.com). SPEC.md is the source of truth, amended by SPEC_ADDENDUM_01_MULTI_PROFESSION.md. The PHP sites elsewhere in this repo are separate and out of scope.

Non-negotiables (see SPEC.md Section 2):
- INV-1: A provider can only be matched to shifts where they hold a VERIFIED license (profession + state) valid through the shift's end. Always use assertProviderEligibleForShift / getEligibleProviders. Never write new eligibility logic elsewhere. Never weaken the DB trigger.
- No PHI stored anywhere. No client-trusted payment amounts. Prices come only from the rate engine.
- Any value marked OWNER DECISION in SPEC.md is a Setting, never hard-coded.

Workflow:
- Work one phase at a time (SPEC.md Section 19). Write tests first for anything in packages/core.
- Run the licensure invariant suite before every commit.
- Ask before adding a new dependency or changing the data model beyond SPEC.md.

## Addendum 01 — Multi-profession (SPEC_ADDENDUM_01_MULTI_PROFESSION.md)
This addendum overrides SPEC.md where they conflict.
- "Doctor" is now "Provider". Shifts belong to exactly one profession.
- INV-1 is profession + state: a provider needs a VERIFIED license for the shift's profession, in the shift's state, valid through shift end. A license in another profession or state never qualifies.
- INV-8: supervision-required professions (e.g., PTA, OTA) need a clinic supervision attestation before posting or assignment.
- Posting requires StateConfig AND ProfessionStateConfig enabled.
- All eligibility goes through assertProviderEligibleForShift / getEligibleProviders. Never duplicate it.
- Brand name is config (BRAND_NAME), never hard-coded.

## Repo notes
- Owner additions beyond SPEC: clinic promo codes (discount comes out of platform margin only, never provider pay or travel), lead management with follow-up emails, first-party analytics, and a provider pay ledger (Payout / PayoutTransfer) paid only via Stripe Connect transfers.
- Local dev: Postgres 16 + PostGIS + btree_gist. Every external service has a fake in packages/integrations used when its API key is unset.
- Addendum 01 plan approved and implemented (docs/migrations/addendum-01-plan.md).
- Eligibility lives in packages/services/src/eligibility.ts (DB loaders) + packages/core/src/eligibility.ts (pure rules). Tests: `pnpm test:core` and `pnpm test:invariants` (needs local Postgres + PostGIS; recreates the *_test database).
