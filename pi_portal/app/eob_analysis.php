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
