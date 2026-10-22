<?php
// The daily huddle: everything outstanding across the practice, grouped
// for a morning team meeting, and the source of the daily email digest
// (which carries counts only — never patient details).
require_once __DIR__ . '/pi_rules.php';

const HUDDLE_SECTIONS = [
    'tasks' => 'Tasks overdue or due today',
    'care' => 'Treatment plan & care',
    'referrals' => 'Referrals & evaluations',
    'money' => 'Insurance & case value',
    'legal' => 'Attorney & settlement',
    'checklist' => 'Checklist items overdue',
];

// $user decides what money-related items appear (financial visibility).
// Returns ['date', 'sections' => key => [title, items]], each item:
// caseId, patient, caseNumber, text, level, criterion (a NOTIFY_CRITERIA
// key or null), and for tasks the assignees.
function build_huddle(PDO $pdo, array $user, int $practiceId): array {
    $today = date('Y-m-d');
    $rules = practice_rules();
    $bal = fin_can($user, 'balances');
    $stmt = $pdo->prepare("SELECT c.*, p.first_name, p.last_name FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')");
    $stmt->execute([$practiceId]);
    $cases = $stmt->fetchAll();
    $ctx = bulk_case_context($pdo, $cases);
    $sections = array_map(fn($t) => ['title' => $t, 'items' => []], HUDDLE_SECTIONS);
    $item = fn(array $c, string $text, string $level, ?string $crit) => ['caseId' => (int)$c['id'], 'patient' => trim($c['first_name'] . ' ' . $c['last_name']),
        'caseNumber' => $c['case_number'], 'text' => $text, 'level' => $level, 'criterion' => $crit];

    foreach ($cases as $c) {
        $x = $ctx[(int)$c['id']];
        $inCare = in_array($c['stage'], ['intake', 'treating'], true) && !$c['mmi_date'];
        $attended = $x['attendedDates'] ?? [];
        // Care: gaps and plan adherence, computed directly.
        if ($inCare && $c['actively_treating'] && $c['first_visit']) {
            $last = $attended ? max($attended) : $c['first_visit'];
            $gap = days_between($last, $today);
            $out = outreach_state($c, $x['outreach'] ?? [], $attended);
            $adh = plan_adherence($c, $attended);
            $issue = null;
            if ($gap > $rules['gap_days']) $issue = ["No visit in $gap days (last " . us_date($last) . ')', 'high', 'gap'];
            elseif ($adh && $adh['ratio'] * 100 < $rules['adherence_pct']) $issue = [$adh['actual'] . ' of ' . rtrim(rtrim(number_format($adh['expected'], 1), '0'), '.') . ' planned visits in the last ' . $adh['days'] . ' days (' . plan_label($adh['rate']) . ')', 'medium', 'adherence'];
            if ($issue && $out['state'] === 'hold') {
                // Attorney already told; no more calls until the patient returns.
            } elseif ($issue && $out['state'] === 'notify') {
                $sections['legal']['items'][] = $item($c, 'Send attendance update to the attorney/paralegal — ' . $out['attempts'] . ' outreach attempts without a return visit', 'high', $issue[2]);
            } elseif ($issue && $out['state'] !== 'scheduled') {
                $sections['care']['items'][] = $item($c, $issue[0] . ' — ' . ($out['attempts'] ? 'outreach attempt ' . ($out['attempts'] + 1) . ' of ' . OUTREACH_ATTEMPTS : 'call the patient'), $issue[1], $issue[2]);
            }
        }
        // Referrals, evaluations, re-exams and maintenance from the care guide.
        $paused = outreach_state($c, $x['outreach'] ?? [], $attended)['state'] === 'hold';
        foreach ($x['guide'] ?? [] as $g) {
            if ($g['status'] !== 'now') continue;
            if ($paused && in_array($g['key'], ['reexam', 'maintenance'], true)) continue;   // can't schedule an unreachable patient
            if ($g['key'] === 'maintenance') { $sections['care']['items'][] = $item($c, $g['text'], 'medium', 'maintenance'); continue; }
            if (!$inCare) continue;
            if ($g['key'] === 'reexam') { $sections['care']['items'][] = $item($c, $g['text'], 'medium', 'reexam'); continue; }
            if ($g['key'] === 'mri') {
                // Due at visit #1; listed from the day after.
                if ($g['due'] && $g['due'] < $today) $sections['referrals']['items'][] = $item($c, 'MRI not ordered — first visit ' . us_date($g['due']), 'high', 'mri');
                continue;
            }
            if ($g['key'] === 'emc') {
                if ($g['due'] && $g['due'] < $today) $sections['referrals']['items'][] = $item($c, 'EMC determination overdue — week 1 ended ' . us_date($g['due']), 'high', 'emc');
                continue;
            }
            $sections['referrals']['items'][] = $item($c, $g['title'] . ': ' . $g['text'], 'medium', 'referrals');
        }
        // Everything else from the case alerts, sorted into sections.
        foreach (case_alerts($c, $x) as $a) {
            if (!empty($a['fin']) && !$bal) continue;
            $t = $a['text'];
            if (preg_match('/^(No visit in|Not following the treatment plan|Attorney notified|\d+ outreach attempts|Re-exam due|Maintenance care|MRI referral due|EMC determination due|Orthopedic referral due|Neurology referral due|Pain management referral due|Consider a|Head injury\?)/', $t)) continue;  // covered above
            if (!empty($a['fin'])) $sec = 'money';
            elseif (str_starts_with($t, 'Overdue: ')) $sec = 'checklist';
            elseif (preg_match('/attorney|correspondence|Settled|settled|Reduction|Follow-up due/i', $t)) $sec = 'legal';
            elseif (preg_match('/PIP|EMC|insurance|authoriz|DWC-25|policy limits|letter of protection|patient balance/i', $t)) $sec = 'money';
            else $sec = 'referrals';
            if ($sec === 'money' && !$bal && preg_match('/PIP has paid|insurance charge/', $t)) continue;
            $crit = !empty($a['fin']) ? 'money' : null;
            $sections[$sec]['items'][] = $item($c, $bal ? $t : redact_money($t), $a['level'], $crit);
        }
    }
    // Tasks: overdue or due today, everyone's.
    $t = $pdo->prepare("SELECT t.id, t.title, t.due_on, t.priority, t.case_id, c.case_number, p.first_name, p.last_name,
            (SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ', ') FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = t.id) assignees,
            (SELECT GROUP_CONCAT(ta.user_id) FROM task_assignees ta WHERE ta.task_id = t.id) assignee_ids
        FROM tasks t LEFT JOIN cases c ON c.id = t.case_id LEFT JOIN patients p ON p.id = c.patient_id
        WHERE t.practice_id = ? AND t.done_at IS NULL AND t.archived_at IS NULL AND t.due_on IS NOT NULL AND t.due_on <= ? ORDER BY t.due_on, t.priority = 'high' DESC");
    $t->execute([$practiceId, $today]);
    foreach ($t->fetchAll() as $r) {
        $sections['tasks']['items'][] = ['caseId' => $r['case_id'] ? (int)$r['case_id'] : null, 'patient' => $r['case_id'] ? trim($r['first_name'] . ' ' . $r['last_name']) : null,
            'caseNumber' => $r['case_number'], 'text' => $r['title'] . ($r['due_on'] < $today ? ' — overdue since ' . us_date($r['due_on']) : ' — due today'),
            'level' => $r['due_on'] < $today ? 'high' : ($r['priority'] === 'high' ? 'medium' : 'low'), 'criterion' => 'tasks',
            'taskId' => (int)$r['id'], 'assignees' => $r['assignees'] ?: 'Anyone', 'assigneeIds' => $r['assignee_ids'] ? array_map('intval', explode(',', $r['assignee_ids'])) : []];
    }
    // Checklist: one row per patient listing their overdue items.
    $byCase = [];
    foreach ($sections['checklist']['items'] as $i) {
        $label = preg_replace('/^Overdue: | \(due [^)]*\)$/', '', $i['text']);
        $byCase[$i['caseId']] ??= $i + ['labels' => []];
        $byCase[$i['caseId']]['labels'][] = $label;
    }
    $sections['checklist']['items'] = array_values(array_map(function ($i) {
        $n = count($i['labels']);
        $i['text'] = $n . ' overdue: ' . implode(' · ', $i['labels']);
        unset($i['labels']);
        return $i;
    }, $byCase));
    $rank = ['high' => 0, 'medium' => 1, 'low' => 2];
    foreach ($sections as &$s) usort($s['items'], fn($a, $b) => [$rank[$a['level']], $a['patient'] ?? ''] <=> [$rank[$b['level']], $b['patient'] ?? '']);
    unset($s);
    return ['date' => $today, 'sections' => $sections, 'rules' => $rules];
}

// Counts for one person's digest: the practice's criteria they chose;
// tasks count only those assigned to them (or to anyone).
function digest_counts(array $huddle, array $user, array $criteria): array {
    $counts = array_fill_keys($criteria, 0);
    foreach ($huddle['sections'] as $s) foreach ($s['items'] as $i) {
        $c = $i['criterion'] ?? null;
        if (!$c || !isset($counts[$c])) continue;
        if ($c === 'tasks' && $i['assigneeIds'] && !in_array((int)$user['id'], $i['assigneeIds'], true)) continue;
        $counts[$c]++;
    }
    return array_filter($counts);
}
