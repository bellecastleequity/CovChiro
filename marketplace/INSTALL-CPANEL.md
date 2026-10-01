# Install on Namecheap cPanel

This guide installs CoverageOnCall on a Namecheap shared hosting plan through cPanel. You don't need SSH or the command line.

## How the pieces fit

| Piece | Where it runs | Why |
|---|---|---|
| Website | cPanel → **Setup Node.js App** | Namecheap's cPanel runs Node.js apps. |
| Database | **Neon** (hosted Postgres) | See below. |
| Background jobs | cPanel → **Cron Jobs**, once a minute | See below. |
| Uploaded files | `coverageoncall.com/uploads` on your hosting | Licences, insurance certificates and photos stay on your hosting account, in a folder the web can't reach. |
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
coverageoncall.com/          ← goes in your home folder, like your other sites
  app/                       ← the application root (apps/, package.json)
  node_modules/              ← the app's libraries (must stay OUTSIDE app/, see Step 5)
  public/                    ← empty; becomes the domain's web folder (Step 3)
  uploads/                   ← uploaded documents; never web-reachable
database-setup.sql           ← paste into Neon once, then delete
environment-variables.txt    ← the settings to enter in cPanel
INSTALL-CPANEL.md            ← this guide
```

If you received it as **three parts** (`coverageoncall-cpanel-part1.zip`, `-part2.zip` and `-part3.zip`), treat them as one package. In Step 3, upload all three to the same folder and **Extract each one there**. They fill in the same `coverageoncall.com` folder, and the site needs all three.

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

**Neon cost:** the cron job wakes the database every few minutes, so it effectively runs 24/7. That may exceed Neon's free allowance. Budget for its entry paid plan and check current prices at https://neon.tech/pricing.

## Step 3 — Upload the app and point the domain at its `public` folder

On cPanel, the folder a domain points at (its **document root**) is public: anything in it can be downloaded by URL. That's how PHP sites work, but this app's program files must not be downloadable. So the app lives in `coverageoncall.com/`, and the domain points only at the empty `coverageoncall.com/public/` inside it. The app answers every web request itself.

1. **Upload:** cPanel → **File Manager** → your **home folder** (the one that *contains* `public_html`). Upload the zip file(s) there, then right-click each one and choose **Extract**.
2. **Check the layout:** you should now have `coverageoncall.com/` containing `app`, `node_modules`, `public` and `uploads`.
   - If you'd already extracted into `coverageoncall.com` by hand, make sure those items sit **directly** inside it, not in a nested `coverageoncall/` or `coverageoncall.com/coverageoncall.com/` folder.
   - `database-setup.sql`, `environment-variables.txt` and `INSTALL-CPANEL.md` should be **outside** the `coverageoncall.com` folder. If they ended up inside it, move them out or delete them once you've used them.
3. **Point the domain at `public`:** cPanel → **Domains** → next to `coverageoncall.com`, click **Manage**. Set **Document Root** to `coverageoncall.com/public` and save.
   - If `coverageoncall.com` isn't added yet, click **Create A New Domain**, enter `coverageoncall.com`, untick "Share document root", and enter `coverageoncall.com/public` as the document root.
   - If your cPanel won't let you change the document root, ask Namecheap support to set it, or use a folder name that isn't the domain's web folder (for example `coverageoncall-app`) as the application root in Step 5.

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
| Application root | `coverageoncall.com/app` |
| Application URL | `coverageoncall.com`. The domain must already be added in cPanel, as an addon domain or the main domain. |
| Application startup file | `apps/web/server.js` |

Scroll to **Environment variables** and add each line from `environment-variables.txt`:

- **Database:** set `DATABASE_URL` to the Neon string from Step 2. If it ends in `&channel_binding=require`, delete that part.
- **Node options:** add `NODE_OPTIONS` = `--disable-wasm-trap-handler`. CloudLinux caps each process at 4 GB of virtual memory. Without this setting, Node's built-in web client (used for the database connection, email and maps) can't start its WebAssembly part and fails with "Out of memory".
- **Memory arenas:** add `MALLOC_ARENA_MAX` = `2`. Each thread of the database engine otherwise reserves its own 64 MB of memory space, and on a server with many CPU cores that adds up past CloudLinux's 4 GB cap. The symptom is "JavaScript heap out of memory" even though the app is using very little memory.
- **Database engine:** add `PRISMA_QUERY_ENGINE_LIBRARY` = `/home/YOUR_CPANEL_USERNAME/coverageoncall.com/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node`. CloudLinux hides the system details Prisma uses to pick its engine file, so this names the file directly. On CloudLinux 9, use the `rhel-openssl-3.0.x` file instead; if you're unsure, `dbcheck` prints the exact value to use.
- **Database transport:** add `DATABASE_TRANSPORT` = `websocket`. Namecheap's firewall blocks the normal database port (5432), so the app connects to Neon over port 443 instead.
- **Secrets:** use the three values from Step 4.
- **Uploads:** set `UPLOAD_DIR` to `/home/YOUR_CPANEL_USERNAME/coverageoncall.com/uploads`. Your username is shown in cPanel's right-hand sidebar.
- **Service keys:** add your Stripe, SendGrid and Google Maps keys, plus your Dropbox Sign keys if you have them.
- **No Dropbox Sign yet?** Add `ESIGN_TEST_MODE` = `true`. Providers and clinics can then click-sign a clearly labelled **test** agreement, so sign-up can be tested end to end. When you connect Dropbox Sign later, add the three `ESIGN_…` keys and delete `ESIGN_TEST_MODE`. When the attorney-reviewed agreement goes live as a new version, everyone is asked to sign it again.

Click **Create**, then **Start App**.

- **Why `app` and not `coverageoncall.com`:** CloudLinux doesn't allow a `node_modules` folder inside the application root, because it reserves that name for its own link. The app's libraries sit one level up, in `coverageoncall.com/node_modules`, where Node.js still finds them. Never click **Run NPM Install**.

- **Check the document root is private:** visit `https://coverageoncall.com/package.json`. You should get the site's "page not found" page, not a file download. If the file downloads, the document root is still pointing at the app folder; go back to Step 3.3.

- **Don't click "Run NPM Install".** The package already contains everything.
- **If the app won't start:** the site refuses to start when a required key is missing, and the log names the missing one. Open the app's log file, whose path is shown in the Node.js App screen (look for `stderr.log` or the "Passenger log file" field), add the missing variable, and click **Restart**.

## Step 6 — Turn on HTTPS

Namecheap issues certificates through its own tool; cPanel's AutoSSL isn't available on its shared plans.

1. **DNS first:** in Namecheap → Domain List → coverageoncall.com → **Nameservers**, choose **Namecheap Web Hosting DNS**. BasicDNS has no records pointing at your hosting. Allow up to a few hours for the change to spread.
2. **Install the certificate:** cPanel → **Namecheap SSL**, find coverageoncall.com, and install it (free with the hosting). Click **Sync** to refresh the status until it shows **Active**.
3. **If it's still pending after a few hours:** validation is failing.
   - **Check the redirect:** if the `.htaccess` in your home folder forces HTTPS, add `RewriteCond %{REQUEST_URI} !^/\.well-known/` just before its redirect rule, so validation checks can use plain HTTP.
   - **Or ask Namecheap:** live chat can switch validation to DNS (CNAME) or complete it for you.

**Signing in needs HTTPS.** The sign-in cookie is HTTPS-only, so on `http://` the login page accepts your password and then sends you straight back to the login page. Wait for the certificate before signing in.

## Step 7 — Create your admin account

1. Visit **https://coverageoncall.com/setup**.
2. Enter the `SETUP_TOKEN`, your name, email and a password of at least 12 characters. This also loads the starting setup: professions, all states, Florida regions and placeholder rates.
3. Sign in at `/login`. You'll be asked to scan a QR code with an authenticator app (Google Authenticator, Authy or 1Password). This two-step sign-in is required for admins.
4. Back in **Setup Node.js App**, delete the `SETUP_TOKEN` variable and click **Restart**. The `/setup` page is already disabled once an admin exists; removing the token closes it completely.

## Step 8 — Schedule the background jobs

cPanel → **Cron Jobs**:

1. **Cron email:** clear the box, otherwise you'll get an email every run.
2. **Add New Cron Job:**
   - **Common settings:** *Once Per Five Minutes (\*/5 \* \* \* \*)*. Namecheap doesn't allow cron jobs more often than every 5 minutes, and rejects `* * * * *`.
   - **Command** (replace `YOUR_CRON_SECRET`):
     ```
     curl -fsS -m 55 -H "Authorization: Bearer YOUR_CRON_SECRET" https://coverageoncall.com/api/cron > /dev/null 2>&1
     ```
3. **Check it:** after a couple of minutes, open `https://coverageoncall.com/api/cron` in a browser. It should say **Unauthorized**. That means the endpoint is up and locked. The cron call itself returns a list of the jobs it ran.

**What each tick runs:**
- **Every tick (every 5 minutes on Namecheap):** offer windows, auto-selection deadlines, shift start and unfilled shifts, and invitation settlement. Time-sensitive steps can run up to about 5 minutes late. Hosting with a 1-minute scheduler (such as Google Cloud) tightens that.
- **Every 5, 15 or 60 minutes:** completions, payouts, lead emails and stats.
- **Nightly, 2:00 AM Eastern:** the credential sweep. The timing is computed in Eastern time, so your server's time zone doesn't matter.

**If the site freezes with "cagefs_enter: Unable to fork" / 500 errors:** the hosting account hit its process or memory limit (cPanel → Resource Usage shows the faults). Disable the cron job (put `#` in front of the command), wait 5–10 minutes for running requests to finish, then restart the app in **Setup Node.js App**. If the Node.js page won't load, rename the `app` folder in File Manager for a few minutes (the app can't start without it), rename it back and restart; or ask Namecheap support to kill your account's processes. Background AI jobs (Growth agents, prospecting research, blog drafts) run without holding the cron request open, and a job that's still running is skipped by the next tick, so ticks don't pile up.

## Step 9 — Connect Stripe, Dropbox Sign and Twilio

- **Stripe:**
  Create **two destinations** in Stripe → Developers → Webhooks → **Add destination**, both pointing at the same URL, `https://coverageoncall.com/api/webhooks/stripe`:

  | Destination | Event destination scope | Events to select |
  |---|---|---|
  | 1 | **Your account** | `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `checkout.session.completed`, `transfer.reversed` |
  | 2 | **Connected accounts** | `account.updated` (providers' payout accounts becoming ready, or being restricted, after Stripe verifies them) |

  For each one: keep the default API version, click **Continue**, choose **Webhook endpoint**, and paste the URL. Then open the destination and reveal its **Signing secret** (`whsec_…`).
  - Put **both** secrets into `STRIPE_WEBHOOK_SECRET`, separated by a comma: `whsec_AAA,whsec_BBB`.
  - Restart the app.
- **Dropbox Sign:** API settings → callback URL: `https://coverageoncall.com/api/webhooks/esign`.
- **Twilio** (if used): Messaging Service → incoming message webhook: `https://coverageoncall.com/api/webhooks/twilio`.
- **Google Maps:** in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services, enable **Geocoding API**, **Time Zone API**, **Routes API**, **Maps JavaScript API** and **Places API (New)**. Billing must be on for the project. Then make two keys under **Credentials**:

  | Variable | Application restriction | API restriction |
  |---|---|---|
  | `GOOGLE_MAPS_API_KEY` | **None** (the server calls Google, and it has no website to match; a "Websites" restriction makes every address fail) | Geocoding API, Time Zone API, Routes API |
  | `GOOGLE_MAPS_BROWSER_KEY` | **Websites**: `https://coverageoncall.com/*` and `https://www.coverageoncall.com/*` | Maps JavaScript API, Places API (New) |

  The browser key is visible in the page, which is why it's locked to your domain. Without it, address fields still work, just without suggestions.
- **Cloudflare Turnstile (spam protection, optional):** dash.cloudflare.com → Turnstile → Add widget (hostnames `coverageoncall.com` and `www.coverageoncall.com`, mode Managed). Put the Site Key in `TURNSTILE_SITE_KEY` and the Secret Key in `TURNSTILE_SECRET_KEY`, then restart. Without them the public forms still work; the spam rules still run.
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

Each release comes as **`coverageoncall-update.zip`** (the code only) plus any **`update-NNN-….sql`** files that are new in that release. SQL files from earlier releases are never sent again.

0. **Make a restore point:** Admin → **Backups & restore** → **Create restore point** (or **Back up now** if Neon isn't connected yet).
1. **Stop the app:** Setup Node.js App → **Stop App**.
2. **Keep the old version for rollback:** in File Manager, open `coverageoncall.com`, delete any old **`app-previous`** folder, then **rename `app` to `app-previous`**. If the release includes part 2, do the same for `node_modules` (→ `node_modules-previous`). Leave `public` and `uploads` alone.
3. **Add the new code:** upload the zip(s) to your home folder and **Extract** them there.
4. **Update the database, if the release includes SQL files:** run each one in number order in Neon's SQL Editor. They're safe to run again if you aren't sure.
5. **Start the app:** **Start App**, then check the site. Your environment variables are kept.
6. **Clean up:** delete the uploaded zips from your home folder.

**Something wrong after an update?** Roll back the code: Stop App → rename `app` to `app-broken` and `app-previous` to `app` (same for `node_modules` if you swapped it) → Start App. Database updates only add tables and columns, so the previous code runs on the newer database. If data itself went wrong, rewind it in Admin → **Backups & restore** (or Neon console → Branches → main → **Restore**).

### Backups

- Every night (3:10 am ET) the whole database is exported, encrypted with `BACKUP_KEY` (or, if unset, a key made from `SESSION_SECRET`: keep a copy of that value somewhere safe) and kept in the `uploads` storage: 14 daily, 8 weekly, 12 monthly. Download them from Admin → Backups. To load one into a fresh database: `packages/db/scripts/restore-backup.ts` (instructions at the top of the file).
- **Connect Neon** for restore points and one-click "restore to a time": Neon console → Account settings → **API keys** → create one; your project → Settings → copy the **Project ID**; add `NEON_API_KEY` and `NEON_PROJECT_ID` in Setup Node.js App → Environment variables, Save, Restart. How far back you can rewind depends on your Neon plan (Admin → Backups shows it).

The full three-part package is only needed for a brand-new install (or if a release note says so, e.g. after a Prisma upgrade).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Missing required production env vars: …" in the log | Add the named variables and restart. |
| "FATAL ERROR … JavaScript heap out of memory" or exit code -6 | Add `MALLOC_ARENA_MAX` = `2` and restart. |
| dbcheck says "ENGINE NOT FOUND" | Add the `PRISMA_QUERY_ENGINE_LIBRARY` line that dbcheck prints, and restart. |
| "WebAssembly … Out of memory" in dbcheck or the log | Add `NODE_OPTIONS` = `--disable-wasm-trap-handler` and restart. |
| Home page shows "This page couldn't load" but `/login` works | The app can't reach the database. In Setup Node.js App → Run JS script, run **dbcheck**. It explains the problem in plain English (blocked port, wrong password, wrong database). |
| 503 / "Incomplete response received from application" | Open the log file shown in the Node.js App screen. Usually it's a wrong `DATABASE_URL`, or the Node.js version is below 20.9. |
| `Prisma Client could not locate the Query Engine` | The zip was built on the wrong system. Rebuild it on Linux x86-64 with `deploy/cpanel/build.sh`. |
| Offers never expire, payouts never go out | The cron job isn't running. Check the command, the secret, and that the cron isn't paused. Test by pasting the command into cPanel Terminal without `> /dev/null 2>&1`. |
| App restarts or gets killed under load | You've hit shared-hosting CPU or memory limits (cPanel → *Resource Usage*). Upgrade the plan or move to a VPS. |
| "Address lookup isn't working right now (Google Geocoding REQUEST_DENIED …)" | The server key can't use the Geocoding API. Check in Google Cloud: the API is enabled, billing is on, and `GOOGLE_MAPS_API_KEY` has **no** website restriction. The message shows Google's own reason. |
| Forms say “Please complete the verify you're human check” for everyone | The Turnstile Site Key and Secret Key don't belong to the same widget, or the widget's hostnames don't include your domain. Re-copy both from Cloudflare → Turnstile and restart. |
| No suggestions appear under address fields | `GOOGLE_MAPS_BROWSER_KEY` is missing, or it isn't allowed for your domain / Maps JavaScript API / Places API (New). Your browser's console shows Google's error. |
| Signup confirmation (or any) email never arrives | Sign in as admin → **Settings** → **Email check** → **Send test email**. It shows SendGrid's exact reply. "does not match a verified Sender Identity" means the sending domain isn't authenticated yet: SendGrid → Settings → Sender Authentication → authenticate `coverageoncall.com`, add its DNS records in Namecheap → Advanced DNS, wait for SendGrid to show "Verified", then try again. "401" / "permission" means `SENDGRID_API_KEY` is wrong or lacks Mail Send access. Providers can then use **Resend confirmation email** on their dashboard. |
| Admin lost their phone | In Neon SQL Editor: `UPDATE "User" SET "mfaEnabled"=false, "totpSecret"=NULL WHERE email='you@…';` |

## Limits of shared hosting, and when to move

- **Timing is to the minute.** Background jobs run once a minute rather than every 15 seconds. Same-day offer windows are 5 minutes, so this is fine at launch.
- **Resources are capped.** Shared plans limit memory and CPU. Busy days with many clinics posting at once may be slow.

When you outgrow shared hosting, the same code runs on a **Namecheap VPS** or on **Google Cloud** with an always-on worker; `INSTALL.md` covers Google Cloud.
