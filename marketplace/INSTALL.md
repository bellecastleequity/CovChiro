# Install guide

There are three ways to run CoverageOnCall:

- **Part A** runs it on your own computer so you can try it out. It takes about 15 minutes and needs no accounts or keys.
- **Part B** puts it live on Google Cloud at coverageoncall.com. It takes about 2 hours the first time.

- **Namecheap cPanel** (shared hosting): see **[INSTALL-CPANEL.md](INSTALL-CPANEL.md)**. There, the database lives on Neon and a once-a-minute cron job stands in for the background worker.

---

## Part A — Run it on your computer

### A1. Install the tools (one time)

| Tool | Version | Get it |
|---|---|---|
| Node.js | 22 | https://nodejs.org (LTS installer) |
| pnpm | 10 | after Node is installed: `npm install -g pnpm@10` |
| Docker Desktop | any | https://www.docker.com/products/docker-desktop — used only to run the database and Redis |

### A2. Start the database and Redis

Open a terminal and run:

```bash
docker run -d --name cm-db -p 5432:5432 -e POSTGRES_USER=cm -e POSTGRES_PASSWORD=cm -e POSTGRES_DB=coverage_app postgis/postgis:16-3.4
docker run -d --name cm-redis -p 6379:6379 redis:7
```

### A3. Install the app

```bash
cd marketplace
pnpm install
cp .env.example apps/web/.env.local
```

The defaults in `apps/web/.env.local` already point at the database and Redis from step A2:

```
DATABASE_URL=postgresql://cm:cm@localhost:5432/coverage_app
REDIS_URL=redis://localhost:6379
```

Leave every other key blank. With no key set, the app uses a built-in stand-in for that service:

- Emails and texts appear in Admin → Notifications instead of being sent.
- Payments go through a fake Stripe page.
- Agreements are signed on a test page.

### A4. Create the tables and demo data

macOS or Linux:

```bash
set -a; . apps/web/.env.local; set +a
pnpm db:generate
pnpm db:migrate
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='pick-a-long-password' SEED_DEMO=1 pnpm db:seed
```

Windows (PowerShell):

```powershell
$env:DATABASE_URL="postgresql://cm:cm@localhost:5432/coverage_app"
pnpm db:generate; pnpm db:migrate
$env:SEED_ADMIN_EMAIL="you@example.com"; $env:SEED_ADMIN_PASSWORD="pick-a-long-password"; $env:SEED_DEMO="1"; pnpm db:seed
```

### A5. Start it

Open two terminals, both in the `marketplace` folder.

```bash
pnpm dev          # terminal 1: the website → http://localhost:3000
pnpm dev:worker   # terminal 2: background jobs (offer timers, payouts, emails)
```

### A6. Sign in

**Admin:**
- **Where:** http://localhost:3000/login
- **Account:** the email and password you chose in step A4.
- **First sign-in:** you'll be asked to scan a QR code with an authenticator app (Google Authenticator, Authy or 1Password). This two-step sign-in is required for admins.

**Demo accounts** (all use the password `demo-password-1`):

| Account | Email |
|---|---|
| Clinic | `clinic@demo.test` |
| Florida chiropractor | `provider@demo.test` |
| Georgia-only chiropractor (can't see Florida shifts) | `ga-provider@demo.test` |

**Things to try:**
- **Clinic:** sign in as the clinic → Post a shift → pick a date 1–2 days out. A search starts on its own ("Finding someone").
- **Provider:** sign in as `provider@demo.test` in a private window → Offers → Accept.
- **Admin:** go to Shifts and open the shift to see the dispatch log. Analytics shows the metrics.

To stop, press Ctrl+C in both terminals. Next time, run `docker start cm-db cm-redis`, then step A5.

---

## Part B — Go live on Google Cloud

### What you'll need

- A Google Cloud project with billing turned on.
- The `gcloud` command-line tool (https://cloud.google.com/sdk/docs/install). Run `gcloud auth login` once.
- Live accounts and keys for:

| Service | What it's for | Where the key is |
|---|---|---|
| Stripe (with Connect turned on) | Clinic charges and provider payouts | Dashboard → Developers → API keys |
| SendGrid | Email. Authenticate the coverageoncall.com domain first. | Settings → API Keys |
| Google Maps Platform | Addresses and drive times. Turn on the Geocoding and Routes APIs. | Cloud Console → APIs & Services → Credentials |
| Twilio | Text messages and reply-by-text | Console. You'll need the Account SID, Auth Token and a Messaging Service SID. |
| Dropbox Sign | Signed agreements. Create two templates, one for clinics and one for providers. | API settings |

Estimated cost at low traffic is about $80–150 a month:
- Cloud SQL (smallest tier): about $30–50
- Memorystore Redis at 1 GB: about $35
- Cloud Run: $10–40
- The VPC connector: about $10

### B1. Set variables (copy into your terminal)

```bash
PROJECT=your-gcp-project-id
REGION=us-east1
gcloud config set project $PROJECT
```

### B2. Turn on the Google services

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com vpcaccess.googleapis.com \
  cloudbuild.googleapis.com
gcloud artifacts repositories create cm --repository-format=docker --location=$REGION
```

### B3. Database (Cloud SQL, Postgres 16)

```bash
gcloud sql instances create cm-db --database-version=POSTGRES_16 --region=$REGION \
  --tier=db-custom-1-3840 --storage-auto-increase --backup-start-time=07:00
gcloud sql databases create coverage --instance=cm-db
gcloud sql users create cm_app --instance=cm-db --password='CHOOSE-A-STRONG-PASSWORD'
```

The first migration switches on the PostGIS, btree_gist and citext extensions by itself; Cloud SQL allows this.

The database address the app uses is:

```
postgresql://cm_app:PASSWORD@localhost/coverage?host=/cloudsql/PROJECT:REGION:cm-db
```

### B4. Redis and the private network link

```bash
gcloud redis instances create cm-redis --size=1 --region=$REGION --redis-version=redis_7_0
gcloud compute networks vpc-access connectors create cm-vpc --region=$REGION --range=10.8.0.0/28
gcloud redis instances describe cm-redis --region=$REGION --format='value(host)'   # note this IP
```

`REDIS_URL` is `redis://THAT-IP:6379`.

### B5. Store your keys in Secret Manager

Make a file called `prod.env` from `.env.example` and fill in every value:

- `NODE_ENV=production`
- `APP_BASE_URL=https://coverageoncall.com`
- `DATABASE_URL` from step B3
- `REDIS_URL` from step B4
- `SESSION_SECRET`: generate it with `openssl rand -hex 32`
- the keys for all five services in the table above
- `GCS_BUCKET`: create a private bucket with `gcloud storage buckets create gs://$PROJECT-cm-uploads --location=$REGION`

Keep each comment on its own line, and don't put spaces around `=`. **Don't commit this file to git.**

Then load each line into Secret Manager:

```bash
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" == \#* || -z "$v" ]] && continue
  v="${v%\"}"; v="${v#\"}"          # drop surrounding quotes
  printf '%s' "$v" | gcloud secrets create "cm-$k" --data-file=- 2>/dev/null \
    || printf '%s' "$v" | gcloud secrets versions add "cm-$k" --data-file=-
done < prod.env
SECRETS=$(grep -v '^#' prod.env | grep '=.' | cut -d= -f1 | sed 's/.*/&=cm-&:latest/' | paste -sd, -)
```

Let the Cloud Run service account read the secrets:

```bash
SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/cloudsql.client
gcloud storage buckets add-iam-policy-binding gs://$PROJECT-cm-uploads --member=serviceAccount:$SA --role=roles/storage.objectAdmin
```

### B6. Build the app images

Run this from the `marketplace` folder. The build happens in Google Cloud, so you don't need Docker locally.

```bash
gcloud builds submit --config deploy/cloudbuild.yaml --substitutions=_REGION=$REGION,_REPO=cm .
IMG=$REGION-docker.pkg.dev/$PROJECT/cm
```

### B7. Create the tables and your admin account

```bash
COMMON="--region=$REGION --set-cloudsql-instances=$PROJECT:$REGION:cm-db --vpc-connector=cm-vpc --set-secrets=$SECRETS"
gcloud run jobs create cm-migrate --image=$IMG/worker:latest $COMMON --command=pnpm --args=db:migrate
gcloud run jobs execute cm-migrate --region=$REGION --wait

gcloud run jobs create cm-seed --image=$IMG/worker:latest $COMMON --command=pnpm --args=db:seed \
  --set-env-vars=SEED_ADMIN_EMAIL=you@yourdomain.com,SEED_ADMIN_PASSWORD='a-long-one-time-password'
gcloud run jobs execute cm-seed --region=$REGION --wait
```

The seed job runs once. After you've signed in, change the password and delete the job with `gcloud run jobs delete cm-seed`.

### B8. Start the website and the worker

```bash
gcloud run deploy cm-web --image=$IMG/web:latest $COMMON --allow-unauthenticated \
  --min-instances=1 --memory=1Gi --port=8080

gcloud run deploy cm-worker --image=$IMG/worker:latest $COMMON --no-allow-unauthenticated \
  --min-instances=1 --max-instances=2 --no-cpu-throttling --memory=512Mi --port=8080
```

Both services refuse to start if a required key is missing, and the error message names the missing key.

### B9. Connect the domain

```bash
gcloud beta run domain-mappings create --service=cm-web --domain=coverageoncall.com --region=$REGION
gcloud beta run domain-mappings create --service=cm-web --domain=www.coverageoncall.com --region=$REGION
```

Add the DNS records it prints at your domain registrar. The HTTPS certificate is issued automatically, usually within an hour.

### B10. Point the outside services at the site

- **Stripe:**
  Create **two destinations** in Stripe → Developers → Webhooks → **Add destination**, both pointing at the same URL, `https://coverageoncall.com/api/webhooks/stripe`:

  | Destination | Event destination scope | Events to select |
  |---|---|---|
  | 1 | **Your account** | `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `checkout.session.completed`, `transfer.reversed` |
  | 2 | **Connected accounts** | `account.updated` (providers' payout accounts becoming ready, or being restricted, after Stripe verifies them) |

  For each one: keep the default API version, click **Continue**, choose **Webhook endpoint**, and paste the URL. Then open the destination and reveal its **Signing secret** (`whsec_…`).
  - Put **both** secrets into `STRIPE_WEBHOOK_SECRET`, separated by a comma: `whsec_AAA,whsec_BBB`.
  - Store that comma-separated value in the `cm-STRIPE_WEBHOOK_SECRET` secret, then redeploy `cm-web`.
- **Twilio:** Messaging Service → Integration → incoming messages webhook: `https://coverageoncall.com/api/webhooks/twilio`.
- **Dropbox Sign:** API → callback URL: `https://coverageoncall.com/api/webhooks/esign`.

### B11. Set up the business before launch

Sign in as admin (you'll set up two-step sign-in on first login), then:

1. **Rates:** the seeded prices and pay are placeholders. Set real clinic prices and provider pay for each Florida region.
2. **Settings:** review deposits, payout timing, cancellation fees and dispatch timing. Every business number is editable here.
3. **States:** Florida chiropractic is the only combination switched on. Turn on more states and professions only when you're ready to verify licences there.
4. **Promo codes:** create your launch codes. Each one gets a QR code and a landing page.
5. **Switched-off features (turn on after legal review):**
   - `features.onCallEnabled`: On Call auto-booking
   - `features.conversionFeeEnabled`: conversion fee

### B12. Updating later

```bash
gcloud builds submit --config deploy/cloudbuild.yaml --substitutions=_REGION=$REGION,_REPO=cm .
gcloud run jobs execute cm-migrate --region=$REGION --wait
gcloud run deploy cm-web --image=$IMG/web:latest --region=$REGION
gcloud run deploy cm-worker --image=$IMG/worker:latest --region=$REGION
```

---

## Launch day: switch over from coveragechiropractor.com

1. **Copy over leads and promo codes.** Export them from the old PHP admin, then add them in Admin → Leads and Admin → Promo codes.
2. **Redirect the old domain.** In the old site's `.htaccess` (cPanel → File Manager → `public_html/.htaccess`), put this at the top:
   ```apache
   RewriteEngine On
   RewriteCond %{HTTP_HOST} ^(www\.)?coveragechiropractor\.com$ [NC]
   RewriteRule ^(.*)$ https://coverageoncall.com/chiropractic [R=301,L,QSA]
   ```
3. **Tell Google.** In Search Console, use Settings → Change of address. Also update your Google Business Profile and email signatures.
4. **Keep the old domain.** Keep it registered and the redirect in place for at least 12 months.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required production env vars: …` | One of the named secrets is missing. Add it (step B5), then redeploy. |
| `The table … does not exist` | Migrations haven't run. Run step A4, or `gcloud run jobs execute cm-migrate`. |
| Offers never expire, payouts never go out | The worker isn't running. Check `cm-worker` logs in Cloud Run; it needs `--no-cpu-throttling` and at least one instance running (`--min-instances=1`). |
| Admin can't sign in after losing phone | Run in Cloud SQL Studio: `UPDATE "User" SET "mfaEnabled"=false, "totpSecret"=NULL WHERE email='you@…';`. You'll re-enrol at next login. |
| Emails not arriving | SendGrid domain authentication isn't finished, or `SENDGRID_API_KEY` is missing. Check Admin → Notifications for errors. |
