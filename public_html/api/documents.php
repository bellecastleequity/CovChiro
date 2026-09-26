<?php
// Admin-uploaded documents that clients can download instantly once
// provided: chiropractic license, malpractice insurance & certificate of
// insurance (one combined document), and the W-9. Stored under
// documents/uploads/<key>.<ext>, with the current filename/upload time
// tracked in app_settings so the client-side Resources tab knows whether
// each one is available yet.
require_once __DIR__ . '/../../php_backend/config.php';

define('DOC_KEYS', ['license', 'malpractice', 'w9']);
define('DOC_ALLOWED_EXT', ['pdf', 'jpg', 'jpeg', 'png']);
define('DOC_MAX_BYTES', 15 * 1024 * 1024); // 15MB

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'status': handle_status($pdo); break;
    case 'upload': handle_upload($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function doc_setting_name($key) { return "doc_upload_{$key}"; }

function handle_status(PDO $pdo) {
    $stmt = $pdo->prepare('SELECT name, value_json FROM app_settings WHERE name IN (?, ?, ?)');
    $stmt->execute(array_map('doc_setting_name', DOC_KEYS));
    $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    $out = [];
    foreach (DOC_KEYS as $key) {
        $raw = $rows[doc_setting_name($key)] ?? null;
        $data = $raw ? json_decode($raw, true) : null;
        $out[$key] = $data ? [
            'available' => true,
            'url' => 'documents/uploads/' . $data['filename'],
            'uploadedAt' => $data['uploadedAt'],
        ] : ['available' => false];
    }
    json_response($out);
}

function handle_upload(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $key = $_POST['key'] ?? '';
    if (!in_array($key, DOC_KEYS, true)) json_response(['error' => 'Invalid document type.'], 400);
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        json_response(['error' => 'Choose a file to upload.'], 400);
    }
    $file = $_FILES['file'];
    if ($file['size'] > DOC_MAX_BYTES) json_response(['error' => 'File is too large (15MB max).'], 400);
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, DOC_ALLOWED_EXT, true)) json_response(['error' => 'Only PDF, JPG, or PNG files are allowed.'], 400);

    $dir = __DIR__ . '/../documents/uploads';
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    // Remove any previous version of this document (possibly a different extension).
    foreach (DOC_ALLOWED_EXT as $oldExt) {
        $old = "{$dir}/{$key}.{$oldExt}";
        if (file_exists($old)) unlink($old);
    }

    $filename = "{$key}.{$ext}";
    if (!move_uploaded_file($file['tmp_name'], "{$dir}/{$filename}")) {
        json_response(['error' => 'Could not save the file. Try again.'], 500);
    }

    $data = ['filename' => $filename, 'uploadedAt' => date('c')];
    $stmt = $pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
    $stmt->execute([doc_setting_name($key), json_encode($data)]);

    json_response(['success' => true, 'url' => "documents/uploads/{$filename}", 'uploadedAt' => $data['uploadedAt']]);
}
