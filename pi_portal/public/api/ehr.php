<?php
// EHR ledger upload. The practice's EHR is the source of truth for money;
// this platform mirrors it. A ledger export is uploaded to a case,
// previewed (with checks that it's the right patient), then applied: the
// case's EHR-sourced ledger lines are replaced by the new upload, so
// re-uploading is always safe and a newer export simply updates the numbers.
//
// Supported: DrChrono "Billing Ledger" PDF. Other EHRs plug in alongside
// app/ehr/drchrono_ledger.php.
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/ehr/drchrono_ledger.php';
pi_start_session();

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'preview': handle_preview(); break;
    case 'apply': handle_apply(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function pending_dir(): string {
    $d = dirname(PI_STORAGE_DIR) . '/pending';
    if (!is_dir($d)) mkdir($d, 0700, true);
    return $d;
}

function norm_name(?string $s): string { return strtolower(preg_replace('/[^a-z]/i', '', (string)$s)); }

function handle_preview() {
    require_method('POST');
    $user = require_user('finance.write');
    $caseId = (int)($_POST['case_id'] ?? 0);
    $c = case_or_404($caseId);
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Upload failed — the file may be too large.'], 400);
    if ($f['size'] > PI_MAX_UPLOAD_BYTES) json_response(['error' => 'Files must be 25 MB or smaller.'], 400);
    if ((new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) !== 'application/pdf') json_response(['error' => 'Upload the ledger as a PDF exported from your EHR.'], 400);
    try {
        $data = drchrono_parse_ledger(drchrono_pdf_text($f['tmp_name']));
    } catch (RuntimeException $e) {
        json_response(['error' => $e->getMessage()], 422);
    }
    $pdo = pi_db();
    $p = $pdo->prepare('SELECT * FROM patients WHERE id = ?'); $p->execute([$c['patient_id']]); $patient = $p->fetch();
    $cov = $pdo->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id'); $cov->execute([$caseId]); $coverages = $cov->fetchAll();
    $pip = first_coverage($coverages, 'pip');

    // Is this the right patient and case? Mismatches are shown, not blocked —
    // a nickname or a typo in either system is common — but a name AND date
    // of birth mismatch needs an explicit override.
    $checks = [];
    $L = $data['patient'];
    $nameOk = norm_name($L['last_name']) === norm_name($patient['last_name']) && strtolower(substr(norm_name($L['first_name']), 0, 1)) === strtolower(substr(norm_name($patient['first_name']), 0, 1));
    $checks[] = ['label' => 'Patient name', 'status' => $nameOk ? 'ok' : 'mismatch', 'detail' => $nameOk ? 'Matches' : 'Ledger: ' . trim($L['first_name'] . ' ' . $L['last_name']) . ' · case: ' . trim($patient['first_name'] . ' ' . $patient['last_name'])];
    $caseDob = dec($patient['dob_enc']);
    $dobStatus = !$caseDob ? 'fill' : ($caseDob === $L['dob'] ? 'ok' : 'mismatch');
    $checks[] = ['label' => 'Date of birth', 'status' => $L['dob'] ? $dobStatus : 'missing', 'detail' => $dobStatus === 'fill' ? 'Not on the case yet — will be filled in from the ledger' : ($dobStatus === 'ok' ? 'Matches' : 'Ledger: ' . $L['dob'] . ' · case: ' . $caseDob)];
    $doa = $data['accident']['date'];
    if ($doa) $checks[] = ['label' => 'Date of injury', 'status' => !$c['date_of_injury'] ? 'fill' : ($c['date_of_injury'] === $doa ? 'ok' : 'mismatch'),
        'detail' => !$c['date_of_injury'] ? 'Will be set to ' . $doa : ($c['date_of_injury'] === $doa ? 'Matches' : 'Ledger: ' . $doa . ' · case: ' . $c['date_of_injury'])];
    $claim = $data['accident']['claim_number'];
    if ($claim) {
        $have = $pip ? dec($pip['claim_number_enc']) : null;
        $checks[] = ['label' => 'PIP claim #', 'status' => !$pip ? 'fill' : (!$have ? 'fill' : ($have === $claim ? 'ok' : 'mismatch')),
            'detail' => !$pip ? 'A PIP coverage (' . ($data['accident']['insurer'] ?: 'auto insurer') . ') will be added with this claim #' : (!$have ? 'Will be added to the PIP coverage' : ($have === $claim ? 'Matches' : 'Different claim # on the case'))];
    }
    $hardMismatch = !$nameOk && $dobStatus === 'mismatch';

    // What changes.
    $s = $pdo->prepare('SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL'); $s->execute([$caseId]);
    $rows = $s->fetchAll();
    $current = ledger_totals($rows);
    $manualRows = count(array_filter($rows, fn($r) => $r['source'] === 'manual'));
    $v = $pdo->prepare("SELECT visit_date FROM visits WHERE case_id = ? AND archived_at IS NULL"); $v->execute([$caseId]);
    $haveDates = array_flip($v->fetchAll(PDO::FETCH_COLUMN));
    $newVisits = count(array_filter($data['visits'], fn($x) => !isset($haveDates[$x['dos']])));

    // Only one pending upload per session.
    if (!empty($_SESSION['ehr_pending']['token'])) @unlink(pending_dir() . '/' . $_SESSION['ehr_pending']['token']);
    // Hold the parsed ledger (encrypted, in the session) and the file
    // (encrypted, outside the web root) until the user applies or abandons.
    $token = bin2hex(random_bytes(16));
    file_put_contents(pending_dir() . '/' . $token, enc_file(file_get_contents($f['tmp_name'])), LOCK_EX);
    $_SESSION['ehr_pending'] = ['token' => $token, 'case_id' => $caseId, 'data' => enc(json_encode($data)), 'sha' => hash_file('sha256', $f['tmp_name']), 'name' => basename((string)$f['name']), 'needs_override' => $hardMismatch];
    audit('ehr_preview', 'case', $caseId, $caseId, $user, $data['system']);
    $t = $data['totals'];
    json_response([
        'token' => $token, 'system' => $data['system'], 'checks' => $checks, 'needsOverride' => $hardMismatch,
        'ledger' => ['billed' => $t['billed'], 'insurancePaid' => $t['insurance_paid'], 'patientPaid' => $t['patient_paid'], 'adjustment' => $t['adjustment'],
                     'insuranceBalance' => $t['insurance_balance'], 'patientBalance' => $t['patient_balance']],
        'current' => ['charges' => $current['total_charges'], 'insuranceBalance' => $current['insurance_balance'], 'patientBalance' => $current['patient_balance']],
        'counts' => $data['counts'] + ['newVisits' => $newVisits, 'manualRows' => $manualRows],
        'firstDos' => $data['visits'][0]['dos'] ?? null, 'lastDos' => end($data['visits'])['dos'] ?? null,
    ]);
}

function handle_apply() {
    require_method('POST');
    $user = require_user('finance.write');
    $b = json_body();
    $pending = $_SESSION['ehr_pending'] ?? null;
    if (!$pending || !hash_equals($pending['token'], (string)($b['token'] ?? ''))) json_response(['error' => 'This preview has expired — upload the ledger again.'], 409);
    $caseId = (int)$pending['case_id'];
    $c = case_or_404($caseId);
    if (!empty($pending['needs_override']) && empty($b['confirm_mismatch'])) json_response(['error' => "The ledger's name and date of birth don't match this case. Confirm it's the right patient to continue."], 409);
    $data = json_decode(dec($pending['data']), true);
    $pdo = pi_db();
    $now = now_str();
    $pdo->beginTransaction();

    $p = $pdo->prepare('SELECT * FROM patients WHERE id = ?'); $p->execute([$c['patient_id']]); $patient = $p->fetch();
    if (!$patient['dob_enc'] && $data['patient']['dob']) $pdo->prepare('UPDATE patients SET dob_enc = ?, updated_at = ? WHERE id = ?')->execute([enc($data['patient']['dob']), $now, $patient['id']]);
    if (!$c['date_of_injury'] && $data['accident']['date']) $pdo->prepare('UPDATE cases SET date_of_injury = ? WHERE id = ?')->execute([$data['accident']['date'], $caseId]);

    // Which coverage the insurance side of the ledger belongs to.
    $cov = $pdo->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id'); $cov->execute([$caseId]); $coverages = $cov->fetchAll();
    $target = first_coverage($coverages, $c['injury_type'] === 'workers_comp' ? 'workers_comp' : 'pip') ?: (active_coverages($coverages)[0] ?? null);
    $claim = $data['accident']['claim_number'];
    if (!$target && ($claim || $data['accident']['insurer'])) {
        $pdo->prepare("INSERT INTO coverages (case_id, type, priority, carrier_text, claim_number_enc, status, benefit_limit, created_by, created_at, updated_at) VALUES (?, 'pip', 1, ?, ?, 'active', ?, ?, ?, ?)")
            ->execute([$caseId, $data['accident']['insurer'], enc($claim), PIP_DEFAULT_LIMIT, $user['id'], $now, $now]);
        $target = ['id' => (int)$pdo->lastInsertId(), 'claim_number_enc' => enc($claim)];
    } elseif ($target && $target['type'] === 'pip') {
        if ($claim && !$target['claim_number_enc']) $pdo->prepare('UPDATE coverages SET claim_number_enc = ?, updated_at = ? WHERE id = ?')->execute([enc($claim), $now, $target['id']]);
        if ($data['accident']['insurer'] && !$target['carrier_contact_id'] && !$target['carrier_text']) $pdo->prepare('UPDATE coverages SET carrier_text = ?, updated_at = ? WHERE id = ?')->execute([$data['accident']['insurer'], $now, $target['id']]);
    }
    $covId = $target ? (int)$target['id'] : null;

    // Optionally keep the PDF on the case (it includes demographics, e.g.
    // SSN, so it's off by default).
    $docId = null;
    $pendingFile = pending_dir() . '/' . $pending['token'];
    if (!empty($b['save_pdf']) && is_file($pendingFile)) {
        $plain = dec_file(file_get_contents($pendingFile));
        $storage = bin2hex(random_bytes(32));
        file_put_contents(PI_STORAGE_DIR . '/' . $storage, enc_file($plain), LOCK_EX);
        $pdo->prepare("INSERT INTO documents (case_id, category, original_name, mime_type, size_bytes, storage_name, sha256, uploaded_by, uploaded_at) VALUES (?, 'billing', ?, 'application/pdf', ?, ?, ?, ?, ?)")
            ->execute([$caseId, mb_substr($pending['name'] ?: 'EHR ledger.pdf', 0, 255), strlen($plain), $storage, hash('sha256', $plain), $user['id'], $now]);
        $docId = (int)$pdo->lastInsertId();
    }
    $t = $data['totals'];
    $pdo->prepare('INSERT INTO ehr_imports (case_id, ehr_system, file_sha256, summary_enc, document_id, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?)')
        ->execute([$caseId, $data['system'], $pending['sha'], enc(json_encode(['totals' => $t, 'counts' => $data['counts']])), $docId, $user['id'], $now]);
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
    $add = function ($date, $kind, $bucket, $cov, $toBucket, $toCov, $appliesTo, $visitId, $amount, $memo) use ($ins, $caseId, $data, $importId, $user, $now) {
        $ins->execute([$caseId, $date, $kind, $bucket, $cov, $toBucket, $toCov, $appliesTo, $visitId, $amount, $data['system'], $memo, $importId, $user['id'], $now]);
        return (int)pi_db()->lastInsertId();
    };
    $createdVisits = 0;
    foreach ($data['visits'] as $i => $visit) {
        $visitId = $visitsByDate[$visit['dos']]['id'] ?? null;
        $cpts = implode(', ', array_unique(array_column($visit['lines'], 'cpt')));
        if (!$visitId && !empty($b['create_visits'])) {
            $pdo->prepare("INSERT INTO visits (case_id, visit_date, visit_type, cpt_codes, icd_codes, source, created_by, created_at) VALUES (?,?,?,?,?, 'ehr', ?, ?)")
                ->execute([$caseId, $visit['dos'], $isFirstVisit && $i === 0 ? 'initial' : 'treatment', mb_substr($cpts, 0, 255), mb_substr(implode(', ', $visit['icd']), 0, 500), $user['id'], $now]);
            $visitId = (int)$pdo->lastInsertId();
            $createdVisits++;
        } elseif ($visitId) {
            $pdo->prepare('UPDATE visits SET icd_codes = COALESCE(icd_codes, ?), cpt_codes = COALESCE(cpt_codes, ?) WHERE id = ?')->execute([mb_substr(implode(', ', $visit['icd']), 0, 500), mb_substr($cpts, 0, 255), $visitId]);
        }
        foreach ($visit['lines'] as $l) {
            $bucket = $covId ? 'insurance' : 'patient';
            $chargeId = $add($visit['dos'], 'charge', $bucket, $covId, null, null, null, $visitId, $l['billed'], 'CPT ' . $l['cpt']);
            $when = $l['moved_on'] ?: $l['posted'] ?: $visit['dos'];
            if ($l['insurance_paid'] > 0) $add($l['posted'] ?: $visit['dos'], 'payment', 'insurance', $covId, null, null, $chargeId, $visitId, $l['insurance_paid'], 'Insurance payment');
            $toPatient = round($l['patient_balance'] + $l['patient_paid'], 2);
            if ($bucket === 'insurance' && $toPatient > 0) $add($when, 'transfer', 'insurance', $covId, 'patient', null, $chargeId, $visitId, $toPatient, 'Transferred to patient responsibility');
            if ($l['patient_paid'] > 0) $add($when, 'payment', 'patient', null, null, null, $chargeId, $visitId, $l['patient_paid'], 'Patient payment');
        }
    }
    if ($t['adjustment'] > 0) $add(date('Y-m-d'), 'adjustment', $covId ? 'insurance' : 'patient', $covId, null, null, null, null, $t['adjustment'], 'Adjustments (ledger total)');

    // The mirror must match the EHR to the cent, or nothing is kept.
    $s = $pdo->prepare("SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL AND source = 'ehr'"); $s->execute([$caseId]);
    $mirror = ledger_totals($s->fetchAll());
    if (abs($mirror['patient_balance'] - $t['patient_balance']) > 0.01 || abs($mirror['insurance_balance'] - $t['insurance_balance']) > 0.01) {
        $pdo->rollBack();
        pi_log_error('EHR import totals mismatch case=' . $caseId);
        json_response(['error' => "The imported lines didn't reproduce the ledger's balances, so nothing was changed. Send this export to support."], 422);
    }
    $pdo->prepare('UPDATE cases SET ehr_system = ?, ehr_synced_at = ?, updated_at = ? WHERE id = ?')->execute([$data['system'], $now, $now, $caseId]);
    sync_benefits_after_import($caseId);
    $pdo->commit();
    @unlink($pendingFile);
    unset($_SESSION['ehr_pending']);
    audit('ehr_import', 'case', $caseId, $caseId, $user, json_encode(['system' => $data['system'], 'lines' => $data['counts']['lines'], 'visits_created' => $createdVisits, 'replaced_manual' => !empty($b['replace_manual'])]));
    json_response(['ok' => true, 'visitsCreated' => $createdVisits]);
}

function sync_benefits_after_import(int $caseId) {
    $c = case_or_404($caseId);
    $s = pi_db()->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id');
    $s->execute([$caseId]);
    pi_db()->prepare('UPDATE cases SET benefits = ? WHERE id = ?')->execute([derive_benefits($s->fetchAll(), $c['injury_type']), $caseId]);
}
