<?php
// User management and the audit log viewer — admin role only.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'users': handle_users(); break;
    case 'user_save': handle_user_save(); break;
    case 'user_reset': handle_user_reset(); break;
    case 'audit': handle_audit(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_users() {
    require_user('users.manage');
    $rows = pi_db()->query('SELECT id, email, name, role, active, totp_enabled, must_change_password, locked_until, last_login_at, created_at FROM users ORDER BY active DESC, name')->fetchAll();
    json_response(['users' => $rows]);
}

// A readable one-time password the admin hands over in person or by
// phone; the user must replace it at first sign-in.
function temp_password(): string {
    $words = ['Maple', 'Harbor', 'Copper', 'Lantern', 'Cedar', 'Summit', 'Pelican', 'Orchid', 'Granite', 'Willow', 'Falcon', 'Meadow'];
    return $words[random_int(0, 11)] . '-' . $words[random_int(0, 11)] . '-' . random_int(1000, 9999);
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
        if ($id === (int)$admin['id'] && ($role !== 'admin' || empty($b['active']))) json_response(['error' => "You can't remove your own admin access."], 400);
        $pdo->prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?')->execute([$name, $role, !empty($b['active']) ? 1 : 0, $id]);
        audit('update', 'user', $id, null, $admin, "role=$role active=" . (!empty($b['active']) ? 1 : 0));
        json_response(['ok' => true]);
    }
    $email = strtolower(trim((string)($b['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email.'], 400);
    $s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $s->execute([$email]);
    if ($s->fetch()) json_response(['error' => 'A user with that email already exists.'], 400);
    $pw = temp_password();
    $pdo->prepare('INSERT INTO users (email, name, role, password_hash, must_change_password, created_at) VALUES (?,?,?,?,1,?)')
        ->execute([$email, $name, $role, password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
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
    $id = (int)($b['id'] ?? 0);
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

function handle_audit() {
    $admin = require_user('audit.read');
    $where = ['1=1'];
    $args = [];
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
