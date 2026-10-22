<?php
// Daily: late-task emails (Gold plan and up). A task that's past its due
// date and has "late" alerts on is emailed once, then again every N days
// (the task's setting, else the practice's) until it's done or its due
// date moves. No patient details in the email (see app/task_mail.php).
// Run from cron (setup.sh installs it):
//   php app/cli/task_reminders.php [--dry-run]
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../task_mail.php';

$dry = in_array('--dry-run', $argv, true);
if (!$dry && !mail_configured()) exit("Email isn't configured (SMTP_HOST / MAIL_FROM in secrets.php) — nothing sent.\n");
$pdo = pi_db();
$today = date('Y-m-d');
$tasks = 0; $emails = 0;
foreach ($pdo->query('SELECT * FROM practices ORDER BY id')->fetchAll() as $p) {
    if (practice_access($p) !== 'full' || !has_feature($p, 'task_emails')) continue;
    current_practice($p);
    foreach (task_late_due($pdo, $p, $today) as $t) {
        if ($dry) {
            foreach (task_recipients($t) as $u) echo "[dry run] {$u['email']}: task {$t['id']} late (due {$t['due_on']})\n";
            continue;
        }
        $n = task_email_send('late', $t, $p);
        // Marked even when nobody could be emailed, so it isn't retried daily.
        $pdo->prepare('UPDATE tasks SET late_emailed_at = ? WHERE id = ?')->execute([now_str(), $t['id']]);
        $tasks++; $emails += $n;
    }
}
echo $dry ? '' : "$tasks late task(s), $emails email(s) sent.\n";
