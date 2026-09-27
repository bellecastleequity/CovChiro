<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'create': handle_create($pdo); break;
    case 'list': handle_list($pdo); break;
    case 'mine': handle_mine($pdo); break;
    case 'admin_update': handle_admin_update($pdo); break;
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

    send_admin_email("Video interview request — {$date}", 'New video consult request',
        email_facts(['Name' => $name, 'Email' => $email, 'Preferred date' => date('l, F j, Y', strtotime($date)) . ', 12:00–1:00pm', 'Booking' => $bookingId ?: '(none)'])
        . email_p('Send the Zoom link from the Video requests tab.'), ['kicker' => 'Video consult', 'reply_to' => $email]);

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
        'zoomLink' => $r['zoom_link'],
        'linkSentAt' => to_iso($r['link_sent_at'] ?? null),
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
        'zoomLink' => $r['zoom_link'],
        'requestedAt' => to_iso($r['requested_at']),
    ], $rows)]);
}

// Processes a video interview request: paste in the Zoom meeting link
// (created manually in the office's own Zoom account — no Zoom API
// integration here) to email it to the client and mark the request
// scheduled, or mark it done once the call has happened. Either action can
// carry a status change on its own too (e.g. marking a no-show done
// without a link).
function handle_admin_update(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $status = $body['status'] ?? '';
    $zoomLink = trim($body['zoomLink'] ?? '');

    if (!in_array($status, ['scheduled', 'done'], true)) json_response(['error' => 'Invalid status.'], 400);
    if ($zoomLink !== '' && !preg_match('#^https://#i', $zoomLink)) json_response(['error' => 'Zoom link should be a full https:// URL.'], 400);

    $stmt = $pdo->prepare('SELECT * FROM video_requests WHERE id = ?');
    $stmt->execute([$id]);
    $r = $stmt->fetch();
    if (!$r) json_response(['error' => 'Not found'], 404);

    $sendLink = $status === 'scheduled' && $zoomLink !== '';
    if ($zoomLink !== '') {
        $stmt = $pdo->prepare('UPDATE video_requests SET status = ?, zoom_link = ?' . ($sendLink ? ', link_sent_at = NOW()' : '') . ' WHERE id = ?');
        $stmt->execute([$status, sanitize($zoomLink), $id]);
    } else {
        $stmt = $pdo->prepare('UPDATE video_requests SET status = ? WHERE id = ?');
        $stmt->execute([$status, $id]);
    }

    if ($sendLink) {
        $when = date('l, F j, Y', strtotime($r['requested_date']));
        send_branded_email($r['email'], "Your video consult link — {$r['requested_date']}",
            email_heading('Your video consult is set', 'See you on Zoom')
            . email_p('Hi ' . em(email_first_name($r['name'])) . ', looking forward to talking. Here are the details:')
            . email_facts(['When' => "{$when}, 12:00–1:00pm (Eastern)", 'Where' => 'Zoom — link below'])
            . email_buttons([['Join the Zoom call', $zoomLink]])
            . email_small('Tip: open the link a couple of minutes early to test your audio and camera. Link not working? Copy it: <a href="' . em($zoomLink) . '" style="color:' . EM_TEAL . ';word-break:break-all;">' . em($zoomLink) . '</a>'),
            ['site' => email_site(null), 'preheader' => "Zoom link for {$when}, 12:00–1:00pm."]);
    }

    json_response(['success' => true]);
}
