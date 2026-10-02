# Addendum 03 plan: volume pricing, provider minimum pay, post-shift closing sidebar

Status: **waiting for owner approval** (no code changed yet). Spec: `SPEC_ADDENDUM_03_VOLUME_PRICING.md`.

## 1. Audit: what exists today and where the addendum collides with it

| Area | Today | Addendum 03 | Plan |
|---|---|---|---|
| Rate cards | `RateCard` per region × profession × HALF_DAY / FULL_DAY / HOURLY. FL DC regions are **Major cities** ($625 clinic / $425 provider full day; $375 / $240 half) and **Smaller cities** ($575 / $375; $325 / $200). | Regions named North / Central / South, LIGHT + STANDARD rows, overage on STANDARD. | Keep our two regions. Today's rows become STANDARD; add LIGHT rows + overage. **Prices = decision C2 below.** |
| Premiums | URGENT was replaced by **RUSH** (posted within 24h). WEEKEND, HOLIDAY, BOOST unchanged. | Lists "urgent". | Read "urgent" as RUSH. Premiums multiply the tier base only (`pricing.premiumsApplyToOverage` false). |
| Filter IDs | **F11 is already used** (clinic minimum experience). | Pay floor = F11. | Pay floor becomes **F12**. Same place (core `evaluateEligibility`), so every path (board, alerts, offers, dispatch waves, broadcast, standby, On Call, invites, confirmation) gets it. Not part of `credentialsOnly`. |
| Timesheet | Time clock exists: punches, provider OUT submits, clinic sign-off (portal, email link, on-site signature, auto after `timeclock.autoApproveHours`), "Something's wrong" opens a Dispute. | New dual sign-off timesheet. | **Extend the existing Timesheet**, don't build a second one. Provider enters visits (+ new-patient exams) at punch-out; the clinic's existing sign-off confirms or reports a different count. Same links, same signature. |
| Balance charge | Charged at auto-complete (shift end + `payments.autoCompleteHours`); payout hold measured from completion. | Charge at finalization. | Volume shifts: completion waits for finalization (sign-off, tolerance average, 24h provider-count-stands, or 24h declared-count fallback). Payout hold runs from finalization. Non-volume shifts unchanged. |
| On Call minimums | `OnCallRule.minPay*Cents` exist. | Effective = max(rule, floor). | Done inside dispatch's On Call match. |
| Disputes | `Dispute` model + admin screens. | `TimesheetDispute`. | Reuse `Dispute` with a `kind = VISIT_COUNT` and both counts on the Timesheet; admin sets the final count (audited). |

## 2. Data model (migration 0022 / update-020)

- `enum VolumeTier { LIGHT STANDARD }`
- `RateCard`: `volumeTier VolumeTier?`, `visitCeiling Int?`, `overageClinicCentsPerVisit Int?`, `overageProviderCentsPerVisit Int?`. Existing DC rows become STANDARD (ceiling 25 full / 12 half); LIGHT rows inserted.
- `Profession.volumePricingEnabled Boolean @default(false)` (true for DC).
- `Shift`: `declaredVisits Int?`, `declaredTier VolumeTier?`, `maxOverageVisits Int?` (quoted prices already live on the shift).
- `Assignment`: `finalVisits`, `finalTier`, `overageVisits`, `clinicFinalCents`, `providerFinalCents`, `reconciliationJson`, `finalizedAt`.
- `Timesheet`: `providerVisits`, `providerNewPatients`, `clinicVisits`, `clinicNewPatients`, `countReason`.
- `ProviderPayFloor` (providerId × professionCode: min half / full / hourly, includeMileage).
- New Settings (Section 8 of the spec) in group "Pricing".
- Validation from §2.3 runs when rate cards are saved and when a profession-state pair is enabled.

## 3. Core (tests first)

- `core/pricing/reconcile.ts`: pure `reconcile()`. It does the following:
  - computes the tier from visits;
  - uses `max(declared base, actual base)`;
  - adds overage above the STANDARD ceiling;
  - applies new-patient weighting;
  - adds premiums on the base, plus overtime, mileage and lodging.
  - Table tests cover every example in §5, plus §9 items 1–5.
- `core/volume.ts` helpers:
  - `tierForVisits`;
  - `countOutcome` (confirm / tolerance average rounded down / dispute with the undisputed lower count);
  - the under-declare warning;
  - the median of the last 3 visit counts.
- `evaluateEligibility` gets F12 (pay floor) with the provider's floor and the shift's quoted base pay (+ that provider's mileage when `includeMileage`). The property test that compares `getEligibleProviders` with `assertProviderEligibleForShift` is extended with floors.

## 4. Services and screens

- **Posting:** the wizard's "Details" step gets a required **Expected patient visits** field.
  - It shows the tier and price live, plus the overage rule.
  - It prefills the median of the location's last 3 actual counts and shows the under-declare warning.
  - The quote action prices the declared tier.
- **Provider side:** shift cards, offers and emails read "Light day · ~10 patients · $390".
  - Profile → **My minimum pay** shows the guidance line computed from live rate cards.
- **Clock-out:** the provider enters visits and new-patient exams, with the warning "numbers only — no names or patient details".
  - The clinic's sign-off screens show the count with Confirm / Report a different count.
  - The timeclock sweep runs the §4.3 outcomes and reminders.
- **Payments:**
  - The deposit is taken on the quoted (declared) total.
  - The balance is charged at finalization.
  - A late provider claim (within 72h) is charged as an ADJUSTMENT.
  - A dispute pays the undisputed amount on schedule and holds the rest.
- **Rate boosts and re-tiers** re-run eligibility, so newly eligible providers join the next wave.
- **Clinic tracker** "N more providers would be reached with a rush/boost" (count only).
- **Admin:**
  - a visit-count dispute screen;
  - rate-card editor columns for tier, ceiling and overage;
  - a floor distribution and "excluded by F12" share on the supply page.
- **Statements and invoices** show the reconciliation breakdown.
- **Privacy:** clinic-facing APIs never return floors (a test checks this).

## 5. Post-a-shift "Cost of closing" sidebar (owner request, same release)

On `/clinic/shifts/new`, a sticky panel next to the wizard (desktop) and a collapsible bar above the Continue button (phone).

- It updates as the form changes. **Expected visits** comes from the new field; the coverage price comes from the live quote (tier price × days, including premiums and estimated travel).
- The clinic fills one number: **average collected per visit** (remembered per location in the browser; nothing new stored).
- **Reschedule rate:** a slider, the same as the public calculator.
- The panel shows:
  - **If you close:** collections lost.
  - **If you stay open:** collections minus coverage.
  - The **difference** and the **break-even visits per day**: visits at which coverage pays for itself.
- It uses the existing `core/closing.ts closingComparison`, so the numbers match the public calculator.
- It carries the same "your own numbers, not a guarantee" note.
- Before Addendum 03 lands, it works off the expected-visits field alone (no pricing change), so it can ship first if you'd like.

## 6. Order of work

1. Core reconcile + volume helpers + F12 with tests.
2. Migration 0022 + seed + settings + rate-card validation.
3. Posting (field, quote, warning, prefill) + the sidebar.
4. Provider minimum pay + F12 wired into eligibility and On Call.
5. Clock-out counts, sign-off outcomes, finalization, payments.
6. Admin screens, statements, docs (CLAUDE.md §10 text), release (part1 + part2 + update-020 SQL, since the schema changes).

## 7. Decisions needed from the owner

| # | Decision | Spec default | Recommendation |
|---|---|---|---|
| C1 | Visit ceilings | Full day 12 / 25; half day 6 / 12 | Use as written |
| C2 | Prices for our two FL regions | Central FL: LIGHT $450 / $390, STANDARD $575 / $465 (half $250 / $215, $325 / $265) | See note below |
| C3 | Overage per visit | Clinic $15 / provider $12 | Use as written |
| C4 | New-patient exam = 2 visits | Yes | Yes |
| C5 | Count tolerance | 2 visits | Use as written |
| C6 | $25 booking fee on top | Not included | Skip (no booking fee exists today) |
| C7 | Clinic Agreement wording for overage charges | Attorney review | I'll draft it and bump AGREEMENT_VERSION, so every clinic re-signs before posting. Needs your attorney's OK first. |

**Note on C2:** the spec's STANDARD provider pay ($465) is above what we pay today ($375 smaller cities / $425 major), and its STANDARD margin is lower ($110 vs $150–200). A proposed table for our regions:

| Region | Full LIGHT | Full STANDARD | Half LIGHT | Half STANDARD |
|---|---|---|---|---|
| Smaller cities | $450 / $390 | $575 / $465 | $250 / $215 | $325 / $265 |
| Major cities | $500 / $420 | $625 / $500 | $275 / $235 | $375 / $295 |

(clinic / provider). All of these are rate-card data, editable later under Admin → Rates.
