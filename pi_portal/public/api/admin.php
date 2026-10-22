<?php
// Practice administration — users, practice settings (letterhead), the
// Business Associate Agreement, and the audit log. Admin role only, and
// always limited to the admin's own practice.
define('PI_ALLOW_WHEN_LAPSED', true);
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

// Home location (must belong to the practice) and whether access is
// limited to it (only meaningful with a location).
function user_location_input(array $b): array {
    $loc = !empty($b['location_id']) ? (int)$b['location_id'] : null;
    if ($loc) {
        $s = pi_db()->prepare('SELECT id FROM locations WHERE id = ? AND practice_id = ?'); $s->execute([$loc, pid()]);
        if (!$s->fetch()) json_response(['error' => 'Unknown location'], 400);
    }
    return [$loc, $loc && !empty($b['location_restricted']) ? 1 : 0];
}

function handle_users() {
    require_user('users.manage');
    $stmt = pi_db()->prepare('SELECT id, email, name, role, finance_access, notify_digest, location_id, location_restricted, active, totp_enabled, must_change_password, locked_until, last_login_at, created_at FROM users WHERE practice_id = ? ORDER BY active DESC, name');
    $stmt->execute([pid()]);
    json_response(['users' => $stmt->fetchAll(), 'limit' => plan_for(current_practice())['users']]);
}

// A readable one-time password the admin hands over in person or by
// phone; the user must replace it at first sign-in.
function temp_password(): string {
    $words = ['Maple', 'Harbor', 'Copper', 'Lantern', 'Cedar', 'Summit', 'Pelican', 'Orchid', 'Granite', 'Willow', 'Falcon', 'Meadow'];
    return $words[random_int(0, 11)] . '-' . $words[random_int(0, 11)] . '-' . random_int(1000, 9999);
}

function user_in_practice(int $id): array {
    $s = pi_db()->prepare('SELECT * FROM users WHERE id = ? AND practice_id = ?');
    $s->execute([$id, pid()]);
    $u = $s->fetch();
    if (!$u) json_response(['error' => 'User not found'], 404);
    return $u;
}

function handle_user_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $pdo = pi_db();
    $id = (int)($b['id'] ?? 0);
    $role = enum_or($b['role'] ?? '', array_keys(ROLE_PERMS), null);
    $name = str_or_null($b['name'] ?? null, 120);
    if (!$role || !$name) json_response(['error' => 'Enter a name and pick a role.'], 400);
    if ($id) {
        $existing = user_in_practice($id);
        $active = !empty($b['active']) ? 1 : 0;
        if ($id === (int)$admin['id'] && ($role !== 'admin' || !$active)) json_response(['error' => "You can't remove your own admin access."], 400);
        if ($active && !$existing['active']) enforce_limit('users');
        $finAccess = $role === 'staff' && !empty($b['finance_access']) ? 1 : 0;
        $digest = array_key_exists('notify_digest', $b) ? (!empty($b['notify_digest']) ? 1 : 0) : (int)$existing['notify_digest'];
        [$locId, $locOnly] = array_key_exists('location_id', $b) ? user_location_input($b) : [$existing['location_id'], (int)$existing['location_restricted']];
        if ($id === (int)$admin['id'] && $locOnly) json_response(['error' => "You can't limit your own account to one location."], 400);
        $pdo->prepare('UPDATE users SET name = ?, role = ?, active = ?, finance_access = ?, notify_digest = ?, location_id = ?, location_restricted = ? WHERE id = ? AND practice_id = ?')->execute([$name, $role, $active, $finAccess, $digest, $locId, $locOnly, $id, pid()]);
        $changes = audit_diff(['name' => 'label', 'role' => array_keys(ROLE_PERMS), 'active' => 'bool', 'finance_access' => 'bool', 'notify_digest' => 'bool', 'location_id' => 'int', 'location_restricted' => 'bool'], $existing, ['name' => $name, 'role' => $role, 'active' => $active, 'finance_access' => $finAccess, 'notify_digest' => $digest, 'location_id' => $locId, 'location_restricted' => $locOnly]);
        if ($changes) audit('update', 'user', $id, null, $admin, $existing['name'], $changes);
        json_response(['ok' => true]);
    }
    enforce_limit('users');
    $email = strtolower(trim((string)($b['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email.'], 400);
    $s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $s->execute([$email]);
    if ($s->fetch()) json_response(['error' => 'That email already has an account.'], 400);
    $pw = temp_password();
    [$locId, $locOnly] = user_location_input($b);
    $pdo->prepare('INSERT INTO users (practice_id, email, name, role, finance_access, location_id, location_restricted, notify_digest, password_hash, must_change_password, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)')
        ->execute([pid(), $email, $name, $role, $role === 'staff' && !empty($b['finance_access']) ? 1 : 0, $locId, $locOnly, array_key_exists('notify_digest', $b) ? (!empty($b['notify_digest']) ? 1 : 0) : ($role === 'admin' ? 1 : 0), password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
    $newId = (int)$pdo->lastInsertId();
    audit('create', 'user', $newId, null, $admin, $name, [['f' => 'role', 't' => 'enum', 'from' => null, 'to' => $role]]);
    json_response(['ok' => true, 'tempPassword' => $pw]);
}

// Lost phone / forgotten password: issue a new temp password and/or clear
// 2FA so the user re-enrolls at next sign-in. Verify who you're talking to
// before doing this — it's the main social-engineering target.
function handle_user_reset() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $id = (int)user_in_practice((int)($b['id'] ?? 0))['id'];
    $what = $b['what'] ?? '';
    $pdo = pi_db();
    $out = ['ok' => true];
    if ($what === 'password') {
        $pw = temp_password();
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')->execute([password_hash($pw, PASSWORD_ARGON2ID), $id]);
        $out['tempPassword'] = $pw;
    } elseif ($what === 'mfa') {
        $pdo->prepare('UPDATE users SET totp_secret_enc = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?')->execute([$id]);
    } elseif ($what === 'unlock') {
        $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?')->execute([$id]);
    } else {
        json_response(['error' => 'Unknown reset'], 400);
    }
    audit('reset_' . $what, 'user', $id, null, $admin, user_in_practice($id)['name']);
    json_response($out);
}

function handle_practice() {
    require_user('users.manage');
    $p = current_practice();
    json_response(['practice' => [
        'name' => $p['name'], 'address' => $p['address'], 'phone' => $p['phone'], 'fax' => $p['fax'], 'state' => $p['state'], 'ehrName' => $p['ehr_name'],
        'staffFinance' => array_values(array_filter(explode(',', (string)$p['staff_finance']))),
        'notifyRules' => practice_rules($p), 'notifyCriteria' => NOTIFY_CRITERIA, 'mailReady' => mail_ready(),
        'hasHuddle' => has_feature($p, 'huddle'), 'hasDigest' => has_feature($p, 'email_digest'),
        'baaVersion' => $p['baa_version'], 'baaAcceptedAt' => $p['baa_accepted_at'], 'currentBaaVersion' => BAA_VERSION,
    ]]);
}

function handle_practice_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $name = str_or_null($b['name'] ?? null, 160);
    if (!$name) json_response(['error' => 'Enter the practice name.'], 400);
    $state = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($b['state'] ?? 'FL')), 0, 2)) ?: 'FL';
    $after = ['name' => $name, 'address' => str_or_null($b['address'] ?? null, 255), 'phone' => str_or_null($b['phone'] ?? null, 40), 'fax' => str_or_null($b['fax'] ?? null, 40), 'state' => $state, 'ehr_name' => str_or_null($b['ehr_name'] ?? null, 80)];
    $changes = audit_diff(['name' => 'label', 'address' => 'label', 'phone' => 'label', 'fax' => 'label', 'state' => 'label', 'ehr_name' => 'label'], current_practice(), $after);
    pi_db()->prepare('UPDATE practices SET name = ?, address = ?, phone = ?, fax = ?, state = ?, ehr_name = ? WHERE id = ?')
        ->execute([...array_values($after), pid()]);
    if ($changes) audit('update', 'practice', pid(), null, $admin, null, $changes);
    json_response(['ok' => true]);
}

// Which financial categories the staff role sees practice-wide.
function handle_staff_finance() {
    require_method('POST');
    $admin = require_user('users.manage');
    $scopes = array_values(array_intersect(FIN_SCOPES, (array)(json_body()['scopes'] ?? [])));
    pi_db()->prepare('UPDATE practices SET staff_finance = ? WHERE id = ?')->execute([implode(',', $scopes), pid()]);
    $old = array_values(array_filter(explode(',', (string)current_practice()['staff_finance'])));
    audit('update', 'practice', pid(), null, $admin, null, [['f' => 'staff_finance', 't' => 'enum', 'from' => $old ? implode(', ', $old) : null, 'to' => $scopes ? implode(', ', $scopes) : null]]);
    json_response(['ok' => true, 'scopes' => $scopes]);
}

function mail_ready(): bool {
    require_once __DIR__ . '/../../app/mailer.php';
    return mail_configured();
}

// The practice's daily huddle / email digest criteria and thresholds.
function handle_notify_rules_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $rules = ['criteria' => array_values(array_intersect((array)($b['criteria'] ?? []), array_keys(NOTIFY_CRITERIA))),
        'gap_days' => (int)($b['gap_days'] ?? TREATMENT_GAP_DAYS), 'adherence_pct' => (int)($b['adherence_pct'] ?? 70), 'weekdays_only' => !empty($b['weekdays_only'])];
    $before = practice_rules();
    pi_db()->prepare('UPDATE practices SET notify_rules = ? WHERE id = ?')->execute([json_encode($rules), pid()]);
    $after = practice_rules(['notify_rules' => json_encode($rules)]);
    audit('update', 'practice', pid(), null, $admin, 'daily digest rules', audit_diff(['gap_days' => 'int', 'adherence_pct' => 'int', 'weekdays_only' => 'bool', 'criteria' => 'label'],
        ['criteria' => implode(', ', $before['criteria'])] + $before, ['criteria' => implode(', ', $after['criteria'])] + $after));
    json_response(['ok' => true, 'rules' => $after]);
}

// Each person's own daily email: on/off and which of the practice's
// criteria. Admins can switch it for others from the Users page.
function handle_my_notify() {
    $user = require_user();
    require_feature('email_digest');
    $s = pi_db()->prepare('SELECT notify_digest, notify_criteria FROM users WHERE id = ?');
    $s->execute([$user['id']]);
    $u = $s->fetch();
    $rules = practice_rules();
    json_response(['digest' => (bool)$u['notify_digest'], 'criteria' => $u['notify_criteria'] === null ? $rules['criteria'] : array_values(array_intersect(explode(',', $u['notify_criteria']), $rules['criteria'])),
        'available' => array_intersect_key(NOTIFY_CRITERIA, array_flip($rules['criteria'])), 'email' => $user['email'], 'mailReady' => mail_ready(), 'weekdaysOnly' => $rules['weekdays_only']]);
}

function handle_my_notify_save() {
    require_method('POST');
    $user = require_user();
    require_feature('email_digest');
    $b = json_body();
    $crit = array_values(array_intersect((array)($b['criteria'] ?? []), array_keys(NOTIFY_CRITERIA)));
    pi_db()->prepare('UPDATE users SET notify_digest = ?, notify_criteria = ? WHERE id = ?')->execute([!empty($b['digest']) ? 1 : 0, implode(',', $crit), $user['id']]);
    audit('update', 'user', $user['id'], null, $user, 'email notifications', [['f' => 'notify_digest', 't' => 'bool', 'from' => null, 'to' => !empty($b['digest'])]]);
    json_response(['ok' => true]);
}

// ---- locations (Group plan) ----
function handle_locations() {
    require_user('users.manage');
    $s = pi_db()->prepare('SELECT l.*, (SELECT COUNT(*) FROM cases c WHERE c.location_id = l.id AND c.archived_at IS NULL) cases,
        (SELECT COUNT(*) FROM users u WHERE u.location_id = l.id AND u.active = 1) users FROM locations l WHERE l.practice_id = ? ORDER BY l.active DESC, l.name');
    $s->execute([pid()]);
    json_response(['locations' => $s->fetchAll(), 'enabled' => has_feature(current_practice(), 'locations')]);
}

function handle_location_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('locations');
    $b = json_body();
    $id = (int)($b['id'] ?? 0);
    $cols = ['name' => str_or_null($b['name'] ?? null, 120), 'address' => str_or_null($b['address'] ?? null, 255), 'phone' => str_or_null($b['phone'] ?? null, 40),
        'fax' => str_or_null($b['fax'] ?? null, 40), 'active' => array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : 1];
    if (!$cols['name']) json_response(['error' => 'Give the location a name.'], 400);
    $pdo = pi_db();
    if ($id) {
        $s = $pdo->prepare('SELECT * FROM locations WHERE id = ? AND practice_id = ?'); $s->execute([$id, pid()]);
        $before = $s->fetch() ?: json_response(['error' => 'Not found'], 404);
        $pdo->prepare('UPDATE locations SET name = ?, address = ?, phone = ?, fax = ?, active = ? WHERE id = ? AND practice_id = ?')->execute([...array_values($cols), $id, pid()]);
        audit('update', 'location', $id, null, $admin, $cols['name'], audit_diff(['name' => 'label', 'address' => 'label', 'phone' => 'label', 'fax' => 'label', 'active' => 'bool'], $before, $cols));
    } else {
        $pdo->prepare('INSERT INTO locations (practice_id, name, address, phone, fax, active, created_at) VALUES (?,?,?,?,?,?,?)')->execute([pid(), ...array_values($cols), now_str()]);
        $id = (int)$pdo->lastInsertId();
        audit('create', 'location', $id, null, $admin, $cols['name']);
    }
    json_response(['ok' => true, 'id' => $id]);
}

function handle_accept_baa() {
    require_method('POST');
    $admin = require_user('users.manage');
    if (empty(json_body()['accept'])) json_response(['error' => 'Tick the box to accept.'], 400);
    pi_db()->prepare('UPDATE practices SET baa_version = ?, baa_accepted_at = ?, baa_accepted_by = ? WHERE id = ?')
        ->execute([BAA_VERSION, now_str(), $admin['id'], pid()]);
    audit('accept_baa', 'practice', pid(), null, $admin, BAA_VERSION);
    json_response(['ok' => true]);
}

// The practice's audit log: who did what, when, from where. Filter by team
// member, kind of activity, case and dates; page back with "before";
// download as CSV for a compliance review.
const AUDIT_CATEGORIES = [
    'changes' => "a.action IN ('create','update','archive','forward_balance','ehr_import','letter','upload')",
    'access' => "a.action IN ('view','list','download','export','ehr_preview')",
    'signin' => "(a.action LIKE 'login%' OR a.action LIKE 'mfa%' OR a.action IN ('logout','session_timeout','password_changed','access_denied'))",
    'admin' => "(a.entity IN ('user','practice','audit_log') OR a.action LIKE 'reset_%' OR a.action LIKE 'billing_%' OR a.action = 'accept_baa')",
];

function audit_query(array $q, int $limit): array {
    $where = ['a.practice_id = ?'];
    $args = [pid()];
    if (!empty($q['case_id'])) { $where[] = 'a.case_id = ?'; $args[] = (int)$q['case_id']; }
    if (!empty($q['case_number'])) { $where[] = 'c.case_number = ?'; $args[] = trim((string)$q['case_number']); }
    if (!empty($q['user_id'])) { $where[] = 'a.user_id = ?'; $args[] = (int)$q['user_id']; }
    if (!empty($q['category']) && isset(AUDIT_CATEGORIES[$q['category']])) $where[] = AUDIT_CATEGORIES[$q['category']];
    if (!empty($q['action_filter'])) { $where[] = 'a.action = ?'; $args[] = (string)$q['action_filter']; }
    if (!empty($q['from']) && date_or_null($q['from'])) { $where[] = 'a.occurred_at >= ?'; $args[] = date_or_null($q['from']) . ' 00:00:00'; }
    if (!empty($q['to']) && date_or_null($q['to'])) { $where[] = 'a.occurred_at <= ?'; $args[] = date_or_null($q['to']) . ' 23:59:59'; }
    if (!empty($q['before'])) { $where[] = 'a.id < ?'; $args[] = (int)$q['before']; }
    $stmt = pi_db()->prepare('SELECT a.*, COALESCE(u.name, a.user_email) user_name, c.case_number, tk.title label FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id LEFT JOIN cases c ON c.id = a.case_id LEFT JOIN tasks tk ON a.entity = \'task\' AND tk.id = a.entity_id
        WHERE ' . implode(' AND ', $where) . " ORDER BY a.id DESC LIMIT $limit");
    $stmt->execute($args);
    return $stmt->fetchAll();
}

function handle_audit() {
    $admin = require_user('audit.read');
    $rows = audit_query($_GET, 201);
    $more = count($rows) > 200;
    $members = pi_db()->prepare('SELECT id, name, active FROM users WHERE practice_id = ? ORDER BY active DESC, name');
    $members->execute([pid()]);
    audit('view', 'audit_log', null, null, $admin);
    json_response(['entries' => array_map(fn($r) => present_audit($r, $admin), array_slice($rows, 0, 200)), 'more' => $more, 'members' => $members->fetchAll()]);
}

function handle_audit_csv() {
    $admin = require_user('audit.read');
    $rows = audit_query($_GET, 50000);
    audit('export', 'audit_log', null, null, $admin, ['rows' => count($rows)]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="injurycase-audit-' . date('Y-m-d') . '.csv"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['When', 'Team member', 'Email', 'Action', 'Record', 'Record id', 'Case', 'Changes', 'Detail', 'IP address']);
    foreach ($rows as $r) {
        $e = present_audit($r, $admin);
        $changes = implode('; ', array_map(fn($c) => $c['f'] . (array_key_exists('to', $c) ? ': ' . json_encode($c['from'] ?? null) . ' -> ' . json_encode($c['to'])  : ''), $e['changes']));
        fputcsv($out, array_map('csv_safe', [$r['occurred_at'], $r['user_name'], $r['user_email'], $r['action'], $r['entity'], $r['entity_id'], $r['case_number'], $changes, $e['detail'], $r['ip_address']]));
    }
    exit;
}

// Spreadsheet apps run cells that start with = + - @ as formulas.
function csv_safe($v): string {
    $v = (string)$v;
    return $v !== '' && strpbrk($v[0], "=+-@\t\r") !== false ? "'" . $v : $v;
}

// Dispatch last, once the constants above are defined.
$action = $_GET['action'] ?? '';
switch ($action) {
    case 'users': handle_users(); break;
    case 'user_save': handle_user_save(); break;
    case 'user_reset': handle_user_reset(); break;
    case 'practice': handle_practice(); break;
    case 'practice_save': handle_practice_save(); break;
    case 'accept_baa': handle_accept_baa(); break;
    case 'staff_finance': handle_staff_finance(); break;
    case 'audit': handle_audit(); break;
    case 'audit_csv': handle_audit_csv(); break;
    case 'notify_rules_save': handle_notify_rules_save(); break;
    case 'locations': handle_locations(); break;
    case 'location_save': handle_location_save(); break;
    case 'my_notify': handle_my_notify(); break;
    case 'my_notify_save': handle_my_notify_save(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
