# Coverage Chiropractic — Installation Guide (Phase A)
## Namecheap cPanel Setup

This reflects what's actually been built: **real accounts, real office-coverage
bookings, real Stripe payments (deposit + balance), real email confirmations,
and a real admin blackout-date calendar.** Standing-day agreements, flex-rate
dates, promo codes, video-interview requests, and the analytics dashboard are
Phase B — those forms on the site currently send a real email to you instead
of "saving" anywhere, so nothing is silently lost.

---

## STEP 1: DATABASE SETUP

1. Log into cPanel (`https://coveragechiropractor.com:2083`, or via your Namecheap dashboard).
2. **MySQL Databases** → **Create New Database**
   - Name it `[cpanel_username]_coverage`
3. **MySQL Users** → **Create New User** — generate a strong password and save it.
4. **Add User to Database** with **ALL PRIVILEGES**.
5. Open **phpMyAdmin**, select the new database, **Import** tab, upload
   `database_setup.sql` from this package, click **Go**.
   - You should see 12 tables created (`users`, `bookings`, `payments`,
     `blackout_dates`, `payment_reminders`, plus Phase B tables reserved for later).

---

## STEP 2: FILE STRUCTURE

Keep `php_backend/` **outside** `public_html` — it holds your database
credentials, Stripe secret key, and SendGrid key, and must never be web-reachable.

```
/home/[username]/
├── public_html/
│   ├── index.html                 (main site)
│   ├── ime-services.html          (legal/IME page, linked from the footer)
│   ├── .htaccess                  (forces HTTPS, blocks directory listing)
│   └── api/
│       ├── auth.php               (register / login / logout / session)
│       ├── booking.php            (create/list/cancel/review/feedback + admin)
│       ├── payment.php            (Stripe PaymentIntent create/confirm)
│       └── stripe_webhook.php     (Stripe webhook safety net)
│
├── php_backend/                   (NOT inside public_html)
│   ├── config.php                 (EDIT WITH YOUR REAL CREDENTIALS — see Step 3)
│   ├── composer.json
│   ├── database_setup.sql
│   ├── cron/payment_reminders.php
│   ├── logs/                      (auto-created; needs to be writable)
│   └── vendor/                    (created by `composer install`)
```

1. Upload `public_html/*` into your existing `public_html/`.
2. Create `/home/[username]/php_backend/` and upload everything from this
   package's `php_backend/` folder into it.

## STEP 3: INSTALL COMPOSER DEPENDENCIES

Via cPanel **Terminal** (or SSH):

```bash
cd /home/[username]/php_backend
composer install
```

This installs `stripe/stripe-php` and `sendgrid/sendgrid` into `vendor/`.
If Composer isn't available, cPanel → **Setup Node.js/Software** usually has
it, or ask Namecheap support to enable it.

## STEP 4: EDIT `php_backend/config.php`

Open it in cPanel File Manager and fill in:

```php
define('DB_USER', '[cpanel_username]_dbuser');
define('DB_PASSWORD', 'the password you set in Step 1');
define('DB_NAME', '[cpanel_username]_coverage');

define('STRIPE_SECRET_KEY', 'sk_live_...');       // https://dashboard.stripe.com/apikeys
define('STRIPE_PUBLISHABLE_KEY', 'pk_live_...');
define('STRIPE_WEBHOOK_SECRET', 'whsec_...');     // from Step 6 below

define('SENDGRID_API_KEY', 'SG...');              // https://app.sendgrid.com/settings/api_keys
```

Everything else (rates, mileage tiers, discount rules) already matches the
site's published pricing — no changes needed there.

**Start with Stripe test keys (`sk_test_...` / `pk_test_...`)** and do a full
test booking with a [Stripe test card](https://stripe.com/docs/testing) before
switching to live keys.

## STEP 5: VERIFY HTTPS

The site now requires HTTPS (it forces a redirect, and the login session
cookie is marked secure). Confirm your SSL certificate is active in cPanel →
**SSL/TLS Status** before testing.

## STEP 6: STRIPE WEBHOOK (recommended safety net)

Without this, a payment can succeed on Stripe's side but not get recorded if
the customer's browser closes before the confirmation call completes — rare,
but worth covering.

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL: `https://coveragechiropractor.com/api/stripe_webhook.php`
3. Event to send: `payment_intent.succeeded`
4. Copy the **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` in `config.php`.

## STEP 7: CRON JOBS

cPanel → **Cron Jobs** → **Add New Cron Job**:

```
Minute: 0   Hour: 9,21   (twice daily — matches the "next reminder in ~Xh" text shown to clients)
Command: /usr/bin/php /home/[username]/php_backend/cron/payment_reminders.php
```

This sends up to 10 reminders (roughly every 12 hours) to a clinic with an
unpaid balance, then stops and needs a manual follow-up.

## STEP 8: TEST END TO END

1. Visit the site, register a test account, book office coverage with a
   Stripe test card (`4242 4242 4242 4242`, any future expiry/CVC).
2. Confirm: booking appears in your dashboard, a confirmation email arrives,
   and `payments`/`bookings` rows appear in phpMyAdmin.
3. Sign in as `drmichaelmcpherson@gmail.com` (the admin account — this is the
   *only* email that gets provider/admin access, checked server-side) and
   confirm the "Blocked dates" and "Booked dates" admin tabs show real data.
4. Mark the test booking complete, confirm the balance-due email arrives, and
   pay the balance with the same test card.
5. Cancel a booking and confirm a Stripe refund appears in the Stripe dashboard
   (only if cancelled 48+ hours before the coverage date).
6. Switch `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` to live keys once
   everything above checks out.

---

## WHAT'S REAL VS. WHAT'S STILL A DEMO

| Feature | Status |
|---|---|
| Accounts, login, sessions | **Real** — bcrypt password hashing, login throttling |
| Office coverage booking + pricing | **Real** — server recomputes the price; never trusts the browser |
| Stripe deposit + balance payment | **Real** — PaymentIntents, webhook safety net, refunds on cancellation |
| Email confirmations, balance-due notices, reminders | **Real** — via SendGrid |
| Admin blackout-date calendar | **Real** |
| Admin "mark coverage complete" → balance invoicing | **Real** |
| Reviews & feedback | **Real** |
| Standing-day requests | Sends a real email to you; not yet a database-backed workflow |
| Video-interview requests | Sends a real email to you; not yet a database-backed workflow |
| Flex Rate dates, promo codes | Not yet built — promo code field is hidden on the live site |
| Admin analytics dashboard, inventory alerts | Not yet built — tabs show session-only placeholder data |

---

## TROUBLESHOOTING

**"Database connection failed"** — check `config.php` DB credentials; test the
same login in phpMyAdmin first.

**Registration/login works but nothing happens on "Sign & continue to
payment"** — check the browser console; usually means `composer install`
hasn't been run yet (Stripe library missing), which the API reports as a
clear 503 error rather than a blank failure.

**Emails not arriving** — verify the SendGrid API key and that your sending
domain is verified in SendGrid (unverified senders get silently filtered by
some inboxes). Check `php_backend/logs/error.log` for send failures.

**Cron not sending reminders** — check `php_backend/logs/error.log`; confirm
the cron command path matches your actual username.

## REFERENCE: API ENDPOINTS

```
POST /api/auth.php?action=register|login|logout      GET ?action=me
GET  /api/booking.php?action=availability             (public)
POST /api/booking.php?action=create                   (auth)
GET  /api/booking.php?action=list|get                 (auth)
POST /api/booking.php?action=cancel|review|feedback    (auth)
GET  /api/booking.php?action=list_all                  (admin)
POST /api/booking.php?action=mark_complete|blackout_add|blackout_remove  (admin)
POST /api/payment.php?action=create_payment_intent|confirm_payment  (auth)
POST /api/stripe_webhook.php                           (Stripe only)
```
