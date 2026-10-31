<?php
// Auto / PIP insurance EOB uploads. A scan — one EOB or the day's batch —
// is read (app/eob.php), each EOB is matched to its case, a person reviews
// and corrects it, and on save its numbers are kept (never the scan: it is
// read in this request and discarded) and, unless the case's money comes
// from an EHR ledger, posted:
// the insurer's payment, the fee-schedule reduction, and the PIP 20% /
// deductible moved to the patient's balance. "Benefits exhausted" marks the
// PIP coverage exhausted and, when no other coverage is left, offers to move
// the case to a letter of protection (only on the clinic's say-so).
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/case_basis.php';
require_once __DIR__ . '/../../app/eob.php';
require_once __DIR__ . '/../../app/eob_analysis.php';
require_once __DIR__ . '/../../app/eob_store.php';
pi_start_session();

function handle_upload() {
    require_method('POST');
    $user = require_user('finance.write');
    require_feature('eob_genie');
    $caseId = (int)($_POST['case_id'] ?? 0);
    if ($caseId) case_or_404($caseId);
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Upload failed — the file may be too large.'], 400);
    if ($f['size'] > PI_MAX_UPLOAD_BYTES) json_response(['error' => 'Files must be 25 MB or smaller.'], 400);
    if ((new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) !== 'application/pdf') json_response(['error' => 'Upload the EOB as a PDF (scan it, or save it from the payer portal).'], 400);
    // The scan is read straight from PHP's temporary upload (deleted when
    // this request ends) and never kept. Reading a batch takes a few seconds
    // a page: don't hold the session meanwhile.
    $token = bin2hex(random_bytes(16));
    session_write_close();
    set_time_limit(600);
    try {
        $r = eob_read($f['tmp_name']);
    } catch (RuntimeException $e) {
        json_response(['error' => $e->getMessage()], 422);
    }
    foreach ($r['eobs'] as $i => &$e) {
        $e['index'] = $i;
        $e['matches'] = eob_match_cases($e['header']);
        $pick = $caseId ?: (($e['matches'][0]['score'] ?? 0) >= 55 ? $e['matches'][0]['caseId'] : null);
        $e['case'] = $pick ? eob_case_info($pick, $e['header']) : null;
        // Uploaded on a case, but the EOB names someone else.
        if ($caseId && $e['matches'] && !in_array($caseId, array_column($e['matches'], 'caseId'), true) && ($e['matches'][0]['score'] ?? 0) >= 55) $e['wrongCase'] = $e['matches'][0];
        $usual = eob_usual_allowed(pid());
        foreach ($e['lines'] as &$l) $l['notes'] = eob_line_notes(['allowed_full' => $l['allowed'], 'charged' => $l['charged'], 'code' => $l['code'], 'reasons' => $l['reasons']], $usual, $e['status']);
        unset($l);
    }
    unset($e);
    foreach ($r['payments'] as $i => &$p) {
        $p['index'] = $i;
        $p['via'] = eob_match_firm($p['upper'] ?? '') ?? $p['via'];
        unset($p['upper']);
        $h = ['claim' => $p['claim'], 'patient' => $p['patient'], 'dateOfLoss' => $p['dateOfLoss'] ?? null, 'payer' => $p['payer']];
        $p['matches'] = eob_match_cases($h);
        $pick = $caseId ?: (($p['matches'][0]['score'] ?? 0) >= 55 ? $p['matches'][0]['caseId'] : null);
        $p['case'] = $pick ? eob_case_info($pick, $h) : null;
    }
    unset($p);
    session_start();
    // Several files can be read before one save (past EOBs come in batches).
    $pend = array_slice($_SESSION['eob_pending'] ?? [], -19, null, true);
    $pend[$token] = ['pages' => $r['pageCount'], 'at' => time()];
    $_SESSION['eob_pending'] = $pend;
    audit('eob_read', 'case', $caseId ?: null, $caseId ?: null, $user, count($r['eobs']) . ' EOB(s), ' . count($r['payments']) . ' check(s) without an EOB, ' . $r['pageCount'] . ' page(s)');
    json_response($r + ['token' => $token, 'layouts' => EOB_LAYOUT_NAMES]);
}

function handle_case_info() {
    require_user('finance.write');
    require_feature('eob_genie');
    json_response(eob_case_info((int)($_GET['case_id'] ?? 0), json_body() ?: []));
}

// The clinic confirmed it: move the case to a letter of protection (with
// the usual switch notice on the case and the email to administrators).
function handle_switch_lop() {
    require_method('POST');
    $user = require_user('finance.write');
    $caseId = (int)(json_body()['case_id'] ?? 0);
    $case = case_or_404($caseId);
    if ($case['injury_type'] !== 'auto') json_response(['error' => 'Only auto cases switch between insurance and a letter of protection.'], 400);
    $w = basis_watch($caseId);
    pi_db()->prepare("UPDATE cases SET billing_basis = 'lop' WHERE id = ?")->execute([$caseId]);
    $change = $w($user, 'PIP benefits exhausted (EOB) — switch confirmed');
    touch_case($caseId);
    json_response(['ok' => true, 'change' => $change]);
}

function handle_apply() {
    require_method('POST');
    $user = require_user('finance.write');
    require_feature('eob_genie');
    $b = json_body();
    $pend = $_SESSION['eob_pending'] ?? [];
    $tokens = array_map('strval', $b['tokens'] ?? (isset($b['token']) ? [$b['token']] : []));
    if (!$tokens || array_diff($tokens, array_keys(is_array($pend) ? $pend : []))) json_response(['error' => 'This upload has expired — choose the file again.'], 409);
    $items = array_values(array_filter($b['eobs'] ?? [], fn($x) => !empty($x['include'])));
    $pays = array_values(array_filter($b['payments'] ?? [], fn($x) => !empty($x['include'])));
    if (!$items && !$pays) json_response(['error' => 'Choose at least one EOB or payment to save.'], 400);
    // Past EOBs: kept for the report; the practice's ledger already has them.
    $history = !empty($b['history']);
    $canPost = fin_can($user, 'ledger');
    $saved = []; $lop = [];
    foreach ($items as $it) $saved[] = eob_save($it, $user, $history, $canPost);
    foreach ($pays as $it) $saved[] = eob_save_payment($it, $user, $history, $canPost);
    foreach ($saved as $x) if ($x['offerLop'] && !in_array($x['caseId'], array_column($lop, 'caseId'), true)) $lop[] = ['caseId' => $x['caseId'], 'caseNumber' => $x['caseNumber'], 'payer' => $x['payer']];
    foreach ($tokens as $t) unset($_SESSION['eob_pending'][$t]);
    json_response(['saved' => $saved, 'lopSuggested' => $lop]);
}

// Past EOBs often belong to patients who were never entered: one patient
// and auto case per person named on them (same name and date of loss).
function handle_create_cases() {
    require_method('POST');
    $user = require_user('case.write');
    require_feature('eob_genie');
    $b = json_body();
    $stage = (string)($b['stage'] ?? 'treating');
    $out = []; $seen = [];
    foreach (array_slice($b['people'] ?? [], 0, 200) as $p) {
        $key = strtolower(preg_replace('/[^a-z]/i', '', implode('', array_reverse(eob_split_name($p['patient'] ?? ''))))) . '|' . ($p['dateOfLoss'] ?? '');
        if (isset($seen[$key])) { $out[] = $seen[$key] + ['ref' => $p['ref'] ?? null]; continue; }
        if (in_array($stage, OPEN_STAGES, true)) enforce_limit('cases');
        $c = eob_create_case((string)($p['patient'] ?? ''), $p['dateOfLoss'] ?? null, $p['claim'] ?? null, $p['payer'] ?? null, $stage, $user);
        $seen[$key] = $c;
        $out[] = $c + ['ref' => $p['ref'] ?? null];
    }
    json_response(['created' => $out, 'count' => count($seen)]);
}

// Edits a saved EOB — a corrected line, or the check that came after the
// EOB — and, when it was (or is now to be) posted, replaces the ledger
// entries it posted with new ones that match.
function handle_update() {
    require_method('POST');
    $user = require_user('finance.write');
    require_feature('eob_genie');
    $b = json_body();
    $s = pi_db()->prepare('SELECT * FROM eobs WHERE id = ? AND practice_id = ? AND archived_at IS NULL');
    $s->execute([(int)($b['id'] ?? 0), pid()]);
    $old = $s->fetch() ?: json_response(['error' => 'EOB not found'], 404);
    $caseId = (int)$old['case_id'];
    $case = case_or_404($caseId);
    [$lines, $r, $row, $coverageId] = eob_input($b, $caseId);
    $wantPost = !empty($b['post']);
    if (($old['posted'] || $wantPost) && $case['ehr_synced_at']) {
        if ($old['posted']) json_response(['error' => "This case's financials now come from the EHR — edit them there."], 409);
        $wantPost = false;
    }
    if (($old['posted'] || $wantPost) && !fin_can($user, 'ledger')) json_response(['error' => 'Your role cannot change the ledger.'], 403);
    $pdo = pi_db();
    $pdo->beginTransaction();
    eob_write((int)$old['id'], $caseId, $coverageId, $row, $r, $lines, $user);
    $removed = 0; $posted = null;
    if ($old['posted']) {
        $n = $pdo->prepare('UPDATE ledger SET archived_at = ?, updated_by = ?, updated_at = ? WHERE eob_id = ? AND archived_at IS NULL');
        $n->execute([now_str(), $user['id'], now_str(), $old['id']]);
        $removed = $n->rowCount();
    }
    if ($wantPost) $posted = eob_post((int)$old['id'], $caseId, $coverageId, $row + ['paid' => $r['totals']['paid'], 'interest' => $r['totals']['interest'], 'deductible' => $r['totals']['deductible']], eob_post_lines($lines, $row, $r['totals']), $user);
    $pdo->prepare('UPDATE eobs SET posted = ? WHERE id = ?')->execute([$wantPost ? 1 : 0, $old['id']]);
    $pdo->commit();
    $offer = $r['status'] === 'exhausted' && $old['status'] !== 'exhausted' && eob_exhaust($caseId, $coverageId, $row, $user);
    touch_case($caseId);
    $changes = [];
    foreach (['paid', 'allowed', 'charged', 'check_number', 'check_date', 'status'] as $f) {
        $nv = in_array($f, ['paid', 'allowed', 'charged'], true) ? $r['totals'][$f] : $row[$f];
        if ((string)$old[$f] !== (string)$nv && !(is_numeric($old[$f]) && is_numeric($nv) && abs($old[$f] - $nv) < 0.005)) $changes[] = ['f' => $f, 't' => in_array($f, ['paid', 'allowed', 'charged'], true) ? 'money' : 'str', 'from' => $old[$f], 'to' => $nv];
    }
    audit('eob_edit', 'case', $caseId, $caseId, $user, $row['payer'] . ' ' . ($row['dos_from'] ?? '') . ($removed ? " — $removed ledger entries replaced" : ''), $changes ?: null);
    json_response(['ok' => true, 'posted' => $posted, 'ledgerReplaced' => $removed, 'lopSuggested' => $offer ? [['caseId' => $caseId, 'caseNumber' => $case['case_number'], 'payer' => $row['payer']]] : []]);
}

function handle_list() {
    $user = require_user('case.read');
    $caseId = (int)($_GET['case_id'] ?? 0);
    case_or_404($caseId);
    $money = fin_can($user, 'balances');
    $s = pi_db()->prepare('SELECT * FROM eobs WHERE case_id = ? AND archived_at IS NULL ORDER BY COALESCE(eob_date, DATE(created_at)) DESC, id DESC');
    $s->execute([$caseId]);
    $rows = $s->fetchAll();
    $usual = $rows ? eob_usual_allowed(pid()) : [];
    $case = case_or_404($caseId);
    $m = pi_db()->prepare("SELECT completed_on FROM case_milestones WHERE case_id = ? AND milestone = 'treatment_notice_mailed'"); $m->execute([$caseId]);
    $noticeOn = $m->fetchColumn() ?: null;
    $out = [];
    foreach ($rows as $e) {
        $l = pi_db()->prepare('SELECT * FROM eob_lines WHERE eob_id = ? ORDER BY line_no'); $l->execute([$e['id']]);
        $out[] = eob_row_out($e, $l->fetchAll(), $usual, $money, $case, $noticeOn);
    }
    json_response(['eobs' => $out]);
}

// Removes a saved EOB and the ledger entries it posted.
function handle_archive() {
    require_method('POST');
    $user = require_user('finance.write');
    $id = (int)(json_body()['id'] ?? 0);
    $s = pi_db()->prepare('SELECT * FROM eobs WHERE id = ? AND practice_id = ? AND archived_at IS NULL');
    $s->execute([$id, pid()]);
    $e = $s->fetch() ?: json_response(['error' => 'EOB not found'], 404);
    $case = case_or_404((int)$e['case_id']);
    if ($e['posted'] && $case['ehr_synced_at']) json_response(['error' => "This case's financials now come from the EHR."], 409);
    pi_db()->prepare('UPDATE eobs SET archived_at = ? WHERE id = ?')->execute([now_str(), $id]);
    $n = pi_db()->prepare('UPDATE ledger SET archived_at = ?, updated_by = ?, updated_at = ? WHERE eob_id = ? AND archived_at IS NULL');
    $n->execute([now_str(), $user['id'], now_str(), $id]);
    touch_case((int)$e['case_id']);
    audit('eob_remove', 'case', (int)$e['case_id'], (int)$e['case_id'], $user, $e['payer'] . ' — ' . $n->rowCount() . ' ledger entries removed');
    json_response(['ok' => true, 'ledgerRemoved' => $n->rowCount()]);
}

function handle_settings() {
    require_method('POST');
    require_user('users.manage');
    require_feature('eob_genie');
    $b = json_body();
    $rate = $b['interest_rate'] ?? null;
    if ($rate !== null && $rate !== '' && (!is_numeric($rate) || $rate < 0 || $rate > 25)) json_response(['error' => 'Enter the interest rate as a percentage, e.g. 9.09.'], 400);
    $set = ['interest_rate' => $rate === null || $rate === '' ? null : round((float)$rate, 3)];
    pi_db()->prepare('UPDATE practices SET eob_settings = ? WHERE id = ?')->execute([json_encode($set), pid()]);
    audit('update', 'practice', pid(), null, null, 'EOB Genie settings');
    json_response(['ok' => true, 'settings' => $set]);
}

function handle_insights() {
    $user = require_user('case.read');
    if (!fin_can($user, 'balances')) json_response(['error' => 'Your role does not include financial reports.'], 403);
    require_feature('eob_genie');
    $from = eob_day($_GET['from'] ?? null);
    json_response(eob_insights(pid(), $from) + ['genie' => eob_genie_report(pid(), $from), 'settings' => eob_settings()]);
}

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'upload': handle_upload(); break;
    case 'case_info': handle_case_info(); break;
    case 'apply': handle_apply(); break;
    case 'switch_lop': handle_switch_lop(); break;
    case 'create_cases': handle_create_cases(); break;
    case 'update': handle_update(); break;
    case 'list': handle_list(); break;
    case 'archive': handle_archive(); break;
    case 'insights': handle_insights(); break;
    case 'settings': handle_settings(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
