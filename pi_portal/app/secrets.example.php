<?php
// TEMPLATE — copy to pi_portal/app/secrets.php on the server and fill in.
// secrets.php is .gitignore'd. It must live outside the web root and be
// readable only by the PHP user (chmod 600).

// ========== DATABASE (a database used ONLY by this portal) ==========
define('PI_DB_HOST', 'localhost');
define('PI_DB_NAME', 'pi_portal');
define('PI_DB_USER', 'pi_portal_app');
define('PI_DB_PASSWORD', 'change-me');

// ========== ENCRYPTION KEY ==========
// 32 random bytes, base64. Generate with:
//   php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
// Store a copy somewhere safe and OFFLINE (password manager, safe). If this
// key is lost, every encrypted field and uploaded document is unrecoverable.
// If it leaks, rotate it (see README) — treat that as a security incident.
define('PI_ENCRYPTION_KEY', 'paste-base64-key-here');

// Practice name shown in the portal header, on 2FA apps and on letters.
define('PI_PRACTICE_NAME', 'Your Chiropractic Practice');
define('PI_PRACTICE_ADDRESS', "123 Main St\nSt. Petersburg, FL 33701");
define('PI_PRACTICE_PHONE', '(727) 555-0100');
define('PI_PRACTICE_FAX', '(727) 555-0101');
