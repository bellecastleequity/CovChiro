<?php
// Membership billing through Stripe Checkout and the Stripe Customer
// Portal. Stripe only ever receives the practice name, the admin's email
// and the practice id — no patient data.
//
// Webhook URL to register in Stripe: https://<app>/api/billing.php?action=webhook
// Events: checkout.session.completed, customer.subscription.created,
// customer.subscription.updated, customer.subscription.deleted
define('PI_ALLOW_WHEN_LAPSED', true);
require_once __DIR__ . '/../../app/bootstrap.php';

$action = $_GET['action'] ?? '';
// The webhook is called by Stripe, not a browser: no session, no CSRF —
// it's authenticated by its signature instead.
if ($action === 'webhook') { handle_webhook(); exit; }
pi_start_session();
switch ($action) {
    case 'status': handle_status(); break;
    case 'checkout': handle_checkout(); break;
    case 'portal': handle_portal(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function stripe_ready(): bool {
    return defined('STRIPE_SECRET_KEY') && strpos(STRIPE_SECRET_KEY, 'sk_') === 0 && strlen(STRIPE_SECRET_KEY) > 12 && defined('STRIPE_PRICES');
}

// Minimal Stripe REST client (form-encoded, as Stripe's API expects).
function stripe_api(string $method, string $path, array $params = []): array {
    $ch = curl_init('https://api.stripe.com/v1/' . $path . ($method === 'GET' && $params ? '?' . http_build_query($params) : ''));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_USERPWD => STRIPE_SECRET_KEY . ':',
        CURLOPT_CUSTOMREQUEST => $method,
    ]);
    if ($method !== 'GET') curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $data = json_decode((string)$body, true) ?: [];
    if ($code >= 400 || !$body) {
        pi_log_error('Stripe ' . $method . ' ' . $path . ' failed: HTTP ' . $code . ' ' . ($data['error']['message'] ?? 'no body'));
        json_response(['error' => 'Billing is temporarily unavailable. Please try again.'], 502);
    }
    return $data;
}

function handle_status() {
    require_user('users.manage');
    $p = current_practice();
    $plans = [];
    foreach (PLANS as $k => $v) $plans[$k] = $v + ['available' => stripe_ready() && !empty(STRIPE_PRICES[$k])];
    json_response([
        'practice' => practice_summary($p) + ['activeCases' => active_case_count((int)$p['id']), 'activeUsers' => active_user_count((int)$p['id'])],
        'plans' => $plans, 'billingReady' => stripe_ready(), 'hasCustomer' => (bool)$p['stripe_customer_id'],
    ]);
}

function handle_checkout() {
    require_method('POST');
    $user = require_user('users.manage');
    if (!stripe_ready()) json_response(['error' => 'Online billing is not set up yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
    $plan = json_body()['plan'] ?? '';
    if (empty(STRIPE_PRICES[$plan])) json_response(['error' => 'Unknown plan'], 400);
    $p = current_practice();
    if (!$p['stripe_customer_id']) {
        $c = stripe_api('POST', 'customers', ['name' => $p['name'], 'email' => $user['email'], 'metadata[practice_id]' => $p['id']]);
        pi_db()->prepare('UPDATE practices SET stripe_customer_id = ? WHERE id = ?')->execute([$c['id'], $p['id']]);
        $p['stripe_customer_id'] = $c['id'];
    }
    $session = stripe_api('POST', 'checkout/sessions', [
        'mode' => 'subscription', 'customer' => $p['stripe_customer_id'], 'client_reference_id' => $p['id'],
        'line_items[0][price]' => STRIPE_PRICES[$plan], 'line_items[0][quantity]' => 1,
        'subscription_data[metadata][practice_id]' => $p['id'], 'subscription_data[metadata][plan]' => $plan,
        'success_url' => APP_URL . '/app.html#/billing?done=1', 'cancel_url' => APP_URL . '/app.html#/billing',
        'allow_promotion_codes' => 'true',
    ]);
    audit('billing_checkout', 'practice', $p['id'], null, $user, $plan);
    json_response(['url' => $session['url']]);
}

function handle_portal() {
    require_method('POST');
    $user = require_user('users.manage');
    $p = current_practice();
    if (!stripe_ready() || !$p['stripe_customer_id']) json_response(['error' => 'No billing account yet — choose a plan first.'], 400);
    $s = stripe_api('POST', 'billing_portal/sessions', ['customer' => $p['stripe_customer_id'], 'return_url' => APP_URL . '/app.html#/billing']);
    audit('billing_portal', 'practice', $p['id'], null, $user);
    json_response(['url' => $s['url']]);
}

// ---------- webhook ----------
function verify_stripe_signature(string $payload, string $header): bool {
    if (!defined('STRIPE_WEBHOOK_SECRET')) return false;
    $parts = [];
    foreach (explode(',', $header) as $kv) { [$k, $v] = array_pad(explode('=', $kv, 2), 2, ''); $parts[$k][] = $v; }
    $t = (int)($parts['t'][0] ?? 0);
    if (!$t || abs(time() - $t) > 300) return false;
    $expected = hash_hmac('sha256', $t . '.' . $payload, STRIPE_WEBHOOK_SECRET);
    foreach ($parts['v1'] ?? [] as $sig) if (hash_equals($expected, $sig)) return true;
    return false;
}

function apply_subscription(array $sub) {
    $practiceId = (int)($sub['metadata']['practice_id'] ?? 0);
    if (!$practiceId) {
        $s = pi_db()->prepare('SELECT id FROM practices WHERE stripe_customer_id = ?');
        $s->execute([$sub['customer']]);
        $practiceId = (int)$s->fetchColumn();
    }
    if (!$practiceId) return;
    $statusMap = ['active' => 'active', 'trialing' => 'active', 'past_due' => 'past_due', 'unpaid' => 'past_due', 'incomplete' => 'past_due',
        'canceled' => 'canceled', 'incomplete_expired' => 'canceled', 'paused' => 'canceled'];
    $status = $statusMap[$sub['status']] ?? 'past_due';
    // Plan comes from the price actually subscribed to, so plan changes
    // made in the Stripe portal are picked up too.
    $priceId = $sub['items']['data'][0]['price']['id'] ?? null;
    $plan = array_search($priceId, STRIPE_PRICES, true) ?: ($sub['metadata']['plan'] ?? null);
    $periodEnd = $sub['current_period_end'] ?? ($sub['items']['data'][0]['current_period_end'] ?? null);
    $sql = 'UPDATE practices SET subscription_status = ?, stripe_subscription_id = ?, stripe_customer_id = ?, current_period_end = ?' . ($plan && isset(PLANS[$plan]) ? ', plan = ?' : '') . ' WHERE id = ? AND subscription_status <> "comped"';
    $args = [$status, $sub['id'], $sub['customer'], $periodEnd ? date('Y-m-d H:i:s', (int)$periodEnd) : null];
    if ($plan && isset(PLANS[$plan])) $args[] = $plan;
    $args[] = $practiceId;
    pi_db()->prepare($sql)->execute($args);
    audit('billing_' . $status, 'practice', $practiceId, null, ['id' => null, 'email' => 'stripe', 'practice_id' => $practiceId], $plan);
}

function handle_webhook() {
    $payload = file_get_contents('php://input');
    if (!stripe_ready() || !verify_stripe_signature($payload, $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '')) {
        http_response_code(400);
        echo 'bad signature';
        return;
    }
    $event = json_decode($payload, true);
    $obj = $event['data']['object'] ?? [];
    switch ($event['type'] ?? '') {
        case 'checkout.session.completed':
            if (!empty($obj['subscription'])) apply_subscription(stripe_api('GET', 'subscriptions/' . $obj['subscription']));
            break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
            apply_subscription($obj);
            break;
    }
    http_response_code(200);
    echo 'ok';
}
