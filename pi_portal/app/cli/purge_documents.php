<?php
// Patient documents aren't stored: uploads are turned off. This deletes the
// files stored before that, for good.
//
//   php app/cli/purge_documents.php            what would be deleted (dry run)
//   php app/cli/purge_documents.php --confirm  delete every stored file
//   php app/cli/purge_documents.php --practice=ID [--confirm]   one practice
//
// The encrypted files are removed from storage and their rows deleted (an
// EHR upload or EOB that pointed at one keeps its numbers). Encrypted
// backups expire within 35 days. The audit log records counts only.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

$opt = getopt('', ['confirm', 'practice:']);
$pdo = pi_db();
$where = isset($opt['practice']) ? ' WHERE c.practice_id = ' . (int)$opt['practice'] : '';
$docs = $pdo->query("SELECT d.id, d.storage_name, d.size_bytes, c.practice_id FROM documents d JOIN cases c ON c.id = d.case_id$where")->fetchAll();
$bytes = array_sum(array_column($docs, 'size_bytes'));
printf("%d stored document(s), %.1f MB, in %d practice(s).\n", count($docs), $bytes / 1048576, count(array_unique(array_column($docs, 'practice_id'))));
if (!isset($opt['confirm'])) { echo $docs ? "Dry run — add --confirm to delete them.\n" : ''; exit(0); }

$removed = 0;
foreach ($docs as $d) {
    $f = PI_STORAGE_DIR . '/' . $d['storage_name'];
    if (is_file($f)) { $h = fopen($f, 'r+'); if ($h) { ftruncate($h, 0); fclose($h); } @unlink($f); }
    $pdo->prepare('UPDATE ehr_imports SET document_id = NULL WHERE document_id = ?')->execute([$d['id']]);
    $pdo->prepare('DELETE FROM documents WHERE id = ?')->execute([$d['id']]);
    $removed++;
}
audit('purge_documents', null, null, null, ['id' => null, 'email' => 'operator cli', 'practice_id' => null], $removed . ' document file(s) deleted' . (isset($opt['practice']) ? ' for practice ' . (int)$opt['practice'] : ''));
echo "Deleted $removed document(s).\n";
