# Deploying InjuryCase on AWS

`injurycase.yaml` (CloudFormation) builds the whole environment. `setup.sh`
configures the server, and `update.sh` ships later code updates.

```
Internet ──443──▶ EC2 (Amazon Linux 2023, Apache + PHP 8.3, Let's Encrypt)
                   │  encrypted disk (logs; uploads are read and discarded, never stored)
                   │  no SSH port: admin access via AWS Systems Manager Session Manager
                   └──TLS──▶ RDS MySQL 8.4 (private subnets, encrypted, TLS required,
                                            35-day automated backups, deletion protection)
Secrets Manager: DB credentials + app encryption key
AWS Backup: daily server-disk snapshots, kept 35 days
Monitoring: Route 53 health check on /api/health.php every 30 s (us-east-1),
            EC2 status-check alarms that auto-recover/reboot, email alerts via SNS
```

After the stack is created, **confirm the "AWS Notification - Subscription
Confirmation" email** sent to AdminEmail, or no alerts will arrive. The website
health check (about $0.75/month) is only created when the stack is in us-east-1;
in another region, point any external monitor (e.g. UptimeRobot) at
`https://<domain>/api/health.php`, which answers `ok` when the app and database are up.
The footer badge "24/7 uptime monitoring" relies on this being in place.

**Rough monthly cost** (us-east-1, single-AZ, on-demand, before taxes; check
the AWS Pricing Calculator): t4g.small EC2 + 30 GB disk ≈ $15, db.t4g.micro
RDS + 20 GB ≈ $15, public IPv4 + Secrets Manager + backups ≈ $6–8. That's
**≈ $35–40/month**, roughly one Silver subscriber. Multi-AZ RDS roughly doubles
the database line.

## 1. Before anything else (HIPAA)
1. Create a **dedicated AWS account** for InjuryCase (not shared with anything else).
2. **Accept the AWS Business Associate Addendum:** AWS Console → **AWS Artifact** →
   Agreements → *AWS Business Associate Addendum* → Accept. Do this before any PHI
   is stored. Only use services on AWS's *HIPAA Eligible Services* list. Everything
   in this stack (EC2, EBS, RDS, Secrets Manager, Systems Manager, AWS Backup, KMS)
   is on it.
3. Secure the root user with MFA and stop using it. Create an IAM Identity Center
   (or IAM) admin user with MFA for yourself.
4. Turn on **CloudTrail** (one trail, all regions, log-file validation on) and
   **GuardDuty**. Both take a couple of clicks and give you an audit trail and
   threat detection at the AWS-account level.
5. Set a **billing alarm** (Budgets) so a surprise doesn't come by invoice.

## HIPAA build checklist — required items only

Do **not** put real patient information into production until every row below
is ✅ or done. HIPAA requires the *safeguards*, not specific AWS products; this
list keeps only what's required for InjuryCase, says how each is met, and who
does it. ✅ = already built into the app or `injurycase.yaml`; ☐ = to do at build
time (owner in brackets).

### 1. Legal and organizational (all required — ☐ owner / attorney)
| Requirement | How |
|---|---|
| AWS Business Associate Addendum | ☐ AWS Artifact → Agreements → accept, **before** any PHI (step 1 below). Use only services on AWS's HIPAA-eligible list. |
| BAAs with customer practices | ✅ Built: every practice accepts the BAA in the app (signup / Practice settings), versioned and audited. ☐ Attorney finalizes the text in `public/legal.html`. |
| Security risk assessment (§164.308(a)(1)) | ☐ Written risk analysis: assets, threats, likelihood, impact, safeguards, remediation plan. Update yearly and after major changes. |
| Written policies and procedures | ☐ Security, privacy, access management (who gets operator / AWS access), data retention (matches Terms §7: 12 months read-only, then deletion), incident response, contingency (backups / restore — section 6 below). Keep 6 years. |
| Breach notification plan (§164.400–414) | ☐ How incidents are investigated, documented and reported: to practices within the BAA's deadline, so they can notify patients / HHS. Keep an incident log. |
| Workforce training | ☐ Train anyone with AWS, operator or support access (you, any contractor) before access; yearly refresher; record dates. |
| Vendor compliance | ✅ PHI only touches AWS (EC2, EBS, RDS, Secrets Manager, Backup, KMS, Systems Manager — all BAA-covered). Stripe, SendGrid, Gemini and OpenAI never receive PHI (billing and marketing only); app emails are built to carry no patient details. ☐ Re-check whenever a vendor is added. |

### 2. AWS infrastructure (required safeguards → what we use)
| Safeguard | Service | Status |
|---|---|---|
| Hosting on BAA-covered infrastructure | EC2 (one server; ECS/Fargate not required at this size) | ✅ in stack |
| Encrypted database, private network only | RDS MySQL, private subnets, storage encryption, TLS required | ✅ in stack |
| No document storage | Patient documents stay in the practice's EHR; uploaded files are read and discarded (uploads awaiting review are app-encrypted on the encrypted EBS disk and deleted on apply or within 2 hours) | ✅ in stack / app |
| Encryption keys | AWS KMS (RDS, EBS, Backup, Secrets Manager) + app key held in Secrets Manager | ✅ |
| TLS certificates | Let's Encrypt on the server (ACM is used only once there's a load balancer) | ✅ setup.sh |
| Network isolation | VPC; database reachable only from the app server; **no SSH port** (Session Manager) | ✅ in stack |
| Least-privilege infrastructure access | IAM: instance role limited to its own secrets; root user locked with MFA; your admin user with MFA | ✅ role in stack · ☐ root MFA + admin user (step 1) |
| Credentials and secrets | Secrets Manager (DB password, encryption key); nothing secret in the repo | ✅ |

### 3. Authentication and access control (✅ all built into the app)
Unique accounts per person; **two-factor sign-in required for every user**; role-based
access (doctor, staff, billing, admin) and per-location limits; clinic-level data
isolation on every query (tested); 15-minute idle and absolute session timeouts with
secure logout; password length rules and account lockout after failed attempts;
deactivation takes effect immediately; operator accounts can't open patient records.
*(Cognito not required — the app's own authentication meets these safeguards.)*

### 4. Patient data security
| Requirement | Status |
|---|---|
| Encryption at rest | ✅ RDS + EBS encryption, plus field-level encryption of sensitive patient fields and every document |
| Encryption in transit | ✅ HTTPS only (HSTS) to the browser; TLS required to the database |
| Safe database access | ✅ prepared statements throughout · ☐ at build: the app connects with its own least-privilege DB user instead of the RDS admin account (admin kept in Secrets Manager for migrations and the deletion tool only) |
| Upload validation | ✅ type checked from the file's bytes, size limits, stored encrypted outside the web root |
| SQL injection / XSS / CSRF | ✅ prepared statements, strict Content-Security-Policy, output escaping, CSRF tokens |
| Integrity | ✅ field-by-field change history in the audit log; EHR ledger re-uploads replace only EHR-sourced lines, with each import recorded |
| Retention and secure deletion | ✅ `app/cli/purge_practice.php` (README → Legal documents and data retention); backups expire in 35 days |
| No PHI in logs, errors, emails or analytics | ✅ errors log a reference only; no analytics or third-party scripts; emails carry no patient details |
| Separate dev / test / production | ☐ **Production in its own AWS account**; develop and test only with fictional data (the demo seed), never a copy of production |

### 5. Auditing, monitoring and incident detection
| Requirement | Service | Status |
|---|---|---|
| Who viewed / changed which patient record, when | App audit log (every view, edit, export, download; filterable, CSV export) | ✅ |
| Audit log protected from changes | ☐ At build: that app DB user gets INSERT/SELECT only on `audit_log` (no UPDATE/DELETE); the deletion tool runs with the admin credential |
| AWS account activity | CloudTrail — one trail, all regions, log-file validation | ☐ step 1 |
| Threat detection | GuardDuty, findings → EventBridge → the existing SNS alert topic | ☐ step 1 |
| Availability and alerts | CloudWatch alarms + Route 53 health check → SNS email | ✅ in stack |
| Audit retention | ☐ Set in your retention policy (attorney: commonly 6 years) and keep the deletion tool in line with it |
*(AWS Config and Security Hub are optional — useful later, not required.)*

### 6. Backup, recovery and maintenance
| Requirement | Status |
|---|---|
| Automated, encrypted database backups | ✅ RDS automated backups, 35 days, point-in-time restore |
| Document / server backups | ✅ AWS Backup daily, 35 days, encrypted vault |
| Restore testing | ☐ Do a drill before launch, then twice a year (section 6 below); record the time taken |
| Recovery objectives | ☐ Document them — suggested: RPO 5 min (database) / 24 h (documents); RTO 4 h |
| Encryption key escrow | ☐ Offline copy of the app encryption key (setup prints the command) |
| Patching | ✅ automatic security updates on the server; ☐ review `dnf`/PHP/RDS minor versions monthly |
| Vulnerability scanning | ☐ Amazon Inspector on the EC2 instance (HIPAA-eligible, low cost) |
| Penetration test | ☐ Before launch or soon after, then yearly / after major changes, scoped by the risk assessment |
| Access reviews | ☐ Quarterly: AWS users, operator accounts, practice admins' own user lists |
| Ongoing | ☐ Update the risk assessment yearly; log security incidents and fixes |

### Build order
1. **Agreements and policies:** accept the AWS BAA, start the risk assessment and policies, finalize the customer BAA with the attorney.
2. **Secure the AWS account:** dedicated account, root MFA, admin user with MFA, CloudTrail, GuardDuty → SNS, billing alarm (section 1 below).
3. **Create the stack and server:** sections 2–3 below (VPC, private encrypted RDS, Secrets Manager, backups, alarms — all in `injurycase.yaml`).
4. **Lock down the app:** create the least-privilege app DB user (audit log insert/read only), save the encryption key offline, turn on Inspector.
5. **Test before real PHI:** restore drill, authorization / isolation checks (the test suites), vulnerability scan, pre-launch security review or pen test.
6. **Maintain:** monthly patch review, quarterly access review, yearly risk assessment, training and restore drill.

*AWS provides the infrastructure; HIPAA compliance covers the whole organization and
application — infrastructure, application security and organizational policies
together.* References: [AWS HIPAA-eligible services](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/) ·
[AWS Artifact](https://aws.amazon.com/artifact/) · [HHS Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)

## 2. Create the stack
Console → CloudFormation → Create stack → upload `injurycase.yaml`:
- **DomainName:** `injurycase.com`. The landing page is served at `/` and the app at `/app.html`.
- **AdminEmail:** your email

It takes about 15 minutes (most of that is RDS). When it finishes, open **Outputs**:
- At your registrar, create **A records** for `injurycase.com` **and** `www.injurycase.com`, both pointing at `ElasticIP`. `www` redirects to the bare domain.
- Copy `ConnectCommand`.

CLI alternative:
```
aws cloudformation deploy --stack-name injurycase --template-file injurycase.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DomainName=injurycase.com AdminEmail=you@example.com
```

## 3. Set up the server
```
aws ssm start-session --region <region> --target <InstanceId>   # or: EC2 console → Connect → Session Manager
sudo -i
git clone https://github.com/bellecastleequity/CovChiro.git /opt/injurycase-src   # private repo: use a deploy key or token
bash /opt/injurycase-src/pi_portal/deploy/aws/setup.sh
```
The script installs Apache/PHP, copies the app to `/var/www/injurycase`, generates
the encryption key into Secrets Manager, writes `app/secrets.php`, imports the
schema over TLS, configures Apache and PHP, enables automatic security updates,
and gets the HTTPS certificate. If DNS hasn't propagated yet, re-run it a few
minutes later. It's safe to run again.

**Then, immediately:** save the encryption key offline (the script prints the command).

Finish with the commands the script prints: create your operator login and your
own (comped) clinic, then import your spreadsheets.

## 4. Stripe
Edit `/var/www/injurycase/app/secrets.php` and uncomment the Stripe lines (monthly
Price IDs for $39 / $59 / $79 and annual ones for $390 / $590 / $790). For trial
reminder emails, also fill in the SES SMTP lines (see the main README). Set the webhook to
`https://<domain>/api/billing.php?action=webhook`, then run `systemctl reload php-fpm`.
See the main README for details.

## 5. Updating the code later
```
sudo -i
cd /opt/injurycase-src && git pull
bash pi_portal/deploy/aws/update.sh
```
This keeps `secrets.php` and storage, and applies any new database
migrations (`app/migrations/`).

## 6. Restore drills (do one before launch)
- **Database:** RDS console → the instance → *Restore to point in time* (any
  second in the last 35 days) creates a new instance. Point `PI_DB_HOST` at it.
- **Documents:** AWS Backup → the vault → restore the latest EC2 recovery point.
- **The key:** a restored database or document store is useless without
  `PI_ENCRYPTION_KEY`. That's why the offline copy matters.

Write down what you did and how long it took. Your HIPAA contingency plan
(§164.308(a)(7)) wants exactly this.

## When you outgrow one server
Move to two or more EC2 instances (or ECS) behind an Application Load Balancer
with an ACM certificate, and keep documents on EFS or in S3 (the app encrypts
files before writing, so the storage backend only needs swapping in
`documents.php`). Also turn on RDS Multi-AZ (`DBMultiAZ=true`). The rest of the
code doesn't change.
