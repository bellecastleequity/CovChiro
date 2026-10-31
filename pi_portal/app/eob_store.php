<?php
// Saving reviewed EOBs and checks: matching them to cases and coverages,
// writing the rows and posting them to the ledger. Shared by the upload
// endpoint (public/api/eob.php) and the bulk import (app/cli/import_eobs.php).
require_once __DIR__ . '/case_basis.php';
require_once __DIR__ . '/eob.php';
require_once __DIR__ . '/eob_analysis.php';

function eob_norm_name(?string $s): string { return strtolower(preg_replace('/[^a-z]/i', '', (string)$s)); }

// The practice's cases this EOB could belong to, best first: the claim
// number on a coverage, then the patient's name with the date of loss.
function eob_match_cases(array $h): array {
    [$locSql, $locArgs] = case_scope('c');
    $s = pi_db()->prepare("SELECT c.id, c.case_number, c.date_of_injury, c.stage, p.first_name, p.last_name FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL AND c.injury_type = 'auto'$locSql");
    $s->execute(array_merge([pid()], $locArgs));
    $cases = $s->fetchAll();
    if (!$cases) return [];
    $claims = [];
    if (!empty($h['claim'])) {
        $cv = pi_db()->query('SELECT case_id, claim_number_enc FROM coverages WHERE archived_at IS NULL AND claim_number_enc IS NOT NULL AND case_id IN (' . implode(',', array_map('intval', array_column($cases, 'id'))) . ')');
        foreach ($cv->fetchAll() as $r) if (($cn = dec($r['claim_number_enc'])) && eob_same_claim($cn, $h['claim'])) $claims[(int)$r['case_id']] = true;
    }
    $nm = (string)($h['patient'] ?? '');
    $parts = str_contains($nm, ',') ? array_map('trim', explode(',', $nm, 2)) : array_reverse(preg_split('/\s+/', trim($nm)) ?: []);
    $last = eob_norm_name($parts[0] ?? ''); $firstTok = preg_split('/\s+/', trim($parts[1] ?? $parts[count($parts) - 1] ?? '')) ?: [''];
    $first = eob_norm_name($firstTok[0] ?? '');
    $out = [];
    foreach ($cases as $c) {
        $score = 0; $why = [];
        if (isset($claims[(int)$c['id']])) { $score += 100; $why[] = 'claim number matches'; }
        $ln = eob_norm_name($c['last_name']); $fn = eob_norm_name($c['first_name']);
        if ($last && $ln === $last) {
            $score += 30; $why[] = 'last name';
            if ($first && ($fn === $first || (strlen($first) >= 3 && str_starts_with($fn, substr($first, 0, 3))))) { $score += 25; $why[count($why) - 1] = 'name matches'; }
        } elseif ($last && $first && $ln === $first && $fn === $last) { $score += 40; $why[] = 'name matches'; }
        if (!empty($h['dateOfLoss']) && $c['date_of_injury'] === $h['dateOfLoss']) { $score += 30; $why[] = 'date of loss matches'; }
        if ($score >= 30) $out[] = ['caseId' => (int)$c['id'], 'caseNumber' => $c['case_number'], 'patient' => trim($c['first_name'] . ' ' . $c['last_name']), 'score' => $score, 'why' => implode(', ', $why)];
    }
    usort($out, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($out, 0, 5);
}

function eob_coverages(int $caseId): array {
    $s = pi_db()->prepare("SELECT c.id, c.type, c.status, c.claim_number_enc, COALESCE(k.organization, c.carrier_text) carrier FROM coverages c LEFT JOIN contacts k ON k.id = c.carrier_contact_id WHERE c.case_id = ? AND c.archived_at IS NULL ORDER BY c.priority, c.id");
    $s->execute([$caseId]);
    return array_map(fn($r) => ['id' => (int)$r['id'], 'type' => $r['type'], 'status' => $r['status'], 'carrier' => $r['carrier'], 'claim' => dec($r['claim_number_enc'])], $s->fetchAll());
}

// The PIP / MedPay coverage this payer's EOB belongs to.
function eob_pick_coverage(array $covs, ?string $payer, ?string $claim): ?int {
    foreach ($covs as $c) if ($claim && $c['claim'] && eob_same_claim($c['claim'], $claim)) return $c['id'];
    foreach ($covs as $c) if ($payer && $c['carrier'] && stripos($c['carrier'], explode(' ', $payer)[0]) !== false && in_array($c['type'], ['pip', 'medpay'], true)) return $c['id'];
    foreach ($covs as $c) if ($c['type'] === 'pip') return $c['id'];
    return null;
}

function eob_case_info(int $caseId, array $h): array {
    $c = case_or_404($caseId);
    $covs = eob_coverages($caseId);
    $dupe = null;
    if (!empty($h['dosFrom'])) {
        $s = pi_db()->prepare('SELECT id, created_at FROM eobs WHERE case_id = ? AND archived_at IS NULL AND dos_from = ? AND (bill_ref <=> ?) AND payer = ? LIMIT 1');
        $s->execute([$caseId, $h['dosFrom'], $h['billRef'] ?: null, $h['payer'] ?: '']);
        $dupe = $s->fetch() ?: null;
    }
    // What is still open with insurance, per coverage (0 = not tied to one) — for a check without an EOB.
    $lr = pi_db()->prepare('SELECT * FROM ledger WHERE case_id = ?'); $lr->execute([$caseId]);
    $openBy = [];
    foreach (ledger_open_items($lr->fetchAll()) as $it) if ($it['billed_to'] === 'insurance' && $it['ins_open'] > 0.005) $openBy[(int)$it['coverage_id']] = round(($openBy[(int)$it['coverage_id']] ?? 0) + $it['ins_open'], 2);
    return ['caseId' => $caseId, 'caseNumber' => $c['case_number'], 'ehr' => $c['ehr_synced_at'] ? ($c['ehr_system'] ?: 'EHR') : null, 'openByCoverage' => (object)$openBy,
        'coverages' => $covs, 'coverageId' => eob_pick_coverage($covs, $h['payer'] ?? null, $h['claim'] ?? null),
        'duplicateOf' => $dupe ? ['id' => (int)$dupe['id'], 'on' => substr($dupe['created_at'], 0, 10)] : null];
}

function eob_num($v): ?float { return $v === null || $v === '' ? null : round((float)$v, 2); }

function eob_day($v): ?string { return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null; }

// Ledger entries for one saved EOB, per date of service. Each date's
// insurance charge (created from the EOB if the case has none) gets the
// payment, the fee-schedule reduction (charge − allowed: Florida PIP
// doesn't let the provider bill the patient for it), and the rest of the
// allowed amount (20% coinsurance / deductible) moved to the patient. When
// benefits are exhausted the whole charge moves to the patient instead.
function eob_post(int $eobId, int $caseId, ?int $coverageId, array $e, array $lines, array $user): array {
    $pdo = pi_db();
    $byDos = [];
    foreach ($lines as $l) $byDos[$l['dos'] ?: ($e['dos_from'] ?: date('Y-m-d'))][] = $l;
    $allowedTotal = array_sum(array_map(fn($l) => (float)($l['allowed_full'] ?? 0), $lines));
    $linePaid = array_filter($lines, fn($l) => $l['paid'] !== null);
    $ins = $pdo->prepare('INSERT INTO ledger (case_id, entry_date, kind, bucket, coverage_id, to_bucket, to_coverage_id, applies_to_id, amount, reference, memo, source, eob_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $post = function ($date, $kind, $bucket, $cov, $to, $appliesTo, $amount, $memo) use ($ins, $caseId, $eobId, $e, $user) {
        if ($amount < 0.005) return;
        $ins->execute([$caseId, $date, $kind, $bucket, $bucket === 'insurance' ? $cov : null, $to, null, $appliesTo, round($amount, 2), mb_substr('EOB ' . ($e['bill_ref'] ?: ($e['check_number'] ?: '')), 0, 120), mb_substr($memo, 0, 255), 'manual', $eobId, $user['id'], now_str()]);
    };
    $posted = ['payments' => 0.0, 'adjustments' => 0.0, 'toPatient' => 0.0, 'fromPatient' => 0.0, 'chargesCreated' => 0];
    $paidDate = $e['check_date'] ?: ($e['eob_date'] ?: date('Y-m-d'));
    // Interest on a late payment isn't a payment on the charges: it's kept on
    // the EOB (and in the EOB Genie report), not posted against the visits.
    $checkPaid = $e['paid'] !== null ? max(0, (float)$e['paid'] - (float)($e['interest'] ?? 0)) : null;
    $dedTotal = (float)($e['deductible'] ?? 0);
    // MedPay (in Florida, usually the 20% PIP leaves) pays what was moved to
    // the patient: that balance moves back to MedPay and is paid there. No
    // fee-schedule reduction, nothing moved to the patient.
    $cv = $pdo->prepare('SELECT type FROM coverages WHERE id = ?'); $cv->execute([$coverageId]);
    $medpay = $coverageId && $cv->fetchColumn() === 'medpay';
    $open = [];
    if ($medpay) { $lr = $pdo->prepare('SELECT * FROM ledger WHERE case_id = ?'); $lr->execute([$caseId]); foreach (ledger_open_items($lr->fetchAll()) as $it) $open[$it['id']] = $it; }
    foreach ($byDos as $dos => $ls) {
        $charged = array_sum(array_map(fn($l) => (float)$l['charged'], $ls));
        $allowed = array_sum(array_map(fn($l) => (float)($l['allowed_full'] ?? 0), $ls));
        $codes = implode(', ', array_unique(array_column($ls, 'code')));
        $s = $pdo->prepare("SELECT id, amount, coverage_id FROM ledger WHERE case_id = ? AND kind = 'charge' AND bucket = 'insurance' AND entry_date = ? AND archived_at IS NULL ORDER BY (coverage_id <=> ?) DESC, id LIMIT 1");
        $s->execute([$caseId, $dos, $coverageId]);
        $charge = $s->fetch();
        if (!$charge) {
            $ins->execute([$caseId, $dos, 'charge', 'insurance', $coverageId, null, null, null, round($charged, 2), mb_substr('EOB ' . ($e['bill_ref'] ?: ''), 0, 120), mb_substr('Charges per EOB: ' . $codes, 0, 255), 'manual', $eobId, $user['id'], now_str()]);
            $charge = ['id' => (int)$pdo->lastInsertId()];
            $posted['chargesCreated']++;
        }
        $cid = (int)$charge['id'];
        // An insurance charge not yet tied to a coverage belongs to the one paying it.
        if (array_key_exists('coverage_id', $charge) && $charge['coverage_id'] === null && $coverageId) $pdo->prepare('UPDATE ledger SET coverage_id = ?, updated_by = ?, updated_at = ? WHERE id = ?')->execute([$coverageId, $user['id'], now_str(), $cid]);
        if ($e['status'] === 'exhausted') {
            $post($paidDate, 'transfer', 'insurance', $coverageId, 'patient', $cid, $charged, 'PIP benefits exhausted (' . $e['payer'] . ') — balance to the patient / LOP');
            $posted['toPatient'] += $charged;
            continue;
        }
        if ($linePaid) $paid = array_sum(array_map(fn($l) => (float)($l['paid'] ?? 0), $ls));
        elseif ($checkPaid !== null) $paid = $allowedTotal > 0 ? $checkPaid * $allowed / $allowedTotal : $checkPaid / count($byDos);
        else $paid = 0.0;
        if ($medpay) {
            $back = min($paid, max(0, (float)($open[$cid]['pat_open'] ?? 0)));
            if ($back >= 0.005) {
                $ins->execute([$caseId, $paidDate, 'transfer', 'patient', null, 'insurance', $coverageId, $cid, round($back, 2), mb_substr('EOB ' . ($e['bill_ref'] ?: ($e['check_number'] ?: '')), 0, 120),
                    mb_substr('Patient balance paid by MedPay (' . $e['payer'] . ')', 0, 255), 'manual', $eobId, $user['id'], now_str()]);
                $posted['fromPatient'] += $back;
            }
            $post($paidDate, 'payment', 'insurance', $coverageId, null, $cid, $paid, $e['payer'] . ' MedPay payment' . ($e['check_number'] ? ' — check ' . $e['check_number'] : '') . ' (' . $codes . ')');
            $posted['payments'] += $paid;
            continue;
        }
        $post($paidDate, 'payment', 'insurance', $coverageId, null, $cid, $paid, $e['payer'] . ' payment' . ($e['check_number'] ? ' — check ' . $e['check_number'] : '') . ' (' . $codes . ')');
        $posted['payments'] += $paid;
        $denied = array_sum(array_map(fn($l) => (float)($l['allowed_full'] ?? 0) < 0.01 ? (float)$l['charged'] : 0, $ls));
        $reduce = max(0, $charged - $allowed - $denied);
        $post($paidDate, 'adjustment', 'insurance', $coverageId, null, $cid, $reduce, 'PIP fee-schedule reduction (' . $e['payer'] . ')');
        $posted['adjustments'] += $reduce;
        // What PIP allowed but didn't pay (20% / deductible) is the patient's.
        if ($e['paid'] !== null || $linePaid) {
            $rest = max(0, $allowed - $paid);
            $ded = min($rest, $allowedTotal > 0 ? $dedTotal * $allowed / $allowedTotal : $dedTotal / count($byDos));
            $post($paidDate, 'transfer', 'insurance', $coverageId, 'patient', $cid, $ded, 'PIP deductible (' . $e['payer'] . ') — patient responsibility');
            $post($paidDate, 'transfer', 'insurance', $coverageId, 'patient', $cid, $rest - $ded, 'PIP 20% coinsurance (' . $e['payer'] . ') — patient responsibility');
            $posted['toPatient'] += $rest;
        }
    }
    foreach ($posted as $k => $v) if (is_float($v)) $posted[$k] = round($v, 2);
    return $posted;
}

// A check with no EOB (a PIP demand or suit payment, usually forwarded by
// the clinic's attorney): what isn't interest pays the case's oldest open
// balances with this coverage first. When it is more than is open, it
// recovers fee-schedule reductions taken on earlier EOBs (the reduction is
// reversed and paid); anything left is posted unapplied, to sort out on the
// ledger. Interest and attorney fees are recorded, not posted.
function eob_post_payment(int $eobId, int $caseId, ?int $coverageId, array $row, float $amount, float $interest, array $user): array {
    $pdo = pi_db();
    $lr = $pdo->prepare('SELECT * FROM ledger WHERE case_id = ?'); $lr->execute([$caseId]);
    $items = array_values(array_filter(ledger_open_items($lr->fetchAll()), fn($it) => $it['billed_to'] === 'insurance' && ($it['coverage_id'] === null || $it['coverage_id'] === $coverageId)));
    usort($items, fn($a, $b) => [$a['date'], $a['id']] <=> [$b['date'], $b['id']]);
    $date = $row['check_date'] ?: date('Y-m-d');
    $ref = mb_substr('Check ' . ($row['check_number'] ?: '') . ($row['via_ref'] ? ' · file ' . $row['via_ref'] : ''), 0, 120);
    $what = $row['payer'] . ($row['recovery'] ? ' demand / suit payment' : ' payment') . ($row['via'] ? ' via ' . $row['via'] : '');
    $ins = $pdo->prepare('INSERT INTO ledger (case_id, entry_date, kind, bucket, coverage_id, applies_to_id, amount, reference, memo, source, eob_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $put = fn($kind, $appliesTo, $amt, $memo) => $ins->execute([$caseId, $date, $kind, 'insurance', $coverageId, $appliesTo, round($amt, 2), $ref, mb_substr($memo, 0, 255), 'manual', $eobId, $user['id'], now_str()]);
    $left = round(max(0, $amount - $interest), 2);
    $out = ['payments' => 0.0, 'reductionsRecovered' => 0.0, 'unapplied' => 0.0, 'interest' => round($interest, 2), 'charges' => 0];
    foreach ($items as $it) {
        if ($left < 0.005) break;
        $x = min($left, $it['ins_open']);
        if ($x < 0.005) continue;
        $put('payment', $it['id'], $x, $what . ' (visit ' . $it['date'] . ')');
        $left = round($left - $x, 2); $out['payments'] += $x; $out['charges']++;
    }
    foreach ($items as $it) {
        if ($left < 0.005) break;
        $x = min($left, $it['ins_adjusted']);
        if ($x < 0.005) continue;
        $put('adjustment', $it['id'], -$x, 'Fee-schedule reduction recovered — ' . $what);
        $put('payment', $it['id'], $x, $what . ' (visit ' . $it['date'] . ', recovered reduction)');
        $left = round($left - $x, 2); $out['payments'] += $x; $out['reductionsRecovered'] += $x;
    }
    if ($left >= 0.005) { $put('payment', null, $left, $what . ' — more than the open balance; apply it on the ledger'); $out['unapplied'] = $left; $out['payments'] += $left; }
    foreach ($out as $k => $v) if (is_float($v)) $out[$k] = round($v, 2);
    return $out;
}

// A reviewed check without an EOB, as submitted.
function eob_payment_input(array $it, int $caseId): array {
    $h = $it['header'] ?? [];
    $amount = eob_num($h['amount'] ?? null);
    if ($amount === null || $amount <= 0) eob_reject('Enter the check amount for each payment you are saving.');
    $interest = min($amount, max(0, (float)eob_num($h['interest'] ?? null)));
    $covs = eob_coverages($caseId);
    $coverageId = in_array((int)($it['coverageId'] ?? 0), array_column($covs, 'id'), true) ? (int)$it['coverageId'] : eob_pick_coverage($covs, $h['payer'] ?? null, $h['claim'] ?? null);
    $row = ['payer' => mb_substr(trim((string)($h['payer'] ?? '')) ?: 'Auto insurer', 0, 120), 'layout' => 'payment', 'kind' => 'payment',
        'claim' => trim((string)($h['claim'] ?? '')) ?: null, 'bill_ref' => null, 'received_on' => null, 'eob_date' => eob_day($h['checkDate'] ?? null),
        'dos_from' => null, 'dos_to' => null, 'check_number' => mb_substr((string)($h['checkNumber'] ?? ''), 0, 40) ?: null, 'check_date' => eob_day($h['checkDate'] ?? null),
        'status' => 'paid', 'via' => mb_substr(trim((string)($h['via'] ?? '')), 0, 120) ?: null, 'via_ref' => mb_substr(trim((string)($h['viaRef'] ?? '')), 0, 60) ?: null, 'recovery' => !empty($h['recovery'])];
    $r = ['totals' => ['charged' => 0, 'allowed' => null, 'deductible' => null, 'coinsurance' => null, 'paid' => $amount, 'interest' => $interest ?: null, 'fees' => eob_num($h['fees'] ?? null)],
        'reasons' => [], 'checks' => [], 'status' => 'paid'];
    return [$r, $row, $coverageId, $amount, $interest];
}

// The attorney a check came through, from the practice's attorney contacts:
// the firm's name, its email domain or phone number on the pages.
function eob_match_firm(string $upper): ?string {
    $s = pi_db()->prepare("SELECT organization, name, email, phone FROM contacts WHERE practice_id = ? AND type = 'attorney' AND archived_at IS NULL");
    $s->execute([pid()]);
    $flat = preg_replace('/[^A-Z0-9]/', '', str_replace('&', 'AND', $upper));
    $digits = preg_replace('/\D/', '', $upper);
    foreach ($s->fetchAll() as $c) {
        $org = preg_replace('/[^A-Z0-9]/', '', str_replace('&', 'AND', strtoupper((string)$c['organization'])));
        $org = preg_replace('/(PA|PLLC|LLP|LLC|INC)$/', '', $org);
        $dom = preg_match('/@([a-z0-9.\-]+)$/i', (string)$c['email'], $m) && !preg_match('/gmail|yahoo|outlook|hotmail|aol|icloud/i', $m[1]) ? preg_replace('/[^A-Z0-9]/', '', strtoupper($m[1])) : '';
        $ph = preg_replace('/\D/', '', (string)$c['phone']);
        if ((strlen($org) >= 6 && str_contains($flat, $org)) || (strlen($dom) >= 6 && str_contains($flat, $dom)) || (strlen($ph) === 10 && str_contains($digits, $ph))) return $c['organization'] ?: $c['name'];
    }
    return null;
}

// One reviewed EOB as submitted (on upload or edit): its lines, totals and
// checks worked out again from what the person confirmed, and the row.
function eob_input(array $it, int $caseId): array {
    $h = $it['header'] ?? []; $t = $it['totals'] ?? [];
    $lines = [];
    foreach (array_values($it['lines'] ?? []) as $n => $l) {
        $code = strtoupper(preg_replace('/[^A-Z0-9]/i', '', (string)($l['code'] ?? '')));
        if ($code === '' || eob_num($l['charged'] ?? null) === null) continue;
        $lines[] = ['line_no' => $n + 1, 'dos' => eob_day($l['dos'] ?? null), 'code' => substr($code, 0, 10), 'modifiers' => mb_substr((string)($l['modifiers'] ?? ''), 0, 20) ?: null,
            'units' => eob_num($l['units'] ?? null), 'charged' => eob_num($l['charged']), 'allowed_full' => eob_num($l['allowed'] ?? null), 'paid' => eob_num($l['paid'] ?? null), 'reasons' => mb_substr((string)($l['reasons'] ?? ''), 0, 120) ?: null];
    }
    $covs = eob_coverages($caseId);
    $coverageId = in_array((int)($it['coverageId'] ?? 0), array_column($covs, 'id'), true) ? (int)$it['coverageId'] : eob_pick_coverage($covs, $h['payer'] ?? null, $h['claim'] ?? null);
    $medpay = (bool)array_filter($covs, fn($c) => $c['id'] === $coverageId && $c['type'] === 'medpay');
    $r = eob_finish(['lines' => array_map(fn($l) => ['dos' => $l['dos'], 'code' => $l['code'], 'charged' => $l['charged'], 'allowed' => $l['allowed_full'], 'paid' => $l['paid'], 'reasons' => $l['reasons']], $lines),
        'totals' => ['charged' => eob_num($t['charged'] ?? null), 'allowed' => eob_num($t['allowed'] ?? null), 'deductible' => eob_num($t['deductible'] ?? null), 'coinsurance' => eob_num($t['coinsurance'] ?? null), 'interest' => eob_num($t['interest'] ?? null), 'paid' => eob_num($t['paid'] ?? null)],
        'reasons' => is_array($it['reasons'] ?? null) ? $it['reasons'] : [], 'header' => []], (!empty($it['exhausted']) ? 'BENEFITS EXHAUSTED' : '') . ($medpay ? ' MED PAY' : ''));
    if (!$lines && $r['totals']['charged'] <= 0) eob_reject('Each EOB needs its service lines or at least the total charged.');
    $dos = array_filter(array_column($lines, 'dos'));
    $row = ['payer' => mb_substr(trim((string)($h['payer'] ?? '')) ?: 'Auto insurer', 0, 120), 'layout' => in_array($it['layout'] ?? '', array_keys(EOB_LAYOUT_NAMES), true) ? $it['layout'] : 'manual',
        'claim' => trim((string)($h['claim'] ?? '')) ?: null, 'bill_ref' => mb_substr((string)($h['billRef'] ?? ''), 0, 60) ?: null, 'received_on' => eob_day($h['receivedOn'] ?? null), 'eob_date' => eob_day($h['eobDate'] ?? null),
        'dos_from' => $dos ? min($dos) : null, 'dos_to' => $dos ? max($dos) : null, 'check_number' => mb_substr((string)($h['checkNumber'] ?? ''), 0, 40) ?: null, 'check_date' => eob_day($h['checkDate'] ?? null),
        'status' => $r['status']];
    return [$lines, $r, $row, $coverageId];
}

// Saves the EOB row and its lines (a new EOB when $eobId is null).
function eob_write(?int $eobId, int $caseId, ?int $coverageId, array $row, array $r, array $lines, array $user): int {
    $pdo = pi_db(); $tot = $r['totals'];
    $vals = [$coverageId, $row['payer'], $row['layout'], enc($row['claim']), $row['bill_ref'], $row['received_on'], $row['eob_date'], $row['dos_from'], $row['dos_to'], $row['check_number'], $row['check_date'],
        $tot['charged'], $tot['allowed'], $tot['deductible'], $tot['coinsurance'], $tot['paid'], $tot['interest'], $row['status'], json_encode($r['reasons'] ?: null), json_encode($r['checks']),
        $row['kind'] ?? 'eob', $row['via'] ?? null, $row['via_ref'] ?? null, empty($row['recovery']) ? 0 : 1, $tot['fees'] ?? null, empty($row['history']) ? 0 : 1];
    if ($eobId === null) {
        $pdo->prepare('INSERT INTO eobs (coverage_id, payer, layout, claim_number_enc, bill_ref, received_on, eob_date, dos_from, dos_to, check_number, check_date, charged, allowed, deductible, coinsurance, paid, interest, status, reasons, checks, kind, via, via_ref, recovery, fees, history, practice_id, case_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute(array_merge($vals, [pid(), $caseId, $user['id'], now_str()]));
        $eobId = (int)$pdo->lastInsertId();
    } else {
        $pdo->prepare('UPDATE eobs SET coverage_id = ?, payer = ?, layout = ?, claim_number_enc = ?, bill_ref = ?, received_on = ?, eob_date = ?, dos_from = ?, dos_to = ?, check_number = ?, check_date = ?, charged = ?, allowed = ?, deductible = ?, coinsurance = ?, paid = ?, interest = ?, status = ?, reasons = ?, checks = ?, kind = ?, via = ?, via_ref = ?, recovery = ?, fees = ?, history = ? WHERE id = ?')
            ->execute(array_merge($vals, [$eobId]));
        $pdo->prepare('DELETE FROM eob_lines WHERE eob_id = ?')->execute([$eobId]);
    }
    $li = $pdo->prepare('INSERT INTO eob_lines (eob_id, line_no, dos, code, modifiers, units, charged, allowed, allowed_full, paid, reasons) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    foreach ($lines as $l) $li->execute([$eobId, $l['line_no'], $l['dos'], $l['code'], $l['modifiers'], $l['units'], $l['charged'], $l['allowed_full'], $l['allowed_full'], $l['paid'], $l['reasons']]);
    return $eobId;
}

function eob_post_lines(array $lines, array $row, array $tot): array {
    return $lines ?: [['dos' => $row['dos_from'], 'code' => 'EOB', 'charged' => $tot['charged'], 'allowed_full' => $tot['allowed'], 'paid' => null]];
}

// Benefits exhausted: the PIP coverage is marked exhausted (the insurer's
// EOB says so). Moving the case to a letter of protection is the clinic's
// call: when nothing else is left to bill (no MedPay or health coverage) the
// switch is offered, and only made when someone confirms it (switch_lop).
// True if the switch should be offered.
function eob_exhaust(int $caseId, ?int $coverageId, array $row, array $user): bool {
    if (!$coverageId) return false;
    $w = basis_watch($caseId);
    pi_db()->prepare("UPDATE coverages SET status = 'exhausted', status_on = ?, status_reason = ?, updated_at = ? WHERE id = ? AND status <> 'exhausted'")
        ->execute([$row['eob_date'] ?: date('Y-m-d'), mb_substr('EOB from ' . $row['payer'] . ': benefits exhausted', 0, 255), now_str(), $coverageId]);
    sync_benefits($caseId);
    $w($user, 'PIP benefits exhausted (EOB)');
    $case = case_or_404($caseId);
    return $case['injury_type'] === 'auto' && case_billing_basis($case) !== 'lop' && !array_filter(eob_coverages($caseId), fn($c) => $c['status'] === 'active');
}

function eob_not_posted_why(array $case, array $user): string {
    return $case['ehr_synced_at'] ? "This case's money comes from " . ($case['ehr_system'] ?: 'the EHR') . ' ledger uploads — the EOB is saved for review, not posted.' : 'Your role cannot post to the ledger.';
}

function eob_row_out(array $e, array $lines, array $usual, bool $money, array $case = [], ?string $noticeOn = null): array {
    $out = ['id' => (int)$e['id'], 'caseId' => (int)$e['case_id'], 'payer' => $e['payer'], 'layout' => $e['layout'], 'billRef' => $e['bill_ref'], 'receivedOn' => $e['received_on'], 'eobDate' => $e['eob_date'],
        'dosFrom' => $e['dos_from'], 'dosTo' => $e['dos_to'], 'checkNumber' => $e['check_number'], 'checkDate' => $e['check_date'], 'status' => $e['status'], 'posted' => (bool)$e['posted'],
        'claim' => dec($e['claim_number_enc']), 'coverageId' => $e['coverage_id'] ? (int)$e['coverage_id'] : null,
        'interest' => $e['interest'] !== null ? (float)$e['interest'] : null, 'kind' => $e['kind'], 'history' => (bool)$e['history'], 'via' => $e['via'], 'viaRef' => $e['via_ref'], 'recovery' => (bool)$e['recovery'],
        'fees' => $e['fees'] !== null ? (float)$e['fees'] : null,
        'daysToPay' => eob_days_to_pay($e), 'timing' => eob_timing($e, $noticeOn, $case['first_visit'] ?? null, eob_settings()['interest_rate']), 'checks' => json_decode((string)$e['checks'], true) ?: [], 'reasons' => json_decode((string)$e['reasons'], true) ?: [], 'createdAt' => $e['created_at']];
    if ($money) {
        $out += ['charged' => (float)$e['charged'], 'allowed' => $e['allowed'] !== null ? (float)$e['allowed'] : null, 'deductible' => $e['deductible'] !== null ? (float)$e['deductible'] : null,
            'coinsurance' => $e['coinsurance'] !== null ? (float)$e['coinsurance'] : null, 'paid' => $e['paid'] !== null ? (float)$e['paid'] : null];
        $out['lines'] = array_map(fn($l) => ['dos' => $l['dos'], 'code' => $l['code'], 'modifiers' => $l['modifiers'], 'units' => $l['units'] !== null ? (float)$l['units'] : null, 'charged' => (float)$l['charged'],
            'allowed' => $l['allowed_full'] !== null ? (float)$l['allowed_full'] : null, 'paid' => $l['paid'] !== null ? (float)$l['paid'] : null, 'reasons' => $l['reasons'],
            'notes' => eob_line_notes($l, $usual, $e['status'])], $lines);
    }
    return $out;
}

// A bad item: the upload endpoint answers 400; the bulk import reports it and moves on.
function eob_reject(string $msg) {
    if (PHP_SAPI === 'cli') throw new InvalidArgumentException($msg);
    json_response(['error' => $msg], 400);
}

// Saves one reviewed EOB (and posts it when asked and allowed). A past EOB
// (history) is kept for the report: it never changes the coverage or offers
// a switch to LOP, and is posted only when explicitly asked. Returns what
// was saved, and whether to offer the LOP switch.
function eob_save(array $it, array $user, bool $history, bool $canPost): array {
    $caseId = (int)($it['caseId'] ?? 0);
    $case = case_or_404($caseId);
    [$lines, $r, $row, $coverageId] = eob_input($it, $caseId);
    $row['history'] = $history;
    $postIt = !empty($it['post']) && !$case['ehr_synced_at'] && $canPost;
    $pdo = pi_db();
    $pdo->beginTransaction();
    $eobId = eob_write(null, $caseId, $coverageId, $row, $r, $lines, $user);
    $posted = null;
    if ($postIt) {
        $posted = eob_post($eobId, $caseId, $coverageId, $row + ['paid' => $r['totals']['paid'], 'interest' => $r['totals']['interest'], 'deductible' => $r['totals']['deductible']], eob_post_lines($lines, $row, $r['totals']), $user);
        $pdo->prepare('UPDATE eobs SET posted = 1 WHERE id = ?')->execute([$eobId]);
    }
    $pdo->commit();
    $offerLop = !$history && $r['status'] === 'exhausted' && eob_exhaust($caseId, $coverageId, $row, $user);
    touch_case($caseId);
    audit('eob_save', 'case', $caseId, $caseId, $user, ($history ? 'past EOB: ' : '') . $row['payer'] . ' ' . ($row['dos_from'] ?? '') . ($posted ? ' — posted' : ''));
    return ['id' => $eobId, 'caseId' => $caseId, 'caseNumber' => $case['case_number'], 'payer' => $row['payer'], 'kind' => 'eob', 'status' => $row['status'], 'history' => $history, 'posted' => $posted,
        'notPostedWhy' => !empty($it['post']) && !$postIt ? eob_not_posted_why($case, $user) : null, 'offerLop' => $offerLop];
}

// Saves one reviewed check without an EOB (posting it when asked and allowed).
function eob_save_payment(array $it, array $user, bool $history, bool $canPost): array {
    $caseId = (int)($it['caseId'] ?? 0);
    $case = case_or_404($caseId);
    [$r, $row, $coverageId, $amount, $interest] = eob_payment_input($it, $caseId);
    $row['history'] = $history;
    $postIt = !empty($it['post']) && !$case['ehr_synced_at'] && $canPost;
    $pdo = pi_db();
    $pdo->beginTransaction();
    $eobId = eob_write(null, $caseId, $coverageId, $row, $r, [], $user);
    $posted = null;
    if ($postIt) {
        $posted = eob_post_payment($eobId, $caseId, $coverageId, $row, $amount, $interest, $user);
        $pdo->prepare('UPDATE eobs SET posted = 1 WHERE id = ?')->execute([$eobId]);
    }
    $pdo->commit();
    touch_case($caseId);
    audit('eob_save', 'case', $caseId, $caseId, $user, ($history ? 'past check: ' : '') . $row['payer'] . ' check' . ($row['via'] ? ' via ' . $row['via'] : '') . ' $' . number_format($amount, 2) . ($posted ? ' — posted' : ''));
    return ['id' => $eobId, 'caseId' => $caseId, 'caseNumber' => $case['case_number'], 'payer' => $row['payer'], 'kind' => 'payment', 'status' => 'paid', 'history' => $history, 'posted' => $posted,
        'notPostedWhy' => !empty($it['post']) && !$postIt ? eob_not_posted_why($case, $user) : null, 'offerLop' => false];
}

// "SMITH, JOHN A" / "John A Smith" → [first, last].
function eob_split_name(?string $n): array {
    $n = trim(preg_replace('/\s+/', ' ', (string)$n));
    if ($n === '') return ['', ''];
    if (str_contains($n, ',')) { [$last, $first] = array_map('trim', explode(',', $n, 2)); $first = explode(' ', $first)[0]; }
    else { $parts = explode(' ', $n); $last = array_pop($parts); $first = $parts[0] ?? ''; }
    $tc = fn($s) => preg_match('/^[A-Z\'\-]+$/', $s) ? ucwords(strtolower($s), " -'") : $s;
    return [$tc($first), $tc($last)];
}

// A patient and auto case (with the insurer as PIP coverage) for an EOB that
// matches no case — one at a time on review, or in bulk for past EOBs. The
// case is noted as created from an EOB so staff know to fill in the rest.
function eob_create_case(string $patient, ?string $dateOfLoss, ?string $claim, ?string $payer, string $stage, array $user): array {
    [$first, $last] = eob_split_name($patient);
    if ($first === '') eob_reject("The EOB doesn't name the patient — create this case by hand.");
    if (!isset(STAGES[$stage])) $stage = 'treating';
    $pdo = pi_db(); $now = now_str();
    $pdo->prepare('INSERT INTO patients (practice_id, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?)')->execute([pid(), $first, $last, $now, $now]);
    $patientId = (int)$pdo->lastInsertId();
    $prefix = 'PI-' . date('y') . '-';
    $s = $pdo->prepare('SELECT case_number FROM cases WHERE practice_id = ? AND case_number LIKE ? ORDER BY case_number DESC LIMIT 1 FOR UPDATE');
    $s->execute([pid(), $prefix . '%']);
    $lastNo = $s->fetchColumn();
    $cols = ['practice_id' => pid(), 'patient_id' => $patientId, 'case_number' => $prefix . str_pad((string)(($lastNo ? (int)substr($lastNo, strlen($prefix)) : 0) + 1), 4, '0', STR_PAD_LEFT),
        'injury_type' => 'auto', 'stage' => $stage, 'date_of_injury' => eob_day($dateOfLoss), 'emc_status' => 'pending', 'actively_treating' => in_array($stage, ['intake', 'treating'], true) ? 1 : 0,
        'jurisdiction' => jurisdiction_code(current_practice()['state'] ?? 'FL'), 'notes_enc' => enc('Created from ' . ($payer ?: 'an insurer') . "'s EOB — check the patient's details."),
        'location_id' => !empty($user['location_id']) ? (int)$user['location_id'] : null, 'created_at' => $now, 'updated_at' => $now];
    $k = array_keys($cols);
    $pdo->prepare('INSERT INTO cases (' . implode(',', $k) . ') VALUES (' . implode(',', array_fill(0, count($k), '?')) . ')')->execute(array_values($cols));
    $caseId = (int)$pdo->lastInsertId();
    $pdo->prepare("INSERT INTO coverages (case_id, type, priority, status, carrier_text, claim_number_enc, benefit_limit, created_by, created_at, updated_at) VALUES (?, 'pip', 1, 'active', ?, ?, ?, ?, ?, ?)")
        ->execute([$caseId, $payer ? mb_substr($payer, 0, 160) : null, $claim ? enc($claim) : null, case_rules($cols)['pip_medical'], $user['id'] ?? null, $now, $now]);
    sync_benefits($caseId);
    audit('create', 'case', $caseId, $caseId, $user, 'from an EOB');
    return ['caseId' => $caseId, 'caseNumber' => $cols['case_number'], 'patient' => trim("$first $last")];
}
