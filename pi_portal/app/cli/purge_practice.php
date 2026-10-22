<?php
// Permanent deletion of a practice's data, as the Terms (section 7) and the
// Business Associate Agreement (section 11) promise: a practice whose
// subscription or trial ended keeps read-only access for 12 months; after
// that — and at least 30 days after the account owner is emailed a notice
// — its data is destroyed. A practice may also ask for earlier deletion
// after exporting what it needs.
//
//   php app/cli/purge_practice.php --list
//       practices past the retention period (and those within 30 days of
//       it, to send the notice to)
//   php app/cli/purge_practice.php --practice=ID
//       what would be deleted (a dry run)
//   php app/cli/purge_practice.php --practice=ID --confirm [--early]
//       delete it; --early for a practice's own request before 12 months
//
// Deletes every row belonging to the practice (patients, cases and all
// case records, documents and their encrypted files, users, contacts,
// settings, its audit log) and the practice itself. Encrypted backups
// expire within 35 days. A record of the deletion (counts only, no
// patient data) stays in the operator audit log.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

const RETENTION_DAYS = 365;
const NOTICE_DAYS = 30;

$opt = getopt('', ['list', 'practice:', 'confirm', 'early']);
$pdo = pi_db();

// When access ended: the end of the last paid period, or of the trial.
function ended_on(array $p): ?string {
    if (practice_access($p) === 'full') return null;
    $d = $p['subscription_status'] === 'trialing' ? $p['trial_ends_at'] : ($p['current_period_end'] ?: $p['trial_ends_at']);
    return $d ? substr($d, 0, 10) : null;
}

function owner_email(int $id): ?string {
    $s = pi_db()->prepare("SELECT email FROM users WHERE practice_id = ? AND role = 'admin' ORDER BY id LIMIT 1");
    $s->execute([$id]);
    return $s->fetchColumn() ?: null;
}

if (isset($opt['list'])) {
    $today = date('Y-m-d'); $rows = 0;
    foreach ($pdo->query("SELECT * FROM practices WHERE subscription_status <> 'comped' ORDER BY id")->fetchAll() as $p) {
        if (!($end = ended_on($p))) continue;
        $deleteOn = add_days($end, RETENTION_DAYS);
        if ($deleteOn > add_days($today, NOTICE_DAYS)) continue;
        printf("#%d  %-32s access ended %s  %s  owner %s\n", $p['id'], mb_substr($p['name'], 0, 32), $end,
            $deleteOn <= $today ? 'ELIGIBLE for deletion (confirm the 30-day notice was sent)' : "send notice now — deletion due $deleteOn", owner_email((int)$p['id']) ?? '—');
        $rows++;
    }
    echo $rows ? '' : "No practices are past or near the retention period.\n";
    exit;
}

$id = (int)($opt['practice'] ?? 0);
$s = $pdo->prepare('SELECT * FROM practices WHERE id = ?'); $s->execute([$id]);
$p = $s->fetch();
if (!$p) exit("Usage: --list | --practice=ID [--confirm] [--early]\n");
if (practice_access($p) === 'full') exit("Practice #$id still has an active subscription or trial. Cancel it first.\n");
$end = ended_on($p);
if (!isset($opt['early']) && (!$end || add_days($end, RETENTION_DAYS) > date('Y-m-d'))) exit("Practice #$id is still within its 12-month read-only period (access ended " . ($end ?? 'unknown') . "). Use --early only on the practice's written request.\n");

// Every table, scoped to this practice.
$caseIds = "SELECT id FROM cases WHERE practice_id = $id";
$taskIds = "SELECT id FROM tasks WHERE practice_id = $id";
$userIds = "SELECT id FROM users WHERE practice_id = $id";
$scopes = [
    'task_assignees' => "task_id IN ($taskIds)", 'task_email_to' => "task_id IN ($taskIds)", 'tasks' => "practice_id = $id",
    'case_estimates' => "case_id IN ($caseIds)", 'case_milestones' => "case_id IN ($caseIds)", 'case_guide' => "case_id IN ($caseIds)",
    'referrals' => "case_id IN ($caseIds)", 'outreach' => "case_id IN ($caseIds)", 'visits' => "case_id IN ($caseIds)", 'outcomes' => "case_id IN ($caseIds)",
    'status_requests' => "practice_id = $id", 'correspondence' => "case_id IN ($caseIds)", 'ledger' => "case_id IN ($caseIds)",
    'ehr_imports' => "case_id IN ($caseIds)", 'documents' => "case_id IN ($caseIds)", 'coverages' => "case_id IN ($caseIds)",
    'cases' => "practice_id = $id", 'patients' => "practice_id = $id", 'contacts' => "practice_id = $id",
    'schedule_imports' => "practice_id = $id", 'ehr_formats' => "practice_id = $id", 'practice_steps' => "practice_id = $id",
    'practice_silenced' => "practice_id = $id", 'locations' => "practice_id = $id", 'feedback' => "practice_id = $id",
    'trial_notices' => "practice_id = $id", 'digest_log' => "user_id IN ($userIds)", 'audit_log' => "practice_id = $id",
    'users' => "practice_id = $id", 'practices' => "id = $id",
];
$counts = [];
foreach ($scopes as $t => $w) $counts[$t] = (int)$pdo->query("SELECT COUNT(*) FROM $t WHERE $w")->fetchColumn();
$files = $pdo->query("SELECT storage_name FROM documents WHERE case_id IN ($caseIds)")->fetchAll(PDO::FETCH_COLUMN);
echo "Practice #$id ({$p['name']}) — access ended " . ($end ?? 'unknown') . "\n";
foreach ($counts as $t => $n) if ($n) printf("  %-18s %d\n", $t, $n);
echo '  document files     ' . count($files) . "\n";
if (!isset($opt['confirm'])) exit("\nDry run — nothing deleted. Add --confirm to delete permanently.\n");

$pdo->beginTransaction();
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
foreach ($scopes as $t => $w) $pdo->exec("DELETE FROM $t WHERE $w");
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
$pdo->commit();
$gone = 0;
foreach ($files as $f) if (preg_match('/^[a-f0-9]{64}$/', $f) && @unlink(PI_STORAGE_DIR . '/' . $f)) $gone++;
audit('practice_purged', 'practice', $id, null, ['id' => null, 'email' => 'operator cli', 'practice_id' => null],
    json_encode(['early' => isset($opt['early']), 'ended' => $end, 'rows' => array_sum($counts), 'files' => $gone]));
echo "\nDeleted. " . array_sum($counts) . " rows and $gone document files removed. Encrypted backups expire within 35 days.\n";
