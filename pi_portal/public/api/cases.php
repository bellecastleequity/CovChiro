<?php
// Cases and everything that hangs off a case: checklist, referrals
// (co-management), visits, outcome assessments, correspondence, the
// ledger, tasks — plus the dashboard, A/R report and letters.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

// ---------- field specs ----------
// Type codes: str:N, date, money, bool, enc (encrypted text), contact
// (contacts.id), user (users.id), enum => [allowed values].
const PATIENT_FIELDS = [
    'first_name' => 'str:80', 'last_name' => 'str:80',
    'dob' => 'enc', 'phone' => 'enc', 'email' => 'enc', 'address' => 'enc',
];
const CASE_FIELDS = [
    'stage' => ['intake','treating','tx_complete','demand','litigation','mediation','negotiating','settled','closed','dropped'],
    'injury_type' => ['auto','slip_fall','work','other'],
    'date_of_injury' => 'date', 'first_visit' => 'date', 'discharge_date' => 'date',
    'referral_source' => ['attorney','self','provider','other'],
    'referred_by_contact_id' => 'contact', 'referred_by_text' => 'str:160',
    'attorney_contact_id' => 'contact', 'insurer_contact_id' => 'contact',
    'adjuster' => 'str:160', 'claim_number' => 'enc', 'policy_number' => 'enc',
    'benefits' => ['pip','benex','lop','medpay','denied','health','other'],
    'pip_limit' => 'money', 'emc_status' => ['pending','yes','no'],
    'actively_treating' => 'bool', 'provider_user_id' => 'user', 'notes' => 'enc',
    'atty_offer' => 'money', 'final_settlement' => 'money', 'date_authorized' => 'date', 'check_received_on' => 'date',
];
// These need finance.write instead of case.write. Billing can also move a
// case through the legal / settlement stages.
const FINANCE_CASE_FIELDS = ['atty_offer', 'final_settlement', 'date_authorized', 'check_received_on', 'pip_limit', 'benefits'];

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
        'provider_user_id' => 'user', 'cpt_codes' => 'str:255', 'notes' => 'enc',
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
        'entry_date' => 'date', 'kind' => ['charge','payment','adjustment','reduction','write_off'],
        'bucket' => ['insurance','patient'], 'amount' => 'money', 'reference' => 'str:120', 'memo' => 'str:255',
    ]],
];

// Turns request input into column => value for the keys present in $in.
// Encrypted fields map "notes" -> "notes_enc".
function clean_fields(array $spec, array $in): array {
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
        elseif ($type === 'enc') $out[$name . '_enc'] = enc(str_or_null($v, 20000));
        elseif ($type === 'contact' || $type === 'user') {
            $id = ($v === null || $v === '') ? null : (int)$v;
            if ($id) {
                $stmt = pi_db()->prepare($type === 'contact' ? 'SELECT id FROM contacts WHERE id = ?' : 'SELECT id FROM users WHERE id = ?');
                $stmt->execute([$id]);
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
    $where = ['c.archived_at IS NULL'];
    $args = [];
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
            'balance' => $x['totals']['total_balance'], 'insuranceBalance' => $x['totals']['insurance_balance'], 'patientBalance' => $x['totals']['patient_balance'],
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
    $ledger = can($user, 'finance.read') ? $fetch('SELECT * FROM ledger WHERE case_id = ? AND archived_at IS NULL ORDER BY entry_date, id') : [];
    $tasks = $fetch('SELECT t.*, u.name assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_user_id WHERE t.case_id = ? ORDER BY t.done_at IS NOT NULL, t.due_on');
    $docs = $fetch('SELECT d.id, d.category, d.original_name, d.mime_type, d.size_bytes, d.uploaded_at, u.name uploaded_by_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.case_id = ? AND d.archived_at IS NULL ORDER BY d.uploaded_at DESC');
    $contacts = [];
    foreach (['attorney_contact_id', 'insurer_contact_id', 'referred_by_contact_id'] as $k) {
        if ($c[$k]) { $s = $pdo->prepare('SELECT * FROM contacts WHERE id = ?'); $s->execute([$c[$k]]); $contacts[$k] = $s->fetch() ?: null; }
    }

    $totals = ledger_totals($ledger);
    $visitDates = array_column(array_filter($visits, fn($v) => $v['visit_type'] !== 'no_show'), 'visit_date');
    $checklist = case_checklist($c, $milestones, $referrals);
    $ctx = [
        'checklist' => $checklist, 'referrals' => $referrals, 'totals' => $totals,
        'lastVisit' => $visitDates ? max($visitDates) : null,
        'lastCorrespondence' => $corr ? $corr[0]['occurred_on'] : null,
        'lastOutcome' => $outcomes ? max(array_column($outcomes, 'taken_on')) : null,
        'openFollowUps' => array_filter($corr, fn($r) => $r['follow_up_on'] && !$r['follow_up_done']),
    ];
    $case = decrypt_row($c);
    $case['pip_effective_limit'] = pip_effective_limit($c);
    return [
        'case' => $case, 'patient' => $patient, 'contacts' => $contacts,
        'checklist' => $checklist, 'alerts' => case_alerts($c, $ctx),
        'referrals' => $referrals, 'visits' => $visits, 'outcomes' => $outcomes,
        'correspondence' => $corr, 'ledger' => $ledger, 'totals' => can($user, 'finance.read') ? $totals : null,
        'tasks' => $tasks, 'documents' => $docs,
        'stats' => ['visitCount' => count($visitDates), 'lastVisit' => $ctx['lastVisit']],
    ];
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
    $b = json_body();
    $pdo = pi_db();
    $pdo->beginTransaction();
    if (!empty($b['patient_id'])) {
        $patientId = (int)$b['patient_id'];
        $s = $pdo->prepare('SELECT id FROM patients WHERE id = ?');
        $s->execute([$patientId]);
        if (!$s->fetch()) json_response(['error' => 'Unknown patient'], 400);
    } else {
        $p = clean_fields(PATIENT_FIELDS, $b['patient'] ?? []);
        if (empty($p['first_name'])) json_response(['error' => "Enter the patient's first name."], 400);
        $p['last_name'] = $p['last_name'] ?? '';
        $p['created_at'] = $p['updated_at'] = now_str();
        $patientId = insert_row('patients', $p);
    }
    $cols = clean_fields(CASE_FIELDS, $b['case'] ?? []);
    $cols['patient_id'] = $patientId;
    $cols['case_number'] = next_case_number($pdo);
    $cols['created_at'] = $cols['updated_at'] = now_str();
    foreach (['stage' => 'intake', 'injury_type' => 'auto', 'emc_status' => 'pending', 'pip_limit' => 10000, 'actively_treating' => 1] as $k => $def) {
        if (!isset($cols[$k])) $cols[$k] = $def;
    }
    $id = insert_row('cases', $cols);
    $pdo->commit();
    audit('create', 'case', $id, $id, $user);
    json_response(['id' => $id, 'caseNumber' => $cols['case_number']]);
}

function next_case_number(PDO $pdo): string {
    $prefix = 'PI-' . date('y') . '-';
    $stmt = $pdo->prepare('SELECT case_number FROM cases WHERE case_number LIKE ? ORDER BY case_number DESC LIMIT 1 FOR UPDATE');
    $stmt->execute([$prefix . '%']);
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
function handle_child_save() {
    require_method('POST');
    $user = require_user('case.read');
    $caseId = (int)($_GET['id'] ?? 0);
    case_or_404($caseId);
    $b = json_body();
    $table = (string)($b['table'] ?? '');
    $spec = CHILD_SPECS[$table] ?? json_response(['error' => 'Unknown record type'], 400);
    if (!can($user, $spec['perm'])) json_response(['error' => 'Your role does not allow this.'], 403);
    $cols = clean_fields($spec['fields'], $b['row'] ?? []);
    $childId = (int)($b['row']['id'] ?? 0);
    if ($table === 'ledger' && isset($cols['amount']) && $cols['amount'] <= 0) json_response(['error' => 'Enter a positive amount — the entry type decides whether it adds or subtracts.'], 400);

    if ($childId) {
        child_or_404($table, $childId, $caseId);
        update_row($table, $childId, $cols);
        audit('update', $table, $childId, $caseId, $user, field_names($cols));
    } else {
        foreach ($spec['required'] as $r) {
            if (!isset($cols[$r]) || $cols[$r] === null || $cols[$r] === '') json_response(['error' => 'Missing ' . str_replace('_', ' ', $r)], 400);
        }
        $cols['case_id'] = $caseId;
        $cols['created_by'] = $user['id'];
        $cols['created_at'] = now_str();
        if ($table === 'referrals') $cols['updated_at'] = now_str();
        $childId = insert_row($table, $cols);
        audit('create', $table, $childId, $caseId, $user);
        // A visit can post its charge to the ledger in the same step.
        if ($table === 'visits' && !empty($b['charge']['amount']) && can($user, 'finance.write')) {
            $amount = money_or_null($b['charge']['amount']);
            if ($amount > 0) {
                $lid = insert_row('ledger', [
                    'case_id' => $caseId, 'entry_date' => $cols['visit_date'], 'kind' => 'charge',
                    'bucket' => enum_or($b['charge']['bucket'] ?? '', ['insurance', 'patient'], 'insurance'),
                    'amount' => $amount, 'reference' => 'Visit #' . $childId, 'memo' => 'DOS ' . $cols['visit_date'],
                    'created_by' => $user['id'], 'created_at' => now_str(),
                ]);
                audit('create', 'ledger', $lid, $caseId, $user);
            }
        }
    }
    if ($table === 'referrals') pi_db()->prepare('UPDATE referrals SET updated_at = ? WHERE id = ?')->execute([now_str(), $childId]);
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

function handle_child_archive() {
    require_method('POST');
    $user = require_user('case.read');
    $caseId = (int)($_GET['id'] ?? 0);
    $b = json_body();
    $table = (string)($b['table'] ?? '');
    $spec = CHILD_SPECS[$table] ?? json_response(['error' => 'Unknown record type'], 400);
    if (!can($user, $spec['perm'])) json_response(['error' => 'Your role does not allow this.'], 403);
    $childId = (int)($b['child_id'] ?? 0);
    child_or_404($table, $childId, $caseId);
    pi_db()->prepare("UPDATE $table SET archived_at = ? WHERE id = ?")->execute([now_str(), $childId]);
    touch_case($caseId);
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
            WHERE t.done_at IS NULL' . ($mine ? ' AND t.assigned_user_id = ?' : '') . ' ORDER BY t.due_on IS NULL, t.due_on LIMIT 500';
    $stmt = pi_db()->prepare($sql);
    $stmt->execute($mine ? [$user['id']] : []);
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
        $cols += ['case_id' => $caseId, 'created_by' => $user['id'], 'created_at' => now_str()];
        $id = insert_row('tasks', $cols);
        audit('create', 'task', $id, $caseId, $user);
    }
    json_response($caseId && !empty($b['return_case']) ? full_case($caseId, $user) : ['ok' => true, 'id' => $id]);
}

// ---------- dashboard ----------
function handle_dashboard() {
    $user = require_user('case.read');
    $pdo = pi_db();
    $cases = $pdo->query("SELECT c.*, p.first_name, p.last_name FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.archived_at IS NULL AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')")->fetchAll();
    $ctx = bulk_case_context($pdo, $cases);
    $byStage = array_fill_keys(array_keys(STAGES), 0);
    foreach ($pdo->query('SELECT stage, COUNT(*) n FROM cases WHERE archived_at IS NULL GROUP BY stage') as $r) $byStage[$r['stage']] = (int)$r['n'];

    $alerts = [];
    $ar = ['insurance' => 0.0, 'patient' => 0.0, 'total' => 0.0, 'legal' => 0.0];
    $treating = 0;
    foreach ($cases as $c) {
        $x = $ctx[(int)$c['id']];
        foreach (case_alerts($c, $x) as $a) $alerts[] = $a + ['caseId' => (int)$c['id'], 'patient' => patient_name($c), 'caseNumber' => $c['case_number']];
        $ar['insurance'] += $x['totals']['insurance_balance'];
        $ar['patient'] += $x['totals']['patient_balance'];
        $ar['total'] += $x['totals']['total_balance'];
        if (in_array($c['stage'], LEGAL_STAGES, true)) $ar['legal'] += $x['totals']['total_balance'];
        if ($c['actively_treating'] && in_array($c['stage'], ['intake', 'treating'], true)) $treating++;
    }
    $rank = ['high' => 0, 'medium' => 1, 'low' => 2];
    usort($alerts, fn($a, $b) => $rank[$a['level']] <=> $rank[$b['level']]);

    $stmt = $pdo->prepare('SELECT t.*, c.case_number, p.first_name, p.last_name FROM tasks t LEFT JOIN cases c ON c.id = t.case_id LEFT JOIN patients p ON p.id = c.patient_id
        WHERE t.done_at IS NULL AND (t.assigned_user_id = ? OR t.assigned_user_id IS NULL) AND (t.due_on IS NULL OR t.due_on <= ?) ORDER BY t.due_on LIMIT 50');
    $stmt->execute([$user['id'], add_days(date('Y-m-d'), 7)]);
    $tasks = array_map(function ($t) { $t['patient'] = $t['case_id'] ? patient_name($t) : null; unset($t['first_name'], $t['last_name']); return $t; }, $stmt->fetchAll());

    $visitsThisWeek = (int)$pdo->query("SELECT COUNT(*) FROM visits WHERE archived_at IS NULL AND visit_type <> 'no_show' AND visit_date >= '" . date('Y-m-d', strtotime('monday this week')) . "'")->fetchColumn();
    $newThisMonth = (int)$pdo->query("SELECT COUNT(*) FROM cases WHERE archived_at IS NULL AND created_at >= '" . date('Y-m-01') . "'")->fetchColumn();
    audit('view', 'dashboard', null, null, $user);
    json_response([
        'byStage' => $byStage, 'openCases' => count($cases), 'activelyTreating' => $treating,
        'visitsThisWeek' => $visitsThisWeek, 'newThisMonth' => $newThisMonth,
        'ar' => can($user, 'finance.read') ? array_map(fn($v) => round($v, 2), $ar) : null,
        'alerts' => array_slice($alerts, 0, 200), 'alertCounts' => array_count_values(array_column($alerts, 'level')),
        'tasks' => $tasks,
    ]);
}

// ---------- A/R ----------
function handle_ar_report() {
    $user = require_user('finance.read');
    $pdo = pi_db();
    $includeClosed = !empty($_GET['all']);
    $cases = $pdo->query('SELECT c.*, p.first_name, p.last_name, a.organization atty_org, a.name atty_name, a.email atty_email, i.organization ins_org
        FROM cases c JOIN patients p ON p.id = c.patient_id
        LEFT JOIN contacts a ON a.id = c.attorney_contact_id LEFT JOIN contacts i ON i.id = c.insurer_contact_id
        WHERE c.archived_at IS NULL' . ($includeClosed ? '' : " AND c.stage NOT IN ('closed','dropped')") . ' ORDER BY p.last_name, p.first_name')->fetchAll();
    $ctx = bulk_case_context($pdo, $cases);
    $rows = [];
    foreach ($cases as $c) {
        $x = $ctx[(int)$c['id']];
        $t = $x['totals'];
        if (!$includeClosed && abs($t['total_balance']) < 0.005 && !$t['total_charges']) continue;
        $rows[] = [
            'id' => (int)$c['id'], 'caseNumber' => $c['case_number'], 'patient' => patient_name($c), 'benefits' => $c['benefits'],
            'stage' => $c['stage'], 'lastVisit' => $x['lastVisit'], 'lastCorrespondence' => $x['lastCorrespondence'],
            'insurer' => $c['ins_org'], 'attorney' => trim(($c['atty_org'] ?? '') . ($c['atty_name'] ? ' — ' . $c['atty_name'] : ''), ' —'),
            'attorneyEmail' => $c['atty_email'],
            'insuranceBalance' => $t['insurance_balance'], 'patientBalance' => $t['patient_balance'], 'totalBalance' => $t['total_balance'],
            'totalCharges' => $t['total_charges'], 'reductionFloor' => $t['reduction_floor'],
            'attyOffer' => $c['atty_offer'] !== null ? (float)$c['atty_offer'] : null,
            'offerPct' => ($c['atty_offer'] !== null && $t['total_balance'] > 0) ? round((float)$c['atty_offer'] / $t['total_balance'] * 100, 1) : null,
            'finalSettlement' => $c['final_settlement'] !== null ? (float)$c['final_settlement'] : null,
            'dateAuthorized' => $c['date_authorized'], 'checkReceived' => $c['check_received_on'],
        ];
    }
    if (($_GET['format'] ?? '') === 'csv') {
        if (!can($user, 'export')) json_response(['error' => 'Your role does not allow exports.'], 403);
        audit('export', 'ar_report', null, null, $user, ['rows' => count($rows)]);
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="pi-ar-' . date('Y-m-d') . '.csv"');
        header('Cache-Control: no-store');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['Case #', 'Patient', 'Benefits', 'Stage', 'Last visit', 'Last correspondence', 'Insurer', 'Attorney', 'Insurance balance', 'Patient balance', 'Total outstanding', '80% floor', 'Atty offer', 'Offer %', 'Final settlement', 'Date authorized', 'Check received']);
        foreach ($rows as $r) {
            // Neutralise spreadsheet formula injection in text cells.
            $safe = fn($v) => is_string($v) && preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v;
            fputcsv($out, array_map($safe, [$r['caseNumber'], $r['patient'], BENEFITS[$r['benefits']] ?? '', STAGES[$r['stage']], $r['lastVisit'], $r['lastCorrespondence'], $r['insurer'], $r['attorney'],
                $r['insuranceBalance'], $r['patientBalance'], $r['totalBalance'], $r['reductionFloor'], $r['attyOffer'], $r['offerPct'], $r['finalSettlement'], $r['dateAuthorized'], $r['checkReceived']]));
        }
        exit;
    }
    audit('view', 'ar_report', null, null, $user);
    json_response(['rows' => $rows, 'totals' => [
        'insurance' => round(array_sum(array_column($rows, 'insuranceBalance')), 2),
        'patient' => round(array_sum(array_column($rows, 'patientBalance')), 2),
        'total' => round(array_sum(array_column($rows, 'totalBalance')), 2),
        'settledCollected' => round(array_sum(array_map(fn($r) => $r['checkReceived'] ? (float)$r['finalSettlement'] : 0, $rows)), 2),
    ]]);
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

    if ($type === 'status_request') {
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
        $body = '<p>Thank you for your reduction request on the above-referenced case. The current outstanding balance is <strong>'
            . $money($d['totals']['total_balance'] ?? 0) . '</strong>.</p>'
            . ($c['atty_offer'] !== null ? '<p>Your offer of ' . $money($c['atty_offer']) . ' has been received and is under review.</p>' : '')
            . '<p>Our office is able to accept <strong>' . $money($d['totals']['reduction_floor'] ?? 0) . '</strong> (' . round(REDUCTION_FLOOR_PCT * 100) . '% of the balance) in full satisfaction of this account, provided payment is received within 30 days of settlement.</p>';
    } else {
        json_response(['error' => 'Unknown letter type'], 400);
    }
    audit('letter', 'case', $id, $id, $user, $type);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
    $addr = nl2br($h(PI_PRACTICE_ADDRESS));
    $to = $atty ? $h($atty['name'] ?? '') . '<br>' . $h($atty['organization'] ?? '') . ($atty['address'] ? '<br>' . nl2br($h($atty['address'])) : '') . ($atty['fax'] ? '<br>Fax ' . $h($atty['fax']) : '') . ($atty['email'] ? '<br>' . $h($atty['email']) : '') : 'Attorney of record';
    echo '<!doctype html><html><head><meta charset="utf-8"><title>' . $h($title) . '</title><style>
        body{font-family:Georgia,serif;max-width:7in;margin:0.6in auto;color:#111;line-height:1.5;font-size:12pt}
        .lh{border-bottom:2px solid #2F5D53;padding-bottom:10px;margin-bottom:24px}.lh b{font-size:15pt;color:#2F5D53}
        .re{margin:18px 0;padding:10px 12px;background:#f3f1ea;border-left:3px solid #2F5D53}
        .conf{margin-top:40px;font-size:9pt;color:#555;border-top:1px solid #ccc;padding-top:8px}
        @media print{.noprint{display:none}body{margin:0.5in}}
        </style></head><body>
        <p class="noprint" style="font-family:sans-serif;font-size:10pt;background:#fff8e1;padding:8px">Use your browser\'s Print (Ctrl/Cmd+P) to print or save as PDF.</p>
        <div class="lh"><b>' . $h(PI_PRACTICE_NAME) . '</b><br>' . $addr . '<br>Phone ' . $h(PI_PRACTICE_PHONE) . ' · Fax ' . $h(PI_PRACTICE_FAX) . '</div>
        <p>' . date('F j, Y') . '</p><p>' . $to . '</p>
        <div class="re"><strong>RE: ' . $h($title) . '</strong><br>Patient: ' . $patientLine . '<br>Our file: ' . $h($c['case_number']) . '</div>
        <p>Dear ' . $h($atty['name'] ?? 'Counsel') . ',</p>' . $body . '
        <p>Sincerely,</p><p style="margin-top:40px">' . $h($user['name']) . '<br>' . $h(PI_PRACTICE_NAME) . '</p>
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
    case 'dashboard': handle_dashboard(); break;
    case 'ar_report': handle_ar_report(); break;
    case 'tasks': handle_tasks(); break;
    case 'task_save': handle_task_save(); break;
    case 'letter': handle_letter(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
