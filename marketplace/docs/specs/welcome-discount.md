# Coverage On Call: Automatic Welcome Discount, Clinic Acquisition, Email Marketing & Retention

Owner spec, received Oct 18 2026. **On hold** (see docs/ON-HOLD.md). Saved as given, lightly formatted.

Company: Coverage On Call · Website: https://coverageoncall.com
Promotion: 15% Welcome Discount on the first three eligible completed coverage bookings · Expiration: never · Promo code: not required

## 1. Primary development instruction
Upgrade the existing platform to implement a fully integrated, automatic 15% Welcome Discount on each eligible clinic's first three completed coverage bookings, communicated throughout the website, clinic prospecting, onboarding, booking checkout, email communications and the clinic dashboard.

- Work from the existing codebase; don't rebuild or replace working functionality.
- Reuse existing models, booking workflows, pricing, payments, connected provider accounts, dashboards, CRM tools and email services.
- Preserve all existing customer, provider, booking and payment records, provider compensation agreements and payout arrangements.
- Keep the existing design system and branding; use "Coverage On Call" and coverageoncall.com consistently.
- Do not introduce Therapy & Injury branding or references anywhere.

Objective: attract new chiropractic clinics, encourage three successful introductory bookings, and move those clinics to repeat bookings at standard rates.

## 2. Core rules
| Setting | Requirement |
|---|---|
| Promotion name | Welcome Discount |
| Discount | 15% |
| Eligible bookings | First 3 qualifying completed coverage bookings |
| Promo code | None |
| Expiration | Never |
| Eligibility | Verified clinic/business account |
| Funding | Platform-funded |
| Provider compensation | Unaffected |
| Stacking | Not permitted |
| Fourth booking | Standard pricing |

Permanent eligibility: no expiration of any kind; usable whenever coverage is needed, however much time passes; unused discounts stay attached to the clinic indefinitely; inactivity never removes them; campaign end dates don't affect them; not dependent on any email campaign; must survive updates and migrations; earned benefits are never revoked by later setting changes. Admins may change settings for future promotions only.

Example full day: standard $575.00, Welcome Discount (15%) −$86.25, clinic total **$488.75** (don't round to $488.00). The 15% applies to the eligible base coverage rate; travel, mileage, overtime, taxes and other ancillary charges are excluded. Same percentage for other durations and rate profiles, subject to the promotional margin safeguards. It's a percentage entitlement, not a promise that today's standard price stays the same.

## 3. Permanent account-level entitlement
Stored per clinic/business in the database (not derived from signup date, promo usage, campaigns or session data). Track: clinic id, promotion id, percentage, total eligible (3), completed, reserved, available, created at, booking ids, reservation and redemption history, admin overrides, audit history, status. **No expiration timestamp.**
Belongs to the clinic, shared by all its staff; new logins, email changes or added staff never reset it. Use the clinic/location hierarchy for a consistent multi-location policy; prevent duplicate claims by the same business while letting truly independent clinics qualify.
Integrity: transactional reservation + database constraints so concurrent bookings can't exceed 3; an auditable ledger, not only a counter; idempotent reservation/completion/cancellation/refund events; safe migrations.

## 4. Booking eligibility and lifecycle
Reserve one discount when a booking is confirmed; apply 15% to the eligible base rate; show it before payment; keep the confirmed price; mark redeemed on successful completion; release on qualifying cancellation or failed fulfillment; standard pricing after three redemptions.
- Cancelled: restore per the published cancellation policy. Rejected/unfulfilled: doesn't consume one.
- Rescheduled: keeps the reservation and confirmed price unless cancelled and replaced under disclosed terms.
- Partial refunds: consistent accounting, no duplicate entitlements. Full refund after completion: restore based on whether the service was delivered.
- Disputed payments: flag for review and reconcile. Concurrent bookings: never more than 3 reserved + redeemed. Previously confirmed bookings keep their price. Attempts don't count as redemptions.

## 5. Clinic dashboard: Welcome Benefits
Prominent, on-brand section, not overwhelming.
- New clinic: "WELCOME TO COVERAGE ON CALL · 15% OFF YOUR FIRST 3 COVERAGE BOOKINGS · Your introductory benefit is automatically applied at checkout. · 3 Welcome Bookings Remaining (Booking 1/2/3 — Available) · No Promo Code. No Expiration Date." Action: Book Chiropractic Coverage.
- After 1st: "2 Welcome Bookings Remaining — Your first coverage booking is complete! You still have two opportunities to save 15% on chiropractic coverage." Action: Book Your Next Coverage Day.
- After 2nd: "1 Welcome Booking Remaining — Your final Welcome Discount is available whenever your practice needs coverage. Your benefit never expires." Action: Use Your Welcome Discount.
- After 3rd: "Welcome Offer Completed — Thank you for choosing Coverage On Call for your first three coverage bookings. Continue scheduling dependable chiropractic coverage whenever your practice needs support." Action: Book Coverage.
Requirements: real available count; available vs reserved shown separately; savings to date where useful; standard and discounted prices; live updates; no misleading counts; existing branding and mobile layout; no popups; no time countdown (only 3 → 2 → 1 → 0).

## 6. Public website messaging
Primary: "15% OFF YOUR FIRST 3 CHIROPRACTIC COVERAGE BOOKINGS — Experience dependable chiropractic coverage while saving 15% on your first three eligible bookings. Your discount is applied automatically, and your welcome benefits never expire."
Short: "Save 15% on Your First 3 Coverage Bookings — No Code. No Expiration."
Placement: homepage clinic sections, clinic landing pages, chiropractic coverage pages, clinic registration and onboarding, booking CTAs, clinic dashboard, checkout, prospecting/campaign landing pages. **Not** in provider recruitment areas. CTAs: Claim Your Welcome Benefits · Book Your First Coverage Day · Save 15% on Your First 3 Bookings · Create Your Clinic Account. An eligible clinic account creates the permanent entitlement per the verified business rules; no code or special link needed.

## 7. Clinic prospecting emails
Use the existing outreach system (no new CRM). Lead with dependable coverage, continuity of care, convenient booking, credentialed providers, flexible scheduling; the discount is an extra reason to try.

**Initial** — Subject: "Chiropractic Coverage for Your Practice — Save 15% on Your First 3 Bookings"
> Hello [Clinic Contact Name],
> When your chiropractor needs time away, finding dependable coverage shouldn't disrupt your practice.
> Coverage On Call helps chiropractic offices arrange professional coverage so they can maintain patient appointments and continuity of care.
> New Clinic Welcome Benefit — Save 15% on your first three eligible chiropractic coverage bookings. Automatically applied at checkout · No promotional code required · No expiration date · Flexible booking when your practice needs coverage.
> For example, a standard $575 full-day booking is $488.75 with your Welcome Discount.
> Book Chiropractic Coverage: https://coverageoncall.com
> We look forward to supporting your practice whenever coverage is needed.
> Coverage On Call · Chiropractic Coverage Services · https://coverageoncall.com

**Follow-up** — Subject: "Your 15% Chiropractic Coverage Welcome Benefit Is Available"
> Hello [Clinic Contact Name],
> I wanted to follow up and introduce an option for chiropractic coverage when your practice needs additional support.
> With Coverage On Call, your clinic can request professional coverage while maintaining its existing patient-care workflow.
> Your clinic may also qualify for our 15% Welcome Discount on its first three eligible bookings. There is no promo code, and your welcome benefits do not expire.
> If you have upcoming vacation dates, schedule gaps, or temporary staffing needs, we'd welcome the opportunity to assist.
> View Coverage Options: https://coverageoncall.com
> Coverage On Call · Chiropractic Coverage Services · https://coverageoncall.com

Requirements: personalize; never claim confirmed provider availability; no guarantees of coverage or uninterrupted operations; no fabricated testimonials/savings/credentials; no repetitive outreach; honor unsubscribes and suppression; follow email law and consent; keep sending-domain authentication; keep marketing and transactional mail separate.

## 8. Regular clinic emails
Use the clinic's actual entitlement status.
- A. Welcome — "Welcome to Coverage On Call — Your 15% Discount Is Ready": benefit, "No Promo Code. No Expiration Date.", "[Available Count] Welcome Bookings Remaining", Book link.
- B. First booking confirmation — "Your Chiropractic Coverage Booking Is Confirmed": date, location, hours, provider if assigned; Standard rate, Welcome Discount (15%) −amount, Final total; "Welcome benefits remaining after this booking is completed: [Projected]"; "Your discount has been reserved for this booking and will be counted as used when the eligible service is completed."
- C. After 1st completed — "You Still Have 2 Welcome Coverage Discounts Available".
- D. After 2nd completed — "Your Final 15% Welcome Discount Is Ready".
- E. After 3rd completed — "Thank You for Your First 3 Coverage Bookings" (offer fully used; standard rates from now on).
- F. Reminder line in suitable regular emails while discounts remain: "Your Welcome Benefit: [Available Count] of 3 Discounts Remaining — Save 15%. No Expiration." (available vs reserved distinguished). Not in receipts, security notices, payment alerts, cancellation notices or other transactional mail.

## 9. Personalization and automation
Fields: clinic name, contact name, location, available/reserved/completed discounts, total savings, booking date, standard rate, discount, final total, booking link, dashboard link.
Triggers: registration/eligibility, first confirmed eligible booking, 1st/2nd/3rd completed promotional booking, cancellation/restoration, follow-up campaigns. No duplicates from retries, edits or repeated status events; respect marketing preferences; transactional vs promotional kept apart. Reuse branded templates (mobile, accessible, plain-text versions). No false urgency ("Offer Ends Tonight", "Last Chance").

## 10. Provider compensation protection
The discount never reduces the chiropractor's agreed pay; the platform funds it from its margin. Example: standard $575.00, discount −$86.25, clinic pays $488.75, chiropractor $400.00, platform gross spread $88.75 (before processing, acquisition, support, refunds, taxes). Keep provider pay independent of promotional pricing, never reduce it silently, keep connected-account routing accurate, don't treat gross spread as profit, keep marketplace economics separate from independent doctor-branded portal fees, apply only where the payment/contract structure supports it.

## 11. Promotional margin safeguards
Projected contribution = clinic payment − provider pay − platform-borne processing − other direct costs. Below the configured minimum: apply the margin policy, admin approval where appropriate; never reduce provider pay, never remove a confirmed discount without the clinic's agreement, never add undisclosed surcharges. Excluded booking types disclosed before confirmation. Earned unused benefits are never revoked because of margins, rates or settings.

## 12. Admin dashboard
Metrics: eligible clinics; clinics with 3/2/1/0 available; reserved; completed promotional bookings; discounts funded; average promotional booking value; provider pay; gross spread; processing costs; net contribution; total acquisition cost; revenue after eligibility ends.
Retention: 1st→2nd, 2nd→3rd, 3rd→4th conversion; 30/60/90-day repeat rates (analytics only, never eligibility); average days between bookings; lifetime revenue per clinic; promotional vs standard contribution.
Controls: enable/disable new enrollment (never invalidates existing), future percentage and count, clinic entitlements, reservation/redemption history, costs, documented exceptions, email templates, campaign performance. All overrides logged.

## 13. Marketing performance
Prospects contacted, delivered, opens where reliable, clicks, registrations, first-booking conversions, three-booking completion, discounts redeemed, standard-rate repeats, acquisition cost, revenue and contribution by source; campaign attribution. No automatic price changes from campaign results.

## 14. Payments and reconciliation
Keep the connected-account architecture. Per booking record: standard price, discount, clinic charge, provider pay, gross spread, processing cost, other direct costs, refunds/adjustments, net contribution. Reconcile across authorization, capture, transfers, payouts, refunds, disputes, reversals; no duplicate charges/transfers/refunds on retries; auditable.

## 15. Existing customers
Inspect existing clinics, completed bookings, current first-booking promo logic, prior code redemptions, confirmed prices, existing discounts/exceptions. Don't reset established clinics to three new discounts; recognize used introductory benefits; keep confirmed prices; no duplicate entitlements; explicit rules for existing clinics; admin review for uncertain records; retire any old Welcome code requirement without disabling unrelated promotions. Reversible migrations where feasible.

## 16. Acceptance tests
Eligibility (3 persistent discounts; bookings 1–3 at 15%; 4th standard; no code; no expiry; inactivity safe; shared by staff; no reset by duplicate accounts). Operations (reserve on confirm, consume on completion, restore on qualifying cancel, reschedule keeps price, concurrency capped, refunds/disputes reconcile, no double counting). Dashboard/website (visible, accurate, reserved shown, prices right, no countdown, mobile + desktop). Email/prospecting (initial + follow-up feature the offer, welcome + confirmations + post-booking accurate, no expiry claims, no duplicates, unsubscribes respected, existing workflows intact). Financial (provider pay unchanged, reconciles, margin safeguards, processing costs, no duplicate payouts/charges/refunds, portal fees unchanged).

## 17. Implementation
Inspect architecture → identify promotion/pricing/booking/CRM/email/payment/dashboard components → document current first-booking promo behavior and conflicts → design the entitlement + reservation model → smallest maintainable change set → test migrations, booking, payment, fulfillment, cancellation, completion, messaging, dashboards, reconciliation → deploy with rollback and monitoring. Don't claim completion without testing. Final report: files changed, migrations, entitlement + concurrency protections, checkout math, dashboard, website messaging, prospecting and transactional email changes, provider-pay safeguards, reconciliation, test results, open risks.

**Goal:** Discover → see the 15% benefit → register → book → save 15% automatically → complete three bookings → continue at standard pricing, built into coverageoncall.com, not a separate promotional app.
