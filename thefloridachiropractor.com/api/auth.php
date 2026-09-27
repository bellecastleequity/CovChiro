<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'register': handle_register($pdo); break;
    case 'login': handle_login($pdo); break;
    case 'logout': handle_logout(); break;
    case 'me': handle_me($pdo); break;
    case 'verify_email': handle_verify_email($pdo); break;
    case 'resend_verification': handle_resend_verification($pdo); break;
    case 'request_reset': handle_request_reset($pdo); break;
    case 'reset_password': handle_reset_password($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_register(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $name = trim($body['name'] ?? '');
    $email = strtolower(trim($body['email'] ?? ''));
    $password = (string)($body['password'] ?? '');
    $clinic = trim($body['clinic'] ?? '');
    $phone = trim($body['phone'] ?? '');

    if (!$name) json_response(['error' => 'Enter your name to create an account.'], 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email address.'], 400);
    if (strlen($password) < 8) json_response(['error' => 'Password must be at least 8 characters.'], 400);

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) json_response(['error' => 'An account already exists for that email. Try signing in instead.'], 409);

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $verifyToken = bin2hex(random_bytes(24));
    $stmt = $pdo->prepare('INSERT INTO users (email, password_hash, name, clinic_name, phone, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, NOW())');
    $stmt->execute([$email, $hash, sanitize($name), sanitize($clinic), sanitize($phone), $verifyToken]);
    $userId = (int)$pdo->lastInsertId();

    send_verification_email($email, $name, $verifyToken);

    start_session_for($userId, $email);
    json_response(['success' => true, 'user' => public_user($email, $name, $clinic, $phone, false)]);
}

function handle_login(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $email = strtolower(trim($body['email'] ?? ''));
    $password = (string)($body['password'] ?? '');
    if (!$email || !$password) json_response(['error' => 'Enter your email and password to continue.'], 400);

    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    // Deliberately identical wording/status for "no such account" and "wrong
    // password" below — telling them apart lets an attacker enumerate which
    // emails have accounts here.
    if (!$user) json_response(['error' => 'Incorrect email or password.'], 401);

    if ($user['locked_until'] && strtotime($user['locked_until']) > time()) {
        json_response(['error' => 'Too many failed attempts. Try again in a few minutes.'], 429);
    }

    if (!password_verify($password, $user['password_hash'])) {
        $fails = $user['failed_logins'] + 1;
        $lockUntil = $fails >= 5 ? date('Y-m-d H:i:s', time() + 900) : null;
        $stmt = $pdo->prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?');
        $stmt->execute([$fails, $lockUntil, $user['id']]);
        json_response(['error' => 'Incorrect email or password.'], 401);
    }

    $stmt = $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?');
    $stmt->execute([$user['id']]);

    start_session_for((int)$user['id'], $email);
    json_response(['success' => true, 'user' => public_user($email, $user['name'], $user['clinic_name'], $user['phone'], (bool)$user['email_verified'])]);
}

function handle_logout() {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
    json_response(['success' => true]);
}

function handle_me(PDO $pdo) {
    $current = current_user_or_null();
    if (!$current) json_response(['user' => null]);
    $stmt = $pdo->prepare('SELECT email, name, clinic_name, phone, email_verified FROM users WHERE id = ?');
    $stmt->execute([$current['id']]);
    $user = $stmt->fetch();
    if (!$user) json_response(['user' => null]);
    json_response(['user' => array_merge(public_user($user['email'], $user['name'], $user['clinic_name'], $user['phone'], (bool)$user['email_verified']), ['isAdmin' => $current['is_admin']])]);
}

function handle_verify_email(PDO $pdo) {
    $token = $_GET['token'] ?? '';
    if (!$token) json_response(['error' => 'Missing verification token.'], 400);
    $stmt = $pdo->prepare('SELECT id FROM users WHERE verification_token = ?');
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user) json_response(['error' => 'This verification link is invalid or has already been used.'], 404);

    $stmt = $pdo->prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?');
    $stmt->execute([$user['id']]);
    json_response(['success' => true]);
}

function handle_resend_verification(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $current = require_login();
    $stmt = $pdo->prepare('SELECT email, name, email_verified FROM users WHERE id = ?');
    $stmt->execute([$current['id']]);
    $user = $stmt->fetch();
    if (!$user) json_response(['error' => 'Account not found.'], 404);
    if ($user['email_verified']) json_response(['success' => true, 'alreadyVerified' => true]);

    $verifyToken = bin2hex(random_bytes(24));
    $stmt = $pdo->prepare('UPDATE users SET verification_token = ?, verification_sent_at = NOW() WHERE id = ?');
    $stmt->execute([$verifyToken, $current['id']]);
    send_verification_email($user['email'], $user['name'], $verifyToken);
    json_response(['success' => true]);
}

function handle_request_reset(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $email = strtolower(trim($body['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email address.'], 400);

    $stmt = $pdo->prepare('SELECT id, name FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if ($user) {
        $resetToken = bin2hex(random_bytes(24));
        $expires = date('Y-m-d H:i:s', time() + 3600);
        $stmt = $pdo->prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?');
        $stmt->execute([$resetToken, $expires, $user['id']]);
        $link = SITE_URL . '/index.html?reset=' . $resetToken;
        send_email($email, 'Reset your password',
            "<p>Hi {$user['name']},</p><p>Click the link below to set a new password. This link expires in 1 hour.</p>" .
            "<p><a href=\"{$link}\">{$link}</a></p><p>If you didn't request this, you can ignore this email.</p>");
    }
    // Always return success — never reveal whether an account exists for this email.
    json_response(['success' => true]);
}

function handle_reset_password(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $token = $body['token'] ?? '';
    $newPassword = (string)($body['newPassword'] ?? '');
    if (!$token) json_response(['error' => 'Missing reset token.'], 400);
    if (strlen($newPassword) < 8) json_response(['error' => 'New password must be at least 8 characters.'], 400);

    $stmt = $pdo->prepare('SELECT * FROM users WHERE reset_token = ?');
    $stmt->execute([$token]);
    $user = $stmt->fetch();
    if (!$user || !$user['reset_expires'] || strtotime($user['reset_expires']) < time()) {
        json_response(['error' => 'This reset link is invalid or has expired. Request a new one.'], 400);
    }

    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?');
    $stmt->execute([$hash, $user['id']]);

    start_session_for((int)$user['id'], $user['email']);
    json_response(['success' => true, 'user' => public_user($user['email'], $user['name'], $user['clinic_name'], $user['phone'], (bool)$user['email_verified'])]);
}

function send_verification_email($email, $name, $token) {
    $link = SITE_URL . '/index.html?verify=' . $token;
    send_email($email, 'Verify your email — coveragechiropractor.com',
        "<p>Hi {$name},</p><p>Thanks for creating an account. Please confirm your email address by clicking the link below:</p>" .
        "<p><a href=\"{$link}\">{$link}</a></p><p>If you didn't create this account, you can ignore this email.</p>");
}

function start_session_for($userId, $email) {
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['email'] = $email;
    $_SESSION['is_admin'] = (strtolower($email) === strtolower(ADMIN_EMAIL));
}

function public_user($email, $name, $clinic, $phone = '', $emailVerified = false) {
    return [
        'email' => $email,
        'name' => $name,
        'clinic' => $clinic ?: '',
        'phone' => $phone ?: '',
        'emailVerified' => (bool)$emailVerified,
        'isAdmin' => strtolower($email) === strtolower(ADMIN_EMAIL),
    ];
}
