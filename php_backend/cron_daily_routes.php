<?php
require_once __DIR__ . '/config.php';

// Runs every 5 minutes around the clock (see INSTALLATION.md) but only ever
// actually sends once it hits 4:30am America/New_York — config.php already
// forces that timezone regardless of whatever timezone the server's OS (and
// therefore cPanel's cron scheduler) happens to be set to, so gating here in
// PHP is what keeps this correct through EST/EDT changes and across hosts,
// rather than trying to translate "4:30am Eastern" into a server-local cron
// hour that could be wrong depending on the box.
$now = new DateTime('now');
$hour = (int)$now->format('H');
$minute = (int)$now->format('i');
if ($hour !== 4 || $minute < 30 || $minute >= 35) {
    exit;
}

$today = $now->format('Y-m-d');

// Belt-and-suspenders against sending the digest twice for the same day —
// app_settings remembers the last date it actually went out.
$stmt = $pdo->prepare('SELECT value_json FROM app_settings WHERE name = "daily_route_digest_sent"');
$stmt->execute();
$lastSentRaw = $stmt->fetchColumn();
$lastSentDate = $lastSentRaw ? json_decode($lastSentRaw, true) : null;
if ($lastSentDate === $today) {
    exit;
}

$count = send_daily_route_digest($pdo, $today);

$pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES ("daily_route_digest_sent", ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)')
    ->execute([json_encode($today)]);

echo "Daily route digest sent for {$today}: {$count} appointment(s).\n";
