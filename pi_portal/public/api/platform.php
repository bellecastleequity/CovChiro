<?php
// Operator console — for you, running the service. Lists subscribing
// practices with plan, status and usage counts. Counts aren't PHI; no
// patient names or records are ever returned here, and operator accounts
// are refused by every practice endpoint.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'practices': handle_practices(); break;
    case 'practice_update': handle_practice_update(); break;
    case 'promos': handle_promos(); break;
    case 'promo_save': handle_promo_save(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_practices() {
    $op = require_user('platform.manage');
    $rows = pi_db()->query("SELECT p.*,
        (SELECT COUNT(*) FROM users u WHERE u.practice_id = p.id AND u.active = 1) users,
        (SELECT COUNT(*) FROM cases c WHERE c.practice_id = p.id AND c.archived_at IS NULL AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')) open_cases,
        (SELECT COUNT(*) FROM cases c WHERE c.practice_id = p.id) total_cases,
        (SELECT MAX(u.last_login_at) FROM users u WHERE u.practice_id = p.id) last_login,
        (SELECT u.email FROM users u WHERE u.practice_id = p.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) owner_email
        FROM practices p ORDER BY p.created_at DESC")->fetchAll();
    $out = [];
    $mrr = 0;
    foreach ($rows as $r) {
        $sum = practice_summary($r);
        if ($r['subscription_status'] === 'active' || $r['subscription_status'] === 'past_due') $mrr += plan_for($r)['price'];
        $out[] = $sum + ['ownerEmail' => $r['owner_email'], 'users' => (int)$r['users'], 'openCases' => (int)$r['open_cases'], 'totalCases' => (int)$r['total_cases'],
            'lastLogin' => $r['last_login'], 'createdAt' => $r['created_at'], 'trialEndsAt' => $r['trial_ends_at'], 'baaAcceptedAt' => $r['baa_accepted_at']];
    }
    audit('view', 'platform_practices', null, null, $op);
    json_response(['practices' => $out, 'plans' => PLANS, 'mrr' => $mrr]);
}

// Extend a trial, comp an account (e.g. your own clinic), or change plan.
function handle_practice_update() {
    require_method('POST');
    $op = require_user('platform.manage');
    $b = json_body();
    $id = (int)($b['id'] ?? 0);
    $pdo = pi_db();
    if (isset($b['plan']) && isset(PLANS[$b['plan']])) $pdo->prepare('UPDATE practices SET plan = ? WHERE id = ?')->execute([$b['plan'], $id]);
    if (!empty($b['extend_trial_days'])) {
        $days = max(1, min(90, (int)$b['extend_trial_days']));
        $pdo->prepare("UPDATE practices SET subscription_status = 'trialing', trial_ends_at = DATE_ADD(GREATEST(COALESCE(trial_ends_at, NOW()), NOW()), INTERVAL ? DAY) WHERE id = ? AND subscription_status IN ('trialing','canceled')")->execute([$days, $id]);
    }
    if (isset($b['comped'])) {
        $pdo->prepare('UPDATE practices SET subscription_status = ? WHERE id = ?')->execute([$b['comped'] ? 'comped' : 'trialing', $id]);
    }
    audit('platform_update', 'practice', $id, null, $op, json_encode(array_intersect_key($b, array_flip(['plan', 'extend_trial_days', 'comped']))));
    json_response(['ok' => true]);
}

// ---- promo codes ----
function handle_promos() {
    require_user('platform.manage');
    $rows = pi_db()->query('SELECT p.*, (SELECT COUNT(*) FROM practices x WHERE x.promo_code_id = p.id) practices FROM promo_codes p ORDER BY p.active DESC, p.created_at DESC')->fetchAll();
    json_response(['promos' => array_map(fn($p) => $p + ['summary' => promo_summary($p)], $rows), 'kinds' => PROMO_KINDS, 'durations' => PROMO_DURATIONS, 'plans' => PLANS]);
}

function handle_promo_save() {
    require_method('POST');
    $op = require_user('platform.manage');
    $b = json_body();
    $pdo = pi_db();
    $id = (int)($b['id'] ?? 0);
    if ($id) {
        // Existing codes: only on/off, end date, limit and description change
        // (the terms a practice signed up under stay fixed).
        $s = $pdo->prepare('SELECT * FROM promo_codes WHERE id = ?'); $s->execute([$id]);
        $before = $s->fetch() ?: json_response(['error' => 'Not found'], 404);
        $cols = ['active' => array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : (int)$before['active'],
            'expires_on' => array_key_exists('expires_on', $b) ? date_or_null($b['expires_on']) : $before['expires_on'],
            'max_redemptions' => array_key_exists('max_redemptions', $b) ? (($b['max_redemptions'] === '' || $b['max_redemptions'] === null) ? null : max(0, (int)$b['max_redemptions'])) : $before['max_redemptions'],
            'description' => array_key_exists('description', $b) ? str_or_null($b['description'], 200) : $before['description']];
        $pdo->prepare('UPDATE promo_codes SET active = ?, expires_on = ?, max_redemptions = ?, description = ? WHERE id = ?')->execute([...array_values($cols), $id]);
        audit('update', 'promo_code', $id, null, $op, $before['code'], audit_diff(['active' => 'bool', 'expires_on' => 'date', 'max_redemptions' => 'int', 'description' => 'label'], $before, $cols));
        json_response(['ok' => true, 'id' => $id]);
    }
    $code = promo_normalize($b['code'] ?? '');
    if (strlen($code) < 3) json_response(['error' => 'Use at least 3 letters or numbers for the code.'], 400);
    if (promo_find($code)) json_response(['error' => 'That code already exists.'], 400);
    $kind = $b['kind'] ?? '';
    if (!isset(PROMO_KINDS[$kind])) json_response(['error' => 'Choose what the code gives.'], 400);
    $duration = isset(PROMO_DURATIONS[$b['duration'] ?? '']) ? $b['duration'] : 'once';
    $plans = array_values(array_filter((array)($b['plans'] ?? []), fn($p) => isset(PLANS[$p])));
    $row = ['code' => $code, 'description' => str_or_null($b['description'] ?? null, 200), 'kind' => $kind,
        'trial_days' => $kind === 'trial_days' ? max(1, min(365, (int)($b['trial_days'] ?? 0))) : null,
        'percent_off' => $kind === 'percent' ? max(1, min(100, (int)($b['percent_off'] ?? 0))) : null,
        'amount_off' => $kind === 'amount' ? max(1, (float)($b['amount_off'] ?? 0)) : null,
        'duration' => in_array($kind, ['percent', 'amount'], true) ? $duration : 'once',
        'duration_months' => in_array($kind, ['percent', 'amount'], true) && $duration === 'repeating' ? max(1, min(36, (int)($b['duration_months'] ?? 1))) : null,
        'plans' => $plans ? implode(',', $plans) : null,
        'max_redemptions' => ($b['max_redemptions'] ?? '') === '' ? null : max(1, (int)$b['max_redemptions']),
        'expires_on' => date_or_null($b['expires_on'] ?? null), 'created_by' => $op['id'], 'created_at' => now_str()];
    $pdo->prepare('INSERT INTO promo_codes (' . implode(',', array_keys($row)) . ') VALUES (' . implode(',', array_fill(0, count($row), '?')) . ')')->execute(array_values($row));
    $newId = (int)$pdo->lastInsertId();
    audit('create', 'promo_code', $newId, null, $op, $code . ' — ' . promo_summary($row));
    json_response(['ok' => true, 'id' => $newId]);
}
