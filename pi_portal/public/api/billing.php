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
require_once __DIR__ . '/../../app/stripe.php';

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

// Extra locations a plan would bill for, given the practice's active
// locations (none on plans without multiple locations).
function extras_needed(array $p, string $plan): int {
    return plan_has_feature($plan, 'locations') ? max(0, active_location_count((int)$p['id']) - LOCATIONS_INCLUDED) : 0;
}
// The plan plus its extra locations, per billing period.
function bill_amount(array $p, string $plan, string $interval): float {
    return plan_amount($plan, $interval) + extras_needed($p, $plan) * extra_location_amount($interval);
}

// For a subscribed practice: roughly what switching to each plan costs today
// (the prorated difference for the rest of the billing period), so the
// button can say so. Stripe calculates the exact amount.
function change_preview(array $p): ?array {
    if (empty($p['stripe_subscription_id']) || !in_array($p['subscription_status'], ['active', 'past_due'], true)) return null;
    $interval = $p['billing_interval'] ?: 'monthly';
    // Subscribed during the free trial and kept the free days: the first
    // billing period ends when the trial does.
    [$left, $inTrial] = period_left($p);
    $cur = plan_amount((string)$p['plan'], $interval) + (int)$p['extra_locations'] * extra_location_amount($interval);
    $out = [];
    foreach (BILLING_INTERVALS as $i) foreach (array_keys(PLANS) as $k) {
        if ($k === $p['plan'] && $i === $interval) continue;
        $diff = bill_amount($p, $k, $i) - $cur;
        // A change of billing period starts a new period, charged in full
        // less the unused part of the current one.
        $today = $inTrial ? 0 : ($i === $interval ? max(0, $diff * $left) : max(0, bill_amount($p, $k, $i) - $cur * $left));
        $out[$k][$i] = ['upgrade' => plan_rank($k) > plan_rank((string)$p['plan']) || ($i === 'annual' && $interval === 'monthly'), 'today' => round($today, 2),
            'credit' => !$inTrial && $diff < 0 && $i === $interval ? round(-$diff * $left, 2) : 0, 'extraLocations' => extras_needed($p, $k),
            'available' => stripe_price_id($k, $i) && (!extras_needed($p, $k) || stripe_price_id('location', $i))];
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
    $item = sub_plan_item($sub);
    if (!$item) json_response(['error' => 'Billing is temporarily unavailable. Please try again.'], 502);
    if (($item['price']['id'] ?? '') === $price) json_response(['error' => 'You are already on that plan.'], 400);
    // Extra locations follow the plan: billed on Platinum (at the new
    // billing period's price), dropped on plans without multiple locations.
    $extras = extras_needed($p, $plan);
    $locPrice = stripe_price_id('location', $interval);
    if ($extras && !$locPrice) json_response(['error' => 'Extra locations can\'t be billed online for that billing period yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
    $locItem = sub_location_item($sub);
    $up = plan_rank($plan) > plan_rank((string)$p['plan']) || ($interval === 'annual' && $p['billing_interval'] === 'monthly') || $extras > (int)$p['extra_locations'];
    $trialing = ($sub['status'] ?? '') === 'trialing';
    $params = ['items[0][id]' => $item['id'], 'items[0][price]' => $price,
        'proration_behavior' => $trialing ? 'none' : ($up ? 'always_invoice' : 'create_prorations'), 'expand[0]' => 'latest_invoice'];
    if ($locItem && !$extras) $params += ['items[1][id]' => $locItem['id'], 'items[1][deleted]' => 'true'];
    elseif ($locItem) $params += ['items[1][id]' => $locItem['id'], 'items[1][price]' => $locPrice, 'items[1][quantity]' => $extras];
    elseif ($extras) $params += ['items[1][price]' => $locPrice, 'items[1][quantity]' => $extras];
    // Charges apply only once paid (Stripe can't hold back a removal, so a
    // change that drops the add-on is applied as is).
    if (!isset($params['items[1][deleted]'])) $params['payment_behavior'] = 'pending_if_incomplete';
    $new = stripe_api('POST', 'subscriptions/' . $p['stripe_subscription_id'], $params);
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

// Add (or drop) paid extra locations on a live subscription — used when
// adding a location beyond the allowance. Body: {quantity}.
function handle_locations_change() {
    require_method('POST');
    $user = require_user('users.manage');
    require_feature('locations');
    if (!stripe_ready()) json_response(['error' => 'Online billing is not set up yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
    $p = current_practice();
    if (empty($p['stripe_subscription_id']) || !in_array($p['subscription_status'], ['active', 'past_due'], true)) json_response(['error' => 'Choose a plan first.'], 400);
    $qty = (int)(json_body()['quantity'] ?? -1);
    $min = max(0, active_location_count((int)$p['id']) - LOCATIONS_INCLUDED);
    if ($qty < $min || $qty > 200) json_response(['error' => $qty < $min ? "You have $min extra active location" . ($min === 1 ? '' : 's') . ' — turn one off first.' : 'Contact us for that many locations.'], 400);
    $before = (int)$p['extra_locations'];
    $r = set_extra_locations($p, $qty);
    if (!empty($r['pending'])) {
        audit('billing_locations_pending', 'practice', $p['id'], null, $user, "$before → $qty");
        json_response(['pending' => true, 'payUrl' => $r['payUrl'], 'error' => 'The payment didn\'t go through, so the location wasn\'t added. Complete the payment and try again.'], 402);
    }
    audit('billing_locations', 'practice', $p['id'], null, $user, "extra locations $before → $qty");
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
        // (extra locations, if any, are added just below)
        'subscription_data[metadata][practice_id]' => $p['id'], 'subscription_data[metadata][plan]' => $plan,
        'subscription_data[metadata][interval]' => $interval,
        'success_url' => APP_URL . '/app.html#/billing?done=1', 'cancel_url' => APP_URL . '/app.html#/billing',
    ];
    // Locations beyond those Platinum includes are billed from the start.
    if ($extras = extras_needed($p, $plan)) {
        $locPrice = stripe_price_id('location', $interval);
        if (!$locPrice) json_response(['error' => 'Extra locations can\'t be billed online yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
        $params += ['line_items[1][price]' => $locPrice, 'line_items[1][quantity]' => $extras];
    }
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
    case 'locations_change': handle_locations_change(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
