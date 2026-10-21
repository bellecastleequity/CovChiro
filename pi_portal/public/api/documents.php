<?php
// Case documents (LOR, records, imaging/EMC/consult reports, narratives).
// Files are encrypted with the portal key and stored outside the web root
// under random names; the only way to read one is through `download`,
// which checks the session and writes an audit entry.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

const DOC_CATEGORIES = ['lor','intake','prior_records','imaging_report','emc_report','consult_report','narrative','letter','billing','correspondence','other'];
const ALLOWED_MIME = [
    'application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/tiff' => 'tif', 'image/heic' => 'heic',
    'application/msword' => 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
    'text/plain' => 'txt',
];

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'upload': handle_upload(); break;
    case 'download': handle_download(); break;
    case 'archive': handle_archive(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_upload() {
    require_method('POST');
    $user = require_user('case.read');
    if (!can($user, 'case.write') && !can($user, 'finance.write')) json_response(['error' => 'Your role does not allow uploads.'], 403);
    $caseId = (int)($_POST['case_id'] ?? 0);
    case_or_404($caseId);
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Upload failed — the file may be too large.'], 400);
    if ($f['size'] > PI_MAX_UPLOAD_BYTES) json_response(['error' => 'Files must be 25 MB or smaller.'], 400);
    // Trust the file's actual bytes, not the browser's claimed type.
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    if (!isset(ALLOWED_MIME[$mime])) json_response(['error' => 'Upload PDF, image, Word or text files only.'], 400);
    $category = in_array($_POST['category'] ?? '', DOC_CATEGORIES, true) ? $_POST['category'] : 'other';
    $plain = file_get_contents($f['tmp_name']);
    $storage = bin2hex(random_bytes(32));
    if (!is_dir(PI_STORAGE_DIR)) mkdir(PI_STORAGE_DIR, 0700, true);
    file_put_contents(PI_STORAGE_DIR . '/' . $storage, enc_file($plain), LOCK_EX);
    chmod(PI_STORAGE_DIR . '/' . $storage, 0600);
    $name = preg_replace('/[^\w.\- ()]+/u', '_', basename((string)$f['name'])) ?: 'document';
    pi_db()->prepare('INSERT INTO documents (case_id, category, original_name, mime_type, size_bytes, storage_name, sha256, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)')
        ->execute([$caseId, $category, mb_substr($name, 0, 255), $mime, strlen($plain), $storage, hash('sha256', $plain), $user['id'], now_str()]);
    $id = (int)pi_db()->lastInsertId();
    touch_case($caseId);
    audit('upload', 'document', $id, $caseId, $user, $category);
    json_response(['ok' => true, 'id' => $id]);
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
