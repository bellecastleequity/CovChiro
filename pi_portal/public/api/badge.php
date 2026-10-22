<?php
// Public: the "InjuryCase Certified" badge practices embed on their own
// websites, and the verification page's lookup. No sign-in; reveals only a
// practice's name and state, and only while its badge is switched on.
//   GET badge.php?t=TOKEN[&style=light|dark|seal]  -> SVG image
//   GET badge.php?action=verify&t=TOKEN            -> JSON
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/badge.php';

$token = preg_replace('/[^a-f0-9]/', '', (string)($_GET['t'] ?? ''));
$p = null;
if (strlen($token) === 24) {
    $s = pi_db()->prepare('SELECT * FROM practices WHERE badge_token = ?');
    $s->execute([$token]);
    $p = $s->fetch() ?: null;
}
$certified = $p && badge_status($p)['certified'];

if (($_GET['action'] ?? '') === 'verify') {
    if (!$p || empty($p['badge_enabled'])) json_response(['status' => 'unknown']);
    json_response($certified
        ? ['status' => 'certified', 'practice' => $p['name'], 'state' => $p['state'], 'since' => substr((string)$p['badge_enabled_at'], 0, 10), 'checkedAt' => date('c')]
        : ['status' => 'inactive', 'checkedAt' => date('c')]);
}

header('Content-Type: image/svg+xml; charset=utf-8');
header('Cache-Control: public, max-age=900');
header('X-Content-Type-Options: nosniff');
echo badge_svg((string)($_GET['style'] ?? 'light'), $certified);
