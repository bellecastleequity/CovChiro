# InjuryCase

**Personal injury case management for chiropractors**, sold as a monthly
membership. Each subscribing practice manages its own patient load in its own
isolated workspace. It grew out of the "Injury Tracking Sheet" and
"PI A/R – PIP" spreadsheets and tracks each case from intake through settlement.

To rename the product, change `BRAND_NAME` in
`app/saas.php` plus the text in `public/index.html` and `public/legal.html`.
Check trademark and domain availability before launch.

## Product structure
| URL | What |
|---|---|
| `/` (`public/index.html`) | Marketing site: features, security, pricing (rendered live from `app/saas.php`), FAQ |
| `/app.html#signup` | Self-service signup: practice name, owner, password, plan, Terms + BAA acceptance, then 2FA |
| `/app.html` | The application |
| `/legal.html` | Terms, Privacy, BAA (**drafts for attorney review**) |

## Membership model
- **Tenancy.** Every practice is a row in `practices`. All practice data carries
  `practice_id`, and every query is scoped to the signed-in user's practice.
  An id belonging to another practice simply returns "not found".
- **Plans** (`PLANS` in `app/saas.php`): Silver $39 (75 open cases, 3 users),
  Gold $59 (300 open, 10 users), Platinum $79 (unlimited). Internal plan keys
  stay `solo` / `practice` / `group` (stored on practices and in Stripe). Limits count
  *open* cases only. Closed cases are free.
- **Features by plan.** Plans are ordered tiers. Each tiered feature names
  the lowest plan that includes it in `FEATURES` (`app/saas.php`); higher
  plans include it too, and unlisted features are in every plan. Today:
  **Daily huddle** on Gold and up, **daily email digest** and **multiple locations** on Platinum.
  Free trials and complimentary accounts are the top tier (Platinum) —
  every feature and Platinum's limits (`effective_plan()`) — and the trial
  banner names what the chosen plan won't keep. Subscribing to a lower plan
  applies that plan's features and limits as soon as Stripe confirms. Enforcement is server-side
  (`require_feature()` / `has_feature()`, including the email job). The
  pricing page, plan cards, upgrade prompts and nav locks all read the same
  list. To tier a future feature: add it to `FEATURES` and call
  `require_feature('key')` in its endpoints (and check `hasFeature('key')`
  in the UI).
- **Changing plans.** Subscribed practices switch plan or billing period on
  Plan & billing (`billing.php?action=change_plan`), with an estimate of the
  prorated difference on each button. Upgrades are invoiced for the
  difference immediately with `payment_behavior=pending_if_incomplete`, so
  Stripe applies the new price only once the payment succeeds; the practice
  is updated in the same request (or by the webhook when a declined payment
  is completed later via the invoice link). Downgrades apply at once and the
  unused amount is credited to the next bill. During kept free-trial days
  nothing is charged.
- **Monthly or annual.** Annual is 10× the monthly price, i.e. 2 months
  free: $390 / $590 / $790 a year.
- **Trial.** 14 days, no card required. Subscribing during the trial keeps
  the remaining free days: the card is first charged when the trial would
  have ended. Admins get reminder emails 3 days and 1 day before the end and
  the day after (account details only). When the trial ends or a subscription
  is canceled, the practice goes **read-only**: it can still view and export
  everything (they're its medical records, and the BAA requires returning
  them) but can't change anything until it subscribes.
- **Billing.** Uses Stripe Checkout and the Stripe Customer Portal. A webhook
  keeps plan and status in sync. Stripe only sees the practice name and owner
  email, never PHI.
- **Operator console.** Platform operators (you) see practices, plans, status,
  usage counts and MRR. They can extend trials, comp accounts or change plans.
  Operator accounts are **technically blocked from every patient record**
  (minimum necessary).
- **Roles inside a practice:** admin, provider, staff, billing.

## Features

| Area | What it does |
|---|---|
| **Dashboard** | Open cases, actively treating, visits this week, total A/R, A/R in demand/litigation, the case pipeline by stage, a prioritized "needs attention" list, and your tasks. |
| **Cases** | Searchable/sortable list with stage, benefits, DOI, first/last visit, attorney, last contact, balance, checklist progress and alert count. |
| **Checklist** | The tracking sheet's protocol with real deadlines: 48-hour intake items (called atty, LOR, AOB, prior records/imaging, ADL), MRI within 10 days, EMC referral within 21, consults within 45, and discharge items (final ADL, treatment-complete letter, final narrative, records request). Imaging and consult items complete themselves from the Co-management tab. |
| **Co-management** | Outgoing and incoming referrals (MRI, X-ray, CT, EMC determination, ortho, neuro, pain management, surgical, PT): ordered → scheduled → completed → report received → entered in chart, plus no-shows and findings. |
| **Visits** | Dates of service, type (initial, treatment, re-exam, discharge, no-show), CPT codes, notes, and an optional charge posted to the ledger. The first visit moves an intake case to Treating. A discharge visit moves it to Treatment complete. |
| **Outcomes** | Bournemouth (neck/back), Oswestry, NDI, HDI, shoulder, knee, ADL, with first-vs-latest change. |
| **Correspondence** | Every fax/email/call with attorneys, adjusters and providers, with follow-up dates. Includes printable letters: case status request, treatment complete, and reduction response. |
| **Case types** | Auto accident, slip & fall, workers' comp. Each has its own checklist and alerts. |
| **Insurance & money flow** | Each case lists its insurance in billing order (PIP, MedPay, health insurance, workers' comp), each with a claim #, adjuster, limits/authorizations and a status (active, denied, exhausted or closed). Charges are billed to a coverage or the patient balance. Whatever insurance doesn't cover (the 20% PIP doesn't pay, denials, everything after exhaustion) is moved to the **patient balance** by a person. The app prompts but never moves money on its own. Moves work in both directions, so a late payment can be applied to the original date of service. Every ledger entry stays editable, and edits are audited. |
| **EHR ledger upload** | The practice's EHR is the source of truth for money, and it can be **any EHR**. Upload one patient's ledger to their case in one of three ways. **Spreadsheet (CSV or Excel)**: every EHR can export one. The first time a layout is seen, someone matches its columns, with recognised names filled in. Both "one row per charge" ledgers (billed / paid / balance columns) and "one row per transaction" histories (a type column with an amount, or separate Charges / Payments / Adjustments columns) work. The layout is saved and recognised automatically next time. **PDF**: read directly for DrChrono billing ledgers. **Totals**: typed in when nothing else is available. Every route ends at the same preview, which checks name, DOB, accident date and claim # against the case and shows what changes. A file with more than one patient is refused. Applying mirrors the EHR (CPT, billed, insurance paid, patient paid, adjustments, the patient/insurance split and the dates), adds missing visits with CPT and ICD-10 codes, and keeps nothing unless the mirror matches to the cent. Spreadsheets need a person to confirm the totals match the EHR. Re-uploading replaces the previous EHR lines, so it's always safe. On synced cases, money lines are read-only in the app, while LOP and settlement tracking stay here. Needs `pdftotext` (poppler-utils) and PHP's XML extension on the server. |
| **Financial visibility** | Balances, ledger detail and settlement figures are three separate permissions. Admin, provider and billing see all three. Staff see only what the admin opens to staff under Practice settings, or everything if granted per person. Hidden values are stripped on the server. |
| **LOP & settlement** | LOP signed by the patient (and whether the law firm acknowledged it). At settlement, "Forward balance to attorney" records the date and amount and prints an itemized statement by date of service. Reductions apply to the patient balance only, against the 80% floor. |
| **A/R & settlements** | The A/R sheet as a live report with totals and CSV export. |
| **Documents** | LORs, records, imaging/EMC/consult reports and narratives, encrypted on disk. |
| **Contacts** | Attorneys, insurers, imaging centers, co-managing providers. |
| **Care guide & PI playbook** | Written for clinics new to PI. Each case's Overview opens with **Next steps**: MRI script at visit #1; EMC determination in week 1 (auto cases; in house or referred out); orthopedic referral once the MRI is completed; pain management considered at 12–16 weeks of conservative care without full resolution; neurology any time after the first visit when there was a head injury (asked on every case; ICD-10 head-injury codes from EHR uploads prompt it too); a re-exam every 30 days (outcome assessments repeated with it); at MMI, discharge or a maintenance plan at the frequency the doctor sets (e.g. monthly), with maintenance visits prompted until a final discharge. X-rays are left to clinical judgment and narrative reports are prepared only on request. Each step says when and why and tracks its referrals from ordered to report received. Actions: add the referral, add another (second MRI, another ortho opinion), "remind me later", or "not needed" with a reason. Steps that are due appear as alerts on the dashboard. The **PI playbook** page explains every timeline the app follows. Timings live in `CARE_GUIDE` in `app/pi_rules.php`. |
| **Policy limits & case value** | Record the at-fault driver's bodily-injury limit, the patient's UM limit, an estimate of other providers' bills, and where the figures came from. Usually learned on the attorney call; the checklist reminds staff to ask. Front desk and billing can both record them. The PIP coverage takes the carrier's "remaining" figure, net of payments received since. The Financials tab shows PIP remaining, medical bills (ours + other providers) as a share of the limits with ⅓ / ½ / ¾ markers, and when the next marker is reached at the recent pace of charges. Soft warnings at a third (reductions become likely once fees and the patient's share come out), half, three quarters and over the limits, plus a PIP-nearly-exhausted warning. Suggestions prompt asking for limits and, when limits are low, checking for UM, health insurance or MedPay. Money-based warnings follow the financial-visibility rules. Thresholds are in `app/pi_rules.php`. |
| **Case suggestions** | Coaching built from each case's own data, beyond the required timeline. All of it is "if clinically indicated". **Consistent care**: unexplained gaps over 14 days, falling visit frequency, repeated no-shows, a late start after the injury. **Specialist care**: positive MRI findings without a specialist referral; EMG/NCV for radiculopathy codes or nerve findings; injured regions coded but never imaged; shoulder/knee injuries not evaluated; following through on a consult's injection or surgical recommendation; lingering concussion symptoms. **Evaluation & documentation**: a permanency opinion at MMI (Florida's auto tort threshold), attorney on file, outcome scores over time. Each suggestion can start a referral (pre-filled type and region) or a task, or be marked not applicable with a reason. The dashboard rolls them up across the practice, and the PI playbook explains the principles. |
| **Daily huddle** (Gold plan and up) | A morning team-meeting sheet of everything outstanding, in sections: tasks overdue or due today (with who they're assigned to); treatment plan & care (gaps in care, behind the treatment-plan frequency, re-exams, maintenance); referrals & evaluations (MRI not ordered after visit #1, EMC overdue, ortho/neuro/pain referrals due, reports to chase); insurance & case value; attorney & settlement; and overdue checklist items, one row per patient. Each row has space for who takes it and a done box, and the sheet prints cleanly. Money items follow the financial-visibility rules. |
| **Treatment plan & adherence** | Each case can record the planned frequency (e.g. 3x/week) and since when. Attendance over the last 14 days is compared with it, and falling below the practice's threshold (default 70%) raises an alert and a huddle item. Cases without a plan get a suggestion to set one. |
| **Daily email digest** (Platinum plan) | Practice settings choose the criteria (gaps in care, plan adherence, MRI not ordered, EMC overdue, referrals due, re-exams, maintenance, tasks, PIP/limits) and thresholds (gap days, adherence %, weekdays only). Each person turns the email on and picks criteria under "Email notifications"; admins are on by default and can switch it for others. Sent each morning (`app/cli/daily_digest.php`, cron 6:38am Eastern), only on days with something to report. The email has **counts and a link only — no patient names, case numbers or clinical details**. Needs the same SMTP setup as trial reminders. |
| **Patient outreach** | When a patient misses care, staff log each attempt (call/text/email/letter, neutral outcome, optional factual note). After 3 attempts without a return visit, the app prompts an attendance letter to the attorney/paralegal: "Scheduling assistance requested", factual, with no characterisation of the patient. Once the attorney is notified, gap, plan, re-exam and maintenance prompts pause until the patient attends again. The pause clears automatically, or staff can resume calls. Cases record the paralegal for letters. |
| **Patient file export** | A printable "Patient care summary" for records requests: visits (dates, type, provider, location, ICD-10), referrals and reports, findings, outcome scores. Missed appointments, correspondence (non-billing) and the scheduling contact log are optional. Charges, payments, balances, insurance, policy limits, internal notes, tasks, alerts, suggestions and checklists are never included. Exports are audited, can be logged as records sent, and complete the records-request checklist item. The PI playbook has a "write for every reader" wording guide. |
| **Feature suggestions** | "Suggest a feature" in the sidebar (new feature, change or problem). The practice sees its suggestions with status and replies; operators review and reply in the console. |
| **Outside provider estimates** (Gold plan and up) | Practice settings → "Outside provider costs": expected charges at other facilities (defaults: MRI $1,500 per area, X-ray $250, CT $1,200, EMG $1,200, EMC evaluation $350, ortho / neuro / pain-management visits $450, injection $2,500, surgical consult $650, PT visit $150, ER $3,500, ambulance $1,200, surgery $45,000) and the typical count per referral. Each case's referrals add estimated lines automatically (an MRI counts once per body region on the referral; cancelled referrals don't count). Staff adjust a line's count or cost, set it to 0 to leave it out, or add lines (injections, ER, surgery, anything custom) under Financials → "Adjust estimates". The total, plus any lump sum not itemized, feeds the bills-vs-policy-limits meter, its warnings and dollar lawsuit thresholds. Planning figures only. |
| **Case status dates** | Mediation date, trial date, settlement signed and the date the attorney expects to mail / disburse the check — on the case (Overview → Edit, or Financials → LOP & settlement; front desk or billing). Prompts: mediation within 14 days and trial within 21 days (confirm the attorney has current bills and records), ask for the outcome once a date passes, move the stage once the settlement is signed, ask when the check will be mailed, a heads-up the week it's due, and an urgent alert if the expected date passes without the check. The A/R report shows the next date per case and the CSV includes all four. |
| **Custom case steps** (Platinum plan) | Practice settings → "Case steps & checklist": add the office's own steps (due from first visit, accident or MMI/discharge, by case type). They show on every matching case's checklist with alerts and huddle items. After a downgrade, saved steps are kept but hidden. Silencing built-in Next steps or checklist items practice-wide works on every plan. |
| **Locations & providers** (multiple locations: Platinum plan) | Practices define locations. Each case and visit belongs to one, and letters and exports use that location's letterhead. A sidebar location switcher filters the case list, dashboard, huddle and A/R, and the case list and huddle filter by provider ("My cases" for providers). Team members can have a home location and can be **limited to their location's patients**. That limit is enforced on every case, child record, task, dashboard, huddle and email query, and stays enforced after a downgrade. |
| **Tasks** | Assign a task to one or more team members (or leave it for anyone), with a due date, priority and notes. Make one straight from any alert with "+ Task". Filter by person, "assigned to me", "created by me" or completed. The sidebar shows how many open tasks are assigned to you. Anyone can complete a task, and who completed it is recorded. |
| **Activity & audit log** | Every case has an **Activity** tab for the whole team: who added, changed or removed what, with before → after values ("Stage: Treating → Settled", "Assigned to: Dana", "Patient balance: $0.00 → $33.00"). Free-text notes and encrypted fields are named but their contents are never logged. Amounts follow the financial-visibility rules. The practice **Audit log** (admins) adds views, downloads, exports, sign-ins and failed sign-ins, filters by team member, kind of activity, case and date, and downloads as CSV for a compliance review. |
| **Users** | Role-based accounts: admin, provider, staff, billing. |
| **Certified website badge** | Practice settings → "InjuryCase Certified badge": admins switch it on and copy embed code (light, dark or round seal) for their website, or download PNG/SVG for print. The embed loads from `api/badge.php` and links to `verify.html`, which checks live. It shows as certified only while the practice has an active paid subscription (or is comped) and a current BAA; otherwise it reads "Not verified". "New links" retires old embeds. Only the practice name and state are public. Artwork is in `app/badge.php`; the files in `public/assets/badges/` are generated from it. Terms are in legal.html#badge. |

### State rules (`app/jurisdictions.php`)
Each case follows the state whose law applies (`cases.jurisdiction`, defaulting to the case location's state, then the practice's). The clinical workflow is the same everywhere; what changes per state is data in `JURISDICTIONS`: PIP/no-fault medical limit and whether it's required, the Florida EMC cap, first-visit deadline, claim-notice and bill-submission deadlines, fee basis and interest, whether billing the patient above the fee schedule is barred, the lawsuit threshold (dollar thresholds are tracked on Financials), tort options in choice states, the pre-suit demand letter, treatment-plan limits, insurer review, provider lien steps and statute of limitations. Later changes are effective-dated `versions` keyed to the accident, policy or service date (e.g. Kentucky's 2026 HB 627 by policy date).

- **Support levels:** Florida is *full*. KS, UT, MN, ND, DE, MD, OR, WA, TX, AR, DC, GA, AZ, CO, LA, MT, OK, IL, NC, VA, MA, KY, PA and HI are *supported*. NY, NJ and MI are *limited*: their fee caps and reviews sit outside the balance/LOP model. Any other state uses general at-fault rules.
- **Not verified:** every state except Florida is marked unverified. The figures come from `reports/PIP rules by state.md`, built from search extracts and secondary sources. Have a licensed attorney in each state confirm them. This is not legal advice.
- **Playbook:** the PI playbook shows any state's rules (state picker), and each case has a "*State* rules" card.

### Florida PIP rules built into the alerts
- Initial care within **14 days** of the accident (§627.736(1)(a)), flagged for new intakes and late first visits.
- No **EMC determination** means PIP medical benefits are capped at **$2,500**. Only a finding by an MD, DO, dentist, PA or APRN counts; one recorded from a chiropractor raises an alert and keeps the cap.
- Bills must reach the PIP insurer within **35 days** of service: unbilled visits are flagged 10 days before the deadline (for cases whose insurance charges are kept in the app).
- **Pre-suit demand letter** (§627.736(10)): unpaid PIP bills prompt it; Letters → "PIP pre-suit demand" prints the itemized letter to the insurer. Recording the date sent on the PIP coverage starts the 30-day cure clock, and the app flags when it ends.
- **Letter-of-protection disclosures** (§768.0427, 2023): factoring sale and price, and the patient's health coverage, recorded under LOP & settlement.
- Charges approaching the PIP limit.
- Workers' comp: authorized visits used or nearly used, authorization expired, the 24-treatment / 12-week chiropractic limit (§440.13(2)(a); confirm against the current statute), and DWC-25 status forms not sent.
- Money: insurance charges unpaid after 45 days, PIP ended with no signed LOP, and a settled case whose balance hasn't been forwarded.
- Plus: imaging/consult reports not received, referrals not scheduled, no-shows, gaps in care over 14 days, outcome tools due every 30 days, no attorney status update in 30 days on demand/litigation cases, follow-ups due, and settlement checks not received 30 days after authorization.

Office thresholds are constants at the top of `app/pi_rules.php`; state rules are in `app/jurisdictions.php`.

---

## HIPAA: what the code does vs. what you must do

Running this as a service makes you a **Business Associate** of every
subscribing practice. You must:
- sign a BAA with each practice (captured at signup and versioned by `BAA_VERSION`),
- have a BAA with your own host (your subcontractor), and
- meet the Security Rule yourself: risk assessment, policies, breach-notification
  procedure, workforce training, and a designated security officer.

The sections below apply to both you and each practice.

The software implements the HIPAA Security Rule's **technical** safeguards.
HIPAA compliance as a whole also requires administrative and physical
safeguards and signed agreements that no code can provide.

### Built into the portal
| Safeguard (45 CFR §164.312) | Implementation |
|---|---|
| Unique user IDs | Individual accounts. Roles: admin, provider, staff, billing. |
| Authentication | Argon2id passwords (12+ characters), **mandatory TOTP two-factor** for every user, account lockout after 5 failures, per-IP throttle, and forced password change on first login. |
| Automatic logoff | 15-minute idle timeout enforced server-side, with a 12-hour absolute limit. The screen is wiped on timeout. |
| Audit controls | `audit_log` records every case view, edit (with before → after values for structured fields), export, letter, document upload/download, EHR upload, task change, login, failed login and denied access, with user, time and IP. Free text and encrypted fields are recorded by name only. Admins review and filter it in the UI and can download it as CSV. That export is itself logged. |
| Integrity | Encryption is authenticated (tampering is detected). Documents carry a SHA-256 checksum. Records are archived, never hard-deleted. |
| Encryption at rest | DOB, phone, email, address, claim/policy numbers and all clinical and correspondence notes are encrypted per field with libsodium. Uploaded files are encrypted and stored outside the web root. |
| Transmission security | HTTPS forced, HSTS, `SameSite=Strict` `__Host-` session cookies, CSRF tokens. |
| Minimum necessary | Role permissions (for example, staff can't post payments; billing can't edit clinical records). |
| Web hardening | Strict CSP (no inline script, no third-party requests: no CDNs, fonts or analytics), no caching of any response, and errors never reveal details to the browser. |

### Your responsibilities (the real obstacles)
0. **Get the legal documents reviewed.** Have a healthcare attorney finalize `legal.html`.
1. **Hosting with a signed BAA. Deploy on AWS** with `deploy/aws/`: a
   CloudFormation stack plus setup script. See **[deploy/aws/README.md](deploy/aws/README.md)**.
   Accept the AWS Business Associate Addendum in AWS Artifact first. The stack
   encrypts the database, disk and backups, which protects patient *names*
   (left unencrypted in the app so they can be searched).
2. **BAAs with every vendor that touches PHI**: the host, backup provider,
   and any email/fax service. The portal sends no email. Letters are printed
   or saved as PDF. If you later add e-fax or email, that vendor needs a BAA too.
3. **A written risk assessment** (§164.308(a)(1)), plus policies for access,
   breach notification, device security and sanctions, and annual workforce training.
4. **Backups and disaster recovery.** Take nightly encrypted database backups,
   back up `storage/documents/`, and test a restore. **Keep an offline copy of
   `PI_ENCRYPTION_KEY`.** Without it, encrypted data cannot be recovered.
5. **Review the audit log** regularly, and remove users the day they leave.
6. **Retention.** Florida requires chiropractic records to be kept at least
   5 years after the last contact, and HIPAA documentation 6 years. Nothing is
   hard-deleted, so purging is a deliberate admin task.
7. **Device security.** Use screen locks and full-disk encryption on office
   computers, and never share logins.

---

## Install

Requirements: PHP 8.1+ with `pdo_mysql`, `sodium`, `fileinfo` and `curl`; MySQL 8 or MariaDB 10.6+; Apache with `mod_rewrite`/`mod_headers` (or the nginx equivalent); and HTTPS.

```
pi_portal/
├── app/          ← NOT web-reachable (secrets, code, CLI tools)
├── storage/      ← NOT web-reachable (encrypted documents, logs)
└── public/       ← the ONLY folder the web server serves (document root)
```

1. Create an empty database and import `app/schema.sql`. In production, grant
   the app user only `INSERT, SELECT` on `audit_log`.
2. `cp app/secrets.example.php app/secrets.php`, fill it in, and `chmod 600`.
   Generate the key with `php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"`.
3. Point the domain at `public/` and make `storage/` writable by PHP (`chmod 700`).
4. Create your operator login: `php app/cli/create_operator.php you@company.com "Your Name"`.
5. Create your own clinic as a comped practice:
   `php app/cli/create_practice.php "Your Clinic" doc@yourclinic.com "Dr. Name" --comped`
   (prints the practice id).
6. Other practices sign up themselves at `/app.html#signup`.

### Stripe
1. In Stripe, create a Product for each plan with two recurring Prices:
   monthly ($39 / $59 / $79) and yearly ($390 / $590 / $790). Put the Price
   IDs in `STRIPE_PRICES` (`'solo' => ['monthly' => ..., 'annual' => ...]`),
   along with `STRIPE_SECRET_KEY` and `APP_URL`. Plans without an annual
   Price simply don't offer annual billing.
2. Add a webhook to `https://<app>/api/billing.php?action=webhook` for
   `checkout.session.completed` and `customer.subscription.created/updated/deleted`.
   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Turn on the Customer Portal (plan switching, cancellation, invoices) in
   Stripe's settings.

Without Stripe keys, everything else works and the Billing page says billing isn't set up.

### Email (trial reminders)
`app/cli/trial_reminders.php` runs daily from cron (setup.sh / update.sh
install `/etc/cron.d/injurycase`). To turn sending on, verify your domain in
Amazon SES (add the DKIM records it gives you), create SES SMTP credentials,
and set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in
`secrets.php`. A new SES account starts in the sandbox, so request production
access before relying on it. Run `php app/cli/trial_reminders.php --dry-run`
to see who would be emailed. The emails carry account details only, never
patient information.

### Importing a practice's spreadsheets
Export the Google Sheets as CSV, then:
```
php app/cli/import_sheets.php --practice=ID --ar=ar.csv --tracking=tracking.csv --dry-run   # preview
php app/cli/import_sheets.php --practice=ID --ar=ar.csv --tracking=tracking.csv
```
- A/R rows become cases with opening insurance/patient balances, the attorney
  and insurer as contacts, the last visit, last correspondence and settlement fields.
- Tracking rows become cases with the checklist, MRI/EMC/consult referrals,
  outcome tools and prior care in the notes.
- Unparseable dates are kept as notes rather than guessed. Every imported case
  is labeled "imported — verify".
- The two sheets aren't linked by patient, so the same person can appear twice. Merge them by hand.

### Local development
```
php -S 127.0.0.1:8080 -t pi_portal/public pi_portal/app/dev_router.php
```
The dev router sends the same security headers as `public/.htaccess`. It is never deployed.

## Roadmap ideas
- Email verification at signup and transactional email (through a vendor that signs a BAA)
- HIPAA-compliant e-fax for attorney letters
- PIP rules for other no-fault states (`app/pi_rules.php`, keyed by `practices.state`)
- Self-service CSV import in the app
- Narrative report generator
