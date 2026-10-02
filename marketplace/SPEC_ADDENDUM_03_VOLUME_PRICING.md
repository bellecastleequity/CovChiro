# SPEC Addendum 03 — Volume-Based Pricing & Provider Minimum Pay

Applies to: `SPEC.md` v1.0, Addendum 01 (Multi-Profession), Addendum 02 (Smart Dispatch & On Call)
Addendum version: 1.0
Scope: **Pricing model change only.** Everything not mentioned here is unchanged.

---

## 0. Instructions for Claude Code

1. Save as `SPEC_ADDENDUM_03_VOLUME_PRICING.md` at the repo root.
2. **Precedence:** Addendum 03 > Addendum 02 > Addendum 01 > SPEC.md, for pricing, payment reconciliation, and the provider pay filter.
3. Audit the current build and write `docs/migrations/addendum-03-plan.md` before changing code. Show it to the owner first.
4. All prices, thresholds, and amounts here are **Settings / rate card data**, never hard-coded.

---

## 1. Summary

| Change | What it does |
|---|---|
| **Volume tiers** | Each shift is priced by expected patient volume: **Light** (lower price, attracts low-volume clinics) or **Standard**, plus a **per-visit overage** for busy days |
| **Declare, then reconcile** | Clinic declares expected volume when posting (sets the quote). The actual count at the end of the shift can only **raise** the final price, never lower it |
| **Dual sign-off timesheet** | Provider enters the visit count; clinic manager confirms. Mismatches go to a quick review. No patient info, only a number |
| **Provider minimum pay** | Providers set the lowest pay they'll accept. Shifts below it are filtered out of everything: board, notifications, offers, dispatch, On Call |

---

## 2. Volume tiers

### 2.1 Definitions
- **Visit**: one patient encounter with the covering provider during the shift. A new-patient exam counts as `pricing.newPatientVisitWeight` visits (default **2**; OWNER DECISION).
- **Tier**: `LIGHT` or `STANDARD`, defined per profession × duration tier by a visit ceiling.
- **Overage**: each visit above the STANDARD ceiling.

Volume pricing applies to professions with `Profession.pricingModel = TIERED` and `Profession.volumePricingEnabled = true` (new field; default true for DC, false for others until configured). HOURLY professions (e.g., LMT) are unaffected.

### 2.2 Florida DC seed (per rate region; Central FL shown)

| Duration | Tier | Visit range | Clinic price | Provider pay | Platform margin |
|---|---|---|---|---|---|
| Full day (4–8h) | LIGHT | 0–12 | $450 | $390 | $60 |
| Full day | STANDARD | 13–25 | $575 | $465 | $110 |
| Full day | Overage | each visit > 25 | +$15 | +$12 | +$3 |
| Half day (< 4h) | LIGHT | 0–6 | $250 | $215 | $35 |
| Half day | STANDARD | 7–12 | $325 | $265 | $60 |
| Half day | Overage | each visit > 12 | +$15 | +$12 | +$3 |

- North/South FL regions: same structure; prices OWNER DECISION (existing STANDARD rates: $375 half / $625 full).
- Overtime hours (> 8h) still apply per SPEC.md 8.2, on top of volume pricing.
- Premiums (urgent, weekend, holiday, boost) apply multiplicatively to the **tier base** (clinic price and provider pay). Overage per-visit amounts are **not** multiplied (setting `pricing.premiumsApplyToOverage`, default false).
- Mileage and lodging: unchanged, 100% pass-through.

### 2.3 Rate card changes

```prisma
model RateCard {
  // existing: rateRegionId, professionCode, durationTier, effectiveFrom/To
  volumeTier            VolumeTier?   // null for HOURLY / non-volume professions
  visitCeiling          Int?          // LIGHT: 12, STANDARD: 25 (full day)
  clinicPriceCents      Int
  providerPayCents      Int
  // overage (only on STANDARD rows)
  overageClinicCentsPerVisit   Int?
  overageProviderCentsPerVisit Int?
}
enum VolumeTier { LIGHT STANDARD }

model Profession {
  // + 
  volumePricingEnabled Boolean @default(false)
}
```

Validation: for each region × profession × duration, LIGHT and STANDARD rows must both exist, `LIGHT.visitCeiling < STANDARD.visitCeiling`, and `LIGHT.clinicPrice < STANDARD.clinicPrice`. A profession-state pair cannot be enabled without complete volume rate cards when `volumePricingEnabled = true`.

---

## 3. Declaring volume (posting)

- Post-shift wizard adds a required field: **"Expected patient visits"** (a number). The system shows the resulting tier and price: "Light day — $450 (up to 12 visits). Busier days are billed +$15 per visit over 25."
- After a clinic's first 3 completed shifts at a location, pre-fill with the **median actual visit count** from past shifts there, and show it: "Your last 3 coverage days averaged 18 visits."
- Store on `Shift`: `declaredVisits Int`, `declaredTier VolumeTier`, and the quoted prices for that tier.
- The provider sees the declared tier and expected visits on the shift card and offer: "Light day · ~10 patients · $390."

**Under-declaring guardrail:** if a location's last 3 actual counts all exceeded the declared tier's ceiling, show the clinic a warning when posting LIGHT ("Your recent coverage days averaged 21 visits. Declaring Light may reduce provider interest; overage will apply."). Do not block posting.

---

## 4. End-of-shift timesheet and sign-off

### 4.1 Provider entry
When a shift ends (or the provider taps "End shift"), the provider enters:
- Actual start/end time
- **Total visits** (with a separate field for new-patient exams if `newPatientVisitWeight ≠ 1`)
- Optional note (≤ 300 chars; PHI warning; contact-info redaction rules from SPEC.md 10.3)

**No patient names, initials, DOBs, or any identifying details.** Numbers only (INV-4). The UI says so explicitly.

### 4.2 Clinic confirmation
The clinic manager (any `CLINIC_STAFF` or `CLINIC_OWNER` at that location) gets a push/SMS/email: "Confirm today's coverage: 8:00a–5:15p, 22 visits (2 new patients)." Options: **Confirm** or **Report a different count** (enter their numbers + reason).

### 4.3 Outcomes
| Situation | Result |
|---|---|
| Clinic confirms | Final price calculated (Section 5); balance charged; payout scheduled |
| Clinic reports a count within `pricing.countTolerance` (default 2 visits) of the provider's | Use the **average, rounded down**; finalize automatically |
| Difference > tolerance | `TimesheetDispute` opened; **undisputed amount** (price at the lower count) finalized and paid on schedule; difference held for admin review |
| Clinic doesn't respond within `pricing.signoffHours` (default 24h) | **Provider's count stands**; finalize automatically; clinic notified |
| Provider doesn't submit within 12h of shift end | Reminder; at 24h, finalize at the **declared** count (no overage); provider can still submit within 72h to claim overage |

### 4.4 Disputes
Admin sees both counts, notes, shift times, and the location's historical visit counts. Admin sets the final count (audit-logged). Repeated disputes from the same clinic or provider are flagged on their profile for admin.

---

## 5. Reconciliation rule (the core rule)

```
finalVisits      = weighted visit count from Section 4 outcome
declaredBase     = tier base for declaredTier (with premiums)
actualTier       = tier whose ceiling contains finalVisits (STANDARD if above LIGHT ceiling)
actualBase       = tier base for actualTier (with premiums)

base             = max(declaredBase, actualBase)          // never below what was declared
overageVisits    = max(0, finalVisits − STANDARD.visitCeiling)
clinicFinal      = base.clinic   + overageVisits × overageClinicPerVisit   + overtime + mileage + lodging
providerFinal    = base.provider + overageVisits × overageProviderPerVisit + overtime + mileage + lodging
```

Rules:
- **The price can only go up from the declared tier, never down.** The provider committed the day based on the quote; patient no-shows are not the provider's loss.
- A LIGHT declaration that ends with 14 visits is re-tiered to STANDARD (both clinic price and provider pay).
- All reconciliation logic lives in `/packages/core/pricing/reconcile.ts` as a pure function with exhaustive unit tests.
- Store the full breakdown on the assignment (`finalVisits`, `finalTier`, `overageVisits`, `clinicFinalCents`, `providerFinalCents`, `reconciliationJson`) and show it on both the clinic invoice and the provider earnings statement.

### Examples (Central FL full day)
| Declared | Actual visits | Clinic pays | Provider gets |
|---|---|---|---|
| LIGHT (10) | 9 | $450 | $390 |
| LIGHT (10) | 16 | $575 (re-tiered) | $465 |
| STANDARD (20) | 9 | $575 (no downgrade) | $465 |
| STANDARD (20) | 35 | $575 + 10 × $15 = **$725** | $465 + 10 × $12 = **$585** |

---

## 6. Payment flow changes (diff against SPEC.md 9.2)

1. **At confirmation**: deposit = `payments.depositPercent` of the **quoted** clinic total (declared tier + estimated mileage).
2. **At finalization** (Section 4.3 outcome, not at shift end + 2h): charge the balance = `clinicFinal − deposit`.
3. **Payout**: release `providerFinal` per the existing payout hold, measured from finalization. In a dispute, pay the undisputed amount on schedule and the remainder when resolved.
4. Clinic payment method must be authorized for overage: the Clinic Agreement adds consent to charge the reconciled amount (ATTORNEY REVIEW). Show the overage rule at posting and in the confirmation email.
5. Optional cap: clinics may set `maxOverageVisits` on a shift; if the provider reports more, the excess is still recorded but flagged for admin instead of auto-charged.

---

## 7. Provider minimum pay

### 7.1 What providers set
Per profession, on the provider's profile ("My minimum pay"):
- `minHalfDayCents`, `minFullDayCents` (TIERED professions)
- `minHourlyCents` (HOURLY professions)
- Toggle: **"Include mileage when comparing"** (default **off**: the minimum compares against base pay only)

Shown with guidance: "Shifts paying less than this won't be shown or offered to you. Florida chiropractic full days currently pay $390–$465 before overage."

```prisma
model ProviderPayFloor {
  providerId      String
  professionCode  String
  minHalfDayCents Int?
  minFullDayCents Int?
  minHourlyCents  Int?
  includeMileage  Boolean @default(false)
  updatedAt       DateTime @updatedAt
  @@id([providerId, professionCode])
}
```

### 7.2 How it's applied
New hard filter **F11 — Pay floor**, added to `getEligibleProviders` / `assertProviderEligibleForShift` (and so applied everywhere eligibility is used: shift board, notifications, applications, clinic candidate list, offers, Smart Dispatch waves, broadcast, standby, On Call).

```
quotedPay = provider pay for the shift's declared tier, with premiums applied
            (+ estimated mileage for this provider if includeMileage)
eligible  = quotedPay ≥ the provider's floor for that duration/profession (no floor set = pass)
```

- Overage is **not** counted toward the floor (it's not guaranteed).
- **On Call** rules keep their own minimums (Addendum 02, 4.2). The effective On Call minimum = `max(OnCallRule min, ProviderPayFloor)`.
- If the shift's pay increases (rate boost, re-tier at posting edit, premium added), re-run eligibility: newly eligible providers enter the current dispatch at the next wave and get "new shift" alerts.
- Floors are re-checked at confirmation (same transaction as INV-1). A provider who raises their floor after confirming keeps the confirmed shift.

### 7.3 Visibility and privacy
- Clinics **never** see any provider's floor.
- The clinic live tracker and the "exhausted" notice may say: "**N more providers** in range would be reached with an urgent rate boost," computed by re-running F11 at the boosted pay. Never name the providers.
- Admin dashboard: distribution of floors by region/profession/duration, and the share of eligible providers excluded by F11 per shift. This feeds rate card decisions.

### 7.4 Interaction with INV-7
Providers can't set prices, and clinics can't negotiate them. A floor only filters; it never changes the price. INV-7 is unchanged.

---

## 8. Settings added

| Key | Default |
|---|---|
| `pricing.newPatientVisitWeight` | 2 |
| `pricing.countTolerance` | 2 visits |
| `pricing.signoffHours` | 24 |
| `pricing.providerSubmitReminderHours` | 12 |
| `pricing.providerSubmitFinalizeHours` | 24 |
| `pricing.providerLateOverageClaimHours` | 72 |
| `pricing.premiumsApplyToOverage` | false |
| `pricing.underDeclareWarningShifts` | 3 |

---

## 9. Tests (required in CI)

**Reconciliation (pure function, table-driven)**
1. Every example in Section 5 produces exact clinic and provider totals.
2. Actual below declared never lowers the base (LIGHT→LIGHT, STANDARD stays STANDARD).
3. LIGHT declared, actual above LIGHT ceiling → re-tiered to STANDARD.
4. Overage counts only visits above the STANDARD ceiling; new-patient weighting applied.
5. Premiums apply to the base only (unless setting enabled); overtime and mileage added correctly.

**Sign-off flow**
6. Confirm → finalize; within tolerance → average rounded down; beyond tolerance → dispute with undisputed payout on time.
7. No clinic response in 24h → provider count stands.
8. No provider submission in 24h → finalize at declared; late submission within 72h adds overage via adjustment charge.
9. Timesheet note with phone/email is redacted; PHI warning shown.

**Pay floor (F11)**
10. Provider with full-day floor $450 never sees, is never notified of, offered, dispatched, or On Call-matched for a LIGHT full day paying $390.
11. Same provider becomes eligible after an urgent rate boost raises pay above $450, and joins the next wave.
12. `includeMileage = true` uses the provider's own estimated mileage.
13. `getEligibleProviders` and `assertProviderEligibleForShift` agree with floors included (extend the property-based test).
14. Clinic-facing APIs never return floor values.
15. Effective On Call minimum = max(On Call rule, floor).

---

## 10. CLAUDE.md additions

```md
## Addendum 03 — Volume pricing & provider pay floor (SPEC_ADDENDUM_03_VOLUME_PRICING.md)
Precedence: Addendum 03 > 02 > 01 > SPEC.md for pricing/reconciliation.
- Shifts are priced by declared volume tier (LIGHT/STANDARD) + per-visit overage above the STANDARD ceiling.
- Reconciliation can only raise the price from the declared tier, never lower it. Logic lives only in packages/core/pricing/reconcile.ts.
- Timesheets record visit COUNTS only. Never names or any patient detail.
- Provider pay floor is hard filter F11 inside getEligibleProviders / assertProviderEligibleForShift. Never expose floors to clinics.
```

---

## 11. Open decisions for the owner

| # | Decision | Default in spec |
|---|---|---|
| C1 | LIGHT/STANDARD ceilings (full day 12/25; half day 6/12) | as shown |
| C2 | Light-day prices and provider pay; North/South FL tier prices | Central FL seed |
| C3 | Overage amounts per visit (clinic $15 / provider $12) | as shown |
| C4 | Does a new-patient exam count as 2 visits? | Yes |
| C5 | Count tolerance before a dispute | 2 visits |
| C6 | Should the $25 booking fee (Option C) stack on top of tier pricing? | Not included |
| C7 | Clinic Agreement language consenting to reconciled overage charges | ATTORNEY REVIEW |
