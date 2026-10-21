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
