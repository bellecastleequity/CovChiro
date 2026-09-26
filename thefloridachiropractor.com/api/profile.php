<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'update': handle_update($pdo); break;
    case 'change_password': handle_change_password($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_update(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $current = require_login();
    $body = json_body();
    $name = trim($body['name'] ?? '');
    $clinic = trim($body['clinic'] ?? '');
    $phone = trim($body['phone'] ?? '');

    if (!$name) json_response(['error' => 'Name is required.'], 400);

    $stmt = $pdo->prepare('UPDATE users SET name = ?, clinic_name = ?, phone = ? WHERE id = ?');
    $stmt->execute([sanitize($name), sanitize($clinic), sanitize($phone), $current['id']]);

    json_response(['success' => true, 'user' => [
        'email' => $current['email'],
        'name' => $name,
        'clinic' => $clinic,
        'phone' => $phone,
        'isAdmin' => $current['is_admin'],
    ]]);
}

function handle_change_password(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $current = require_login();
    $body = json_body();
    $currentPassword = (string)($body['currentPassword'] ?? '');
    $newPassword = (string)($body['newPassword'] ?? '');

    if (strlen($newPassword) < 8) json_response(['error' => 'New password must be at least 8 characters.'], 400);

    $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$current['id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($currentPassword, $row['password_hash'])) {
        json_response(['error' => 'Current password is incorrect.'], 401);
    }

    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $stmt->execute([$hash, $current['id']]);

    json_response(['success' => true]);
}
