<?php
// Practice administration — users, practice settings (letterhead), the
// Business Associate Agreement, and the audit log. Admin role only, and
// always limited to the admin's own practice.
define('PI_ALLOW_WHEN_LAPSED', true);
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'users': handle_users(); break;
    case 'user_save': handle_user_save(); break;
    case 'user_reset': handle_user_reset(); break;
    case 'practice': handle_practice(); break;
    case 'practice_save': handle_practice_save(); break;
    case 'accept_baa': handle_accept_baa(); break;
    case 'audit': handle_audit(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_users() {
    require_user('users.manage');
    $stmt = pi_db()->prepare('SELECT id, email, name, role, active, totp_enabled, must_change_password, locked_until, last_login_at, created_at FROM users WHERE practice_id = ? ORDER BY active DESC, name');
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
        $pdo->prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ? AND practice_id = ?')->execute([$name, $role, $active, $id, pid()]);
        audit('update', 'user', $id, null, $admin, "role=$role active=$active");
        json_response(['ok' => true]);
    }
    enforce_limit('users');
    $email = strtolower(trim((string)($b['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email.'], 400);
    $s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $s->execute([$email]);
    if ($s->fetch()) json_response(['error' => 'That email already has an account.'], 400);
    $pw = temp_password();
    $pdo->prepare('INSERT INTO users (practice_id, email, name, role, password_hash, must_change_password, created_at) VALUES (?,?,?,?,?,1,?)')
        ->execute([pid(), $email, $name, $role, password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
    $newId = (int)$pdo->lastInsertId();
    audit('create', 'user', $newId, null, $admin, "role=$role");
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
    audit('reset_' . $what, 'user', $id, null, $admin);
    json_response($out);
}

function handle_practice() {
    require_user('users.manage');
    $p = current_practice();
    json_response(['practice' => [
        'name' => $p['name'], 'address' => $p['address'], 'phone' => $p['phone'], 'fax' => $p['fax'], 'state' => $p['state'],
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
    pi_db()->prepare('UPDATE practices SET name = ?, address = ?, phone = ?, fax = ?, state = ? WHERE id = ?')
        ->execute([$name, str_or_null($b['address'] ?? null, 255), str_or_null($b['phone'] ?? null, 40), str_or_null($b['fax'] ?? null, 40), $state, pid()]);
    audit('update', 'practice', pid(), null, $admin);
    json_response(['ok' => true]);
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

function handle_audit() {
    $admin = require_user('audit.read');
    $where = ['a.practice_id = ?'];
    $args = [pid()];
    if (!empty($_GET['case_id'])) { $where[] = 'a.case_id = ?'; $args[] = (int)$_GET['case_id']; }
    if (!empty($_GET['user_id'])) { $where[] = 'a.user_id = ?'; $args[] = (int)$_GET['user_id']; }
    if (!empty($_GET['action_filter'])) { $where[] = 'a.action = ?'; $args[] = $_GET['action_filter']; }
    if (!empty($_GET['from'])) { $where[] = 'a.occurred_at >= ?'; $args[] = date_or_null($_GET['from']) . ' 00:00:00'; }
    if (!empty($_GET['to'])) { $where[] = 'a.occurred_at <= ?'; $args[] = date_or_null($_GET['to']) . ' 23:59:59'; }
    $stmt = pi_db()->prepare('SELECT a.*, c.case_number FROM audit_log a LEFT JOIN cases c ON c.id = a.case_id WHERE ' . implode(' AND ', $where) . ' ORDER BY a.id DESC LIMIT 500');
    $stmt->execute($args);
    audit('view', 'audit_log', null, null, $admin);
    json_response(['entries' => $stmt->fetchAll()]);
}
