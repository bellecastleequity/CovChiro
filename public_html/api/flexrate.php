<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list': handle_list($pdo); break;
    case 'publish': handle_publish($pdo); break;
    case 'unpublish': handle_unpublish($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_list(PDO $pdo) {
    $today = date('Y-m-d');
    $stmt = $pdo->prepare("SELECT * FROM flex_rate_dates WHERE status = 'open' AND date >= ? ORDER BY date");
    $stmt->execute([$today]);
    json_response(['flexRates' => array_map('flex_to_json', $stmt->fetchAll())]);
}

function handle_publish(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $date = $body['date'] ?? '';
    $region = $body['region'] ?? '';
    $type = in_array($body['type'] ?? 'full', ['full', 'half-am', 'half-pm'], true) ? $body['type'] : 'full';
    $discountPct = max(0, min(90, (float)($body['discountPct'] ?? 0)));
    $note = trim($body['note'] ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_response(['error' => 'Invalid date.'], 400);
    if (!isset(RATES[$region])) json_response(['error' => 'Invalid region.'], 400);

    // Replace any existing open listing for this date, same as the original UI intent.
    $pdo->prepare("UPDATE flex_rate_dates SET status = 'withdrawn' WHERE date = ? AND status = 'open'")->execute([$date]);

    $stmt = $pdo->prepare('INSERT INTO flex_rate_dates (date, region, day_type, discount_rate, note, status) VALUES (?, ?, ?, ?, ?, "open")');
    $stmt->execute([$date, $region, $type, $discountPct / 100, sanitize($note)]);
    json_response(['success' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function handle_unpublish(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = (int)($body['id'] ?? 0);
    $stmt = $pdo->prepare("UPDATE flex_rate_dates SET status = 'withdrawn' WHERE id = ? AND status = 'open'");
    $stmt->execute([$id]);
    json_response(['success' => true]);
}

function flex_to_json(array $r) {
    return [
        'id' => (int)$r['id'],
        'date' => $r['date'],
        'region' => $r['region'],
        'type' => $r['day_type'],
        'discountRate' => (float)$r['discount_rate'],
        'note' => $r['note'] ?: '',
        'status' => $r['status'],
        'createdAt' => to_iso($r['created_at']),
    ];
}
