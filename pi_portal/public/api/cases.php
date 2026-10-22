<?php
// Cases and everything that hangs off a case: checklist, referrals
// (co-management), visits, outcome assessments, correspondence, the
// ledger, tasks — plus the dashboard, A/R report and letters.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

// ---------- field specs ----------
// Type codes: str:N, date, money, bool, int, enc (encrypted text), contact
// (contacts.id), user (users.id), coverage / charge (a coverage or charge
// on the same case), enum => [allowed values].
const PATIENT_FIELDS = [
    'first_name' => 'str:80', 'last_name' => 'str:80',
    'dob' => 'enc', 'phone' => 'enc', 'email' => 'enc', 'address' => 'enc',
];
const CASE_FIELDS = [
    'stage' => ['intake','treating','tx_complete','demand','litigation','mediation','negotiating','settled','closed','dropped'],
    'injury_type' => ['auto','slip_fall','workers_comp'],
    'date_of_injury' => 'date', 'first_visit' => 'date', 'discharge_date' => 'date',
    'referral_source' => ['attorney','self','provider','other'],
    'referred_by_contact_id' => 'contact', 'referred_by_text' => 'str:160',
    'attorney_contact_id' => 'contact', 'emc_status' => ['pending','yes','no'],
    'lop_signed_on' => 'date', 'lop_acknowledged_on' => 'date',
    'balance_forwarded_on' => 'date', 'balance_forwarded_amount' => 'money',
    'actively_treating' => 'bool', 'provider_user_id' => 'user', 'notes' => 'enc',
    'atty_offer' => 'money', 'final_settlement' => 'money', 'date_authorized' => 'date', 'check_received_on' => 'date',
];
// These need finance.write instead of case.write. Billing can also move a
// case through the legal / settlement stages.
const FINANCE_CASE_FIELDS = ['atty_offer', 'final_settlement', 'date_authorized', 'check_received_on', 'balance_forwarded_on', 'balance_forwarded_amount'];

const CHILD_SPECS = [
    'referrals' => ['perm' => 'clinical.write', 'required' => ['type'], 'fields' => [
        'direction' => ['out','in'], 'type' => ['mri','xray','ct','emc','ortho','neuro','pain_mgmt','surgical','pt','other'],
        'contact_id' => 'contact', 'facility_text' => 'str:160', 'body_region' => 'str:120',
        'status' => ['ordered','scheduled','completed','report_received','no_show','cancelled'],
        'ordered_on' => 'date', 'scheduled_on' => 'date', 'completed_on' => 'date', 'report_received_on' => 'date',
        'entered_in_chart' => 'bool', 'findings' => 'enc', 'notes' => 'enc',
    ]],
    'visits' => ['perm' => 'clinical.write', 'required' => ['visit_date'], 'fields' => [
        'visit_date' => 'date', 'visit_type' => ['initial','treatment','re_exam','discharge','no_show'],
        'provider_user_id' => 'user', 'cpt_codes' => 'str:255', 'dwc25_sent' => 'bool', 'notes' => 'enc',
    ]],
    // Front desk enters insurance at intake; billing updates it later.
    'coverages' => ['perm_any' => ['case.write', 'finance.write'], 'required' => ['type'], 'fields' => [
        'type' => ['pip','medpay','health','workers_comp'], 'priority' => 'int',
        'carrier_contact_id' => 'contact', 'carrier_text' => 'str:160', 'adjuster' => 'str:160',
        'claim_number' => 'enc', 'policy_number' => 'enc',
        'status' => ['active','denied','exhausted','closed'], 'status_on' => 'date', 'status_reason' => 'str:255',
        'benefit_limit' => 'money', 'authorized_visits' => 'int', 'authorized_through' => 'date', 'notes' => 'enc',
    ]],
    'outcomes' => ['perm' => 'clinical.write', 'required' => ['measure', 'score', 'taken_on'], 'fields' => [
        'measure' => ['bournemouth_neck','bournemouth_back','oswestry','ndi','hdi','shoulder','knee','adl'],
        'score' => 'money', 'taken_on' => 'date',
    ]],
    'correspondence' => ['perm' => 'case.read', 'required' => ['occurred_on', 'subject'], 'fields' => [
        'occurred_on' => 'date', 'direction' => ['out','in'], 'method' => ['fax','email','phone','mail','portal','in_person'],
        'contact_id' => 'contact', 'contact_text' => 'str:160', 'subject' => 'str:200', 'notes' => 'enc',
        'follow_up_on' => 'date', 'follow_up_done' => 'bool',
    ]],
    'ledger' => ['perm' => 'finance.write', 'required' => ['entry_date', 'kind', 'bucket', 'amount'], 'fields' => [
        'entry_date' => 'date', 'kind' => ['charge','payment','adjustment','reduction','write_off','transfer'],
        'bucket' => ['insurance','patient'], 'coverage_id' => 'coverage',
        'to_bucket' => ['insurance','patient'], 'to_coverage_id' => 'coverage', 'applies_to_id' => 'charge',
        'amount' => 'money', 'reference' => 'str:120', 'memo' => 'str:255',
    ]],
];

// Turns request input into column => value for the keys present in $in.
// Encrypted fields map "notes" -> "notes_enc".
function clean_fields(array $spec, array $in, ?int $caseId = null): array {
    $out = [];
    foreach ($spec as $name => $type) {
        if (!array_key_exists($name, $in)) continue;
        $v = $in[$name];
        if (is_array($type)) {
            if ($v === null || $v === '') { $out[$name] = null; continue; }
            if (!in_array($v, $type, true)) json_response(['error' => "Invalid value for $name"], 400);
            $out[$name] = $v;
        } elseif ($type === 'date') $out[$name] = date_or_null($v);
        elseif ($type === 'money') $out[$name] = money_or_null($v);
        elseif ($type === 'bool') $out[$name] = $v ? 1 : 0;
        elseif ($type === 'int') $out[$name] = ($v === null || $v === '') ? null : max(0, (int)$v);
        elseif ($type === 'coverage' || $type === 'charge') {
            $id = ($v === null || $v === '') ? null : (int)$v;
            if ($id) {
                $stmt = pi_db()->prepare($type === 'coverage' ? 'SELECT id FROM coverages WHERE id = ? AND case_id = ?' : "SELECT id FROM ledger WHERE id = ? AND case_id = ? AND kind = 'charge'");
                $stmt->execute([$id, (int)$caseId]);
                if (!$stmt->fetch()) json_response(['error' => "Unknown $name"], 400);
            }
            $out[$name] = $id;
        }
        elseif ($type === 'enc') $out[$name . '_enc'] = enc(str_or_null($v, 20000));
        elseif ($type === 'contact' || $type === 'user') {
            $id = ($v === null || $v === '') ? null : (int)$v;
            if ($id) {
                $stmt = pi_db()->prepare($type === 'contact' ? 'SELECT id FROM contacts WHERE id = ? AND practice_id = ?' : 'SELECT id FROM users WHERE id = ? AND practice_id = ?');
                $stmt->execute([$id, pid()]);
                if (!$stmt->fetch()) json_response(['error' => "Unknown $name"], 400);
            }
            $out[$name] = $id;
        } elseif (strncmp($type, 'str:', 4) === 0) $out[$name] = str_or_null($v, (int)substr($type, 4));
    }
    return $out;
}

// Row -> API shape: *_enc columns decrypted under their plain name.
function decrypt_row(array $r): array {
    foreach ($r as $k => $v) {
        if (substr($k, -4) === '_enc') { unset($r[$k]); $r[substr($k, 0, -4)] = dec($v); }
    }
    return $r;
}

function insert_row(string $table, array $cols): int {
    $sql = "INSERT INTO $table (" . implode(',', array_keys($cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
    pi_db()->prepare($sql)->execute(array_values($cols));
    return (int)pi_db()->lastInsertId();
}

function update_row(string $table, int $id, array $cols) {
    if (!$cols) return;
    $sql = "UPDATE $table SET " . implode(',', array_map(fn($c) => "$c = ?", array_keys($cols))) . ' WHERE id = ?';
    pi_db()->prepare($sql)->execute([...array_values($cols), $id]);
}

// Audit detail names the fields that changed, never their values.
function field_names(array $cols): string {
    return implode(',', array_map(fn($c) => preg_replace('/_enc$/', '', $c), array_keys($cols)));
}

function patient_name(array $p): string {
    return trim($p['first_name'] . ' ' . $p['last_name']);
}

// ---------- list ----------
function handle_list() {
    $user = require_user('case.read');
    $pdo = pi_db();
    $where = ['c.practice_id = ?', 'c.archived_at IS NULL'];
    $args = [pid()];
    $stage = $_GET['stage'] ?? 'open';
    if ($stage === 'open') $where[] = "c.stage IN ('" . implode("','", OPEN_STAGES) . "')";
    elseif ($stage === 'legal') $where[] = "c.stage IN ('" . implode("','", LEGAL_STAGES) . "')";
    elseif (isset(STAGES[$stage])) { $where[] = 'c.stage = ?'; $args[] = $stage; }
    if (!empty($_GET['attorney'])) { $where[] = 'c.attorney_contact_id = ?'; $args[] = (int)$_GET['attorney']; }
    if (!empty($_GET['benefits'])) { $where[] = 'c.benefits = ?'; $args[] = $_GET['benefits']; }
    if (($q = trim($_GET['q'] ?? '')) !== '') {
        $where[] = '(p.first_name LIKE ? OR p.last_name LIKE ? OR CONCAT(p.first_name, " ", p.last_name) LIKE ? OR c.case_number LIKE ?)';
        $like = '%' . $q . '%';
        array_push($args, $like, $like, $like, $like);
    }
    $sql = 'SELECT c.*, p.first_name, p.last_name, a.organization atty_org, a.name atty_name
            FROM cases c JOIN patients p ON p.id = c.patient_id
            LEFT JOIN contacts a ON a.id = c.attorney_contact_id
            WHERE ' . implode(' AND ', $where) . ' ORDER BY p.last_name, p.first_name LIMIT 1000';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($args);
    $cases = $stmt->fetchAll();
    $ctx = bulk_case_context($pdo, $cases);
    $bal = fin_can($user, 'balances');
    $rows = [];
    foreach ($cases as $c) {
        $x = $ctx[(int)$c['id']];
        $alerts = case_alerts($c, $x);
        $rows[] = [
            'id' => (int)$c['id'], 'caseNumber' => $c['case_number'], 'patient' => patient_name($c),
            'stage' => $c['stage'], 'benefits' => $c['benefits'], 'doi' => $c['date_of_injury'],
            'firstVisit' => $c['first_visit'], 'lastVisit' => $x['lastVisit'], 'lastCorrespondence' => $x['lastCorrespondence'],
            'attorney' => trim(($c['atty_org'] ?? '') . ($c['atty_name'] ? ' — ' . $c['atty_name'] : ''), ' —'),
            'activelyTreating' => (bool)$c['actively_treating'], 'emc' => $c['emc_status'],
            'balance' => $bal ? $x['totals']['total_balance'] : null, 'insuranceBalance' => $bal ? $x['totals']['insurance_balance'] : null, 'patientBalance' => $bal ? $x['totals']['patient_balance'] : null,
            'alerts' => count($alerts), 'highAlerts' => count(array_filter($alerts, fn($a) => $a['level'] === 'high')),
            'checklistDone' => count(array_filter($x['checklist'], fn($i) => in_array($i['status'], ['done', 'na'], true))),
            'checklistTotal' => count($x['checklist']),
        ];
    }
    audit('list', 'case', null, null, $user, ['count' => count($rows), 'filter' => $stage]);
    json_response(['cases' => $rows]);
}

// ---------- full case ----------
function full_case(int $id, array $user): array {
    $pdo = pi_db();
    $c = case_or_404($id);
    $stmt = $pdo->prepare('SELECT * FROM patients WHERE id = ?');
    $stmt->execute([$c['patient_id']]);
    $patient = decrypt_row($stmt->fetch());
    $fetch = function (string $sql) use ($pdo, $id) { $s = $pdo->prepare($sql); $s->execute([$id]); return $s->fetchAll(); };
    $milestones = $fetch('SELECT * FROM case_milestones WHERE case_id = ?');
    $referrals = array_map('decrypt_row', $fetch('SELECT r.*, k.organization contact_org, k.name contact_name FROM referrals r LEFT JOIN contacts k ON k.id = r.contact_id WHERE r.case_id = ? AND r.archived_at IS NULL ORDER BY COALESCE(r.ordered_on, r.created_at)'));
    $visits = array_map('decrypt_row', $fetch('SELECT v.*, u.name provider_name FROM visits v LEFT JOIN users u ON u.id = v.provider_user_id WHERE v.case_id = ? AND v.archived_at IS NULL ORDER BY v.visit_date DESC'));
    $outcomes = $fetch('SELECT * FROM outcomes WHERE case_id = ? AND archived_at IS NULL ORDER BY taken_on');
    $corr = array_map('decrypt_row', $fetch('SELECT r.*, k.organization contact_org, k.name contact_name FROM correspondence r LEFT JOIN contacts k ON k.id = r.contact_id WHERE r.case_id = ? AND r.archived_at IS NULL ORDER BY r.occurred_on DESC, r.id DESC'));
    $ledger = $fetch("SELECT l.*, u.name updated_by_name FROM ledger l LEFT JOIN users u ON u.id = COALESCE(l.updated_by, l.created_by) WHERE l.case_id = ? AND l.archived_at IS NULL ORDER BY l.entry_date, l.id");
    $tasks = $fetch('SELECT t.*, u.name assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_user_id WHERE t.case_id = ? ORDER BY t.done_at IS NOT NULL, t.due_on');
    $ehr = $fetch('SELECT e.id, e.ehr_system, e.uploaded_at, e.document_id, u.name uploaded_by_name FROM ehr_imports e LEFT JOIN users u ON u.id = e.uploaded_by WHERE e.case_id = ? ORDER BY e.id DESC LIMIT 1')[0] ?? null;
    $docs = $fetch('SELECT d.id, d.category, d.original_name, d.mime_type, d.size_bytes, d.uploaded_at, u.name uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.case_id = ? AND d.archived_at IS NULL ORDER BY d.uploaded_at DESC');
    $coverages = array_map('decrypt_row', $fetch('SELECT cv.*, k.organization carrier_org, k.name carrier_name, k.phone carrier_phone, k.fax carrier_fax FROM coverages cv LEFT JOIN contacts k ON k.id = cv.carrier_contact_id WHERE cv.case_id = ? AND cv.archived_at IS NULL ORDER BY cv.priority, cv.id'));
    $contacts = [];
    foreach (['attorney_contact_id', 'referred_by_contact_id'] as $k) {
        if ($c[$k]) { $s = $pdo->prepare('SELECT * FROM contacts WHERE id = ? AND practice_id = ?'); $s->execute([$c[$k], pid()]); $contacts[$k] = $s->fetch() ?: null; }
    }

    // Balances are computed from the whole ledger even for roles that can't
    // see the entries, so alerts stay accurate.
    $allLedger = $fetch('SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL ORDER BY entry_date, id');
    $totals = ledger_totals($allLedger);
    $openItems = ledger_open_items($allLedger);
    $attended = array_filter($visits, fn($v) => $v['visit_type'] !== 'no_show');
    $visitDates = array_column($attended, 'visit_date');
    $cutoff = add_days(date('Y-m-d'), -WC_DWC25_DAYS);
    $checklist = case_checklist($c, $milestones, $referrals);
    $ctx = [
        'checklist' => $checklist, 'referrals' => $referrals, 'totals' => $totals, 'coverages' => $coverages, 'openItems' => $openItems,
        'wcVisits' => ['count' => count($attended), 'missing25' => count(array_filter($attended, fn($v) => !$v['dwc25_sent'] && $v['visit_date'] <= $cutoff))],
        'lastVisit' => $visitDates ? max($visitDates) : null,
        'lastCorrespondence' => $corr ? $corr[0]['occurred_on'] : null,
        'lastOutcome' => $outcomes ? max(array_column($outcomes, 'taken_on')) : null,
        'openFollowUps' => array_filter($corr, fn($r) => $r['follow_up_on'] && !$r['follow_up_done']),
    ];
    $case = decrypt_row($c);
    $case['pip_effective_limit'] = pip_effective_limit($c, first_coverage($coverages, 'pip'));
    $bal = fin_can($user, 'balances'); $led = fin_can($user, 'ledger'); $set = fin_can($user, 'settlement');
    if (!$set) {
        foreach (['atty_offer', 'final_settlement', 'date_authorized', 'check_received_on', 'balance_forwarded_amount'] as $k) $case[$k] = null;
        unset($totals['reduction_floor']);
    }
    $alerts = case_alerts($c, $ctx);
    if (!$bal) $alerts = array_map(fn($a) => ['level' => $a['level'], 'text' => redact_money($a['text'])], $alerts);
    if (!$bal) $corr = array_map(fn($r) => str_contains($r['subject'], 'forwarded to attorney') ? ['subject' => 'Patient balance forwarded to attorney'] + $r : $r, $corr);
    return [
        'case' => $case, 'patient' => $patient, 'contacts' => $contacts, 'coverages' => $coverages,
        'checklist' => $checklist, 'alerts' => $alerts,
        'referrals' => $referrals, 'visits' => $visits, 'outcomes' => $outcomes,
        'correspondence' => $corr, 'ledger' => $led ? $ledger : [], 'openItems' => $led ? $openItems : [], 'totals' => $bal ? $totals : null,
        'fin' => fin_scopes($user),
        'tasks' => $tasks, 'documents' => $docs, 'ehr' => $ehr,
        'stats' => ['visitCount' => count($visitDates), 'lastVisit' => $ctx['lastVisit']],
    ];
}

// Keeps cases.benefits (the summary used by list filters and reports) in
// step with the case's coverages.
function sync_benefits(int $caseId) {
    $c = case_or_404($caseId);
    $s = pi_db()->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id');
    $s->execute([$caseId]);
    pi_db()->prepare('UPDATE cases SET benefits = ? WHERE id = ?')->execute([derive_benefits($s->fetchAll(), $c['injury_type']), $caseId]);
}

function handle_get() {
    $user = require_user('case.read');
    $id = (int)($_GET['id'] ?? 0);
    $data = full_case($id, $user);
    audit('view', 'case', $id, $id, $user);
    json_response($data);
}

// ---------- create / update ----------
function handle_create() {
    require_method('POST');
    $user = require_user('case.write');
    enforce_limit('cases');
    $b = json_body();
    $pdo = pi_db();
    $pdo->beginTransaction();
    if (!empty($b['patient_id'])) {
        $patientId = (int)$b['patient_id'];
        $s = $pdo->prepare('SELECT id FROM patients WHERE id = ? AND practice_id = ?');
        $s->execute([$patientId, pid()]);
        if (!$s->fetch()) json_response(['error' => 'Unknown patient'], 400);
    } else {
        $p = clean_fields(PATIENT_FIELDS, $b['patient'] ?? []);
        if (empty($p['first_name'])) json_response(['error' => "Enter the patient's first name."], 400);
        $p['last_name'] = $p['last_name'] ?? '';
        $p['practice_id'] = pid();
        $p['created_at'] = $p['updated_at'] = now_str();
        $patientId = insert_row('patients', $p);
    }
    $cols = clean_fields(CASE_FIELDS, $b['case'] ?? []);
    $cols['practice_id'] = pid();
    $cols['patient_id'] = $patientId;
    $cols['case_number'] = next_case_number($pdo);
    $cols['created_at'] = $cols['updated_at'] = now_str();
    foreach (['stage' => 'intake', 'injury_type' => 'auto', 'emc_status' => 'pending', 'actively_treating' => 1] as $k => $def) {
        if (!isset($cols[$k])) $cols[$k] = $def;
    }
    $id = insert_row('cases', $cols);
    // Insurance entered on the new-case form.
    if (!empty($b['coverage']['type'])) {
        $cv = clean_fields(CHILD_SPECS['coverages']['fields'], $b['coverage'], $id);
        $cv += ['case_id' => $id, 'priority' => 1, 'status' => 'active', 'created_by' => $user['id'], 'created_at' => now_str(), 'updated_at' => now_str()];
        if ($cv['type'] === 'pip' && !isset($cv['benefit_limit'])) $cv['benefit_limit'] = PIP_DEFAULT_LIMIT;
        insert_row('coverages', $cv);
    }
    sync_benefits($id);
    $pdo->commit();
    audit('create', 'case', $id, $id, $user);
    json_response(['id' => $id, 'caseNumber' => $cols['case_number']]);
}

function next_case_number(PDO $pdo): string {
    $prefix = 'PI-' . date('y') . '-';
    $stmt = $pdo->prepare('SELECT case_number FROM cases WHERE practice_id = ? AND case_number LIKE ? ORDER BY case_number DESC LIMIT 1 FOR UPDATE');
    $stmt->execute([pid(), $prefix . '%']);
    $last = $stmt->fetchColumn();
    $n = $last ? (int)substr($last, strlen($prefix)) + 1 : 1;
    return $prefix . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
}

function handle_update() {
    require_method('POST');
    $user = require_user('case.read');
    $id = (int)($_GET['id'] ?? 0);
    $c = case_or_404($id);
    $b = json_body();
    $caseIn = $b['case'] ?? [];
    $patientIn = $b['patient'] ?? [];

    $financeOnly = array_intersect_key($caseIn, array_flip(FINANCE_CASE_FIELDS));
    $general = array_diff_key($caseIn, array_flip(FINANCE_CASE_FIELDS));
    // Billing may move a case between the post-treatment stages without
    // general case-edit rights.
    if (isset($general['stage']) && !can($user, 'case.write') && can($user, 'finance.write')
        && in_array($general['stage'], array_merge(LEGAL_STAGES, ['settled', 'closed']), true)) {
        $financeOnly['stage'] = $general['stage'];
        unset($general['stage']);
    }
    if (($general || $patientIn) && !can($user, 'case.write')) json_response(['error' => 'Your role does not allow editing case details.'], 403);
    if ($financeOnly && !can($user, 'finance.write')) json_response(['error' => 'Your role does not allow editing financial fields.'], 403);

    $cols = clean_fields(CASE_FIELDS, $caseIn);
    if (array_key_exists('stage', $cols) && $cols['stage'] === null) unset($cols['stage']);
    if (!empty($cols)) {
        $cols['updated_at'] = now_str();
        update_row('cases', $id, $cols);
    }
    $pcols = clean_fields(PATIENT_FIELDS, $patientIn);
    if (array_key_exists('first_name', $pcols) && !$pcols['first_name']) json_response(['error' => "First name can't be blank."], 400);
    if (array_key_exists('last_name', $pcols)) $pcols['last_name'] = $pcols['last_name'] ?? '';
    if ($pcols) {
        $pcols['updated_at'] = now_str();
        update_row('patients', (int)$c['patient_id'], $pcols);
    }
    if (array_key_exists('injury_type', $cols)) sync_benefits($id);
    audit('update', 'case', $id, $id, $user, field_names(array_merge($cols, $pcols)));
    json_response(full_case($id, $user));
}

// ---------- checklist ----------
function handle_milestone() {
    require_method('POST');
    $user = require_user('case.write');
    $id = (int)($_GET['id'] ?? 0);
    case_or_404($id);
    $b = json_body();
    $key = (string)($b['key'] ?? '');
    if (!isset(CHECKLIST[$key])) json_response(['error' => 'Unknown checklist item'], 400);
    pi_db()->prepare('REPLACE INTO case_milestones (case_id, milestone, completed_on, not_applicable, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)')
        ->execute([$id, $key, date_or_null($b['completed_on'] ?? null), !empty($b['not_applicable']) ? 1 : 0, str_or_null($b['note'] ?? null), $user['id'], now_str()]);
    touch_case($id);
    audit('update', 'milestone', $key, $id, $user);
    json_response(full_case($id, $user));
}

// ---------- child rows ----------
// Cases whose money comes from uploaded EHR ledgers: the EHR is the source
// of truth, so ledger lines aren't changed here.
function ehr_guard(array $case) {
    if ($case['ehr_synced_at']) {
        json_response(['error' => "This case's financials come from " . $case['ehr_system'] . '. Make the change there, then upload the updated ledger.', 'code' => 'ehr_synced'], 409);
    }
}

function can_child(array $user, array $spec): bool {
    foreach ($spec['perm_any'] ?? [$spec['perm']] as $p) if (can($user, $p)) return true;
    return false;
}

// Makes a ledger row internally consistent (who owes it, where a transfer
// goes) before it's saved. $row is the full row after the edit.
function normalize_ledger(array $row): array {
    if ($row['bucket'] === 'patient') $row['coverage_id'] = null;
    if ($row['kind'] === 'transfer') {
        if (empty($row['to_bucket'])) json_response(['error' => 'Choose where the balance moves to.'], 400);
        if ($row['to_bucket'] === 'patient') $row['to_coverage_id'] = null;
        elseif (empty($row['to_coverage_id'])) json_response(['error' => 'Choose which insurance the balance moves to.'], 400);
        if ($row['bucket'] === $row['to_bucket'] && (int)$row['coverage_id'] === (int)$row['to_coverage_id']) json_response(['error' => 'A move needs a different destination.'], 400);
    } else {
        $row['to_bucket'] = null; $row['to_coverage_id'] = null;
    }
    if ($row['kind'] === 'charge') $row['applies_to_id'] = null;
    if (!isset($row['amount']) || $row['amount'] <= 0) json_response(['error' => 'Enter a positive amount — the entry type decides whether it adds or subtracts.'], 400);
    return $row;
}

function handle_child_save() {
    require_method('POST');
    $user = require_user('case.read');
    $caseId = (int)($_GET['id'] ?? 0);
    $case = case_or_404($caseId);
    $b = json_body();
    $table = (string)($b['table'] ?? '');
    $spec = CHILD_SPECS[$table] ?? json_response(['error' => 'Unknown record type'], 400);
    if (!can_child($user, $spec)) json_response(['error' => 'Your role does not allow this.'], 403);
    if ($table === 'ledger') ehr_guard($case);
    $cols = clean_fields($spec['fields'], $b['row'] ?? [], $caseId);
    $childId = (int)($b['row']['id'] ?? 0);

    if ($childId) {
        $existing = child_or_404($table, $childId, $caseId);
        if ($table === 'ledger') {
            // Payments often arrive weeks or months late, so ledger rows are
            // never locked: any field can be corrected, and the edit is audited.
            $merged = normalize_ledger(array_merge($existing, $cols));
            $cols = array_intersect_key($merged, array_flip(['entry_date', 'kind', 'bucket', 'coverage_id', 'to_bucket', 'to_coverage_id', 'applies_to_id', 'amount', 'reference', 'memo']));
            if (($cols['applies_to_id'] ?? null) === $childId) json_response(['error' => "An entry can't apply to itself."], 400);
            $cols += ['updated_by' => $user['id'], 'updated_at' => now_str()];
        }
        if (in_array($table, ['referrals', 'coverages'], true)) $cols['updated_at'] = now_str();
        update_row($table, $childId, $cols);
        audit('update', $table, $childId, $caseId, $user, field_names($cols));
    } else {
        foreach ($spec['required'] as $r) {
            if (!isset($cols[$r]) || $cols[$r] === null || $cols[$r] === '') json_response(['error' => 'Missing ' . str_replace('_', ' ', $r)], 400);
        }
        if ($table === 'ledger') $cols = normalize_ledger($cols + ['coverage_id' => null, 'to_bucket' => null, 'to_coverage_id' => null, 'applies_to_id' => null]);
        if ($table === 'coverages') {
            $n = pi_db()->prepare('SELECT COUNT(*) FROM coverages WHERE case_id = ? AND archived_at IS NULL');
            $n->execute([$caseId]);
            $cols += ['priority' => (int)$n->fetchColumn() + 1, 'status' => 'active'];
            if ($cols['type'] === 'pip' && !isset($cols['benefit_limit'])) $cols['benefit_limit'] = PIP_DEFAULT_LIMIT;
        }
        $cols['case_id'] = $caseId;
        $cols['created_by'] = $user['id'];
        $cols['created_at'] = now_str();
        if (in_array($table, ['referrals', 'coverages'], true)) $cols['updated_at'] = now_str();
        $childId = insert_row($table, $cols);
        audit('create', $table, $childId, $caseId, $user);
        // A visit can post its charge in the same step, billed to a chosen
        // coverage or straight to the patient balance (not on EHR-synced cases).
        if ($table === 'visits' && !empty($b['charge']['amount']) && can($user, 'finance.write') && !$case['ehr_synced_at']) {
            $amount = money_or_null($b['charge']['amount']);
            $target = (string)($b['charge']['to'] ?? 'patient');
            $coverageId = $target === 'patient' ? null : (clean_fields(['c' => 'coverage'], ['c' => $target], $caseId)['c'] ?? null);
            if ($amount > 0) {
                $lid = insert_row('ledger', [
                    'case_id' => $caseId, 'entry_date' => $cols['visit_date'], 'kind' => 'charge',
                    'bucket' => $coverageId ? 'insurance' : 'patient', 'coverage_id' => $coverageId, 'visit_id' => $childId,
                    'amount' => $amount, 'reference' => 'Visit #' . $childId,
                    'memo' => !empty($cols['cpt_codes']) ? 'CPT ' . $cols['cpt_codes'] : 'Office visit',
                    'created_by' => $user['id'], 'created_at' => now_str(),
                ]);
                audit('create', 'ledger', $lid, $caseId, $user);
            }
        }
    }
    if ($table === 'coverages') sync_benefits($caseId);
    // First visit logged on an intake case starts the treating stage.
    if ($table === 'visits') {
        $c = case_or_404($caseId);
        $upd = [];
        $vd = $cols['visit_date'] ?? null;
        $attended = ($cols['visit_type'] ?? 'treatment') !== 'no_show';
        if ($vd && $attended && (!$c['first_visit'] || $vd < $c['first_visit'])) $upd['first_visit'] = $vd;
        if ($attended && $c['stage'] === 'intake') $upd['stage'] = 'treating';
        if (($cols['visit_type'] ?? null) === 'discharge') { $upd['discharge_date'] = $cols['visit_date']; $upd['actively_treating'] = 0; if (in_array($c['stage'], ['intake', 'treating'], true)) $upd['stage'] = 'tx_complete'; }
        if ($upd) update_row('cases', $caseId, $upd);
    }
    touch_case($caseId);
    json_response(full_case($caseId, $user));
}

// Moves money between insurance and the patient balance — the 20% PIP
// doesn't pay, a denial, exhaustion, or back to insurance when a late
// payment arrives. Always a deliberate action by a person; one transfer
// row per charge, so each date of service keeps an accurate open balance.
function handle_move_balance() {
    require_method('POST');
    $user = require_user('finance.write');
    $caseId = (int)($_GET['id'] ?? 0);
    ehr_guard(case_or_404($caseId));
    $b = json_body();
    $date = date_or_null($b['date'] ?? date('Y-m-d')) ?? date('Y-m-d');
    $reason = str_or_null($b['reason'] ?? null, 255);
    $to = (string)($b['to'] ?? 'patient');
    $toCoverage = $to === 'patient' ? null : clean_fields(['c' => 'coverage'], ['c' => $to], $caseId)['c'];
    $items = is_array($b['items'] ?? null) ? $b['items'] : [];
    if (!$items) json_response(['error' => 'Nothing selected to move.'], 400);
    $pdo = pi_db();
    $pdo->beginTransaction();
    $n = 0;
    foreach ($items as $it) {
        $from = ($it['from'] ?? '') === 'patient' ? 'patient' : 'insurance';
        $row = normalize_ledger(clean_fields(CHILD_SPECS['ledger']['fields'], [
            'coverage_id' => $from === 'insurance' ? ($it['coverage_id'] ?? null) : null,
            'applies_to_id' => $it['applies_to_id'] ?? null, 'amount' => $it['amount'] ?? null,
        ], $caseId) + ['kind' => 'transfer', 'bucket' => $from, 'to_bucket' => $toCoverage ? 'insurance' : 'patient', 'to_coverage_id' => $toCoverage]);
        $row += ['case_id' => $caseId, 'entry_date' => $date, 'memo' => $reason, 'created_by' => $user['id'], 'created_at' => now_str()];
        $lid = insert_row('ledger', $row);
        audit('create', 'ledger', $lid, $caseId, $user, 'transfer');
        $n++;
    }
    $pdo->commit();
    touch_case($caseId);
    json_response(full_case($caseId, $user) + ['moved' => $n]);
}

// Records that the patient balance was sent to the attorney (at
// settlement), logs it as correspondence, and returns the case; the page
// then opens the itemized statement to print or fax.
function handle_forward_balance() {
    require_method('POST');
    $user = require_user('finance.write');
    $caseId = (int)($_GET['id'] ?? 0);
    $c = case_or_404($caseId);
    $b = json_body();
    $s = pi_db()->prepare('SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL');
    $s->execute([$caseId]);
    $amount = money_or_null($b['amount'] ?? null) ?? ledger_totals($s->fetchAll())['patient_balance'];
    $date = date_or_null($b['date'] ?? date('Y-m-d')) ?? date('Y-m-d');
    update_row('cases', $caseId, ['balance_forwarded_on' => $date, 'balance_forwarded_amount' => $amount, 'updated_at' => now_str()]);
    insert_row('correspondence', [
        'case_id' => $caseId, 'occurred_on' => $date, 'direction' => 'out',
        'method' => enum_or($b['method'] ?? '', ['fax', 'email', 'mail', 'portal'], 'fax'),
        'contact_id' => $c['attorney_contact_id'], 'subject' => 'Patient balance forwarded to attorney: $' . number_format($amount, 2),
        'created_by' => $user['id'], 'created_at' => now_str(),
    ]);
    audit('forward_balance', 'case', $caseId, $caseId, $user);
    json_response(full_case($caseId, $user));
}

function handle_child_archive() {
    require_method('POST');
    $user = require_user('case.read');
    $caseId = (int)($_GET['id'] ?? 0);
    $b = json_body();
    $table = (string)($b['table'] ?? '');
    $spec = CHILD_SPECS[$table] ?? json_response(['error' => 'Unknown record type'], 400);
    if (!can_child($user, $spec)) json_response(['error' => 'Your role does not allow this.'], 403);
    if ($table === 'ledger') ehr_guard(case_or_404($caseId));
    $childId = (int)($b['child_id'] ?? 0);
    child_or_404($table, $childId, $caseId);
    pi_db()->prepare("UPDATE $table SET archived_at = ? WHERE id = ?")->execute([now_str(), $childId]);
    touch_case($caseId);
    if ($table === 'coverages') sync_benefits($caseId);
    audit('archive', $table, $childId, $caseId, $user);
    json_response(full_case($caseId, $user));
}

// ---------- tasks ----------
function handle_tasks() {
    $user = require_user('case.read');
    $mine = ($_GET['scope'] ?? '') === 'mine';
    $sql = 'SELECT t.*, u.name assigned_name, c.case_number, p.first_name, p.last_name
            FROM tasks t LEFT JOIN users u ON u.id = t.assigned_user_id
            LEFT JOIN cases c ON c.id = t.case_id LEFT JOIN patients p ON p.id = c.patient_id
            WHERE t.practice_id = ? AND t.done_at IS NULL' . ($mine ? ' AND t.assigned_user_id = ?' : '') . ' ORDER BY t.due_on IS NULL, t.due_on LIMIT 500';
    $stmt = pi_db()->prepare($sql);
    $stmt->execute($mine ? [pid(), $user['id']] : [pid()]);
    $rows = array_map(function ($t) {
        $t['patient'] = $t['case_id'] ? patient_name($t) : null;
        unset($t['first_name'], $t['last_name']);
        return $t;
    }, $stmt->fetchAll());
    json_response(['tasks' => $rows]);
}

function handle_task_save() {
    require_method('POST');
    $user = require_user('case.read');
    $b = json_body();
    $id = (int)($b['id'] ?? 0);
    $caseId = !empty($b['case_id']) ? (int)$b['case_id'] : null;
    if ($caseId) case_or_404($caseId);
    $cols = [];
    if (array_key_exists('title', $b)) {
        $cols['title'] = str_or_null($b['title'], 200);
        if (!$cols['title']) json_response(['error' => 'Enter a task.'], 400);
    }
    if (array_key_exists('due_on', $b)) $cols['due_on'] = date_or_null($b['due_on']);
    if (array_key_exists('assigned_user_id', $b)) $cols['assigned_user_id'] = clean_fields(['a' => 'user'], ['a' => $b['assigned_user_id']])['a'];
    if (array_key_exists('done', $b)) $cols['done_at'] = $b['done'] ? now_str() : null;
    if ($id) {
        $t = child_or_404('tasks', $id);
        update_row('tasks', $id, $cols);
        $caseId = $t['case_id'] ? (int)$t['case_id'] : null;
        audit('update', 'task', $id, $caseId, $user, field_names($cols));
    } else {
        if (empty($cols['title'])) json_response(['error' => 'Enter a task.'], 400);
        $cols += ['practice_id' => pid(), 'case_id' => $caseId, 'created_by' => $user['id'], 'created_at' => now_str()];
        $id = insert_row('tasks', $cols);
        audit('create', 'task', $id, $caseId, $user);
    }
    json_response($caseId && !empty($b['return_case']) ? full_case($caseId, $user) : ['ok' => true, 'id' => $id]);
}

// ---------- dashboard ----------
function handle_dashboard() {
    $user = require_user('case.read');
    $pdo = pi_db();
    $stmt = $pdo->prepare("SELECT c.*, p.first_name, p.last_name FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')");
    $stmt->execute([pid()]);
    $cases = $stmt->fetchAll();
    $ctx = bulk_case_context($pdo, $cases);
    $byStage = array_fill_keys(array_keys(STAGES), 0);
    $stmt = $pdo->prepare('SELECT stage, COUNT(*) n FROM cases WHERE practice_id = ? AND archived_at IS NULL GROUP BY stage');
    $stmt->execute([pid()]);
    foreach ($stmt as $r) $byStage[$r['stage']] = (int)$r['n'];

    $alerts = [];
    $ar = ['insurance' => 0.0, 'patient' => 0.0, 'total' => 0.0, 'legal' => 0.0];
    $treating = 0;
    foreach ($cases as $c) {
        $x = $ctx[(int)$c['id']];
        foreach (case_alerts($c, $x) as $a) {
            if (!fin_can($user, 'balances')) $a['text'] = redact_money($a['text']);
            $alerts[] = $a + ['caseId' => (int)$c['id'], 'patient' => patient_name($c), 'caseNumber' => $c['case_number']];
        }
        $ar['insurance'] += $x['totals']['insurance_balance'];
        $ar['patient'] += $x['totals']['patient_balance'];
        $ar['total'] += $x['totals']['total_balance'];
        if (in_array($c['stage'], LEGAL_STAGES, true)) $ar['legal'] += $x['totals']['total_balance'];
        if ($c['actively_treating'] && in_array($c['stage'], ['intake', 'treating'], true)) $treating++;
    }
    $rank = ['high' => 0, 'medium' => 1, 'low' => 2];
    usort($alerts, fn($a, $b) => $rank[$a['level']] <=> $rank[$b['level']]);

    $stmt = $pdo->prepare('SELECT t.*, c.case_number, p.first_name, p.last_name FROM tasks t LEFT JOIN cases c ON c.id = t.case_id LEFT JOIN patients p ON p.id = c.patient_id
        WHERE t.practice_id = ? AND t.done_at IS NULL AND (t.assigned_user_id = ? OR t.assigned_user_id IS NULL) AND (t.due_on IS NULL OR t.due_on <= ?) ORDER BY t.due_on LIMIT 50');
    $stmt->execute([pid(), $user['id'], add_days(date('Y-m-d'), 7)]);
    $tasks = array_map(function ($t) { $t['patient'] = $t['case_id'] ? patient_name($t) : null; unset($t['first_name'], $t['last_name']); return $t; }, $stmt->fetchAll());

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM visits v JOIN cases c ON c.id = v.case_id WHERE c.practice_id = ? AND v.archived_at IS NULL AND v.visit_type <> 'no_show' AND v.visit_date >= ?");
    $stmt->execute([pid(), date('Y-m-d', strtotime('monday this week'))]);
    $visitsThisWeek = (int)$stmt->fetchColumn();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM cases WHERE practice_id = ? AND archived_at IS NULL AND created_at >= ?');
    $stmt->execute([pid(), date('Y-m-01')]);
    $newThisMonth = (int)$stmt->fetchColumn();
    audit('view', 'dashboard', null, null, $user);
    json_response([
        'byStage' => $byStage, 'openCases' => count($cases), 'activelyTreating' => $treating,
        'visitsThisWeek' => $visitsThisWeek, 'newThisMonth' => $newThisMonth,
        'ar' => fin_can($user, 'balances') ? array_map(fn($v) => round($v, 2), $ar) : null,
        'alerts' => array_slice($alerts, 0, 200), 'alertCounts' => array_count_values(array_column($alerts, 'level')),
        'tasks' => $tasks,
    ]);
}

// ---------- A/R ----------
function handle_ar_report() {
    $user = require_user('case.read');
    if (!fin_can($user, 'balances')) json_response(['error' => 'Financial reports are not available to your account.'], 403);
    $set = fin_can($user, 'settlement');
    $pdo = pi_db();
    $includeClosed = !empty($_GET['all']);
    $stmt = $pdo->prepare('SELECT c.*, p.first_name, p.last_name, a.organization atty_org, a.name atty_name, a.email atty_email
        FROM cases c JOIN patients p ON p.id = c.patient_id
        LEFT JOIN contacts a ON a.id = c.attorney_contact_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL' . ($includeClosed ? '' : " AND c.stage NOT IN ('closed','dropped')") . ' ORDER BY p.last_name, p.first_name');
    $stmt->execute([pid()]);
    $cases = $stmt->fetchAll();
    $ctx = bulk_case_context($pdo, $cases);
    $rows = [];
    foreach ($cases as $c) {
        $x = $ctx[(int)$c['id']];
        $t = $x['totals'];
        if (!$includeClosed && abs($t['total_balance']) < 0.005 && !$t['total_charges']) continue;
        $rows[] = [
            'id' => (int)$c['id'], 'caseNumber' => $c['case_number'], 'patient' => patient_name($c), 'benefits' => $c['benefits'],
            'stage' => $c['stage'], 'lastVisit' => $x['lastVisit'], 'lastCorrespondence' => $x['lastCorrespondence'],
            'insurer' => implode(', ', array_unique(array_filter(array_map(fn($cv) => $cv['carrier_org'] ?: $cv['carrier_text'], $x['coverages'])))) ?: null,
            'attorney' => trim(($c['atty_org'] ?? '') . ($c['atty_name'] ? ' — ' . $c['atty_name'] : ''), ' —'),
            'attorneyEmail' => $c['atty_email'],
            'insuranceBalance' => $t['insurance_balance'], 'patientBalance' => $t['patient_balance'], 'totalBalance' => $t['total_balance'],
            'totalCharges' => $t['total_charges'], 'reductionFloor' => $set ? $t['reduction_floor'] : null,
            'attyOffer' => $set && $c['atty_offer'] !== null ? (float)$c['atty_offer'] : null,
            'offerPct' => ($set && $c['atty_offer'] !== null && $t['patient_balance'] > 0) ? round((float)$c['atty_offer'] / $t['patient_balance'] * 100, 1) : null,
            'lopSigned' => $c['lop_signed_on'], 'forwardedOn' => $c['balance_forwarded_on'],
            'forwardedAmount' => $set && $c['balance_forwarded_amount'] !== null ? (float)$c['balance_forwarded_amount'] : null,
            'finalSettlement' => $set && $c['final_settlement'] !== null ? (float)$c['final_settlement'] : null,
            'dateAuthorized' => $set ? $c['date_authorized'] : null, 'checkReceived' => $set ? $c['check_received_on'] : null,
        ];
    }
    if (($_GET['format'] ?? '') === 'csv') {
        if (!can($user, 'export')) json_response(['error' => 'Your role does not allow exports.'], 403);
        audit('export', 'ar_report', null, null, $user, ['rows' => count($rows)]);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="pi-ar-' . date('Y-m-d') . '.csv"');
        header('Cache-Control: no-store');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['Case #', 'Patient', 'Benefits', 'Stage', 'Last visit', 'Last correspondence', 'Insurer', 'Attorney', 'Insurance balance', 'Patient balance', 'Total outstanding', 'LOP signed', 'Forwarded to attorney', 'Amount forwarded', '80% floor', 'Atty offer', 'Offer %', 'Final settlement', 'Date authorized', 'Check received']);
        foreach ($rows as $r) {
            // Neutralise spreadsheet formula injection in text cells.
            $safe = fn($v) => is_string($v) && preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v;
            fputcsv($out, array_map($safe, [$r['caseNumber'], $r['patient'], BENEFITS[$r['benefits']] ?? '', STAGES[$r['stage']], $r['lastVisit'], $r['lastCorrespondence'], $r['insurer'], $r['attorney'],
                $r['insuranceBalance'], $r['patientBalance'], $r['totalBalance'], $r['lopSigned'], $r['forwardedOn'], $r['forwardedAmount'], $r['reductionFloor'], $r['attyOffer'], $r['offerPct'], $r['finalSettlement'], $r['dateAuthorized'], $r['checkReceived']]));
        }
        exit;
    }
    audit('view', 'ar_report', null, null, $user);
    json_response(['rows' => $rows, 'totals' => [
        'insurance' => round(array_sum(array_column($rows, 'insuranceBalance')), 2),
        'patient' => round(array_sum(array_column($rows, 'patientBalance')), 2),
        'total' => round(array_sum(array_column($rows, 'totalBalance')), 2),
        'settledCollected' => $set ? round(array_sum(array_map(fn($r) => $r['checkReceived'] ? (float)$r['finalSettlement'] : 0, $rows)), 2) : null,
    ], 'settlementVisible' => $set]);
}

// ---------- letters ----------
// Printable HTML letters to the attorney. Opened in a new tab and printed
// or saved to PDF by the browser — nothing is emailed from the server.
function handle_letter() {
    $user = require_user('case.read');
    $id = (int)($_GET['id'] ?? 0);
    $type = $_GET['type'] ?? '';
    $d = full_case($id, $user);
    $c = $d['case']; $p = $d['patient']; $atty = $d['contacts']['attorney_contact_id'] ?? null;
    $h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
    $money = fn($n) => '$' . number_format((float)$n, 2);
    $patientLine = $h(patient_name($p)) . ($p['dob'] ? ' &nbsp;·&nbsp; DOB ' . $h($p['dob']) : '') . ($c['date_of_injury'] ? ' &nbsp;·&nbsp; DOI ' . $h($c['date_of_injury']) : '');

    $needs = ['tx_complete' => 'balances', 'reduction_response' => 'settlement', 'statement' => 'ledger'];
    if (isset($needs[$type]) && !fin_can($user, $needs[$type])) json_response(['error' => 'This letter includes financial details not available to your account.'], 403);
    if ($type === 'status_request' && !fin_can($user, 'balances')) {
        $title = 'Case status update request';
        $body = '<p>We are writing to request a status update on the above-referenced case for treatment provided to your client'
            . ($d['stats']['lastVisit'] ? ' (last date of service ' . $h($d['stats']['lastVisit']) . ')' : '') . '.</p>'
            . '<p>Please let us know the current status of the case (pre-suit, in litigation, mediation scheduled, settled), any upcoming dates, and whether any additional records or a narrative report are needed from our office.</p>'
            . '<p>We extend our sincere gratitude for your prompt attention to this inquiry. Upon receipt we will update our records to reflect the information provided.</p>';
    } elseif ($type === 'status_request') {
        $title = 'Case status update request';
        $body = '<p>We are writing to request a status update on the above-referenced case. Our records show an outstanding balance of <strong>'
            . $money($d['totals']['total_balance'] ?? 0) . '</strong> for treatment provided to your client'
            . ($d['stats']['lastVisit'] ? ' (last date of service ' . $h($d['stats']['lastVisit']) . ')' : '') . '.</p>'
            . '<p>Please let us know the current status of the case (pre-suit, in litigation, mediation scheduled, settled), any upcoming dates, and whether any additional records or a narrative report are needed from our office.</p>'
            . '<p>We extend our sincere gratitude for your prompt attention to this inquiry. Your swift response is truly valued and greatly appreciated. Upon receipt we will update our records to reflect the information provided.</p>';
    } elseif ($type === 'tx_complete') {
        $title = 'Treatment complete';
        $body = '<p>Please be advised that your client has completed care at our office'
            . ($c['discharge_date'] ? ' and was released from active treatment on ' . $h($c['discharge_date']) : '') . '.</p>'
            . '<p>Dates of service: ' . $h($c['first_visit'] ?? '—') . ' through ' . $h($d['stats']['lastVisit'] ?? '—') . ' (' . (int)$d['stats']['visitCount'] . ' visits).<br>'
            . 'Total charges: <strong>' . $money($d['totals']['total_charges'] ?? 0) . '</strong>; outstanding balance: <strong>' . $money($d['totals']['total_balance'] ?? 0) . '</strong>.</p>'
            . '<p>Itemized billing and records are available on request. Please confirm whether a final narrative report is required, and keep us informed of the case status.</p>';
    } elseif ($type === 'reduction_response') {
        $title = 'Reduction request response';
        $body = '<p>Thank you for your reduction request on the above-referenced case. The patient balance on this account is <strong>'
            . $money($d['totals']['patient_balance'] ?? 0) . '</strong>.</p>'
            . ($c['atty_offer'] !== null ? '<p>Your offer of ' . $money($c['atty_offer']) . ' has been received and is under review.</p>' : '')
            . '<p>Our office is able to accept <strong>' . $money($d['totals']['reduction_floor'] ?? 0) . '</strong> (' . round(REDUCTION_FLOOR_PCT * 100) . '% of the balance) in full satisfaction of this account, provided payment is received within 30 days of settlement.</p>';
    } elseif ($type === 'statement') {
        // Itemized patient balance, by date of service, for the attorney.
        $title = 'Itemized statement — patient balance';
        $t = $d['totals'];
        $rowsHtml = '';
        foreach ($d['openItems'] as $it) {
            $insPart = $it['ins_paid'] + $it['ins_adjusted'];
            $rowsHtml .= '<tr><td>' . $h($it['date']) . '</td><td>' . $h($it['memo'] ?: 'Services') . '</td><td class="n">' . $money($it['amount']) . '</td><td class="n">'
                . ($insPart > 0 ? '(' . $money($insPart) . ')' : '—') . '</td><td class="n">' . ($it['pat_paid'] + $it['pat_reduced'] > 0 ? '(' . $money($it['pat_paid'] + $it['pat_reduced']) . ')' : '—')
                . '</td><td class="n">' . $money($it['pat_open']) . '</td></tr>';
        }
        $itemized = array_sum(array_column($d['openItems'], 'pat_open'));
        $other = round($t['patient_balance'] - $itemized, 2);
        if (abs($other) > 0.005) {
            $rowsHtml .= '<tr><td></td><td>Other adjustments not tied to a date of service</td><td></td><td></td><td></td><td class="n">' . $money($other) . '</td></tr>';
        }
        $body = '<p>Enclosed is the itemized statement for treatment provided to your client'
            . ($c['lop_signed_on'] ? ' under the letter of protection signed ' . $h($c['lop_signed_on']) : '') . '. Insurance payments have been applied; the remaining patient balance is due from the settlement proceeds.</p>'
            . '<table class="it"><thead><tr><th>Date of service</th><th>Description</th><th class="n">Charge</th><th class="n">Insurance paid/adj.</th><th class="n">Patient paid/adj.</th><th class="n">Patient balance</th></tr></thead><tbody>'
            . $rowsHtml . '</tbody><tfoot><tr><td colspan="5">Total patient balance due</td><td class="n">' . $money($t['patient_balance']) . '</td></tr></tfoot></table>'
            . '<p>Please remit payment to our office upon settlement, referencing our file number above. Contact us with any questions about this account.</p>';
    } else {
        json_response(['error' => 'Unknown letter type'], 400);
    }
    audit('letter', 'case', $id, $id, $user, $type);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
    $practice = current_practice();
    $addr = nl2br($h($practice['address'] ?? ''));
    $contactLine = implode(' · ', array_filter([$practice['phone'] ? 'Phone ' . $h($practice['phone']) : null, $practice['fax'] ? 'Fax ' . $h($practice['fax']) : null]));
    $to = $atty ? $h($atty['name'] ?? '') . '<br>' . $h($atty['organization'] ?? '') . ($atty['address'] ? '<br>' . nl2br($h($atty['address'])) : '') . ($atty['fax'] ? '<br>Fax ' . $h($atty['fax']) : '') . ($atty['email'] ? '<br>' . $h($atty['email']) : '') : 'Attorney of record';
    echo '<!doctype html><html><head><meta charset="utf-8"><title>' . $h($title) . '</title><style>
        body{font-family:Georgia,serif;max-width:7in;margin:0.6in auto;color:#0B2340;line-height:1.5;font-size:12pt}
        .lh{border-bottom:2px solid #1FA866;padding-bottom:10px;margin-bottom:24px}.lh b{font-size:15pt;color:#0B2340}
        .re{margin:18px 0;padding:10px 12px;background:#EEF2F7;border-left:3px solid #1FA866}
        .conf{margin-top:40px;font-size:9pt;color:#0B2340;opacity:.75;border-top:1px solid #EEF2F7;padding-top:8px}
        table.it{width:100%;border-collapse:collapse;font-size:10pt;margin:14px 0}table.it th,table.it td{padding:5px 6px;border-bottom:1px solid #EEF2F7;text-align:left}
        table.it .n{text-align:right;white-space:nowrap}table.it tfoot td{font-weight:bold;border-top:2px solid #0B2340}
        @media print{.noprint{display:none}body{margin:0.5in}}
        </style></head><body>
        <p class="noprint" style="font-family:sans-serif;font-size:10pt;background:#EEF2F7;padding:8px">Use your browser\'s Print (Ctrl/Cmd+P) to print or save as PDF.</p>
        <div class="lh"><b>' . $h($practice['name']) . '</b>' . ($addr ? '<br>' . $addr : '') . ($contactLine ? '<br>' . $contactLine : '') . '</div>
        <p>' . date('F j, Y') . '</p><p>' . $to . '</p>
        <div class="re"><strong>RE: ' . $h($title) . '</strong><br>Patient: ' . $patientLine . '<br>Our file: ' . $h($c['case_number']) . '</div>
        <p>Dear ' . $h($atty['name'] ?? 'Counsel') . ',</p>' . $body . '
        <p>Sincerely,</p><p style="margin-top:40px">' . $h($user['name']) . '<br>' . $h($practice['name']) . '</p>
        <div class="conf">CONFIDENTIAL: This document contains protected health information. If you received it in error, notify the sender and destroy all copies.</div>
        </body></html>';
    exit;
}

// Dispatch last: the const field specs above must be defined first.
$action = $_GET['action'] ?? '';
switch ($action) {
    case 'list': handle_list(); break;
    case 'get': handle_get(); break;
    case 'create': handle_create(); break;
    case 'update': handle_update(); break;
    case 'milestone': handle_milestone(); break;
    case 'child_save': handle_child_save(); break;
    case 'child_archive': handle_child_archive(); break;
    case 'move_balance': handle_move_balance(); break;
    case 'forward_balance': handle_forward_balance(); break;
    case 'dashboard': handle_dashboard(); break;
    case 'ar_report': handle_ar_report(); break;
    case 'tasks': handle_tasks(); break;
    case 'task_save': handle_task_save(); break;
    case 'letter': handle_letter(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
