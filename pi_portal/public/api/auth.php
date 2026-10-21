<?php
// Sign-in flow: password -> (forced password change) -> 2FA enrollment or
// 2FA code -> signed in. A session that has only passed the password step
// can reach nothing but the next step of this flow.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'session': handle_session(); break;
    case 'ping': handle_ping(); break;
    case 'login': handle_login(); break;
    case 'change_password': handle_change_password(); break;
    case 'mfa_setup_start': handle_mfa_setup_start(); break;
    case 'mfa_setup_confirm': handle_mfa_setup_confirm(); break;
    case 'mfa_verify': handle_mfa_verify(); break;
    case 'logout': handle_logout(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function load_user(int $id) {
    $stmt = pi_db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

// Which step of sign-in this session is on.
function auth_step(?array $u): string {
    if (!$u || empty($_SESSION['uid'])) return 'signed_out';
    if ($u['must_change_password']) return 'password_change';
    if (!$u['totp_enabled']) return 'mfa_setup';
    if (empty($_SESSION['mfa_ok'])) return 'mfa';
    return 'signed_in';
}

function session_payload(?array $u) {
    $step = auth_step($u);
    $out = [
        'step' => $step,
        'csrf' => $_SESSION['csrf'],
        'idleTimeoutSeconds' => PI_IDLE_TIMEOUT_SECONDS,
        'practice' => PI_PRACTICE_NAME,
    ];
    if ($u && $step !== 'signed_out') $out['user'] = ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role']];
    if ($step === 'signed_in') {
        $out['user']['perms'] = ROLE_PERMS[$u['role']] ?? [];
        $out['lookups'] = [
            'stages' => STAGES, 'benefits' => BENEFITS, 'referralTypes' => REFERRAL_TYPES,
            'outcomeMeasures' => OUTCOME_MEASURES, 'reductionFloorPct' => REDUCTION_FLOOR_PCT,
            'providers' => pi_db()->query("SELECT id, name FROM users WHERE active = 1 AND role IN ('provider','admin') ORDER BY name")->fetchAll(),
            'users' => pi_db()->query('SELECT id, name FROM users WHERE active = 1 ORDER BY name')->fetchAll(),
        ];
    }
    return $out;
}

function handle_session() {
    $u = !empty($_SESSION['uid']) ? load_user((int)$_SESSION['uid']) : null;
    if ($u && !$u['active']) { pi_end_session(); pi_start_session(); $u = null; }
    json_response(session_payload($u));
}

function handle_ping() {
    if (empty($_SESSION['uid'])) json_response(['signedIn' => false]);
    $left = PI_IDLE_TIMEOUT_SECONDS - (time() - ($_SESSION['last_seen'] ?? 0));
    json_response(['signedIn' => true, 'idleSecondsLeft' => max(0, $left)]);
}

// Per-IP throttle on top of the per-account lockout: stops password
// spraying across many accounts from one source.
function check_login_throttle() {
    $pdo = pi_db();
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $stmt = $pdo->prepare('SELECT * FROM login_throttle WHERE ip_address = ?');
    $stmt->execute([$ip]);
    $row = $stmt->fetch();
    $now = time();
    if ($row && $row['blocked_until'] && strtotime($row['blocked_until']) > $now) {
        json_response(['error' => 'Too many sign-in attempts. Try again later.'], 429);
    }
    if (!$row || strtotime($row['window_start']) < $now - 15 * 60) {
        $pdo->prepare('REPLACE INTO login_throttle (ip_address, attempt_count, window_start, blocked_until) VALUES (?, 1, ?, NULL)')->execute([$ip, now_str()]);
        return;
    }
    $count = (int)$row['attempt_count'] + 1;
    $blocked = $count > 20 ? date('Y-m-d H:i:s', $now + 30 * 60) : null;
    $pdo->prepare('UPDATE login_throttle SET attempt_count = ?, blocked_until = ? WHERE ip_address = ?')->execute([$count, $blocked, $ip]);
    if ($blocked) json_response(['error' => 'Too many sign-in attempts. Try again later.'], 429);
}

function handle_login() {
    require_method('POST');
    check_csrf();
    check_login_throttle();
    $b = json_body();
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $password = (string)($b['password'] ?? '');
    $pdo = pi_db();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $u = $stmt->fetch();
    $generic = ['error' => 'Email or password is incorrect.'];

    if (!$u) {
        // Spend the same time as a real check so response timing doesn't
        // reveal which emails have accounts.
        password_verify($password, '$argon2id$v=19$m=65536,t=4,p=1$eDJrODFySm9nM2FOaDFOdg$BRcE8KlzI280cw1bvTSwn991+ILu9F0Qk4zbeW8auso');
        audit('login_failed', 'user', null, null, ['id' => null, 'email' => mb_substr($email, 0, 190)], 'unknown email');
        json_response($generic, 401);
    }
    if ($u['locked_until'] && strtotime($u['locked_until']) > time()) {
        audit('login_locked', 'user', $u['id'], null, $u);
        json_response(['error' => 'Account locked after repeated failed attempts. Try again in ' . PI_LOCKOUT_MINUTES . ' minutes or ask an admin.'], 423);
    }
    if (!$u['active'] || !password_verify($password, $u['password_hash'])) {
        $fails = (int)$u['failed_logins'] + 1;
        $lock = $fails >= PI_MAX_FAILED_LOGINS ? date('Y-m-d H:i:s', time() + PI_LOCKOUT_MINUTES * 60) : null;
        $pdo->prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')->execute([$lock ? 0 : $fails, $lock, $u['id']]);
        audit('login_failed', 'user', $u['id'], null, $u, $lock ? 'account locked' : 'bad password');
        json_response($generic, 401);
    }
    if (password_needs_rehash($u['password_hash'], PASSWORD_ARGON2ID)) {
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_ARGON2ID), $u['id']]);
    }
    $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?')->execute([$u['id']]);

    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    $_SESSION['email'] = $u['email'];
    $_SESSION['mfa_ok'] = false;
    $_SESSION['started_at'] = $_SESSION['last_seen'] = time();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    audit('login_password_ok', 'user', $u['id'], null, $u);
    json_response(session_payload($u));
}

function password_problem(string $pw, array $u): ?string {
    if (mb_strlen($pw) < PI_MIN_PASSWORD_LENGTH) return 'Use at least ' . PI_MIN_PASSWORD_LENGTH . ' characters.';
    if (stripos($pw, explode('@', $u['email'])[0]) !== false) return "Don't include your email name in the password.";
    $classes = (int)preg_match('/[a-z]/', $pw) + (int)preg_match('/[A-Z]/', $pw) + (int)preg_match('/\d/', $pw) + (int)preg_match('/[^A-Za-z0-9]/', $pw);
    if ($classes < 3) return 'Mix at least three of: lowercase, uppercase, numbers, symbols.';
    return null;
}

function handle_change_password() {
    require_method('POST');
    $user = require_user(null, true);
    $u = load_user((int)$user['id']);
    // Outside the forced first-login change, a password change is a
    // signed-in action and needs 2FA to have passed too.
    if (!$u['must_change_password'] && empty($_SESSION['mfa_ok'])) json_response(['error' => 'Two-factor verification required', 'code' => 'mfa'], 401);
    $b = json_body();
    if (!password_verify((string)($b['current'] ?? ''), $u['password_hash'])) json_response(['error' => 'Current password is incorrect.'], 400);
    $new = (string)($b['new'] ?? '');
    if ($p = password_problem($new, $u)) json_response(['error' => $p], 400);
    if (password_verify($new, $u['password_hash'])) json_response(['error' => 'Choose a different password from your current one.'], 400);
    pi_db()->prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')->execute([password_hash($new, PASSWORD_ARGON2ID), $u['id']]);
    audit('password_changed', 'user', $u['id'], null, $u);
    json_response(session_payload(load_user((int)$u['id'])));
}

function require_password_step(): array {
    $user = require_user(null, true);
    $u = load_user((int)$user['id']);
    if ($u['must_change_password']) json_response(['error' => 'Change your password first.', 'code' => 'pw_change'], 400);
    return $u;
}

function handle_mfa_setup_start() {
    require_method('POST');
    $u = require_password_step();
    if ($u['totp_enabled']) json_response(['error' => 'Two-factor is already set up.'], 400);
    // Held in the session until the user proves their app is working.
    $_SESSION['pending_totp'] = $_SESSION['pending_totp'] ?? totp_new_secret();
    json_response(['secret' => $_SESSION['pending_totp'], 'uri' => totp_uri($_SESSION['pending_totp'], $u['email'])]);
}

function handle_mfa_setup_confirm() {
    require_method('POST');
    $u = require_password_step();
    if ($u['totp_enabled'] || empty($_SESSION['pending_totp'])) json_response(['error' => 'Start two-factor setup first.'], 400);
    $step = totp_verify($_SESSION['pending_totp'], (string)(json_body()['code'] ?? ''));
    if ($step === null) json_response(['error' => "That code didn't match. Check your phone's clock and try the newest code."], 400);
    pi_db()->prepare('UPDATE users SET totp_secret_enc = ?, totp_enabled = 1, totp_last_step = ?, last_login_at = ? WHERE id = ?')
        ->execute([enc($_SESSION['pending_totp']), $step, now_str(), $u['id']]);
    unset($_SESSION['pending_totp']);
    session_regenerate_id(true);
    $_SESSION['mfa_ok'] = true;
    audit('mfa_enrolled', 'user', $u['id'], null, $u);
    audit('login', 'user', $u['id'], null, $u);
    json_response(session_payload(load_user((int)$u['id'])));
}

function handle_mfa_verify() {
    require_method('POST');
    $u = require_password_step();
    if (!$u['totp_enabled']) json_response(['error' => 'Set up two-factor first.'], 400);
    $_SESSION['mfa_tries'] = ($_SESSION['mfa_tries'] ?? 0) + 1;
    if ($_SESSION['mfa_tries'] > 5) {
        audit('mfa_failed', 'user', $u['id'], null, $u, 'too many attempts; session ended');
        pi_end_session();
        json_response(['error' => 'Too many wrong codes. Sign in again.', 'code' => 'auth'], 401);
    }
    $step = totp_verify(dec($u['totp_secret_enc']), (string)(json_body()['code'] ?? ''), $u['totp_last_step'] !== null ? (int)$u['totp_last_step'] : null);
    if ($step === null) {
        audit('mfa_failed', 'user', $u['id'], null, $u);
        json_response(['error' => "That code didn't match."], 400);
    }
    pi_db()->prepare('UPDATE users SET totp_last_step = ?, last_login_at = ? WHERE id = ?')->execute([$step, now_str(), $u['id']]);
    unset($_SESSION['mfa_tries']);
    session_regenerate_id(true);
    $_SESSION['mfa_ok'] = true;
    audit('login', 'user', $u['id'], null, $u);
    json_response(session_payload($u));
}

function handle_logout() {
    require_method('POST');
    if (!empty($_SESSION['uid'])) {
        check_csrf();
        audit('logout', 'user', $_SESSION['uid']);
    }
    pi_end_session();
    json_response(['ok' => true]);
}
