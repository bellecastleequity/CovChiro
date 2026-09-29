# Install on Namecheap cPanel

This guide installs CoverageOnCall on a Namecheap shared hosting plan through cPanel. You don't need SSH or the command line.

## How the pieces fit

| Piece | Where it runs | Why |
|---|---|---|
| Website | cPanel → **Setup Node.js App** | Namecheap's cPanel runs Node.js apps. |
| Database | **Neon** (hosted Postgres) | See below. |
| Background jobs | cPanel → **Cron Jobs**, once a minute | See below. |
| Uploaded files | Your cPanel home folder | Licences, insurance certificates and photos stay on your hosting account. |
| Domain and SSL | Namecheap DNS + cPanel AutoSSL | As usual. |

**Why the database isn't on cPanel.** The app needs Postgres 16 with the **PostGIS**, **btree_gist** and **citext** extensions:
- PostGIS measures drive distances.
- btree_gist lets the database itself block double-booking.
- citext stores emails case-insensitively.

Namecheap's shared Postgres can't enable these, so the database goes on Neon (https://neon.tech). Supabase also works.

**Why the background jobs run from cron.** The jobs cover offer timers, backfill, payouts, reminders and the nightly credential check. On Google Cloud they'd run in an always-on worker, but shared hosting can't keep a program running, so a cron job calls the site once a minute and the site does whatever is due.

**Before you start, check:**

- **Node.js 20.9 or newer.** Open cPanel → *Setup Node.js App* → *Create Application*, and look at the Node.js version list. It needs **20.9 or newer, preferably 22**. If the highest version on offer is below 20.9, ask Namecheap support to enable a newer one, or use a Namecheap VPS (see the end of this guide).
- **Accounts:**
  - Neon
  - Stripe, with Connect turned on
  - SendGrid
  - Google Maps Platform, with the Geocoding and Routes APIs turned on
  - Dropbox Sign
  - Twilio (optional)

---

## Step 1 — Get the package

You need `coverageoncall-cpanel.zip`. It contains:

```
coverageoncall/              ← the app (upload this to cPanel)
database-setup.sql           ← paste into Neon once
environment-variables.txt    ← the settings to enter in cPanel
INSTALL-CPANEL.md            ← this guide
```

To build the zip yourself, run `bash deploy/cpanel/build.sh` from the `marketplace` folder on a Linux x86-64 machine (or WSL on Windows). The output is `dist/coverageoncall-cpanel.zip`. It must be built on Linux x86-64 so the compiled parts match Namecheap's servers.

## Step 2 — Create the database on Neon

1. Sign up at https://neon.tech and create a project:
   - **Postgres version:** 16.
   - **Region:** the US region nearest your hosting. Namecheap shared hosting is in the US; any US East region works well.
2. Open **SQL Editor**. Open `database-setup.sql` in a text editor, copy all of it, paste it into the editor, and click **Run**. It should finish with no errors.
   - The file runs as one transaction, so if anything fails, nothing is left half-created.
   - Run it only once, on an empty database.
3. Go to **Dashboard → Connection string**. Turn **Connection pooling OFF** and copy the string. It looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-something-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   This is your `DATABASE_URL`.

**Neon cost:** the cron job wakes the database every minute, so it effectively runs 24/7. That may exceed Neon's free allowance. Budget for its entry paid plan and check current prices at https://neon.tech/pricing.

## Step 3 — Upload the app

1. cPanel → **File Manager**. Go to your **home folder**, the one that *contains* `public_html`, not `public_html` itself.
2. **Upload** `coverageoncall-cpanel.zip`, right-click it, and choose **Extract**. You'll now have a `coverageoncall` folder in your home folder.
3. Create an empty folder called `coverageoncall-uploads` in the same place. Uploaded documents go here, outside the public web folder.

## Step 4 — Make three random secrets

You need three long random strings: `SESSION_SECRET`, `CRON_SECRET` and `SETUP_TOKEN`. Use one of these:

- **Password manager:** generate 64-character passwords with letters and digits only.
- **cPanel Terminal**, if your plan has it: run `openssl rand -hex 32` three times.

Keep them somewhere safe.

## Step 5 — Create the Node.js app

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | **22.x** (or the highest version ≥ 20.9) |
| Application mode | **Production** |
| Application root | `coverageoncall` |
| Application URL | `coverageoncall.com`. The domain must already be added in cPanel, as an addon domain or the main domain. |
| Application startup file | `apps/web/server.js` |

Scroll to **Environment variables** and add each line from `environment-variables.txt`:

- **Database:** set `DATABASE_URL` to the Neon string from Step 2.
- **Secrets:** use the three values from Step 4.
- **Uploads:** set `UPLOAD_DIR` to `/home/YOUR_CPANEL_USERNAME/coverageoncall-uploads`. Your username is shown in cPanel's right-hand sidebar.
- **Service keys:** add your Stripe, SendGrid, Google Maps and Dropbox Sign keys.

Click **Create**, then **Start App**.

- **You don't need "Run NPM Install".** The package already contains everything.
- **If the app won't start:** the site refuses to start when a required key is missing, and the log names the missing one. Open the app's log file, whose path is shown in the Node.js App screen (look for `stderr.log` or the "Passenger log file" field), add the missing variable, and click **Restart**.

## Step 6 — Turn on HTTPS

cPanel → **SSL/TLS Status** → select `coverageoncall.com` and `www.coverageoncall.com` → **Run AutoSSL**.

At Namecheap, the domain's DNS must point at your hosting. If both are in the same Namecheap account, the default "Namecheap BasicDNS" with the hosting records is enough.

## Step 7 — Create your admin account

1. Visit **https://coverageoncall.com/setup**.
2. Enter the `SETUP_TOKEN`, your name, email and a password of at least 12 characters. This also loads the starting setup: professions, all states, Florida regions and placeholder rates.
3. Sign in at `/login`. You'll be asked to scan a QR code with an authenticator app (Google Authenticator, Authy or 1Password). This two-step sign-in is required for admins.
4. Back in **Setup Node.js App**, delete the `SETUP_TOKEN` variable and click **Restart**. The `/setup` page is already disabled once an admin exists; removing the token closes it completely.

## Step 8 — Schedule the background jobs

cPanel → **Cron Jobs**:

1. **Cron email:** clear the box, otherwise you'll get an email every minute.
2. **Add New Cron Job:**
   - **Common settings:** *Once Per Minute (\* \* \* \* \*)*.
   - **Command** (replace `YOUR_CRON_SECRET`):
     ```
     curl -fsS -m 55 -H "Authorization: Bearer YOUR_CRON_SECRET" https://coverageoncall.com/api/cron > /dev/null 2>&1
     ```
3. **Check it:** after a couple of minutes, open `https://coverageoncall.com/api/cron` in a browser. It should say **Unauthorized**. That means the endpoint is up and locked. The cron call itself returns a list of the jobs it ran.

**What each tick runs:**
- **Every minute:** offer windows, auto-selection deadlines, shift start and unfilled shifts, and invitation settlement.
- **Every 5, 15 or 60 minutes:** completions, payouts, lead emails and stats.
- **Nightly, 2:00 AM Eastern:** the credential sweep. The timing is computed in Eastern time, so your server's time zone doesn't matter.

## Step 9 — Connect Stripe, Dropbox Sign and Twilio

- **Stripe:** Developers → Webhooks → **Add endpoint**: `https://coverageoncall.com/api/webhooks/stripe`. Select these events:
  - `payment_intent.*`
  - `charge.refunded`
  - `charge.dispute.*`
  - `account.updated`
  - `transfer.*`
  - `setup_intent.succeeded`

  Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and restart the app.
- **Dropbox Sign:** API settings → callback URL: `https://coverageoncall.com/api/webhooks/esign`.
- **Twilio** (if used): Messaging Service → incoming message webhook: `https://coverageoncall.com/api/webhooks/twilio`.
- **SendGrid:** Settings → Sender Authentication → authenticate `coverageoncall.com`. Add the DNS records it gives you in Namecheap → Advanced DNS.

## Step 10 — Set up the business in Admin

1. **Rates:** the seeded prices and pay are **placeholders**. Set real clinic prices and provider pay for each Florida region.
2. **Settings:** review deposits, payout timing, cancellation fees and dispatch timing.
3. **States:** only **Florida chiropractic** is switched on. Enable more when you're ready to verify licences there.
4. **Promo codes:** create your launch codes. Each one gets a QR code and a landing page.
5. **Switched-off features:** `features.onCallEnabled` (On Call auto-booking) and `features.conversionFeeEnabled` stay **off** until your attorney has reviewed them.

## Step 11 — Redirect the old site on launch day

If coveragechiropractor.com is on the same cPanel:

1. Export leads and promo codes from the old PHP admin, then add them in Admin → Leads and Admin → Promo codes.
2. File Manager → the old site's folder → `.htaccess` → add at the very top:
   ```apache
   RewriteEngine On
   RewriteCond %{HTTP_HOST} ^(www\.)?coveragechiropractor\.com$ [NC]
   RewriteRule ^(.*)$ https://coverageoncall.com/chiropractic [R=301,L,QSA]
   ```
3. In Google Search Console, use Settings → **Change of address**. Keep the old domain registered and redirecting for at least 12 months.

---

## Updating to a new version

1. **Stop the app:** Setup Node.js App → **Stop App**.
2. **Upload the new code:** in File Manager, rename `coverageoncall` to `coverageoncall-old`. Upload and extract the new zip.
3. **Update the database, if needed:** if the release includes an `update-*.sql` file, run it in Neon's SQL Editor.
4. **Start the app:** **Start App**, then check the site. Your environment variables are kept, because they're stored with the app settings, not in the folder.
5. **Clean up:** once the site is working, delete `coverageoncall-old`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Missing required production env vars: …" in the log | Add the named variables and restart. |
| 503 / "Incomplete response received from application" | Open the log file shown in the Node.js App screen. Usually it's a wrong `DATABASE_URL`, or the Node.js version is below 20.9. |
| `Prisma Client could not locate the Query Engine` | The zip was built on the wrong system. Rebuild it on Linux x86-64 with `deploy/cpanel/build.sh`. |
| Offers never expire, payouts never go out | The cron job isn't running. Check the command, the secret, and that the cron isn't paused. Test by pasting the command into cPanel Terminal without `> /dev/null 2>&1`. |
| App restarts or gets killed under load | You've hit shared-hosting CPU or memory limits (cPanel → *Resource Usage*). Upgrade the plan or move to a VPS. |
| Admin lost their phone | In Neon SQL Editor: `UPDATE "User" SET "mfaEnabled"=false, "totpSecret"=NULL WHERE email='you@…';` |

## Limits of shared hosting, and when to move

- **Timing is to the minute.** Background jobs run once a minute rather than every 15 seconds. Same-day offer windows are 5 minutes, so this is fine at launch.
- **Resources are capped.** Shared plans limit memory and CPU. Busy days with many clinics posting at once may be slow.

When you outgrow shared hosting, the same code runs on a **Namecheap VPS** or on **Google Cloud** with an always-on worker; `INSTALL.md` covers Google Cloud.
