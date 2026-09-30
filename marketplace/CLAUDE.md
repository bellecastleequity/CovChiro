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
- Brand colors are Tailwind tokens: brand-* = logo navy (#282472 = brand-600, primary actions), accent-* = logo teal (#22C4BE = accent-500; use accent-600/700 for text). Never raw hex in the app. Logo: components/site/logo.tsx; assets and rules in docs/brand/.
- Database transport: default is direct TCP. DATABASE_TRANSPORT=websocket uses @prisma/adapter-neon over port 443 (cPanel hosts block 5432). Verify adapter-sensitive changes with `TEST_DRIVER_ADAPTER=pg` or `neon-ws` (tests/adapterSetup.ts); raw queries must avoid types adapters can't decode (e.g. cast `name` to text).
- Local dev: Postgres 16 + PostGIS + btree_gist. Every external service has a fake in packages/integrations used when its API key is unset.
- Addendum 01 plan approved and implemented (docs/migrations/addendum-01-plan.md).
- A5 (owner decision: accept the minimum credential the state requires): where ProfessionStateConfig has licensedAtStateLevel=false and alternativeCredentialAllowed=true, a VERIFIED national registry credential (License.state = "US", e.g. ARDMS/CCI/ARRT for sonography) satisfies INV-1 for that profession in that state. Nowhere else. The rule lives in core hasQualifyingLicense, the SQL prefilter and the provider_shift_problem trigger (migration 0003); a CHECK forbids national credentials where the state licenses the profession.
- Provider booking emails (services/src/digests.ts): daily list at 5:30 local and Sunday-evening week-ahead, only when there are bookings; times are Settings (digests.*); DigestSend rows make each send once-only.
- cPanel database updates for already-installed sites go in deploy/cpanel/updates/update-NNN-*.sql (re-runnable); `-- @migration <name>` inlines a migration plus its _prisma_migrations row at build time.
- Behind cPanel/Passenger, req.url is the internal http://0.0.0.0:3000 address: redirects use relative Location headers (or APP_BASE_URL), never `new URL(path, req.url)`.
- Addresses: AddressInput (Places API New, GOOGLE_MAPS_BROWSER_KEY passed from the server at runtime) posts `<name>PlaceId`; the server geocodes by place ID when present. GeoServiceError = Google key/API failure, reported separately from "address not found".
- Eligibility lives in packages/services/src/eligibility.ts (DB loaders) + packages/core/src/eligibility.ts (pure rules). Tests: `pnpm test:core` and `pnpm test:invariants` (needs local Postgres + PostGIS; recreates the *_test database).

## Addendum 02 — Smart Dispatch & On Call (SPEC_ADDENDUM_02_DISPATCH_ONCALL.md)
Precedence: Addendum 02 > Addendum 01 > SPEC.md.
- Never award a shift to whoever answered first. Awards follow rank-protected logic: an acceptor is confirmed only when no higher-match-score offer in the wave is still pending (or at window/hold end, best acceptor wins).
- Match score decides who wins; dispatch score (match × responsiveness) decides who is asked first.
- Every candidate list starts with getEligibleProviders. On Call rules, standby, revived offers, and broadcasts can never add a provider it excludes.
- All confirmations go through the SPEC.md 7.8 transaction under a per-shift advisory lock.
- All dispatch numbers are Settings. Use fake timers in dispatch tests.
- Clinic/admin invitations (non-dispatch offers) are rank-protected as well: accept → ACCEPTED_PENDING, confirmed by settleInvites once no higher-match invitation is still open.
- Background work lives in packages/services/src/jobs.ts as idempotent sweeps, driven by apps/worker (BullMQ, or in-process timers without REDIS_URL) or by an external once-a-minute tick to /api/cron (cPanel hosting; see INSTALL-CPANEL.md).
