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
  - AWS Connect support answered (Oct 23 2026): a toll-free number ported into Amazon Connect gets voice (inbound + outbound) only, never texting; only numbers obtained in AWS End User Messaging SMS can carry texts and be imported into Connect; no portability check is needed for U.S. toll-free; the LOA template is shared once we decide to port (ideally 30 days before go-live). Still open (End User Messaging team, formerly Pinpoint): can (855) 552-6837 be ported INTO End User Messaging with SMS + voice, verified as toll-free, then imported into Connect? If yes, one number does both; if no, decide between voice on 55-COVER + a separate AWS texting number, or a new AWS number for both. Don't port until that's answered.
- [ ] After a few days, read the Prospecting page's "emails found on clinics' own websites (last 7 days)" to replace the 4–7× savings estimate with real numbers.

## 2. Features to build next week (Cowork)

### A. AI phone agent on Amazon Connect
Owner decisions: AI answers **24/7**; **never a live transfer**. Anything that needs staff (asks for a person, urgent, no approved answer) → the AI collects **name, best callback number and the reason** (like "Need help now?" on the website) and staff call back.
- **BUILT Oct 23 2026 (call menu, no AI): press 1 = continue by text, press 2 = callback.** `services/callline.ts`, signed `/api/connect/menu`, CallLog (0065), Admin → Calls, Lambda `deploy/aws/connect/menu-lambda.mjs`, setup `docs/aws-connect-setup.md`. The AI agent below reuses CallLog and the same secret. Original design:
- **"Continue by text" (owner, Oct 23 2026).** Near the start of every call: "If you'd rather continue by text, press 1." Then: "Should we text the number you're calling from, ending in 1234? Press 1 for yes, or 2 to enter a different number." Option 2: key in (or say) 10 digits, read back, confirm with 1. No caller ID, or a landline/blocked number → ask for a mobile number; nothing valid after two tries → stay on the call. Confirmed → the call ends with "We've just sent you a text from (855) xxx-xxxx", and the site texts from the AWS texting number: "Hi, it's Coverage On Call. You asked to continue by text after calling us. How can we help? Reply STOP to opt out." The conversation is in Admin → Texts (same thread, marked "from a call", with the call's time and number). Pressing 1 counts as the caller's request for that one conversation (recorded on the call log: time, number, choice); it's not marketing consent, and nothing else gets texted to them unless they opt in elsewhere. A number that texted STOP is never texted: the call says "That number has opted out of texts" and carries on as a call. Build: Connect flow DTMF branches + a signed `/api/connect/text-handoff` webhook (same HMAC as `/api/connect/turn`) → textinbox `startFromCall` (E.164 check, suppression, rate limit per number, CallLog link) → sendText from `AWS_SMS_ORIGINATION`. Works before the AI agent too: the plain flow can offer it while calls still go to a cell.
- Done (parked): `packages/core/src/callagent.ts` (`callTurn`, `forVoice`, `wantsPerson`, `isUrgentCall`, `isGoodbye`) + `packages/core/test/callagent.test.ts`.
- To build: migration 0065 `CallLog` (contactId unique, phone, userId?, outcome, urgent, callback request, transcript, readAt); signed webhook `/api/connect/turn` (HMAC, env `CONNECT_WEBHOOK_SECRET`) answering from the chat bubble's knowledge (retrieveKnowledge + ai, voice-length); callback requests → admin alert (support inbox email + in-app/push, never a text at night) and Admin → **Calls** page (badge = unhandled callbacks, Call back / Text back); AWS files in `deploy/aws/connect/`: CloudFormation (Connect instance, Lex V2 bot with TalkToPerson / LeaveMessage / Goodbye / Fallback → Lambda code hook → site webhook, inline Lambda, 24/7 flow, claimed DID) + checklist (NumberBarn forwarding → claimed number, flow on the number, later the port).
- Costs: Connect per-minute + daily number fee + Lex per request. Check AWS pricing before switching on.

### B. Remote staff support (escalations, chats, admin operations)
Recommendation: **build it inside the same Node app** as a staff area (e.g. `/staff`) with its own role (`SUPPORT_AGENT`, least privilege: support inbox, Texts, Calls, chat replies, read-only accounts, no payments/settings), required 2-step sign-in, an audit trail of every action, and optionally a `support.coverageoncall.com` hostname pointed at the same app that only serves `/staff`. Same database and services, so nothing is duplicated, and the extra pages don't slow the public site (pages load separately). A separate app makes sense later, when moving to AWS or at larger team size.

### C. Welcome Discount: BUILT (Oct 18 2026, update-061)
Shipped per `docs/specs/welcome-discount.md` (see CLAUDE.md). Two prospecting email versions that mention it are waiting as drafts on Growth → Prompts (CLINIC_FIRST_CONTACT and CLINIC_VACATION_EDUCATION, "Welcome Discount version"): approve, then activate, to use them. The explainer ad set is made (section 3).

### D. Prospecting emails visible before the send window: BUILT (Oct 18 2026)
Growth → Activity & emails → **Ready to go out**: prospects whose next email is due, in the order the agents take them, with when they go out and whether today's limit reaches them.

### E. AI onboarding companion + ongoing-care AI (appointment requests)
Owner: when someone submits an appointment request online, an AI onboarding assistant (compassionate, reminders, "call or text me with questions") walks them to the first appointment; a separate ongoing-care AI after that; both with consistent first names.
Scope before building: which site (this marketplace has no patient appointments and stores no patient health information, so this belongs to a doctor/clinic site, not coverageoncall.com); patient-information rules (HIPAA) for texts/emails; the bots must say they're AI assistants (several states require bot disclosure); opt-in and STOP for texting.

## 3. Reminders
- DONE (Oct 18 2026): clinic Welcome Discount explainer ad set made (marketing/ads/welcome.cjs: carousel, stories, square post, 32 s reel with the `warm` voice). Not posted: waiting for the owner's approval.
