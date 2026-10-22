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
    case 'mkt_overview': mkt_require(); handle_mkt_overview(); break;
    case 'mkt_settings': mkt_require(); handle_mkt_settings(); break;
    case 'mkt_prospects': mkt_require(); handle_mkt_prospects(); break;
    case 'mkt_prospect': mkt_require(); handle_mkt_prospect(); break;
    case 'mkt_action': mkt_require(); handle_mkt_action(); break;
    case 'mkt_add': mkt_require(); handle_mkt_add(); break;
    case 'mkt_preview': mkt_require(); handle_mkt_preview(); break;
    case 'mkt_test': mkt_require(); handle_mkt_test(); break;
    case 'mkt_suppress': mkt_require(); handle_mkt_suppress(); break;
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

// ---------- marketing (outreach to clinics; app/marketing.php) ----------
function mkt_require(): array {
    require_once __DIR__ . '/../../app/marketing.php';
    return require_user('platform.manage');
}

function handle_mkt_overview() {
    $pdo = pi_db();
    $s = mkt_settings();
    $byStatus = $pdo->query('SELECT status, COUNT(*) n FROM mkt_prospects GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);
    $bySpecialty = $pdo->query('SELECT specialty, COUNT(*) n FROM mkt_prospects GROUP BY specialty')->fetchAll(PDO::FETCH_KEY_PAIR);
    $funnel = $pdo->query("SELECT COUNT(*) total, SUM(researched_at IS NOT NULL) researched, SUM(fit_score >= 50) qualified, SUM(email IS NOT NULL) with_email, SUM(step > 0) emailed,
        SUM(clicked_at IS NOT NULL) clicked, SUM(status = 'converted') converted, SUM(status = 'unsubscribed') unsubscribed, SUM(status = 'bounced') bounced FROM mkt_prospects")->fetch();
    $days = $pdo->query("SELECT DATE(sent_at) d, SUM(ok) sent, SUM(1 - ok) failed FROM mkt_sends WHERE sent_at >= '" . date('Y-m-d', strtotime('-13 days')) . "' GROUP BY DATE(sent_at) ORDER BY d")->fetchAll();
    $ai = $pdo->prepare('SELECT provider, calls, tokens FROM mkt_ai_usage WHERE day = ?'); $ai->execute([date('Y-m-d')]);
    $queued = (int)$pdo->query("SELECT COUNT(*) FROM mkt_prospects WHERE status IN ('ready','in_sequence') AND next_send_at <= '" . now_str() . "'")->fetchColumn();
    $disc = $pdo->query('SELECT COUNT(*) total, SUM(done_at IS NOT NULL) done FROM mkt_discovery')->fetch();
    json_response([
        'settings' => $s, 'specialties' => array_map(fn($x) => $x['label'], MKT_SPECIALTIES), 'states' => US_STATES,
        'blocker' => mkt_send_blocker($s), 'byStatus' => $byStatus, 'bySpecialty' => $bySpecialty, 'funnel' => array_map('intval', $funnel),
        'sentToday' => mkt_sent_today(), 'capToday' => mkt_today_cap($s), 'queuedNow' => $queued, 'days' => $days,
        'ai' => $ai->fetchAll(PDO::FETCH_UNIQUE), 'discovery' => ['segments' => (int)$disc['total'], 'done' => (int)$disc['done']],
        'keys' => ['gemini' => mkt_secret('GEMINI_API_KEY') !== '', 'openai' => mkt_secret('OPENAI_API_KEY') !== '', 'sendgrid' => mkt_secret('SENDGRID_API_KEY') !== '', 'webhook' => mkt_secret('MKT_WEBHOOK_SECRET') !== ''],
        'webhookUrl' => APP_URL . '/api/m.php?a=sendgrid&k=YOUR_MKT_WEBHOOK_SECRET',
        'suppressions' => (int)$pdo->query('SELECT COUNT(*) FROM mkt_suppressions')->fetchColumn(),
    ]);
}

function handle_mkt_settings() {
    require_method('POST');
    $op = require_user('platform.manage');
    try { $s = mkt_save_settings(json_body()); } catch (RuntimeException $e) { json_response(['error' => $e->getMessage()], 400); }
    audit('update', 'marketing', null, null, $op, 'settings' . ($s['enabled'] ? ' (sending on)' : ' (sending off)'));
    json_response(['ok' => true, 'settings' => $s, 'blocker' => mkt_send_blocker($s)]);
}

function handle_mkt_prospects() {
    $where = ['1=1']; $args = [];
    if (($st = $_GET['status'] ?? '') !== '') { $where[] = 'status = ?'; $args[] = $st; }
    if (($sp = $_GET['specialty'] ?? '') !== '') { $where[] = 'specialty = ?'; $args[] = $sp; }
    if (($state = $_GET['state'] ?? '') !== '') { $where[] = 'state = ?'; $args[] = strtoupper($state); }
    if (($q = trim($_GET['q'] ?? '')) !== '') { $where[] = '(name LIKE ? OR email LIKE ? OR city LIKE ? OR website LIKE ?)'; array_push($args, ...array_fill(0, 4, '%' . $q . '%')); }
    $page = max(0, (int)($_GET['page'] ?? 0));
    $s = pi_db()->prepare('SELECT id, name, specialty, contact_name, email, website, city, state, status, fit_score, step, next_send_at, last_sent_at, clicked_at, updated_at FROM mkt_prospects WHERE '
        . implode(' AND ', $where) . ' ORDER BY updated_at DESC, id DESC LIMIT 51 OFFSET ' . ($page * 50));
    $s->execute($args);
    $rows = $s->fetchAll();
    json_response(['prospects' => array_slice($rows, 0, 50), 'more' => count($rows) > 50]);
}

function mkt_prospect_or_404(int $id): array {
    $s = pi_db()->prepare('SELECT * FROM mkt_prospects WHERE id = ?'); $s->execute([$id]);
    $p = $s->fetch();
    if (!$p) json_response(['error' => 'Not found'], 404);
    return $p;
}

function handle_mkt_prospect() {
    $p = mkt_prospect_or_404((int)($_GET['id'] ?? 0));
    $sends = pi_db()->prepare('SELECT step, email, subject, ok, error, sent_at FROM mkt_sends WHERE prospect_id = ? ORDER BY id'); $sends->execute([$p['id']]);
    $events = pi_db()->prepare('SELECT kind, detail, at FROM mkt_events WHERE prospect_id = ? ORDER BY id'); $events->execute([$p['id']]);
    unset($p['token']);
    json_response(['prospect' => $p, 'sends' => $sends->fetchAll(), 'events' => $events->fetchAll()]);
}

// pause | resume | replied | unsubscribe | research (look again)
function handle_mkt_action() {
    require_method('POST');
    $op = require_user('platform.manage');
    $b = json_body();
    $p = mkt_prospect_or_404((int)($b['id'] ?? 0));
    switch ($b['do'] ?? '') {
        case 'pause': mkt_set((int)$p['id'], ['status' => 'paused', 'next_send_at' => null]); break;
        case 'resume':
            if (!$p['email'] || mkt_suppressed($p['email'])) json_response(['error' => 'This address is unsubscribed or missing.'], 400);
            mkt_set((int)$p['id'], ['status' => $p['step'] ? 'in_sequence' : 'ready', 'next_send_at' => now_str()]); break;
        case 'replied': mkt_set((int)$p['id'], ['status' => 'done', 'next_send_at' => null]); mkt_log((int)$p['id'], 'reply', 'marked by operator'); break;
        case 'unsubscribe': mkt_unsubscribe($p, 'unsubscribe'); break;
        case 'research': mkt_set((int)$p['id'], ['status' => 'new', 'researched_at' => null, 'error' => null]); break;
        default: json_response(['error' => 'Unknown action'], 400);
    }
    audit('update', 'marketing_prospect', $p['id'], null, $op, (string)$b['do']);
    json_response(['ok' => true]);
}

// A prospect you found yourself (e.g. met at a conference): goes straight to the queue.
function handle_mkt_add() {
    require_method('POST');
    $op = require_user('platform.manage');
    $b = json_body();
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $name = str_or_null($b['name'] ?? null, 200);
    if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter the practice name and a valid email.'], 400);
    if (mkt_suppressed($email)) json_response(['error' => 'That address has unsubscribed (or is already a customer).'], 400);
    $dup = pi_db()->prepare('SELECT 1 FROM mkt_prospects WHERE email = ?'); $dup->execute([$email]);
    if ($dup->fetchColumn()) json_response(['error' => 'That address is already a prospect.'], 400);
    $sp = isset(MKT_SPECIALTIES[$b['specialty'] ?? '']) ? $b['specialty'] : 'chiro';
    $state = isset(US_STATES[strtoupper((string)($b['state'] ?? ''))]) ? strtoupper($b['state']) : null;
    pi_db()->prepare("INSERT INTO mkt_prospects (source, name, specialty, contact_name, email, email_source, website, city, state, status, fit_score, next_send_at, token, created_at, updated_at) VALUES ('manual', ?, ?, ?, ?, 'manual', ?, ?, ?, 'ready', 100, ?, ?, ?, ?)")
        ->execute([$name, $sp, str_or_null($b['contact_name'] ?? null, 120), $email, str_or_null($b['website'] ?? null, 255), str_or_null($b['city'] ?? null, 80), $state, now_str(), bin2hex(random_bytes(16)), now_str(), now_str()]);
    audit('create', 'marketing_prospect', pi_db()->lastInsertId(), null, $op, $email);
    json_response(['ok' => true]);
}

function mkt_sample(): array {
    return ['id' => 0, 'name' => 'Sunshine Chiropractic', 'specialty' => 'chiro', 'contact_name' => 'Jordan Rivera', 'contact_role' => null, 'source' => 'npi', 'email' => 'office@example.com', 'token' => str_repeat('0', 32), 'state' => 'FL'];
}

// The email as recipients will see it (opens in a new tab).
function handle_mkt_preview() {
    $step = max(1, min(3, (int)($_GET['step'] ?? 1)));
    $p = !empty($_GET['id']) ? mkt_prospect_or_404((int)$_GET['id']) : mkt_sample();
    [$subject, $html] = mkt_render($p, $step, mkt_settings());
    header('Content-Type: text/html; charset=utf-8');
    header("Content-Security-Policy: default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'");
    // Images from this server, so the preview shows them before the site is live.
    $html = str_replace(APP_URL . '/assets/email/', '../assets/email/', $html);
    echo str_replace('<body', '<body data-subject="' . htmlspecialchars($subject, ENT_QUOTES) . '"', $html);
    exit;
}

function handle_mkt_test() {
    require_method('POST');
    $op = require_user('platform.manage');
    $b = json_body();
    $s = mkt_settings();
    $to = strtolower(trim((string)($b['to'] ?? $op['email'])));
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter an address to send the test to.'], 400);
    $s['enabled'] = true;
    if ($why = mkt_send_blocker($s)) json_response(['error' => $why], 400);
    $res = mkt_send_one(mkt_sample(), max(1, min(3, (int)($b['step'] ?? 1))), $s, $to);
    if (!$res['ok']) json_response(['error' => 'Not sent: ' . $res['error']], 502);
    audit('marketing_test', 'marketing', null, null, $op, $to);
    json_response(['ok' => true]);
}

// The do-not-email list: add (address or @domain) / remove / list.
function handle_mkt_suppress() {
    $op = require_user('platform.manage');
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        json_response(['suppressions' => pi_db()->query('SELECT email, reason, created_at FROM mkt_suppressions ORDER BY created_at DESC LIMIT 500')->fetchAll()]);
    }
    $b = json_body();
    $e = strtolower(trim((string)($b['email'] ?? '')));
    if (!filter_var($e, FILTER_VALIDATE_EMAIL) && !preg_match('/^@[a-z0-9.\-]+\.[a-z]{2,}$/', $e)) json_response(['error' => 'Enter an email address or @domain.'], 400);
    if (!empty($b['remove'])) {
        pi_db()->prepare("DELETE FROM mkt_suppressions WHERE email = ? AND reason = 'manual'")->execute([$e]);
    } else {
        mkt_suppress($e, 'manual');
        pi_db()->prepare("UPDATE mkt_prospects SET status = 'unsubscribed', next_send_at = NULL WHERE (email = ? OR email LIKE ?) AND status NOT IN ('converted')")->execute([$e, str_starts_with($e, '@') ? '%' . $e : $e]);
    }
    audit('update', 'marketing_suppression', null, null, $op, ($b['remove'] ?? false ? 'remove ' : 'add ') . $e);
    json_response(['ok' => true]);
}
