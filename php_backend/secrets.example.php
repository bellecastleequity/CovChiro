<?php
// TEMPLATE — copy this file to php_backend/secrets.php on your live server
// and fill in your real values. secrets.php is in .gitignore and is never
// touched by a code update again after this one-time setup — config.php
// just requires it and can be replaced wholesale from then on.

// ========== DATABASE CONFIGURATION ==========
define('DB_HOST', 'localhost');
define('DB_USER', 'your_cpanel_username_dbuser');
define('DB_PASSWORD', 'your_database_password');
define('DB_NAME', 'your_cpanel_username_coverage');

// ========== STRIPE CONFIGURATION ==========
// https://dashboard.stripe.com/apikeys — use sk_test_/pk_test_ until you're ready to go live
define('STRIPE_SECRET_KEY', 'sk_live_your_secret_key_here');
define('STRIPE_PUBLISHABLE_KEY', 'pk_live_your_publishable_key_here');
define('STRIPE_WEBHOOK_SECRET', 'whsec_your_webhook_signing_secret_here');

// ========== SENDGRID API KEY ==========
define('SENDGRID_API_KEY', 'SG.your_sendgrid_api_key_here');

// ========== GOOGLE GEMINI (optional — admin AI drafting buttons) ==========
// Free key from https://aistudio.google.com → Get API key. Leave this line
// out and the admin's AI buttons just say AI isn't set up; nothing else changes.
define('GEMINI_API_KEY', 'your_gemini_api_key_here');
// Optional: pin a specific model instead of Google's "latest Flash" alias.
// define('GEMINI_MODEL', 'gemini-flash-latest');
