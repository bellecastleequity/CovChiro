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
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY  — https://dashboard.stripe.com/apikeys
STRIPE_WEBHOOK_SECRET              — from the webhook you create in Step 6
SENDGRID_API_KEY                   — https://app.sendgrid.com/settings/api_keys
```

## Cron job
```
Twice daily (e.g. 9:00 and 21:00)
/usr/bin/php /home/[username]/php_backend/cron/payment_reminders.php
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
