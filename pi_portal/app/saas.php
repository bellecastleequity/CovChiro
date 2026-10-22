<?php
// Membership: brand, plans, trial/subscription state and plan limits.
// Each plan needs a matching monthly recurring Price in Stripe (IDs go in
// secrets.php). Change a price here AND in Stripe — existing subscribers
// keep the Stripe price they signed up on until moved.

if (!defined('BRAND_NAME')) define('BRAND_NAME', 'InjuryCase');
if (!defined('BRAND_TAGLINE')) define('BRAND_TAGLINE', 'Personal injury case management for providers');
if (!defined('SUPPORT_EMAIL')) define('SUPPORT_EMAIL', 'support@injurycase.com');
if (!defined('APP_URL')) define('APP_URL', 'https://injurycase.com');

define('TRIAL_DAYS', 14);
// Annual billing: pay for 10 months, get 12 ("2 months free").
define('ANNUAL_MONTHS_CHARGED', 10);
const BILLING_INTERVALS = ['monthly', 'annual'];
// Bump when the Business Associate Agreement or Terms text changes; the
// practice owner is asked to accept the new version.
define('BAA_VERSION', '2026-10');

const PLANS = [
    'solo'     => ['name' => 'Solo',     'price' => 39,  'active_cases' => 75,   'users' => 3,    'blurb' => 'One doctor and front desk'],
    'practice' => ['name' => 'Practice', 'price' => 59, 'active_cases' => 300,  'users' => 10,   'blurb' => 'A busy PI clinic'],
    'group'    => ['name' => 'Group',    'price' => 79, 'active_cases' => null, 'users' => null, 'blurb' => 'Multiple doctors or locations'],
];

// Plans as shown to customers, with the annual price.
function plans_public(): array {
    $out = [];
    foreach (PLANS as $k => $p) $out[$k] = $p + ['annual_price' => $p['price'] * ANNUAL_MONTHS_CHARGED];
    return $out;
}

// The Stripe Price for a plan and interval. STRIPE_PRICES maps each plan to
// ['monthly' => 'price_...', 'annual' => 'price_...'] (a plain string is a
// monthly price, from before annual billing).
function stripe_price_id(string $plan, string $interval): ?string {
    if (!defined('STRIPE_PRICES')) return null;
    $v = STRIPE_PRICES[$plan] ?? null;
    if (is_string($v)) return $interval === 'monthly' && $v !== '' ? $v : null;
    return !empty($v[$interval]) ? $v[$interval] : null;
}

// [plan, interval] for a Stripe Price id, or null.
function plan_for_price(?string $priceId): ?array {
    if (!$priceId || !defined('STRIPE_PRICES')) return null;
    foreach (array_keys(PLANS) as $plan) foreach (BILLING_INTERVALS as $i) if (stripe_price_id($plan, $i) === $priceId) return [$plan, $i];
    return null;
}

function plan_for(array $practice): array {
    return PLANS[$practice['plan']] ?? PLANS['solo'];
}

// 'full' or 'read_only'. A practice whose trial ended or subscription was
// canceled keeps READ access to its records — they're the practice's
// medical records and the BAA obliges us to return them — but can't add
// or change anything until it subscribes again.
function practice_access(array $p): string {
    switch ($p['subscription_status']) {
        case 'active': case 'comped': case 'past_due': return 'full';
        case 'trialing': return ($p['trial_ends_at'] && strtotime($p['trial_ends_at']) > time()) ? 'full' : 'read_only';
        default: return 'read_only';
    }
}

function practice_summary(array $p): array {
    $plan = plan_for($p);
    $daysLeft = $p['subscription_status'] === 'trialing' && $p['trial_ends_at'] ? max(0, (int)ceil((strtotime($p['trial_ends_at']) - time()) / 86400)) : null;
    return [
        'id' => (int)$p['id'], 'name' => $p['name'], 'plan' => $p['plan'], 'planName' => $plan['name'],
        'status' => $p['subscription_status'], 'access' => practice_access($p), 'trialDaysLeft' => $daysLeft,
        'currentPeriodEnd' => $p['current_period_end'], 'baaCurrent' => $p['baa_version'] === BAA_VERSION,
        'limits' => ['activeCases' => $plan['active_cases'], 'users' => $plan['users']],
        'ehrName' => $p['ehr_name'] ?? null, 'interval' => $p['billing_interval'] ?? 'monthly',
        'trialEndsAt' => $p['trial_ends_at'], 'subscribed' => !empty($p['stripe_subscription_id']),
    ];
}

function active_case_count(int $practiceId): int {
    $stmt = pi_db()->prepare("SELECT COUNT(*) FROM cases WHERE practice_id = ? AND archived_at IS NULL AND stage IN ('" . implode("','", OPEN_STAGES) . "')");
    $stmt->execute([$practiceId]);
    return (int)$stmt->fetchColumn();
}

function active_user_count(int $practiceId): int {
    $stmt = pi_db()->prepare('SELECT COUNT(*) FROM users WHERE practice_id = ? AND active = 1');
    $stmt->execute([$practiceId]);
    return (int)$stmt->fetchColumn();
}

function enforce_limit(string $what) {
    $p = current_practice();
    $plan = plan_for($p);
    if ($what === 'cases' && $plan['active_cases'] !== null && active_case_count((int)$p['id']) >= $plan['active_cases']) {
        json_response(['error' => "Your {$plan['name']} plan includes {$plan['active_cases']} open cases. Close finished cases or upgrade under Billing.", 'code' => 'limit'], 402);
    }
    if ($what === 'users' && $plan['users'] !== null && active_user_count((int)$p['id']) >= $plan['users']) {
        json_response(['error' => "Your {$plan['name']} plan includes {$plan['users']} users. Deactivate a user or upgrade under Billing.", 'code' => 'limit'], 402);
    }
}

function create_practice(string $name, string $plan = 'solo', string $status = 'trialing'): int {
    pi_db()->prepare('INSERT INTO practices (name, plan, subscription_status, trial_ends_at, created_at) VALUES (?,?,?,?,?)')
        ->execute([$name, isset(PLANS[$plan]) ? $plan : 'solo', $status, date('Y-m-d H:i:s', time() + TRIAL_DAYS * 86400), now_str()]);
    return (int)pi_db()->lastInsertId();
}
