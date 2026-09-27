<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'get_last_minute': handle_get($pdo); break;
    case 'set_last_minute': handle_set($pdo); break;
    case 'test_email': handle_test_email($pdo); break;
    case 'cron_status': handle_cron_status($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_get(PDO $pdo) {
    json_response(['enabled' => last_minute_enabled($pdo)]);
}

function handle_set(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $enabled = !empty($body['enabled']);
    $stmt = $pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES ("last_minute_discount", ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
    $stmt->execute([json_encode(['enabled' => $enabled])]);
    json_response(['success' => true]);
}

// Sends a real email right now and reports exactly what happened, so "are
// emails working" can be answered from the admin panel in one click instead
// of guessing from a live inbox that may just be delayed, filtered, or
// looking at the wrong address.
function handle_test_email(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $vendorInstalled = file_exists(__DIR__ . '/../../php_backend/vendor/autoload.php');
    $apiKeyLooksSet = defined('SENDGRID_API_KEY') && SENDGRID_API_KEY !== '' && strpos(SENDGRID_API_KEY, 'your_sendgrid') === false;

    // Tests both sites' verified sender identities in one click, rather than
    // just whichever one the current request's Host header happens to
    // resolve to — the admin panel only ever runs on coveragechiropractor.com,
    // so a single host-based test would never actually check the Florida
    // sender that this same shared config.php also sends from.
    $senders = [
        'coveragechiropractor.com' => [SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME],
        'thefloridachiropractor.com' => [SENDGRID_FROM_EMAIL_FLORIDA, SENDGRID_FROM_NAME_FLORIDA],
    ];
    $results = [];
    foreach ($senders as $site => [$fromEmail, $fromName]) {
        $autoload = __DIR__ . '/../../php_backend/vendor/autoload.php';
        if (!file_exists($autoload)) {
            $results[$site] = ['ok' => false, 'reason' => 'SendGrid PHP library not installed.', 'fromEmail' => $fromEmail];
            continue;
        }
        require_once $autoload;
        $email = new \SendGrid\Mail\Mail();
        $email->setFrom($fromEmail, $fromName);
        $email->setSubject('Test email — ' . $site . ' — ' . date('Y-m-d H:i:s T'));
        $email->addTo(ADMIN_EMAIL);
        $email->addContent('text/html', "<p>This is a test email sent from the admin panel's email diagnostics, from <strong>{$fromEmail}</strong>. If it reached your inbox, sending is working for {$site}.</p>");
        $sendgrid = new \SendGrid(SENDGRID_API_KEY);
        try {
            $response = $sendgrid->send($email);
            if ((int)$response->statusCode() === 202) {
                $results[$site] = ['ok' => true, 'status' => $response->statusCode(), 'fromEmail' => $fromEmail];
            } else {
                log_error('Email rejected by SendGrid', ['to' => ADMIN_EMAIL, 'site' => $site, 'status' => $response->statusCode(), 'body' => $response->body()]);
                $results[$site] = ['ok' => false, 'status' => $response->statusCode(), 'body' => $response->body(), 'fromEmail' => $fromEmail];
            }
        } catch (\Exception $e) {
            log_error('Email send failed', ['to' => ADMIN_EMAIL, 'site' => $site, 'error' => $e->getMessage()]);
            $results[$site] = ['ok' => false, 'reason' => $e->getMessage(), 'fromEmail' => $fromEmail];
        }
    }

    json_response([
        'vendorInstalled' => $vendorInstalled,
        'apiKeyLooksSet' => $apiKeyLooksSet,
        'adminEmail' => ADMIN_EMAIL,
        'results' => $results,
    ]);
}

// When the daily route-digest cron last actually ran (see
// cron_daily_routes.php's heartbeat write) vs. when it last actually sent —
// tells apart "cPanel isn't calling this script at all" from "it's running
// but hasn't hit 4:30am yet" or "it sent and there's genuinely nothing on
// today's calendar."
function handle_cron_status(PDO $pdo) {
    require_admin();
    $stmt = $pdo->prepare('SELECT name, value_json FROM app_settings WHERE name IN ("daily_route_cron_last_ran", "daily_route_digest_sent")');
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    json_response([
        'lastRan' => isset($rows['daily_route_cron_last_ran']) ? json_decode($rows['daily_route_cron_last_ran'], true) : null,
        'lastSentDate' => isset($rows['daily_route_digest_sent']) ? json_decode($rows['daily_route_digest_sent'], true) : null,
    ]);
}
