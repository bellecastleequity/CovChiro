<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'capture': handle_capture($pdo); break;
    case 'unsubscribe': handle_unsubscribe($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

// Homepage welcome-offer pop-up: name + email in, a single-use 15% code bound
// to that email out, welcome email sent, drip sequence started.
function handle_capture(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    check_rate_limit($pdo, 'lead_capture', 10, 60, 30);
    $body = json_body();
    $name = trim((string)($body['name'] ?? ''));
    $email = strtolower(trim((string)($body['email'] ?? '')));
    if ($name === '' || mb_strlen($name) > 120) json_response(['error' => 'Enter your name.'], 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email address.'], 400);
    // The site comes from the request's Host header, not the client, so the
    // welcome email and drip go out under the right domain's sender.
    $site = site_key_from_host() ?? ((($body['site'] ?? '') === 'florida') ? 'florida' : 'coverage');
    $today = date('Y-m-d');

    $stmt = $pdo->prepare('SELECT * FROM leads WHERE email = ?');
    $stmt->execute([$email]);
    $lead = $stmt->fetch();

    if ($lead) {
        if ($lead['status'] === 'converted') {
            json_response(['error' => "You've already booked with us — welcome back! The welcome offer is for a first booking only."], 400);
        }
        $promo = $lead['promo_code'] ? promo_by_code($pdo, $lead['promo_code']) : null;
        $codeStillGood = $promo && $promo['active']
            && (!$promo['expires_at'] || $promo['expires_at'] >= $today)
            && ($promo['max_uses'] === null || (int)$promo['used_count'] < (int)$promo['max_uses']);
        if ($codeStillGood) {
            // Signing up again (another device, or after unsubscribing) just
            // hands back the same code and resumes emails — no second code.
            if ($lead['status'] !== 'active') {
                $pdo->prepare("UPDATE leads SET status = 'active', unsubscribed_at = NULL WHERE id = ?")->execute([$lead['id']]);
            }
            json_response(['code' => $promo['code'], 'expiresAt' => $promo['expires_at'], 'discountPct' => (float)$promo['value'], 'alreadySignedUp' => true]);
        }
        // Their earlier code lapsed without a booking — issue a fresh one and
        // restart the sequence from the top.
        $promo = create_welcome_promo($pdo, $email);
        $pdo->prepare("UPDATE leads SET name = ?, site = ?, promo_code = ?, status = 'active', unsubscribe_token = ?, drip_step = 0, last_drip_sent_at = NULL, unsubscribed_at = NULL, created_at = ? WHERE id = ?")
            ->execute([sanitize($name), $site, $promo['code'], bin2hex(random_bytes(24)), date('Y-m-d H:i:s'), $lead['id']]);
    } else {
        $promo = create_welcome_promo($pdo, $email);
        $pdo->prepare('INSERT INTO leads (name, email, site, promo_code, status, unsubscribe_token, created_at) VALUES (?, ?, ?, ?, "active", ?, ?)')
            ->execute([sanitize($name), $email, $site, $promo['code'], bin2hex(random_bytes(24)), date('Y-m-d H:i:s')]);
    }
    $stmt = $pdo->prepare('SELECT * FROM leads WHERE email = ?');
    $stmt->execute([$email]);
    $lead = $stmt->fetch();

    $sent = send_lead_email($lead, $promo, 0);
    if (!$sent) log_error('Welcome offer email failed to send', ['email' => $email]);
    json_response(['code' => $promo['code'], 'expiresAt' => $promo['expires_at'], 'discountPct' => (float)$promo['value'], 'emailSent' => $sent]);
}

function create_welcome_promo(PDO $pdo, string $email) {
    do {
        $code = 'WELCOME-' . strtoupper(bin2hex(random_bytes(2)));
        $exists = $pdo->prepare('SELECT id FROM promo_codes WHERE code = ?');
        $exists->execute([$code]);
    } while ($exists->fetch());
    $expires = date('Y-m-d', strtotime('+' . WELCOME_OFFER_DAYS . ' days'));
    $stmt = $pdo->prepare('INSERT INTO promo_codes (code, type, value, max_uses, expires_at, active, assigned_email, is_welcome) VALUES (?, "percent", ?, 1, ?, 1, ?, 1)');
    $stmt->execute([$code, WELCOME_OFFER_PCT, $expires, $email]);
    return promo_by_code($pdo, $code);
}

// One-click unsubscribe from the drip (linked in every email). Renders a
// small HTML page rather than JSON since it's opened directly in a browser.
// The code itself stays valid — they just stop hearing from us.
function handle_unsubscribe(PDO $pdo) {
    $token = trim((string)($_GET['token'] ?? ''));
    $lead = null;
    if ($token !== '') {
        $stmt = $pdo->prepare('SELECT * FROM leads WHERE unsubscribe_token = ?');
        $stmt->execute([$token]);
        $lead = $stmt->fetch();
    }
    if ($lead && $lead['status'] === 'active') {
        $pdo->prepare("UPDATE leads SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?")->execute([date('Y-m-d H:i:s'), $lead['id']]);
    }
    $site = $lead ? $lead['site'] : (site_key_from_host() ?? 'coverage');
    $siteName = htmlspecialchars(site_name_for($site));
    $siteUrl = htmlspecialchars(site_url_for($site));
    $message = $lead
        ? "You've been unsubscribed from welcome-offer emails. Your code still works if you decide to book later."
        : "That unsubscribe link isn't valid or has already been used.";
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Unsubscribed — ' . $siteName . '</title>'
        . '<style>body{margin:0;background:#EFEAE0;color:#1C2430;font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;box-sizing:border-box;}'
        . '.card{background:#FBF9F4;border:1px solid #CFC7B4;border-radius:8px;padding:32px;max-width:460px;text-align:center;}h1{font-size:1.4rem;margin:0 0 10px;color:#1F3F38;}p{line-height:1.55;color:#4b5563;}a{color:#2F5D53;}</style></head>'
        . '<body><div class="card"><h1>' . $siteName . '</h1><p>' . $message . '</p><p><a href="' . $siteUrl . '/">Back to the site</a></p></div></body></html>';
    exit;
}
