<?php
// Daily: automatic case status requests (Gold plan and up). Each open case
// with the toggle on emails its attorney / case manager every N days (the
// case's interval, else the practice's; 30 by default), skipping cases the
// attorney has written in about within that time. The email has no patient
// details — just a secure reply link (see app/status_requests.php).
// Run from cron (setup.sh installs it):
//   php app/cli/status_requests.php [--dry-run]
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

$dry = in_array('--dry-run', $argv, true);
if (!$dry && !mail_configured()) exit("Email isn't configured (SMTP_HOST / MAIL_FROM in secrets.php) — nothing sent.\n");
$pdo = pi_db();
$today = date('Y-m-d');
$sent = 0; $skipped = 0;
foreach ($pdo->query('SELECT * FROM practices ORDER BY id')->fetchAll() as $p) {
    if (practice_access($p) !== 'full' || !has_feature($p, 'auto_status')) continue;
    current_practice($p);
    $cases = $pdo->prepare("SELECT * FROM cases WHERE practice_id = ? AND auto_status = 1 AND archived_at IS NULL AND check_received_on IS NULL
        AND stage IN ('" . implode("','", OPEN_STAGES) . "') ORDER BY id");
    $cases->execute([$p['id']]);
    foreach ($cases->fetchAll() as $c) {
        if (status_next_on($c, $p, $today) > $today) continue;
        if ($problem = status_problem($c, $p)) { $skipped++; if ($dry) echo "[skip] case {$c['case_number']}: $problem\n"; continue; }
        if ($dry) { echo "[dry run] case {$c['case_number']} → " . implode(', ', array_column(status_recipients($c), 0)) . "\n"; continue; }
        $r = status_send($c, $p, 'auto');
        isset($r['sent']) ? $sent++ : $skipped++;
    }
}
echo $dry ? '' : "$sent status request(s) sent, $skipped case(s) skipped (no email address on file).\n";
