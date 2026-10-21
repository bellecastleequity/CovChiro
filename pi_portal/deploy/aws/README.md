# Deploying CaseMGR on AWS

`casemgr.yaml` (CloudFormation) builds the whole environment. `setup.sh`
configures the server, and `update.sh` ships later code updates.

```
Internet ──443──▶ EC2 (Amazon Linux 2023, Apache + PHP 8.3, Let's Encrypt)
                   │  encrypted disk (uploaded documents, already encrypted by the app)
                   │  no SSH port: admin access via AWS Systems Manager Session Manager
                   └──TLS──▶ RDS MySQL 8.4 (private subnets, encrypted, TLS required,
                                            35-day automated backups, deletion protection)
Secrets Manager: DB credentials + app encryption key
AWS Backup: daily server-disk snapshots, kept 35 days
```

**Rough monthly cost** (us-east-1, single-AZ, on-demand, before taxes; check
the AWS Pricing Calculator): t4g.small EC2 + 30 GB disk ≈ $15, db.t4g.micro
RDS + 20 GB ≈ $15, public IPv4 + Secrets Manager + backups ≈ $6–8. That's
**≈ $35–40/month**, roughly one Solo subscriber. Multi-AZ RDS roughly doubles
the database line.

## 1. Before anything else (HIPAA)
1. Create a **dedicated AWS account** for CaseMGR (not shared with anything else).
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

## 2. Create the stack
Console → CloudFormation → Create stack → upload `casemgr.yaml`:
- **DomainName:** for example `app.casemgr.com` (register the domain in Route 53 or anywhere)
- **AdminEmail:** your email

It takes about 15 minutes (most of that is RDS). When it finishes, open **Outputs**:
- Point your domain's DNS **A record** at `ElasticIP`.
- Copy `ConnectCommand`.

CLI alternative:
```
aws cloudformation deploy --stack-name casemgr --template-file casemgr.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DomainName=app.casemgr.com AdminEmail=you@example.com
```

## 3. Set up the server
```
aws ssm start-session --region <region> --target <InstanceId>   # or: EC2 console → Connect → Session Manager
sudo -i
git clone https://github.com/bellecastleequity/CovChiro.git /opt/casemgr-src   # private repo: use a deploy key or token
bash /opt/casemgr-src/pi_portal/deploy/aws/setup.sh
```
The script installs Apache/PHP, copies the app to `/var/www/casemgr`, generates
the encryption key into Secrets Manager, writes `app/secrets.php`, imports the
schema over TLS, configures Apache and PHP, enables automatic security updates,
and gets the HTTPS certificate. If DNS hasn't propagated yet, re-run it a few
minutes later. It's safe to run again.

**Then, immediately:** save the encryption key offline (the script prints the command).

Finish with the commands the script prints: create your operator login and your
own (comped) clinic, then import your spreadsheets.

## 4. Stripe
Edit `/var/www/casemgr/app/secrets.php` and uncomment the Stripe lines (Price
IDs for $39 / $59 / $79). Set the webhook to
`https://<domain>/api/billing.php?action=webhook`, then run `systemctl reload php-fpm`.
See the main README for details.

## 5. Updating the code later
```
sudo -i
cd /opt/casemgr-src && git pull
bash pi_portal/deploy/aws/update.sh
```
This keeps `secrets.php` and uploaded documents, and applies any new database
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
