<?php
// Practice administration — users, practice settings (letterhead), the
// Business Associate Agreement, and the audit log. Admin role only, and
// always limited to the admin's own practice.
define('PI_ALLOW_WHEN_LAPSED', true);
require_once __DIR__ . '/../../app/bootstrap.php';
require_once __DIR__ . '/../../app/badge.php';
pi_start_session();

// Home location (must belong to the practice) and whether access is
// limited to it (only meaningful with a location).
function user_location_input(array $b): array {
    $loc = !empty($b['location_id']) ? (int)$b['location_id'] : null;
    if ($loc) {
        $s = pi_db()->prepare('SELECT id FROM locations WHERE id = ? AND practice_id = ?'); $s->execute([$loc, pid()]);
        if (!$s->fetch()) json_response(['error' => 'Unknown location'], 400);
    }
    return [$loc, $loc && !empty($b['location_restricted']) ? 1 : 0];
}

function handle_users() {
    require_user('users.manage');
    $stmt = pi_db()->prepare('SELECT id, email, name, role, finance_access, notify_digest, location_id, location_restricted, active, totp_enabled, must_change_password, locked_until, last_login_at, created_at FROM users WHERE practice_id = ? ORDER BY active DESC, name');
    $stmt->execute([pid()]);
    json_response(['users' => $stmt->fetchAll(), 'limit' => effective_plan(current_practice())['users']]);
}

// A readable one-time password the admin hands over in person or by
// phone; the user must replace it at first sign-in.
function temp_password(): string {
    $words = ['Maple', 'Harbor', 'Copper', 'Lantern', 'Cedar', 'Summit', 'Pelican', 'Orchid', 'Granite', 'Willow', 'Falcon', 'Meadow'];
    return $words[random_int(0, 11)] . '-' . $words[random_int(0, 11)] . '-' . random_int(1000, 9999);
}

function user_in_practice(int $id): array {
    $s = pi_db()->prepare('SELECT * FROM users WHERE id = ? AND practice_id = ?');
    $s->execute([$id, pid()]);
    $u = $s->fetch();
    if (!$u) json_response(['error' => 'User not found'], 404);
    return $u;
}

function handle_user_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $pdo = pi_db();
    $id = (int)($b['id'] ?? 0);
    $role = enum_or($b['role'] ?? '', array_keys(ROLE_PERMS), null);
    $name = str_or_null($b['name'] ?? null, 120);
    if (!$role || !$name) json_response(['error' => 'Enter a name and pick a role.'], 400);
    if ($id) {
        $existing = user_in_practice($id);
        $active = !empty($b['active']) ? 1 : 0;
        if ($id === (int)$admin['id'] && ($role !== 'admin' || !$active)) json_response(['error' => "You can't remove your own admin access."], 400);
        if ($active && !$existing['active']) enforce_limit('users');
        $finAccess = $role === 'staff' && !empty($b['finance_access']) ? 1 : 0;
        $digest = array_key_exists('notify_digest', $b) ? (!empty($b['notify_digest']) ? 1 : 0) : (int)$existing['notify_digest'];
        [$locId, $locOnly] = array_key_exists('location_id', $b) ? user_location_input($b) : [$existing['location_id'], (int)$existing['location_restricted']];
        if ($id === (int)$admin['id'] && $locOnly) json_response(['error' => "You can't limit your own account to one location."], 400);
        $pdo->prepare('UPDATE users SET name = ?, role = ?, active = ?, finance_access = ?, notify_digest = ?, location_id = ?, location_restricted = ? WHERE id = ? AND practice_id = ?')->execute([$name, $role, $active, $finAccess, $digest, $locId, $locOnly, $id, pid()]);
        $changes = audit_diff(['name' => 'label', 'role' => array_keys(ROLE_PERMS), 'active' => 'bool', 'finance_access' => 'bool', 'notify_digest' => 'bool', 'location_id' => 'int', 'location_restricted' => 'bool'], $existing, ['name' => $name, 'role' => $role, 'active' => $active, 'finance_access' => $finAccess, 'notify_digest' => $digest, 'location_id' => $locId, 'location_restricted' => $locOnly]);
        if ($changes) audit('update', 'user', $id, null, $admin, $existing['name'], $changes);
        json_response(['ok' => true]);
    }
    enforce_limit('users');
    $email = strtolower(trim((string)($b['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid email.'], 400);
    $s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $s->execute([$email]);
    if ($s->fetch()) json_response(['error' => 'That email already has an account.'], 400);
    $pw = temp_password();
    [$locId, $locOnly] = user_location_input($b);
    $pdo->prepare('INSERT INTO users (practice_id, email, name, role, finance_access, location_id, location_restricted, notify_digest, password_hash, must_change_password, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)')
        ->execute([pid(), $email, $name, $role, $role === 'staff' && !empty($b['finance_access']) ? 1 : 0, $locId, $locOnly, array_key_exists('notify_digest', $b) ? (!empty($b['notify_digest']) ? 1 : 0) : ($role === 'admin' ? 1 : 0), password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
    $newId = (int)$pdo->lastInsertId();
    audit('create', 'user', $newId, null, $admin, $name, [['f' => 'role', 't' => 'enum', 'from' => null, 'to' => $role]]);
    json_response(['ok' => true, 'tempPassword' => $pw]);
}

// Lost phone / forgotten password: issue a new temp password and/or clear
// 2FA so the user re-enrolls at next sign-in. Verify who you're talking to
// before doing this — it's the main social-engineering target.
function handle_user_reset() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $id = (int)user_in_practice((int)($b['id'] ?? 0))['id'];
    $what = $b['what'] ?? '';
    $pdo = pi_db();
    $out = ['ok' => true];
    if ($what === 'password') {
        $pw = temp_password();
        $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')->execute([password_hash($pw, PASSWORD_ARGON2ID), $id]);
        $out['tempPassword'] = $pw;
    } elseif ($what === 'mfa') {
        $pdo->prepare('UPDATE users SET totp_secret_enc = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?')->execute([$id]);
    } elseif ($what === 'unlock') {
        $pdo->prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?')->execute([$id]);
    } else {
        json_response(['error' => 'Unknown reset'], 400);
    }
    audit('reset_' . $what, 'user', $id, null, $admin, user_in_practice($id)['name']);
    json_response($out);
}

function handle_practice() {
    require_user('users.manage');
    $p = current_practice();
    $q = pi_db()->prepare("SELECT COUNT(*) FROM cases WHERE practice_id = ? AND auto_status = 1 AND archived_at IS NULL AND stage IN ('" . implode("','", OPEN_STAGES) . "')");
    $q->execute([$p['id']]);
    $autoCount = (int)$q->fetchColumn();
    json_response(['practice' => [
        'name' => $p['name'], 'address' => $p['address'], 'phone' => $p['phone'], 'fax' => $p['fax'], 'email' => $p['email'] ?? null, 'state' => $p['state'], 'ehrName' => $p['ehr_name'],
        'staffFinance' => array_values(array_filter(explode(',', (string)$p['staff_finance']))),
        'notifyRules' => practice_rules($p), 'notifyCriteria' => NOTIFY_CRITERIA, 'mailReady' => mail_ready(),
        'hasHuddle' => has_feature($p, 'huddle'), 'hasDigest' => has_feature($p, 'email_digest'), 'costs' => practice_costs($p),
        'taskEmail' => task_email_rules($p), 'hasTaskEmails' => has_feature($p, 'task_emails'),
        'statusRules' => status_rules($p), 'hasAutoStatus' => has_feature($p, 'auto_status'), 'narrativeFees' => narrative_fees($p),
        'whiteLabel' => white_label_settings($p) + ['active' => white_label_active($p), 'logo' => practice_has_logo((int)$p['id']) ? brand_logo_url($p) : null, 'signinUrl' => $p['brand_slug'] ? APP_URL . '/app.html?b=' . $p['brand_slug'] : null, 'signinBase' => APP_URL . '/app.html?b='],
        'hasWhiteLabel' => has_feature($p, 'white_label'),
        'autoStatusCount' => $autoCount,
        'baaVersion' => $p['baa_version'], 'baaAcceptedAt' => $p['baa_accepted_at'], 'currentBaaVersion' => BAA_VERSION,
    ]]);
}

function handle_practice_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $name = str_or_null($b['name'] ?? null, 160);
    if (!$name) json_response(['error' => 'Enter the practice name.'], 400);
    $state = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($b['state'] ?? 'FL')), 0, 2)) ?: 'FL';
    $email = str_or_null($b['email'] ?? null, 190);
    if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Check the office email address.'], 400);
    $after = ['name' => $name, 'address' => str_or_null($b['address'] ?? null, 255), 'phone' => str_or_null($b['phone'] ?? null, 40), 'fax' => str_or_null($b['fax'] ?? null, 40), 'email' => $email, 'state' => $state, 'ehr_name' => str_or_null($b['ehr_name'] ?? null, 80)];
    $changes = audit_diff(['name' => 'label', 'address' => 'label', 'phone' => 'label', 'fax' => 'label', 'email' => 'label', 'state' => 'label', 'ehr_name' => 'label'], current_practice(), $after);
    pi_db()->prepare('UPDATE practices SET name = ?, address = ?, phone = ?, fax = ?, email = ?, state = ?, ehr_name = ? WHERE id = ?')
        ->execute([...array_values($after), pid()]);
    if ($changes) audit('update', 'practice', pid(), null, $admin, null, $changes);
    json_response(['ok' => true]);
}

// Which financial categories the staff role sees practice-wide.
function handle_staff_finance() {
    require_method('POST');
    $admin = require_user('users.manage');
    $scopes = array_values(array_intersect(FIN_SCOPES, (array)(json_body()['scopes'] ?? [])));
    pi_db()->prepare('UPDATE practices SET staff_finance = ? WHERE id = ?')->execute([implode(',', $scopes), pid()]);
    $old = array_values(array_filter(explode(',', (string)current_practice()['staff_finance'])));
    audit('update', 'practice', pid(), null, $admin, null, [['f' => 'staff_finance', 't' => 'enum', 'from' => $old ? implode(', ', $old) : null, 'to' => $scopes ? implode(', ', $scopes) : null]]);
    json_response(['ok' => true, 'scopes' => $scopes]);
}

function mail_ready(): bool {
    require_once __DIR__ . '/../../app/mailer.php';
    return mail_configured();
}

// The practice's daily huddle / email digest criteria and thresholds.
function handle_notify_rules_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $rules = ['criteria' => array_values(array_intersect((array)($b['criteria'] ?? []), array_keys(NOTIFY_CRITERIA))),
        'gap_days' => (int)($b['gap_days'] ?? TREATMENT_GAP_DAYS), 'adherence_pct' => (int)($b['adherence_pct'] ?? 70), 'weekdays_only' => !empty($b['weekdays_only'])];
    $before = practice_rules();
    pi_db()->prepare('UPDATE practices SET notify_rules = ? WHERE id = ?')->execute([json_encode($rules), pid()]);
    $after = practice_rules(['notify_rules' => json_encode($rules)]);
    audit('update', 'practice', pid(), null, $admin, 'daily digest rules', audit_diff(['gap_days' => 'int', 'adherence_pct' => 'int', 'weekdays_only' => 'bool', 'criteria' => 'label'],
        ['criteria' => implode(', ', $before['criteria'])] + $before, ['criteria' => implode(', ', $after['criteria'])] + $after));
    json_response(['ok' => true, 'rules' => $after]);
}

// Defaults for new tasks' email alerts (each task can change its own).
function handle_task_email_rules_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('task_emails');
    $b = json_body();
    $rules = ['on' => array_values(array_intersect(array_keys(TASK_EMAIL_EVENTS), (array)($b['on'] ?? []))),
        'who' => array_values(array_intersect(array_keys(TASK_EMAIL_WHO), (array)($b['who'] ?? []))), 'repeat_days' => task_repeat_days($b['repeat_days'] ?? 5)];
    $before = task_email_rules();
    pi_db()->prepare('UPDATE practices SET task_email_rules = ? WHERE id = ?')->execute([json_encode($rules), pid()]);
    $flat = fn($r) => ['on' => implode(', ', $r['on']), 'who' => implode(', ', $r['who']), 'repeat_days' => $r['repeat_days']];
    audit('update', 'practice', pid(), null, $admin, 'task email defaults', audit_diff(['on' => 'label', 'who' => 'label', 'repeat_days' => 'int'], $flat($before), $flat($rules)));
    json_response(['ok' => true, 'rules' => task_email_rules(['task_email_rules' => json_encode($rules)])]);
}

// Automatic attorney status requests: practice defaults, and switching
// them on for every open case that has an attorney.
function handle_status_rules_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('auto_status');
    $b = json_body();
    $before = status_rules();
    $rules = ['default_on' => !empty($b['default_on']), 'every_days' => status_every($b['every_days'] ?? 30), 'show_balance' => !empty($b['show_balance'])];
    pi_db()->prepare('UPDATE practices SET status_request_rules = ? WHERE id = ?')->execute([json_encode($rules), pid()]);
    audit('update', 'practice', pid(), null, $admin, 'status request defaults', audit_diff(['default_on' => 'bool', 'every_days' => 'int', 'show_balance' => 'bool'], $before, $rules));
    $turnedOn = 0;
    if (!empty($b['enable_open'])) {
        $s = pi_db()->prepare("UPDATE cases SET auto_status = 1 WHERE practice_id = ? AND auto_status = 0 AND archived_at IS NULL AND check_received_on IS NULL
            AND stage IN ('" . implode("','", array_merge(LEGAL_STAGES, ['tx_complete', 'settled'])) . "') AND (attorney_contact_id IS NOT NULL OR case_manager_email IS NOT NULL)");
        $s->execute([pid()]);
        $turnedOn = $s->rowCount();
        if ($turnedOn) audit('update', 'practice', pid(), null, $admin, "status requests switched on for $turnedOn open case(s)");
    }
    json_response(['ok' => true, 'rules' => $rules, 'turnedOn' => $turnedOn]);
}

// White label (top plan): the practice's own product name, color and
// branded sign-in link. The logo is uploaded separately.
function handle_white_label_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('white_label');
    $b = json_body();
    $name = str_or_null($b['name'] ?? null, 60);
    $color = strtoupper(trim((string)($b['color'] ?? '')));
    if ($color === '') $color = null;
    elseif (!preg_match('/^#[0-9A-F]{6}$/', $color)) json_response(['error' => 'Choose a color as a hex value, like #2B3FD6.'], 400);
    // Buttons put white text on this color, so it has to be dark enough to read.
    elseif (color_contrast($color, '#FFFFFF') < 4.5) json_response(['error' => 'That color is too light for white button text to be readable. Choose a darker shade.', 'code' => 'contrast'], 400);
    $slug = strtolower(trim((string)($b['slug'] ?? '')));
    if ($slug === '') $slug = null;
    elseif ($err = brand_slug_problem($slug)) json_response(['error' => $err], 400);
    if ($slug) {
        $s = pi_db()->prepare('SELECT COUNT(*) FROM practices WHERE brand_slug = ? AND id <> ?'); $s->execute([$slug, pid()]);
        if ($s->fetchColumn()) json_response(['error' => 'That sign-in link is taken. Try another.'], 409);
    }
    $p = current_practice();
    $before = white_label_settings($p);
    pi_db()->prepare('UPDATE practices SET white_label = ?, brand_slug = ? WHERE id = ?')->execute([$name || $color ? json_encode(['name' => $name, 'color' => $color]) : null, $slug, pid()]);
    audit('update', 'practice', pid(), null, $admin, 'white label', audit_diff(['name' => 'str:60', 'color' => 'str:7', 'slug' => 'str:40'], $before, ['name' => $name, 'color' => $color, 'slug' => $slug]));
    json_response(['ok' => true]);
}

function handle_white_label_logo() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('white_label');
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Upload failed — the file may be too large.'], 400);
    if ($f['size'] > BRAND_LOGO_MAX_BYTES) json_response(['error' => 'Logos must be 2 MB or smaller.'], 400);
    $r = brand_logo_from_upload($f['tmp_name']);
    if (isset($r['error'])) json_response(['error' => $r['error']], 400);
    pi_db()->prepare('REPLACE INTO practice_logos (practice_id, png, updated_at) VALUES (?, ?, ?)')->execute([pid(), $r['png'], now_str()]);
    audit('update', 'practice', pid(), null, $admin, 'white label logo uploaded');
    json_response(['ok' => true, 'width' => $r['width'], 'height' => $r['height']]);
}

function handle_white_label_logo_remove() {
    require_method('POST');
    $admin = require_user('users.manage');
    pi_db()->prepare('DELETE FROM practice_logos WHERE practice_id = ?')->execute([pid()]);
    audit('update', 'practice', pid(), null, $admin, 'white label logo removed');
    json_response(['ok' => true]);
}

// Whether the practice charges for a final narrative report, and its fees.
function handle_narrative_fees_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $charge = !empty($b['charge']);
    $amt = function ($v) { if ($v === null || $v === '') return null; $m = money_or_null($v); if ($m === null || $m < 0 || $m > 100000) json_response(['error' => 'Enter fees as dollar amounts.'], 400); return $m; };
    $fees = ['charge' => $charge, 'without' => $charge ? $amt($b['without'] ?? null) : null, 'with' => $charge ? $amt($b['with'] ?? null) : null];
    if ($charge && !$fees['without'] && !$fees['with']) json_response(['error' => 'Enter at least one fee, or choose that you don\'t charge.'], 400);
    $before = narrative_fees();
    pi_db()->prepare('UPDATE practices SET narrative_fees = ? WHERE id = ?')->execute([json_encode($fees), pid()]);
    audit('update', 'practice', pid(), null, $admin, 'narrative fees', audit_diff(['charge' => 'bool', 'without' => 'money', 'with' => 'money'], $before, $fees));
    json_response(['ok' => true, 'fees' => narrative_fees(['narrative_fees' => json_encode($fees)])]);
}

// Each person's own daily email: on/off and which of the practice's
// criteria. Admins can switch it for others from the Users page.
// Also: task email alerts on/off (Gold and up).
function require_some_email() {
    if (!has_feature(current_practice(), 'email_digest')) require_feature('task_emails');
}

function handle_my_notify() {
    $user = require_user();
    require_some_email();
    $s = pi_db()->prepare('SELECT notify_digest, notify_criteria, notify_tasks FROM users WHERE id = ?');
    $s->execute([$user['id']]);
    $u = $s->fetch();
    $rules = practice_rules();
    json_response(['hasDigest' => has_feature(current_practice(), 'email_digest'), 'hasTaskEmails' => has_feature(current_practice(), 'task_emails'), 'tasks' => (bool)$u['notify_tasks'],
        'digest' => (bool)$u['notify_digest'], 'criteria' => $u['notify_criteria'] === null ? $rules['criteria'] : array_values(array_intersect(explode(',', $u['notify_criteria']), $rules['criteria'])),
        'available' => array_intersect_key(NOTIFY_CRITERIA, array_flip($rules['criteria'])), 'email' => $user['email'], 'mailReady' => mail_ready(), 'weekdaysOnly' => $rules['weekdays_only']]);
}

function handle_my_notify_save() {
    require_method('POST');
    $user = require_user();
    require_some_email();
    $b = json_body();
    $changes = [];
    if (has_feature(current_practice(), 'email_digest') && array_key_exists('digest', $b)) {
        $crit = array_values(array_intersect((array)($b['criteria'] ?? []), array_keys(NOTIFY_CRITERIA)));
        pi_db()->prepare('UPDATE users SET notify_digest = ?, notify_criteria = ? WHERE id = ?')->execute([!empty($b['digest']) ? 1 : 0, implode(',', $crit), $user['id']]);
        $changes[] = ['f' => 'notify_digest', 't' => 'bool', 'from' => null, 'to' => !empty($b['digest'])];
    }
    if (has_feature(current_practice(), 'task_emails') && array_key_exists('tasks', $b)) {
        pi_db()->prepare('UPDATE users SET notify_tasks = ? WHERE id = ?')->execute([!empty($b['tasks']) ? 1 : 0, $user['id']]);
        $changes[] = ['f' => 'notify_tasks', 't' => 'bool', 'from' => null, 'to' => !empty($b['tasks'])];
    }
    audit('update', 'user', $user['id'], null, $user, 'email notifications', $changes);
    json_response(['ok' => true]);
}

// ---- expected costs at outside providers (case value estimates) ----
function handle_costs_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('outside_estimates');
    $b = json_body();
    $before = practice_costs();
    $save = [];
    if (empty($b['reset'])) {
        foreach (OUTSIDE_COSTS as $k => $d) {
            $in = $b['costs'][$k] ?? null;
            if (!is_array($in)) continue;
            $cost = isset($in['cost']) && $in['cost'] !== '' ? max(0, min(1000000, round((float)$in['cost'], 2))) : (float)$d['cost'];
            $typ = isset($in['typical']) && $in['typical'] !== '' ? max(0, min(100, round((float)$in['typical'], 1))) : (float)$d['typical'];
            if ($cost != $d['cost'] || $typ != $d['typical']) $save[$k] = ['cost' => $cost, 'typical' => $typ];
        }
    }
    pi_db()->prepare('UPDATE practices SET cost_estimates = ? WHERE id = ?')->execute([$save ? json_encode($save) : null, pid()]);
    $p = current_practice(); $p['cost_estimates'] = $save ? json_encode($save) : null;
    $after = practice_costs($p);
    $changes = [];
    foreach ($after as $k => $a) {
        if ($a['cost'] != $before[$k]['cost']) $changes[] = ['f' => $a['label'] . ' cost', 't' => 'money', 'from' => $before[$k]['cost'], 'to' => $a['cost']];
        if ($a['typical'] != $before[$k]['typical']) $changes[] = ['f' => $a['label'] . ' typical count', 't' => 'int', 'from' => $before[$k]['typical'], 'to' => $a['typical']];
    }
    audit('update', 'practice', pid(), null, $admin, 'outside provider costs', $changes ?: null);
    json_response(['costs' => $after]);
}

// ---- the practice's own case steps, and silencing built-in ones ----
function handle_steps() {
    require_user('users.manage');
    $cfg = practice_step_config(pid());
    $s = pi_db()->prepare('SELECT * FROM practice_steps WHERE practice_id = ? AND active = 1 ORDER BY id');
    $s->execute([pid()]);
    $guide = []; $check = [];
    foreach (CARE_GUIDE as $k => $d) $guide[] = ['key' => 'guide:' . $k, 'title' => $d['title'], 'when' => $d['when'], 'cases' => $d['cases'], 'silenced' => isset($cfg['silenced']['guide:' . $k]),
        'stateOnly' => isset($d['rule'])];
    foreach (CHECKLIST as $k => $d) $check[] = ['key' => 'check:' . $k, 'title' => $d['label'], 'group' => $d['group'], 'cases' => $d['cases'], 'silenced' => isset($cfg['silenced']['check:' . $k]),
        'stateOnly' => isset($d['rule']) || isset($d['states'])];
    json_response(['custom' => $s->fetchAll(), 'customEnabled' => has_feature(current_practice(), 'custom_steps'), 'guide' => $guide, 'checklist' => $check, 'anchors' => STEP_ANCHORS, 'injuryTypes' => INJURY_TYPES]);
}

function handle_step_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('custom_steps');
    $b = json_body();
    $pdo = pi_db();
    $id = (int)($b['id'] ?? 0);
    if ($id) {
        $s = $pdo->prepare('SELECT * FROM practice_steps WHERE id = ? AND practice_id = ?'); $s->execute([$id, pid()]);
        $before = $s->fetch() ?: json_response(['error' => 'Not found'], 404);
        if (!empty($b['remove'])) {
            $pdo->prepare('UPDATE practice_steps SET active = 0 WHERE id = ?')->execute([$id]);
            audit('archive', 'practice_step', $id, null, $admin, $before['title']);
            json_response(['ok' => true]);
        }
    }
    $title = str_or_null($b['title'] ?? null, 200);
    if (!$title) json_response(['error' => 'Give the step a name.'], 400);
    $anchor = isset(STEP_ANCHORS[$b['anchor'] ?? '']) ? $b['anchor'] : 'first_visit';
    $cases = array_values(array_filter((array)($b['cases'] ?? []), fn($c) => isset(INJURY_TYPES[$c])));
    $cols = ['title' => $title, 'detail' => str_or_null($b['detail'] ?? null, 500), 'cases' => $cases && count($cases) < count(INJURY_TYPES) ? implode(',', $cases) : null,
        'anchor' => $anchor, 'days' => $anchor === 'none' ? null : max(0, min(730, (int)($b['days'] ?? 0)))];
    if ($id) {
        $pdo->prepare('UPDATE practice_steps SET title = ?, detail = ?, cases = ?, anchor = ?, days = ? WHERE id = ?')->execute([...array_values($cols), $id]);
        audit('update', 'practice_step', $id, null, $admin, $title, audit_diff(['title' => 'label', 'detail' => 'label', 'cases' => 'label', 'anchor' => 'label', 'days' => 'int'], $before, $cols));
    } else {
        $pdo->prepare('INSERT INTO practice_steps (practice_id, title, detail, cases, anchor, days, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')->execute([pid(), ...array_values($cols), $admin['id'], now_str()]);
        $id = (int)$pdo->lastInsertId();
        audit('create', 'practice_step', $id, null, $admin, $title);
    }
    json_response(['ok' => true, 'id' => $id]);
}

// Turn a built-in Next step or checklist item off (or back on) for every
// case in the practice. Cases keep any completion already recorded.
function handle_step_silence() {
    require_method('POST');
    $admin = require_user('users.manage');
    $b = json_body();
    $key = (string)($b['key'] ?? '');
    [$kind, $k] = array_pad(explode(':', $key, 2), 2, '');
    if (!(($kind === 'guide' && isset(CARE_GUIDE[$k])) || ($kind === 'check' && isset(CHECKLIST[$k])))) json_response(['error' => 'Unknown step'], 400);
    $pdo = pi_db();
    if (!empty($b['silenced'])) $pdo->prepare('INSERT IGNORE INTO practice_silenced (practice_id, item_key, created_by, created_at) VALUES (?,?,?,?)')->execute([pid(), $key, $admin['id'], now_str()]);
    else $pdo->prepare('DELETE FROM practice_silenced WHERE practice_id = ? AND item_key = ?')->execute([pid(), $key]);
    $title = $kind === 'guide' ? CARE_GUIDE[$k]['title'] : CHECKLIST[$k]['label'];
    audit('update', 'practice', pid(), null, $admin, 'Step ' . (!empty($b['silenced']) ? 'silenced' : 'turned back on') . ': ' . $title);
    json_response(['ok' => true]);
}

// ---- "InjuryCase Certified" website badge ----
function badge_payload(array $p): array {
    $st = badge_status($p);
    return ['certified' => $st['certified'], 'enabled' => !empty($p['badge_enabled']), 'enabledAt' => $p['badge_enabled_at'],
        'items' => array_map(fn($i) => ['key' => $i[0], 'label' => $i[1], 'met' => $i[2]], $st['items']),
        'urls' => badge_urls(badge_token_for($p))];
}

function handle_badge() {
    require_user('users.manage');
    json_response(['badge' => badge_payload(current_practice())]);
}

function handle_badge_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    $p = current_practice();
    $on = !empty(json_body()['enabled']);
    $at = $on ? ($p['badge_enabled_at'] ?: date('Y-m-d H:i:s')) : $p['badge_enabled_at'];
    pi_db()->prepare('UPDATE practices SET badge_enabled = ?, badge_enabled_at = ? WHERE id = ?')->execute([$on ? 1 : 0, $at, pid()]);
    audit('update', 'practice', pid(), null, $admin, 'Website badge', [['f' => 'badge', 't' => 'bool', 'from' => !empty($p['badge_enabled']), 'to' => $on]]);
    json_response(['badge' => badge_payload(['badge_enabled' => $on ? 1 : 0, 'badge_enabled_at' => $at] + $p)]);
}

// New links: badges already placed with the old code stop verifying.
function handle_badge_reset() {
    require_method('POST');
    $admin = require_user('users.manage');
    $p = current_practice();
    $t = bin2hex(random_bytes(12));
    pi_db()->prepare('UPDATE practices SET badge_token = ? WHERE id = ?')->execute([$t, pid()]);
    audit('reset_badge', 'practice', pid(), null, $admin, 'Website badge');
    json_response(['badge' => badge_payload(['badge_token' => $t] + $p)]);
}

// ---- locations (Platinum plan) ----
function handle_locations() {
    require_user('users.manage');
    $s = pi_db()->prepare('SELECT l.*, (SELECT COUNT(*) FROM cases c WHERE c.location_id = l.id AND c.archived_at IS NULL) cases,
        (SELECT COUNT(*) FROM users u WHERE u.location_id = l.id AND u.active = 1) users FROM locations l WHERE l.practice_id = ? ORDER BY l.active DESC, l.name');
    $s->execute([pid()]);
    json_response(['locations' => $s->fetchAll(), 'enabled' => has_feature(current_practice(), 'locations')]);
}

function handle_location_save() {
    require_method('POST');
    $admin = require_user('users.manage');
    require_feature('locations');
    $b = json_body();
    $id = (int)($b['id'] ?? 0);
    $st = strtoupper(trim((string)($b['state'] ?? '')));
    $cols = ['name' => str_or_null($b['name'] ?? null, 120), 'address' => str_or_null($b['address'] ?? null, 255), 'state' => isset(US_STATES[$st]) ? $st : null, 'phone' => str_or_null($b['phone'] ?? null, 40),
        'fax' => str_or_null($b['fax'] ?? null, 40), 'active' => array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : 1];
    if (!$cols['name']) json_response(['error' => 'Give the location a name.'], 400);
    $pdo = pi_db();
    if ($id) {
        $s = $pdo->prepare('SELECT * FROM locations WHERE id = ? AND practice_id = ?'); $s->execute([$id, pid()]);
        $before = $s->fetch() ?: json_response(['error' => 'Not found'], 404);
        $pdo->prepare('UPDATE locations SET name = ?, address = ?, state = ?, phone = ?, fax = ?, active = ? WHERE id = ? AND practice_id = ?')->execute([...array_values($cols), $id, pid()]);
        audit('update', 'location', $id, null, $admin, $cols['name'], audit_diff(['name' => 'label', 'address' => 'label', 'state' => 'label', 'phone' => 'label', 'fax' => 'label', 'active' => 'bool'], $before, $cols));
    } else {
        $pdo->prepare('INSERT INTO locations (practice_id, name, address, state, phone, fax, active, created_at) VALUES (?,?,?,?,?,?,?,?)')->execute([pid(), ...array_values($cols), now_str()]);
        $id = (int)$pdo->lastInsertId();
        audit('create', 'location', $id, null, $admin, $cols['name']);
    }
    json_response(['ok' => true, 'id' => $id]);
}

function handle_accept_baa() {
    require_method('POST');
    $admin = require_user('users.manage');
    if (empty(json_body()['accept'])) json_response(['error' => 'Tick the box to accept.'], 400);
    pi_db()->prepare('UPDATE practices SET baa_version = ?, baa_accepted_at = ?, baa_accepted_by = ? WHERE id = ?')
        ->execute([BAA_VERSION, now_str(), $admin['id'], pid()]);
    audit('accept_baa', 'practice', pid(), null, $admin, BAA_VERSION);
    json_response(['ok' => true]);
}

// The practice's audit log: who did what, when, from where. Filter by team
// member, kind of activity, case and dates; page back with "before";
// download as CSV for a compliance review.
const AUDIT_CATEGORIES = [
    'changes' => "a.action IN ('create','update','archive','forward_balance','ehr_import','letter','upload')",
    'access' => "a.action IN ('view','list','download','export','ehr_preview')",
    'signin' => "(a.action LIKE 'login%' OR a.action LIKE 'mfa%' OR a.action IN ('logout','session_timeout','password_changed','access_denied'))",
    'admin' => "(a.entity IN ('user','practice','audit_log') OR a.action LIKE 'reset_%' OR a.action LIKE 'billing_%' OR a.action = 'accept_baa')",
];

function audit_query(array $q, int $limit): array {
    $where = ['a.practice_id = ?'];
    $args = [pid()];
    if (!empty($q['case_id'])) { $where[] = 'a.case_id = ?'; $args[] = (int)$q['case_id']; }
    if (!empty($q['case_number'])) { $where[] = 'c.case_number = ?'; $args[] = trim((string)$q['case_number']); }
    if (!empty($q['user_id'])) { $where[] = 'a.user_id = ?'; $args[] = (int)$q['user_id']; }
    if (!empty($q['category']) && isset(AUDIT_CATEGORIES[$q['category']])) $where[] = AUDIT_CATEGORIES[$q['category']];
    if (!empty($q['action_filter'])) { $where[] = 'a.action = ?'; $args[] = (string)$q['action_filter']; }
    if (!empty($q['from']) && date_or_null($q['from'])) { $where[] = 'a.occurred_at >= ?'; $args[] = date_or_null($q['from']) . ' 00:00:00'; }
    if (!empty($q['to']) && date_or_null($q['to'])) { $where[] = 'a.occurred_at <= ?'; $args[] = date_or_null($q['to']) . ' 23:59:59'; }
    if (!empty($q['before'])) { $where[] = 'a.id < ?'; $args[] = (int)$q['before']; }
    $stmt = pi_db()->prepare('SELECT a.*, COALESCE(u.name, a.user_email) user_name, c.case_number, tk.title label FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id LEFT JOIN cases c ON c.id = a.case_id LEFT JOIN tasks tk ON a.entity = \'task\' AND tk.id = a.entity_id
        WHERE ' . implode(' AND ', $where) . " ORDER BY a.id DESC LIMIT $limit");
    $stmt->execute($args);
    return $stmt->fetchAll();
}

function handle_audit() {
    $admin = require_user('audit.read');
    $rows = audit_query($_GET, 201);
    $more = count($rows) > 200;
    $members = pi_db()->prepare('SELECT id, name, active FROM users WHERE practice_id = ? ORDER BY active DESC, name');
    $members->execute([pid()]);
    audit('view', 'audit_log', null, null, $admin);
    json_response(['entries' => array_map(fn($r) => present_audit($r, $admin), array_slice($rows, 0, 200)), 'more' => $more, 'members' => $members->fetchAll()]);
}

function handle_audit_csv() {
    $admin = require_user('audit.read');
    $rows = audit_query($_GET, 50000);
    audit('export', 'audit_log', null, null, $admin, ['rows' => count($rows)]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="injurycase-audit-' . date('Y-m-d') . '.csv"');
    header('Cache-Control: no-store');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['When', 'Team member', 'Email', 'Action', 'Record', 'Record id', 'Case', 'Changes', 'Detail', 'IP address']);
    foreach ($rows as $r) {
        $e = present_audit($r, $admin);
        $changes = implode('; ', array_map(fn($c) => $c['f'] . (array_key_exists('to', $c) ? ': ' . json_encode($c['from'] ?? null) . ' -> ' . json_encode($c['to'])  : ''), $e['changes']));
        fputcsv($out, array_map('csv_safe', [$r['occurred_at'], $r['user_name'], $r['user_email'], $r['action'], $r['entity'], $r['entity_id'], $r['case_number'], $changes, $e['detail'], $r['ip_address']]));
    }
    exit;
}

// Spreadsheet apps run cells that start with = + - @ as formulas.
function csv_safe($v): string {
    $v = (string)$v;
    return $v !== '' && strpbrk($v[0], "=+-@\t\r") !== false ? "'" . $v : $v;
}

// Dispatch last, once the constants above are defined.
$action = $_GET['action'] ?? '';
switch ($action) {
    case 'users': handle_users(); break;
    case 'user_save': handle_user_save(); break;
    case 'user_reset': handle_user_reset(); break;
    case 'practice': handle_practice(); break;
    case 'practice_save': handle_practice_save(); break;
    case 'accept_baa': handle_accept_baa(); break;
    case 'staff_finance': handle_staff_finance(); break;
    case 'audit': handle_audit(); break;
    case 'audit_csv': handle_audit_csv(); break;
    case 'notify_rules_save': handle_notify_rules_save(); break;
    case 'costs_save': handle_costs_save(); break;
    case 'steps': handle_steps(); break;
    case 'step_save': handle_step_save(); break;
    case 'step_silence': handle_step_silence(); break;
    case 'badge': handle_badge(); break;
    case 'badge_save': handle_badge_save(); break;
    case 'badge_reset': handle_badge_reset(); break;
    case 'locations': handle_locations(); break;
    case 'location_save': handle_location_save(); break;
    case 'my_notify': handle_my_notify(); break;
    case 'my_notify_save': handle_my_notify_save(); break;
    case 'task_email_rules_save': handle_task_email_rules_save(); break;
    case 'status_rules_save': handle_status_rules_save(); break;
    case 'narrative_fees_save': handle_narrative_fees_save(); break;
    case 'white_label_save': handle_white_label_save(); break;
    case 'white_label_logo': handle_white_label_logo(); break;
    case 'white_label_logo_remove': handle_white_label_logo_remove(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
