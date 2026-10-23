<?php
// Public: the attorney / case manager's reply page for a status request
// (status.html). No sign-in — access is the one-time link token from the
// email (stored hashed, expires after STATUS_LINK_DAYS, one reply). Shows
// only what the attorney needs to identify their client: name, date of
// injury, our case number and last date of service (plus the balance if
// the practice allows). Every view and reply is in the audit log.
//   GET  status.php?action=view&t=TOKEN
//   POST status.php?action=reply&t=TOKEN
require_once __DIR__ . '/../../app/bootstrap.php';
header('X-Robots-Tag: noindex, nofollow');

$found = status_by_token((string)($_GET['t'] ?? ''));
if (!$found || !$found['case'] || !$found['practice']) json_response(['error' => 'This link isn\'t valid. Please use the most recent email from the office, or contact them directly.', 'code' => 'invalid'], 404);
['request' => $req, 'case' => $case, 'practice' => $practice] = $found;
current_practice($practice);
$system = ['id' => null, 'email' => 'attorney link', 'practice_id' => $practice['id']];
$head = status_letterhead($case, $practice);
if (strtotime($req['expires_at']) < time()) json_response(['error' => 'This link has expired. Please contact ' . $head['name'] . ($head['phone'] ? ' at ' . $head['phone'] : '') . ' for a new one.', 'code' => 'expired', 'practice' => $head], 410);
if (!empty($case['archived_at'])) json_response(['error' => 'This case is no longer active at ' . $head['name'] . '. No reply is needed.', 'code' => 'closed', 'practice' => $head], 410);

$action = $_GET['action'] ?? 'view';
if ($action === 'view') {
    $pt = pi_db()->prepare('SELECT first_name, last_name FROM patients WHERE id = ?'); $pt->execute([$case['patient_id']]);
    $pt = $pt->fetch();
    $lv = pi_db()->prepare('SELECT MAX(visit_date) FROM visits WHERE case_id = ? AND archived_at IS NULL'); $lv->execute([$case['id']]);
    $rules = status_rules($practice);
    if (!$req['viewed_at']) pi_db()->prepare('UPDATE status_requests SET viewed_at = ? WHERE id = ?')->execute([now_str(), $req['id']]);
    audit('status_request_view', 'case', $case['id'], (int)$case['id'], $system, $_SERVER['REMOTE_ADDR'] ?? null);
    json_response([
        'practice' => $head, 'patient' => trim($pt['first_name'] . ' ' . $pt['last_name']), 'dateOfInjury' => $case['date_of_injury'], 'caseNumber' => $case['case_number'],
        'lastVisit' => $lv->fetchColumn() ?: null,
        'balance' => $rules['show_balance'] ? ledger_totals_by_case(pi_db(), [(int)$case['id']])[(int)$case['id']]['total_balance'] : null,
        'known' => array_filter(array_intersect_key($case, STATUS_REPLY_DATES)),
        'options' => STATUS_REPLY_OPTIONS, 'needs' => STATUS_NEEDS, 'dates' => STATUS_REPLY_DATES,
        // At the end of care, the final narrative question too.
        'narrative' => ($case['discharge_date'] || $case['mmi_date']) && !in_array($case['narrative_request'], ['none', 'without_ratings', 'with_ratings'], true) ? STATUS_NARRATIVE : null,
        // The practice's fee for each kind of report (null = no charge).
        'narrativeFees' => ['charge' => ($nf = narrative_fees($practice))['charge'], 'without_ratings' => narrative_fee_for($nf, 'without_ratings'), 'with_ratings' => narrative_fee_for($nf, 'with_ratings')],
        'expiresAt' => $req['expires_at'], 'respondedAt' => $req['responded_at'],
    ]);
}

if ($action !== 'reply') json_response(['error' => 'Unknown action'], 400);
require_method('POST');
if ($req['responded_at']) json_response(['error' => 'Thank you — a reply was already received on ' . us_date($req['responded_at']) . '. To add anything, please contact ' . $head['name'] . ($head['phone'] ? ' at ' . $head['phone'] : '') . '.', 'code' => 'done'], 409);
$b = json_body();
$status = (string)($b['status'] ?? '');
if (!isset(STATUS_REPLY_OPTIONS[$status])) json_response(['error' => 'Choose the current status of the case.'], 400);
$name = str_or_null($b['name'] ?? null, 120);
if (!$name) json_response(['error' => 'Enter your name.'], 400);
$email = str_or_null($b['email'] ?? null, 190);
if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Check the email address.'], 400);
$r = ['status' => $status, 'name' => $name, 'email' => $email, 'note' => str_or_null($b['note'] ?? null, 2000),
    'payment_sent_on' => date_or_null($b['payment_sent_on'] ?? null), 'payment_amount' => money_or_null($b['payment_amount'] ?? null), 'check_number' => str_or_null($b['check_number'] ?? null, 40),
    'needs' => array_values(array_intersect(array_keys(STATUS_NEEDS), (array)($b['needs'] ?? [])))];
foreach (STATUS_REPLY_DATES as $k => $l) $r[$k] = date_or_null($b[$k] ?? null);
$r['narrative'] = isset(STATUS_NARRATIVE[$b['narrative'] ?? '']) ? $b['narrative'] : null;
// Requesting a report the practice charges for needs the fee acknowledged.
$r['narrative_fee'] = $r['narrative'] ? narrative_fee_for(narrative_fees($practice), $r['narrative']) : null;
if ($r['narrative_fee'] && empty($b['ack_fee'])) json_response(['error' => 'Please acknowledge the narrative report fee of $' . number_format($r['narrative_fee'], 2) . ', or choose a different option.', 'code' => 'ack_fee'], 400);
$r['fee_ack'] = (bool)$r['narrative_fee'];
$summary = status_reply_summary($r);
$pdo = pi_db();
$today = date('Y-m-d');

$pdo->beginTransaction();
$pdo->prepare('UPDATE status_requests SET responded_at = ?, response_enc = ? WHERE id = ?')->execute([now_str(), enc(json_encode($r)), $req['id']]);
// Dates the attorney gave go straight onto the case.
$changes = [];
foreach (STATUS_REPLY_DATES as $k => $l) if ($r[$k] && $r[$k] !== $case[$k]) $changes[$k] = $r[$k];
// The narrative answer goes on the case (a "yes" starts its 30-day clock).
if ($r['narrative']) {
    $changes['narrative_request'] = $r['narrative'];
    if ($r['narrative'] !== 'none') $changes['narrative_requested_on'] = $today;
    $changes += $r['fee_ack'] ? ['narrative_fee' => $r['narrative_fee'], 'narrative_fee_ack_at' => now_str(), 'narrative_fee_ack_by' => mb_substr($name, 0, 120), 'narrative_fee_ack_via' => 'online']
        : ['narrative_fee' => null, 'narrative_fee_ack_at' => null, 'narrative_fee_ack_by' => null, 'narrative_fee_ack_via' => null];
}
if ($changes) {
    $pdo->prepare('UPDATE cases SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($changes))) . ', updated_at = ? WHERE id = ?')->execute([...array_values($changes), now_str(), $case['id']]);
    audit('update', 'case', $case['id'], (int)$case['id'], $system, 'from attorney status reply', audit_diff(array_intersect_key(['narrative_request' => 'label', 'narrative_fee' => 'money', 'narrative_fee_ack_by' => 'str', 'narrative_fee_ack_via' => 'str'] + array_fill_keys(array_keys(STATUS_REPLY_DATES), 'date') + ['narrative_requested_on' => 'date'], $changes), $case, $changes));
}
$fromAttorney = in_array($case['auto_status_to'], ['attorney', 'both'], true) && $case['attorney_contact_id'] ? $case['attorney_contact_id'] : null;
$pdo->prepare("INSERT INTO correspondence (case_id, occurred_on, direction, method, contact_id, contact_text, subject, notes_enc, created_at) VALUES (?, ?, 'in', 'portal', ?, ?, ?, ?, ?)")
    ->execute([$case['id'], $today, $fromAttorney, mb_substr($name, 0, 160), mb_substr('Status update (online reply): ' . STATUS_REPLY_OPTIONS[$status], 0, 200), enc($summary), now_str()]);
// A task for the office to look it over (and post any payment).
$urgent = in_array($status, ['paid', 'withdrawn', 'closed'], true) || $r['needs'] || in_array($r['narrative'], ['without_ratings', 'with_ratings'], true);
$title = in_array($r['narrative'], ['without_ratings', 'with_ratings'], true) ? 'Attorney requested a final narrative — prepare it' . ($r['fee_ack'] ? ' (fee $' . number_format($r['narrative_fee'], 2) . ' acknowledged)' : '') : null;
$title = $title ?? ($status === 'paid' ? 'Attorney reports payment sent — watch for the check and post it' : ($status === 'withdrawn' ? 'Attorney no longer represents this patient — update the case' : 'Review the attorney\'s status reply'));
$pdo->prepare("INSERT INTO tasks (practice_id, case_id, title, notes_enc, priority, due_on, email_on, email_who, created_at) VALUES (?, ?, ?, ?, ?, ?, '', '', ?)")
    ->execute([$practice['id'], $case['id'], $title, enc($summary), $urgent ? 'high' : 'normal', $today, now_str()]);
$pdo->commit();
audit('status_request_reply', 'case', $case['id'], (int)$case['id'], ['id' => null, 'email' => $email ?: 'attorney link', 'practice_id' => $practice['id']], STATUS_REPLY_OPTIONS[$status]);
json_response(['ok' => true, 'practice' => $head]);
