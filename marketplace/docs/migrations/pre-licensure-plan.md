# Pre-licensure recruitment (students & new graduates) — audit and plan

Status: DRAFT for owner approval. Owner direction (2026-10-01): pre-licensure
must be an **opt-in path** behind a "Student / not yet licensed" toggle — not
extra fields or a new default for every provider.

## The one rule this must never weaken
Registration and shift eligibility stay separate. INV-1 (verified license for
the shift's profession + state, valid through shift end) and INV-3 (verified
malpractice covering the profession, valid through shift end) are untouched:
`assertProviderEligibleForShift` / `getEligibleProviders`, the
`provider_shift_problem` trigger, the nightly credential sweep and the 24h
pre-shift check stay exactly as they are. The student flag is **never read by
eligibility code**. A pre-licensure provider stays `ONBOARDING` until the
existing activation rules pass; admin approval still never waives credentials.

## Audit — what already exists
| Scope item | Today | Change |
|---|---|---|
| Sign up without a license | Yes — signup asks name/email/profession only; licenses come later | Add the opt-in toggle + student fields (below) |
| Separate license & malpractice statuses | `LicenseStatus` on `License` and `MalpracticePolicy`: PENDING_VERIFICATION, VERIFIED, EXPIRED, SUSPENDED, REVOKED, REJECTED | None. Display mapping: no record = Not provided; PENDING_VERIFICATION = Verification pending (the app collects number + expiry with the upload, so "Uploaded" and "Pending" are one state); REJECTED = Needs correction |
| Hard eligibility rule, backend + DB | INV-1/INV-3 at 8 layers incl. DB trigger | None — add tests proving the student flag can't bypass it |
| Admin verification | `/admin/verification` queue | Show a "Student" badge and graduation date |
| Expiry → ineligible, future shifts handled | Nightly sweep expires credentials, flags `LICENSE_LAPSED`, alerts admin, notifies, auto-backfills | None (already stronger than "flag for review") |
| Renewal reminders | 60/30/7 days, hard-coded in `expiryReminderDue` | **Ask (D2):** make a Setting, default 60/30/14/7 — affects all providers |
| Setup checklist | "Finish setting up" card on provider home | Student variant only (below) |
| Leads with UTM | `Lead` (audience PROVIDER, utm fields) + drip | Reuse for step-1 capture on `/join` |
| First-party analytics | `AnalyticsEvent` with utm | Reuse for page visits / conversions |
| Ready email | `provider_ready` once per profession | Reuse as the "Coverage Ready" moment |
| Home geo | `homeGeo` (PostGIS), city, state | Add county + ZIP from the geocoder for supply reports |

## The toggle
- **Signup (provider tab):** a switch "I'm a student or new graduate — not licensed yet". Off by default. When on, extra fields appear: school, graduation / expected graduation date, state(s) you intend to be licensed in, licensure application submitted? (no / yes), expected licensure timeframe, preferred work area, ZIP, SMS consent. When off, signup is unchanged.
- **`/join` and `/join/<campaign>`** (new recruitment pages): same form with the switch pre-set to on.
- **Provider profile:** the same switch, so an existing onboarding provider can opt in (or out) later.
- **Auto-graduates:** the flag turns itself off when the provider's first license is verified; from then on they're an ordinary provider (follow-ups stop, normal checklist).
- **Setting:** `features.preLicensureEnabled` (default on) hides the switch and `/join` site-wide if you ever want to pause the program.

## Data model (additive only; migration `0010_pre_licensure`, cPanel `update-009-pre-licensure.sql`)
`Provider` gains:
- `preLicensure Boolean @default(false)`, `preLicensureSince`, `graduatedOutAt`
- `graduationDate Date?` (existing `graduationYear` kept and derived from it)
- `licensureApplied String?` (no | yes), `expectedLicensure String?` (0-1 | 1-3 | 3-6 | 6-12 | 12+ | unsure months)
- `intendedStates String[]` — **display/planning only; never used for eligibility**
- `preferredArea String?`, `homeZip String?`, `homeCounty String?`
- Attribution: `acquisitionSource String?` (school | event | facebook | instagram | google | referral | provider_referral | clinic_referral | organic | direct | other), `acquisitionDetail`, `recruitCampaignId`, `utmSource/Medium/Campaign/Term/Content`, `landingPath`, `referredBy`
- Follow-ups: `credFollowupStep Int @default(0)`, `credFollowupLastAt`, `credFollowupLastKind`, `credFollowupOptOut`

New `RecruitCampaign`: slug (unique), name, kind (SCHOOL | EVENT | CAMPAIGN), state, headline, costCents, active, createdAt. Seeded with Palmer (FL, Davenport, West), Life, Keiser, Sherman, Logan, Parker, National, Northwestern, Cleveland, Texas, UWS, Life West, SCU, Northeast, Bridgeport. Visits come from `AnalyticsEvent` (no counter column).

Attribution fields are also captured for non-student signups (cheap and useful for the funnel), but none of the student fields appear unless the toggle is on.

## Lifecycle stage (computed, pure function in `packages/core`)
Registered / New Graduate (student flag on, before graduation, no license) → Pending License → Licensed / Pending Malpractice → Credential Verification Pending → Coverage Ready (would pass matching today) → Active Provider (has worked or holds a confirmed shift). Computed from existing rows; nothing is stored that eligibility could read.

## Provider dashboard (student variant only)
"Your Coverage Readiness" card replacing "Finish setting up" while the flag is on: ✓ Account created · ✓ Contact information · ✓ Graduation information · ○ License · ○ Malpractice · ○ Credential verification, then 🔒 "Coverage shifts locked — complete credential verification to begin accepting coverage opportunities." Stripe, agreement, photo and NPI steps appear as "after you're licensed" so students aren't nagged about them. Once ready: "✓ COVERAGE READY — you are eligible to accept available coverage shifts."

## Credential follow-ups (student flag on only)
New sweep `preLicensureFollowups` (daily, `jobs.ts`), state-aware:
- License missing → "Have you received your chiropractic license?" CTA **I'm Licensed — Complete My Profile**
- License pending → no license reminders; malpractice nudge only if malpractice is missing
- License verified, malpractice missing → "Your license has been received and verified. Add your malpractice insurance…"
- Rejected → "needs correction" with the admin's reason
- Both submitted and pending → nothing sent ("Credentials under review" shown on the dashboard)
- Both verified → stop; the existing `provider_ready` email is the hand-off to the active-provider workflow
Timing from graduation date (or signup, if later). Settings, all editable in admin: `prelicensure.followupDays` [30,60,90], `prelicensure.repeatDays` 60, `prelicensure.minGapDays` 14, `prelicensure.followupsEnabled` true. One email per provider per run; unsubscribe link sets `credFollowupOptOut`.

## Admin
- **Recruitment** (`/admin/recruitment`): campaign links with QR codes, visits → leads → signups → coverage-ready → first shift, spend and cost per signup / per coverage-ready provider.
- **Provider funnel** (on `/admin/analytics`): Leads → Registered → Graduated → License submitted → Licensed → Both submitted → Coverage-ready → First shift → Repeat; filter All / Students only; by source and campaign. Headline numbers always show **Registered** and **Coverage-ready** separately, with a note that marketing should quote coverage-ready.
- **Supply** (`/admin/supply`): coverage-ready providers by state, county, city, ZIP; "within 25/50/75/100 miles of a clinic ZIP" via PostGIS `homeGeo`, plus "…and within their max drive time".
- Provider list/detail: Student badge, stage, graduation date, follow-up history.

## Tests
- `packages/core`: stage function, follow-up kind selection, cadence math (fixed clock).
- `tests/invariants/pre-licensure.test.ts`: a student-flagged provider with pending / rejected / expired credentials can't be shown, offered, invited, confirmed or inserted into `Assignment` (trigger); admin approval + student flag still can't; graduating out changes nothing about eligibility.
- Follow-up sweep: never asks for something done; stops on verification; respects opt-out and min gap.
- `migrations-list.test.ts` updated for `0010_pre_licensure`.

## Decisions for the owner
- **D1** Toggle placement: signup + `/join` + profile, auto-off when first license is verified. *(default: yes)*
- **D2** Renewal reminders: make configurable and add 14 days (60/30/14/7) **for all providers**, not just students. *(default: yes — say no to leave renewals untouched)*
- **D3** Students see payouts/agreement/NPI steps as "after you're licensed" rather than required now. *(default: yes)*
- **D4** SMS: consent is recorded; texts for credential follow-ups use the existing Twilio integration only if you want them — otherwise email only. *(default: email only)*
