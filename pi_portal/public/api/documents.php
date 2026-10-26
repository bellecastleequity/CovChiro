<?php
// Case documents. Patient documents are not stored: uploads are turned off
// (keep documents in the practice's EHR). Files stored before that remain
// readable through `download` (session-checked and audited) and removable,
// and app/cli/purge_documents.php deletes them for good.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'upload': json_response(['error' => "Documents aren't stored here — keep them in your EHR."], 410);
    case 'download': handle_download(); break;
    case 'archive': handle_archive(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_download() {
    $user = require_user('case.read');
    $doc = child_or_404('documents', (int)($_GET['id'] ?? 0));
    if ($doc['archived_at']) json_response(['error' => 'Not found'], 404);
    $plain = dec_file(file_get_contents(PI_STORAGE_DIR . '/' . $doc['storage_name']));
    if (!hash_equals($doc['sha256'], hash('sha256', $plain))) {
        pi_log_error('Document integrity check failed id=' . $doc['id']);
        json_response(['error' => 'This file failed its integrity check.'], 500);
    }
    audit('download', 'document', $doc['id'], (int)$doc['case_id'], $user);
    $inline = !empty($_GET['inline']) && in_array($doc['mime_type'], ['application/pdf', 'image/jpeg', 'image/png'], true);
    header('Content-Type: ' . $doc['mime_type']);
    header('Content-Length: ' . strlen($plain));
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . str_replace('"', '', $doc['original_name']) . '"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf");
    echo $plain;
    exit;
}

function handle_archive() {
    require_method('POST');
    $user = require_user('case.write');
    $doc = child_or_404('documents', (int)(json_body()['id'] ?? 0));
    pi_db()->prepare('UPDATE documents SET archived_at = ? WHERE id = ?')->execute([now_str(), $doc['id']]);
    audit('archive', 'document', $doc['id'], (int)$doc['case_id'], $user);
    json_response(['ok' => true]);
}
