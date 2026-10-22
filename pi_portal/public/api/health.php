<?php
// Uptime check for monitors (Route 53 health check, or any external
// service): 200 "ok" when the app can reach its database, 503 otherwise.
// Reveals nothing else.
require_once __DIR__ . '/../../app/bootstrap.php';
header('Content-Type: text/plain');
header('Cache-Control: no-store');
try {
    pi_db()->query('SELECT 1');
    echo "ok\n";
} catch (Throwable $e) {
    http_response_code(503);
    echo "unavailable\n";
}
