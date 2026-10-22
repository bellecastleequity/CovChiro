<?php
// Reads a patient ledger exported from any EHR as a spreadsheet (CSV or
// Excel .xlsx). Every EHR names and arranges its columns differently, so
// the practice maps the columns once ("this column is the date of service,
// this one is what insurance paid") and the mapping is saved as a format,
// recognised automatically by its header row on later uploads.
//
// Two shapes of export are understood:
//   lines         one row per charge line, with billed / paid / balance
//                 columns (what most "patient ledger" reports look like)
//   transactions  one row per transaction — a charge, a payment, an
//                 adjustment — with either a type column and one amount
//                 column, or separate Charges / Payments / Adjustments
//                 columns (what most "account history" reports look like)
//
// Both produce the same structure as the DrChrono PDF reader, so previews,
// patient checks and applying the upload are shared.

const SHEET_MAX_ROWS = 20000;
const SHEET_MAX_COLS = 60;

const SHEET_FIELDS = [
    'lines' => [
        'dos' => ['Date of service', true], 'cpt' => ['CPT / procedure code', false], 'icd' => ['Diagnosis (ICD-10) codes', false],
        'billed' => ['Billed / charge amount', true], 'insurance_paid' => ['Insurance paid', false], 'patient_paid' => ['Patient paid', false],
        'adjustment' => ['Adjustment / write-off', false], 'patient_balance' => ['Patient balance', false], 'insurance_balance' => ['Insurance balance', false],
        'posted' => ['Posted / payment date', false], 'patient_name' => ['Patient name', false], 'dob' => ['Date of birth', false],
    ],
    'transactions' => [
        'date' => ['Transaction / posted date', true], 'dos' => ['Date of service', false], 'cpt' => ['CPT / procedure code', false],
        'icd' => ['Diagnosis (ICD-10) codes', false], 'type' => ['Transaction type', false], 'description' => ['Description', false],
        'amount' => ['Amount (one column for everything)', false], 'charge_amount' => ['Charges column', false],
        'payment_amount' => ['Payments column', false], 'adjustment_amount' => ['Adjustments column', false],
        'patient_name' => ['Patient name', false], 'dob' => ['Date of birth', false],
    ],
];

// What a transaction can be. "ignore" rows (e.g. a running balance line)
// are skipped and counted in the preview.
const SHEET_CATEGORIES = [
    'charge' => 'Charge', 'insurance_payment' => 'Insurance payment', 'patient_payment' => 'Patient payment',
    'adjustment' => 'Adjustment / write-off', 'transfer' => 'Moved to patient responsibility', 'ignore' => 'Ignore',
];

// Common column names across EHR exports, normalised (lowercase letters and
// digits only), used to pre-fill the mapping.
const SHEET_SYNONYMS = [
    'dos' => ['dos', 'dateofservice', 'servicedate', 'svcdate', 'dosfrom', 'fromdate', 'datesvc', 'servicefrom', 'visitdate', 'fromdos', 'datesofservice'],
    'date' => ['date', 'postdate', 'posteddate', 'postingdate', 'transactiondate', 'txndate', 'trandate', 'entrydate', 'paymentdate', 'depositdate', 'dateposted'],
    'cpt' => ['cpt', 'cptcode', 'cpts', 'procedure', 'procedurecode', 'proc', 'proccode', 'code', 'servicecode', 'hcpcs', 'cpthcpcs', 'billingcode'],
    'icd' => ['icd', 'icd10', 'icdcodes', 'icd10codes', 'diagnosis', 'diagnoses', 'diagnosiscodes', 'dx', 'dxcodes', 'dxcode'],
    'billed' => ['billed', 'charge', 'charges', 'amountbilled', 'billedamount', 'fee', 'fees', 'chargeamount', 'totalcharge', 'totalbilled', 'amountcharged', 'charged'],
    'insurance_paid' => ['inspaid', 'insurancepaid', 'inspmt', 'inspmts', 'inspayment', 'inspayments', 'insurancepayment', 'insurancepayments', 'payerpaid', 'paidbyinsurance', 'insurancepmt'],
    'patient_paid' => ['ptpaid', 'patientpaid', 'patpaid', 'ptpmt', 'ptpayment', 'patientpayment', 'patientpayments', 'paidbypatient', 'patpmt', 'patientpmt'],
    'adjustment' => ['adj', 'adjs', 'adjustment', 'adjustments', 'writeoff', 'writeoffs', 'contractualadjustment', 'adjamount', 'adjustmentamount'],
    'patient_balance' => ['ptbal', 'ptbalance', 'patientbalance', 'patbal', 'patbalance', 'patientresp', 'patientresponsibility', 'ptresp', 'patientdue', 'patientowes'],
    'insurance_balance' => ['insbal', 'insbalance', 'insurancebalance', 'insurancedue', 'insdue', 'payerbalance', 'insuranceowes'],
    'posted' => ['posted', 'postdate', 'posteddate', 'postingdate', 'paymentdate', 'dateposted', 'paiddate'],
    'patient_name' => ['patient', 'patientname', 'patientfullname', 'name', 'ptname'],
    'dob' => ['dob', 'dateofbirth', 'birthdate', 'patientdob', 'birthday'],
    'type' => ['type', 'transactiontype', 'txntype', 'trantype', 'category', 'entrytype', 'paymenttype', 'transtype', 'kind'],
    'description' => ['description', 'desc', 'memo', 'details', 'transactiondescription', 'note', 'notes', 'comment'],
    'amount' => ['amount', 'transactionamount', 'amt', 'netamount'],
    'charge_amount' => ['charge', 'charges', 'debit', 'debits', 'fee', 'fees', 'chargeamount'],
    'payment_amount' => ['payment', 'payments', 'paid', 'paymentamount', 'credit', 'credits', 'receipts'],
    'adjustment_amount' => ['adjustment', 'adjustments', 'adj', 'adjs', 'writeoff', 'writeoffs'],
];

// ---------- reading the file ----------

function sheet_read(string $path, string $ext): array {
    $rows = $ext === 'xlsx' ? sheet_read_xlsx($path) : sheet_read_csv($path);
    // Trim cells, drop fully empty rows, cap the size.
    $out = [];
    foreach ($rows as $r) {
        $r = array_map(fn($c) => trim(preg_replace('/\s+/u', ' ', (string)$c)), array_slice($r, 0, SHEET_MAX_COLS));
        if (implode('', $r) === '') continue;
        $out[] = $r;
        if (count($out) > SHEET_MAX_ROWS) throw new RuntimeException('This file has more than ' . number_format(SHEET_MAX_ROWS) . ' rows. Export just this patient\'s ledger.');
    }
    if (count($out) < 2) throw new RuntimeException('The file looks empty — export the ledger again with its column headings.');
    return $out;
}

function sheet_read_csv(string $path): array {
    $text = (string)file_get_contents($path);
    if (strncmp($text, "\xEF\xBB\xBF", 3) === 0) $text = substr($text, 3);
    elseif (strncmp($text, "\xFF\xFE", 2) === 0 || strncmp($text, "\xFE\xFF", 2) === 0) $text = mb_convert_encoding($text, 'UTF-8', 'UTF-16');
    if (!mb_check_encoding($text, 'UTF-8')) $text = mb_convert_encoding($text, 'UTF-8', 'Windows-1252');
    // The delimiter is whichever of , ; tab | splits the first lines most consistently.
    $sample = array_slice(preg_split('/\R/', $text), 0, 20);
    $best = ','; $bestScore = -1;
    foreach ([',', ';', "\t", '|'] as $d) {
        $counts = array_map(fn($l) => count(str_getcsv($l, $d, '"', '')), array_filter($sample, fn($l) => trim($l) !== ''));
        if (!$counts) continue;
        $score = max($counts) > 1 ? count(array_filter($counts, fn($c) => $c === max($counts))) * max($counts) : 0;
        if ($score > $bestScore) { $best = $d; $bestScore = $score; }
    }
    $fh = fopen('php://temp', 'r+');
    fwrite($fh, $text);
    rewind($fh);
    $rows = [];
    while (($r = fgetcsv($fh, 0, $best, '"', '')) !== false) $rows[] = $r;
    fclose($fh);
    return $rows;
}

function sheet_zip_entry(string $path, string $name): ?string {
    if (class_exists('ZipArchive')) {
        $z = new ZipArchive();
        if ($z->open($path) !== true) return null;
        $s = $z->getFromName($name);
        $z->close();
        return $s === false ? null : $s;
    }
    exec('unzip -p ' . escapeshellarg($path) . ' ' . escapeshellarg($name) . ' 2>/dev/null', $lines, $code);
    return $code === 0 ? implode("\n", $lines) : null;
}

function sheet_xml(string $xml): SimpleXMLElement {
    $x = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET | LIBXML_COMPACT);
    if ($x === false) throw new RuntimeException("Couldn't read this Excel file. Save it as .xlsx or CSV and try again.");
    return $x;
}

function sheet_read_xlsx(string $path): array {
    $wb = sheet_zip_entry($path, 'xl/workbook.xml');
    if ($wb === null) throw new RuntimeException("Couldn't open this Excel file. Save it as .xlsx (not the older .xls) or CSV and try again.");
    // The first sheet in the workbook, via its relationship id.
    $wbx = sheet_xml($wb);
    $sheet = 'xl/worksheets/sheet1.xml';
    $first = $wbx->sheets->sheet[0] ?? null;
    $rels = sheet_zip_entry($path, 'xl/_rels/workbook.xml.rels');
    if ($first && $rels) {
        $rid = (string)$first->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
        foreach (sheet_xml($rels)->Relationship as $rel) {
            if ((string)$rel['Id'] === $rid) { $t = ltrim((string)$rel['Target'], '/'); $sheet = str_starts_with($t, 'xl/') ? $t : 'xl/' . $t; }
        }
    }
    $strings = [];
    if (($ss = sheet_zip_entry($path, 'xl/sharedStrings.xml')) !== null) {
        foreach (sheet_xml($ss)->si as $si) {
            if (isset($si->t)) { $strings[] = (string)$si->t; continue; }
            $s = ''; foreach ($si->r as $run) $s .= (string)$run->t;
            $strings[] = $s;
        }
    }
    $xml = sheet_zip_entry($path, $sheet);
    if ($xml === null) throw new RuntimeException("Couldn't find a worksheet in this Excel file.");
    $rows = [];
    foreach (sheet_xml($xml)->sheetData->row as $row) {
        $r = [];
        foreach ($row->c as $c) {
            $ref = (string)$c['r'];
            $col = 0;
            if (preg_match('/^([A-Z]+)/', $ref, $m)) { foreach (str_split($m[1]) as $ch) $col = $col * 26 + (ord($ch) - 64); $col--; }
            else $col = count($r);
            if ($col >= SHEET_MAX_COLS) continue;
            $t = (string)$c['t'];
            if ($t === 's') $v = $strings[(int)$c->v] ?? '';
            elseif ($t === 'inlineStr') $v = (string)($c->is->t ?? '');
            else $v = (string)$c->v;
            $r[$col] = $v;
        }
        if ($r) { $max = max(array_keys($r)); $rows[] = array_map(fn($i) => $r[$i] ?? '', range(0, $max)); }
    }
    return $rows;
}

// ---------- values ----------

function sheet_norm(string $s): string { return preg_replace('/[^a-z0-9]/', '', strtolower($s)); }

// "$1,234.50", "(12.00)", "-12", "12.00-", "" (= 0). Null if not a number.
function sheet_money(?string $s): ?float {
    $s = trim((string)$s);
    if ($s === '' || $s === '-' || $s === '—') return 0.0;
    $neg = false;
    if (preg_match('/^\((.*)\)$/', $s, $m)) { $neg = true; $s = $m[1]; }
    if (str_ends_with($s, '-')) { $neg = true; $s = substr($s, 0, -1); }
    $s = str_replace(['$', ',', ' ', 'USD'], '', $s);
    if (str_starts_with($s, '-')) { $neg = !$neg; $s = substr($s, 1); }
    if (!preg_match('/^\d*\.?\d+$/', $s)) return null;
    return round(($neg ? -1 : 1) * (float)$s, 2);
}

// Dates as EHRs write them; $order is how to read 1/2/2026 (mdy in the US).
// Excel stores dates as day numbers, which arrive as plain numbers.
function sheet_date(?string $s, string $order = 'mdy'): ?string {
    $s = trim((string)$s);
    if ($s === '') return null;
    if (preg_match('/^\d{5}(\.\d+)?$/', $s) && (int)$s > 20000 && (int)$s < 80000) return gmdate('Y-m-d', ((int)$s - 25569) * 86400);
    $s = preg_replace('/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AaPp][Mm])?.*$/', '', $s);
    if (preg_match('#^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$#', $s, $m)) return checkdate((int)$m[2], (int)$m[3], (int)$m[1]) ? sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]) : null;
    if (preg_match('#^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$#', $s, $m)) {
        [$a, $b] = $order === 'dmy' ? [(int)$m[2], (int)$m[1]] : [(int)$m[1], (int)$m[2]];
        $y = (int)$m[3]; if ($y < 100) $y += $y > 69 ? 1900 : 2000;
        return checkdate($a, $b, $y) ? sprintf('%04d-%02d-%02d', $y, $a, $b) : null;
    }
    // "Oct 1, 2026" / "1 October 2026" (needs a 4-digit year, so headings
    // like "Pt Bal" — PT is a time zone — aren't read as dates).
    if (preg_match('/[A-Za-z]{3}/', $s) && preg_match('/\b\d{4}\b/', $s) && ($t = strtotime($s)) !== false) return date('Y-m-d', $t);
    return null;
}

// ---------- finding the header and guessing the mapping ----------

function sheet_signature(array $header): string {
    return hash('sha256', implode('|', array_map('sheet_norm', array_filter($header, fn($c) => trim($c) !== ''))));
}

// The heading row: the first of the top rows with 3+ text cells and no
// numbers or dates, preferring rows that use known column names.
function sheet_find_header(array $rows): int {
    $best = null; $bestScore = 0;
    foreach (array_slice($rows, 0, 30, true) as $i => $r) {
        $cells = array_filter($r, fn($c) => $c !== '');
        if (count($cells) < 3) continue;
        if (array_filter($cells, fn($c) => sheet_money($c) !== null && sheet_money($c) != 0 || sheet_date($c) !== null)) continue;
        $known = 0;
        foreach ($cells as $c) foreach (SHEET_SYNONYMS as $syn) if (in_array(sheet_norm($c), $syn, true)) { $known++; break; }
        $score = $known * 10 + count($cells);
        if ($known >= 2 && $score > $bestScore) { $best = $i; $bestScore = $score; }
        if ($best === null && $bestScore === 0) { $best = $i; $bestScore = 0.5; }
    }
    return $best ?? 0;
}

function sheet_guess(array $header): array {
    $norm = array_map('sheet_norm', $header);
    $find = function (string $field, array $taken) use ($norm) {
        foreach (SHEET_SYNONYMS[$field] as $syn) {
            foreach ($norm as $i => $n) if ($n === $syn && !in_array($i, $taken, true)) return $i;
        }
        foreach (SHEET_SYNONYMS[$field] as $syn) {
            if (strlen($syn) < 4) continue;
            foreach ($norm as $i => $n) if ($n !== '' && str_contains($n, $syn) && !in_array($i, $taken, true)) return $i;
        }
        return null;
    };
    $out = [];
    foreach (['lines', 'transactions'] as $layout) {
        $taken = []; $map = [];
        $order = $layout === 'lines'
            ? ['dos', 'cpt', 'icd', 'insurance_paid', 'patient_paid', 'patient_balance', 'insurance_balance', 'adjustment', 'billed', 'posted', 'patient_name', 'dob']
            : ['dos', 'date', 'cpt', 'icd', 'type', 'description', 'amount', 'payment_amount', 'adjustment_amount', 'charge_amount', 'patient_name', 'dob'];
        foreach ($order as $f) {
            $i = $find($f, $taken);
            if ($i !== null) { $map[$f] = $i; $taken[] = $i; }
        }
        // A file with only one date column: it's the date of service.
        if ($layout === 'transactions' && !isset($map['date']) && isset($map['dos'])) { $map['date'] = $map['dos']; unset($map['dos']); }
        $out[$layout] = $map;
    }
    $l = $out['lines']; $t = $out['transactions'];
    $linesFit = isset($l['dos'], $l['billed']) && (isset($l['insurance_paid']) || isset($l['patient_balance']) || isset($l['insurance_balance']));
    $txnFit = isset($t['date']) && ((isset($t['amount']) && (isset($t['type']) || isset($t['description']))) || isset($t['payment_amount']));
    return ['layout' => $linesFit || !$txnFit ? 'lines' : 'transactions', 'columns' => $out];
}

// A best guess at what a transaction type or description means.
function sheet_guess_category(string $v): string {
    $s = strtolower($v);
    if ($s === '') return 'ignore';
    if (preg_match('/transfer|xfer|to pat|to pt|pt resp|patient resp|pat resp|moved to patient/', $s)) return 'transfer';
    if (preg_match('/balance forward|beginning balance|running balance|statement/', $s)) return 'ignore';
    if (preg_match('/\badj|write|w\/o|discount|contractual|courtesy|reduction/', $s)) return 'adjustment';
    $pay = preg_match('/pay|pmt|paid|check|chk|era|eob|deposit|receipt|refund/', $s);
    if ($pay && preg_match('/\bins|insur|payer|carrier|era|eob|pip|claim|geico|progressive|state farm|allstate|liberty|usaa|nationwide|travelers|comp/', $s)) return 'insurance_payment';
    if (preg_match('/copay|co-pay|cash|credit card|debit card|\bcard\b|self.?pay|\bpatient\b|\bpt\b|\bpat\b|venmo|zelle/', $s) && ($pay || preg_match('/copay|co-pay|cash|card/', $s))) return 'patient_payment';
    if (preg_match('/charge|chg|\bfee|service|visit|exam|therapy|treatment|debit|^\d{5}\b/', $s)) return 'charge';
    return 'ignore';
}

// The heading cells, a few sample rows and the distinct transaction types,
// for the mapping screen.
function sheet_inspect(array $rows, int $headerIdx, ?array $savedMapping = null): array {
    $header = $rows[$headerIdx] ?? [];
    $data = array_slice($rows, $headerIdx + 1);
    $guess = sheet_guess($header);
    $values = [];
    foreach ($header as $i => $_) {
        $distinct = [];
        foreach ($data as $r) { $v = $r[$i] ?? ''; if ($v !== '' && count($distinct) < 61) $distinct[$v] = true; }
        $values[$i] = count($distinct) <= 60 ? array_keys($distinct) : null;
    }
    $dmy = false;
    foreach ($data as $r) foreach ($r as $c) if (preg_match('#^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}#', $c, $m) && (int)$m[1] > 12 && (int)$m[2] <= 12) $dmy = true;
    return [
        'headerRow' => $headerIdx, 'header' => $header, 'signature' => sheet_signature($header),
        'topRows' => array_map(fn($r) => array_map(fn($c) => mb_substr($c, 0, 40), array_slice($r, 0, 12)), array_slice($rows, 0, 12)),
        'sample' => array_map(fn($r) => array_map(fn($c) => mb_substr($c, 0, 60), $r), array_slice($data, 0, 6)),
        'distinct' => $values, 'guess' => $guess,
        'typeGuess' => array_map(fn($vals) => $vals === null ? null : ($vals ? array_combine($vals, array_map('sheet_guess_category', $vals)) : (object)[]), $values), 'dateOrder' => $dmy ? 'dmy' : 'mdy',
        'categories' => SHEET_CATEGORIES, 'fields' => SHEET_FIELDS, 'saved' => $savedMapping,
    ];
}

// ---------- parsing with a mapping ----------

// $m: ['layout', 'columns' => field => column index, 'types' => value =>
// category, 'date_order', 'default_payment' (category for payments with no
// recognisable type)]. Returns the shared ledger structure.
function sheet_parse(array $rows, int $headerIdx, array $m, string $system): array {
    $layout = $m['layout'] === 'transactions' ? 'transactions' : 'lines';
    $cols = array_map('intval', array_filter((array)($m['columns'] ?? []), fn($v) => $v !== null && $v !== ''));
    $order = ($m['date_order'] ?? 'mdy') === 'dmy' ? 'dmy' : 'mdy';
    foreach (SHEET_FIELDS[$layout] as $f => [$label, $required]) {
        if ($required && !isset($cols[$f])) throw new RuntimeException("Pick the column for “{$label}”.");
    }
    if ($layout === 'transactions' && !isset($cols['amount']) && !isset($cols['charge_amount']) && !isset($cols['payment_amount'])) {
        throw new RuntimeException('Pick the amount column, or the Charges / Payments columns.');
    }
    $get = fn(array $r, string $f) => isset($cols[$f]) ? (string)($r[$cols[$f]] ?? '') : '';
    $warnings = [];
    $skipped = 0;
    $names = []; $dobs = [];
    $visits = [];   // dos => ['dos', 'icd' => [], 'lines' => [key => line]]
    $unapplied = [];

    $lineFor = function (string $dos, string $cpt) use (&$visits) {
        if (!isset($visits[$dos])) $visits[$dos] = ['dos' => $dos, 'icd' => [], 'lines' => []];
        $key = $cpt !== '' ? $cpt : '*';
        if (!isset($visits[$dos]['lines'][$key])) $visits[$dos]['lines'][$key] = [
            'cpt' => $cpt !== '' ? $cpt : null, 'billed' => 0.0, 'insurance_paid' => 0.0, 'patient_paid' => 0.0, 'adjustment' => 0.0,
            'patient_balance' => 0.0, 'insurance_balance' => 0.0, 'posted' => null, 'moved_on' => null, 'events' => [],
        ];
        return $key;
    };
    $addIcd = function (string $dos, string $icd) use (&$visits) {
        foreach (preg_split('/[\s,;|]+/', strtoupper($icd)) as $code) {
            if (preg_match('/^[A-Z]\d{2}(\.?[0-9A-Z]{1,4})?$/', $code) && !in_array($code, $visits[$dos]['icd'], true)) $visits[$dos]['icd'][] = $code;
        }
    };

    foreach (array_slice($rows, $headerIdx + 1) as $n => $r) {
        $rowNo = $headerIdx + $n + 2;
        if (($pn = trim($get($r, 'patient_name'))) !== '') $names[sheet_norm($pn)] = $pn;
        if (($pd = sheet_date($get($r, 'dob'), $order)) !== null) $dobs[$pd] = true;

        if ($layout === 'lines') {
            $dos = sheet_date($get($r, 'dos'), $order);
            if (!$dos) { $skipped++; continue; }  // totals, subtotals, page headers
            $nums = [];
            foreach (['billed', 'insurance_paid', 'patient_paid', 'adjustment', 'patient_balance', 'insurance_balance'] as $f) {
                $v = sheet_money($get($r, $f));
                if ($v === null) throw new RuntimeException("Row $rowNo: “" . $get($r, $f) . '” in the ' . SHEET_FIELDS['lines'][$f][0] . ' column isn\'t an amount. Check the column mapping.');
                $nums[$f] = $v;
            }
            $key = $lineFor($dos, strtoupper(trim($get($r, 'cpt'))));
            $l = &$visits[$dos]['lines'][$key];
            foreach (['billed', 'insurance_paid', 'patient_paid', 'adjustment'] as $f) $l[$f] = round($l[$f] + abs($nums[$f]), 2);
            $l['_pb'] = round(($l['_pb'] ?? 0) + $nums['patient_balance'], 2);
            $l['_ib'] = round(($l['_ib'] ?? 0) + $nums['insurance_balance'], 2);
            $posted = sheet_date($get($r, 'posted'), $order);
            if ($posted && (!$l['posted'] || $posted > $l['posted'])) $l['posted'] = $posted;
            unset($l);
            $addIcd($dos, $get($r, 'icd'));
            continue;
        }

        // transactions
        $date = sheet_date($get($r, 'date'), $order);
        if (!$date) { $skipped++; continue; }
        $dos = sheet_date($get($r, 'dos'), $order);
        $typeText = trim($get($r, 'type')) !== '' ? trim($get($r, 'type')) : trim($get($r, 'description'));
        $category = $m['types'][$typeText] ?? sheet_guess_category($typeText);
        $entries = [];
        if (isset($cols['amount'])) {
            $v = sheet_money($get($r, 'amount'));
            if ($v === null) throw new RuntimeException("Row $rowNo: “" . $get($r, 'amount') . '” in the amount column isn\'t an amount.');
            if ($v != 0) $entries[] = [$category, $v];
        } else {
            foreach (['charge_amount' => 'charge', 'payment_amount' => 'payment', 'adjustment_amount' => 'adjustment'] as $f => $kind) {
                $v = sheet_money($get($r, $f));
                if ($v === null) throw new RuntimeException("Row $rowNo: “" . $get($r, $f) . '” in the ' . SHEET_FIELDS['transactions'][$f][0] . ' isn\'t an amount.');
                if ($v == 0) continue;
                if ($kind === 'charge') $cat = 'charge';
                elseif ($kind === 'payment') $cat = in_array($category, ['insurance_payment', 'patient_payment'], true) ? $category : ($m['default_payment'] ?? 'ignore');
                else $cat = $category === 'transfer' ? 'transfer' : 'adjustment';
                $entries[] = [$cat, $v];
            }
        }
        foreach ($entries as [$cat, $v]) {
            if ($cat === 'ignore' || !isset(SHEET_CATEGORIES[$cat])) { $warnings['ignored'] = ($warnings['ignored'] ?? 0) + 1; continue; }
            $cpt = strtoupper(trim($get($r, 'cpt')));
            $ev = ['kind' => $cat, 'date' => $date, 'amount' => $v, 'dos' => $dos ?? ($cat === 'charge' ? $date : null), 'cpt' => $cpt, 'row' => $rowNo];
            if ($cat === 'charge') {
                $key = $lineFor($ev['dos'], $cpt);
                $visits[$ev['dos']]['lines'][$key]['_charges'][] = $v;
                $addIcd($ev['dos'], $get($r, 'icd'));
            } else {
                $unapplied[] = $ev;  // attached to its charge line below
            }
        }
    }
    if (count($names) > 1) throw new RuntimeException('This file has ' . count($names) . " patients in it. Upload one patient's ledger per case — filter the report to this patient in your EHR before exporting.");
    if (count($dobs) > 1) throw new RuntimeException("This file has more than one date of birth in it. Upload one patient's ledger per case.");
    if (!$visits) throw new RuntimeException('No charges found. Check that the date and amount columns are mapped correctly.');

    if ($layout === 'transactions') {
        // Each category keeps one sign convention: payments shown as negative
        // numbers in the export are payments all the same; an opposite-signed
        // one is a reversal.
        $flip = [];
        foreach (array_keys(SHEET_CATEGORIES) as $cat) {
            $sum = array_sum(array_map(fn($e) => $e['amount'], array_filter($unapplied, fn($e) => $e['kind'] === $cat)));
            if ($cat === 'charge') { $sum = 0; foreach ($visits as $v) foreach ($v['lines'] as $l) $sum += array_sum($l['_charges'] ?? []); }
            $flip[$cat] = $sum < 0 ? -1 : 1;
        }
        foreach ($visits as &$v) foreach ($v['lines'] as &$l) { $l['billed'] = round(array_sum($l['_charges'] ?? []) * $flip['charge'], 2); unset($l['_charges']); }
        unset($v, $l);
        // Attach payments etc. to their charge line: same DOS and CPT, else
        // the only line on that DOS; otherwise they stay at case level.
        $rest = [];
        foreach ($unapplied as $e) {
            $e['amount'] = round($e['amount'] * $flip[$e['kind']], 2);
            $key = null;
            if ($e['dos'] && isset($visits[$e['dos']])) {
                $lines = $visits[$e['dos']]['lines'];
                if ($e['cpt'] !== '' && isset($lines[$e['cpt']])) $key = $e['cpt'];
                elseif (count($lines) === 1) $key = array_key_first($lines);
            }
            $ev = ['kind' => $e['kind'], 'date' => $e['date'], 'amount' => $e['amount']];
            if ($key !== null) $visits[$e['dos']]['lines'][$key]['events'][] = $ev;
            else $rest[] = $ev;
        }
        $unapplied = $rest;
    }

    // Balances per line.
    $out = [];
    ksort($visits);
    foreach ($visits as $v) {
        $lines = [];
        foreach ($v['lines'] as $l) {
            if ($layout === 'lines') {
                $owed = round($l['billed'] - $l['insurance_paid'] - $l['patient_paid'] - $l['adjustment'], 2);
                $hasPb = isset($cols['patient_balance']); $hasIb = isset($cols['insurance_balance']);
                if ($hasPb) $l['patient_balance'] = $l['_pb'];
                elseif ($hasIb) $l['patient_balance'] = round($owed - $l['_ib'], 2);
                else $l['patient_balance'] = 0.0;
                $l['insurance_balance'] = round($owed - $l['patient_balance'], 2);
                if ($hasPb && $hasIb && abs($l['insurance_balance'] - $l['_ib']) > 0.01) {
                    throw new RuntimeException('On ' . $v['dos'] . ($l['cpt'] ? ' (' . $l['cpt'] . ')' : '') . ', billed − paid − adjustments doesn\'t equal the two balances in the file. Check the column mapping.');
                }
                unset($l['_pb'], $l['_ib'], $l['events']);
            } else {
                $l = sheet_line_from_events($l);
            }
            $lines[] = $l;
        }
        $out[] = ['dos' => $v['dos'], 'icd' => $v['icd'], 'lines' => $lines];
    }
    $data = ['system' => $system, 'patient' => ['first_name' => null, 'last_name' => null, 'dob' => $dobs ? array_key_first($dobs) : null, 'full_name' => $names ? reset($names) : null],
        'practice' => null, 'accident' => ['date' => null, 'insurer' => null, 'claim_number' => null], 'visits' => $out, 'unapplied' => [], 'verified' => false];
    // Case-level payments etc. that couldn't be matched to a charge line.
    $u = sheet_line_from_events(['billed' => 0.0, 'events' => $unapplied]);
    $data['unapplied'] = $unapplied;
    if ($skipped) $warnings['skipped'] = $skipped;
    if ($unapplied) $warnings['unapplied'] = count($unapplied);
    $data['warnings'] = $warnings;
    $data['totals'] = ledger_data_totals($data, $u);
    $data['counts'] = ['visits' => count($out), 'lines' => array_sum(array_map(fn($v) => count($v['lines']), $out))];
    return $data;
}

// Summarises a line's transactions. Money the patient paid is patient
// responsibility even when the EHR never recorded the move, so the move is
// at least what the patient paid.
function sheet_line_from_events(array $l): array {
    $sum = ['insurance_payment' => 0.0, 'patient_payment' => 0.0, 'adjustment' => 0.0, 'transfer' => 0.0];
    $last = ['insurance_payment' => null, 'transfer' => null];
    foreach ($l['events'] as $e) {
        $sum[$e['kind']] = round($sum[$e['kind']] + $e['amount'], 2);
        if (array_key_exists($e['kind'], $last)) $last[$e['kind']] = max((string)$last[$e['kind']], $e['date']);
    }
    $transfer = max($sum['transfer'], $sum['patient_payment']);
    $l['insurance_paid'] = $sum['insurance_payment'];
    $l['patient_paid'] = $sum['patient_payment'];
    $l['adjustment'] = $sum['adjustment'];
    $l['patient_balance'] = round($transfer - $sum['patient_payment'], 2);
    $l['insurance_balance'] = round(($l['billed'] ?? 0) - $sum['insurance_payment'] - $sum['adjustment'] - $transfer, 2);
    $l['posted'] = $last['insurance_payment'];
    $l['moved_on'] = $last['transfer'];
    return $l;
}

// Ledger totals from the parsed structure (the readers' common shape).
function ledger_data_totals(array $data, ?array $unapplied = null): array {
    $t = ['billed' => 0.0, 'insurance_paid' => 0.0, 'patient_paid' => 0.0, 'adjustment' => 0.0, 'patient_balance' => 0.0, 'insurance_balance' => 0.0];
    $lines = [];
    foreach ($data['visits'] as $v) foreach ($v['lines'] as $l) $lines[] = $l;
    if ($unapplied) $lines[] = $unapplied;
    foreach ($lines as $l) foreach ($t as $k => $_) $t[$k] = round($t[$k] + ($l[$k] ?? 0), 2);
    return $t;
}
