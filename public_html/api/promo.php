<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list': handle_list($pdo); break;
    case 'create': handle_create($pdo); break;
    case 'toggle': handle_toggle($pdo); break;
    case 'validate': handle_validate($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

// Public preview only — shows the shopper what the code is worth before they
// book. The real total is always recomputed and re-validated server-side in
// booking.php?action=create, which never trusts this preview.
function handle_validate(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $email = trim((string)($body['email'] ?? ''));
    $check = validate_promo_code($pdo, $body['code'] ?? '', $email !== '' ? $email : null);
    if (isset($check['error'])) json_response(['error' => $check['error']], 400);
    json_response(['type' => $check['promo']['type'], 'value' => (float)$check['promo']['value'], 'isWelcome' => !empty($check['promo']['is_welcome'])]);
}

function handle_list(PDO $pdo) {
    require_admin();
    $rows = $pdo->query('SELECT * FROM promo_codes ORDER BY created_at DESC')->fetchAll();
    json_response(['codes' => array_map('promo_to_json', $rows)]);
}

function handle_create(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $code = strtoupper(trim($body['code'] ?? ''));
    $type = in_array($body['type'] ?? '', ['percent', 'fixed'], true) ? $body['type'] : null;
    $value = (float)($body['value'] ?? 0);
    $maxUses = isset($body['maxUses']) && $body['maxUses'] !== '' ? (int)$body['maxUses'] : null;
    $expiresAt = $body['expiresAt'] ?: null;

    if (!$code) json_response(['error' => 'Enter a code.'], 400);
    if (!$type) json_response(['error' => 'Invalid type.'], 400);
    if ($value <= 0) json_response(['error' => 'Enter a value greater than 0.'], 400);
    if ($type === 'percent' && $value > 100) json_response(['error' => 'Percent off cannot exceed 100.'], 400);

    $stmt = $pdo->prepare('SELECT id FROM promo_codes WHERE code = ?');
    $stmt->execute([$code]);
    if ($stmt->fetch()) json_response(['error' => 'That code already exists.'], 409);

    $stmt = $pdo->prepare('INSERT INTO promo_codes (code, type, value, max_uses, expires_at, active) VALUES (?, ?, ?, ?, ?, 1)');
    $stmt->execute([$code, $type, $value, $maxUses, $expiresAt]);
    json_response(['success' => true]);
}

function handle_toggle(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $code = strtoupper(trim($body['code'] ?? ''));
    $stmt = $pdo->prepare('SELECT id, active FROM promo_codes WHERE code = ?');
    $stmt->execute([$code]);
    $row = $stmt->fetch();
    if (!$row) json_response(['error' => 'Not found'], 404);
    $stmt = $pdo->prepare('UPDATE promo_codes SET active = ? WHERE id = ?');
    $stmt->execute([$row['active'] ? 0 : 1, $row['id']]);
    json_response(['success' => true]);
}

function promo_to_json(array $r) {
    return [
        'code' => $r['code'],
        'type' => $r['type'],
        'value' => (float)$r['value'],
        'active' => (bool)$r['active'],
        'expiresAt' => $r['expires_at'],
        'maxUses' => $r['max_uses'] !== null ? (int)$r['max_uses'] : null,
        'usedCount' => (int)$r['used_count'],
        'createdAt' => to_iso($r['created_at']),
        'assignedEmail' => $r['assigned_email'] ?? null,
        'isWelcome' => !empty($r['is_welcome']),
    ];
}
