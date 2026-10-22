<?php
// Reads a DrChrono "Billing Ledger" PDF (as faxed or downloaded from
// DrChrono) into structured data. Only what case management needs is
// extracted — patient name and DOB (to confirm the right case), accident
// date and auto-insurance claim, totals, and line items. SSNs, phone
// numbers, emergency contacts etc. on the demographics page are ignored.
//
// How DrChrono lays the ledger out (verified by reconciling a real export):
//   * each visit starts with its date of service, provider and ICD-10 codes
//   * each CPT line is posted, and re-posted with $0 billed on the date its
//     balance was transferred to patient responsibility
//   * the line "Balance" column is the PATIENT balance; the lines' balances
//     sum to the ledger's "Patient Balance"
//   * insurance still owes billed − insurance paid − patient paid − patient
//     balance on each line, summing to "Insurance Balance"
// The parse is rejected unless those identities hold, so a layout change in
// DrChrono can never silently import wrong numbers.

function drchrono_pdf_text(string $pdfPath): string {
    $out = tempnam(sys_get_temp_dir(), 'ldg');
    $cmd = 'pdftotext -layout ' . escapeshellarg($pdfPath) . ' ' . escapeshellarg($out) . ' 2>/dev/null';
    exec($cmd, $_, $code);
    $text = $code === 0 ? (string)file_get_contents($out) : '';
    @unlink($out);
    if ($text === '') throw new RuntimeException("Couldn't read text from this PDF. Is it a scanned image? Export the ledger directly from DrChrono instead of scanning it.");
    return $text;
}

function drchrono_money(string $s): float { return round((float)str_replace([',', '$'], '', $s), 2); }

function drchrono_date(string $s): ?string {
    if (preg_match('#^(\d{4})-(\d{2})-(\d{2})$#', trim($s), $m)) return "$m[1]-$m[2]-$m[3]";
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})$#', trim($s), $m)) return sprintf('%04d-%02d-%02d', $m[3], $m[1], $m[2]);
    return null;
}

function drchrono_parse_ledger(string $text): array {
    $lines = preg_split('/\R/', $text);
    if (!preg_match('/Total Billed\s+\$[\d,.]+/', $text) || !preg_match('/Patient Balance:?\s+\$[\d,.]+/', $text)) {
        throw new RuntimeException("This doesn't look like a DrChrono billing ledger (no ledger totals found).");
    }
    $field = function (string $label) use ($text): ?string {
        return preg_match('/^\s*' . preg_quote($label, '/') . '\s{2,}(\S[^\n]*?)(?:\s{2,}|$)/m', $text, $m) ? trim($m[1]) : null;
    };
    $total = function (string $label) use ($text): float {
        return preg_match('/' . preg_quote($label, '/') . ':?\s+\$([\d,]+\.\d\d)/', $text, $m) ? drchrono_money($m[1]) : 0.0;
    };
    $result = [
        'system' => 'DrChrono',
        'patient' => ['first_name' => $field('First Name'), 'last_name' => $field('Last Name'), 'dob' => drchrono_date((string)$field('Date of birth'))],
        'practice' => null,
        'accident' => ['date' => null, 'insurer' => null, 'claim_number' => null],
        'totals' => [
            'billed' => $total('Total Billed'), 'allowed' => $total('Total Allowed'), 'adjustment' => $total('Total Adjustment'),
            'patient_paid' => $total('Total Patient Paid'), 'insurance_paid' => $total('Total Insurance Paid'),
            'patient_balance' => $total('Patient Balance'), 'insurance_balance' => $total('Insurance Balance'),
        ],
        'visits' => [],
    ];
    if (preg_match('/Fax From:\s*\n\s*(\S[^\n]+)/', $text, $m)) $result['practice'] = trim($m[1]);
    // Auto accident block: "Date of Accident 2023-08-07", "Case # ...", insurer name.
    if (preg_match('/Date of Accident\s+(\d{4}-\d{2}-\d{2})/', $text, $m)) $result['accident']['date'] = $m[1];
    if (preg_match('/Case #\s+(\S+)/', $text, $m)) $result['accident']['claim_number'] = $m[1];
    if (preg_match('/Auto Accident\s*\n\s{20,}(\S[^\n]+)\n\s*Insurer/', $text, $m)) $result['accident']['insurer'] = trim($m[1]);

    $visit = null;
    foreach ($lines as $ln) {
        // Visit header: date of service at the start of the line, then ICD codes.
        if (preg_match('#^(\d{1,2}/\d{2}/\d{4})\s{3,}(.*)$#', $ln, $m)) {
            if ($visit) $result['visits'][] = $visit;
            $visit = ['dos' => drchrono_date($m[1]), 'icd' => [], 'lines' => []];
            if (preg_match_all('/\b([A-TV-Z]\d{2}(?:\.\d{1,4}[A-Z]{0,2}|\.?[A-Z0-9]{0,4}))\b/', $m[2], $icd)) $visit['icd'] = $icd[1];
            continue;
        }
        if (!$visit) continue;
        // Continuation of the ICD list on the following line(s).
        if (preg_match('#^\d{1,2}:\d{2}[AP]M\s+(.*)$#', trim($ln), $m) || (preg_match('/^\s{10,}([A-Z]\d{2}\.[^$]*)$/', $ln, $m) && !preg_match('/\$\d/', $ln))) {
            if (preg_match_all('/\b([A-TV-Z]\d{2}\.[A-Z0-9]{1,4})\b/', $m[1], $icd)) $visit['icd'] = array_values(array_unique(array_merge($visit['icd'], $icd[1])));
            continue;
        }
        // Line posting: posted date, CPT/HCPCS, billed, insurance paid, patient paid, balance.
        if (preg_match('#^\s*(\d{2}/\d{2}/\d{4})\s+([A-Z0-9]{5})(?:-?[A-Z0-9]{2})?\s+\$([\d,]+\.\d\d)\s+\$([\d,]+\.\d\d)\s+\$([\d,]+\.\d\d)\s+\$([\d,]+\.\d\d)\s*$#', $ln, $m)) {
            [$_, $posted, $cpt, $billed, $insPaid, $ptPaid, $bal] = $m;
            $billed = drchrono_money($billed);
            $last = count($visit['lines']) - 1;
            // A $0 re-posting of the same code updates that line (the transfer to patient).
            if ($billed == 0.0 && $last >= 0 && $visit['lines'][$last]['cpt'] === $cpt) {
                $visit['lines'][$last]['insurance_paid'] += drchrono_money($insPaid);
                $visit['lines'][$last]['patient_paid'] += drchrono_money($ptPaid);
                $visit['lines'][$last]['patient_balance'] = drchrono_money($bal);
                $visit['lines'][$last]['moved_on'] = drchrono_date($posted);
            } else {
                $visit['lines'][] = ['cpt' => $cpt, 'posted' => drchrono_date($posted), 'billed' => $billed,
                    'insurance_paid' => drchrono_money($insPaid), 'patient_paid' => drchrono_money($ptPaid),
                    'patient_balance' => drchrono_money($bal), 'moved_on' => null];
            }
        }
    }
    if ($visit) $result['visits'][] = $visit;
    $result['visits'] = array_values(array_filter($result['visits'], fn($v) => $v['lines']));

    // Per-line insurance balance, and a moved-on date for lines whose
    // patient balance appeared without a separate re-posting.
    $sum = ['billed' => 0.0, 'patient_balance' => 0.0, 'insurance_balance' => 0.0, 'insurance_paid' => 0.0, 'patient_paid' => 0.0, 'lines' => 0];
    foreach ($result['visits'] as &$v) {
        foreach ($v['lines'] as &$l) {
            $l['insurance_balance'] = round($l['billed'] - $l['insurance_paid'] - $l['patient_paid'] - $l['patient_balance'], 2);
            foreach (['billed', 'patient_balance', 'insurance_balance', 'insurance_paid', 'patient_paid'] as $k) $sum[$k] += $l[$k];
            $sum['lines']++;
        }
        unset($l);
    }
    unset($v);
    $t = $result['totals'];
    $checks = [
        'billed' => [$sum['billed'], $t['billed']],
        'patient balance' => [$sum['patient_balance'], $t['patient_balance']],
        'insurance paid' => [$sum['insurance_paid'], $t['insurance_paid']],
        'patient paid' => [$sum['patient_paid'], $t['patient_paid']],
        // Ledger-level adjustments aren't itemized per line, so they're
        // allowed to account for the insurance-balance difference.
        'insurance balance' => [$sum['insurance_balance'] - $t['adjustment'], $t['insurance_balance']],
    ];
    foreach ($checks as $label => [$got, $want]) {
        if (abs($got - $want) > 0.01) {
            throw new RuntimeException(sprintf("The line items don't add up to the ledger's %s (%s vs %s), so nothing was imported. The export format may have changed — send it to support.", $label, number_format($got, 2), number_format($want, 2)));
        }
    }
    if (!$sum['lines']) throw new RuntimeException('No charges found in this ledger.');
    $result['counts'] = ['visits' => count($result['visits']), 'lines' => $sum['lines']];
    return $result;
}
