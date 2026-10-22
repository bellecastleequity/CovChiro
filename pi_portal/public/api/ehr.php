<?php
// EHR ledger upload. The practice's EHR is the source of truth for money;
// this platform mirrors it. One patient's ledger is uploaded to their case,
// previewed (with checks that it's the right patient), then applied: the
// case's EHR-sourced ledger lines are replaced by the new upload, so
// re-uploading is always safe and a newer export simply updates the numbers.
//
// Works with any EHR, three ways:
//   * spreadsheet (CSV / Excel) — every EHR can export one. Columns are
//     mapped once per EHR and the mapping is saved (app/ehr/spreadsheet.php)
//   * PDF — read directly for EHRs with a built-in reader (DrChrono today,
//     app/ehr/drchrono_ledger.php); others are added as samples come in
//   * totals — when only an unreadable PDF or a screen is available, the
//     ledger's totals are typed in (and the PDF can be kept on the case)
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/ehr/drchrono_ledger.php';
require_once __DIR__ . '/../../app/ehr/spreadsheet.php';
pi_start_session();

// EHRs commonly used by chiropractic, PT and medical practices — a pick
// list for naming a format; any name can be typed.
const COMMON_EHRS = ['ChiroTouch', 'ECLIPSE', 'Jane', 'ChiroFusion', 'Genesis Chiropractic Software', 'ChiroHD', 'ChiroSpring', 'Practice Perfect',
    'Tebra (Kareo)', 'DrChrono', 'athenahealth', 'eClinicalWorks', 'Practice Fusion', 'AdvancedMD', 'NextGen', 'Epic', 'Compulink', 'WebPT',
    'Prompt', 'Raintree', 'Office Ally', 'CollaborateMD', 'ChiroMatrix', 'Atlas Chiropractic System', 'SimplePractice', 'Other'];

function pending_dir(): string {
    $d = dirname(PI_STORAGE_DIR) . '/pending';
    if (!is_dir($d)) mkdir($d, 0700, true);
    // Abandoned uploads (the browser closed mid-preview) are removed after
    // two hours.
    foreach (glob($d . '/*') ?: [] as $f) if (filemtime($f) < time() - 7200) @unlink($f);
    return $d;
}

function norm_name(?string $s): string { return strtolower(preg_replace('/[^a-z]/i', '', (string)$s)); }

function pending(?string $token = null): array {
    $p = $_SESSION['ehr_pending'] ?? null;
    if (!$p || ($token !== null && !hash_equals($p['token'], $token))) json_response(['error' => 'This upload has expired — choose the file again.'], 409);
    case_or_404((int)$p['case_id']);
    return $p;
}

// The pending upload decrypted to a temporary file (deleted at exit).
function pending_plain_file(array $p): string {
    $tmp = tempnam(sys_get_temp_dir(), 'ehr');
    file_put_contents($tmp, dec_file((string)file_get_contents(pending_dir() . '/' . $p['token'])));
    register_shutdown_function(fn() => @unlink($tmp));
    return $tmp;
}

function practice_ehr_name(): string { return current_practice()['ehr_name'] ?: 'EHR'; }

function read_pending_sheet(array $p): array {
    try {
        return sheet_read(pending_plain_file($p), $p['kind']);
    } catch (RuntimeException $e) {
        json_response(['error' => $e->getMessage()], 422);
    }
}

// ---------- upload ----------
function handle_preview() {
    require_method('POST');
    $user = require_user('finance.write');
    $caseId = (int)($_POST['case_id'] ?? 0);
    case_or_404($caseId);
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Upload failed — the file may be too large.'], 400);
    if ($f['size'] > PI_MAX_UPLOAD_BYTES) json_response(['error' => 'Files must be 25 MB or smaller.'], 400);
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
    if ($mime === 'application/pdf') $kind = 'pdf';
    elseif ($ext === 'xlsx' && in_array($mime, ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'], true)) $kind = 'xlsx';
    elseif (in_array($ext, ['csv', 'txt', 'tsv'], true) && (str_starts_with($mime, 'text/') || $mime === 'application/csv')) $kind = 'csv';
    elseif ($ext === 'xls') json_response(['error' => 'This is the older Excel format (.xls). Open it in Excel and save as .xlsx or CSV, then upload that.'], 400);
    else json_response(['error' => 'Upload the ledger as a spreadsheet (CSV or Excel .xlsx) or a PDF exported from your EHR.'], 400);

    // Hold the file (encrypted, outside the web root) until it's applied or
    // abandoned; one pending upload per session.
    if (!empty($_SESSION['ehr_pending']['token'])) @unlink(pending_dir() . '/' . $_SESSION['ehr_pending']['token']);
    $token = bin2hex(random_bytes(16));
    file_put_contents(pending_dir() . '/' . $token, enc_file(file_get_contents($f['tmp_name'])), LOCK_EX);
    $_SESSION['ehr_pending'] = ['token' => $token, 'case_id' => $caseId, 'kind' => $kind, 'sha' => hash_file('sha256', $f['tmp_name']),
        'name' => mb_substr(basename((string)$f['name']), 0, 200), 'data' => null, 'needs_override' => false, 'blocked' => null];
    audit('ehr_preview', 'case', $caseId, $caseId, $user, $kind);

    if ($kind === 'pdf') {
        try {
            $text = drchrono_pdf_text($f['tmp_name']);
            if (str_contains($text, 'Total Billed') && str_contains($text, 'Patient Balance')) {
                json_response(build_preview($caseId, drchrono_parse_ledger($text) + ['method' => 'pdf', 'verified' => true]));
            }
            $why = "We can read DrChrono ledger PDFs directly. For other EHRs, export the patient's ledger as a spreadsheet (CSV or Excel) — every EHR can — or enter the ledger's totals here.";
        } catch (RuntimeException $e) {
            $why = $e->getMessage();
        }
        json_response(['token' => $token, 'unrecognized' => true, 'message' => $why, 'ehrName' => current_practice()['ehr_name']]);
    }

    $rows = read_pending_sheet($_SESSION['ehr_pending']);
    // A saved format for this EHR is recognised by its header row.
    $formats = practice_formats();
    foreach (array_slice($rows, 0, 30, true) as $i => $r) {
        $fmt = $formats[sheet_signature($r)] ?? null;
        if (!$fmt) continue;
        $map = json_decode($fmt['mapping'], true);
        try {
            $data = sheet_parse($rows, $i, $map, $fmt['name']) + ['method' => 'spreadsheet'];
        } catch (RuntimeException $e) {
            json_response(['token' => $token, 'needsMapping' => true, 'error' => $e->getMessage()] + sheet_inspect($rows, $i, $map + ['name' => $fmt['name']]) + mapping_extras());
        }
        json_response(build_preview($caseId, $data, ['format' => ['id' => (int)$fmt['id'], 'name' => $fmt['name']], 'headerRow' => $i]));
    }
    json_response(['token' => $token, 'needsMapping' => true] + sheet_inspect($rows, sheet_find_header($rows)) + mapping_extras());
}

function mapping_extras(): array {
    return ['ehrs' => COMMON_EHRS, 'ehrName' => current_practice()['ehr_name']];
}

function practice_formats(): array {
    $s = pi_db()->prepare('SELECT * FROM ehr_formats WHERE practice_id = ?');
    $s->execute([pid()]);
    $out = [];
    foreach ($s as $r) $out[$r['signature']] = $r;
    return $out;
}

// Re-read the pending spreadsheet with a different heading row, or to
// change a saved mapping.
function handle_inspect() {
    require_method('POST');
    require_user('finance.write');
    $b = json_body();
    $p = pending((string)($b['token'] ?? ''));
    if (!in_array($p['kind'], ['csv', 'xlsx'], true)) json_response(['error' => 'Only spreadsheets have columns to map.'], 400);
    $rows = read_pending_sheet($p);
    $i = isset($b['header_row']) ? max(0, min(count($rows) - 2, (int)$b['header_row'])) : sheet_find_header($rows);
    $fmt = practice_formats()[sheet_signature($rows[$i])] ?? null;
    json_response(['token' => $p['token'], 'needsMapping' => true] + sheet_inspect($rows, $i, $fmt ? json_decode($fmt['mapping'], true) + ['name' => $fmt['name']] : null) + mapping_extras());
}

function clean_mapping(array $in, int $width): array {
    $layout = ($in['layout'] ?? '') === 'transactions' ? 'transactions' : 'lines';
    $cols = [];
    foreach (SHEET_FIELDS[$layout] as $f => $_) {
        $v = $in['columns'][$f] ?? null;
        if ($v !== null && $v !== '' && (int)$v >= 0 && (int)$v < $width) $cols[$f] = (int)$v;
    }
    $types = [];
    foreach ((array)($in['types'] ?? []) as $value => $cat) {
        if (isset(SHEET_CATEGORIES[$cat]) && count($types) < 200) $types[mb_substr((string)$value, 0, 120)] = $cat;
    }
    return ['layout' => $layout, 'columns' => $cols, 'types' => $types, 'date_order' => ($in['date_order'] ?? '') === 'dmy' ? 'dmy' : 'mdy',
        'default_payment' => in_array($in['default_payment'] ?? '', ['insurance_payment', 'patient_payment'], true) ? $in['default_payment'] : 'ignore'];
}

// Parse the pending spreadsheet with the user's column mapping, optionally
// saving it as this EHR's format, and preview.
function handle_map() {
    require_method('POST');
    $user = require_user('finance.write');
    $b = json_body();
    $p = pending((string)($b['token'] ?? ''));
    if (!in_array($p['kind'], ['csv', 'xlsx'], true)) json_response(['error' => 'Only spreadsheets have columns to map.'], 400);
    $rows = read_pending_sheet($p);
    $i = max(0, min(count($rows) - 2, (int)($b['header_row'] ?? 0)));
    $name = str_or_null($b['name'] ?? null, 80) ?? practice_ehr_name();
    $map = clean_mapping((array)($b['mapping'] ?? []), count($rows[$i]));
    try {
        $data = sheet_parse($rows, $i, $map, $name) + ['method' => 'spreadsheet'];
    } catch (RuntimeException $e) {
        json_response(['error' => $e->getMessage()], 422);
    }
    $format = null;
    if (!empty($b['save'])) {
        $sig = sheet_signature($rows[$i]);
        pi_db()->prepare('INSERT INTO ehr_formats (practice_id, name, layout, signature, mapping, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), layout = VALUES(layout), mapping = VALUES(mapping), updated_at = VALUES(updated_at)')
            ->execute([pid(), $name, $map['layout'], $sig, json_encode($map), $user['id'], now_str(), now_str()]);
        $s = pi_db()->prepare('SELECT id FROM ehr_formats WHERE practice_id = ? AND signature = ?'); $s->execute([pid(), $sig]);
        $format = ['id' => (int)$s->fetchColumn(), 'name' => $name];
        audit('update', 'ehr_format', $format['id'], null, $user, $name, [['f' => 'layout', 't' => 'enum', 'from' => null, 'to' => $map['layout']]]);
        if (!current_practice()['ehr_name']) pi_db()->prepare('UPDATE practices SET ehr_name = ? WHERE id = ?')->execute([$name, pid()]);
    }
    json_response(build_preview((int)$p['case_id'], $data, ['format' => $format, 'headerRow' => $i]));
}

// The ledger's totals typed in from the EHR (any EHR, any export).
function handle_totals() {
    require_method('POST');
    require_user('finance.write');
    $b = json_body();
    $caseId = (int)($b['case_id'] ?? 0);
    case_or_404($caseId);
    $asOf = date_or_null($b['as_of'] ?? null) ?? date('Y-m-d');
    $n = [];
    foreach (['billed', 'insurance_paid', 'patient_paid', 'adjustment', 'insurance_balance', 'patient_balance'] as $k) $n[$k] = round((float)(money_or_null($b[$k] ?? null) ?? 0), 2);
    if ($n['billed'] <= 0) json_response(['error' => 'Enter the total billed.'], 400);
    foreach (['insurance_paid', 'patient_paid', 'adjustment'] as $k) if ($n[$k] < 0) json_response(['error' => 'Enter paid and adjustment amounts as positive numbers.'], 400);
    $diff = round($n['billed'] - $n['insurance_paid'] - $n['patient_paid'] - $n['adjustment'] - $n['insurance_balance'] - $n['patient_balance'], 2);
    if (abs($diff) > 0.01) json_response(['error' => "These don't add up: billed − paid − adjustments should equal the two balances, but they're $" . number_format(abs($diff), 2) . ' apart. Check the numbers against the EHR.'], 400);
    $system = str_or_null($b['ehr_name'] ?? null, 80) ?? practice_ehr_name();
    $dos = date_or_null($b['first_dos'] ?? null) ?? $asOf;
    $line = ['cpt' => null, 'memo' => 'Ledger totals as of ' . $asOf, 'posted' => $asOf, 'moved_on' => $asOf] + $n;
    $data = ['system' => $system, 'method' => 'totals', 'verified' => true, 'patient' => ['first_name' => null, 'last_name' => null, 'dob' => null],
        'accident' => ['date' => null, 'insurer' => null, 'claim_number' => null], 'visits' => [['dos' => $dos, 'icd' => [], 'lines' => [$line]]],
        'unapplied' => [], 'warnings' => [], 'counts' => ['visits' => 0, 'lines' => 1]];
    $data['totals'] = ledger_data_totals($data);
    // Keep the pending PDF (if one was uploaded for this case) so it can be
    // saved with the totals.
    $p = $_SESSION['ehr_pending'] ?? null;
    if (!$p || (int)$p['case_id'] !== $caseId || empty($b['token']) || !hash_equals($p['token'], (string)$b['token'])) {
        if (!empty($p['token'])) @unlink(pending_dir() . '/' . $p['token']);
        $_SESSION['ehr_pending'] = ['token' => bin2hex(random_bytes(16)), 'case_id' => $caseId, 'kind' => 'none', 'sha' => str_repeat('0', 64), 'name' => null, 'data' => null, 'needs_override' => false, 'blocked' => null];
    }
    json_response(build_preview($caseId, $data));
}

// ---------- preview ----------
// Is this the right patient and case? What changes? Mismatches are shown,
// not blocked — a nickname or a typo in either system is common — but a
// name AND date of birth mismatch needs an explicit override.
function build_preview(int $caseId, array $data, array $extra = []): array {
    $c = case_or_404($caseId);
    $pdo = pi_db();
    $p = $pdo->prepare('SELECT * FROM patients WHERE id = ?'); $p->execute([$c['patient_id']]); $patient = $p->fetch();
    $cov = $pdo->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id'); $cov->execute([$caseId]); $coverages = $cov->fetchAll();
    $pip = first_coverage($coverages, 'pip');
    $caseName = trim($patient['first_name'] . ' ' . $patient['last_name']);
    $checks = [];
    $L = $data['patient'];
    $nameOk = null;
    if (!empty($L['last_name'])) {
        $nameOk = norm_name($L['last_name']) === norm_name($patient['last_name']) && strtolower(substr(norm_name($L['first_name']), 0, 1)) === strtolower(substr(norm_name($patient['first_name']), 0, 1));
        $checks[] = ['label' => 'Patient name', 'status' => $nameOk ? 'ok' : 'mismatch', 'detail' => $nameOk ? 'Matches' : 'Ledger: ' . trim($L['first_name'] . ' ' . $L['last_name']) . ' · case: ' . $caseName];
    } elseif (!empty($L['full_name'])) {
        $words = array_map('norm_name', preg_split('/[\s,]+/', $L['full_name']));
        $initial = strtolower(substr(norm_name($patient['first_name']), 0, 1));
        $nameOk = in_array(norm_name($patient['last_name']), $words, true) && (bool)array_filter($words, fn($w) => $w !== '' && $w[0] === $initial);
        $checks[] = ['label' => 'Patient name', 'status' => $nameOk ? 'ok' : 'mismatch', 'detail' => $nameOk ? 'Matches' : 'File: ' . $L['full_name'] . ' · case: ' . $caseName];
    } elseif ($data['method'] !== 'totals') {
        $checks[] = ['label' => 'Patient name', 'status' => 'missing', 'detail' => "The file doesn't show the patient's name — make sure it's $caseName's ledger"];
    }
    $caseDob = dec($patient['dob_enc']);
    $dobStatus = null;
    if (!empty($L['dob'])) {
        $dobStatus = !$caseDob ? 'fill' : ($caseDob === $L['dob'] ? 'ok' : 'mismatch');
        $checks[] = ['label' => 'Date of birth', 'status' => $dobStatus, 'detail' => $dobStatus === 'fill' ? 'Not on the case yet — will be filled in from the ledger' : ($dobStatus === 'ok' ? 'Matches' : 'Ledger: ' . $L['dob'] . ' · case: ' . $caseDob)];
    }
    $doa = $data['accident']['date'];
    if ($doa) $checks[] = ['label' => 'Date of injury', 'status' => !$c['date_of_injury'] ? 'fill' : ($c['date_of_injury'] === $doa ? 'ok' : 'mismatch'),
        'detail' => !$c['date_of_injury'] ? 'Will be set to ' . $doa : ($c['date_of_injury'] === $doa ? 'Matches' : 'Ledger: ' . $doa . ' · case: ' . $c['date_of_injury'])];
    $claim = $data['accident']['claim_number'];
    if ($claim) {
        $have = $pip ? dec($pip['claim_number_enc']) : null;
        $checks[] = ['label' => 'PIP claim #', 'status' => !$pip ? 'fill' : (!$have ? 'fill' : ($have === $claim ? 'ok' : 'mismatch')),
            'detail' => !$pip ? 'A PIP coverage (' . ($data['accident']['insurer'] ?: 'auto insurer') . ') will be added with this claim #' : (!$have ? 'Will be added to the PIP coverage' : ($have === $claim ? 'Matches' : 'Different claim # on the case'))];
    }
    $t = $data['totals'];
    // Insurance amounts need an insurance coverage on the case to belong to.
    $blocked = null;
    if (!$coverages && !$claim && ($t['insurance_paid'] > 0 || abs($t['insurance_balance']) > 0.005)) {
        $blocked = 'This ledger has insurance payments or an insurance balance, but the case has no insurance coverage. Add the coverage on the Financials tab, then upload again.';
        $checks[] = ['label' => 'Insurance', 'status' => 'mismatch', 'detail' => 'No insurance coverage on the case'];
    }
    $w = $data['warnings'] ?? [];
    if (!empty($w['skipped'])) $checks[] = ['label' => 'Rows skipped', 'status' => 'info', 'detail' => $w['skipped'] . ' row(s) without a date (totals, headings) were skipped'];
    if (!empty($w['ignored'])) $checks[] = ['label' => 'Transactions ignored', 'status' => 'info', 'detail' => $w['ignored'] . ' transaction(s) are set to “Ignore” — change the mapping if any are payments'];
    if (!empty($w['unapplied'])) $checks[] = ['label' => 'Case-level entries', 'status' => 'info', 'detail' => $w['unapplied'] . " payment(s)/adjustment(s) couldn't be matched to a date of service and will be recorded on the case as a whole"];
    $hardMismatch = $nameOk === false && $dobStatus === 'mismatch';

    $s = $pdo->prepare('SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL'); $s->execute([$caseId]);
    $rows = $s->fetchAll();
    $current = ledger_totals($rows);
    $manualRows = count(array_filter($rows, fn($r) => $r['source'] === 'manual'));
    $v = $pdo->prepare('SELECT visit_date FROM visits WHERE case_id = ? AND archived_at IS NULL'); $v->execute([$caseId]);
    $haveDates = array_flip($v->fetchAll(PDO::FETCH_COLUMN));
    $newVisits = $data['method'] === 'totals' ? 0 : count(array_filter($data['visits'], fn($x) => !isset($haveDates[$x['dos']])));

    $_SESSION['ehr_pending']['data'] = enc(json_encode($data));
    $_SESSION['ehr_pending']['needs_override'] = $hardMismatch;
    $_SESSION['ehr_pending']['blocked'] = $blocked;
    $kind = $_SESSION['ehr_pending']['kind'];
    return [
        'token' => $_SESSION['ehr_pending']['token'], 'system' => $data['system'], 'method' => $data['method'], 'verified' => !empty($data['verified']),
        'checks' => $checks, 'needsOverride' => $hardMismatch, 'blocked' => $blocked, 'patientName' => $caseName,
        'ledger' => ['billed' => $t['billed'], 'insurancePaid' => $t['insurance_paid'], 'patientPaid' => $t['patient_paid'], 'adjustment' => $t['adjustment'],
                     'insuranceBalance' => $t['insurance_balance'], 'patientBalance' => $t['patient_balance']],
        'current' => ['charges' => $current['total_charges'], 'insuranceBalance' => $current['insurance_balance'], 'patientBalance' => $current['patient_balance']],
        'counts' => $data['counts'] + ['newVisits' => $newVisits, 'manualRows' => $manualRows],
        'firstDos' => $data['visits'][0]['dos'] ?? null, 'lastDos' => end($data['visits'])['dos'] ?? null,
        'hasFile' => in_array($kind, ['pdf', 'csv', 'xlsx'], true), 'fileKind' => $kind,
    ] + $extra;
}

// ---------- apply ----------
function handle_apply() {
    require_method('POST');
    $user = require_user('finance.write');
    $b = json_body();
    $pending = pending((string)($b['token'] ?? ''));
    if (empty($pending['data'])) json_response(['error' => 'Finish the preview first.'], 409);
    $caseId = (int)$pending['case_id'];
    $c = case_or_404($caseId);
    if (!empty($pending['blocked'])) json_response(['error' => $pending['blocked']], 409);
    if (!empty($pending['needs_override']) && empty($b['confirm_mismatch'])) json_response(['error' => "The ledger's name and date of birth don't match this case. Confirm it's the right patient to continue."], 409);
    $data = json_decode(dec($pending['data']), true);
    // A spreadsheet can't check itself the way a ledger with printed totals
    // can, so a person confirms the totals match the EHR.
    if (empty($data['verified']) && empty($b['confirm_totals'])) json_response(['error' => 'Check the totals against the EHR and tick the box to confirm.'], 409);
    $isTotals = $data['method'] === 'totals';
    $pdo = pi_db();
    $now = now_str();
    $pdo->beginTransaction();
    $s = $pdo->prepare('SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL'); $s->execute([$caseId]);
    $before = ledger_totals($s->fetchAll());

    $p = $pdo->prepare('SELECT * FROM patients WHERE id = ?'); $p->execute([$c['patient_id']]); $patient = $p->fetch();
    if (!$patient['dob_enc'] && !empty($data['patient']['dob'])) $pdo->prepare('UPDATE patients SET dob_enc = ?, updated_at = ? WHERE id = ?')->execute([enc($data['patient']['dob']), $now, $patient['id']]);
    if (!$c['date_of_injury'] && $data['accident']['date']) $pdo->prepare('UPDATE cases SET date_of_injury = ? WHERE id = ?')->execute([$data['accident']['date'], $caseId]);

    // Which coverage the insurance side of the ledger belongs to.
    $cov = $pdo->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id'); $cov->execute([$caseId]); $coverages = $cov->fetchAll();
    $target = first_coverage($coverages, $c['injury_type'] === 'workers_comp' ? 'workers_comp' : 'pip') ?: (active_coverages($coverages)[0] ?? ($coverages[0] ?? null));
    $claim = $data['accident']['claim_number'];
    if (!$target && ($claim || $data['accident']['insurer'])) {
        $pdo->prepare("INSERT INTO coverages (case_id, type, priority, carrier_text, claim_number_enc, status, benefit_limit, created_by, created_at, updated_at) VALUES (?, 'pip', 1, ?, ?, 'active', ?, ?, ?, ?)")
            ->execute([$caseId, $data['accident']['insurer'], enc($claim), case_rules($c)['pip_medical'], $user['id'], $now, $now]);
        $target = ['id' => (int)$pdo->lastInsertId(), 'type' => 'pip'];
    } elseif ($target && $target['type'] === 'pip') {
        if ($claim && !$target['claim_number_enc']) $pdo->prepare('UPDATE coverages SET claim_number_enc = ?, updated_at = ? WHERE id = ?')->execute([enc($claim), $now, $target['id']]);
        if ($data['accident']['insurer'] && !$target['carrier_contact_id'] && !$target['carrier_text']) $pdo->prepare('UPDATE coverages SET carrier_text = ?, updated_at = ? WHERE id = ?')->execute([$data['accident']['insurer'], $now, $target['id']]);
    }
    $covId = $target ? (int)$target['id'] : null;

    // Optionally keep the uploaded file on the case (an EHR export often
    // includes demographics such as SSN, so it's off by default).
    $docId = null;
    $pendingFile = pending_dir() . '/' . $pending['token'];
    if ((!empty($b['save_file']) || !empty($b['save_pdf'])) && is_file($pendingFile)) {
        $plain = dec_file(file_get_contents($pendingFile));
        $mime = ['pdf' => 'application/pdf', 'csv' => 'text/csv', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'][$pending['kind']] ?? 'application/octet-stream';
        $storage = bin2hex(random_bytes(32));
        file_put_contents(PI_STORAGE_DIR . '/' . $storage, enc_file($plain), LOCK_EX);
        $pdo->prepare("INSERT INTO documents (case_id, category, original_name, mime_type, size_bytes, storage_name, sha256, uploaded_by, uploaded_at) VALUES (?, 'billing', ?, ?, ?, ?, ?, ?, ?)")
            ->execute([$caseId, mb_substr($pending['name'] ?: 'EHR ledger', 0, 255), $mime, strlen($plain), $storage, hash('sha256', $plain), $user['id'], $now]);
        $docId = (int)$pdo->lastInsertId();
    }
    $t = $data['totals'];
    $pdo->prepare('INSERT INTO ehr_imports (case_id, ehr_system, method, file_sha256, summary_enc, document_id, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$caseId, mb_substr($data['system'], 0, 80), $data['method'], $pending['sha'], enc(json_encode(['totals' => $t, 'counts' => $data['counts']])), $docId, $user['id'], $now]);
    $importId = (int)$pdo->lastInsertId();

    // Replace the previous EHR lines (and, on the first sync, any manual
    // entries the user chose to retire, e.g. opening balances from a sheet).
    $pdo->prepare("UPDATE ledger SET archived_at = ? WHERE case_id = ? AND archived_at IS NULL AND source = 'ehr'")->execute([$now, $caseId]);
    if (!empty($b['replace_manual'])) $pdo->prepare("UPDATE ledger SET archived_at = ? WHERE case_id = ? AND archived_at IS NULL AND source = 'manual'")->execute([$now, $caseId]);

    $v = $pdo->prepare('SELECT id, visit_date, source FROM visits WHERE case_id = ? AND archived_at IS NULL'); $v->execute([$caseId]);
    $visitsByDate = [];
    foreach ($v->fetchAll() as $row) $visitsByDate[$row['visit_date']] = $row;
    $isFirstVisit = !$visitsByDate;
    $ins = $pdo->prepare("INSERT INTO ledger (case_id, entry_date, kind, bucket, coverage_id, to_bucket, to_coverage_id, applies_to_id, visit_id, amount, reference, memo, source, ehr_import_id, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'ehr', ?, ?, ?)");
    $ref = mb_substr($data['system'], 0, 120);
    $add = function ($date, $kind, $bucket, $cov, $toBucket, $toCov, $appliesTo, $visitId, $amount, $memo) use ($ins, $caseId, $ref, $importId, $user, $now) {
        $ins->execute([$caseId, $date, $kind, $bucket, $cov, $toBucket, $toCov, $appliesTo, $visitId, round($amount, 2), $ref, $memo, $importId, $user['id'], $now]);
        return (int)pi_db()->lastInsertId();
    };
    $insBucket = $covId ? 'insurance' : 'patient';
    // A line's payments, adjustments and moves to patient responsibility, for
    // spreadsheet transactions (each keeps its own date). A reversal
    // (negative amount) nets against its kind.
    $postEvents = function (array $events, ?int $chargeId, ?int $visitId) use ($add, $covId, $insBucket, $pdo) {
        $byKind = [];
        foreach ($events as $e) $byKind[$e['kind']][] = $e;
        $posted = ['transfer' => 0.0, 'patient_payment' => 0.0];
        $lastPatientPay = null;
        foreach (['insurance_payment', 'adjustment', 'transfer', 'patient_payment'] as $kind) {
            $list = $byKind[$kind] ?? [];
            if (!$list) continue;
            $net = round(array_sum(array_column($list, 'amount')), 2);
            if ($net < -0.005) { $pdo->rollBack(); json_response(['error' => 'A line in this ledger has more reversed than posted (' . str_replace('_', ' ', $kind) . '). Check the column mapping, or the account in the EHR.'], 422); }
            if (min(array_column($list, 'amount')) < 0) $list = [['amount' => $net, 'date' => max(array_column($list, 'date'))]];
            foreach ($list as $e) {
                if ($e['amount'] < 0.005) continue;
                if ($kind === 'insurance_payment') $add($e['date'], 'payment', 'insurance', $covId, null, null, $chargeId, $visitId, $e['amount'], 'Insurance payment');
                elseif ($kind === 'adjustment') $add($e['date'], 'adjustment', $insBucket, $covId, null, null, $chargeId, $visitId, $e['amount'], 'Adjustment');
                elseif ($kind === 'transfer') { if ($covId) $add($e['date'], 'transfer', 'insurance', $covId, 'patient', null, $chargeId, $visitId, $e['amount'], 'Transferred to patient responsibility'); }
                else { $add($e['date'], 'payment', 'patient', null, null, null, $chargeId, $visitId, $e['amount'], 'Patient payment'); $lastPatientPay = max((string)$lastPatientPay, $e['date']); }
                if (isset($posted[$kind])) $posted[$kind] += $e['amount'];
            }
        }
        // What the patient paid was patient responsibility even if the EHR
        // never recorded the move.
        $gap = round($posted['patient_payment'] - $posted['transfer'], 2);
        if ($covId && $gap > 0.005) $add($lastPatientPay, 'transfer', 'insurance', $covId, 'patient', null, $chargeId, $visitId, $gap, 'Transferred to patient responsibility');
    };

    $createdVisits = 0;
    $lineAdjustments = 0.0;
    foreach ($data['visits'] as $i => $visit) {
        $visitId = $isTotals ? null : ($visitsByDate[$visit['dos']]['id'] ?? null);
        $cpts = implode(', ', array_filter(array_unique(array_column($visit['lines'], 'cpt'))));
        $icds = implode(', ', $visit['icd']);
        if (!$isTotals && !$visitId && !empty($b['create_visits'])) {
            $pdo->prepare("INSERT INTO visits (case_id, visit_date, visit_type, cpt_codes, icd_codes, source, created_by, created_at) VALUES (?,?,?,?,?, 'ehr', ?, ?)")
                ->execute([$caseId, $visit['dos'], $isFirstVisit && $i === 0 ? 'initial' : 'treatment', $cpts !== '' ? mb_substr($cpts, 0, 255) : null, $icds !== '' ? mb_substr($icds, 0, 500) : null, $user['id'], $now]);
            $visitId = (int)$pdo->lastInsertId();
            $createdVisits++;
        } elseif ($visitId) {
            $pdo->prepare('UPDATE visits SET icd_codes = COALESCE(icd_codes, ?), cpt_codes = COALESCE(cpt_codes, ?) WHERE id = ?')->execute([$icds !== '' ? mb_substr($icds, 0, 500) : null, $cpts !== '' ? mb_substr($cpts, 0, 255) : null, $visitId]);
        }
        foreach ($visit['lines'] as $l) {
            if ($l['billed'] < 0) { $pdo->rollBack(); json_response(['error' => 'A charge on ' . $visit['dos'] . ' is negative after reversals. Check the column mapping, or the account in the EHR.'], 422); }
            $memo = $l['memo'] ?? ($l['cpt'] ? 'CPT ' . $l['cpt'] : 'Charge');
            $chargeId = $l['billed'] > 0 ? $add($visit['dos'], 'charge', $insBucket, $covId, null, null, null, $visitId, $l['billed'], $memo) : null;
            if (!empty($l['events'])) { $postEvents($l['events'], $chargeId, $visitId); $lineAdjustments += $l['adjustment'] ?? 0; continue; }
            $when = $l['moved_on'] ?: $l['posted'] ?: $visit['dos'];
            if ($l['insurance_paid'] > 0) $add($l['posted'] ?: $visit['dos'], 'payment', 'insurance', $covId, null, null, $chargeId, $visitId, $l['insurance_paid'], 'Insurance payment');
            if (($l['adjustment'] ?? 0) > 0) { $add($l['posted'] ?: $visit['dos'], 'adjustment', $insBucket, $covId, null, null, $chargeId, $visitId, $l['adjustment'], 'Adjustment'); $lineAdjustments += $l['adjustment']; }
            $toPatient = round($l['patient_balance'] + $l['patient_paid'], 2);
            if ($covId && $toPatient > 0) $add($when, 'transfer', 'insurance', $covId, 'patient', null, $chargeId, $visitId, $toPatient, 'Transferred to patient responsibility');
            if ($l['patient_paid'] > 0) $add($when, 'payment', 'patient', null, null, null, $chargeId, $visitId, $l['patient_paid'], 'Patient payment');
        }
    }
    if (!empty($data['unapplied'])) $postEvents($data['unapplied'], null, null);
    // Ledgers that report adjustments only as a total (DrChrono).
    $unappliedAdj = array_sum(array_map(fn($e) => $e['kind'] === 'adjustment' ? $e['amount'] : 0, $data['unapplied'] ?? []));
    $restAdj = round($t['adjustment'] - $lineAdjustments - $unappliedAdj, 2);
    if ($restAdj > 0.005) $add(date('Y-m-d'), 'adjustment', $insBucket, $covId, null, null, null, null, $restAdj, 'Adjustments (ledger total)');

    // The mirror must match the EHR to the cent, or nothing is kept. (With
    // no insurance on the case everything is the patient's.)
    $s = $pdo->prepare("SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL AND source = 'ehr'"); $s->execute([$caseId]);
    $mirror = ledger_totals($s->fetchAll());
    $wantPatient = $covId ? $t['patient_balance'] : round($t['patient_balance'] + $t['insurance_balance'], 2);
    $wantIns = $covId ? $t['insurance_balance'] : 0.0;
    if (abs($mirror['patient_balance'] - $wantPatient) > 0.01 || abs($mirror['insurance_balance'] - $wantIns) > 0.01) {
        $pdo->rollBack();
        pi_log_error('EHR import totals mismatch case=' . $caseId . ' method=' . $data['method']);
        json_response(['error' => "The imported lines didn't reproduce the ledger's balances, so nothing was changed. Check the column mapping, or send this export to support."], 422);
    }
    $pdo->prepare('UPDATE cases SET ehr_system = ?, ehr_synced_at = ?, updated_at = ? WHERE id = ?')->execute([mb_substr($data['system'], 0, 80), $now, $now, $caseId]);
    sync_benefits_after_import($caseId);
    $pdo->commit();
    @unlink($pendingFile);
    unset($_SESSION['ehr_pending']);
    audit('ehr_import', 'case', $caseId, $caseId, $user, $data['system'] . ' · ' . $data['method'] . ' · ' . $data['counts']['lines'] . ' line(s)' . ($createdVisits ? " · $createdVisits visit(s) added" : '') . (!empty($b['replace_manual']) ? ' · manual entries retired' : ''), array_filter([
        ['f' => 'insurance_balance', 't' => 'money', 'from' => round($before['insurance_balance'], 2), 'to' => round($mirror['insurance_balance'], 2)],
        ['f' => 'patient_balance', 't' => 'money', 'from' => round($before['patient_balance'], 2), 'to' => round($mirror['patient_balance'], 2)],
    ], fn($c) => $c['from'] !== $c['to']));
    json_response(['ok' => true, 'visitsCreated' => $createdVisits]);
}

function sync_benefits_after_import(int $caseId) {
    $c = case_or_404($caseId);
    $s = pi_db()->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id');
    $s->execute([$caseId]);
    pi_db()->prepare('UPDATE cases SET benefits = ? WHERE id = ?')->execute([derive_benefits($s->fetchAll(), $c['injury_type']), $caseId]);
}

// ---------- saved formats ----------
function handle_formats() {
    require_user('finance.write');
    $s = pi_db()->prepare('SELECT f.id, f.name, f.layout, f.updated_at, u.name created_by_name FROM ehr_formats f LEFT JOIN users u ON u.id = f.created_by WHERE f.practice_id = ? ORDER BY f.name');
    $s->execute([pid()]);
    json_response(['formats' => $s->fetchAll(), 'ehrs' => COMMON_EHRS]);
}

function handle_format_delete() {
    require_method('POST');
    $user = require_user('finance.write');
    $id = (int)(json_body()['id'] ?? 0);
    $s = pi_db()->prepare('SELECT name FROM ehr_formats WHERE id = ? AND practice_id = ?'); $s->execute([$id, pid()]);
    $name = $s->fetchColumn();
    if ($name === false) json_response(['error' => 'Not found'], 404);
    pi_db()->prepare('DELETE FROM ehr_formats WHERE id = ? AND practice_id = ?')->execute([$id, pid()]);
    audit('archive', 'ehr_format', $id, null, $user, $name);
    json_response(['ok' => true]);
}

// Dispatch last, once the constants above are defined.
$action = $_GET['action'] ?? '';
switch ($action) {
    case 'preview': handle_preview(); break;
    case 'inspect': handle_inspect(); break;
    case 'map': handle_map(); break;
    case 'totals': handle_totals(); break;
    case 'apply': handle_apply(); break;
    case 'formats': handle_formats(); break;
    case 'format_delete': handle_format_delete(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
