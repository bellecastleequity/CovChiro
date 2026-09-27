# Quick Reference

Full setup steps are in `INSTALLATION.md` in this same folder. This is just
the copy-paste values.

## Database (cPanel → MySQL Databases)
```
Database Name:   [cpanel_username]_coverage
Database User:   [cpanel_username]_dbuser
Host:            localhost
```

## config.php values to fill in
```
DB_USER, DB_PASSWORD, DB_NAME     — from the database you create in Step 1
STRIPE_SECRET_KEY                  — https://dashboard.stripe.com/apikeys (publishable key is already filled in)
STRIPE_WEBHOOK_SECRET              — from the webhook you create in Step 6
SENDGRID_API_KEY                   — https://app.sendgrid.com/settings/api_keys
GEMINI_API_KEY (optional)          — https://aistudio.google.com — admin AI drafting buttons
```

## Cron jobs
Shortcut: Admin panel → Analytics → Email & cron diagnostics → **Set up
cron jobs automatically** sets up all six below in one click (where the
host allows it). Otherwise add each manually — see INSTALLATION.md Step 7:
```
0 9,21 * * *   /usr/bin/php /home/[username]/php_backend/cron/payment_reminders.php
0 10 * * *     /usr/bin/php /home/[username]/php_backend/cron/feedback_reminders.php
0 11 * * *     /usr/bin/php /home/[username]/php_backend/cron/lead_drip.php
0 3 * * *      /usr/bin/php /home/[username]/php_backend/cron_billing.php
0 6 * * *      /usr/bin/php /home/[username]/php_backend/cron_standing_charges.php
*/5 * * * *    /usr/bin/php /home/[username]/php_backend/cron_daily_routes.php
```

## Admin access
The only account with provider/admin access is whatever email matches
`ADMIN_EMAIL` in `config.php` (currently `drmichaelmcpherson@gmail.com`) —
this is checked server-side at login, not something a visitor can fake.

## Stripe webhook URL
```
https://coveragechiropractor.com/api/stripe_webhook.php
Event: payment_intent.succeeded
```

## Keep these secret — never commit them to a public repo or paste them in chat
```
cPanel password
Database password
Stripe secret key (sk_...)
SendGrid API key
```
