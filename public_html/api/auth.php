<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'register': handle_register($pdo); break;
    case 'login': handle_login($pdo); break;
    case 'logout': handle_logout(); break;
    case 'me': handle_me($pdo); break;
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
    $stmt = $pdo->prepare('INSERT INTO users (email, password_hash, name, clinic_name, phone) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$email, $hash, sanitize($name), sanitize($clinic), sanitize($phone)]);
    $userId = (int)$pdo->lastInsertId();

    start_session_for($userId, $email);
    json_response(['success' => true, 'user' => public_user($email, $name, $clinic)]);
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
    if (!$user) json_response(['error' => 'No account found for that email.'], 404);

    if ($user['locked_until'] && strtotime($user['locked_until']) > time()) {
        json_response(['error' => 'Too many failed attempts. Try again in a few minutes.'], 429);
    }

    if (!password_verify($password, $user['password_hash'])) {
        $fails = $user['failed_logins'] + 1;
        $lockUntil = $fails >= 5 ? date('Y-m-d H:i:s', time() + 900) : null;
        $stmt = $pdo->prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?');
        $stmt->execute([$fails, $lockUntil, $user['id']]);
        json_response(['error' => 'Incorrect password.'], 401);
    }

    $stmt = $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?');
    $stmt->execute([$user['id']]);

    start_session_for((int)$user['id'], $email);
    json_response(['success' => true, 'user' => public_user($email, $user['name'], $user['clinic_name'])]);
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
    $stmt = $pdo->prepare('SELECT email, name, clinic_name FROM users WHERE id = ?');
    $stmt->execute([$current['id']]);
    $user = $stmt->fetch();
    if (!$user) json_response(['user' => null]);
    json_response(['user' => array_merge(public_user($user['email'], $user['name'], $user['clinic_name']), ['isAdmin' => $current['is_admin']])]);
}

function start_session_for($userId, $email) {
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['email'] = $email;
    $_SESSION['is_admin'] = (strtolower($email) === strtolower(ADMIN_EMAIL));
}

function public_user($email, $name, $clinic) {
    return [
        'email' => $email,
        'name' => $name,
        'clinic' => $clinic ?: '',
        'isAdmin' => strtolower($email) === strtolower(ADMIN_EMAIL),
    ];
}
