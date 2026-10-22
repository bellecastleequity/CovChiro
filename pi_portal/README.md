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
- **Plans** (`PLANS` in `app/saas.php`): Solo $39 (75 open cases, 3 users),
  Practice $59 (300 open, 10 users), Group $79 (unlimited). Limits count
  *open* cases only. Closed cases are free.
- **Trial.** 14 days, no card required. When the trial ends or a subscription
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
| **Referral guide & PI playbook** | Written for clinics new to PI. Each case's Overview opens with **Next steps: referrals**: MRI script at visit #1; orthopedic referral once the MRI is completed; pain management considered at 12–16 weeks of conservative care without full resolution; neurology any time after the first visit when there was a head injury (asked on every case; ICD-10 head-injury codes from EHR uploads prompt it too). Each step says when and why and tracks its referrals from ordered to report received. Actions: add the referral, add another (second MRI, another ortho opinion), "remind me later", or "not needed" with a reason. Steps that are due appear as alerts on the dashboard. The **PI playbook** page explains every timeline the app follows. Timings live in `CARE_GUIDE` in `app/pi_rules.php`. |
| **Tasks** | Assign a task to one or more team members (or leave it for anyone), with a due date, priority and notes. Make one straight from any alert with "+ Task". Filter by person, "assigned to me", "created by me" or completed. The sidebar shows how many open tasks are assigned to you. Anyone can complete a task, and who completed it is recorded. |
| **Activity & audit log** | Every case has an **Activity** tab for the whole team: who added, changed or removed what, with before → after values ("Stage: Treating → Settled", "Assigned to: Dana", "Patient balance: $0.00 → $33.00"). Free-text notes and encrypted fields are named but their contents are never logged. Amounts follow the financial-visibility rules. The practice **Audit log** (admins) adds views, downloads, exports, sign-ins and failed sign-ins, filters by team member, kind of activity, case and date, and downloads as CSV for a compliance review. |
| **Users** | Role-based accounts: admin, provider, staff, billing. |

### Florida PIP rules built into the alerts (`app/pi_rules.php`)
- Initial care within **14 days** of the accident (§627.736(1)(a)), flagged for new intakes and late first visits.
- No **EMC determination** means PIP medical benefits are capped at **$2,500**.
- Charges approaching the PIP limit.
- Workers' comp: authorized visits used or nearly used, authorization expired, the 18-visit / 8-week chiropractic limit (§440.13, verify), and DWC-25 status forms not sent.
- Money: insurance charges unpaid after 45 days, PIP ended with no signed LOP, and a settled case whose balance hasn't been forwarded.
- Plus: imaging/consult reports not received, referrals not scheduled, no-shows, gaps in care over 14 days, outcome tools due every 30 days, no attorney status update in 30 days on demand/litigation cases, follow-ups due, and settlement checks not received 30 days after authorization.

All of these thresholds are constants at the top of `app/pi_rules.php`.

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
1. In Stripe, create a Product with a monthly Price for each plan. Put the
   Price IDs in `STRIPE_PRICES`, along with `STRIPE_SECRET_KEY` and `APP_URL`.
2. Add a webhook to `https://<app>/api/billing.php?action=webhook` for
   `checkout.session.completed` and `customer.subscription.created/updated/deleted`.
   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Turn on the Customer Portal (plan switching, cancellation, invoices) in
   Stripe's settings.

Without Stripe keys, everything else works and the Billing page says billing isn't set up.

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
