# SPEC Addendum 02 — Smart Dispatch (Ranked Waves) & On Call Auto-Accept

Applies to: `SPEC.md` v1.0 and `SPEC_ADDENDUM_01_MULTI_PROFESSION.md`
Addendum version: 1.0
Priority: **Core product feature.** This is the main thing that makes CoverageOnCall faster and better than the "text everyone, first callback wins" approach used by existing staffing agencies.

---

## 0. Instructions for Claude Code

1. Save as `SPEC_ADDENDUM_02_DISPATCH_ONCALL.md` at the repo root.
2. **Precedence:** Addendum 02 > Addendum 01 > SPEC.md, for anything they conflict on.
3. This addendum **replaces** the offer cascade in SPEC.md Section 7.7 step 4 (sequential offers and "urgent parallel offers to top 3, first accept wins"). It does not change applications, clinic selection, the favorites window, or the selection deadline for planned shifts.
4. Before editing code, audit what exists and write `docs/migrations/addendum-02-plan.md`. Show it to the owner before implementing.
5. All numbers in Section 11 are Settings (admin-editable), never hard-coded.
6. Terminology follows Addendum 01 ("Provider", professions, `getEligibleProviders`, `assertProviderEligibleForShift`).

---

## 1. Summary

| Problem with "text everyone, first callback wins" | How this addendum fixes it |
|---|---|
| Rewards whoever sees their phone first, not the best fit | **Rank-protected awards**: the best-matched provider who accepts wins, not the fastest |
| Spams every provider in the market | **Ranked waves**: small groups at a time, growing only if needed |
| Strict one-at-a-time offers are too slow | Waves run in parallel; ~30 providers reached in 30 minutes for same-day shifts |
| Busy providers (treating patients) miss offers | **Responsiveness-aware ordering** + **On Call** auto-accept |
| Clinics wait and wonder | **Live dispatch tracker** for the clinic |

Two new features:
- **Smart Dispatch**: ranked waves with rank-protected confirmation.
- **On Call mode**: providers pre-authorize shifts that meet their rules and are confirmed instantly.

---

## 2. Concepts

- **Dispatch**: one run of the system trying to fill one shift. A shift can have several dispatches over its life (e.g., initial fill, then backfill after a cancellation).
- **Wave**: a group of providers who receive the offer at the same time, with one shared accept window.
- **Match score**: the SPEC.md 7.3 score (as revised by Addendum 01). Measures fit. **Decides who wins.**
- **Dispatch score**: match score adjusted for the chance the provider responds in time. **Decides who gets asked first.**
- **Rank-protected confirm**: an accepting provider is confirmed immediately only if every provider in the same wave with a higher match score has already declined or timed out.
- **Next in line**: a provider who accepted but is waiting on a higher-ranked provider.
- **Standby**: providers who accepted but weren't selected; first in line if the confirmed provider later cancels.
- **On Call**: a provider mode with rules for pre-authorized, instantly confirmed shifts.
- **Urgency tier**: based on time remaining until shift start **at the moment dispatch begins or a wave is sent**.

| Tier | Time until shift start |
|---|---|
| `SAME_DAY` | < 12 hours |
| `SHORT` | 12–48 hours |
| `NEAR` | 2–7 days |
| `PLANNED` | ≥ 7 days |

The tier is re-evaluated before each wave, so a dispatch that runs long can escalate from `SHORT` to `SAME_DAY` settings.

---

## 3. When dispatch starts

| Trigger | Behavior |
|---|---|
| Shift posted with tier `SAME_DAY` or `SHORT` | Skip favorites window (as in SPEC.md 7.4). Run the On Call check immediately, then waves. Applications remain open in parallel; an application is treated like an acceptance in the current wave (Section 5.6). |
| Shift posted with tier `NEAR` or `PLANNED` | Normal flow: favorites window → open applications → clinic selection → selection deadline. **At the selection deadline**, if no applicant qualifies for auto-select (SPEC.md 7.7 step 3), start dispatch. |
| Confirmed provider cancels, no-shows in advance, or license lapses (backfill) | Start dispatch immediately at the current tier. **Standby list first** (Section 7), then On Call check, then waves. |
| Clinic clicks "Find someone now" | Start dispatch immediately, skipping any remaining selection window. |
| Admin clicks "Dispatch" | Same as above; logged. |

A shift has at most one active dispatch. Starting a new one requires the previous one to be `FILLED`, `EXHAUSTED`, or `CANCELLED`.

---

## 4. On Call mode

### 4.1 What it is
A provider turns on **On Call** and sets rules. When a shift matches their rules, the system confirms them **instantly**, with no offer, no waiting, and no reply needed. This is the fastest path to a filled shift and the signature feature of the brand.

### 4.2 Rules a provider sets (`OnCallRule`)
- **When**: specific dates and/or recurring weekdays, with time windows (e.g., "Mon/Wed/Fri 7am–7pm", "Oct 12–18 all day").
- **Profession(s)**: only professions the provider is `ACTIVE` in.
- **Where**: max drive minutes from home (≤ their global max). The UI shows only profession-state pairs where they hold a qualifying license, and the rule can never widen that (INV-1).
- **Minimum pay**: minimum total pay for a half day, full day, or hourly shift (excluding mileage/lodging).
- **Minimum notice**: e.g., "at least 90 minutes before the shift starts."
- **Limits**: max On Call shifts per day and per week.
- **Clinic filters** (optional): only favorited clinics, minimum clinic rating, excluded clinics.
- **Overnight**: whether lodging-eligible shifts are allowed.

### 4.3 Eligibility to use On Call
- Profile `ACTIVE` in that profession, payouts enabled, provider agreement includes the **On Call Terms** (auto-accept is a binding commitment — ATTORNEY REVIEW).
- Reliability ≥ `oncall.minReliability` (default 0.85) and ≥ `oncall.minCompletedShifts` (default 1; OWNER DECISION: set 0 to allow new providers).
- Verified mobile number with SMS enabled.

### 4.4 On Call check (runs before every wave sequence)
1. Candidates = `getEligibleProviders(shift)` (INV-1, INV-3, INV-8, all hard filters) ∩ providers with an active `OnCallRule` that matches this shift (time, profession, drive, pay, notice, limits, clinic filters, overnight).
2. Remove anyone who is `SNOOZED`, in quiet hours without urgent opt-in (On Call rules count as opt-in for their own time windows), or at their daily/weekly On Call limit.
3. Sort by **match score** (not dispatch score; On Call providers have already said yes).
4. Try to confirm #1 via the SPEC.md 7.8 confirmation transaction with `selectionMethod = ON_CALL_AUTO`. If it fails (race, conflict, eligibility changed), try #2, and so on.
5. On success: notify the provider immediately (SMS + push + email) and the clinic ("Confirmed: [name], arriving ~8:45am").
6. If nobody qualifies: continue to waves.

### 4.5 Grace period
- The provider has `oncall.graceMinutes` (default 10) to cancel an auto-accepted shift **without a reliability penalty**, via one tap in the confirmation SMS/page.
- If they cancel within grace: the clinic is notified ("Your provider had a conflict — we're already finding another"), the provider is excluded from this shift, and dispatch resumes instantly at the next On Call candidate, then waves.
- Grace cancellations are tracked. More than `oncall.maxGraceCancels30d` (default 2) in 30 days auto-pauses the provider's On Call mode, and they are notified.

### 4.6 On Call and planned shifts
For `NEAR`/`PLANNED` shifts, On Call does not jump ahead of the clinic's own selection window. Instead, the clinic's candidate list shows a **"Instant confirm available"** badge on providers whose On Call rules match. The clinic can pick them and they are confirmed immediately without an offer. At the selection deadline, the On Call check runs before waves.

### 4.7 UI
- Provider dashboard: a prominent **"Go On Call"** toggle, with a rules editor and a plain-language summary: "You'll be auto-booked for chiropractic shifts within 45 min of home, weekdays 7am–6pm, paying at least $450/day. Up to 1 per day."
- Clear status: "On Call until 6:00pm today."
- Quick actions: "Pause for today," "Pause until…"

---

## 5. Smart Dispatch (ranked waves)

### 5.1 Build the candidate list
At dispatch start and **before each wave**:
1. `getEligibleProviders(shift)`: INV-1 (profession + state licensure), INV-3, INV-8, and every hard filter from SPEC.md 7.1 / Addendum 01 7.1. **This is always the first step; nothing in dispatch can add a provider this function excludes.**
2. Remove: providers already offered in this dispatch (unless revivable, 5.6), who declined this shift, who are blocked, snoozed, over their daily offer cap (5.9), or in quiet hours without urgent opt-in (for `SAME_DAY`/`SHORT`).
3. **Arrival feasibility**: remove providers who can't make it in time: `now + driveMinutes + dispatch.arrivalBufferMinutes (15) > shift.startsAt`. Critical for same-day shifts.

### 5.2 Order candidates (dispatch score)

```
dispatchScore = matchScore × (1 − β + β × pRespond(tier))
```

- `pRespond(tier)` = probability the provider responds (accept OR decline) within that tier's accept window (Section 6).
- `β` per tier (settings): `SAME_DAY` 0.6, `SHORT` 0.4, `NEAR` 0.2, `PLANNED` 0.2.
- Effect: for a same-day shift, a strong match who rarely answers quickly is moved behind a slightly weaker match who reliably answers in minutes, but still gets asked. For a week-out shift, response speed barely matters.
- Ties: higher match score → shorter drive → fewer shifts this month → seeded random.

### 5.3 Wave sizes and windows (defaults; all settings)

| Tier | Wave 1 size | Growth per wave | Max wave size | Accept window | Waves before broadcast |
|---|---|---|---|---|---|
| `SAME_DAY` | 5 | +3 | 15 | 5 min | 3 |
| `SHORT` | 3 | +2 | 10 | 15 min | 3 |
| `NEAR` | 3 | +2 | 8 | 90 min | 4 |
| `PLANNED` (after deadline) | 3 | +2 | 8 | 2 h | 4 |

Wave `n` size = `min(wave1 + (n−1) × growth, max)`, limited by remaining candidates.

The accept window is also capped so it can't run past the point where the last provider in the wave could still arrive: `windowEnd ≤ shift.startsAt − max(driveMinutes in wave) − arrivalBuffer`. If that makes the window shorter than `dispatch.minWindowMinutes` (3), drop the farthest providers from the wave instead.

### 5.4 Wave lifecycle and rank-protected confirm

When a wave is sent, each provider gets an `Offer` (with its match score recorded). Then:

**On each ACCEPT (from any channel):**
1. Lock the dispatch (Postgres advisory lock on `shiftId`).
2. Re-check `assertProviderEligibleForShift` (INV-1 etc.). If it fails: mark the offer `INELIGIBLE`, tell the provider "This shift is no longer available to you," continue.
3. Mark the offer `ACCEPTED_PENDING`.
4. **Rank-protected check**: are there offers in this wave with a **higher match score** that are still `PENDING` (no response yet)?
   - **No** → confirm this provider now (SPEC.md 7.8 transaction, `selectionMethod = DISPATCH_WAVE`). Close the wave; all other `PENDING`/`ACCEPTED_PENDING` offers become `NOT_SELECTED` (acceptors go to standby, Section 7).
   - **Yes** → tell the provider: "You're next in line. You'll know by 9:14am." Keep them `ACCEPTED_PENDING`.

**On each DECLINE or individual expiry:**
- Mark the offer. Then re-run the rank-protected check for the highest-ranked `ACCEPTED_PENDING` offer: if no higher-ranked offer is still `PENDING`, confirm them now.

**On wave window close** (job `waveClose`):
- If any `ACCEPTED_PENDING`: confirm the one with the highest match score.
- Else: expire remaining `PENDING` offers (they stay revivable, 5.6) and send the next wave (re-building the candidate list and re-evaluating the tier first).
- If all offers in a wave are declined before the window closes, send the next wave immediately.

**Result:** if the best provider in the wave says yes, the shift fills in seconds; a lower-ranked "yes" waits at most one window, and only if someone better hasn't answered yet.

### 5.5 Broadcast (final stage)
After the configured number of waves, send the offer to **all remaining eligible candidates** (subject to offer caps and quiet hours).

| Tier | Broadcast window | Hold after first accept |
|---|---|---|
| `SAME_DAY` | 15 min | 3 min |
| `SHORT` | 30 min | 10 min |
| `NEAR` | 4 h | 30 min |
| `PLANNED` | 6 h | 60 min |

Award rule: when the first acceptance arrives, start a **hold timer**. At the earlier of (hold timer ends) or (broadcast window ends), confirm the acceptor with the highest match score. Rank protection is simplified here because waiting on dozens of providers would take too long. **Still never "first to answer wins."**

### 5.6 Revivable offers and parallel applications
- An offer that expired in an earlier wave stays **revivable** while the dispatch is active. If that provider taps Accept late, their acceptance joins the **current** wave with their original match score and goes through the normal rank-protected check. (The link says: "This offer's window passed, but the shift is still open — accept now to be considered.")
- A new **application** submitted during an active dispatch is treated as an acceptance in the current wave (same rank-protected logic). Existing active applications are treated as acceptances in wave 1.

### 5.7 Exhaustion
If broadcast ends with no acceptance, or no candidates remain:
- Dispatch → `EXHAUSTED`.
- Notify clinic and admin; offer the SPEC.md 7.7 step 5 "urgent rate boost" (price + pay premium, widened radius for overnight-willing providers). Accepting the boost starts a **new dispatch**. INV-1 is never relaxed.
- If the shift reaches start time unfilled → `UNFILLED`, full refund (SPEC.md).

### 5.8 Clinic overrides
At any time during a dispatch, the clinic can:
- Pick any eligible provider from the live list (applicants, accepted-pending, or recommended). Picking an applicant or accepted-pending provider confirms immediately; picking anyone else sends a direct offer that wins if accepted before the dispatch fills.
- Cancel the dispatch (e.g., found coverage elsewhere — subject to cancellation terms).

### 5.9 Provider fatigue protections
- Max offers per provider per day: `dispatch.maxOffersPerProviderPerDay` (default 8) across all shifts.
- Max concurrent pending offers per provider: 3. Beyond that, they're skipped until they respond.
- If a provider ignores `dispatch.autoSnoozeAfterIgnored` (default 5) consecutive offers, they're auto-snoozed for 24h with a message: "We paused offers for 24 hours. Tap to resume anytime."
- Providers can snooze for today, this week, or until a date.

---
## 6. Responsiveness model

### 6.1 What's tracked
For every offer: `sentAt`, `deliveredAt` (SMS/push delivery receipt), `openedAt` (link opened), `respondedAt`, `response` (ACCEPT / DECLINE / none), `tier`, `windowMinutes`, and local hour of day.

### 6.2 pRespond
Per provider, per tier, over the trailing `responsiveness.lookbackDays` (default 90):

```
pRespond(tier) = (a + hits) / (a + b + n)
```
- `n` = offers sent in that tier; `hits` = offers answered (accept **or** decline) within that tier's window.
- Beta prior `a = 2`, `b = 2` (new providers start at 0.5).
- If a provider has < 3 offers in a tier, blend with their overall rate across tiers.
- Recency weighting: offers older than 30 days count half.
- Phase 3 option (setting, off by default): separate rates for time-of-day buckets (before 9am, 9–5, after 5).

### 6.3 Rules
- **A decline counts as a good response.** The UI encourages "tap Decline if you can't make it" because it speeds up the next wave.
- Responsiveness is separate from reliability. Missing offers never lowers reliability or star ratings; it only affects position in urgent waves.
- Providers see their own stats: "You answer 80% of same-day offers within 5 minutes." Clinics never see responsiveness.
- On Call auto-accepts count as immediate responses.

---

## 7. Next in line & standby

- A provider in `ACCEPTED_PENDING` sees a live status and the time they'll hear back.
- When a shift is awarded to someone else, every other acceptor gets: "This shift was filled by another provider. You're on **standby** — if it reopens, you'll be first." They're added to `StandbyEntry` for that shift.
- **Backfill uses standby first**: if the confirmed provider cancels, standby providers (still eligible, re-checked via INV-1) are offered in match-score order with a short window (`SAME_DAY` 5 min, otherwise 15 min), using the same rank-protected logic. If none accept, the On Call check and waves run.
- Accepting and not being selected carries **no penalty**. Optional courtesy boost: +`dispatch.standbyCourtesyBoost` (default 0.02) to that provider's dispatch score for 7 days (setting; can be 0).
- Standby expires when the shift starts.

---

## 8. Channels and replies

### 8.1 Offer message
SMS (primary for `SAME_DAY`/`SHORT`), push notification, in-app, and email (`NEAR`/`PLANNED` only, or if SMS is disabled). Content:

```
CoverageOnCall: Chiropractic coverage TODAY 9:00a–5:00p, Winter Park FL (22 min away).
Pay $505 + $4 mileage. Clinic rated 4.8.
Accept: coverageoncall.com/o/Ab3xQ   or reply YES 4821 / NO 4821
Offer closes 7:21a.
```

- Show profession, date/time, city, drive time, total pay (pay + mileage), clinic rating, and closing time in the **provider's** time zone. No street address until confirmed.
- No patient information, ever (INV-4).

### 8.2 Accept link
- Signed, single-use token bound to (offer, provider), expiring when the dispatch ends.
- Opens a mobile page with shift details, a live countdown, and big **Accept** / **Decline** buttons. One tap to accept (the commitment was agreed in the Provider Agreement). If logged out, the token alone is enough for accept/decline on this offer only.

### 8.3 SMS replies
- Each offer has a 4-digit reply code unique among that provider's open offers.
- `YES 4821` / `NO 4821` (case-insensitive; also accept "Y", "N", "ACCEPT", "DECLINE" with the code).
- A bare "YES" with no code: if the provider has exactly one open offer, reply "Reply YES 4821 to confirm the 9:00a Winter Park shift." Never auto-accept a bare "YES."
- Unknown or expired code: reply with the current status.
- `STOP`, `HELP`, and opt-out keywords handled per carrier rules.

### 8.4 Compliance and deliverability
- Register the business SMS number(s) for **A2P 10DLC** (US carrier requirement for business texting) before launch; use a Twilio Messaging Service. Budget registration lead time in Phase 2.
- Record explicit SMS consent at signup. Honor quiet hours in the provider's local time zone.

### 8.5 Quiet hours
- Provider sets quiet hours (default 9pm–6am local).
- During quiet hours: no offers, except `SAME_DAY`/`SHORT` offers if the provider opted into "urgent offers during quiet hours," or offers matching an active On Call rule (which confirm instantly anyway).

---

## 9. Clinic experience

- **Live dispatch tracker** on the shift page (and summarized via SMS/email for urgent shifts):
  - "Checking On Call providers…" → "Offer sent to 5 providers (wave 1) · 1 accepted · confirming in 2:40" → "Confirmed: Dr. Jane Smith, DC — arriving ~8:45am."
  - Clinics see counts and stages, not provider names, until confirmation (except applicants and accepted-pending providers they can pick directly).
- **Estimated time to fill** shown when posting urgent shifts, based on current On Call coverage and historical fill times in that area.
- "Find someone now" button on any open shift.
- Clear messaging for exhaustion, with the one-click rate boost.

---

## 10. Data model changes

```prisma
model Dispatch {
  id           String   @id @default(cuid())
  shiftId      String
  trigger      DispatchTrigger
  status       DispatchStatus @default(ACTIVE)
  tierAtStart  UrgencyTier
  currentWave  Int      @default(0)
  stage        DispatchStage @default(ON_CALL_CHECK)
  startedAt    DateTime @default(now())
  endedAt      DateTime?
  filledOfferId String?
  filledVia    SelectionMethod?
  waves        Wave[]
}
enum DispatchTrigger { URGENT_POST SELECTION_DEADLINE BACKFILL CLINIC_REQUEST ADMIN RATE_BOOST }
enum DispatchStatus  { ACTIVE FILLED EXHAUSTED CANCELLED }
enum DispatchStage   { STANDBY ON_CALL_CHECK WAVES BROADCAST DONE }
enum UrgencyTier     { SAME_DAY SHORT NEAR PLANNED }

model Wave {
  id          String   @id @default(cuid())
  dispatchId  String
  number      Int              // 1..n; broadcast flagged separately
  isBroadcast Boolean  @default(false)
  tier        UrgencyTier
  sentAt      DateTime
  windowEndsAt DateTime
  holdEndsAt  DateTime?        // broadcast only
  closedAt    DateTime?
  offers      Offer[]
  @@unique([dispatchId, number])
}

// Offer (CHANGED from SPEC.md)
model Offer {
  // existing fields +
  dispatchId     String?
  waveId         String?
  matchScore     Float
  dispatchScore  Float
  pRespondAtSend Float
  replyCode      String            // 4 digits
  linkTokenHash  String   @unique
  channelsSent   String[]          // ["SMS","PUSH","EMAIL"]
  deliveredAt    DateTime?
  openedAt       DateTime?
  revived        Boolean  @default(false)
  status         OfferStatus
}
enum OfferStatus { PENDING ACCEPTED_PENDING ACCEPTED DECLINED EXPIRED NOT_SELECTED WITHDRAWN INELIGIBLE }

// SelectionMethod (CHANGED): add ON_CALL_AUTO, DISPATCH_WAVE, DISPATCH_BROADCAST, STANDBY
// (CASCADE_ACCEPT and URGENT_PARALLEL are removed)

model OnCallRule {
  id                 String   @id @default(cuid())
  providerId         String
  active             Boolean  @default(true)
  professionCodes    String[]
  recurringWindows   Json      // [{ weekday, startMin, endMin }]
  dateWindows        Json      // [{ startsAt, endsAt }]
  timeZone           String
  maxDriveMinutes    Int
  minPayHalfDayCents Int?
  minPayFullDayCents Int?
  minPayHourlyCents  Int?
  minNoticeMinutes   Int      @default(90)
  maxPerDay          Int      @default(1)
  maxPerWeek         Int      @default(5)
  favoritesOnly      Boolean  @default(false)
  minClinicRating    Float?
  excludedClinicIds  String[]
  allowOvernight     Boolean  @default(false)
  pausedUntil        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model ProviderResponsiveness {
  providerId  String
  tier        UrgencyTier
  offers      Int
  hits        Int
  pRespond    Float
  medianResponseSeconds Int?
  updatedAt   DateTime @updatedAt
  @@id([providerId, tier])
}

model StandbyEntry {
  shiftId     String
  providerId  String
  matchScore  Float
  createdAt   DateTime @default(now())
  @@id([shiftId, providerId])
}

// Provider (CHANGED): + quietHoursStart, quietHoursEnd (minutes), quietHoursTimeZone,
//   urgentDuringQuietHours Boolean, snoozedUntil DateTime?, consecutiveIgnoredOffers Int,
//   graceCancels30d Int (derived), oncallPausedReason String?
```

`Assignment` gets `graceEndsAt DateTime?` (set for `ON_CALL_AUTO`).

---

## 11. Settings (all admin-editable; defaults shown)

| Key | Default |
|---|---|
| `dispatch.tiers.SAME_DAY` | `{ wave1: 5, growth: 3, max: 15, windowMin: 5, wavesBeforeBroadcast: 3, broadcastWindowMin: 15, broadcastHoldMin: 3, beta: 0.6 }` |
| `dispatch.tiers.SHORT` | `{ wave1: 3, growth: 2, max: 10, windowMin: 15, wavesBeforeBroadcast: 3, broadcastWindowMin: 30, broadcastHoldMin: 10, beta: 0.4 }` |
| `dispatch.tiers.NEAR` | `{ wave1: 3, growth: 2, max: 8, windowMin: 90, wavesBeforeBroadcast: 4, broadcastWindowMin: 240, broadcastHoldMin: 30, beta: 0.2 }` |
| `dispatch.tiers.PLANNED` | `{ wave1: 3, growth: 2, max: 8, windowMin: 120, wavesBeforeBroadcast: 4, broadcastWindowMin: 360, broadcastHoldMin: 60, beta: 0.2 }` |
| `dispatch.arrivalBufferMinutes` | 15 |
| `dispatch.minWindowMinutes` | 3 |
| `dispatch.maxOffersPerProviderPerDay` | 8 |
| `dispatch.maxConcurrentPendingOffers` | 3 |
| `dispatch.autoSnoozeAfterIgnored` | 5 |
| `dispatch.standbyCourtesyBoost` | 0.02 |
| `dispatch.standbyWindowMin` | `{ SAME_DAY: 5, other: 15 }` |
| `oncall.graceMinutes` | 10 |
| `oncall.maxGraceCancels30d` | 2 |
| `oncall.minReliability` | 0.85 |
| `oncall.minCompletedShifts` | 1 (OWNER DECISION) |
| `responsiveness.lookbackDays` | 90 |
| `responsiveness.prior` | `{ a: 2, b: 2 }` |

Settings can be overridden per profession (`dispatch.tiers.SAME_DAY.LMT`, etc.), falling back to the defaults.

---

## 12. Background jobs

All idempotent; every dispatch mutation takes a per-shift Postgres advisory lock.

| Job | When | Action |
|---|---|---|
| `dispatchStart` | trigger (Section 3) | Create Dispatch; standby (if backfill) → On Call check → wave 1 |
| `waveClose` | at `windowEndsAt` | Section 5.4 close logic; next wave or broadcast |
| `broadcastHoldEnd` | at `holdEndsAt` | Award best acceptor |
| `standbyWindowClose` | at standby window end | Award or continue to On Call/waves |
| `oncallGraceEnd` | at `graceEndsAt` | Lock in assignment (no-penalty cancel no longer allowed) |
| `offerDeliveryCheck` | 60s after send | If SMS undelivered, fall back to push/email; flag bad numbers |
| `responsivenessRecompute` | hourly + on offer resolution | Update `ProviderResponsiveness` |
| `snoozeResume` | at `snoozedUntil` | Resume offers |

---
## 13. Worked example (same-day sick call)

A clinic in Winter Park, FL posts a chiropractic shift at **7:02am** for **9:00am–5:00pm today** (tier `SAME_DAY`).

| Time | What happens |
|---|---|
| 7:02:00 | `getEligibleProviders`: 41 providers with a verified FL chiropractic license, valid malpractice, available, techniques met. Arrival feasibility removes 12 who live too far to arrive by 8:45. **29 candidates.** |
| 7:02:01 | On Call check: 2 providers have matching On Call rules. The higher match score (0.81) is confirmed instantly. **Filled in ~1 second.** Clinic gets "Confirmed: Dr. A, arriving ~8:40am." |

Alternate path (nobody On Call):

| Time | What happens |
|---|---|
| 7:02 | Wave 1 → top 5 by dispatch score. Match scores: B 0.84, C 0.79, D 0.77, E 0.70, F 0.66. Window closes 7:07. |
| 7:03 | D accepts. B and C are still pending (higher match), so D is told "You're next in line — you'll know by 7:07." |
| 7:04 | C declines. B still pending → D keeps waiting. |
| 7:05 | B accepts. No one ranked above B is pending → **B confirmed.** D and any other acceptors → standby. **Filled in 3 minutes with the best-matched provider who was available**, not whoever answered first. |
| — | If B had never answered: at 7:07 the wave closes and D (best acceptor) is confirmed. |
| — | If nobody in wave 1 accepted: wave 2 → next 8 providers at 7:07, wave 3 → next 11 at 7:12, broadcast to all remaining at 7:17 with a 3-minute hold after the first accept. |

Compare: a strict one-at-a-time 5-minute chain would have reached only B by 7:07. The agency approach would have given the shift to D at 7:03 simply for answering first.

---

## 14. Metrics (admin dashboard)

- **Time to fill** (median, p90) by tier, profession, and region.
- **Fill rate** by tier.
- **% filled via**: On Call, wave 1, later waves, broadcast, standby, clinic pick, applicant.
- **Match quality ratio**: filled provider's match score ÷ highest match score among eligible candidates at dispatch start. Target ≥ 0.9 for non-urgent, ≥ 0.8 for same-day.
- **Offers sent per fill** (lower = less spam).
- **On Call coverage**: number of providers On Call right now, per region and profession (drives recruiting).
- **Provider offer load**: offers per provider per week; % of providers auto-snoozed.
- **Grace cancellations** and late cancels after On Call confirmations.

---

## 15. Testing requirements (required in CI)

Use fake timers and a deterministic clock for all dispatch tests.

**Licensure and eligibility (extends SPEC.md 20.1 and Addendum 01 13.2)**
1. No provider without a verified license for the shift's profession and state ever receives an offer, is On Call auto-confirmed, joins standby, or is confirmed from a revived offer.
2. An On Call rule can't match a shift in a profession-state the provider isn't licensed for, even if the rule's drive radius covers it.
3. A provider whose license lapses between accepting (`ACCEPTED_PENDING`) and award is marked `INELIGIBLE` and skipped; the next acceptor is awarded.
4. Standby providers are re-checked for eligibility before backfill offers.

**Rank-protected logic**
5. Highest-ranked provider accepts first → confirmed immediately.
6. Lower-ranked accepts first, higher-ranked later accepts within window → higher-ranked wins.
7. Lower-ranked accepts, all higher-ranked decline → lower-ranked confirmed at the moment of the last decline (not at window close).
8. Lower-ranked accepts, higher-ranked never responds → lower-ranked confirmed at window close.
9. All decline before window close → next wave sent immediately.
10. Broadcast: first accept starts hold; a better-matched accept during the hold wins; award at hold end.

**Timing and ordering**
11. Wave sizes and windows follow Section 11 for each tier; tier escalates when time passes a boundary.
12. Window is shortened or far providers dropped when arrival feasibility requires.
13. `dispatchScore` ordering with β per tier; `pRespond` prior for new providers is 0.5.
14. Revived late acceptance joins the current wave with its original match score.
15. Active applications are treated as wave-1 acceptances.

**On Call**
16. Matching rule → instant confirm; failed confirm (race) → next On Call candidate.
17. Grace cancel → no reliability penalty; dispatch resumes; >2 grace cancels in 30 days → On Call auto-paused.
18. Daily/weekly On Call limits respected; min pay and min notice respected.

**Concurrency and safety**
19. 20 simultaneous accepts (mixed SMS/link/app) → exactly one assignment; all others `NOT_SELECTED` or `ACCEPTED_PENDING` → standby.
20. Clinic pick during an active wave wins cleanly; pending offers withdrawn.
21. SMS: bare "YES" never accepts; wrong or expired code gets a status reply; STOP opts out.
22. Offer caps and auto-snooze thresholds enforced; quiet hours respected except with urgent opt-in.

---

## 16. Phase placement

- **Phase 2 (Automation)** now means: Smart Dispatch + On Call + responsiveness + standby + SMS replies + clinic live tracker. Build order within Phase 2:
  1. Dispatch/Wave/Offer models, rank-protected engine, waveClose jobs (with tests 5–15, 19–20).
  2. Offer link page + SMS send/reply (A2P 10DLC registration started at the beginning of Phase 2).
  3. On Call rules, UI, and instant confirm (tests 16–18).
  4. Standby and backfill.
  5. Responsiveness scoring (starts with the prior; improves as data accumulates).
  6. Clinic live tracker and metrics dashboard.
- **Phase 1 stays simpler** (clinic/admin selection), but build the `Offer` model with the fields above from the start to avoid a later migration.
- Marketing note for launch: the headline feature is **"Covered in minutes, not hours"**, powered by On Call.

---

## 17. CLAUDE.md additions

```md
## Addendum 02 — Smart Dispatch & On Call (SPEC_ADDENDUM_02_DISPATCH_ONCALL.md)
Precedence: Addendum 02 > Addendum 01 > SPEC.md.
- Never award a shift to whoever answered first. Awards follow rank-protected logic: an acceptor is confirmed only when no higher-match-score offer in the wave is still pending (or at window/hold end, best acceptor wins).
- Match score decides who wins; dispatch score (match × responsiveness) decides who is asked first.
- Every candidate list starts with getEligibleProviders. On Call rules, standby, revived offers, and broadcasts can never add a provider it excludes.
- All confirmations go through the SPEC.md 7.8 transaction under a per-shift advisory lock.
- All dispatch numbers are Settings. Use fake timers in dispatch tests.
```

---

## 18. Open decisions for the owner

| # | Decision | Default in spec |
|---|---|---|
| B1 | Same-day accept window | 5 min |
| B2 | Minimum completed shifts before a provider can use On Call | 1 |
| B3 | On Call grace period for no-penalty cancel | 10 min |
| B4 | Standby courtesy boost | +0.02 for 7 days |
| B5 | Max offers per provider per day | 8 |
| B6 | Whether clinics see responsiveness or On Call status on providers (spec: On Call badge yes, responsiveness no) | as stated |
| B7 | On Call Terms in the Provider Agreement (auto-accept is binding) | ATTORNEY REVIEW |
