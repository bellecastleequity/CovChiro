<?php
// TEMPLATE — copy to pi_portal/app/secrets.php on the server and fill in.
// secrets.php is .gitignore'd. It must live outside the web root and be
// readable only by the PHP user (chmod 600).

// ========== DATABASE (a database used ONLY by this portal) ==========
define('PI_DB_HOST', 'localhost');
define('PI_DB_NAME', 'pi_portal');
define('PI_DB_USER', 'pi_portal_app');
define('PI_DB_PASSWORD', 'change-me');
// AWS RDS: path to the RDS CA bundle, which forces TLS to the database
// (deploy/aws/setup.sh downloads it). Leave '' for a local database.
define('PI_DB_SSL_CA', '');

// ========== ENCRYPTION KEY ==========
// 32 random bytes, base64. Generate with:
//   php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
// Store a copy somewhere safe and OFFLINE (password manager, safe). If this
// key is lost, every encrypted field and uploaded document is unrecoverable.
// If it leaks, rotate it (see README) — treat that as a security incident.
define('PI_ENCRYPTION_KEY', 'paste-base64-key-here');

// ========== STRIPE (membership billing) ==========
// Stripe only ever sees the practice's name and the owner's email — never
// patient data — so it doesn't need a BAA. Leave these out and the Billing
// page just says billing isn't set up (handy for development).
define('STRIPE_SECRET_KEY', 'sk_test_...');
define('STRIPE_WEBHOOK_SECRET', 'whsec_...');
// Two recurring Prices per plan in app/saas.php: monthly, and annual at
// 10x the monthly price ("2 months free").
define('STRIPE_PRICES', [
    'solo' => ['monthly' => 'price_...', 'annual' => 'price_...'],
    'practice' => ['monthly' => 'price_...', 'annual' => 'price_...'],
    'group' => ['monthly' => 'price_...', 'annual' => 'price_...'],
]);

// ========== EMAIL (trial reminders) ==========
// SMTP, e.g. Amazon SES. Account emails only — never patient data. Leave
// out to send nothing.
// define('SMTP_HOST', 'email-smtp.us-east-1.amazonaws.com');
// define('SMTP_PORT', 587);
// define('SMTP_USER', '...');
// define('SMTP_PASS', '...');
// define('MAIL_FROM', 'hello@injurycase.com');

// Public URL of the app (no trailing slash), used for Stripe return links.
define('APP_URL', 'https://injurycase.com');
define('SUPPORT_EMAIL', 'support@injurycase.com');

// ========== MARKETING: automatic outreach to clinics (operator console → Marketing) ==========
// Free AI model (Google AI Studio key) for finding practice websites and checking fit.
// define('GEMINI_API_KEY', '...');
// Low-cost OpenAI model for picking contact details when a site isn't clear.
// define('OPENAI_API_KEY', 'sk-...');
// SendGrid sends the outreach emails (never the app's own Amazon SES account).
// define('SENDGRID_API_KEY', 'SG....');
// Long random string; SendGrid's Event Webhook posts to /api/m.php?a=sendgrid&k=<this>.
// define('MKT_WEBHOOK_SECRET', '...');
// Optional: verify SendGrid's signed event webhook (the public key from SendGrid).
// define('SENDGRID_WEBHOOK_PUBLIC_KEY', 'MFkwEwYH...');
