# On hold until next week (owner, Oct 18 2026)

The owner paused everything below to build next week with Claude Cowork. Nothing here is live.
Last release delivered: **f5a40f5** (business number + Texts inbox, website-first email finding, email social icons).

## 1. Owner steps to finish (no code needed)

- [ ] Install **f5a40f5** on dev, then live (upload the 3 parts → Run JS script `update` → Stop App, wait, Start App).
- [ ] Google Cloud: turn on **Places API (New)** for the project of `GOOGLE_MAPS_API_KEY` and allow it in the key's API restrictions (website-first prospecting).
- [ ] Settings → Growth · AI, research & budgets: research provider **gemini**, model **gemini-2.5-flash** (`GEMINI_API_KEY` is already set).
- [ ] Settings → Growth: set "Google Maps website lookups per month" to match the free allowance in Google Cloud billing (default 1,000).
- [ ] AWS texting: follow `docs/aws-sms-setup.md`; `AWS_SMS_ORIGINATION` = `+18555526837` once the number can text from AWS.
- [ ] (855) 55-COVER is at **NumberBarn**: set call forwarding; later port it to AWS (Connect / End User Messaging) with a support case + letter of authorization. Confirm with AWS whether one toll-free number can carry both Connect voice and texting.
- [ ] After a few days, read the Prospecting page's "emails found on clinics' own websites (last 7 days)" to replace the 4–7× savings estimate with real numbers.

## 2. Features to build next week (Cowork)

### A. AI phone agent on Amazon Connect
Owner decisions: AI answers **24/7**; **never a live transfer**. Anything that needs staff (asks for a person, urgent, no approved answer) → the AI collects **name, best callback number and the reason** (like "Need help now?" on the website) and staff call back.
- Done (parked): `packages/core/src/callagent.ts` (`callTurn`, `forVoice`, `wantsPerson`, `isUrgentCall`, `isGoodbye`) + `packages/core/test/callagent.test.ts`.
- To build: migration 0064 `CallLog` (contactId unique, phone, userId?, outcome, urgent, callback request, transcript, readAt); signed webhook `/api/connect/turn` (HMAC, env `CONNECT_WEBHOOK_SECRET`) answering from the chat bubble's knowledge (retrieveKnowledge + ai, voice-length); callback requests → admin alert (support inbox email + in-app/push, never a text at night) and Admin → **Calls** page (badge = unhandled callbacks, Call back / Text back); AWS files in `deploy/aws/connect/`: CloudFormation (Connect instance, Lex V2 bot with TalkToPerson / LeaveMessage / Goodbye / Fallback → Lambda code hook → site webhook, inline Lambda, 24/7 flow, claimed DID) + checklist (NumberBarn forwarding → claimed number, flow on the number, later the port).
- Costs: Connect per-minute + daily number fee + Lex per request. Check AWS pricing before switching on.

### B. Remote staff support (escalations, chats, admin operations)
Recommendation: **build it inside the same Node app** as a staff area (e.g. `/staff`) with its own role (`SUPPORT_AGENT`, least privilege: support inbox, Texts, Calls, chat replies, read-only accounts, no payments/settings), required 2-step sign-in, an audit trail of every action, and optionally a `support.coverageoncall.com` hostname pointed at the same app that only serves `/staff`. Same database and services, so nothing is duplicated, and the extra pages don't slow the public site (pages load separately). A separate app makes sense later, when moving to AWS or at larger team size.

### C. Welcome Discount: 15% off the first 3 completed bookings, never expires
Full owner spec: `docs/specs/welcome-discount.md`. Notes for the build:
- Fits the existing pricing path (`pricing.quoteShift` discount fields, platform-margin-only like promos/partner; provider pay untouched).
- Needs a ledger table (entitlement + reservation/redemption rows, unique per booking) reserved at confirmation, redeemed at completion, released on qualifying cancellation; at most 3 reserved + redeemed.
- Decide with the owner: stacking with referral credit / promo / partner discount (spec says no stacking), which booking types qualify, existing clinics' eligibility, what the margin floor does.
- Make the explainer ad set (videos, posts, stills) when it ships (reminder in section 3).

### D. Prospecting emails visible before the send window
Owner: "queue always says zero even after fresh prospecting." Why: in auto mode the outreach agents write and send in one step, only from 08:15 to 17:00 Mon–Fri, so nothing sits in Queued (Queued is only for bulk-approved drafts). To build: a **"Ready to go out"** list on Growth → Activity & emails (prospects whose next step is due and who pass the compliance checks, i.e. what the next run will email), with the time it will go out.

### E. AI onboarding companion + ongoing-care AI (appointment requests)
Owner: when someone submits an appointment request online, an AI onboarding assistant (compassionate, reminders, "call or text me with questions") walks them to the first appointment; a separate ongoing-care AI after that; both with consistent first names.
Scope before building: which site (this marketplace has no patient appointments and stores no patient health information, so this belongs to a doctor/clinic site, not coverageoncall.com); patient-information rules (HIPAA) for texts/emails; the bots must say they're AI assistants (several states require bot disclosure); opt-in and STOP for texting.

## 3. Reminders
- Make the **clinic Welcome Discount explainer ad set**: videos, social posts and stills (code-built graphics per docs/brand/thumbnails.md; `warm` or `action` voiceover only).
