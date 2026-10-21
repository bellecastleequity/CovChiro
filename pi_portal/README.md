# PI Case Portal

A provider-side personal injury case management system. It replaces the
"Injury Tracking Sheet" and the "PI A/R – PIP" Google Sheets with one
application that tracks each case from intake through settlement:

| Area | What it does |
|---|---|
| **Dashboard** | Open cases, actively treating, visits this week, total A/R, A/R in demand/litigation, the case pipeline by stage, a prioritized "needs attention" list, and your tasks. |
| **Cases** | Searchable/sortable list with stage, benefits, DOI, first/last visit, attorney, last contact, balance, checklist progress and alert count. |
| **Checklist** | The tracking sheet's protocol with real deadlines: 48-hour intake items (called atty, LOR, AOB, prior records/imaging, ADL), MRI within 10 days, EMC referral within 21, consults within 45, and discharge items (final ADL, treatment-complete letter, final narrative, records request). Imaging and consult items complete themselves from the Co-management tab. |
| **Co-management** | Outgoing and incoming referrals (MRI, X-ray, CT, EMC determination, ortho, neuro, pain management, surgical, PT): ordered → scheduled → completed → report received → entered in chart, plus no-shows and findings. |
| **Visits** | Dates of service, type (initial, treatment, re-exam, discharge, no-show), CPT codes, notes, and an optional charge posted to the ledger. The first visit moves an intake case to Treating. A discharge visit moves it to Treatment complete. |
| **Outcomes** | Bournemouth (neck/back), Oswestry, NDI, HDI, shoulder, knee, ADL, with first-vs-latest change. |
| **Correspondence** | Every fax/email/call with attorneys, adjusters and providers, with follow-up dates. Includes printable letters: case status request, treatment complete, and reduction response. |
| **Financials** | A ledger split into insurance (PIP/MedPay) and patient/LOP buckets, a PIP-limit meter (80% payout, $2,500 cap without EMC), and settlement tracking: attorney offer, 80% floor, final settlement, date authorized, check received. |
| **A/R & settlements** | The A/R sheet as a live report with totals and CSV export. |
| **Documents** | LORs, records, imaging/EMC/consult reports and narratives, encrypted on disk. |
| **Contacts** | Attorneys, insurers, imaging centers, co-managing providers. |
| **Users / Audit log** | Role-based accounts and a full access history. |

### Florida PIP rules built into the alerts (`app/pi_rules.php`)
- Initial care within **14 days** of the accident (§627.736(1)(a)), flagged for new intakes and late first visits.
- No **EMC determination** means PIP medical benefits are capped at **$2,500**.
- Charges approaching the PIP limit.
- Plus: imaging/consult reports not received, referrals not scheduled, no-shows, gaps in care over 14 days, outcome tools due every 30 days, no attorney status update in 30 days on demand/litigation cases, follow-ups due, and settlement checks not received 30 days after authorization.

All of these thresholds are constants at the top of `app/pi_rules.php`.

---

## HIPAA: what the code does vs. what you must do

The software implements the HIPAA Security Rule's **technical** safeguards.
HIPAA compliance as a whole also requires administrative and physical
safeguards and signed agreements that no code can provide.

### Built into the portal
| Safeguard (45 CFR §164.312) | Implementation |
|---|---|
| Unique user IDs | Individual accounts. Roles: admin, provider, staff, billing. |
| Authentication | Argon2id passwords (12+ characters), **mandatory TOTP two-factor** for every user, account lockout after 5 failures, per-IP throttle, and forced password change on first login. |
| Automatic logoff | 15-minute idle timeout enforced server-side, with a 12-hour absolute limit. The screen is wiped on timeout. |
| Audit controls | `audit_log` records every case view, edit, export, letter, document upload/download, login, failed login and denied access, with user, time and IP. It stores no PHI values. Admins can review it in the UI. |
| Integrity | Encryption is authenticated (tampering is detected). Documents carry a SHA-256 checksum. Records are archived, never hard-deleted. |
| Encryption at rest | DOB, phone, email, address, claim/policy numbers and all clinical and correspondence notes are encrypted per field with libsodium. Uploaded files are encrypted and stored outside the web root. |
| Transmission security | HTTPS forced, HSTS, `SameSite=Strict` `__Host-` session cookies, CSRF tokens. |
| Minimum necessary | Role permissions (for example, staff can't post payments; billing can't edit clinical records). |
| Web hardening | Strict CSP (no inline script, no third-party requests: no CDNs, fonts or analytics), no caching of any response, and errors never reveal details to the browser. |

### Your responsibilities (the real obstacles)
1. **Hosting with a signed BAA.** Do **not** run this on the Namecheap shared
   hosting used for the marketing sites. Namecheap does not sign Business
   Associate Agreements. Use a HIPAA-eligible host that will sign a BAA, for example:
   - AWS (Lightsail or EC2 + RDS MySQL with encryption on), after accepting the BAA in AWS Artifact
   - Google Cloud or Azure (BAA available)
   - A managed HIPAA host such as Liquid Web HIPAA, Atlantic.Net or HIPAA Vault

   The database volume and backups must be encrypted at rest. That is what
   protects patient *names*, which are left unencrypted so they can be searched.
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

Requirements: PHP 8.1+ with `pdo_mysql`, `sodium` and `fileinfo`, MySQL 8 or MariaDB 10.6+, Apache with `mod_rewrite`/`mod_headers` (or the nginx equivalent), and HTTPS.

```
/home/<user>/
├── pi_portal/
│   ├── app/          ← NOT web-reachable (secrets, code, CLI tools)
│   ├── storage/      ← NOT web-reachable (encrypted documents, logs)
│   └── public/       ← the ONLY folder the web server serves (document root)
```

1. Create an empty database and a user for it. Import `app/schema.sql`.
   For production, grant the app user only `INSERT, SELECT` on `audit_log`
   so the log can't be altered.
2. `cp app/secrets.example.php app/secrets.php`, fill it in, and `chmod 600` it.
   Generate the key with `php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"`.
3. Point the domain's document root at `pi_portal/public`. Make `storage/`
   writable by PHP (`chmod 700`).
4. Create yourself an admin: `php app/cli/create_admin.php you@practice.com "Dr. Name"`.
5. Sign in. You'll set a password and scan a 2FA QR code.
6. Add staff under **Users**. Each one gets a one-time password; hand it over in person.

### Importing the existing spreadsheets
Export both Google Sheets as CSV, then:
```
php app/cli/import_sheets.php --ar=ar.csv --tracking=tracking.csv --dry-run   # preview
php app/cli/import_sheets.php --ar=ar.csv --tracking=tracking.csv
```
- A/R rows become cases with opening insurance/patient balances, the attorney
  and insurer as contacts, the last visit, last correspondence and settlement fields.
- Tracking rows become cases with the checklist, MRI/EMC/consult referrals,
  outcome tools and prior care in the notes.
- Unparseable dates are kept as notes rather than guessed. Every imported case
  is labeled "imported — verify". "Still treating" rows whose care began over
  a year ago are moved to Treatment complete.
- The two sheets aren't linked by patient, so the same person can appear twice
  (once from each sheet). Merge them by hand.

### Local development
```
php -S 127.0.0.1:8080 -t pi_portal/public pi_portal/app/dev_router.php
```
The dev router sends the same security headers as `public/.htaccess`. It is never deployed.
