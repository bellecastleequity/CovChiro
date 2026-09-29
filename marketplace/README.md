# CoverageOnCall marketplace

A marketplace where clinics book licensed, insured coverage providers for single days or short stretches. It is built from these specs, in this order of precedence:

1. `SPEC_ADDENDUM_02_DISPATCH_ONCALL.md`
2. `SPEC_ADDENDUM_01_MULTI_PROFESSION.md`
3. `SPEC.md`

Engineering rules live in `CLAUDE.md`.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router). Contains the public site and three portals: provider, clinic and admin. It also holds the webhooks and CSV exports. |
| `apps/worker` | Background sweeps. BullMQ job schedulers on Redis, or in-process timers when `REDIS_URL` is unset. |
| `packages/core` | Pure domain logic: eligibility, pricing, promo codes, scoring, dispatch, badges, cancellation and payouts. Has unit and property tests. |
| `packages/db` | Prisma schema plus raw SQL invariants (triggers, exclusion constraints) and the seed data. |
| `packages/services` | The only code that touches the database. Every mutation goes through here. |
| `packages/integrations` | Stripe, Google Maps, SendGrid, Twilio, Dropbox Sign, GCS and NPPES. Each has a local fake. |
| `packages/config` | Environment variables and the settings registry. Every "OWNER DECISION" in the spec is a setting that can be edited in Admin → Settings. |
| `tests` | Database invariant suite: licensure, overlap, concurrency, flows and dispatch. |

## Local development

Requirements:
- Node 22
- pnpm 10
- Postgres 16 with PostGIS
- Redis (optional)

```bash
pnpm install
cp .env.example apps/web/.env.local        # then edit DATABASE_URL etc.
createdb coverage_app
export $(grep -v '^#' apps/web/.env.local | xargs)
pnpm db:generate && pnpm db:migrate
SEED_ADMIN_EMAIL=admin@demo.test SEED_ADMIN_PASSWORD=change-me-please SEED_DEMO=1 pnpm db:seed
pnpm dev            # web on :3000
pnpm dev:worker     # background sweeps
```

- **Admin sign-in:** admins must enrol TOTP MFA at first login.
- **Demo accounts** (`SEED_DEMO=1`): `clinic@demo.test`, `provider@demo.test` and `ga-provider@demo.test`. The password for all three is `demo-password-1`.
- **When an integration key is unset**, a local fake takes its place:
  - Emails and SMS go to the dev outbox, which you can read in Admin → Notifications.
  - Stripe checkout and Connect onboarding go to `/api/dev/fake-stripe`. A charge whose amount ends in 13 cents fails, so you can test the failure path.
  - Agreements are signed at `/agreements/dev-sign`.

### Tests

```bash
pnpm test:core         # pure logic (vitest + fast-check)
pnpm test:invariants   # needs Postgres; drops/recreates only *_test databases
pnpm typecheck
```

Run the licensure invariant suite before every commit.

## Background jobs

`packages/services/src/jobs.ts` defines every job as an idempotent sweep over rows that are due. A retried, overlapping or missed tick is harmless because the next tick catches up. Each sweep that touches a shift takes that shift's advisory lock.

| Job | Every | What it does |
|---|---|---|
| `dispatchTick` | 15 s | Closes waves, ends broadcast holds, closes standby windows, advances cascades |
| `selectionDeadline` | 1 min | Auto-selects at the selection deadline, or starts a dispatch |
| `favoritesWindowEnd` | 1 min | Opens favorites-only shifts to all eligible providers |
| `shiftStart`, `markUnfilled` | 1 min | Moves shifts to in progress, or marks them unfilled and refunds |
| `shiftAutoComplete`, `failedDepositSweep` | 5 min | Auto-completes finished shifts and charges the balance; handles failed deposits |
| `preShiftEligibilityCheck` | 15 min | Re-checks licence and malpractice (INV-1/INV-3) 24 h before start |
| `payoutRelease` | 15 min | Transfers provider pay once the dispute window closes |
| `leadDrip` | 15 min | Sends lead follow-up emails |
| `ratingsReveal`, `statsRecompute`, `responsivenessRecompute` | 1 h | Quality metrics |
| `nightlyCredentialSweep` | 02:00 America/New_York | Expires credentials, handles lapses, creates re-verify tasks, sends reminders |

To run sweeps once and exit, for example from a scheduled Cloud Run job or while debugging:

```bash
pnpm --filter @cm/worker once
pnpm --filter @cm/worker once dispatchTick
```

## Deployment

Step-by-step guides:

- `INSTALL.md` covers running locally and Google Cloud.
- `INSTALL-CPANEL.md` covers Namecheap cPanel. For cPanel, `deploy/cpanel/build.sh` builds the upload zip, and the background jobs are driven by cron through `GET /api/cron`, which needs `CRON_SECRET` sent as a bearer token.

### Google Cloud

Target: Cloud Run (web + worker), Cloud SQL Postgres 16 with PostGIS, Memorystore Redis, GCS for uploads, and Secret Manager for keys.

1. **Cloud SQL.** Create a Postgres 16 instance and a database. Run `CREATE EXTENSION postgis; CREATE EXTENSION btree_gist; CREATE EXTENSION citext;` as a superuser if the migration role cannot.
2. **Images.** Use `marketplace/` as the build context:
   ```bash
   docker build -f deploy/Dockerfile.web    -t $REGION-docker.pkg.dev/$PROJECT/cm/web .
   docker build -f deploy/Dockerfile.worker -t $REGION-docker.pkg.dev/$PROJECT/cm/worker .
   ```
3. **Migrations.** Run them as a Cloud Run job before each deploy, using the worker image with the command `pnpm db:migrate`. Seed once with `pnpm db:seed`. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, and never set `SEED_DEMO`.
4. **Web service.** Port 8080, min instances 1. Add the Cloud SQL connector and the VPC connector for Redis. Set every variable in `.env.example`, with `NODE_ENV=production` and `APP_BASE_URL=https://coverageoncall.com`.
5. **Worker service.** Same environment. Set min instances to 1, max instances to 1 or more (BullMQ runs each tick once across replicas), and **CPU always allocated**. The service answers health checks on `$PORT`.
6. **Webhooks.**
   - Stripe: `https://<domain>/api/webhooks/stripe`, subscribed to payment_intent.*, charge.refunded, charge.dispute.*, account.updated, transfer.* and setup_intent.succeeded.
   - Dropbox Sign: `/api/webhooks/esign`.
   - Twilio inbound SMS: `/api/webhooks/twilio`. The signature is verified, and this route handles dispatch reply codes and STOP.
7. **Domain.** Map `coverageoncall.com` and `www` to the web service.

### Launch cutover: coveragechiropractor.com

The legacy PHP site stays up until launch day. At cutover:

1. Freeze the legacy site's lead and promo forms. Export its leads and promo codes, then import them through Admin → Leads (manual add or CSV) and Admin → Promo codes.
2. Put a host-level **301** redirect on `coveragechiropractor.com` and `www.coveragechiropractor.com` that sends every path to `https://coverageoncall.com/` (or to `/chiropractic` for the chiropractor landing page), keeping query strings so UTM tags survive. This can be a Cloud Load Balancer URL-map redirect or the old host's `.htaccess`: `RewriteRule ^(.*)$ https://coverageoncall.com/$1 [R=301,L]`.
3. Keep the old domain registered and the redirect in place for at least 12 months. Update Google Business Profile, Search Console (use the change-of-address tool) and email signatures.

## Feature flags awaiting attorney review

These default to **off** and are switched on in Admin → Settings:

- `features.onCallEnabled`: On Call auto-accept (binding bookings). Addendum 02 §13.
- `features.conversionFeeEnabled`: the clinic–provider conversion fee.

`profiles.linkedinVisibility` defaults to `after_confirmation`, which means clinics see a provider's LinkedIn link only after they have confirmed a shift with that provider.
