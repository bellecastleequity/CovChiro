<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'create': handle_create($pdo); break;
    case 'list': handle_list($pdo); break;
    case 'mine': handle_mine($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_create(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $name = trim($body['name'] ?? '');
    $email = trim($body['email'] ?? '');
    $date = $body['date'] ?? '';
    $bookingId = $body['bookingId'] ?? null;

    if (!$name || !$email) json_response(['error' => 'Enter your name and email.'], 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_response(['error' => 'Pick a preferred weekday.'], 400);
    $dow = (int)date('w', strtotime($date));
    if ($dow === 0 || $dow === 6) json_response(['error' => "Weekends aren't available — please pick a Monday through Friday date."], 400);

    if ($bookingId) {
        $stmt = $pdo->prepare('SELECT id FROM bookings WHERE id = ? AND user_id = ?');
        $stmt->execute([$bookingId, $user['id']]);
        if (!$stmt->fetch()) $bookingId = null;
    }

    $id = generate_id('VI');
    $stmt = $pdo->prepare('INSERT INTO video_requests (id, user_id, booking_id, name, email, requested_date) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([$id, $user['id'], $bookingId, sanitize($name), sanitize($email), $date]);

    send_email(ADMIN_EMAIL, "Video interview request — {$date}",
        "<p>Name: {$name}<br>Email: {$email}<br>Preferred date: {$date}, 12:00–1:00pm<br>Booking reference: " . ($bookingId ?: '(none)') . '</p>');

    json_response(['success' => true, 'id' => $id]);
}

function handle_list(PDO $pdo) {
    require_admin();
    $rows = $pdo->query('SELECT * FROM video_requests ORDER BY requested_date')->fetchAll();
    json_response(['requests' => array_map(fn($r) => [
        'id' => $r['id'],
        'name' => $r['name'],
        'email' => $r['email'],
        'date' => $r['requested_date'],
        'time' => '12:00pm–1:00pm',
        'bookingRef' => $r['booking_id'],
        'status' => $r['status'],
        'requestedAt' => to_iso($r['requested_at']),
    ], $rows)]);
}

function handle_mine(PDO $pdo) {
    $user = require_login();
    $stmt = $pdo->prepare('SELECT * FROM video_requests WHERE user_id = ? ORDER BY requested_date DESC');
    $stmt->execute([$user['id']]);
    $rows = $stmt->fetchAll();
    json_response(['requests' => array_map(fn($r) => [
        'id' => $r['id'],
        'date' => $r['requested_date'],
        'time' => '12:00pm–1:00pm',
        'bookingRef' => $r['booking_id'],
        'status' => $r['status'],
        'requestedAt' => to_iso($r['requested_at']),
    ], $rows)]);
}
