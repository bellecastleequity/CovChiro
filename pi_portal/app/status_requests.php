<?php
// Automatic case status requests to the attorney / case manager (Gold plan
// and up). Every N days (30 by default) an open case with the toggle on
// emails its attorney and/or case manager asking for a case and payment
// status update. The email itself holds no patient details — only a link
// with a one-time token to a reply page (status.html) that shows which
// client, and takes a one-minute structured reply: case status, upcoming
// dates, settlement / payment status and anything needed from the office.
// The reply is logged as incoming correspondence, fills in the case's
// mediation / trial / settlement / expected-check dates, and creates a
// task for the office to review it.

require_once __DIR__ . '/mailer.php';

const STATUS_RULE_DEFAULTS = ['default_on' => false, 'every_days' => 30, 'show_balance' => true];
const STATUS_TO = ['attorney' => 'Attorney', 'case_manager' => 'Case manager', 'both' => 'Attorney and case manager'];
const STATUS_LINK_DAYS = 30;
const STATUS_REPLY_OPTIONS = [
    'pre_suit' => 'Pre-suit — client still treating or we are gathering records',
    'demand' => 'Demand sent to the insurer',
    'negotiating' => 'Negotiating with the insurer',
    'litigation' => 'In litigation (suit filed)',
    'mediation' => 'Mediation scheduled',
    'trial' => 'Trial set',
    'settled_pending' => 'Settled — awaiting disbursement',
    'paid' => 'Settled — payment sent to your office',
    'closed' => 'Case closed with no recovery',
    'withdrawn' => 'We no longer represent this client',
];
const STATUS_NEEDS = ['records' => 'Updated medical records', 'bills' => 'Itemized bills / ledger', 'narrative' => 'Narrative report', 'lien' => 'Final lien / balance letter'];
// The final narrative question (asked once care has ended).
const STATUS_NARRATIVE = ['without_ratings' => 'Yes — without AMA impairment ratings', 'with_ratings' => 'Yes — with AMA whole-person impairment ratings', 'none' => 'No — our firm does not need a final narrative report'];
// Reply date fields that are copied onto the case.
const STATUS_REPLY_DATES = ['mediation_on' => 'Mediation date', 'trial_on' => 'Trial date', 'settlement_signed_on' => 'Settlement signed', 'disbursement_expected_on' => 'Expected disbursement / check date'];

function status_rules(?array $practice = null): array {
    $p = $practice ?? current_practice();
    $saved = $p && !empty($p['status_request_rules']) ? (json_decode($p['status_request_rules'], true) ?: []) : [];
    $r = array_merge(STATUS_RULE_DEFAULTS, array_intersect_key($saved, STATUS_RULE_DEFAULTS));
    return ['default_on' => (bool)$r['default_on'], 'every_days' => status_every($r['every_days']), 'show_balance' => (bool)$r['show_balance']];
}

function status_every($v): int { return max(7, min(180, (int)$v ?: 30)); }

function status_case_every(array $case, array $practice): int {
    return $case['auto_status_every'] ? status_every($case['auto_status_every']) : status_rules($practice)['every_days'];
}

// [[email, name], ...] for a case's chosen recipients that have an email.
function status_recipients(array $case): array {
    $out = [];
    $to = $case['auto_status_to'] ?: 'attorney';
    if (in_array($to, ['attorney', 'both'], true) && $case['attorney_contact_id']) {
        $s = pi_db()->prepare('SELECT name, organization, email FROM contacts WHERE id = ? AND practice_id = ? AND archived_at IS NULL');
        $s->execute([$case['attorney_contact_id'], $case['practice_id']]);
        if (($c = $s->fetch()) && filter_var($c['email'], FILTER_VALIDATE_EMAIL)) $out[strtolower($c['email'])] = [$c['email'], $c['name'] ?: null];
    }
    if (in_array($to, ['case_manager', 'both'], true) && filter_var($case['case_manager_email'], FILTER_VALIDATE_EMAIL)) $out[strtolower($case['case_manager_email'])] ??= [$case['case_manager_email'], $case['case_manager_name'] ?: null];
    return array_values($out);
}

// The practice's name, address and phone as the case's location shows them.
function status_letterhead(array $case, array $practice): array {
    $h = ['name' => $practice['name'], 'address' => $practice['address'] ?? null, 'phone' => $practice['phone'] ?? null];
    if (!empty($case['location_id'])) {
        $s = pi_db()->prepare('SELECT * FROM locations WHERE id = ? AND practice_id = ?');
        $s->execute([$case['location_id'], $practice['id']]);
        if ($l = $s->fetch()) {
            if ($l['name'] !== $practice['name']) $h['name'] .= ' — ' . $l['name'];
            foreach (['address', 'phone'] as $k) if (!empty($l[$k])) $h[$k] = $l[$k];
        }
    }
    return $h;
}

// Why a case can't send automatically right now (null = it can).
function status_problem(array $case, array $practice): ?string {
    if (!has_feature($practice, 'auto_status')) return 'Automatic status requests are part of the ' . PLANS[feature_plan('auto_status')]['name'] . ' plan and up.';
    if (!mail_configured()) return 'Email sending isn\'t set up on this server yet.';
    if (!in_array($case['stage'], OPEN_STAGES, true) || !empty($case['archived_at'])) return 'The case is closed.';
    if ($case['check_received_on']) return 'The settlement check has been received.';
    if (!status_recipients($case)) return ($case['auto_status_to'] === 'case_manager' ? 'Add the case manager\'s email.' : ($case['attorney_contact_id'] ? 'Add an email address to the attorney\'s contact' . ($case['auto_status_to'] === 'both' ? ' or the case manager\'s email.' : '.') : 'Choose the attorney on the case' . ($case['auto_status_to'] === 'both' ? ' or add the case manager\'s email.' : '.')));
    return null;
}

// Last day the office heard from the attorney (incoming correspondence).
function status_last_heard(int $caseId): ?string {
    $s = pi_db()->prepare("SELECT MAX(occurred_on) FROM correspondence WHERE case_id = ? AND direction = 'in' AND archived_at IS NULL");
    $s->execute([$caseId]);
    return $s->fetchColumn() ?: null;
}

// When the next automatic request goes out: every N days since the last
// one, and not while the attorney has written in within the last N days.
function status_next_on(array $case, array $practice, string $today): ?string {
    if (!$case['auto_status']) return null;
    $every = status_case_every($case, $practice);
    $next = $case['auto_status_last_on'] ? add_days($case['auto_status_last_on'], $every) : $today;
    if (($heard = status_last_heard((int)$case['id'])) && add_days($heard, $every) > $next) $next = add_days($heard, $every);
    return max($next, $today);
}

// Sends a request now. Returns ['sent' => n, 'to' => [...]] or ['error' => ...].
function status_send(array $case, array $practice, string $kind = 'auto', ?array $user = null): array {
    if ($problem = status_problem($case, $practice)) return ['error' => $problem];
    $pdo = pi_db();
    $to = status_recipients($case);
    $token = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', time() + STATUS_LINK_DAYS * 86400);
    $head = status_letterhead($case, $practice);
    $rules = status_rules($practice);
    $sent = [];
    foreach ($to as [$email, $name]) {
        $text = 'Hello ' . ($name ? explode(' ', trim($name))[0] : 'there') . ",\n\n"
            . "{$head['name']} is requesting an update on the status of a personal injury case for a mutual client" . ($rules['show_balance'] ? ', including settlement and payment status' : '') . ".\n\n"
            . "For the client's privacy, their details are not included in this email. The secure link below shows which client and takes about a minute to answer — no account or password needed:\n\n"
            . APP_URL . '/status.html?t=' . $token . "\n\n"
            . 'The link expires on ' . date('F j, Y', strtotime($expires)) . ". If you no longer handle this case, you can say so on the same page.\n\n"
            . "Thank you,\n{$head['name']}\n" . (($line = implode(' · ', array_filter([$head['address'], $head['phone']]))) ? "$line\n" : '') . "\n"
            . 'Sent through ' . BRAND_NAME . ' on behalf of ' . $practice['name'] . ". Please don't reply to this email; use the link above or contact the office directly.\n";
        if (send_mail($email, 'Case status update request — ' . $head['name'], $text)) $sent[] = $email;
    }
    if (!$sent) return ['error' => 'The email could not be sent. Please try again later.'];
    $today = date('Y-m-d');
    $pdo->prepare('INSERT INTO status_requests (practice_id, case_id, token_hash, kind, sent_to, sent_by, sent_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$practice['id'], $case['id'], hash('sha256', $token), $kind, implode(', ', $sent), $user['id'] ?? null, now_str(), $expires]);
    $pdo->prepare('UPDATE cases SET auto_status_last_on = ? WHERE id = ?')->execute([$today, $case['id']]);
    $pdo->prepare("INSERT INTO correspondence (case_id, occurred_on, direction, method, contact_id, contact_text, subject, follow_up_on, created_by, created_at) VALUES (?, ?, 'out', 'email', ?, ?, ?, ?, ?, ?)")
        ->execute([$case['id'], $today, in_array($case['auto_status_to'], ['attorney', 'both'], true) ? $case['attorney_contact_id'] : null, mb_substr(implode(', ', $sent), 0, 160),
            $kind === 'auto' ? 'Status update request (automatic)' : 'Status update request (emailed)', null, $user['id'] ?? null, now_str()]);
    audit('status_request_' . $kind, 'case', $case['id'], (int)$case['id'], $user ?? ['id' => null, 'email' => 'system', 'practice_id' => $practice['id']], count($sent) . ' recipient' . (count($sent) === 1 ? '' : 's'));
    return ['sent' => count($sent), 'to' => $sent];
}

// Finds a live request by its link token (with its case and practice).
function status_by_token(string $token): ?array {
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $s = pi_db()->prepare('SELECT * FROM status_requests WHERE token_hash = ?');
    $s->execute([hash('sha256', $token)]);
    if (!$r = $s->fetch()) return null;
    $c = pi_db()->prepare('SELECT * FROM cases WHERE id = ?'); $c->execute([$r['case_id']]);
    $p = pi_db()->prepare('SELECT * FROM practices WHERE id = ?'); $p->execute([$r['practice_id']]);
    return ['request' => $r, 'case' => $c->fetch(), 'practice' => $p->fetch()];
}

// Plain-text summary of a reply, for the correspondence log and the task.
function status_reply_summary(array $r): string {
    $lines = ['Status: ' . (STATUS_REPLY_OPTIONS[$r['status']] ?? $r['status'])];
    foreach (STATUS_REPLY_DATES as $k => $l) if (!empty($r[$k])) $lines[] = "$l: " . us_date($r[$k]);
    if (!empty($r['payment_sent_on']) || !empty($r['payment_amount'])) $lines[] = 'Payment sent: ' . ($r['payment_amount'] ? '$' . number_format((float)$r['payment_amount'], 2) : 'amount not given') . ($r['payment_sent_on'] ? ' on ' . us_date($r['payment_sent_on']) : '') . ($r['check_number'] ? ' (check #' . $r['check_number'] . ')' : '');
    if (!empty($r['narrative'])) $lines[] = 'Final narrative report: ' . STATUS_NARRATIVE[$r['narrative']] . (!empty($r['fee_ack']) ? ' — fee of $' . number_format((float)$r['narrative_fee'], 2) . ' acknowledged' : '');
    if (!empty($r['needs'])) $lines[] = 'Needs from the office: ' . implode(', ', array_map(fn($k) => STATUS_NEEDS[$k], $r['needs']));
    if (!empty($r['note'])) $lines[] = 'Note: ' . $r['note'];
    $lines[] = 'Replied by: ' . $r['name'] . (!empty($r['email']) ? ' <' . $r['email'] . '>' : '');
    return implode("\n", $lines);
}
