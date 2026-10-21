<?php
// LOCAL DEVELOPMENT ONLY — never deploy this as a router. Lets PHP's
// built-in server send the same security headers public/.htaccess sends
// in production, so the strict CSP is exercised while developing:
//   php -S 127.0.0.1:8080 -t pi_portal/public pi_portal/app/dev_router.php
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store, max-age=0');
// Headers set here are dropped if the built-in server serves the file
// itself (return false), so static files are served from here too.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = realpath(dirname(__DIR__) . '/public' . ($path === '/' ? '/index.html' : $path));
if (!$file || strpos($file, realpath(dirname(__DIR__) . '/public')) !== 0 || !is_file($file)) { http_response_code(404); exit; }
if (substr($file, -4) === '.php') return false;
$types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript', 'css' => 'text/css', 'png' => 'image/png'];
header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
readfile($file);
