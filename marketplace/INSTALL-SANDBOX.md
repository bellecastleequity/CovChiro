# Test site (dev.coverageoncall.com)

A second copy of CoverageOnCall where you can try everything without touching the live site. It has its own database, its own folder and its own address. It's filled with demo clinics, providers and shifts, and keeps at least 37 days of shifts ahead.

- **Nothing is real:**
  - No money moves.
  - Emails and texts are kept in an in-app **Test outbox** instead of being sent.
  - The site is hidden from Google and AI search.
  - An amber **TEST SITE** bar is on every page.
- **Your two test accounts:** "Sandbox Family Chiropractic" (a clinic) and "Dr. Sam Tester" (a provider). You drive them yourself.
- **The bots:** every other demo clinic and provider is a "bot" that reacts the way a person would, a few minutes later.
  - Bot providers apply to your clinic's shifts, accept invitations and changes, tap On my way, clock in and out, and enter visit counts.
  - Bot clinics pick you when you apply, sign timesheets, confirm counts, rate, and reply to messages.
- **Same code as the live site:** the test site runs the same release files (part1–3). The setting `SANDBOX_MODE=1` makes it the test site.

The steps match INSTALL-CPANEL.md, with a different folder, database and settings. Allow about 30 minutes, plus the time the demo data takes to build.

## 1. Create a separate, empty database

The test site must never use the live database. In Neon:

1. In the same project as the live site, open **Databases → New database**:
   - **Name:** `coverageoncall_dev`
   - **Owner:** the same as the live database
   - Same branch.

   (Or create a separate Neon project if you prefer.)
2. Open **SQL Editor** and switch the database dropdown to `coverageoncall_dev`. Make sure it says `coverageoncall_dev`, not the live database. Paste all of `database-setup.sql` (sent with this release) and click **Run**.
3. Copy the connection string, with pooling OFF, and change the database name at the end to `/coverageoncall_dev?sslmode=require`. This is the test site's `DATABASE_URL`.

The test site also checks this for you: it refuses to build demo data in a database that already has real clinic or provider logins.

## 2. Make the subdomain and upload the files

1. In cPanel, go to **Domains → Create A New Domain**:
   - **Domain:** `dev.coverageoncall.com`
   - Untick "Share document root".
   - **Document root:** `dev.coverageoncall.com/public`
2. In **File Manager**, make a folder `dev.coverageoncall.com` in your home folder.
3. Upload `coverageoncall-update-part1.zip`, `part2.zip` and `part3.zip` into that folder, and **Extract** each one there. You should end up with `dev.coverageoncall.com/app` and `dev.coverageoncall.com/node_modules`.
4. In the same folder, make empty folders named `public` and `uploads`.
5. **Namecheap SSL:** install the certificate for `dev.coverageoncall.com`, the same way as for the main domain.

## 3. Create the Node.js app

Go to **Setup Node.js App → Create Application**. Use the same values as the live app, except:

| Field | Value |
|---|---|
| Application root | `dev.coverageoncall.com/app` |
| Application URL | `dev.coverageoncall.com` |
| Application startup file | `apps/web/server.js` |

**Environment variables:** copy the live app's, then change these:

| Name | Value |
|---|---|
| `SANDBOX_MODE` | `1` |
| `DATABASE_URL` | the `coverageoncall_dev` string from step 1 |
| `APP_BASE_URL` | `https://dev.coverageoncall.com` |
| `UPLOAD_DIR` | `/home/YOUR_CPANEL_USER/dev.coverageoncall.com/uploads` |
| `PRISMA_QUERY_ENGINE_LIBRARY` | same as live, with `dev.coverageoncall.com` in the path |
| `SESSION_SECRET`, `CRON_SECRET`, `SETUP_TOKEN` | **new** random values, not the live ones. Letters and digits only: a `$` or `%` in the cron line gets changed by the shell. |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | your Stripe **test** keys (`sk_test_…` / `pk_test_…`), or delete both to use the built-in stand-in. The test site refuses to start with live keys. |
| `STRIPE_WEBHOOK_SECRET` | delete it, or use a test-mode webhook pointing at `https://dev.coverageoncall.com/api/webhooks/stripe` |
| `SANDBOX_EMAIL_ALLOW` | optional: your own address(es), comma separated. Emails to them are really delivered, with "[TEST]" in the subject. Everything else stays in the Test outbox. |
| `SANDBOX_SMS_ALLOW` | optional: your mobile number (+1…) to receive real texts (needs the Twilio keys) |

Make sure `TOKIO_WORKER_THREADS` = `1` and `UV_THREADPOOL_SIZE` = `2` are set (on the live app too). Two apps on one hosting account share its process limit, and these keep each app's thread count low. When you're not using the test site for a while, **Stop App** it in Setup Node.js App (its cron job then just fails quietly); start it again when you need it.

Delete `NEON_API_KEY`, `NEON_PROJECT_ID` and `NEON_BRANCH_ID` if you copied them. The test site ignores them anyway, so its restore buttons can never touch the live database.

Then click **Create** and **Start App**.

## 4. Admin account, background jobs, demo data

1. Visit `https://dev.coverageoncall.com/setup` and create your admin with the test site's `SETUP_TOKEN`. You can use the same email as on the live site; they're separate databases. Set up two-step sign-in, then remove `SETUP_TOKEN` and restart.
2. In **Cron Jobs**, add a second job like the live one (every 5 minutes), with the test site's address and `CRON_SECRET`:
   ```
   curl -fsS -m 55 -H "Authorization: Bearer TEST_SITE_CRON_SECRET" https://dev.coverageoncall.com/api/cron > /dev/null 2>&1
   ```
3. Optional third-party keys:
   - **Cloudflare Turnstile:** add `dev.coverageoncall.com` to the widget's hostnames.
   - **Google Maps browser key:** add `dev.coverageoncall.com/*` to its allowed websites.
   Check it: open `https://dev.coverageoncall.com/api/cron` in a browser. **Unauthorized** = ready. **Not found** = `CRON_SECRET` is missing on the test app (or shorter than 16 characters), and the demo build will stall.
4. Sign in and open **Admin → Test site**. Type `RESET` and click **Build demo data**. The page shows progress, and it takes 15 to 30 minutes. While it runs, the test site's other background jobs wait.

## Using it

- **Be the clinic or the provider:** on Admin → Test site, click **Be the clinic** or **Be the provider**. The amber bar's **Back to admin** returns you.
  - To be both at once, sign in from a private window with the demo email and the password shown on that page.
- **Any demo account:** the list on that page has an **Act as** button for every login. Examples:
  - a provider whose license is waiting for review
  - a student
  - a clinic with no card on file
  - a clinic staff member
- **Emails and texts:** see **Test outbox** on the same page. Filter it by address, for example `provider.you`. Phone verification codes are in there too.
- **Payments:**
  - Demo accounts are charged and paid by a built-in stand-in.
  - With Stripe test keys, a clinic or provider you sign up yourself goes through Stripe's real test pages. Use card `4242 4242 4242 4242`, any future date and any CVC. Bank details are on Stripe's test page.
- **Shifts ahead:** every Sunday from 6 PM Eastern, the site adds shifts so there are always 37 days ahead. Each clinic gets its usual weekly need, and your two accounts get new bookings and invitations. **Top up shifts now** does the same at any time.
- **Start over:** use **Rebuild demo data** (type `RESET`). Admin logins and Settings stay.

## Updating the test site

When a release ships, install it here first, the same way as on the live site:

1. Stop App.
2. Swap `app`, and `node_modules` when parts 2 and 3 ship.
3. Run any new `update-NNN` SQL in **`coverageoncall_dev`**.
4. Start App.

Try it on the test site, then install it on the live site.
