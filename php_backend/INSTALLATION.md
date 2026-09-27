# Coverage Chiropractic — Installation Guide
## Namecheap cPanel Setup

Everything on the site is now backed by a real server: accounts, office-coverage
bookings, standing-day agreements, flex-rate dates, promo codes,
video-interview requests, Stripe payments (deposit, balance, and per-date
standing payments), SendGrid emails, and a live admin analytics dashboard.
Nothing quietly saves to browser memory only.

---

## STEP 1: DATABASE SETUP

1. Log into cPanel (`https://coveragechiropractor.com:2083`, or via your Namecheap dashboard).
2. **MySQL Databases** → **Create New Database**
   - Name it `[cpanel_username]_coverage`
3. **MySQL Users** → **Create New User** — generate a strong password and save it.
4. **Add User to Database** with **ALL PRIVILEGES**.
5. Open **phpMyAdmin**, select the new database, **Import** tab, upload
   `database_setup.sql` from this package, click **Go**.
   - You should see 13 tables created (`users`, `bookings`, `payments`,
     `standing_requests`, `standing_agreements`, `blackout_dates`,
     `flex_rate_dates`, `promo_codes`, `video_requests`, `app_settings`,
     `payment_reminders`, `analytics_cache`).

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
│       ├── booking.php            (office-coverage bookings + admin blackout calendar)
│       ├── standing.php           (standing-day requests, approval, per-date management)
│       ├── flexrate.php           (admin-published promotional dates)
│       ├── promo.php              (promo codes)
│       ├── video.php              (video-interview requests)
│       ├── settings.php           (last-minute discount on/off)
│       ├── analytics.php          (admin dashboard metrics)
│       ├── payment.php            (Stripe PaymentIntent create/confirm, office + standing)
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
define('STRIPE_PUBLISHABLE_KEY', 'pk_live_...');  // already filled in with the live key you sent
define('STRIPE_WEBHOOK_SECRET', 'whsec_...');     // from Step 6 below

define('SENDGRID_API_KEY', 'SG...');              // https://app.sendgrid.com/settings/api_keys
```

Everything else (rates, mileage tiers, discount rules, standing-day tiers)
already matches the site's published pricing — no changes needed there.

**Strongly recommended: start with Stripe test keys (`sk_test_...` /
`pk_test_...`)** and do a full test booking with a
[Stripe test card](https://stripe.com/docs/testing) before switching to live
keys. A live publishable key is already in `config.php`, but nothing charges
real money until you also add a live secret key.

## STEP 5: VERIFY HTTPS

The site now requires HTTPS (it forces a redirect, and the login session
cookie is marked secure). Confirm your SSL certificate is active in cPanel →
**SSL/TLS Status** before testing.

## STEP 6: STRIPE WEBHOOK (recommended safety net)

Without this, a payment can succeed on Stripe's side but not get recorded if
the customer's browser closes before the confirmation call completes — rare,
but worth covering. It covers both office-coverage and standing-day payments.

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

**Note:** this `cron/payment_reminders.php` script is referenced above but
does not exist yet in this codebase — the balance-due reminder emails this
step describes are not currently being sent automatically. Ask if you'd
like this built; it's a separate piece of work from the standing-day
auto-pay cron below.

**Standing day auto-pay** (new): cPanel → **Cron Jobs** → **Add New Cron Job**:

```
Minute: 0   Hour: 6   (once daily, any quiet hour works)
Command: /usr/bin/php /home/[username]/php_backend/cron_standing_charges.php
```

This is what actually charges the card on file for standing-day agreements
— per-date billing 7 days out, the prepay retry, and monthly installments.
Without this cron job running, cards are only ever charged once (the signup
deposit at request time); nothing else gets billed automatically. Safe to
run more than once a day or to miss a day — every charge is gated on
whether that date or installment is already paid.

## STEP 8: TEST END TO END

**Office coverage:**
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

**Standing day, flex rate, promo codes, video requests:**
6. Submit a standing-day request from the public form (no login required).
7. As admin, open the "Standing days" tab, approve it, and confirm the
   generated dates now block the ad-hoc booking calendar.
8. As the clinic, pay one scheduled date from the dashboard, cancel another,
   and set an expected patient volume.
9. As admin, publish a Flex Rate date (Inventory tab) and confirm it appears
   on the public "Flex Rate Days" section, then book it and confirm it
   disappears from the public list.
10. Create a promo code (admin → Promo codes) and apply it during checkout.
11. Request a video interview and confirm it appears in admin → Video requests.
12. Check admin → Analytics — it should reflect the test bookings you just made.

**Once everything above checks out, switch `STRIPE_SECRET_KEY` to a live key.**

---

## WHAT'S REAL

Everything. Every admin tab, every public form, and every payment path reads
from and writes to the real database — nothing is session-only or simulated
anymore. A few product decisions worth knowing about:

- **Standing-day requests don't require an account.** The public form only
  ever asked for a clinic name and contact email — a request is matched to a
  dashboard by email if the clinic later creates (or already has) an account.
- **The last-minute discount can be toggled off** (admin → Promo codes tab) —
  the server enforces whichever setting is current, so the price a client
  sees always matches what's actually charged.
- **Cancelling a standing-day date doesn't auto-refund** — same as the
  original design, cancellation just releases the date; issue a manual
  refund in the Stripe dashboard if one is owed.
- **The admin analytics dashboard computes live from the database** on each
  view — for a very large dataset down the road, `analytics_cache` is
  reserved for a future caching pass, but isn't needed yet.

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
POST /api/auth.php?action=register|login|logout          GET ?action=me

GET  /api/booking.php?action=availability                 (public)
POST /api/booking.php?action=create                       (auth)
GET  /api/booking.php?action=list|get                      (auth)
POST /api/booking.php?action=cancel|review|feedback        (auth)
GET  /api/booking.php?action=list_all                       (admin)
POST /api/booking.php?action=mark_complete|blackout_add|blackout_remove  (admin)

POST /api/standing.php?action=request                     (public)
GET  /api/standing.php?action=list_mine                    (auth)
POST /api/standing.php?action=cancel_agreement|cancel_date|set_patient_volume  (auth, owner or admin)
GET  /api/standing.php?action=list_pending|list_agreements  (admin)
POST /api/standing.php?action=approve|decline|set_custom_rate  (admin)

GET  /api/flexrate.php?action=list                         (public)
POST /api/flexrate.php?action=publish|unpublish             (admin)

POST /api/promo.php?action=validate                        (public)
GET  /api/promo.php?action=list                             (admin)
POST /api/promo.php?action=create|toggle                    (admin)

POST /api/video.php?action=create                          (auth)
GET  /api/video.php?action=list                             (admin)

GET  /api/settings.php?action=get_last_minute               (public)
POST /api/settings.php?action=set_last_minute                (admin)

GET  /api/analytics.php?action=summary                      (admin)

POST /api/payment.php?action=create_payment_intent|confirm_payment  (auth)
POST /api/payment.php?action=create_standing_payment_intent|confirm_standing_payment  (auth)
POST /api/stripe_webhook.php                                (Stripe only)
```
