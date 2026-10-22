<?php
// Daily appointment list upload (Gold plan and up). See
// app/schedule_import.php for how any EHR's export is read.
//   GET  ?action=status                     settings, recent uploads, reminder
//   POST ?action=preview   (multipart file, date)
//   POST ?action=remap     {token, header, cols, save_as}   spreadsheet columns
//   POST ?action=words     {token, map: {word: outcome}}    EHR status words
//   POST ?action=review    {token, rows: {line: {action, case_id}}}  summary by patient
//   POST ?action=apply     {token, rows: {line: {action, case_id}}}
//   POST ?action=undo      {id}
//   POST ?action=settings  {cancel_counts, unknown_as, status_map}
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/schedule_import.php';
pi_start_session();

function sched_pending_dir(): string {
    $d = dirname(PI_STORAGE_DIR) . '/pending';
    if (!is_dir($d)) mkdir($d, 0700, true);
    foreach (glob($d . '/sched-*') ?: [] as $f) if (filemtime($f) < time() - 7200) @unlink($f);
    return $d;
}

function sched_pending(string $token): array {
    $p = $_SESSION['sched_pending'] ?? null;
    if (!$p || !hash_equals($p['token'], $token) || !is_file(sched_pending_dir() . '/sched-' . $p['token'])) json_response(['error' => 'This upload has expired — choose the file again.'], 409);
    return $p;
}

// The previous working day (Friday on a Monday).
function sched_expected_date(): string {
    $d = date('Y-m-d', strtotime('-1 day'));
    while ((int)date('N', strtotime($d)) >= 6) $d = date('Y-m-d', strtotime($d . ' -1 day'));
    return $d;
}

// Reads the held file and builds the preview.
function sched_build(array $p): array {
    $blob = dec_file((string)file_get_contents(sched_pending_dir() . '/sched-' . $p['token']));
    $tmp = tempnam(sys_get_temp_dir(), 'pi');
    file_put_contents($tmp, $blob);
    $settings = sched_settings();
    $layout = null;
    try {
        if ($p['kind'] === 'pdf') $rows = sched_rows_from_pdf(sched_pdf_text($tmp));
        else {
            $sheet = sheet_read($tmp, $p['kind']);
            $saved = $p['cols'] ?? null;
            if (!$saved) {
                // A saved layout for this EHR, recognised by its header row.
                $s = pi_db()->prepare("SELECT * FROM ehr_formats WHERE practice_id = ? AND layout = 'schedule'");
                $s->execute([pid()]);
                foreach ($s->fetchAll() as $f) foreach (array_slice($sheet, 0, 30, true) as $i => $r) {
                    if (sheet_signature($r) === $f['signature']) { $saved = ['header' => $i, 'cols' => json_decode($f['mapping'], true), 'format' => $f['name']]; break 2; }
                }
            }
            $layout = sched_sheet_columns($sheet, $saved);
            $layout['format'] = $saved['format'] ?? null;
            $rows = sched_rows_from_sheet($sheet, $layout);
        }
    } finally { @unlink($tmp); }
    $index = sched_patient_index(pid());
    $a = sched_analyze($rows, $index, $p['date'], $settings, pi_db());
    $out = $a + ['token' => $p['token'], 'fileName' => $p['name'], 'kind' => $p['kind'], 'date' => $p['date'], 'settings' => $settings, 'outcomes' => SCHED_OUTCOMES,
        'openCases' => array_map(fn($pt) => ['id' => $pt['case_id'], 'label' => $pt['name'] . ' · ' . $pt['case_number'] . ($pt['label'] ? ' · ' . $pt['label'] : ''), 'patient' => $pt['name'], 'patientId' => $pt['patient_id'],
            'number' => $pt['case_number'], 'caseLabel' => $pt['label'], 'type' => $pt['type'], 'doi' => $pt['doi']], $index)];
    // What each row would do as things stand (duplicates already skipped).
    $byLine = array_column(sched_plan($out, [], pi_db()), null, 'line');
    $out['rows'] = array_map(fn($r) => $byLine[$r['line']], $out['rows']);
    if ($layout) {
        $out['columns'] = ['header' => $layout['header'], 'cols' => (object)$layout['cols'], 'format' => $layout['format'],
            'headings' => $layout['header'] !== null ? array_map(fn($c) => mb_substr($c, 0, 40), $sheet[$layout['header']]) : array_map(fn($i) => 'Column ' . ($i + 1), array_keys($sheet[0] ?? [])),
            'sample' => array_map(fn($r) => array_map(fn($c) => mb_substr($c, 0, 40), array_slice($r, 0, 14)), array_slice($sheet, ($layout['header'] ?? -1) + 1, 4)),
            'fields' => array_map(fn($f) => $f[0], SCHED_COLS)];
    }
    $dup = pi_db()->prepare('SELECT uploaded_at FROM schedule_imports WHERE practice_id = ? AND file_sha256 = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1');
    $dup->execute([pid(), $p['sha']]);
    $out['alreadyUploaded'] = $dup->fetchColumn() ?: null;
    return $out;
}

function handle_status() {
    require_user('case.read');
    require_feature('schedule_import');
    $s = pi_db()->prepare('SELECT i.id, i.file_kind, i.first_date, i.last_date, i.visits_added, i.no_shows_added, i.rows_matched, i.rows_unmatched, i.uploaded_at, i.undone_at, u.name uploaded_by
        FROM schedule_imports i LEFT JOIN users u ON u.id = i.uploaded_by WHERE i.practice_id = ? ORDER BY i.id DESC LIMIT 15');
    $s->execute([pid()]);
    $hist = $s->fetchAll();
    $last = pi_db()->prepare('SELECT MAX(last_date) FROM schedule_imports WHERE practice_id = ? AND undone_at IS NULL');
    $last->execute([pid()]);
    $lastDate = $last->fetchColumn() ?: null;
    $expected = sched_expected_date();
    json_response(['settings' => sched_settings(), 'outcomes' => SCHED_OUTCOMES, 'history' => $hist, 'expectedDate' => $expected,
        'lastDate' => $lastDate, 'behind' => $hist && (!$lastDate || $lastDate < $expected)]);
}

function handle_preview() {
    require_method('POST');
    $user = require_user('case.write');
    require_feature('schedule_import');
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Upload failed — the file may be too large.'], 400);
    if ($f['size'] > PI_MAX_UPLOAD_BYTES) json_response(['error' => 'Files must be 25 MB or smaller.'], 400);
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
    if ($mime === 'application/pdf') $kind = 'pdf';
    elseif ($ext === 'xlsx' && in_array($mime, ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'], true)) $kind = 'xlsx';
    elseif (in_array($ext, ['csv', 'txt', 'tsv'], true) && (str_starts_with($mime, 'text/') || $mime === 'application/csv')) $kind = 'csv';
    elseif ($ext === 'xls') json_response(['error' => 'This is the older Excel format (.xls). Open it in Excel and save as .xlsx or CSV, then upload that.'], 400);
    else json_response(['error' => 'Upload the appointment list as a spreadsheet (CSV or Excel .xlsx) or a PDF exported from your EHR.'], 400);
    $date = date_or_null($_POST['date'] ?? null) ?: sched_expected_date();
    if (!empty($_SESSION['sched_pending']['token'])) @unlink(sched_pending_dir() . '/sched-' . $_SESSION['sched_pending']['token']);
    $token = bin2hex(random_bytes(16));
    file_put_contents(sched_pending_dir() . '/sched-' . $token, enc_file(file_get_contents($f['tmp_name'])), LOCK_EX);
    $_SESSION['sched_pending'] = $p = ['token' => $token, 'kind' => $kind, 'sha' => hash_file('sha256', $f['tmp_name']), 'name' => mb_substr(basename((string)$f['name']), 0, 200), 'date' => $date, 'cols' => null];
    audit('schedule_preview', null, null, null, $user, $kind);
    try { json_response(sched_build($p)); }
    catch (RuntimeException $e) { json_response(['error' => $e->getMessage()], 400); }
}

// Spreadsheet columns chosen by hand; optionally saved for this EHR.
function handle_remap() {
    require_method('POST');
    $user = require_user('case.write');
    $b = json_body();
    $p = sched_pending((string)($b['token'] ?? ''));
    if ($p['kind'] === 'pdf') json_response(['error' => 'Columns apply to spreadsheets only.'], 400);
    $cols = [];
    foreach (array_keys(SCHED_COLS) as $f) if (isset($b['cols'][$f]) && $b['cols'][$f] !== '' && $b['cols'][$f] !== null) $cols[$f] = max(0, min(SHEET_MAX_COLS - 1, (int)$b['cols'][$f]));
    if (!isset($cols['name']) && !isset($cols['last'])) json_response(['error' => 'Choose the column with the patient\'s name (or last name).'], 400);
    $header = isset($b['header']) && $b['header'] !== null && $b['header'] !== '' ? max(0, (int)$b['header']) : null;
    $name = str_or_null($b['save_as'] ?? null, 80);
    $p['cols'] = ['header' => $header, 'cols' => $cols, 'format' => $name];
    $_SESSION['sched_pending'] = $p;
    try { $out = sched_build($p); } catch (RuntimeException $e) { json_response(['error' => $e->getMessage()], 400); }
    if ($name && $header !== null) {
        // Saved by its header row (column names only, never patient data).
        $blob = dec_file((string)file_get_contents(sched_pending_dir() . '/sched-' . $p['token']));
        $tmp = tempnam(sys_get_temp_dir(), 'pi'); file_put_contents($tmp, $blob);
        try { $sheet = sheet_read($tmp, $p['kind']); } finally { @unlink($tmp); }
        $sig = sheet_signature($sheet[$header] ?? []);
        pi_db()->prepare("INSERT INTO ehr_formats (practice_id, name, layout, signature, mapping, created_by, created_at, updated_at) VALUES (?, ?, 'schedule', ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE name = VALUES(name), layout = 'schedule', mapping = VALUES(mapping), updated_at = VALUES(updated_at)")
            ->execute([pid(), $name, $sig, json_encode($cols), $user['id'], now_str(), now_str()]);
        audit('schedule_format_save', null, null, null, $user, $name);
    }
    json_response($out);
}

function sched_save_settings(array $s, array $user, string $what) {
    $before = sched_settings();
    pi_db()->prepare('UPDATE practices SET schedule_settings = ? WHERE id = ?')->execute([json_encode($s), pid()]);
    $p = current_practice(); $p['schedule_settings'] = json_encode($s); current_practice($p);
    audit('update', 'practice', pid(), null, $user, $what, audit_diff(['cancel_counts' => 'label', 'unknown_as' => 'label', 'multi_case' => 'label', 'words' => 'int'],
        $before + ['words' => count($before['status_map'])], $s + ['words' => count($s['status_map'])]));
}

function clean_status_map($in): array {
    $out = [];
    foreach ((array)$in as $w => $o) { $w = mb_substr(sched_norm_status((string)$w), 0, 40); if ($w !== '' && isset(SCHED_OUTCOMES[$o])) $out[$w] = $o; }
    return array_slice($out, 0, 200, true);
}

// An EHR's own status wording, mapped once and remembered.
function handle_words() {
    require_method('POST');
    $user = require_user('case.write');
    $b = json_body();
    $p = sched_pending((string)($b['token'] ?? ''));
    $s = sched_settings();
    $s['status_map'] = clean_status_map((array)($b['map'] ?? []) + $s['status_map']);
    sched_save_settings($s, $user, 'appointment status words');
    json_response(sched_build($p));
}

function handle_settings() {
    require_method('POST');
    $user = require_user('users.manage');
    require_feature('schedule_import');
    $b = json_body();
    $s = sched_settings();
    if (isset($b['cancel_counts']) && in_array($b['cancel_counts'], ['none', 'late', 'all'], true)) $s['cancel_counts'] = $b['cancel_counts'];
    if (isset($b['unknown_as']) && in_array($b['unknown_as'], ['ask', 'attended', 'skip'], true)) $s['unknown_as'] = $b['unknown_as'];
    if (isset($b['multi_case']) && in_array($b['multi_case'], ['ask', 'all', 'newest'], true)) $s['multi_case'] = $b['multi_case'];
    if (array_key_exists('status_map', $b)) $s['status_map'] = clean_status_map($b['status_map']);
    sched_save_settings($s, $user, 'appointment list settings');
    json_response(['ok' => true, 'settings' => sched_settings()]);
}

// The plan for the clinic's choices, or a 400 explaining what's missing.
function sched_final_plan(array $pv, array $choices): array {
    try { $plan = sched_plan($pv, $choices, pi_db()); } catch (RuntimeException $e) { json_response(['error' => $e->getMessage()], 400); }
    return $plan;
}

// The last look before anything is saved: every row, grouped by patient —
// what was found in the file and what will be logged on which case.
function handle_review() {
    require_method('POST');
    require_user('case.write');
    require_feature('schedule_import');
    $b = json_body();
    $pv = sched_build(sched_pending((string)($b['token'] ?? '')));
    $plan = sched_final_plan($pv, (array)($b['rows'] ?? []));
    $patients = [];
    foreach ($plan as $e) {
        $k = $e['patient_id'];
        $patients[$k] ??= ['patient' => $e['patient'], 'patientId' => $k, 'matchedBy' => $e['matchedBy'], 'cases' => $e['cases'], 'items' => [], 'visits' => 0, 'noShows' => 0];
        $patients[$k]['items'][] = ['line' => $e['line'], 'date' => $e['date'], 'raw' => $e['raw'], 'outcome' => $e['outcome'], 'text' => $e['text'] ?? null, 'action' => $e['action'],
            'targets' => $e['targets'], 'caseChoice' => $e['case_id'], 'caseWhy' => $e['caseWhy'] ?? null, 'needs' => $e['needs'], 'why' => $e['why'] ?? null, 'linked' => !empty($e['linked'])];
        if ($e['action'] === 'visit') $patients[$k]['visits'] += count($e['targets']);
        if ($e['action'] === 'no_show') $patients[$k]['noShows'] += count($e['targets']);
    }
    usort($patients, fn($a, $b) => strcasecmp($a['patient'], $b['patient']));
    foreach ($patients as &$pt) usort($pt['items'], fn($a, $b) => [$a['date'], $a['line']] <=> [$b['date'], $b['line']]);
    unset($pt);
    $needs = array_values(array_filter($plan, fn($e) => $e['needs']));
    json_response(['patients' => $patients, 'needs' => count($needs), 'fileName' => $pv['fileName'], 'outcomes' => $pv['outcomes'], 'unmatchedCount' => $pv['unmatchedCount'],
        'totals' => ['visits' => array_sum(array_column($patients, 'visits')), 'noShows' => array_sum(array_column($patients, 'noShows')), 'patients' => count(array_filter($patients, fn($x) => $x['visits'] + $x['noShows'] > 0)),
            'cases' => count(array_unique(array_merge(...array_map(fn($e) => $e['targets'], $plan ?: [['targets' => []]])))), 'skipped' => count(array_filter($plan, fn($e) => $e['action'] === 'skip'))]]);
}

function handle_apply() {
    require_method('POST');
    $user = require_user('case.write');
    require_feature('schedule_import');
    $b = json_body();
    $p = sched_pending((string)($b['token'] ?? ''));
    $prev = sched_build($p);
    $plan = sched_final_plan($prev, (array)($b['rows'] ?? []));
    if ($n = count(array_filter($plan, fn($e) => $e['needs'] === 'status'))) json_response(['error' => "Choose what to do with the $n row(s) that have no status."], 400);
    if ($n = count(array_filter($plan, fn($e) => $e['needs'] === 'case'))) json_response(['error' => "Choose which case $n row(s) go on — those patients have more than one open case."], 400);
    $pdo = pi_db();
    $todo = [];
    foreach ($plan as $e) foreach ($e['targets'] as $cid) $todo[] = ['line' => $e['line'], 'case_id' => $cid, 'date' => $e['date'], 'action' => $e['action']];

    $dates = array_column($todo, 'date');
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO schedule_imports (practice_id, file_kind, file_sha256, first_date, last_date, rows_matched, rows_unmatched, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)')
        ->execute([pid(), $p['kind'], $p['sha'], $dates ? min($dates) : $p['date'], $dates ? max($dates) : $p['date'], count($prev['rows']), $prev['unmatchedCount'], $user['id'], now_str()]);
    $importId = (int)$pdo->lastInsertId();
    $added = ['visit' => 0, 'no_show' => 0]; $perCase = [];
    $exists = $pdo->prepare('SELECT COUNT(*) FROM visits WHERE case_id = ? AND visit_date = ? AND archived_at IS NULL');
    $ins = $pdo->prepare("INSERT INTO visits (case_id, visit_date, visit_type, source, schedule_import_id, created_by, created_at) VALUES (?, ?, ?, 'schedule', ?, ?, ?)");
    foreach ($todo as $t) {
        $exists->execute([$t['case_id'], $t['date']]);
        if ($exists->fetchColumn()) continue;
        $ins->execute([$t['case_id'], $t['date'], $t['action'] === 'visit' ? 'treatment' : 'no_show', $importId, $user['id'], now_str()]);
        $added[$t['action']]++;
        $perCase[$t['case_id']][$t['action']][] = $t['date'];
    }
    // Same follow-on as logging a visit by hand: the first attended visit
    // sets the first-visit date and moves an intake case to treating.
    foreach ($perCase as $caseId => $acts) {
        if (!empty($acts['visit'])) {
            $c = case_or_404($caseId); $upd = [];
            $first = min($acts['visit']);
            if (!$c['first_visit'] || $first < $c['first_visit']) $upd['first_visit'] = $first;
            if ($c['stage'] === 'intake') $upd['stage'] = 'treating';
            if ($upd) $pdo->prepare('UPDATE cases SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($upd))) . ' WHERE id = ?')->execute([...array_values($upd), $caseId]);
        }
        touch_case($caseId);
    }
    $pdo->prepare('UPDATE schedule_imports SET visits_added = ?, no_shows_added = ? WHERE id = ?')->execute([$added['visit'], $added['no_show'], $importId]);
    // Learn chart numbers: a patient recognised by name on a row that shows
    // a chart # gets it saved (if no one else has it), so later uploads
    // match on it.
    $learned = 0;
    $setChart = $pdo->prepare("UPDATE patients SET chart_number = ? WHERE id = ? AND practice_id = ? AND chart_number IS NULL AND NOT EXISTS
        (SELECT 1 FROM (SELECT id FROM patients WHERE practice_id = ? AND TRIM(LEADING '0' FROM LOWER(REGEXP_REPLACE(chart_number, '[^A-Za-z0-9]', ''))) = ?) x)");
    foreach ($plan as $e) {
        if (empty($e['chartInFile']) || empty($e['patient_id']) || !empty($e['ambiguous']) || ($e['matchedBy'] ?? '') === 'chart' || sched_chart($e['chartInFile']) === null) continue;
        $chart = mb_substr(trim($e['chartInFile']), 0, 40);
        $setChart->execute([$chart, $e['patient_id'], pid(), pid(), sched_chart($chart)]);
        $learned += $setChart->rowCount();
    }
    $pdo->commit();
    foreach ($perCase as $caseId => $acts) audit('schedule_import', 'case', $caseId, $caseId, $user, trim((count($acts['visit'] ?? []) ? count($acts['visit']) . ' visit(s) ' : '') . (count($acts['no_show'] ?? []) ? count($acts['no_show']) . ' no-show(s)' : '')));
    audit('schedule_apply', null, $importId, null, $user, "{$added['visit']} visits, {$added['no_show']} no-shows");
    @unlink(sched_pending_dir() . '/sched-' . $p['token']);
    unset($_SESSION['sched_pending']);
    // Patients the no-shows put on watch: 2+ missed in the last 30 days.
    $watch = [];
    $ns = $pdo->prepare("SELECT COUNT(*) FROM visits WHERE case_id = ? AND visit_type = 'no_show' AND archived_at IS NULL AND visit_date > ?");
    foreach ($perCase as $caseId => $acts) {
        if (empty($acts['no_show'])) continue;
        $ns->execute([$caseId, add_days(date('Y-m-d'), -30)]);
        $n = (int)$ns->fetchColumn();
        $label = current(array_filter($prev['openCases'], fn($o) => $o['id'] === $caseId))['label'] ?? '';
        $watch[] = ['caseId' => $caseId, 'label' => $label, 'noShows30' => $n];
    }
    usort($watch, fn($a, $b) => $b['noShows30'] <=> $a['noShows30']);
    json_response(['ok' => true, 'importId' => $importId, 'chartsLearned' => $learned, 'visitsAdded' => $added['visit'], 'noShowsAdded' => $added['no_show'], 'casesUpdated' => count($perCase), 'noShowCases' => $watch]);
}

// Undo an upload (within 14 days): its visits are archived.
function handle_undo() {
    require_method('POST');
    $user = require_user('case.write');
    $id = (int)(json_body()['id'] ?? 0);
    $s = pi_db()->prepare('SELECT * FROM schedule_imports WHERE id = ? AND practice_id = ?');
    $s->execute([$id, pid()]);
    $imp = $s->fetch();
    if (!$imp || $imp['undone_at']) json_response(['error' => 'That upload was already undone or isn\'t available.'], 404);
    if (strtotime($imp['uploaded_at']) < time() - 14 * 86400) json_response(['error' => 'Uploads can be undone for 14 days. Remove individual visits on the case instead.'], 400);
    $pdo = pi_db();
    $cases = $pdo->prepare('SELECT DISTINCT case_id FROM visits WHERE schedule_import_id = ? AND archived_at IS NULL');
    $cases->execute([$id]);
    $caseIds = $cases->fetchAll(PDO::FETCH_COLUMN);
    $pdo->prepare('UPDATE visits SET archived_at = ? WHERE schedule_import_id = ? AND archived_at IS NULL')->execute([now_str(), $id]);
    $pdo->prepare('UPDATE schedule_imports SET undone_at = ?, undone_by = ? WHERE id = ?')->execute([now_str(), $user['id'], $id]);
    foreach ($caseIds as $c) touch_case((int)$c);
    audit('schedule_undo', null, $id, null, $user, count($caseIds) . ' case(s)');
    json_response(['ok' => true, 'cases' => count($caseIds)]);
}

switch ($_GET['action'] ?? '') {
    case 'status': handle_status(); break;
    case 'preview': handle_preview(); break;
    case 'remap': handle_remap(); break;
    case 'words': handle_words(); break;
    case 'settings': handle_settings(); break;
    case 'review': handle_review(); break;
    case 'apply': handle_apply(); break;
    case 'undo': handle_undo(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
