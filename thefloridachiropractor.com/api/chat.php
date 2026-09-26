<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'send': handle_send($pdo); break;
    case 'history': handle_history($pdo); break;
    case 'list_threads': handle_list_threads($pdo); break;
    case 'thread': handle_thread($pdo); break;
    case 'reply': handle_reply($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function resolve_thread_key($body) {
    $current = current_user_or_null();
    if ($current) return ['user:' . $current['id'], $current];
    $key = trim($body['threadKey'] ?? '');
    if (!$key || strlen($key) > 64) return [null, null];
    return [$key, null];
}

function handle_send(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $message = trim($body['message'] ?? '');
    if (!$message) json_response(['error' => 'Type a message first.'], 400);
    if (strlen($message) > 4000) json_response(['error' => 'Message is too long.'], 400);

    [$threadKey, $current] = resolve_thread_key($body);
    if (!$threadKey) json_response(['error' => 'Enter your name and email to start a chat.'], 400);

    if ($current) {
        $stmt = $pdo->prepare('SELECT name, email FROM users WHERE id = ?');
        $stmt->execute([$current['id']]);
        $u = $stmt->fetch();
        $name = $u['name']; $email = $u['email']; $userId = $current['id'];
    } else {
        $name = trim($body['name'] ?? '');
        $email = trim($body['email'] ?? '');
        if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_response(['error' => 'Enter your name and a valid email to start a chat.'], 400);
        }
        $userId = null;
    }

    $stmt = $pdo->prepare('INSERT INTO chat_messages (thread_key, user_id, name, email, sender, message, read_by_admin, read_by_client) VALUES (?, ?, ?, ?, ?, ?, 0, 1)');
    $stmt->execute([$threadKey, $userId, sanitize($name), sanitize($email), 'client', sanitize($message)]);

    send_email(ADMIN_EMAIL, "New chat message from {$name}",
        "<p>{$name} ({$email}) sent:</p><blockquote>" . nl2br($message) . '</blockquote>' .
        '<p>Reply from the Messages tab in your provider portal.</p>');

    json_response(['success' => true]);
}

function fetch_thread_messages(PDO $pdo, $threadKey) {
    $stmt = $pdo->prepare('SELECT id, name, email, sender, message, created_at FROM chat_messages WHERE thread_key = ? ORDER BY created_at ASC');
    $stmt->execute([$threadKey]);
    return array_map(fn($r) => [
        'id' => (int)$r['id'],
        'name' => $r['name'],
        'email' => $r['email'],
        'sender' => $r['sender'],
        'message' => $r['message'],
        'createdAt' => to_iso($r['created_at']),
    ], $stmt->fetchAll());
}

function handle_history(PDO $pdo) {
    $current = current_user_or_null();
    if ($current) {
        $threadKey = 'user:' . $current['id'];
    } else {
        $threadKey = trim($_GET['threadKey'] ?? '');
        if (!$threadKey) json_response(['messages' => []]);
    }
    $messages = fetch_thread_messages($pdo, $threadKey);
    $stmt = $pdo->prepare("UPDATE chat_messages SET read_by_client = 1 WHERE thread_key = ? AND sender = 'admin'");
    $stmt->execute([$threadKey]);
    json_response(['messages' => $messages, 'threadKey' => $threadKey]);
}

function handle_list_threads(PDO $pdo) {
    require_admin();
    $stmt = $pdo->query("SELECT thread_key,
            MAX(created_at) AS last_at,
            SUM(CASE WHEN sender = 'client' AND read_by_admin = 0 THEN 1 ELSE 0 END) AS unread
        FROM chat_messages GROUP BY thread_key ORDER BY last_at DESC");
    $threads = $stmt->fetchAll();
    $out = [];
    foreach ($threads as $t) {
        $last = $pdo->prepare('SELECT name, email, sender, message, created_at FROM chat_messages WHERE thread_key = ? ORDER BY created_at DESC LIMIT 1');
        $last->execute([$t['thread_key']]);
        $lastRow = $last->fetch();
        if (!$lastRow) continue;
        $out[] = [
            'threadKey' => $t['thread_key'],
            'name' => $lastRow['name'],
            'email' => $lastRow['email'],
            'lastMessage' => $lastRow['message'],
            'lastSender' => $lastRow['sender'],
            'lastAt' => to_iso($lastRow['created_at']),
            'unread' => (int)$t['unread'],
        ];
    }
    json_response(['threads' => $out]);
}

function handle_thread(PDO $pdo) {
    require_admin();
    $threadKey = trim($_GET['threadKey'] ?? '');
    if (!$threadKey) json_response(['error' => 'Missing thread.'], 400);
    $messages = fetch_thread_messages($pdo, $threadKey);
    $stmt = $pdo->prepare("UPDATE chat_messages SET read_by_admin = 1 WHERE thread_key = ? AND sender = 'client'");
    $stmt->execute([$threadKey]);
    json_response(['messages' => $messages]);
}

function handle_reply(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $threadKey = trim($body['threadKey'] ?? '');
    $message = trim($body['message'] ?? '');
    if (!$threadKey || !$message) json_response(['error' => 'Missing thread or message.'], 400);

    $last = $pdo->prepare('SELECT user_id, name, email FROM chat_messages WHERE thread_key = ? ORDER BY created_at DESC LIMIT 1');
    $last->execute([$threadKey]);
    $lastRow = $last->fetch();
    if (!$lastRow) json_response(['error' => 'Thread not found.'], 404);

    $stmt = $pdo->prepare('INSERT INTO chat_messages (thread_key, user_id, name, email, sender, message, read_by_admin, read_by_client) VALUES (?, ?, ?, ?, ?, ?, 1, 0)');
    $stmt->execute([$threadKey, $lastRow['user_id'], $lastRow['name'], $lastRow['email'], 'admin', sanitize($message)]);

    if ($lastRow['email']) {
        send_email($lastRow['email'], 'New message from Dr. McPherson',
            '<p>' . nl2br($message) . '</p><p>Reply at ' . SITE_URL . '.</p>');
    }

    json_response(['success' => true]);
}
