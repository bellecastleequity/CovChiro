<?php
// The numbers behind auto/PIP EOBs: what each line tells the practice, and
// the practice-wide view by payer and by procedure code.
//
// Florida PIP allows 200% of the Medicare Part B fee schedule (80% of the
// workers' compensation schedule for codes Medicare doesn't price) and pays
// 80% of that, so a code's allowed amount is nearly the same from every
// payer in a region for a year. The practice's own EOBs therefore show what
// each code is "usually allowed" — and a payer allowing less, or allowing a
// whole charge (the fee may be below the schedule), stands out.

const EOB_UNDERPAID_SLACK = 0.03;      // 3% below the usual allowed
const EOB_OVERDUE_DAYS = 30;           // FL §627.736(4)(b): pay within 30 days of notice

function eob_median(array $v): ?float {
    if (!$v) return null;
    sort($v);
    $n = count($v);
    return round($n % 2 ? $v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2, 2);
}

// code => usual allowed (fee-schedule level), seen on the practice's EOBs in
// the last 18 months. Denied and exhausted lines don't count.
function eob_usual_allowed(int $practiceId, ?int $exceptEob = null): array {
    $s = pi_db()->prepare("SELECT l.code, l.allowed_full, l.charged, e.payer, COALESCE(l.dos, e.eob_date) d FROM eob_lines l JOIN eobs e ON e.id = l.eob_id
        WHERE e.practice_id = ? AND e.archived_at IS NULL AND e.status <> 'exhausted' AND l.allowed_full > 0 AND COALESCE(l.dos, e.eob_date, DATE(e.created_at)) >= ? AND e.id <> ?
        ORDER BY d DESC");
    $s->execute([$practiceId, date('Y-m-d', strtotime('-18 months')), $exceptEob ?? 0]);
    $by = [];
    foreach ($s->fetchAll() as $r) {
        $c = $r['code'];
        $by[$c]['allowed'][] = (float)$r['allowed_full'];
        $by[$c]['payers'][$r['payer']] = true;
        $by[$c]['charge'] = $by[$c]['charge'] ?? (float)$r['charged'];
    }
    $out = [];
    foreach ($by as $c => $x) $out[$c] = ['usual' => eob_median($x['allowed']), 'n' => count($x['allowed']), 'min' => min($x['allowed']), 'max' => max($x['allowed']), 'payers' => count($x['payers']), 'charge' => $x['charge']];
    return $out;
}

// What one line says, in plain words: [['kind' => ..., 'text' => ...]].
function eob_line_notes(array $l, array $usual, string $status): array {
    $n = [];
    $ch = (float)$l['charged']; $al = $l['allowed_full'] ?? $l['allowed'] ?? null;
    if ($status === 'exhausted') return [['kind' => 'exhausted', 'text' => 'PIP benefits exhausted — bill the balance to the patient / letter of protection.']];
    if ($al === null) return $n;
    $al = (float)$al;
    if ($al < 0.01) $n[] = ['kind' => 'denied', 'text' => 'Not paid' . ($l['reasons'] ? ' (code ' . $l['reasons'] . ')' : '') . ' — check the reason; dispute it with a demand letter if the care was billed correctly.'];
    elseif ($al > $ch + 0.005 && $ch > 0) $n[] = ['kind' => 'full_charge', 'text' => 'Allowed $' . number_format($al, 2) . ' — more than your $' . number_format($ch, 2) . ' charge. Your fee for ' . $l['code'] . ' is below what the schedule allows; check it before the next bill.'];
    elseif ($al + 0.005 >= $ch && $ch > 0) $n[] = ['kind' => 'full_charge', 'text' => 'Allowed your full charge of $' . number_format($ch, 2) . ' — PIP pays the lesser of your charge and the fee schedule, so your fee for ' . $l['code'] . ' may be below what the schedule allows.'];
    $u = $usual[$l['code']] ?? null;
    if ($u && $u['n'] >= 2 && $al > 0 && $al < $u['usual'] * (1 - EOB_UNDERPAID_SLACK)) $n[] = ['kind' => 'below_usual', 'text' => 'Allowed $' . number_format($al, 2) . '; your EOBs usually allow $' . number_format($u['usual'], 2) . ' for ' . $l['code'] . ' — possible underpayment.'];
    return $n;
}

function eob_days_to_pay(array $e): ?int {
    $paidOn = $e['check_date'] ?: $e['eob_date'];
    if (!$e['received_on'] || !$paidOn) return null;
    return (int)round((strtotime($paidOn) - strtotime($e['received_on'])) / 86400);
}

// The practice view: by payer, by code, and the EOBs that need a look.
function eob_insights(int $practiceId, ?string $from = null): array {
    $from = $from ?: date('Y-m-d', strtotime('-12 months'));
    [$locSql, $locArgs] = case_scope('c');
    $s = pi_db()->prepare("SELECT e.*, c.case_number, p.first_name, p.last_name FROM eobs e JOIN cases c ON c.id = e.case_id JOIN patients p ON p.id = c.patient_id
        WHERE e.practice_id = ? AND e.archived_at IS NULL AND COALESCE(e.eob_date, DATE(e.created_at)) >= ?$locSql ORDER BY COALESCE(e.eob_date, DATE(e.created_at)) DESC, e.id DESC");
    $s->execute(array_merge([$practiceId, $from], $locArgs));
    $eobs = $s->fetchAll();
    $ids = array_column($eobs, 'id');
    $lines = [];
    if ($ids) foreach (pi_db()->query('SELECT * FROM eob_lines WHERE eob_id IN (' . implode(',', array_map('intval', $ids)) . ') ORDER BY eob_id, line_no')->fetchAll() as $l) $lines[$l['eob_id']][] = $l;
    $usual = eob_usual_allowed($practiceId);
    $payers = []; $codes = []; $issues = [];
    foreach ($eobs as $e) {
        $p = &$payers[$e['payer']];
        $p = $p ?? ['payer' => $e['payer'], 'eobs' => 0, 'charged' => 0.0, 'allowed' => 0.0, 'paid' => 0.0, 'paidKnown' => 0.0, 'chargedPaidKnown' => 0.0, 'days' => [], 'late' => 0, 'deniedLines' => 0, 'lines' => 0, 'exhausted' => 0, 'mismatch' => 0];
        $p['eobs']++; $p['charged'] += (float)$e['charged']; $p['allowed'] += (float)$e['allowed'];
        if ($e['paid'] !== null) { $p['paid'] += (float)$e['paid']; $p['paidKnown']++; $p['chargedPaidKnown'] += (float)$e['charged']; }
        if (($d = eob_days_to_pay($e)) !== null) { $p['days'][] = $d; if ($d > EOB_OVERDUE_DAYS) $p['late']++; }
        if ($e['status'] === 'exhausted') $p['exhausted']++;
        $checks = json_decode((string)$e['checks'], true) ?: [];
        $mismatch = (bool)array_filter($checks, fn($c) => empty($c['ok']));
        if ($mismatch) $p['mismatch']++;
        $notes = [];
        foreach ($lines[$e['id']] ?? [] as $l) {
            $p['lines']++;
            $al = $l['allowed_full'] !== null ? (float)$l['allowed_full'] : null;
            if ($al !== null && $al < 0.01 && $e['status'] !== 'exhausted') $p['deniedLines']++;
            $c = &$codes[$l['code']];
            $c = $c ?? ['code' => $l['code'], 'lines' => 0, 'charged' => [], 'allowed' => [], 'fullCharge' => 0, 'denied' => 0, 'payers' => []];
            $c['lines']++; $c['charged'][] = (float)$l['charged'];
            if ($al !== null && $e['status'] !== 'exhausted') {
                if ($al >= 0.01) { $c['allowed'][] = $al; $c['payers'][$e['payer']][] = $al; }
                else $c['denied']++;
                if ($al >= 0.01 && $al + 0.005 >= (float)$l['charged']) $c['fullCharge']++;
            }
            unset($c);
            foreach (eob_line_notes($l, $usual, $e['status']) as $nt) if ($nt['kind'] !== 'exhausted') $notes[] = $nt;
        }
        $late = ($d ?? null) !== null && $d > EOB_OVERDUE_DAYS;
        if ($mismatch || $e['status'] === 'exhausted' || $late || array_filter($notes, fn($n) => in_array($n['kind'], ['denied', 'below_usual'], true))) {
            $why = [];
            if ($e['status'] === 'exhausted') $why[] = 'PIP benefits exhausted';
            if ($mismatch) foreach ($checks as $ck) if (empty($ck['ok'])) $why[] = $ck['label'] . ': ' . $ck['detail'];
            if ($late) $why[] = 'Paid ' . $d . ' days after the bill was received (over ' . EOB_OVERDUE_DAYS . ')';
            foreach ($notes as $nt) if (in_array($nt['kind'], ['denied', 'below_usual'], true)) $why[] = $nt['text'];
            $issues[] = ['id' => (int)$e['id'], 'caseId' => (int)$e['case_id'], 'caseNumber' => $e['case_number'], 'patient' => trim($e['first_name'] . ' ' . $e['last_name']), 'payer' => $e['payer'], 'eobDate' => $e['eob_date'], 'why' => array_values(array_unique($why))];
        }
        unset($p);
    }
    $payerRows = [];
    foreach ($payers as $p) {
        $payerRows[] = ['payer' => $p['payer'], 'eobs' => $p['eobs'], 'charged' => round($p['charged'], 2), 'allowed' => round($p['allowed'], 2), 'paid' => round($p['paid'], 2),
            'allowedPct' => $p['charged'] > 0 ? round($p['allowed'] / $p['charged'] * 100, 1) : null,
            'paidPct' => $p['chargedPaidKnown'] > 0 ? round($p['paid'] / $p['chargedPaidKnown'] * 100, 1) : null,
            'avgDays' => $p['days'] ? (int)round(array_sum($p['days']) / count($p['days'])) : null, 'late' => $p['late'],
            'deniedLines' => $p['deniedLines'], 'lines' => $p['lines'], 'exhausted' => $p['exhausted'], 'mismatch' => $p['mismatch']];
    }
    usort($payerRows, fn($a, $b) => $b['charged'] <=> $a['charged']);
    $codeRows = [];
    foreach ($codes as $c) {
        $byPayer = [];
        foreach ($c['payers'] as $py => $v) $byPayer[] = ['payer' => $py, 'allowed' => eob_median($v), 'n' => count($v)];
        usort($byPayer, fn($a, $b) => $a['allowed'] <=> $b['allowed']);
        $usualAllowed = eob_median($c['allowed']);
        $charge = eob_median($c['charged']);
        $codeRows[] = ['code' => $c['code'], 'lines' => $c['lines'], 'charge' => $charge, 'usualAllowed' => $usualAllowed,
            'min' => $c['allowed'] ? min($c['allowed']) : null, 'max' => $c['allowed'] ? max($c['allowed']) : null,
            'fullCharge' => $c['fullCharge'], 'denied' => $c['denied'], 'byPayer' => $byPayer,
            'chargeBelow' => $usualAllowed !== null && $charge !== null && $c['fullCharge'] > 0 && $c['fullCharge'] >= max(1, count($c['allowed']) / 2)];
    }
    usort($codeRows, fn($a, $b) => $b['lines'] <=> $a['lines']);
    $tot = ['eobs' => count($eobs), 'charged' => round(array_sum(array_column($payerRows, 'charged')), 2), 'allowed' => round(array_sum(array_column($payerRows, 'allowed')), 2), 'paid' => round(array_sum(array_column($payerRows, 'paid')), 2)];
    $days = array_merge(...array_map(fn($p) => $p['days'], array_values($payers) ?: [['days' => []]]));
    $tot['avgDays'] = $days ? (int)round(array_sum($days) / count($days)) : null;
    $tot['allowedPct'] = $tot['charged'] > 0 ? round($tot['allowed'] / $tot['charged'] * 100, 1) : null;
    return ['from' => $from, 'totals' => $tot, 'payers' => $payerRows, 'codes' => $codeRows, 'issues' => array_slice($issues, 0, 50)];
}

// ---------- EOB Genie: what needs acting on ----------
const EOB_LATE_BILL_DAYS = 35;      // FL §627.736(5)(c): bill within 35 days of service…
const EOB_LATE_BILL_NOTICE_DAYS = 75; // …or 75 if the initiation-of-treatment notice went out within 21 days
const EOB_NO_EOB_DAYS = 45;         // an insurance charge with no EOB after this long needs a follow-up call
const EOB_PIP_LOW_VISITS = 8;       // flag PIP running out within this many visits

function eob_settings(?array $practice = null): array {
    $p = $practice ?? current_practice();
    $s = json_decode((string)($p['eob_settings'] ?? ''), true) ?: [];
    return ['interest_rate' => isset($s['interest_rate']) && $s['interest_rate'] !== '' ? (float)$s['interest_rate'] : null];
}

// Each EOB's dates checked against Florida's billing and payment clocks.
function eob_timing(array $e, ?string $noticeOn = null, ?string $firstVisit = null, ?float $rate = null): array {
    $out = ['billedDays' => null, 'billedLate' => false, 'billWindow' => EOB_LATE_BILL_DAYS, 'payDays' => eob_days_to_pay($e), 'paidLate' => false, 'interestDue' => null];
    if ($e['received_on'] && $e['dos_from']) {
        $out['billedDays'] = (int)round((strtotime($e['received_on']) - strtotime($e['dos_from'])) / 86400);
        if ($noticeOn && $firstVisit && (strtotime($noticeOn) - strtotime($firstVisit)) / 86400 <= 21) $out['billWindow'] = EOB_LATE_BILL_NOTICE_DAYS;
        $out['billedLate'] = $out['billedDays'] > $out['billWindow'];
    }
    if ($out['payDays'] !== null && $out['payDays'] > EOB_OVERDUE_DAYS) {
        $out['paidLate'] = true;
        // §627.736(4)(c): overdue payments bear simple interest at the §55.03 rate.
        if ($rate !== null && $e['paid'] !== null) $out['interestDue'] = round(max(0, (float)$e['paid'] * $rate / 100 * ($out['payDays'] - EOB_OVERDUE_DAYS) / 365 - (float)($e['interest'] ?? 0)), 2);
    }
    return $out;
}

// The EOB Genie report: money left on the table, fees below the schedule,
// late payments and bills with no EOB, late billing, and PIP about to run out.
function eob_genie_report(int $practiceId, ?string $from = null): array {
    $from = $from ?: date('Y-m-d', strtotime('-12 months'));
    $pdo = pi_db();
    [$locSql, $locArgs] = case_scope('c');
    $rate = eob_settings()['interest_rate'];
    $s = $pdo->prepare("SELECT e.*, c.case_number, c.first_visit, c.jurisdiction, p.first_name, p.last_name, m.completed_on notice_on FROM eobs e JOIN cases c ON c.id = e.case_id JOIN patients p ON p.id = c.patient_id
        LEFT JOIN case_milestones m ON m.case_id = c.id AND m.milestone = 'treatment_notice_mailed'
        WHERE e.practice_id = ? AND e.archived_at IS NULL AND COALESCE(e.eob_date, DATE(e.created_at)) >= ?$locSql ORDER BY COALESCE(e.eob_date, DATE(e.created_at)) DESC");
    $s->execute(array_merge([$practiceId, $from], $locArgs));
    $eobs = $s->fetchAll();
    $lines = [];
    if ($eobs) foreach ($pdo->query('SELECT * FROM eob_lines WHERE eob_id IN (' . implode(',', array_map('intval', array_column($eobs, 'id'))) . ')')->fetchAll() as $l) $lines[$l['eob_id']][] = $l;
    $usual = eob_usual_allowed($practiceId);
    $who = fn($e) => ['eobId' => (int)$e['id'], 'caseId' => (int)$e['case_id'], 'caseNumber' => $e['case_number'], 'patient' => trim($e['first_name'] . ' ' . $e['last_name']), 'payer' => $e['payer'], 'eobDate' => $e['eob_date'],
        'demandLetter' => jurisdiction_code($e['jurisdiction'] ?: 'FL') === 'FL'];
    $money = []; $late = []; $billedLate = []; $codeLines = []; $minDos = null;
    foreach ($eobs as $e) {
        $t = eob_timing($e, $e['notice_on'], $e['first_visit'], $rate);
        if ($t['paidLate']) $late[] = $who($e) + ['days' => $t['payDays'], 'paid' => $e['paid'] !== null ? (float)$e['paid'] : null, 'interestDue' => $t['interestDue'], 'interestPaid' => (float)($e['interest'] ?? 0)];
        if ($t['billedLate']) $billedLate[] = $who($e) + ['days' => $t['billedDays'], 'window' => $t['billWindow'], 'charged' => (float)$e['charged'], 'dosFrom' => $e['dos_from']];
        if ($e['status'] === 'exhausted') continue;
        foreach ($lines[$e['id']] ?? [] as $l) {
            $al = $l['allowed_full'] !== null ? (float)$l['allowed_full'] : null; $ch = (float)$l['charged'];
            $u = $usual[$l['code']]['usual'] ?? null;
            if ($l['dos'] && (!$minDos || $l['dos'] < $minDos)) $minDos = $l['dos'];
            $codeLines[$l['code']][] = ['charged' => $ch, 'allowed' => $al];
            if ($al === null) continue;
            if ($al < 0.01) $money[] = $who($e) + ['kind' => 'denied', 'code' => $l['code'], 'dos' => $l['dos'], 'amount' => round(($u !== null ? min($u, $ch) : $ch) * EOB_PIP_RATE, 2), 'estimated' => true,
                'text' => $l['code'] . ' not paid' . ($l['reasons'] ? ' (code ' . $l['reasons'] . ')' : '') . ' — worth about $' . number_format(($u !== null ? min($u, $ch) : $ch) * EOB_PIP_RATE, 2) . ' at 80%'];
            elseif ($u !== null && ($usual[$l['code']]['n'] ?? 0) >= 2 && $al < $u * (1 - EOB_UNDERPAID_SLACK) && $al < $ch) $money[] = $who($e) + ['kind' => 'underpaid', 'code' => $l['code'], 'dos' => $l['dos'], 'amount' => round((min($u, $ch) - $al) * EOB_PIP_RATE, 2), 'estimated' => true,
                'text' => $l['code'] . ' allowed $' . number_format($al, 2) . ' — usually $' . number_format($u, 2)];
        }
        // Paid less than the PIP math on the EOB's own numbers.
        if ($e['paid'] !== null && $e['allowed'] !== null && (float)$e['allowed'] > 0) {
            $expect = $e['coinsurance'] !== null ? (float)$e['allowed'] - (float)$e['coinsurance'] - (float)($e['deductible'] ?? 0) : (float)$e['allowed'] * EOB_PIP_RATE - (float)($e['deductible'] ?? 0);
            $paid = (float)$e['paid'] - (float)($e['interest'] ?? 0);
            if ($paid < $expect - 0.05 && $paid > 0) $money[] = $who($e) + ['kind' => 'short_paid', 'code' => null, 'dos' => $e['dos_from'], 'amount' => round($expect - $paid, 2), 'estimated' => false,
                'text' => 'Paid $' . number_format($paid, 2) . ' — 80% of the allowed amount is $' . number_format($expect, 2)];
        }
    }
    usort($money, fn($a, $b) => $b['amount'] <=> $a['amount']);
    // Fees below the schedule: payers allowing the whole charge (or more).
    $months = $minDos ? max(1, min(12, (int)round((time() - strtotime($minDos)) / (86400 * 30.4)))) : 12;
    $fees = [];
    foreach ($codeLines as $code => $ls) {
        $full = array_filter($ls, fn($x) => $x['allowed'] !== null && $x['allowed'] >= 0.01 && $x['allowed'] + 0.005 >= $x['charged']);
        if (!$full) continue;
        $charge = eob_median(array_column($ls, 'charged'));
        $top = max(array_column($full, 'allowed'));
        $perYear = count($ls) * 12 / $months;
        $fees[] = ['code' => $code, 'charge' => $charge, 'allowedFull' => count($full), 'lines' => count($ls), 'highestAllowed' => round($top, 2), 'perYear' => (int)round($perYear),
            'liftYear' => $top > $charge + 0.005 ? round(($top - $charge) * EOB_PIP_RATE * $perYear, 2) : null];
    }
    usort($fees, fn($a, $b) => ($b['liftYear'] ?? 0) <=> ($a['liftYear'] ?? 0) ?: $b['allowedFull'] <=> $a['allowedFull']);
    return ['from' => $from, 'interestRate' => $rate,
        'moneyLeft' => ['total' => round(array_sum(array_column($money, 'amount')), 2), 'items' => array_slice($money, 0, 100)],
        'fees' => ['liftYear' => round(array_sum(array_map(fn($f) => $f['liftYear'] ?? 0, $fees)), 2), 'codes' => $fees],
        'paidLate' => ['interestDue' => round(array_sum(array_map(fn($x) => $x['interestDue'] ?? 0, $late)), 2), 'items' => $late],
        'noEob' => eob_charges_without_eob($practiceId),
        'billedLate' => ['charged' => round(array_sum(array_column($billedLate, 'charged')), 2), 'items' => $billedLate],
        'pip' => eob_pip_forecast($practiceId)];
}

// Insurance charges still open well after the date of service with no EOB
// for that date — the bill may never have arrived: call the adjuster.
function eob_charges_without_eob(int $practiceId): array {
    [$locSql, $locArgs] = case_scope('c');
    $s = pi_db()->prepare("SELECT c.id, c.case_number, p.first_name, p.last_name FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL AND c.injury_type = 'auto' AND c.ehr_synced_at IS NULL AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')$locSql");
    $s->execute(array_merge([$practiceId], $locArgs));
    $cases = array_column($s->fetchAll(), null, 'id');
    if (!$cases) return ['total' => 0.0, 'items' => []];
    $ids = implode(',', array_map('intval', array_keys($cases)));
    $covered = [];
    foreach (pi_db()->query("SELECT case_id, dos FROM eob_lines l JOIN eobs e ON e.id = l.eob_id WHERE e.archived_at IS NULL AND e.case_id IN ($ids)")->fetchAll() as $r) $covered[$r['case_id'] . '|' . $r['dos']] = true;
    foreach (pi_db()->query("SELECT case_id, dos_from FROM eobs WHERE archived_at IS NULL AND case_id IN ($ids)")->fetchAll() as $r) $covered[$r['case_id'] . '|' . $r['dos_from']] = true;
    $out = [];
    foreach (ledger_rows_by_case(pi_db(), array_keys($cases)) as $cid => $rows) {
        foreach (ledger_open_items($rows) as $it) {
            $days = (int)round((time() - strtotime($it['date'])) / 86400);
            if ($it['billed_to'] !== 'insurance' || $it['ins_open'] < 0.01 || $days < EOB_NO_EOB_DAYS || isset($covered[$cid . '|' . $it['date']])) continue;
            $c = $cases[$cid];
            $out[] = ['caseId' => (int)$cid, 'caseNumber' => $c['case_number'], 'patient' => trim($c['first_name'] . ' ' . $c['last_name']), 'dos' => $it['date'], 'amount' => $it['ins_open'], 'days' => $days];
        }
    }
    usort($out, fn($a, $b) => $b['days'] <=> $a['days']);
    return ['total' => round(array_sum(array_column($out, 'amount')), 2), 'items' => array_slice($out, 0, 100)];
}

// When PIP runs out on each open auto case: what's left (the adjuster's
// figure when recorded — PIP is shared with every provider — else the limit
// less what PIP has paid us), what PIP pays us per visit (this case's EOBs,
// else the practice's), and the visit pace over the last four weeks.
function eob_pip_forecast(int $practiceId): array {
    $pdo = pi_db();
    [$locSql, $locArgs] = case_scope('c');
    $s = $pdo->prepare("SELECT c.*, p.first_name, p.last_name FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL AND c.injury_type = 'auto' AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')$locSql");
    $s->execute(array_merge([$practiceId], $locArgs));
    $cases = array_column($s->fetchAll(), null, 'id');
    if (!$cases) return ['items' => []];
    $ids = implode(',', array_map('intval', array_keys($cases)));
    $pips = [];
    foreach ($pdo->query("SELECT * FROM coverages WHERE archived_at IS NULL AND type = 'pip' AND status = 'active' AND case_id IN ($ids) ORDER BY priority, id")->fetchAll() as $cv) $pips[$cv['case_id']] = $pips[$cv['case_id']] ?? $cv;
    if (!$pips) return ['items' => []];
    // PIP paid per date of service, from EOBs.
    $perVisit = []; $all = [];
    foreach ($pdo->query("SELECT case_id, paid, dos_from, dos_to, (SELECT COUNT(DISTINCT dos) FROM eob_lines l WHERE l.eob_id = e.id) n FROM eobs e WHERE practice_id = " . (int)$practiceId . " AND archived_at IS NULL AND paid > 0 AND status <> 'exhausted'")->fetchAll() as $r) {
        $n = max(1, (int)$r['n']); $v = (float)$r['paid'] / $n;
        $perVisit[$r['case_id']][] = $v; $all[] = $v;
    }
    $practiceAvg = $all ? array_sum($all) / count($all) : null;
    $visits = [];
    foreach ($pdo->query("SELECT case_id, COUNT(*) n FROM visits WHERE visit_type <> 'no_show' AND visit_date >= '" . date('Y-m-d', strtotime('-28 days')) . "' AND case_id IN ($ids) GROUP BY case_id")->fetchAll() as $r) $visits[$r['case_id']] = (int)$r['n'];
    $ledger = ledger_rows_by_case($pdo, array_keys($pips));
    $out = [];
    foreach ($pips as $cid => $pip) {
        $c = $cases[$cid];
        $limit = pip_effective_limit($c, $pip);
        $paid = 0.0; $since = 0.0;
        foreach ($ledger[$cid] ?? [] as $r) {
            if (!empty($r['archived_at']) || $r['kind'] !== 'payment' || (int)$r['coverage_id'] !== (int)$pip['id']) continue;
            $paid += (float)$r['amount'];
            if ($pip['remaining_reported_on'] && $r['entry_date'] > $pip['remaining_reported_on']) $since += (float)$r['amount'];
        }
        $reported = $pip['remaining_reported'] !== null && $pip['remaining_reported'] !== '';
        $left = $reported ? max(0, (float)$pip['remaining_reported'] - $since) : max(0, $limit - $paid);
        $avg = !empty($perVisit[$cid]) ? array_sum($perVisit[$cid]) / count($perVisit[$cid]) : $practiceAvg;
        if (!$avg || $limit <= 0) continue;
        $visitsLeft = (int)floor($left / $avg);
        $perWeek = isset($visits[$cid]) ? round($visits[$cid] / 4, 1) : null;
        $runsOut = $perWeek ? date('Y-m-d', strtotime('+' . (int)ceil($visitsLeft / $perWeek * 7) . ' days')) : null;
        if ($visitsLeft > EOB_PIP_LOW_VISITS) continue;
        $out[] = ['caseId' => (int)$cid, 'caseNumber' => $c['case_number'], 'patient' => trim($c['first_name'] . ' ' . $c['last_name']), 'limit' => round($limit, 2), 'left' => round($left, 2),
            'source' => $reported ? 'adjuster' : 'ours', 'perVisit' => round($avg, 2), 'perVisitFrom' => !empty($perVisit[$cid]) ? 'case' : 'practice', 'visitsLeft' => $visitsLeft,
            'perWeek' => $perWeek, 'runsOutOn' => $runsOut, 'lopSigned' => (bool)$c['lop_signed_on']];
    }
    usort($out, fn($a, $b) => $a['visitsLeft'] <=> $b['visitsLeft']);
    return ['items' => $out];
}
