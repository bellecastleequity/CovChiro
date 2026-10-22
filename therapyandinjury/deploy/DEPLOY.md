# therapyandinjury.com on cPanel (Node.js)

The site runs as a Node.js app through cPanel's **Setup Node.js App** (Phusion Passenger). It has no dependencies: there is nothing to `npm install`. Every version installs side by side, so updates and rollbacks are one click.

## What's in this zip
| File | What it is |
|---|---|
| `app.js` | The app's startup file. It loads the active version. |
| `updater.js` | Installs, updates and rolls back versions. Also used by the `/_admin` page. |
| `package.json` | Scripts that cPanel shows under **Run JS script**: `install-release`, `update`, `check-update`, `rollback`, `status` |
| `config.example.json` | Settings template. Copy it to `config.json`. |
| `incoming/therapyandinjury-<version>.tar.gz` | The website release. It's installed automatically on the first start. |

Created as you go: `releases/` (installed versions), `current.json` (the active one), `content.json` (your content edits) and `content-backups/`.

## First install (about 10 minutes)
1. **Create the app.** In cPanel, open **Setup Node.js App** and click **Create Application**.
   - **Node.js version:** the newest offered (18 or later; 20 or 22 is ideal)
   - **Application mode:** Production
   - **Application root:** `therapyandinjury`. This is a new folder in your home directory, **not** inside `public_html`.
   - **Application URL:** `therapyandinjury.com`
   - **Application startup file:** `app.js`
   - Click **Create**. You don't need to run "NPM Install", because there are no packages to install.
2. **Upload the files.** In **File Manager**, open the `therapyandinjury` folder (the application root), upload this zip, choose **Extract**, then delete the zip. If cPanel created a sample `app.js` when you made the app, let the extract overwrite it.
3. **Settings (optional).** In the same folder, you can copy `config.example.json` to `config.json`, to change the sending address (`mail.from`, default `no-reply@therapyandinjury.com`) or to force a location's form inbox (`mail.recipients`). Normally, each location's **email in the content editor** receives its requests, and a location without one shows "please call". Leave `adminPassword` empty and set the password in step 4.
4. **Admin password.** Back in **Setup Node.js App**, edit the app. Under **Environment variables**, add `ADMIN_PASSWORD` with a strong password of **at least 12 characters**. Save.
5. **Start.** Click **Restart**. The first start installs the package from `incoming/` automatically. Alternatively, run **Run JS script → install-release** and then restart.
6. **HTTPS.** In cPanel → **Domains**, turn on **Force HTTPS Redirect** for therapyandinjury.com, and check that **SSL/TLS Status** shows a valid AutoSSL certificate.
7. **Check it.** Visit `https://therapyandinjury.com/_health`. It should show `{"ok":true,"version":"…"}`. Then visit `https://therapyandinjury.com/_admin` and sign in with any username and your `ADMIN_PASSWORD`.

### City domains (ocalatherapyandinjury.com etc.)
Add each one in cPanel → **Domains** as a domain that **shares the document root** with therapyandinjury.com (older cPanel calls this an **Alias**). The app sends each city domain to its location page, for example `ocalatherapyandinjury.com` → `therapyandinjury.com/ocala/`. If your host doesn't route alias domains to the Node.js app, add a 301 redirect for that domain under cPanel → **Redirects** instead.

### Email deliverability
In cPanel → **Email Deliverability**, repair or enable **SPF** and **DKIM** for therapyandinjury.com, and add a DMARC record. Then send a test request from the Ocala page. The form sends through the server's mail system (sendmail/Exim), the same way PHP's `mail()` did.

## Editing the website (no upload needed)
Open `https://therapyandinjury.com/_admin` and sign in. The **Content** tab edits everything that changes day to day:
- **Site:** main phone and email, YouTube, Instagram and Facebook links, the Carepatron booking, paperwork and portal links, the tagline, and the Google and Bing IDs
- **Videos:** the hero commercial on the home page and every location page. Paste a YouTube link to show that video, or keep the built-in 60-second spot.
- **Page text:** the form's consent line, FAQ answers, Privacy Policy details, and the "Yes, we work with your attorney" banner
- **Services:** each service's name, its short line on the home page, and its description on the Services page (replace the yellow "[LIST TECHNIQUES …]" parts), plus the "descriptions are approved" checkbox that hides the confirm notes
- **Each location:** open or coming soon, phone, **email** (appointment requests go there), address, **hours**, doctors, visit features, **languages spoken**, nearby areas, the Google Business Profile link, **map zoom**, city domains, and an optional video of its own

### Leads (front desk)
`/_admin` → **Leads** lists every website request (also emailed, as before) and every phone lead, newest first: name, phone, location, language, where they came from (ad campaign, Google, Facebook, direct…), and the 14-day window when an accident date was given. Red **call now** means a new lead has waited more than an hour.
- **Status** (change it from the list): New → Contacted → Booked → Showed → Became a patient, or Not a fit / No answer. Every change records who made it and when. **Details** shows the source, history and notes.
- **+ Phone lead**: log callers and walk-ins, and always ask "How did you hear about us?"
- **Match Carepatron export**: export patients from Carepatron as CSV and choose the file here. Leads whose phone number matches are marked "Became a patient". The file is only read, never stored.
- **Export CSV** downloads the list (it contains patients' contact details: keep it private).
- **Front desk logins**: the owner adds them under **Team**. A front desk login sees only the Leads tab. The owner (ADMIN_PASSWORD) sees everything.
- **Reports** (owner): leads, booked, showed and new patients by channel, campaign, language and location, call-button taps, and cost per lead / per new patient from the monthly ad spend you enter. Tag every ad link as in `marketing/utm-links.md`.
- **Privacy**: leads are stored encrypted in `leads/leads.enc` in the app folder (key in `leads/key`; daily encrypted backups, 14 kept). Nothing goes to ad platforms. Don't download or share the `leads` folder; include it in your own cPanel backups. For a key kept outside the app folder, set the environment variable `LEADS_KEY` (64 hex characters) before the first lead arrives.

### Referral-partner outreach (SendGrid email campaigns)
`/_admin` → **Outreach** (owner only) emails local personal-injury attorneys, urgent care centers, hospitals, primary care, imaging centers and specialists, and tracks what happens. It is for **professional offices only**, never patients or accident victims (Florida §817.234(8)).

**One-time setup (about 20 minutes):**
1. **SendGrid account → Settings → Sender Authentication → Authenticate Your Domain** for therapyandinjury.com. SendGrid shows 3 CNAME records: add them in cPanel → **Zone Editor**, then click Verify in SendGrid. Without this, emails land in spam.
2. **SendGrid → Settings → API Keys → Create API Key** → *Restricted Access* → **Mail Send: Full Access** → copy the key (starts with `SG.`). In `/_admin` → Outreach → **Settings**, paste it under SendGrid and click **Save keys**. (Or set the environment variable `SENDGRID_API_KEY` in cPanel → Setup Node.js App and restart.)
3. Same page, **Sender**: From email (e.g. `outreach@therapyandinjury.com`), From name, **Replies go to** (an inbox someone reads daily), your name, title and phone for the signature, and the practice's **mailing address** (required by law in every email). Save.
4. **Tracking: SendGrid → Settings → Mail Settings → Event Webhook** → HTTP Post URL: copy the **Event webhook URL** from Outreach → Settings. Tick Delivered, Opened, Clicked, Bounced, Dropped, Deferred, Spam reports, Unsubscribes. Optional but recommended: turn on **Signed Event Webhook**, copy the verification key into Outreach → Settings and Save keys. Then **Test Your Integration** in SendGrid.
5. **cPanel → Cron Jobs**: add the command shown in Outreach → Settings, every 15 minutes. (The app also sends every 5 minutes while it's running, but cPanel stops a quiet app; the cron job keeps campaigns on schedule.)

**Using it:**
- **Contacts**: import `marketing/referral-outreach/contacts.csv` (27 Ocala offices) or any sheet with columns like type, name, email, phone. Add emails as you get them (call the office first and ask who handles provider relationships). Use **tags** (e.g. `ocala`, `spanish`) to target a campaign.
- **Campaigns**: three starter sequences are ready as drafts (attorneys, urgent care/hospitals/primary care, imaging centers). Edit the wording, click **Preview** and **Send me a test**, then **Start**. Matching contacts with an email are enrolled, and new matching contacts join on their own. Emails go out on weekdays inside the send window, up to the daily limit, never two to the same office within 3 days.
- **A sequence stops** when the office unsubscribes, bounces or reports spam (automatic), or when you set the contact to **Replied**, **Active partner**, **Not interested** or **Do not contact**. Replies arrive in the "Replies go to" inbox: mark the contact **Replied** so the follow-ups stop.
- **Results**: each campaign shows sent, delivered, opened, clicked, replied, bounced, unsubscribed, and **referred leads / patients**. When a caller says a doctor, urgent care, hospital, imaging center or attorney sent them, the front desk picks that answer under *How did you hear about us?* and chooses the office under **Referred by**. Reports → **By referring office** lists them.
- **Rules**: never offer or give anything of value for referrals (no gifts, gift cards, referral fees, or meals tied to referrals; Florida §817.505 and §456.054). Every email carries the mailing address and an unsubscribe link, and unsubscribes are permanent (CAN-SPAM). Don't buy email lists.
- **Storage**: `outreach/outreach.json` (contacts, campaigns, sent emails) and `outreach/secret.json` (keys) in the app folder. Updates never touch them; include them in your cPanel backups.

### Spanish and Haitian Creole pages
`/es/` (Español) and `/ht/` (Kreyòl ayisyen) are full landing pages with their own commercial and jingle. The flag button in the header switches between English, Español and Kreyòl. They use the same location facts as the English pages (address, hours, phone, email), so editor changes show in all three. Requests sent from them arrive by email marked with the language ("— Spanish" in the subject).
- To show **"Se habla español"** or **"Nou pale kreyòl"**, add `Español` or `Kreyòl` under that location's **Languages spoken**. Leave them off until someone on staff speaks the language.
- The Spanish and Creole wording is built into the release (ask for changes in the next update). Have a native speaker on staff read both pages before you advertise them.

Click **Save** and the change is live on the next page view. Yellow fields are placeholders still to fill in, and the counter shows how many are left. Every save keeps the previous version under **Saved versions**, with one-click restore.

Edits are stored in `content.json` in the app folder. Updates never touch it.

## Updating the site later
Each release is a `therapyandinjury-<version>.tar.gz` file. To build one on your computer: `npm run release -- 1.0.1` (it lands in `deploy/out/`).

**Easiest:** open `https://therapyandinjury.com/_admin`, choose the file, and click **Upload & install**. The new version installs next to the old one and goes live on the next page view. To undo, click **Roll back to previous** (or **Activate** on any listed version).

**Without the admin page:** upload the `.tar.gz` (and its `.sha256`) into `therapyandinjury/incoming/`, then use **Setup Node.js App → Run JS script → install-release**. To undo, run **rollback**.

**Automatic source (optional):** in `config.json`, set either of these. The admin page then shows **Check for updates** and **Install latest**, and the **update** script does the same.
- **GitHub releases:** `"update": { "github": { "repo": "owner/name" } }`, plus the environment variable `GITHUB_TOKEN` (a fine-grained token with read-only "Contents" access) for a private repo. Attach `therapyandinjury-<version>.tar.gz` and its `.sha256` file to each GitHub release.
- **Any HTTPS host:** `"update": { "manifestUrl": "https://…/latest.json" }`, pointing at the `latest.json` written next to each build (set its `url`).

Every package is checked (its checksum when a `.sha256` is present, its structure, and its version) before anything changes. `config.json` is never touched by an update. The last 4 versions stay installed.

## Troubleshooting
- **"The site is being set up. Please call…"** means nothing is installed yet. Run **install-release**, or check that `incoming/` holds a package.
- **`/_admin` shows "Not found"** means `ADMIN_PASSWORD` is missing or shorter than 12 characters. Restart after setting it.
- **Error messages** are in the app's log. CloudLinux puts it in the application root as `stderr.log`. Otherwise, check cPanel → **Errors**.
- **The form says "please call"** means that location has no email in the content editor, or the sending failed (check the log for `[appointment] send failed`).
- **The content editor says the page renderer isn't running** means the site is serving its safety snapshot. Check the log, then re-install or roll back the release.
- **Uploading at /_admin shows "HTTP 400"** (versions before 1.0.8 send the package in one piece, which some hosts refuse once it passes about 10 MB): install that one version by hand. In File Manager, upload the `.tar.gz` (and its `.sha256`) into `therapyandinjury/incoming/`, then use **Setup Node.js App → Run JS script → install-release**, then **Restart**. From 1.0.8 on, the admin page uploads in 2 MB pieces.
- **Old files still show:** keep the domain's document root (e.g. `public_html`) empty apart from the `.htaccess` that cPanel writes for the Node.js app. Apache serves any static file sitting there before the app sees the request.
