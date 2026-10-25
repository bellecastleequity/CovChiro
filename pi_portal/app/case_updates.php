<?php
// Monthly case updates to the attorney / case manager (on by default; the
// practice or a single case can turn them off). Every 30 days the office
// sends a short appointment-history and progress summary: visits kept and
// missed by week, outcome-score trends, referrals made and completed, and a
// balance snapshot clearly marked as not the official ledger. The email
// itself holds no patient details — only a secure link (expires after
// CASE_UPDATE_LINK_DAYS) to the summary, frozen as it was when sent.

const CASE_UPDATE_EVERY_DAYS = 30;
const CASE_UPDATE_LINK_DAYS = 30;
// Outcome questionnaires where a lower score is better (all of ours).
const OUTCOME_LOWER_IS_BETTER = ['bournemouth_neck', 'bournemouth_back', 'oswestry', 'ndi', 'hdi', 'shoulder', 'knee', 'adl'];

function case_updates_on(array $practice): bool {
    return (int)($practice['case_updates'] ?? 1) === 1;
}

// Attorney and case manager emails on file: [[email, name], ...].
function case_update_recipients(array $case): array {
    return status_recipients(['auto_status_to' => 'both'] + $case);
}

// Why a case can't get an update now, or null.
function case_update_problem(array $case, array $practice): ?string {
    if (!case_updates_on($practice)) return 'Monthly case updates are turned off for your practice.';
    if (!in_array($case['injury_type'], LIABILITY_CASES, true)) return 'Case updates go to an attorney on injury cases.';
    if (!case_update_recipients($case)) return 'Add an email address for the attorney or case manager first.';
    return null;
}

// Everything the update shows, as of today.
function case_update_snapshot(array $case, array $practice): array {
    $pdo = pi_db();
    $pt = $pdo->prepare('SELECT first_name, last_name FROM patients WHERE id = ?'); $pt->execute([$case['patient_id']]); $pt = $pt->fetch();
    $v = $pdo->prepare("SELECT visit_date, visit_type FROM visits WHERE case_id = ? AND archived_at IS NULL ORDER BY visit_date"); $v->execute([$case['id']]);
    $visits = $v->fetchAll();
    $kept = array_values(array_filter($visits, fn($x) => $x['visit_type'] !== 'no_show'));
    $missed = array_values(array_filter($visits, fn($x) => $x['visit_type'] === 'no_show'));
    // Visits kept and missed per week, most recent 12 weeks of care.
    $weeks = [];
    foreach ($visits as $x) {
        $wk = date('Y-m-d', strtotime('monday this week', strtotime($x['visit_date'])));
        $weeks[$wk] ??= ['week' => $wk, 'kept' => 0, 'missed' => 0];
        $weeks[$wk][$x['visit_type'] === 'no_show' ? 'missed' : 'kept']++;
    }
    ksort($weeks);
    $weeks = array_slice(array_values($weeks), -12);
    // Attendance trend: the last four weeks against the four before.
    $recent = array_slice($weeks, -4); $prior = array_slice($weeks, -8, 4);
    $rate = fn($w) => ($t = array_sum(array_column($w, 'kept')) + array_sum(array_column($w, 'missed'))) ? array_sum(array_column($w, 'kept')) / $t : null;
    [$rNow, $rBefore] = [$rate($recent), $rate($prior)];
    $attTrend = $rNow === null || $rBefore === null ? null : ($rNow > $rBefore + 0.05 ? 'improving' : ($rNow < $rBefore - 0.05 ? 'declining' : 'steady'));
    // Outcome scores: first and latest of each questionnaire.
    $o = $pdo->prepare('SELECT measure, score, taken_on FROM outcomes WHERE case_id = ? AND archived_at IS NULL ORDER BY taken_on, id'); $o->execute([$case['id']]);
    $by = [];
    foreach ($o->fetchAll() as $r) $by[$r['measure']][] = $r;
    $outcomes = [];
    foreach ($by as $m => $rows) {
        $first = $rows[0]; $last = end($rows);
        $delta = (float)$last['score'] - (float)$first['score'];
        $better = in_array($m, OUTCOME_LOWER_IS_BETTER, true) ? $delta < 0 : $delta > 0;
        $outcomes[] = ['measure' => OUTCOME_MEASURES[$m] ?? $m, 'first' => (float)$first['score'], 'firstOn' => $first['taken_on'], 'latest' => (float)$last['score'], 'latestOn' => $last['taken_on'],
            'trend' => count($rows) < 2 || abs($delta) < 0.5 ? 'unchanged' : ($better ? 'better' : 'worse')];
    }
    // Referrals made and completed.
    $rf = $pdo->prepare('SELECT type, specialty, status, ordered_on, completed_on, report_received_on FROM referrals WHERE case_id = ? AND archived_at IS NULL ORDER BY ordered_on, id'); $rf->execute([$case['id']]);
    $refs = array_map(fn($r) => ['type' => $r['type'] === 'other' && $r['specialty'] ? $r['specialty'] : (REFERRAL_TYPES[$r['type']] ?? $r['type']), 'orderedOn' => $r['ordered_on'],
        'completedOn' => $r['completed_on'] ?: $r['report_received_on'], 'status' => $r['status']], $rf->fetchAll());
    $t = ledger_totals_by_case($pdo, [(int)$case['id']])[(int)$case['id']] ?? null;
    return [
        'patient' => trim($pt['first_name'] . ' ' . $pt['last_name']), 'caseNumber' => $case['case_number'], 'dateOfInjury' => $case['date_of_injury'],
        'firstVisit' => $case['first_visit'], 'lastVisit' => $kept ? end($kept)['visit_date'] : null, 'kept' => count($kept), 'missed' => count($missed),
        'weeks' => $weeks, 'attendanceTrend' => $attTrend, 'outcomes' => $outcomes,
        'referralsMade' => $refs, 'referralsCompleted' => array_values(array_filter($refs, fn($r) => $r['completedOn'])),
        'balance' => $t && status_rules($practice)['show_balance'] ? ['patient' => round((float)$t['patient_balance'], 2), 'insurancePaid' => round((float)$t['insurance_paid'], 2), 'charges' => round((float)$t['total_charges'], 2)] : null,
        'stage' => STAGES[$case['stage']] ?? $case['stage'], 'asOf' => date('Y-m-d'),
    ];
}

// Sends the update now. Returns ['sent' => n] or ['error' => ...].
function case_update_send(array $case, array $practice, string $kind = 'auto', ?array $user = null): array {
    if ($problem = case_update_problem($case, $practice)) return ['error' => $problem];
    require_once __DIR__ . '/mailer.php';
    $to = case_update_recipients($case);
    $token = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', time() + CASE_UPDATE_LINK_DAYS * 86400);
    $head = status_letterhead($case, $practice);
    $wl = white_label_active($practice);
    $sent = [];
    foreach ($to as [$email, $name]) {
        $text = 'Hello ' . ($name ? explode(' ', trim($name))[0] : 'there') . ",\n\n"
            . "Thank you — you and your team make caring for our mutual clients a pleasure. Here is this month's case update from {$head['name']}: appointment history and attendance, progress on outcome assessments, referrals made and completed, and a balance snapshot.\n\n"
            . "For the client's privacy, their details are not included in this email. View the update securely here (no account or password needed):\n\n"
            . APP_URL . '/api/update.php?t=' . $token . "\n\n"
            . 'The link expires on ' . date('F j, Y', strtotime($expires)) . ". For updated treatment notes, an official itemized ledger, or anything else, contact us"
            . ($head['phone'] ? " at {$head['phone']}" : '') . (!empty($practice['email']) ? ' or ' . $practice['email'] : '') . ".\n\n"
            . "Warm regards,\n{$head['name']}\n" . (($line = implode(' · ', array_filter([$head['address'], $head['phone']]))) ? "$line\n" : '') . "\n"
            . ($wl ? 'Sent on behalf of ' : 'Sent through ' . BRAND_NAME . ' on behalf of ') . $practice['name'] . ". You can ask the office to stop these monthly updates at any time.\n";
        if (send_mail($email, 'Monthly case update — ' . $head['name'], $text, $wl ? $head['name'] : null)) $sent[] = $email;
    }
    if (!$sent) return ['error' => 'The email could not be sent. Please try again later.'];
    $snap = case_update_snapshot($case, $practice);
    pi_db()->prepare('INSERT INTO case_reports (practice_id, case_id, token_hash, kind, sent_to, sent_by, sent_at, expires_at, snapshot_enc) VALUES (?,?,?,?,?,?,?,?,?)')
        ->execute([$practice['id'], $case['id'], hash('sha256', $token), $kind, implode(', ', $sent), $user['id'] ?? null, now_str(), $expires, enc(json_encode($snap))]);
    pi_db()->prepare('UPDATE cases SET case_update_last_on = ? WHERE id = ?')->execute([date('Y-m-d'), $case['id']]);
    audit('case_update_sent', 'case', $case['id'], (int)$case['id'], $user ?? ['id' => null, 'email' => 'system', 'practice_id' => $practice['id']], ($kind === 'auto' ? 'automatic' : 'sent by hand') . ' to ' . implode(', ', $sent));
    return ['sent' => count($sent), 'to' => $sent];
}

function case_update_due(array $case, string $today): bool {
    if (!(int)($case['case_updates'] ?? 1) || !$case['first_visit']) return false;
    $last = $case['case_update_last_on'] ?: $case['first_visit'];
    return add_days($last, CASE_UPDATE_EVERY_DAYS) <= $today;
}

// The summary page (the attorney's view, and the office's preview).
function case_update_html(array $s, array $head, ?array $brand = null): string {
    $h = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
    $d = fn($v) => $v ? date('m/d/Y', strtotime($v)) : '—';
    $money = fn($n) => '$' . number_format((float)$n, 2);
    $trend = ['improving' => 'Attendance is improving', 'declining' => 'Attendance has slipped recently', 'steady' => 'Attendance is steady'];
    $rows = implode('', array_map(fn($w) => '<tr><td>Week of ' . $h($d($w['week'])) . '</td><td class="n">' . (int)$w['kept'] . '</td><td class="n">' . (int)$w['missed'] . '</td></tr>', $s['weeks']));
    $out = implode('', array_map(fn($o) => '<tr><td>' . $h($o['measure']) . '</td><td class="n">' . $h($o['first']) . ' <span class="m">(' . $h($d($o['firstOn'])) . ')</span></td><td class="n">' . $h($o['latest']) . ' <span class="m">(' . $h($d($o['latestOn'])) . ')</span></td><td>'
        . ['better' => '▲ Improving', 'worse' => '▼ Worse', 'unchanged' => '— Unchanged'][$o['trend']] . '</td></tr>', $s['outcomes']));
    $refs = implode('', array_map(fn($r) => '<tr><td>' . $h($r['type']) . '</td><td>' . $h($d($r['orderedOn'])) . '</td><td>' . ($r['completedOn'] ? 'Completed ' . $h($d($r['completedOn'])) : $h(ucfirst(str_replace('_', ' ', (string)$r['status'])))) . '</td></tr>', $s['referralsMade']));
    $logo = $brand && $brand['logo'] ? '<img src="../' . $h($brand['logo']) . '" alt="" style="max-height:44px">' : '';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Case update — ' . $h($head['name']) . '</title>'
        . '<style>body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0F1733;background:#F4F6FB;margin:0;padding:24px 16px}main{max-width:820px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 32px;box-shadow:0 6px 20px rgba(15,23,51,.06)}'
        . 'h1{font-size:1.4rem;margin:.2em 0}h2{font-size:1.05rem;margin:1.6em 0 .5em}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E1E5EE}td.n,th.n{text-align:right}.m{color:#5B6476;font-size:.85em}'
        . '.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:14px}.kv div{background:#F4F6FB;border-radius:10px;padding:10px 12px}.kv small{display:block;color:#5B6476}.note{background:#FFF7E6;border:1px solid #F5C26B;border-radius:10px;padding:10px 12px;font-size:.9rem}.muted{color:#5B6476}@media(max-width:520px){main{padding:20px 16px}table{font-size:.85rem}th,td{padding:6px 4px}td .m{display:block}}</style></head><body><main>'
        . $logo . '<p class="muted" style="margin:.6em 0 0">' . $h($head['name']) . ($head['phone'] ? ' · ' . $h($head['phone']) : '') . '</p>'
        . '<h1>Monthly case update</h1><p class="muted">As of ' . $h($d($s['asOf'])) . '</p>'
        . '<div class="kv"><div><small>Client</small><b>' . $h($s['patient']) . '</b></div><div><small>Date of injury</small><b>' . $h($d($s['dateOfInjury'])) . '</b></div><div><small>Our case #</small><b>' . $h($s['caseNumber']) . '</b></div>'
        . '<div><small>First / last visit</small><b>' . $h($d($s['firstVisit'])) . ' – ' . $h($d($s['lastVisit'])) . '</b></div><div><small>Visits kept / missed</small><b>' . (int)$s['kept'] . ' / ' . (int)$s['missed'] . '</b></div><div><small>Status</small><b>' . $h($s['stage']) . '</b></div></div>'
        . '<h2>Appointment history</h2>' . ($s['attendanceTrend'] ? '<p>' . $h($trend[$s['attendanceTrend']]) . '.</p>' : '') . ($rows ? '<table><thead><tr><th>Week</th><th class="n">Kept</th><th class="n">Missed</th></tr></thead><tbody>' . $rows . '</tbody></table>' : '<p class="muted">No visits yet.</p>')
        . '<h2>Progress — outcome assessments</h2>' . ($out ? '<table><thead><tr><th>Assessment</th><th class="n">First</th><th class="n">Latest</th><th>Trend</th></tr></thead><tbody>' . $out . '</tbody></table><p class="m">Lower scores mean less pain and disability.</p>' : '<p class="muted">No outcome assessments recorded yet.</p>')
        . '<h2>Referrals</h2><p>' . count($s['referralsMade']) . ' made · ' . count($s['referralsCompleted']) . ' completed</p>' . ($refs ? '<table><thead><tr><th>Referral</th><th>Ordered</th><th>Status</th></tr></thead><tbody>' . $refs . '</tbody></table>' : '')
        . ($s['balance'] ? '<h2>Balance snapshot</h2><div class="note"><b>Not an official ledger</b> — a snapshot for case management only. Ask our office for an itemized ledger.</div>'
            . '<div class="kv"><div><small>Total charges to date</small><b>' . $money($s['balance']['charges']) . '</b></div><div><small>Insurance paid to date</small><b>' . $money($s['balance']['insurancePaid']) . '</b></div><div><small>Outstanding patient balance</small><b>' . $money($s['balance']['patient']) . '</b></div></div>' : '')
        . '<h2>Need anything else?</h2><p>For updated treatment notes, an official itemized ledger, or any other request, contact our office' . ($head['phone'] ? ' at <b>' . $h($head['phone']) . '</b>' : '') . (!empty($head['email']) ? ' or <a href="mailto:' . $h($head['email']) . '">' . $h($head['email']) . '</a>' : '') . '.</p>'
        . '<p>Thank you to you and your team — it\'s a pleasure caring for your client together.</p>'
        . '<p class="m" style="margin-top:2em">Confidential: this page contains protected health information shared with the client\'s legal representative. Please don\'t forward the link.</p></main></body></html>';
}
