<?php
// Public endpoints for outreach emails (no sign-in; the prospect's token
// in the link is the only key, and it reveals nothing but the practice's
// own public name).
//   GET  m.php?a=c&t=TOKEN&l=video|trial|site   tracked link → redirect
//   GET  m.php?a=info&t=TOKEN                    unsubscribe page details
//   POST m.php?a=u&t=TOKEN                       unsubscribe (the page's button,
//                                                and one-click List-Unsubscribe)
//   POST m.php?a=hook  (X-Webhook-Secret)        bounces / complaints from the
//                                                sending service: {email, type}
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/marketing.php';
header('X-Robots-Tag: noindex, nofollow');

$a = $_GET['a'] ?? '';
$p = mkt_prospect_by_token((string)($_GET['t'] ?? ''));

if ($a === 'c') {
    $s = mkt_settings();
    $l = (string)($_GET['l'] ?? 'site');
    $dest = APP_URL . '/';
    if ($l === 'video' && $s['video_url'] !== '') $dest = $s['video_url'];
    elseif ($l === 'trial') $dest = APP_URL . '/app.html#signup?' . http_build_query(array_filter(['ref' => $p['token'] ?? null, 'promo' => $s['promo'] ?: null]));
    if ($p) {
        mkt_log((int)$p['id'], 'click', $l);
        if (!$p['clicked_at']) mkt_set((int)$p['id'], ['clicked_at' => now_str()]);
    }
    header('Location: ' . $dest, true, 302);
    exit;
}

if ($a === 'info') {
    if (!$p) json_response(['error' => 'This unsubscribe link isn\'t valid. Reply to the email with "unsubscribe" and we\'ll remove you.'], 404);
    $e = (string)$p['email'];
    $masked = $e ? preg_replace('/^(.).*(@.*)$/', '$1•••$2', $e) : null;
    json_response(['email' => $masked, 'unsubscribed' => in_array($p['status'], ['unsubscribed'], true) || ($e && mkt_suppressed($e))]);
}

if ($a === 'u') {
    // A mail app that opens the List-Unsubscribe link in a browser lands on the page.
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: ' . APP_URL . '/unsubscribe.html?t=' . urlencode((string)($_GET['t'] ?? '')), true, 302); exit; }
    if (!$p) json_response(['error' => 'This unsubscribe link isn\'t valid. Reply to the email with "unsubscribe" and we\'ll remove you.'], 404);
    mkt_unsubscribe($p);
    json_response(['ok' => true]);
}

if ($a === 'hook') {
    require_method('POST');
    $secret = mkt_secret('MKT_WEBHOOK_SECRET');
    if ($secret === '' || !hash_equals($secret, (string)($_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? ''))) json_response(['error' => 'Forbidden'], 403);
    $b = json_body();
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $type = in_array($b['type'] ?? '', ['bounce', 'complaint', 'unsubscribe'], true) ? $b['type'] : null;
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !$type) json_response(['error' => 'Send {email, type: bounce|complaint|unsubscribe}'], 400);
    mkt_suppress($email, $type);
    $s = pi_db()->prepare('SELECT * FROM mkt_prospects WHERE email = ?'); $s->execute([$email]);
    foreach ($s->fetchAll() as $row) {
        if ($type === 'bounce') { mkt_set((int)$row['id'], ['status' => 'bounced', 'next_send_at' => null]); mkt_log((int)$row['id'], 'bounce', 'webhook'); }
        else mkt_unsubscribe($row, $type);
    }
    json_response(['ok' => true]);
}
json_response(['error' => 'Unknown action'], 400);
