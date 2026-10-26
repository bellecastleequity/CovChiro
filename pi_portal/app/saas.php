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
define('BAA_VERSION', '2026-10-22');
// Bump when the Terms of Service or User Agreement change: every user
// (owner and sub-users alike) must accept the new version at next sign-in.
define('USER_TERMS_VERSION', '2026-10-23');

// Keys (solo / practice / group) are stored on practices and in Stripe
// metadata, so they stay fixed; the customer-facing names are the tiers.
const PLANS = [
    'solo'     => ['name' => 'Silver',   'price' => 39,  'active_cases' => 75,   'users' => 3,    'blurb' => 'One doctor and front desk'],
    'practice' => ['name' => 'Gold',     'price' => 59, 'active_cases' => 300,  'users' => 10,   'blurb' => 'A busy PI clinic'],
    'group'    => ['name' => 'Platinum', 'price' => 79, 'active_cases' => null, 'users' => null, 'blurb' => 'Multiple doctors or locations — under your own brand'],
    // A product of its own, not a tier: EOB Genie without case management.
    // Gold and Platinum include it; upgrading keeps everything.
    'eob'      => ['name' => 'EOB Genie', 'price' => 49, 'active_cases' => null, 'users' => 5, 'blurb' => 'Insurance EOBs, explained — upload, post and analyse auto / PIP EOBs',
                   'standalone' => true, 'features' => ['eob_genie']],
];

// ---------- features by plan ----------
// Plans are ordered tiers; each feature names the lowest plan that
// includes it, and every higher plan includes it too. To put a new
// feature on a tier, add it here and check has_feature() / require_feature()
// where it's used — the pricing pages, plan cards, upgrade prompts and
// enforcement all read this list. Features not listed are in every plan.
const PLAN_ORDER = ['solo', 'practice', 'group'];
function plan_standalone(string $plan): bool { return !empty(PLANS[$plan]['standalone']); }
const FEATURES = [
    'huddle' => ['name' => 'Daily huddle sheet', 'plan' => 'practice',
        'blurb' => "A printable morning team-meeting sheet of everything outstanding: tasks, gaps in care, patients behind plan, referrals due, insurance and attorney items."],
    'outside_estimates' => ['name' => 'Outside provider cost estimates', 'plan' => 'practice',
        'blurb' => "Estimate other facilities' bills (MRI, specialists, injections) from each case's referrals, so the policy-limits meter shows the whole picture."],
    'task_emails' => ['name' => 'Task email alerts', 'plan' => 'practice',
        'blurb' => "Email the right people when a task is marked urgent, goes late (with a reminder every few days) or is completed — no patient details in the email."],
    'auto_status' => ['name' => 'Automatic attorney status requests', 'plan' => 'practice',
        'blurb' => "Email the attorney or case manager every 30 days (or your interval) for a case and payment status update, with a secure one-minute reply form that updates the case for you."],
    'schedule_import' => ['name' => 'Daily appointment list upload', 'plan' => 'practice',
        'blurb' => "Upload yesterday's appointment list from any EHR (spreadsheet or PDF) and visits and no-shows are logged on every injury case automatically — so gaps in care and missed visits are flagged without double entry."],
    'eob_genie' => ['name' => 'EOB Genie — insurance EOBs, explained', 'plan' => 'practice',
        'blurb' => "Scan the day's auto / PIP EOBs and they're read, matched to each patient and posted for you — then see the money left on the table, fees set below the PIP fee schedule, overdue and late bills, when PIP will run out, and every insurer side by side."],
    'email_digest' => ['name' => 'Daily email digest', 'plan' => 'group',
        'blurb' => "A morning email to each team member with counts of what needs attention under the criteria they choose — no patient details in the email."],
    'locations' => ['name' => 'Multiple locations (2 included, then $29/month each)', 'plan' => 'group',
        'blurb' => "Run several offices in one account (2 locations included, each additional location $29/month): cases and visits by location, location letterheads, location and provider filters, and team members limited to their own location's patients."],
    'custom_steps' => ['name' => 'Custom case steps', 'plan' => 'group',
        'blurb' => "Add your office's own steps to every case's checklist, with due dates, alerts and huddle items."],
    'white_label' => ['name' => 'White label — your own brand', 'plan' => 'group',
        'blurb' => "Run it under your clinic's own name, logo and color: your team signs in at your own branded link, and attorneys see your brand on the status reply page and emails."],
];
// Shown on every plan card (in all plans).
const CORE_FEATURES = ['Case tracking & referral guide', 'Case suggestions & policy-limit warnings', 'EHR ledger uploads (any EHR)', 'Tasks, activity & audit log'];

function plan_rank(string $plan): int {
    $i = array_search($plan, PLAN_ORDER, true);
    return $i === false ? 0 : $i;
}

// The lowest plan that includes a feature ('solo' for unlisted features).
function feature_plan(string $feature): string {
    return FEATURES[$feature]['plan'] ?? PLAN_ORDER[0];
}

function plan_has_feature(string $plan, string $feature): bool {
    if (plan_standalone($plan)) return in_array($feature, PLANS[$plan]['features'], true);
    return plan_rank($plan) >= plan_rank(feature_plan($feature));
}

// Free trials include every feature, so clinics see the whole product;
// complimentary accounts also get everything. Otherwise it's the plan.
function has_feature(?array $practice, string $feature): bool {
    if (!$practice) return false;
    // A standalone product's trial is that product.
    if (plan_standalone((string)$practice['plan']) && $practice['subscription_status'] !== 'comped') return plan_has_feature((string)$practice['plan'], $feature);
    if (in_array($practice['subscription_status'], ['trialing', 'comped'], true)) return true;
    return plan_has_feature((string)$practice['plan'], $feature);
}

function practice_features(array $practice): array {
    return array_values(array_filter(array_keys(FEATURES), fn($f) => has_feature($practice, $f)));
}

// Ends the request with an upgrade message when the practice's plan
// doesn't include the feature.
function require_feature(string $feature): void {
    if (has_feature(current_practice(), $feature)) return;
    $plan = PLANS[feature_plan($feature)]['name'];
    $alone = array_keys(array_filter(PLANS, fn($p) => in_array($feature, $p['features'] ?? [], true)));
    json_response(['error' => FEATURES[$feature]['name'] . ' is included in the ' . $plan . ' plan' . (feature_plan($feature) !== PLAN_ORDER[count(PLAN_ORDER) - 1] ? ' and up' : '')
        . ($alone ? ' (or on its own as ' . PLANS[$alone[0]]['name'] . ', $' . PLANS[$alone[0]]['price'] . '/month)' : '') . '. Upgrade under Plan & billing.',
        'code' => 'upgrade', 'feature' => $feature, 'plan' => feature_plan($feature)], 403);
}

// Plans as shown to customers, with the annual price and which tiered
// features each includes.
function plans_public(): array {
    $out = [];
    foreach (PLANS as $k => $p) $out[$k] = $p + ['standalone' => false, 'annual_price' => $p['price'] * ANNUAL_MONTHS_CHARGED,
        'locations' => plan_has_feature($k, 'locations') ? ['included' => LOCATIONS_INCLUDED, 'extra_price' => EXTRA_LOCATION_PRICE] : null,
        'features' => array_map(fn($f, $d) => ['key' => $f, 'name' => $d['name'], 'included' => plan_has_feature($k, $f)], array_keys(FEATURES), FEATURES)];
    return $out;
}

function feature_catalog(): array {
    return array_map(fn($d) => $d + ['planName' => PLANS[$d['plan']]['name'], 'topTier' => $d['plan'] === PLAN_ORDER[count(PLAN_ORDER) - 1]], FEATURES);
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

// ---------- extra locations ----------
// Platinum includes LOCATIONS_INCLUDED active locations; each one beyond
// that is a paid add-on (a second item on the Stripe subscription, Price
// STRIPE_PRICES['location'] => ['monthly' => ..., 'annual' => ...]). Free
// trials and complimentary accounts have no location limit.
const LOCATIONS_INCLUDED = 2;
const EXTRA_LOCATION_PRICE = 29;   // per extra location, per month (annual: x ANNUAL_MONTHS_CHARGED)

function active_location_count(int $practiceId): int {
    $s = pi_db()->prepare('SELECT COUNT(*) FROM locations WHERE practice_id = ? AND active = 1'); $s->execute([$practiceId]);
    return (int)$s->fetchColumn();
}
// How many active locations the practice may have now (null = no limit).
function location_allowance(array $p): ?int {
    if (in_array($p['subscription_status'], ['trialing', 'comped'], true)) return null;
    return LOCATIONS_INCLUDED + max(0, (int)($p['extra_locations'] ?? 0));
}
function extra_location_amount(string $interval): float {
    return (float)($interval === 'annual' ? EXTRA_LOCATION_PRICE * ANNUAL_MONTHS_CHARGED : EXTRA_LOCATION_PRICE);
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

// The plan whose limits apply right now: a free trial (and a comped
// account) is the top plan, whatever plan was picked for afterwards. Once
// the practice subscribes, its subscribed plan applies.
function effective_plan_key(array $practice): string {
    $top = PLAN_ORDER[count(PLAN_ORDER) - 1];
    if ($practice['subscription_status'] === 'comped') return $top;
    if (plan_standalone((string)$practice['plan'])) return $practice['plan'];
    if ($practice['subscription_status'] === 'trialing' && practice_access($practice) === 'full') return $top;
    return isset(PLANS[$practice['plan']]) ? $practice['plan'] : PLAN_ORDER[0];
}

function effective_plan(array $practice): array {
    return PLANS[effective_plan_key($practice)];
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
    $eff = effective_plan($p);
    $daysLeft = $p['subscription_status'] === 'trialing' && $p['trial_ends_at'] ? max(0, (int)ceil((strtotime($p['trial_ends_at']) - time()) / 86400)) : null;
    return [
        'id' => (int)$p['id'], 'name' => $p['name'], 'plan' => $p['plan'], 'planName' => $plan['name'],
        'status' => $p['subscription_status'], 'access' => practice_access($p), 'trialDaysLeft' => $daysLeft,
        'currentPeriodEnd' => $p['current_period_end'], 'baaCurrent' => $p['baa_version'] === BAA_VERSION,
        'limits' => ['activeCases' => $eff['active_cases'], 'users' => $eff['users']], 'effectivePlan' => effective_plan_key($p), 'effectivePlanName' => $eff['name'],
        'ehrName' => $p['ehr_name'] ?? null, 'interval' => $p['billing_interval'] ?? 'monthly',
        'trialEndsAt' => $p['trial_ends_at'], 'subscribed' => !empty($p['stripe_subscription_id']),
        'features' => practice_features($p), 'featureCatalog' => feature_catalog(),
        'locations' => ['active' => active_location_count((int)$p['id']), 'allowance' => location_allowance($p), 'included' => LOCATIONS_INCLUDED, 'extra' => (int)($p['extra_locations'] ?? 0),
            'price' => EXTRA_LOCATION_PRICE, 'annualPrice' => EXTRA_LOCATION_PRICE * ANNUAL_MONTHS_CHARGED],
        'promo' => ($d = practice_discount($p)) ? ['code' => $d['code'], 'summary' => promo_summary($d), 'plans' => $d['plans'] ? explode(',', $d['plans']) : null] : null,
        // Features the trial includes that the chosen plan won't keep.
        'trialExtras' => $p['subscription_status'] === 'trialing' && !plan_standalone((string)$p['plan']) ? array_values(array_filter(array_keys(FEATURES), fn($f) => !plan_has_feature((string)$p['plan'], $f))) : [],
        // Which product the practice uses: the full app, or EOB Genie alone.
        'product' => plan_standalone((string)$p['plan']) && $p['subscription_status'] !== 'comped' ? $p['plan'] : 'injurycase',
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
    $plan = effective_plan($p);
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
