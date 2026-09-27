<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list_mine': handle_list_mine($pdo); break;
    case 'admin_list': handle_admin_list($pdo); break;
    case 'admin_create': handle_admin_create($pdo); break;
    case 'admin_void': handle_admin_void($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_list_mine(PDO $pdo) {
    $user = require_login();
    $stmt = $pdo->prepare("SELECT * FROM invoices WHERE user_id = ? AND status != 'void' ORDER BY created_at DESC");
    $stmt->execute([$user['id']]);
    json_response(['invoices' => array_map(fn($r) => invoice_to_json($pdo, $r), $stmt->fetchAll())]);
}

function handle_admin_list(PDO $pdo) {
    require_admin();
    $stmt = $pdo->query("SELECT i.*, u.name AS user_name, u.email AS user_email FROM invoices i JOIN users u ON u.id = i.user_id WHERE i.status != 'void' ORDER BY i.created_at DESC");
    $rows = $stmt->fetchAll();
    $out = array_map(function ($r) use ($pdo) {
        $j = invoice_to_json($pdo, $r);
        $j['userName'] = $r['user_name'];
        $j['userEmail'] = $r['user_email'];
        return $j;
    }, $rows);
    json_response(['invoices' => $out]);
}

function handle_admin_create(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $admin = require_admin();
    $body = json_body();
    $email = strtolower(trim($body['email'] ?? ''));
    $description = trim($body['description'] ?? '');
    $amount = (float)($body['amount'] ?? 0);

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid client email.'], 400);
    if (!$description) json_response(['error' => 'Enter a description for this charge.'], 400);
    if ($amount <= 0) json_response(['error' => 'Enter an amount greater than zero.'], 400);

    $stmt = $pdo->prepare('SELECT id, name FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $client = $stmt->fetch();
    if (!$client) json_response(['error' => 'No account found for that email — the client needs an account first.'], 404);

    $id = generate_id('INV');
    $stmt = $pdo->prepare('INSERT INTO invoices (id, user_id, description, amount, created_by) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$id, $client['id'], sanitize($description), $amount, $admin['email']]);

    send_email($email, 'New charge added to your account',
        "<p>A new charge has been added to your account: <strong>{$description}</strong> — $" . number_format($amount, 2) . '.</p>' .
        '<p>This is due immediately — pay it any time from your account dashboard.</p>');

    json_response(['success' => true, 'id' => $id]);
}

function handle_admin_void(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $pdo->prepare("UPDATE invoices SET status = 'void' WHERE id = ?")->execute([$id]);
    json_response(['success' => true]);
}
