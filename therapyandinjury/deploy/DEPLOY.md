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

## First install (about 10 minutes)
1. **Create the app.** In cPanel, open **Setup Node.js App** and click **Create Application**.
   - **Node.js version:** the newest offered (18 or later; 20 or 22 is ideal)
   - **Application mode:** Production
   - **Application root:** `therapyandinjury`. This is a new folder in your home directory, **not** inside `public_html`.
   - **Application URL:** `therapyandinjury.com`
   - **Application startup file:** `app.js`
   - Click **Create**. You don't need to run "NPM Install", because there are no packages to install.
2. **Upload the files.** In **File Manager**, open the `therapyandinjury` folder (the application root), upload this zip, choose **Extract**, then delete the zip. If cPanel created a sample `app.js` when you made the app, let the extract overwrite it.
3. **Settings.** In the same folder, copy `config.example.json` to `config.json`, then edit it:
   - `mail.recipients`: the inbox that receives each location's appointment requests, e.g. `"ocala": "ocala@therapyandinjury.com"`. A location without an inbox shows "please call" on its form.
   - `mail.from`: a sending address on therapyandinjury.com. Create it in cPanel → Email Accounts, or use a forwarder.
   - Leave `adminPassword` empty. Set the password in step 4 instead.
4. **Admin password.** Back in **Setup Node.js App**, edit the app. Under **Environment variables**, add `ADMIN_PASSWORD` with a strong password of **at least 12 characters**. Save.
5. **Start.** Click **Restart**. The first start installs the package from `incoming/` automatically. Alternatively, run **Run JS script → install-release** and then restart.
6. **HTTPS.** In cPanel → **Domains**, turn on **Force HTTPS Redirect** for therapyandinjury.com, and check that **SSL/TLS Status** shows a valid AutoSSL certificate.
7. **Check it.** Visit `https://therapyandinjury.com/_health`. It should show `{"ok":true,"version":"…"}`. Then visit `https://therapyandinjury.com/_admin` and sign in with any username and your `ADMIN_PASSWORD`.

### City domains (ocalatherapyandinjury.com etc.)
Add each one in cPanel → **Domains** as a domain that **shares the document root** with therapyandinjury.com (older cPanel calls this an **Alias**). The app sends each city domain to its location page, for example `ocalatherapyandinjury.com` → `therapyandinjury.com/ocala/`. If your host doesn't route alias domains to the Node.js app, add a 301 redirect for that domain under cPanel → **Redirects** instead.

### Email deliverability
In cPanel → **Email Deliverability**, repair or enable **SPF** and **DKIM** for therapyandinjury.com, and add a DMARC record. Then send a test request from the Ocala page. The form sends through the server's mail system (sendmail/Exim), the same way PHP's `mail()` did.

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
- **The form says "please call"** means that location has no `mail.recipients` entry, or the sending failed (check the log for `[appointment] send failed`).
- **Old files still show:** keep the domain's document root (e.g. `public_html`) empty apart from the `.htaccess` that cPanel writes for the Node.js app. Apache serves any static file sitting there before the app sees the request.
