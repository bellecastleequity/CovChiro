<?php
// Public: the attorney / case manager's view of a monthly case update
// (see app/case_updates.php). No sign-in — the one-time link token from the
// email is the access (stored hashed, expires after CASE_UPDATE_LINK_DAYS).
// Shows the summary as it was when sent. Every view is in the audit log.
//   GET update.php?t=TOKEN
require_once __DIR__ . '/../../app/bootstrap.php';
header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
header('Referrer-Policy: no-referrer');
$t = (string)($_GET['t'] ?? '');
$r = null;
if (preg_match('/^[a-f0-9]{64}$/', $t)) {
    $s = pi_db()->prepare('SELECT * FROM case_reports WHERE token_hash = ?'); $s->execute([hash('sha256', $t)]);
    $r = $s->fetch() ?: null;
}
$page = fn($title, $msg) => exit('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars($title) . '</title><body style="font-family:Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#0F1733"><h1 style="font-size:1.3rem">' . htmlspecialchars($title) . '</h1><p>' . htmlspecialchars($msg) . '</p></body>');
if (!$r) { http_response_code(404); $page('Link not available', 'This link isn\'t valid. Please use the most recent email from the office, or contact them directly.'); }
$p = practice_row((int)$r['practice_id']);
$c = pi_db()->prepare('SELECT * FROM cases WHERE id = ?'); $c->execute([$r['case_id']]); $c = $c->fetch();
current_practice($p);
$head = status_letterhead($c, $p) + ['email' => $p['email'] ?? null];
if (strtotime($r['expires_at']) < time()) { http_response_code(410); $page('Link expired', 'This link has expired. Please contact ' . $head['name'] . ($head['phone'] ? ' at ' . $head['phone'] : '') . ' for the latest update.'); }
if (!$r['viewed_at']) pi_db()->prepare('UPDATE case_reports SET viewed_at = ? WHERE id = ?')->execute([now_str(), $r['id']]);
audit('case_update_view', 'case', $c['id'], (int)$c['id'], ['id' => null, 'email' => 'attorney link', 'practice_id' => $p['id']], $_SERVER['REMOTE_ADDR'] ?? null);
$brand = practice_brand($p);
echo case_update_html(json_decode(dec($r['snapshot_enc']), true), $head, $brand['custom'] ? $brand : null);
