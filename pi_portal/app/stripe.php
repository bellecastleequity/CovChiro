<?php
// Stripe REST helpers shared by billing (api/billing.php) and the
// locations screen (extra-location add-on). Stripe only ever receives the
// practice name, the admin's email and the practice id — no patient data.

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

// The plan item and the extra-locations item of a Stripe subscription.
function sub_location_item(array $sub): ?array {
    $ids = array_filter([stripe_price_id('location', 'monthly'), stripe_price_id('location', 'annual')]);
    foreach ($sub['items']['data'] ?? [] as $it) if (in_array($it['price']['id'] ?? '', $ids, true)) return $it;
    return null;
}
function sub_plan_item(array $sub): ?array {
    $loc = sub_location_item($sub);
    foreach ($sub['items']['data'] ?? [] as $it) if (plan_for_price($it['price']['id'] ?? null)) return $it;
    foreach ($sub['items']['data'] ?? [] as $it) if (!$loc || $it['id'] !== $loc['id']) return $it;
    return null;
}

// Share of the current billing period still to run (0..1), and whether the
// practice is in a free trial it kept when subscribing (nothing charged yet).
function period_left(array $p): array {
    $now = time();
    $interval = $p['billing_interval'] ?: 'monthly';
    $end = $p['current_period_end'] ? strtotime($p['current_period_end']) : $now;
    $inTrial = $p['trial_ends_at'] && strtotime($p['trial_ends_at']) > $now && abs($end - strtotime($p['trial_ends_at'])) < 86400;
    return [max(0, min(1, ($end - $now) / (($interval === 'annual' ? 365 : 30.44) * 86400))), $inTrial];
}

// Sets the number of paid extra locations on a live subscription. Adding
// charges the prorated amount now and applies only once paid; removing
// credits the unused part to the next bill. Returns the updated
// subscription, or ['pending' => true, 'payUrl' => ...] if the payment
// didn't go through.
function set_extra_locations(array $p, int $qty): array {
    $interval = $p['billing_interval'] ?: 'monthly';
    $price = stripe_price_id('location', $interval);
    if (!$price) json_response(['error' => 'Extra locations can\'t be added online yet. Contact ' . SUPPORT_EMAIL . '.'], 400);
    $sub = stripe_api('GET', 'subscriptions/' . $p['stripe_subscription_id']);
    $item = sub_location_item($sub);
    $have = (int)($item['quantity'] ?? 0);
    if ($qty === $have) return $sub;
    $up = $qty > $have;
    $trialing = ($sub['status'] ?? '') === 'trialing';
    $params = ['proration_behavior' => $trialing ? 'none' : ($up ? 'always_invoice' : 'create_prorations'), 'expand[0]' => 'latest_invoice'];
    if ($item && $qty === 0) $params += ['items[0][id]' => $item['id'], 'items[0][deleted]' => 'true'];
    elseif ($item) $params += ['items[0][id]' => $item['id'], 'items[0][quantity]' => $qty, 'items[0][price]' => $price];
    else $params += ['items[0][price]' => $price, 'items[0][quantity]' => $qty];
    if ($up) $params['payment_behavior'] = 'pending_if_incomplete';
    $new = stripe_api('POST', 'subscriptions/' . $p['stripe_subscription_id'], $params);
    if (!empty($new['pending_update'])) return ['pending' => true, 'payUrl' => $new['latest_invoice']['hosted_invoice_url'] ?? null];
    apply_subscription($new);
    return $new;
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
    $planItem = sub_plan_item($sub);
    $priceId = $planItem['price']['id'] ?? null;
    [$plan, $interval] = plan_for_price($priceId) ?? [$sub['metadata']['plan'] ?? null, $sub['metadata']['interval'] ?? null];
    if (!in_array($interval, BILLING_INTERVALS, true)) $interval = ($planItem['price']['recurring']['interval'] ?? 'month') === 'year' ? 'annual' : 'monthly';
    $periodEnd = $sub['current_period_end'] ?? ($planItem['current_period_end'] ?? null);
    // Paid extra locations: the quantity of the location add-on item.
    $extra = (int)(sub_location_item($sub)['quantity'] ?? 0);
    // A subscription started during the free trial keeps the trial's end
    // date (the first charge); a subscription that has ended is detached so
    // the practice can subscribe again.
    $trialEnd = !empty($sub['trial_end']) && $sub['status'] === 'trialing' ? date('Y-m-d H:i:s', (int)$sub['trial_end']) : null;
    $sql = 'UPDATE practices SET subscription_status = ?, stripe_subscription_id = ?, stripe_customer_id = ?, current_period_end = ?, billing_interval = ?, extra_locations = ?'
        . ($trialEnd ? ', trial_ends_at = ?' : '') . ($plan && isset(PLANS[$plan]) ? ', plan = ?' : '') . ' WHERE id = ? AND subscription_status <> "comped"';
    $args = [$status, $status === 'canceled' ? null : $sub['id'], $sub['customer'], $periodEnd ? date('Y-m-d H:i:s', (int)$periodEnd) : null, $interval, $status === 'canceled' ? 0 : $extra];
    if ($trialEnd) $args[] = $trialEnd;
    if ($plan && isset(PLANS[$plan])) $args[] = $plan;
    $args[] = $practiceId;
    pi_db()->prepare($sql)->execute($args);
    audit('billing_' . $status, 'practice', $practiceId, null, ['id' => null, 'email' => 'stripe', 'practice_id' => $practiceId], trim($plan . ' ' . $interval));
}

