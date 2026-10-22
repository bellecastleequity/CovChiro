<?php
// Daily email digest: for each person who has it switched on, counts of
// what needs attention today under the criteria they follow, with a link
// to the Daily huddle. Counts only — no patient names, case numbers or
// clinical details ever go in the email. Run each morning from cron:
//   php app/cli/daily_digest.php [--dry-run] [--force]
// --force sends again today (and on weekends) for testing.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../huddle.php';
require_once __DIR__ . '/../mailer.php';

$dry = in_array('--dry-run', $argv, true);
$force = in_array('--force', $argv, true);
if (!$dry && !mail_configured()) exit("Email isn't configured (SMTP_HOST / MAIL_FROM in secrets.php) — nothing sent.\n");
$pdo = pi_db();
$today = date('Y-m-d');
$weekend = (int)date('N') >= 6;
$sent = 0;
foreach ($pdo->query('SELECT * FROM practices ORDER BY id')->fetchAll() as $p) {
    if (practice_access($p) !== 'full') continue;   // lapsed practices aren't emailed
    if (!has_feature($p, 'email_digest')) continue;  // a plan feature (app/saas.php)
    current_practice($p);
    $rules = practice_rules($p);
    if ($weekend && $rules['weekdays_only'] && !$force) continue;
    $users = $pdo->prepare('SELECT id, practice_id, email, name, role, finance_access, location_id, location_restricted, notify_criteria FROM users WHERE practice_id = ? AND active = 1 AND notify_digest = 1');
    $users->execute([$p['id']]);
    $users = $users->fetchAll();
    if (!$users) continue;
    $huddleFor = [];
    foreach ($users as $u) {
        if (!$force) {
            $s = $pdo->prepare('SELECT 1 FROM digest_log WHERE user_id = ? AND sent_on = ?');
            $s->execute([$u['id'], $today]);
            if ($s->fetchColumn()) continue;
        }
        // Money items depend on what this person may see.
        // ... and on their location restriction.
        current_user($u);
        $key = (fin_can($u, 'balances') ? 'fin' : 'nofin') . ':' . (restricted_location() ?? 'all');
        $huddleFor[$key] ??= build_huddle($pdo, $u, (int)$p['id']);
        $criteria = $u['notify_criteria'] === null ? $rules['criteria'] : array_values(array_intersect(explode(',', $u['notify_criteria']), $rules['criteria']));
        if (!fin_can($u, 'balances')) $criteria = array_values(array_diff($criteria, ['money']));
        $counts = digest_counts($huddleFor[$key], $u, $criteria);
        if (!$counts) continue;   // nothing to report: no email
        $total = array_sum($counts);
        $subject = BRAND_NAME . ': ' . $total . ' item' . ($total === 1 ? '' : 's') . ' need attention today';
        $lines = [];
        foreach ($counts as $c => $n) $lines[] = sprintf('  %3d  %s', $n, NOTIFY_CRITERIA[$c]);
        $text = 'Hi ' . explode(' ', $u['name'])[0] . ",\n\nHere's what needs attention at {$p['name']} today (" . date('l, F j') . "):\n\n" . implode("\n", $lines)
            . "\n\nOpen the Daily huddle for the details:\n" . APP_URL . "/app.html#/huddle\n\n"
            . "For privacy, this email never includes patient names or case details — sign in to see them.\n"
            . "Change what you receive under \"Email notifications\" in " . BRAND_NAME . ".\n\n— " . BRAND_NAME . "\n";
        if ($dry) { echo "[dry run] {$u['email']}: $subject\n" . implode("\n", $lines) . "\n"; continue; }
        if (send_mail($u['email'], $subject, $text)) {
            $pdo->prepare('REPLACE INTO digest_log (user_id, sent_on, items) VALUES (?, ?, ?)')->execute([$u['id'], $today, $total]);
            audit('email_digest', 'user', $u['id'], null, ['id' => null, 'email' => 'system', 'practice_id' => $p['id']], $total . ' items');
            $sent++;
        }
    }
}
echo ($dry ? 'Dry run done.' : "$sent digest(s) sent.") . "\n";
