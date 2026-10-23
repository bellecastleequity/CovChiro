<?php
// Task email alerts (Gold plan and up): email the people on a task's list
// when it's marked urgent (high priority), when it goes late (then again
// every N days until done) and when it's completed. Like every email we
// send, these never include patient names, case details or the task's own
// title or notes (staff often type patient names there) — just what
// happened, the due date, and a link to sign in and open the task.

require_once __DIR__ . '/mailer.php';

const TASK_EMAIL_EVENTS = ['urgent' => 'Marked urgent (high priority)', 'late' => 'Late (past its due date)', 'done' => 'Completed'];
const TASK_EMAIL_WHO = ['assignees' => 'People assigned', 'creator' => 'Person who created it'];
const TASK_EMAIL_DEFAULTS = ['on' => ['urgent', 'late', 'done'], 'who' => ['assignees', 'creator'], 'repeat_days' => 5];

// The practice's defaults for new tasks.
function task_email_rules(?array $practice = null): array {
    $p = $practice ?? current_practice();
    $saved = $p && !empty($p['task_email_rules']) ? (json_decode($p['task_email_rules'], true) ?: []) : [];
    $r = array_merge(TASK_EMAIL_DEFAULTS, array_intersect_key($saved, TASK_EMAIL_DEFAULTS));
    $r['on'] = array_values(array_intersect(array_keys(TASK_EMAIL_EVENTS), (array)$r['on']));
    $r['who'] = array_values(array_intersect(array_keys(TASK_EMAIL_WHO), (array)$r['who']));
    $r['repeat_days'] = task_repeat_days($r['repeat_days']);
    return $r;
}

function task_repeat_days($v): int { return max(0, min(60, (int)$v)); }

function task_csv(?string $v, array $allowed): array {
    return array_values(array_intersect(array_keys($allowed), explode(',', (string)$v)));
}

// Who gets an email about $task: its list, filtered to active team members
// who haven't turned task emails off and can open the task (a person
// limited to one location only hears about that location's cases).
function task_recipients(array $task, ?int $exclude = null): array {
    $pdo = pi_db();
    $who = task_csv($task['email_who'], TASK_EMAIL_WHO);
    $ids = [];
    if (in_array('assignees', $who, true)) {
        $s = $pdo->prepare('SELECT user_id FROM task_assignees WHERE task_id = ?'); $s->execute([$task['id']]);
        $ids = array_merge($ids, $s->fetchAll(PDO::FETCH_COLUMN));
    }
    if (in_array('creator', $who, true) && $task['created_by']) $ids[] = $task['created_by'];
    $s = $pdo->prepare('SELECT user_id FROM task_email_to WHERE task_id = ?'); $s->execute([$task['id']]);
    $ids = array_values(array_diff(array_unique(array_map('intval', array_merge($ids, $s->fetchAll(PDO::FETCH_COLUMN)))), [(int)$exclude]));
    if (!$ids) return [];
    $loc = null;
    if ($task['case_id']) { $s = $pdo->prepare('SELECT location_id FROM cases WHERE id = ?'); $s->execute([$task['case_id']]); $loc = $s->fetchColumn() ?: null; }
    $s = $pdo->prepare('SELECT id, name, email, location_id, location_restricted FROM users WHERE practice_id = ? AND active = 1 AND notify_tasks = 1 AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
    $s->execute([$task['practice_id'], ...$ids]);
    return array_values(array_filter($s->fetchAll(), fn($u) => !$u['location_restricted'] || !$task['case_id'] || (int)$u['location_id'] === (int)$loc));
}

function task_email_message(string $event, array $task, array $practice, array $to, ?string $actor = null): array {
    $due = $task['due_on'] ? date('l, F j', strtotime($task['due_on'])) : null;
    $brand = brand_name_for($practice);
    switch ($event) {
        case 'urgent':
            $subject = $brand . ': a task was marked urgent';
            $line = ($actor ? "$actor marked a task" : 'A task was marked') . " at {$practice['name']} as high priority" . ($due ? ", due $due." : '.');
            break;
        case 'late':
            $days = max(1, (int)floor((strtotime(date('Y-m-d')) - strtotime($task['due_on'])) / 86400));
            $subject = $brand . ': a task is ' . $days . ' day' . ($days === 1 ? '' : 's') . ' late';
            $line = "A task at {$practice['name']} is past its due date — it was due $due ($days day" . ($days === 1 ? '' : 's') . ' ago) and is still open.';
            break;
        default:
            $subject = $brand . ': a task was completed';
            $line = ($actor ? "$actor completed a task" : 'A task was completed') . " at {$practice['name']}" . ($due ? " (it was due $due)." : '.');
    }
    // First name, or the whole name when it starts with a title ("Dr. A").
    $first = explode(' ', trim($to['name']))[0];
    $text = 'Hi ' . (str_ends_with($first, '.') ? trim($to['name']) : $first) . ",\n\n$line\n\nSign in to open it:\n" . APP_URL . '/app.html#/tasks/' . $task['id'] . "\n\n"
        . "For privacy, this email never includes patient names, case details or the task itself — sign in to see them.\n"
        . "You're getting this because you're on this task's email list. Turn task emails off under \"Email notifications\" in " . $brand . ".\n\n— " . $brand . "\n";
    return [$subject, $text];
}

// Sends one event's emails; returns how many went out. $actor is the team
// member who caused it (not emailed about their own change).
function task_email_send(string $event, array $task, array $practice, ?array $actor = null): int {
    if (!has_feature($practice, 'task_emails') || practice_access($practice) !== 'full' || !mail_configured()) return 0;
    if (!in_array($event, task_csv($task['email_on'], TASK_EMAIL_EVENTS), true)) return 0;
    $sent = 0;
    foreach (task_recipients($task, $actor['id'] ?? null) as $u) {
        [$subject, $text] = task_email_message($event, $task, $practice, $u, $actor['name'] ?? null);
        if (send_mail($u['email'], $subject, $text, brand_name_for($practice))) $sent++;
    }
    if ($sent) audit('email_task_' . $event, 'task', $task['id'], $task['case_id'] ? (int)$task['case_id'] : null,
        ['id' => null, 'email' => 'system', 'practice_id' => $practice['id']], $sent . ' recipient' . ($sent === 1 ? '' : 's'));
    return $sent;
}

// Late tasks due an email today: never emailed late yet, or the repeat
// interval has passed since the last one.
function task_late_due(PDO $pdo, array $practice, string $today): array {
    $repeat = task_email_rules($practice)['repeat_days'];
    $s = $pdo->prepare("SELECT * FROM tasks WHERE practice_id = ? AND done_at IS NULL AND archived_at IS NULL AND due_on IS NOT NULL AND due_on < ?
        AND FIND_IN_SET('late', email_on) ORDER BY id");
    $s->execute([$practice['id'], $today]);
    return array_values(array_filter($s->fetchAll(), function ($t) use ($repeat, $today) {
        if (!$t['late_emailed_at']) return true;
        $every = $t['late_repeat_days'] === null ? $repeat : (int)$t['late_repeat_days'];
        return $every > 0 && add_days(substr($t['late_emailed_at'], 0, 10), $every) <= $today;
    }));
}
