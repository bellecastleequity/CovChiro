<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'get_last_minute': handle_get($pdo); break;
    case 'set_last_minute': handle_set($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_get(PDO $pdo) {
    json_response(['enabled' => last_minute_enabled($pdo)]);
}

function handle_set(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $enabled = !empty($body['enabled']);
    $stmt = $pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES ("last_minute_discount", ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
    $stmt->execute([json_encode(['enabled' => $enabled])]);
    json_response(['success' => true]);
}
