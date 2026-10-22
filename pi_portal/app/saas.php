<?php
// Membership: brand, plans, trial/subscription state and plan limits.
// Each plan needs a matching monthly recurring Price in Stripe (IDs go in
// secrets.php). Change a price here AND in Stripe — existing subscribers
// keep the Stripe price they signed up on until moved.

if (!defined('BRAND_NAME')) define('BRAND_NAME', 'InjuryCase');
if (!defined('BRAND_TAGLINE')) define('BRAND_TAGLINE', 'Personal injury case management for providers');
if (!defined('SUPPORT_EMAIL')) define('SUPPORT_EMAIL', 'support@injurycase.com');

define('TRIAL_DAYS', 14);
// Bump when the Business Associate Agreement or Terms text changes; the
// practice owner is asked to accept the new version.
define('BAA_VERSION', '2026-10');

const PLANS = [
    'solo'     => ['name' => 'Solo',     'price' => 39,  'active_cases' => 75,   'users' => 3,    'blurb' => 'One doctor and front desk'],
    'practice' => ['name' => 'Practice', 'price' => 59, 'active_cases' => 300,  'users' => 10,   'blurb' => 'A busy PI clinic'],
    'group'    => ['name' => 'Group',    'price' => 79, 'active_cases' => null, 'users' => null, 'blurb' => 'Multiple doctors or locations'],
];

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
        'ehrName' => $p['ehr_name'] ?? null,
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
