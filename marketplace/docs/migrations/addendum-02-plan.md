# Addendum 02 (Smart Dispatch & On Call) — audit and plan

Status: owner said to build it in without a separate approval step (2026-09-29).

## Audit — what exists that this touches
| Area | Current state | Change |
|---|---|---|
| `Offer` model | PENDING/ACCEPTED/DECLINED/EXPIRED/WITHDRAWN; source CLINIC_PICK/CASCADE/URGENT_PARALLEL/ADMIN | Add dispatch/wave ids, matchScore, dispatchScore, pRespondAtSend, replyCode, linkTokenHash, channelsSent, deliveredAt, openedAt, revived; statuses + ACCEPTED_PENDING, NOT_SELECTED, INELIGIBLE; source → CLINIC_PICK/DISPATCH/BROADCAST/STANDBY/ADMIN |
| `SelectionMethod` | includes CASCADE_ACCEPT | Remove CASCADE_ACCEPT; add ON_CALL_AUTO, DISPATCH_WAVE, DISPATCH_BROADCAST, STANDBY |
| Cascade (SPEC 7.7 step 4) | Not built (Phase 2 was pending) | Replaced by Smart Dispatch — nothing to remove |
| Clinic invitations (`inviteProviders`) | Direct offers, first accept wins | Kept as the clinic "direct offer" override (Addendum 02 §5.8): wins if accepted before the dispatch fills |
| Confirmation transaction | `confirmInTx` with `SELECT … FOR UPDATE` | Also takes a per-shift `pg_advisory_xact_lock`; used by every dispatch award |
| Backfill (`cancelAssignment`) | Reopens shift + notifies top candidates | Starts a BACKFILL dispatch (standby first) |
| Provider model | no quiet hours / snooze | + quietHoursStart/End, urgentDuringQuietHours, snoozedUntil, consecutiveIgnoredOffers, oncallPausedReason, smsConsentAt |
| Assignment | — | + graceEndsAt |

Nothing is deployed, so the schema is regenerated in place (0001_init) as with Addendum 01.

## New code
- `packages/config`: all §11 settings (per-tier objects + per-profession overrides).
- `packages/core/src/dispatch.ts` (pure): urgency tier, wave sizing, window capping by arrival feasibility, dispatch score, pRespond (Beta prior, blending, recency), rank-protected award decision, broadcast hold award, On Call rule matching, SMS reply parsing. Unit-tested with a fixed clock.
- `packages/services/src/dispatch.ts`: start/advance/close dispatch, waves, accept/decline via link/SMS/app, revived offers, applications-as-acceptances, standby, On Call check + grace, fatigue caps & auto-snooze, quiet hours, responsiveness recompute. Every mutation under a per-shift advisory lock; every candidate list starts with `getEligibleProviders`.
- Web: offer link page `/o/[token]`, Twilio inbound SMS webhook, provider On Call rules editor + "Go On Call" toggle + snooze/quiet hours + own responsiveness stats, clinic live dispatch tracker + "Find someone now" + "Instant confirm available" badges, admin dispatch metrics.
- Worker: waveClose, broadcastHoldEnd, standbyWindowClose, oncallGraceEnd, offerDeliveryCheck (fallback), responsivenessRecompute, snoozeResume — implemented as idempotent due-item sweeps run every 15–30 s (BullMQ repeatable jobs), so timers survive restarts.

## Tests (Addendum 02 §15)
DB-backed suite with an injectable clock covering cases 1–22.

## Open decisions (defaults used; all are Settings)
B1 5 min · B2 1 shift · B3 10 min · B4 +0.02/7 days · B5 8/day · B6 On Call badge shown to clinics, responsiveness hidden · B7 On Call Terms behind `features.onCallEnabled` pending attorney review.
