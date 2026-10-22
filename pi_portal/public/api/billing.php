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

function stripe_ready(): bool {
    return defined('STRIPE_SECRET_KEY') && strpos(STRIPE_SECRET_KEY, 'sk_') === 0 && strlen(STRIPE_SECRET_KEY) > 12 && defined('STRIPE_PRICES');
}

// Stripe needs a trial end at least 48 hours away; with less left, billing
// simply starts now.
const STRIPE_MIN_TRIAL_SECONDS = 49 * 3600;
function remaining_trial_end(array $p): ?int {
    if ($p['subscription_status'] !== 'trialing' || !$p['trial_ends_at']) return null;
    $end = strtotime($p['trial_ends_at']);
    return $end - time() >= STRIPE_MIN_TRIAL_SECONDS ? $end : null;
}

// Minimal Stripe REST client (form-encoded, as Stripe's API expects).
function stripe_api(string $method, string $path, array $params = []): array {
    // STRIPE_API_BASE exists only so tests can point at a local stand-in.
    $ch = curl_init((defined('STRIPE_API_BASE') ? STRIPE_API_BASE : 'https://api.stripe.com/v1/') . $path . ($method === 'GET' && $params ? '?' . http_build_query($params) : ''));
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
    foreach (plans_public() as $k => $v) $plans[$k] = $v + ['available' => stripe_ready() && stripe_price_id($k, 'monthly'), 'availableAnnual' => stripe_ready() && stripe_price_id($k, 'annual')];
    $keep = remaining_trial_end($p);
    json_response([
        'practice' => practice_summary($p) + ['activeCases' => active_case_count((int)$p['id']), 'activeUsers' => active_user_count((int)$p['id'])],
        'plans' => $plans, 'billingReady' => stripe_ready(), 'hasCustomer' => (bool)$p['stripe_customer_id'],
        'annualMonthsCharged' => ANNUAL_MONTHS_CHARGED,
        // When a card added now would first be charged.
        'firstCharge' => $keep ? date('Y-m-d', $keep) : null,
        'changePreview' => change_preview($p),
    ]);
}

function plan_amount(string $plan, string $interval): float {
    return (float)($interval === 'annual' ? PLANS[$plan]['price'] * ANNUAL_MONTHS_CHARGED : PLANS[$plan]['price']);
}

// For a subscribed practice: roughly what switching to each plan costs today
// (the prorated difference for the rest of the billing period), so the
// button can say so. Stripe calculates the exact amount.
function change_preview(array $p): ?array {
    if (empty($p['stripe_subscription_id']) || !in_array($p['subscription_status'], ['active', 'past_due'], true)) return null;
    $now = time();
    $interval = $p['billing_interval'] ?: 'monthly';
    $end = $p['current_period_end'] ? strtotime($p['current_period_end']) : $now;
    // Subscribed during the free trial and kept the free days: the first
    // billing period ends when the trial does.
    $inTrial = $p['trial_ends_at'] && strtotime($p['trial_ends_at']) > $now && abs($end - strtotime($p['trial_ends_at'])) < 86400;
    $left = max(0, min(1, ($end - $now) / (($interval === 'annual' ? 365 : 30.44) * 86400)));
    $out = [];
    foreach (BILLING_INTERVALS as $i) foreach (array_keys(PLANS) as $k) {
        if ($k === $p['plan'] && $i === $interval) continue;
        $diff = plan_amount($k, $i) - plan_amount((string)$p['plan'], $interval);
        // A change of billing period starts a new period, charged in full
        // less the unused part of the current one.
        $today = $inTrial ? 0 : ($i === $interval ? max(0, $diff * $left) : max(0, plan_amount($k, $i) - plan_amount((string)$p['plan'], $interval) * $left));
        $out[$k][$i] = ['upgrade' => plan_rank($k) > plan_rank((string)$p['plan']) || ($i === 'annual' && $interval === 'monthly'), 'today' => round($today, 2),
            'credit' => !$inTrial && $diff < 0 && $i === $interval ? round(-$diff * $left, 2) : 0, 'available' => (bool)stripe_price_id($k, $i)];
    }
    return ['plan' => $p['plan'], 'interval' => $interval, 'inTrial' => $inTrial, 'periodEnd' => $p['current_period_end'], 'options' => $out];
}

// Switch a live subscription to another plan or billing period.
// Upgrades charge the prorated difference straight away and take effect as
// soon as that payment goes through (Stripe applies the change only once
// paid); downgrades take effect at once and the unused amount is credited
// to the next bill. During a kept free trial, nothing is charged.
function handle_change_plan() {
    require_method('POST');
    $user = require_user('users.manage');
    if (!stripe_ready()) json_response(['error' => 'Online billing is not set up yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
    $p = current_practice();
    if (empty($p['stripe_subscription_id']) || !in_array($p['subscription_status'], ['active', 'past_due'], true)) json_response(['error' => 'Choose a plan first — there is no subscription to change yet.'], 400);
    $b = json_body();
    $plan = (string)($b['plan'] ?? '');
    $interval = in_array($b['interval'] ?? '', BILLING_INTERVALS, true) ? $b['interval'] : ($p['billing_interval'] ?: 'monthly');
    $price = isset(PLANS[$plan]) ? stripe_price_id($plan, $interval) : null;
    if (!$price) json_response(['error' => 'That plan isn\'t available.'], 400);
    $sub = stripe_api('GET', 'subscriptions/' . $p['stripe_subscription_id']);
    $item = $sub['items']['data'][0] ?? null;
    if (!$item) json_response(['error' => 'Billing is temporarily unavailable. Please try again.'], 502);
    if (($item['price']['id'] ?? '') === $price) json_response(['error' => 'You are already on that plan.'], 400);
    $up = plan_rank($plan) > plan_rank((string)$p['plan']) || ($interval === 'annual' && $p['billing_interval'] === 'monthly');
    $trialing = ($sub['status'] ?? '') === 'trialing';
    $new = stripe_api('POST', 'subscriptions/' . $p['stripe_subscription_id'], [
        'items[0][id]' => $item['id'], 'items[0][price]' => $price,
        'proration_behavior' => $trialing ? 'none' : ($up ? 'always_invoice' : 'create_prorations'),
        'payment_behavior' => 'pending_if_incomplete', 'expand[0]' => 'latest_invoice',
    ]);
    $detail = ($p['plan'] . ' ' . $p['billing_interval']) . ' → ' . $plan . ' ' . $interval;
    if (!empty($new['pending_update'])) {
        // Payment didn't go through (declined, or the bank wants
        // confirmation): nothing changes until it's paid.
        audit('billing_change_pending', 'practice', $p['id'], null, $user, $detail);
        json_response(['pending' => true, 'payUrl' => $new['latest_invoice']['hosted_invoice_url'] ?? null,
            'error' => 'The payment for the difference didn\'t go through, so your plan hasn\'t changed yet. Complete the payment and the new plan starts immediately.'], 402);
    }
    apply_subscription($new);
    audit('billing_change_plan', 'practice', $p['id'], null, $user, $detail);
    $s = pi_db()->prepare('SELECT * FROM practices WHERE id = ?'); $s->execute([$p['id']]);
    json_response(['ok' => true, 'practice' => practice_summary($s->fetch())]);
}

function handle_checkout() {
    require_method('POST');
    $user = require_user('users.manage');
    if (!stripe_ready()) json_response(['error' => 'Online billing is not set up yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
    $b = json_body();
    $plan = (string)($b['plan'] ?? '');
    $interval = in_array($b['interval'] ?? '', BILLING_INTERVALS, true) ? $b['interval'] : 'monthly';
    $price = isset(PLANS[$plan]) ? stripe_price_id($plan, $interval) : null;
    if (!$price) json_response(['error' => $interval === 'annual' ? 'Annual billing isn\'t available for that plan yet.' : 'Unknown plan'], 400);
    $p = current_practice();
    if ($p['stripe_subscription_id'] && in_array($p['subscription_status'], ['active', 'past_due'], true)) {
        json_response(['error' => 'You already have a subscription — change plan or billing period under "Manage billing".'], 400);
    }
    if (!$p['stripe_customer_id']) {
        $c = stripe_api('POST', 'customers', ['name' => $p['name'], 'email' => $user['email'], 'metadata[practice_id]' => $p['id']]);
        pi_db()->prepare('UPDATE practices SET stripe_customer_id = ? WHERE id = ?')->execute([$c['id'], $p['id']]);
        $p['stripe_customer_id'] = $c['id'];
    }
    $params = [
        'mode' => 'subscription', 'customer' => $p['stripe_customer_id'], 'client_reference_id' => $p['id'],
        'line_items[0][price]' => $price, 'line_items[0][quantity]' => 1,
        'subscription_data[metadata][practice_id]' => $p['id'], 'subscription_data[metadata][plan]' => $plan,
        'subscription_data[metadata][interval]' => $interval,
        'success_url' => APP_URL . '/app.html#/billing?done=1', 'cancel_url' => APP_URL . '/app.html#/billing',
    ];
    // A discount code entered at signup is applied here; otherwise Stripe
    // lets the customer type a Stripe promotion code (not both at once).
    $promo = practice_discount($p);
    // (Redeemed at signup, so only the plan limit is checked again here.)
    if ($promo && (!$promo['plans'] || in_array($plan, explode(',', $promo['plans']), true))) $params['discounts[0][coupon]'] = promo_stripe_coupon($promo);
    else $params['allow_promotion_codes'] = 'true';
    // Subscribing during the free trial keeps the remaining free days: the
    // card is first charged when the trial would have ended.
    if ($keep = remaining_trial_end($p)) $params['subscription_data[trial_end]'] = $keep;
    $session = stripe_api('POST', 'checkout/sessions', $params);
    audit('billing_checkout', 'practice', $p['id'], null, $user, "$plan $interval" . ($keep ? ' first charge ' . date('Y-m-d', $keep) : '') . (isset($params['discounts[0][coupon]']) ? ' promo ' . $promo['code'] : ''));
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
    [$plan, $interval] = plan_for_price($priceId) ?? [$sub['metadata']['plan'] ?? null, $sub['metadata']['interval'] ?? null];
    if (!in_array($interval, BILLING_INTERVALS, true)) $interval = ($sub['items']['data'][0]['price']['recurring']['interval'] ?? 'month') === 'year' ? 'annual' : 'monthly';
    $periodEnd = $sub['current_period_end'] ?? ($sub['items']['data'][0]['current_period_end'] ?? null);
    // A subscription started during the free trial keeps the trial's end
    // date (the first charge); a subscription that has ended is detached so
    // the practice can subscribe again.
    $trialEnd = !empty($sub['trial_end']) && $sub['status'] === 'trialing' ? date('Y-m-d H:i:s', (int)$sub['trial_end']) : null;
    $sql = 'UPDATE practices SET subscription_status = ?, stripe_subscription_id = ?, stripe_customer_id = ?, current_period_end = ?, billing_interval = ?'
        . ($trialEnd ? ', trial_ends_at = ?' : '') . ($plan && isset(PLANS[$plan]) ? ', plan = ?' : '') . ' WHERE id = ? AND subscription_status <> "comped"';
    $args = [$status, $status === 'canceled' ? null : $sub['id'], $sub['customer'], $periodEnd ? date('Y-m-d H:i:s', (int)$periodEnd) : null, $interval];
    if ($trialEnd) $args[] = $trialEnd;
    if ($plan && isset(PLANS[$plan])) $args[] = $plan;
    $args[] = $practiceId;
    pi_db()->prepare($sql)->execute($args);
    audit('billing_' . $status, 'practice', $practiceId, null, ['id' => null, 'email' => 'stripe', 'practice_id' => $practiceId], trim($plan . ' ' . $interval));
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

// Dispatch last, once the constants above are defined.
$action = $_GET['action'] ?? '';
// The webhook is called by Stripe, not a browser: no session, no CSRF —
// it's authenticated by its signature instead.
if ($action === 'webhook') { handle_webhook(); exit; }
pi_start_session();
switch ($action) {
    case 'status': handle_status(); break;
    case 'checkout': handle_checkout(); break;
    case 'portal': handle_portal(); break;
    case 'change_plan': handle_change_plan(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
