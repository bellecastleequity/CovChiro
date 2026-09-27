<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'capture': handle_capture($pdo); break;
    case 'campaign': handle_campaign($pdo); break;
    case 'unsubscribe': handle_unsubscribe($pdo); break;
    case 'admin_list': handle_admin_list($pdo); break;
    case 'admin_resend': handle_admin_resend($pdo); break;
    case 'admin_unsubscribe': handle_admin_unsubscribe($pdo); break;
    case 'admin_delete': handle_admin_delete($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

// Name + email in, a single-use code bound to that email out, first email
// sent, follow-up sequence started. Without a campaign it's the homepage
// welcome offer (15%, first booking only); with one it's a campaign landing
// page, and the code is a personal copy of that campaign's promo.
function handle_capture(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    check_rate_limit($pdo, 'lead_capture', 10, 60, 30);
    $body = json_body();
    $name = trim((string)($body['name'] ?? ''));
    $email = strtolower(trim((string)($body['email'] ?? '')));
    if ($name === '' || mb_strlen($name) > 120) json_response(['error' => 'Enter your name.'], 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email address.'], 400);
    $today = date('Y-m-d');

    $campaignCode = strtoupper(trim((string)($body['campaign'] ?? '')));
    $campaign = null;
    if ($campaignCode !== '') {
        $campaign = active_campaign($pdo, $campaignCode);
        if (!$campaign) json_response(['error' => 'Sorry — this offer has ended.'], 400);
        $site = $campaign['landing_site'] === 'florida' ? 'florida' : 'coverage';
    } else {
        // The site comes from the request's Host header, not the client, so
        // the emails go out under the right domain's sender.
        $site = site_key_from_host() ?? ((($body['site'] ?? '') === 'florida') ? 'florida' : 'coverage');
    }
    $issue = fn() => $campaign ? create_campaign_promo($pdo, $campaign, $email) : create_welcome_promo($pdo, $email);

    $stmt = $pdo->prepare('SELECT * FROM leads WHERE email = ? AND campaign_code = ?');
    $stmt->execute([$email, $campaignCode]);
    $lead = $stmt->fetch();

    if ($lead) {
        if ($lead['status'] === 'converted') {
            json_response(['error' => $campaign
                ? "You've already redeemed this offer — thanks for booking!"
                : "You've already booked with us — welcome back! The welcome offer is for a first booking only."], 400);
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
            supersede_other_leads($pdo, $email, (int)$lead['id']);
            json_response(['code' => $promo['code'], 'expiresAt' => $promo['expires_at'], 'offer' => promo_offer_label($promo), 'alreadySignedUp' => true]);
        }
        // Their earlier code lapsed without a booking — issue a fresh one and
        // restart the sequence from the top.
        $promo = $issue();
        $pdo->prepare("UPDATE leads SET name = ?, site = ?, promo_code = ?, status = 'active', unsubscribe_token = ?, drip_step = 0, last_drip_sent_at = NULL, unsubscribed_at = NULL, created_at = ? WHERE id = ?")
            ->execute([sanitize($name), $site, $promo['code'], bin2hex(random_bytes(24)), date('Y-m-d H:i:s'), $lead['id']]);
    } else {
        $promo = $issue();
        $pdo->prepare('INSERT INTO leads (name, email, site, promo_code, campaign_code, status, unsubscribe_token, created_at) VALUES (?, ?, ?, ?, ?, "active", ?, ?)')
            ->execute([sanitize($name), $email, $site, $promo['code'], $campaignCode, bin2hex(random_bytes(24)), date('Y-m-d H:i:s')]);
    }
    $stmt = $pdo->prepare('SELECT * FROM leads WHERE email = ? AND campaign_code = ?');
    $stmt->execute([$email, $campaignCode]);
    $lead = $stmt->fetch();
    supersede_other_leads($pdo, $email, (int)$lead['id']);

    $sent = send_lead_email($lead, $promo, 0);
    if (!$sent) log_error('Offer email failed to send', ['email' => $email, 'campaign' => $campaignCode]);
    json_response(['code' => $promo['code'], 'expiresAt' => $promo['expires_at'], 'offer' => promo_offer_label($promo), 'emailSent' => $sent]);
}

// Only one follow-up sequence runs per person: signing up for a newer offer
// stops the emails for any older one. The older code still works.
function supersede_other_leads(PDO $pdo, string $email, int $keepId) {
    $pdo->prepare("UPDATE leads SET status = 'superseded' WHERE email = ? AND id != ? AND status = 'active'")->execute([$email, $keepId]);
}

// A library code with its landing page switched on, still active and not
// expired. Per-person copies and welcome codes can never be campaigns.
function active_campaign(PDO $pdo, string $code) {
    $stmt = $pdo->prepare("SELECT * FROM promo_codes WHERE code = ? AND landing_enabled = 1 AND active = 1
        AND (expires_at IS NULL OR expires_at >= ?) AND parent_code IS NULL AND is_welcome = 0");
    $stmt->execute([strtoupper(trim($code)), date('Y-m-d')]);
    return $stmt->fetch() ?: null;
}

// The expiry a personal code would get if issued today: 90 days, or the
// campaign's own end date if that's sooner.
function campaign_personal_expiry(array $campaign) {
    $expires = date('Y-m-d', strtotime('+' . WELCOME_OFFER_DAYS . ' days'));
    if ($campaign['expires_at'] && $campaign['expires_at'] < $expires) $expires = $campaign['expires_at'];
    return $expires;
}

function create_campaign_promo(PDO $pdo, array $campaign, string $email) {
    $prefix = substr(preg_replace('/[^A-Z0-9]/', '', strtoupper($campaign['code'])), 0, 40) ?: 'OFFER';
    do {
        $code = $prefix . '-' . strtoupper(bin2hex(random_bytes(2)));
        $exists = $pdo->prepare('SELECT id FROM promo_codes WHERE code = ?');
        $exists->execute([$code]);
    } while ($exists->fetch());
    $stmt = $pdo->prepare('INSERT INTO promo_codes (code, type, value, max_uses, expires_at, active, assigned_email, is_welcome, parent_code) VALUES (?, ?, ?, 1, ?, 1, ?, 0, ?)');
    $stmt->execute([$code, $campaign['type'], $campaign['value'], campaign_personal_expiry($campaign), $email, $campaign['code']]);
    return promo_by_code($pdo, $code);
}

// Public: what the /offer/CODE landing page needs to render itself. Counts a
// visit unless it's the admin's own preview.
function handle_campaign(PDO $pdo) {
    $campaign = active_campaign($pdo, (string)($_GET['c'] ?? ''));
    if (!$campaign) json_response(['error' => 'This offer has ended or no longer exists.'], 404);
    if (empty($_GET['preview'])) {
        $pdo->prepare('UPDATE promo_codes SET landing_visits = landing_visits + 1 WHERE id = ?')->execute([$campaign['id']]);
    }
    $site = $campaign['landing_site'] === 'florida' ? 'florida' : 'coverage';
    json_response([
        'code' => $campaign['code'],
        'site' => $site,
        'siteUrl' => site_url_for($site),
        'headline' => $campaign['landing_headline'],
        'description' => $campaign['landing_description'],
        'offer' => promo_offer_label($campaign),
        'expiresAt' => campaign_personal_expiry($campaign),
    ]);
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

// Full, searchable lead list for the admin panel — analytics.php's summary
// only embeds the most recent 25 for the at-a-glance cards.
function handle_admin_list(PDO $pdo) {
    require_admin();
    $rows = $pdo->query("SELECT l.id, l.name, l.email, l.site, l.promo_code, l.campaign_code, l.status, l.created_at, l.converted_at, l.drip_step,
        p.expires_at, p.value AS promo_value, p.used_count, p.max_uses
        FROM leads l LEFT JOIN promo_codes p ON p.code = l.promo_code
        ORDER BY l.created_at DESC LIMIT 500")->fetchAll();
    json_response(['leads' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'site' => $r['site'], 'code' => $r['promo_code'],
        'campaign' => $r['campaign_code'] !== '' ? $r['campaign_code'] : null,
        'status' => $r['status'], 'createdAt' => to_iso($r['created_at']), 'convertedAt' => to_iso($r['converted_at']),
        'dripStep' => (int)$r['drip_step'], 'expiresAt' => $r['expires_at'],
        'discountPct' => $r['promo_value'] !== null ? (float)$r['promo_value'] : null,
        'codeUsed' => $r['used_count'] !== null && $r['max_uses'] !== null && (int)$r['used_count'] >= (int)$r['max_uses'],
    ], $rows)]);
}

// "This lead says they never got the code" — resends whichever email they're
// currently on (the welcome email if no drip step has gone out yet, or the
// most recent drip step otherwise). Only for active leads: someone who
// unsubscribed asked to stop, and an expired/converted lead has nothing
// current left to resend.
function handle_admin_resend(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = (int)($body['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM leads WHERE id = ?');
    $stmt->execute([$id]);
    $lead = $stmt->fetch();
    if (!$lead) json_response(['error' => 'Lead not found.'], 404);
    if ($lead['status'] !== 'active') json_response(['error' => 'This lead is ' . $lead['status'] . " — there's nothing current to resend."], 400);
    $promo = $lead['promo_code'] ? promo_by_code($pdo, $lead['promo_code']) : null;
    if (!$promo) json_response(['error' => "This lead's promo code no longer exists."], 400);
    $sent = send_lead_email($lead, $promo, (int)$lead['drip_step']);
    if (!$sent) json_response(['error' => 'Email send failed — check the diagnostics above.'], 502);
    json_response(['success' => true]);
}

function handle_admin_unsubscribe(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = (int)($body['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT id FROM leads WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->fetch()) json_response(['error' => 'Lead not found.'], 404);
    $pdo->prepare("UPDATE leads SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?")->execute([date('Y-m-d H:i:s'), $id]);
    json_response(['success' => true]);
}

// Deletes the lead record entirely and deactivates its promo code (rather
// than leaving an orphaned, still-usable code with no lead behind it).
function handle_admin_delete(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = (int)($body['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT * FROM leads WHERE id = ?');
    $stmt->execute([$id]);
    $lead = $stmt->fetch();
    if (!$lead) json_response(['error' => 'Lead not found.'], 404);
    if ($lead['promo_code']) {
        $pdo->prepare('UPDATE promo_codes SET active = 0 WHERE code = ?')->execute([$lead['promo_code']]);
    }
    $pdo->prepare('DELETE FROM leads WHERE id = ?')->execute([$id]);
    json_response(['success' => true]);
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
        ? "You've been unsubscribed from these offer emails. Your code still works if you decide to book later."
        : "That unsubscribe link isn't valid or has already been used.";
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>Unsubscribed — ' . $siteName . '</title>'
        . '<style>body{margin:0;background:#EFEAE0;color:#1C2430;font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;box-sizing:border-box;}'
        . '.card{background:#FBF9F4;border:1px solid #CFC7B4;border-radius:8px;padding:32px;max-width:460px;text-align:center;}h1{font-size:1.4rem;margin:0 0 10px;color:#1F3F38;}p{line-height:1.55;color:#4b5563;}a{color:#2F5D53;}</style></head>'
        . '<body><div class="card"><h1>' . $siteName . '</h1><p>' . $message . '</p><p><a href="' . $siteUrl . '/">Back to the site</a></p></div></body></html>';
    exit;
}
