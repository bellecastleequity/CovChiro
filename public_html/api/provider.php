<?php
// Provider network API: pre-licensure registration, the provider's own
// dashboard (profile, credentials, shifts) and the admin's credentialing,
// shift, funnel and supply tools. Business rules live in
// php_backend/providers.php — in particular, nothing here can put a provider
// on a shift except assign_provider_to_shift(), which re-verifies
// eligibility itself. Requires migration_015_provider_network.sql.
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

try {
    switch ($action) {
        // public
        case 'schools': handle_schools($pdo); break;
        case 'campaign': handle_campaign($pdo); break;
        case 'lead': handle_lead($pdo); break;
        case 'register': handle_register($pdo); break;
        case 'unsubscribe': handle_unsubscribe($pdo); break;
        // provider
        case 'me': handle_me($pdo); break;
        case 'update_profile': handle_update_profile($pdo); break;
        case 'submit_credential': handle_submit_credential($pdo); break;
        case 'credential_file': handle_credential_file($pdo); break;
        case 'shifts': handle_shifts($pdo); break;
        case 'accept_shift': handle_accept_shift($pdo); break;
        // admin
        case 'admin_list': handle_admin_list($pdo); break;
        case 'admin_provider': handle_admin_provider($pdo); break;
        case 'admin_review_credential': handle_admin_review_credential($pdo); break;
        case 'admin_set_account': handle_admin_set_account($pdo); break;
        case 'admin_funnel': handle_admin_funnel($pdo); break;
        case 'admin_supply': handle_admin_supply($pdo); break;
        case 'admin_schools': handle_admin_schools($pdo); break;
        case 'admin_school_save': handle_admin_school_save($pdo); break;
        case 'admin_settings': handle_admin_settings($pdo); break;
        case 'admin_settings_save': handle_admin_settings_save($pdo); break;
        case 'admin_shifts': handle_admin_shifts($pdo); break;
        case 'admin_shift_save': handle_admin_shift_save($pdo); break;
        case 'admin_shift_candidates': handle_admin_shift_candidates($pdo); break;
        case 'admin_shift_assign': handle_admin_shift_assign($pdo); break;
        case 'admin_shift_unassign': handle_admin_shift_unassign($pdo); break;
        case 'admin_shift_status': handle_admin_shift_status($pdo); break;
        case 'admin_shift_review': handle_admin_shift_review($pdo); break;
        default: json_response(['error' => 'Unknown action'], 400);
    }
} catch (ProviderRuleException $e) {
    json_response(['error' => $e->getMessage(), 'reasons' => $e->reasons], 422);
}

// ================= helpers =================

function require_post() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
}

// A signed-in provider account (checked against the database, not the session).
function require_provider(PDO $pdo) {
    $current = require_login();
    $stmt = $pdo->prepare("SELECT p.*, u.email, u.name, u.phone, u.email_verified, u.account_type FROM users u JOIN providers p ON p.user_id = u.id WHERE u.id = ? AND u.account_type = 'provider'");
    $stmt->execute([$current['id']]);
    $p = $stmt->fetch();
    if (!$p) json_response(['error' => 'This page is for provider accounts.', 'notProvider' => true], 403);
    return $p;
}

function clean_date($v) {
    $v = trim((string)$v);
    if ($v === '') return null;
    $d = DateTime::createFromFormat('!Y-m-d', $v);
    if (!$d || $d->format('Y-m-d') !== $v) throw new ProviderRuleException('Enter dates as YYYY-MM-DD.');
    $y = (int)$d->format('Y');
    if ($y < 1950 || $y > (int)date('Y') + 10) throw new ProviderRuleException('That date looks out of range.');
    return $v;
}

function clean_states($list) {
    $list = is_array($list) ? $list : explode(',', (string)$list);
    $out = array_values(array_unique(array_filter(array_map(fn($s) => strtoupper(trim((string)$s)), $list), fn($s) => in_array($s, US_STATES, true))));
    return $out;
}

function clean_str($v, $max) {
    return mb_substr(sanitize(trim((string)$v)), 0, $max);
}

function clean_money($v) {
    $v = trim((string)$v);
    if ($v === '') return null;
    $n = (float)preg_replace('/[^0-9.]/', '', $v);
    return $n > 0 ? round($n, 2) : null;
}

function school_by_id(PDO $pdo, $id) {
    if (!$id) return null;
    $stmt = $pdo->prepare('SELECT * FROM provider_schools WHERE id = ?');
    $stmt->execute([(int)$id]);
    return $stmt->fetch() ?: null;
}

function school_by_slug(PDO $pdo, $slug) {
    $slug = strtolower(trim((string)$slug));
    if ($slug === '') return null;
    $stmt = $pdo->prepare('SELECT * FROM provider_schools WHERE slug = ?');
    $stmt->execute([$slug]);
    return $stmt->fetch() ?: null;
}

// Where a sign-up came from: a school/event campaign URL wins, then a
// recognisable utm_source, then what the person told us, else "direct".
function resolve_source(?array $school, array $utm, $selected) {
    if ($school) return $school['kind'] === 'event' ? 'event' : 'school';
    $u = strtolower($utm['source'] ?? '');
    $map = ['facebook' => 'facebook', 'fb' => 'facebook', 'meta' => 'facebook', 'instagram' => 'instagram', 'ig' => 'instagram', 'google' => 'google', 'adwords' => 'google', 'referral' => 'referral'];
    if (isset($map[$u])) return $map[$u];
    $selected = (string)$selected;
    return isset(PROVIDER_SOURCES[$selected]) ? $selected : 'direct';
}

function utm_from(array $body) {
    $u = is_array($body['utm'] ?? null) ? $body['utm'] : [];
    $out = [];
    foreach (['source', 'medium', 'campaign', 'term', 'content'] as $k) {
        $v = trim((string)($u[$k] ?? ''));
        $out[$k] = $v === '' ? null : mb_substr(sanitize($v), 0, 150);
    }
    return $out;
}

function credential_json(array $r, bool $admin = false) {
    return [
        'id' => (int)$r['id'], 'type' => $r['type'], 'status' => $r['status'],
        'licenseNumber' => $r['license_number'], 'licenseState' => $r['license_state'], 'issueDate' => $r['issue_date'],
        'carrier' => $r['carrier'], 'policyNumber' => $r['policy_number'], 'coverageStart' => $r['coverage_start'],
        'perClaimLimit' => $r['per_claim_limit'] !== null ? (float)$r['per_claim_limit'] : null,
        'aggregateLimit' => $r['aggregate_limit'] !== null ? (float)$r['aggregate_limit'] : null,
        'expirationDate' => $r['expiration_date'],
        'fileName' => $r['file_name'], 'hasFile' => (bool)$r['file_path'],
        'fileUrl' => $r['file_path'] ? '/api/provider.php?action=credential_file&id=' . (int)$r['id'] : null,
        'reviewNotes' => $r['review_notes'],
        'verifiedAt' => to_iso($r['verified_at']), 'verifiedBy' => $admin ? $r['verified_by'] : null,
        'submittedAt' => to_iso($r['submitted_at']),
    ];
}

function credential_state_json(array $s) {
    return [
        'status' => $s['status'], 'statusLabel' => $s['statusLabel'],
        'current' => $s['current'] ? credential_json($s['current']) : null,
        'renewal' => $s['renewal'] ? credential_json($s['renewal']) : null,
        'expiresAt' => $s['expiresAt'], 'daysToExpiry' => $s['daysToExpiry'],
    ];
}

function profile_json(array $p) {
    return [
        'id' => (int)$p['user_id'], 'name' => html_entity_decode($p['name'], ENT_QUOTES, 'UTF-8'), 'email' => $p['email'],
        'phone' => html_entity_decode((string)$p['phone'], ENT_QUOTES, 'UTF-8'), 'emailVerified' => (bool)$p['email_verified'],
        'schoolId' => $p['school_id'] ? (int)$p['school_id'] : null, 'schoolName' => html_entity_decode((string)$p['school_name'], ENT_QUOTES, 'UTF-8'),
        'graduationDate' => $p['graduation_date'], 'licensureApplied' => $p['licensure_applied'], 'expectedLicensure' => $p['expected_licensure'],
        'intendedStates' => array_values(array_filter(explode(',', (string)$p['intended_states']))),
        'preferredArea' => html_entity_decode((string)$p['preferred_area'], ENT_QUOTES, 'UTF-8'),
        'zip' => $p['zip_code'], 'city' => $p['city'], 'county' => $p['county'], 'state' => $p['state'], 'metro' => $p['metro'],
        'travelRadius' => (int)$p['travel_radius'], 'smsConsent' => (bool)$p['sms_consent'],
        'techniques' => html_entity_decode((string)$p['techniques'], ENT_QUOTES, 'UTF-8'), 'bio' => html_entity_decode((string)$p['bio'], ENT_QUOTES, 'UTF-8'),
        'lifecycle' => $p['lifecycle_status'], 'lifecycleLabel' => PROVIDER_LIFECYCLE[$p['lifecycle_status']] ?? $p['lifecycle_status'],
        'accountStatus' => $p['account_status'], 'followupsOptOut' => (bool)$p['followups_opt_out'],
        'createdAt' => to_iso($p['created_at']),
    ];
}

// The dashboard's "Your Coverage Readiness" checklist.
function readiness_checklist(array $p, array $lic, array $mal, array $elig) {
    $req = [];
    foreach ($elig['requirements'] as $r) $req[$r['key']] = $r['met'];
    $credItem = fn($label, $s, $key) => [
        'key' => $key, 'label' => $label, 'done' => $s['status'] === 'verified',
        'status' => $s['status'], 'detail' => $s['statusLabel'] . ($s['renewal'] ? ' · renewal ' . ($s['renewal']['status'] === 'rejected' ? 'needs correction' : 'under review') : ''),
    ];
    $bothVerified = $lic['status'] === 'verified' && $mal['status'] === 'verified';
    $bothIn = credential_submitted($lic) && credential_submitted($mal);
    return [
        ['key' => 'account', 'label' => 'Account created', 'done' => true, 'detail' => $p['account_status'] === 'suspended' ? 'Account on hold — contact us' : null],
        ['key' => 'email', 'label' => 'Email confirmed', 'done' => (bool)$p['email_verified']],
        ['key' => 'contact', 'label' => 'Contact information', 'done' => !empty($req['contact'])],
        ['key' => 'graduation', 'label' => 'Graduation information', 'done' => $p['graduation_date'] && ($p['school_id'] || trim((string)$p['school_name']) !== '')],
        $credItem('Chiropractic license', $lic, 'license'),
        $credItem('Malpractice insurance', $mal, 'malpractice'),
        ['key' => 'verification', 'label' => 'Credential verification', 'done' => $bothVerified,
            'detail' => $bothVerified ? 'Verified' : ($bothIn ? 'Credentials under review' : 'Waiting on credentials')],
    ];
}

function provider_payload(PDO $pdo, int $userId) {
    $refresh = provider_refresh_status($pdo, $userId, true);
    $stmt = $pdo->prepare('SELECT p.*, u.email, u.name, u.phone, u.email_verified FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?');
    $stmt->execute([$userId]);
    $p = $stmt->fetch();
    $lic = $refresh['credentials']['license'];
    $mal = $refresh['credentials']['malpractice'];
    return [
        'profile' => profile_json($p),
        'readiness' => [
            'eligible' => $refresh['eligible'],
            'checklist' => readiness_checklist($p, $lic, $mal, $refresh['eligibility']),
            'reasons' => $refresh['eligibility']['reasons'],
        ],
        'credentials' => [
            'license' => credential_state_json($lic),
            'malpractice' => credential_state_json($mal),
            'history' => array_map('credential_json', array_values(array_filter($refresh['credentials']['rows'], fn($r) => $r['status'] !== 'superseded'))),
        ],
    ];
}

function start_provider_session(int $userId, string $email) {
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['email'] = $email;
    $_SESSION['is_admin'] = (strtolower($email) === strtolower(ADMIN_EMAIL));
}

// ================= public =================

function handle_schools(PDO $pdo) {
    $rows = $pdo->query("SELECT id, slug, name, city, state FROM provider_schools WHERE active = 1 AND kind = 'school' ORDER BY name")->fetchAll();
    json_response(['schools' => array_map(fn($r) => ['id' => (int)$r['id'], 'slug' => $r['slug'], 'name' => $r['name'], 'city' => $r['city'], 'state' => $r['state']], $rows)]);
}

// Landing page data for /join/<slug>; counts the visit.
function handle_campaign(PDO $pdo) {
    $s = school_by_slug($pdo, $_GET['slug'] ?? '');
    if (!$s || !$s['active']) json_response(['campaign' => null]);
    if (empty($_GET['preview'])) $pdo->prepare('UPDATE provider_schools SET visits = visits + 1 WHERE id = ?')->execute([$s['id']]);
    json_response(['campaign' => ['id' => (int)$s['id'], 'slug' => $s['slug'], 'name' => $s['name'], 'kind' => $s['kind'], 'headline' => $s['headline'], 'city' => $s['city'], 'state' => $s['state']]]);
}

// Step 1 of the join form — captured even if they never finish signing up.
function handle_lead(PDO $pdo) {
    require_post();
    check_rate_limit($pdo, 'provider_lead', 20, 60, 30);
    $b = json_body();
    $email = strtolower(trim($b['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ProviderRuleException('Enter a valid email address.');
    $school = school_by_id($pdo, $b['schoolId'] ?? null) ?: school_by_slug($pdo, $b['campaign'] ?? '');
    $utm = utm_from($b);
    $grad = clean_date($b['graduationDate'] ?? '');
    $pdo->prepare('INSERT INTO provider_leads (email, name, phone, school_id, graduation_date, source, source_detail, utm_source, utm_medium, utm_campaign, landing_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), phone = COALESCE(VALUES(phone), phone), graduation_date = COALESCE(VALUES(graduation_date), graduation_date), school_id = COALESCE(VALUES(school_id), school_id)')
        ->execute([$email, clean_str($b['name'] ?? '', 255), clean_str($b['phone'] ?? '', 30) ?: null, $school['id'] ?? null, $grad,
            resolve_source($school, $utm, $b['source'] ?? ''), clean_str($b['sourceDetail'] ?? '', 255) ?: null,
            $utm['source'], $utm['medium'], $utm['campaign'], clean_str($b['landingPath'] ?? '', 255) ?: null, date('Y-m-d H:i:s')]);
    json_response(['success' => true]);
}

function handle_register(PDO $pdo) {
    require_post();
    check_rate_limit($pdo, 'register', 8, 60, 30);
    $b = json_body();
    $name = trim($b['name'] ?? '');
    $email = strtolower(trim($b['email'] ?? ''));
    $password = (string)($b['password'] ?? '');
    $phone = trim($b['phone'] ?? '');
    $zip = trim($b['zip'] ?? '');
    if ($name === '') throw new ProviderRuleException('Enter your name.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ProviderRuleException('Enter a valid email address.');
    if (strlen($password) < 8) throw new ProviderRuleException('Password must be at least 8 characters.');
    if (strlen(preg_replace('/\D/', '', $phone)) < 10) throw new ProviderRuleException('Enter your mobile number.');
    if (!preg_match('/^\d{5}$/', $zip)) throw new ProviderRuleException('Enter a 5-digit ZIP code.');
    $grad = clean_date($b['graduationDate'] ?? '');
    if (!$grad) throw new ProviderRuleException('Enter your graduation date (or expected graduation date).');
    $states = clean_states($b['intendedStates'] ?? []);
    if (!$states) throw new ProviderRuleException('Choose at least one state where you plan to be licensed.');
    $campaign = school_by_slug($pdo, $b['campaign'] ?? '');
    // Arriving via a school's own link (/join/palmer) implies that school.
    $school = school_by_id($pdo, $b['schoolId'] ?? null) ?: (($campaign && $campaign['kind'] === 'school' && trim((string)($b['schoolName'] ?? '')) === '') ? $campaign : null);
    $schoolName = $school['name'] ?? clean_str($b['schoolName'] ?? '', 200);
    if (!$school && $schoolName === '') throw new ProviderRuleException('Choose your chiropractic school.');
    $applied = in_array($b['licensureApplied'] ?? '', ['no', 'yes', 'licensed'], true) ? $b['licensureApplied'] : 'no';
    $expected = isset(PROVIDER_EXPECTED_LICENSURE[$b['expectedLicensure'] ?? '']) ? $b['expectedLicensure'] : null;
    if ($applied === 'licensed') $expected = 'licensed';
    $radius = max(5, min(500, (int)($b['travelRadius'] ?? 50)));

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) json_response(['error' => 'An account already exists for that email. Sign in instead.'], 409);

    $utm = utm_from($b);
    $source = resolve_source($campaign, $utm, $b['source'] ?? '');
    $geo = zip_geo($pdo, $zip);
    $now = date('Y-m-d H:i:s');
    $verifyToken = bin2hex(random_bytes(24));

    $pdo->beginTransaction();
    $pdo->prepare("INSERT INTO users (email, password_hash, name, phone, account_type, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, 'provider', ?, NOW())")
        ->execute([$email, password_hash($password, PASSWORD_DEFAULT), sanitize($name), sanitize($phone), $verifyToken]);
    $userId = (int)$pdo->lastInsertId();
    $sms = !empty($b['smsConsent']);
    $pdo->prepare('INSERT INTO providers (user_id, school_id, school_name, graduation_date, licensure_applied, expected_licensure, intended_states, preferred_area,
            zip_code, city, county, state, metro, lat, lng, travel_radius, sms_consent, sms_consent_at, source, source_detail,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_path, referrer, referred_by, unsubscribe_token, created_at, status_changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$userId, $school['id'] ?? null, $schoolName, $grad, $applied, $expected, implode(',', $states), clean_str($b['preferredArea'] ?? '', 200) ?: null,
            $zip, $geo['city'], $geo['county'], $geo['state'], $geo['metro'], $geo['lat'], $geo['lng'], $radius, $sms ? 1 : 0, $sms ? $now : null,
            $source, ($campaign ? $campaign['slug'] : clean_str($b['sourceDetail'] ?? '', 255)) ?: null,
            $utm['source'], $utm['medium'], $utm['campaign'], $utm['term'], $utm['content'],
            clean_str($b['landingPath'] ?? '', 255) ?: null, mb_substr(trim((string)($b['referrer'] ?? '')), 0, 500) ?: null,
            clean_str($b['referredBy'] ?? '', 255) ?: null, bin2hex(random_bytes(24)), $now, $now]);
    $pdo->prepare('UPDATE provider_leads SET user_id = ?, converted_at = ? WHERE email = ? AND user_id IS NULL')->execute([$userId, $now, $email]);
    $pdo->commit();

    provider_refresh_status($pdo, $userId, false);
    provider_email_welcome($pdo, ['user_id' => $userId, 'email' => $email, 'name' => $name], $verifyToken);
    start_provider_session($userId, $email);
    json_response(['success' => true] + provider_payload($pdo, $userId));
}

function handle_unsubscribe(PDO $pdo) {
    $token = (string)($_GET['token'] ?? '');
    $ok = false;
    if (preg_match('/^[a-f0-9]{48}$/', $token)) {
        $stmt = $pdo->prepare('UPDATE providers SET followups_opt_out = 1 WHERE unsubscribe_token = ?');
        $stmt->execute([$token]);
        $ok = true; // already unsubscribed also lands here
    }
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed</title></head><body style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 18px;color:#1C2430;">'
        . ($ok ? '<h1 style="font-weight:normal;">You’re unsubscribed</h1><p>You won’t receive credential reminders or open-shift emails any more. Important account notices (verification results, expirations, and shifts you’ve accepted) still come through.</p>'
               : '<h1 style="font-weight:normal;">Link not recognised</h1>')
        . '<p><a href="' . htmlspecialchars(SITE_URL) . '/provider.html" style="color:#2F5D53;">Go to my provider dashboard</a></p></body></html>';
    exit;
}

// ================= provider =================

function handle_me(PDO $pdo) {
    $p = require_provider($pdo);
    json_response(provider_payload($pdo, (int)$p['user_id']));
}

function handle_update_profile(PDO $pdo) {
    require_post();
    $p = require_provider($pdo);
    $b = json_body();
    $uid = (int)$p['user_id'];
    $name = trim($b['name'] ?? '');
    $phone = trim($b['phone'] ?? '');
    $zip = trim($b['zip'] ?? '');
    if ($name === '') throw new ProviderRuleException('Name is required.');
    if ($phone !== '' && strlen(preg_replace('/\D/', '', $phone)) < 10) throw new ProviderRuleException('Enter a valid mobile number.');
    if ($zip !== '' && !preg_match('/^\d{5}$/', $zip)) throw new ProviderRuleException('Enter a 5-digit ZIP code.');
    $states = clean_states($b['intendedStates'] ?? []);
    if (!$states) throw new ProviderRuleException('Choose at least one state.');
    $school = school_by_id($pdo, $b['schoolId'] ?? null);
    $applied = in_array($b['licensureApplied'] ?? '', ['no', 'yes', 'licensed'], true) ? $b['licensureApplied'] : $p['licensure_applied'];
    $expected = isset(PROVIDER_EXPECTED_LICENSURE[$b['expectedLicensure'] ?? '']) ? $b['expectedLicensure'] : $p['expected_licensure'];
    $sms = !empty($b['smsConsent']);

    $geoSql = '';
    $geoArgs = [];
    if ($zip !== $p['zip_code']) {
        $g = $zip !== '' ? zip_geo($pdo, $zip) : ['city' => null, 'county' => null, 'state' => null, 'metro' => null, 'lat' => null, 'lng' => null];
        $geoSql = ', city = ?, county = ?, state = ?, metro = ?, lat = ?, lng = ?';
        $geoArgs = [$g['city'], $g['county'], $g['state'], $g['metro'], $g['lat'], $g['lng']];
    }
    $pdo->prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?')->execute([sanitize($name), sanitize($phone), $uid]);
    $pdo->prepare("UPDATE providers SET school_id = ?, school_name = ?, graduation_date = ?, licensure_applied = ?, expected_licensure = ?, intended_states = ?,
            preferred_area = ?, zip_code = ?, travel_radius = ?, techniques = ?, bio = ?,
            sms_consent_at = CASE WHEN ? = 1 AND sms_consent = 0 THEN ? WHEN ? = 0 THEN NULL ELSE sms_consent_at END, sms_consent = ? {$geoSql}
        WHERE user_id = ?")
        ->execute(array_merge([
            $school['id'] ?? null, $school['name'] ?? clean_str($b['schoolName'] ?? $p['school_name'], 200),
            clean_date($b['graduationDate'] ?? '') ?? $p['graduation_date'], $applied, $expected, implode(',', $states),
            clean_str($b['preferredArea'] ?? '', 200) ?: null, $zip ?: null, max(5, min(500, (int)($b['travelRadius'] ?? $p['travel_radius']))),
            clean_str($b['techniques'] ?? '', 500) ?: null, clean_str($b['bio'] ?? '', 2000) ?: null,
            $sms ? 1 : 0, date('Y-m-d H:i:s'), $sms ? 1 : 0, $sms ? 1 : 0,
        ], $geoArgs, [$uid]));
    // Removing a phone number or ZIP can make someone ineligible.
    provider_flag_ineligible_assignments($pdo, $uid);
    json_response(['success' => true] + provider_payload($pdo, $uid));
}

// Multipart form: type, credential fields, file. With credentialId (and no
// file) it completes the details on an "uploaded" submission instead.
function handle_submit_credential(PDO $pdo) {
    require_post();
    $p = require_provider($pdo);
    $uid = (int)$p['user_id'];
    $type = $_POST['type'] ?? '';
    if (!in_array($type, PROVIDER_CREDENTIAL_TYPES, true)) throw new ProviderRuleException('Unknown credential type.');

    $f = [
        'license_number' => null, 'license_state' => null, 'issue_date' => null, 'carrier' => null, 'policy_number' => null,
        'coverage_start' => null, 'per_claim_limit' => null, 'aggregate_limit' => null,
        'expiration_date' => clean_date($_POST['expirationDate'] ?? ''),
    ];
    if ($type === 'license') {
        $f['license_number'] = clean_str($_POST['licenseNumber'] ?? '', 60) ?: null;
        $st = strtoupper(trim($_POST['licenseState'] ?? ''));
        $f['license_state'] = in_array($st, US_STATES, true) ? $st : null;
        $f['issue_date'] = clean_date($_POST['issueDate'] ?? '');
        $complete = $f['license_number'] && $f['license_state'] && $f['expiration_date'];
    } else {
        $f['carrier'] = clean_str($_POST['carrier'] ?? '', 150) ?: null;
        $f['policy_number'] = clean_str($_POST['policyNumber'] ?? '', 100) ?: null;
        $f['coverage_start'] = clean_date($_POST['coverageStart'] ?? '');
        $f['per_claim_limit'] = clean_money($_POST['perClaimLimit'] ?? '');
        $f['aggregate_limit'] = clean_money($_POST['aggregateLimit'] ?? '');
        $complete = $f['carrier'] && $f['policy_number'] && $f['expiration_date'];
    }
    if ($f['expiration_date'] && $f['expiration_date'] < date('Y-m-d')) {
        throw new ProviderRuleException('That expiration date has already passed — upload your current, renewed document.');
    }
    $status = $complete ? 'pending' : 'uploaded';
    $now = date('Y-m-d H:i:s');
    $hasFile = !empty($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE;

    $existingId = (int)($_POST['credentialId'] ?? 0);
    if ($existingId && !$hasFile) {
        $stmt = $pdo->prepare("SELECT * FROM provider_credentials WHERE id = ? AND provider_id = ? AND type = ? AND status = 'uploaded'");
        $stmt->execute([$existingId, $uid, $type]);
        if (!$stmt->fetch()) throw new ProviderRuleException('Only an incomplete upload can be finished this way — upload the document again.');
        $sets = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($f)));
        $pdo->prepare("UPDATE provider_credentials SET {$sets}, status = ?, submitted_at = ? WHERE id = ?")
            ->execute(array_merge(array_values($f), [$status, $now, $existingId]));
        $credId = $existingId;
    } else {
        if (!$hasFile) throw new ProviderRuleException('Attach a copy of your ' . strtolower(PROVIDER_CREDENTIAL_LABELS[$type]) . ' (PDF, JPG or PNG).');
        $file = $_FILES['file'];
        if ($file['error'] !== UPLOAD_ERR_OK) throw new ProviderRuleException('The upload didn’t complete. Try again.');
        if ($file['size'] > PROVIDER_UPLOAD_MAX_BYTES) throw new ProviderRuleException('File is too large (10MB max).');
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, PROVIDER_UPLOAD_ALLOWED_EXT, true)) throw new ProviderRuleException('Only PDF, JPG or PNG files are allowed.');
        if (function_exists('finfo_open')) {
            $mime = finfo_file(finfo_open(FILEINFO_MIME_TYPE), $file['tmp_name']);
            if (!in_array($mime, ['application/pdf', 'image/jpeg', 'image/png'], true)) throw new ProviderRuleException('That file doesn’t look like a PDF, JPG or PNG.');
        }
        $dir = provider_upload_dir() . '/' . $uid;
        if (!is_dir($dir)) mkdir($dir, 0750, true);
        $stored = $type . '-' . bin2hex(random_bytes(10)) . '.' . $ext;
        $moved = is_uploaded_file($file['tmp_name']) ? move_uploaded_file($file['tmp_name'], "{$dir}/{$stored}") : (defined('PROVIDER_TEST_UPLOADS') && rename($file['tmp_name'], "{$dir}/{$stored}"));
        if (!$moved) json_response(['error' => 'Could not save the file. Try again.'], 500);

        // Older submissions still waiting (or rejected) are replaced by this
        // one. A verified credential stays in force until this is verified.
        $pdo->prepare("UPDATE provider_credentials SET status = 'superseded' WHERE provider_id = ? AND type = ? AND status IN ('uploaded', 'pending', 'rejected')")
            ->execute([$uid, $type]);
        $cols = array_keys($f);
        $pdo->prepare('INSERT INTO provider_credentials (provider_id, type, status, ' . implode(', ', $cols) . ', file_path, file_name, submitted_at) VALUES (?, ?, ?, '
                . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?, ?)')
            ->execute(array_merge([$uid, $type, $status], array_values($f), ["provider_credentials/{$uid}/{$stored}", mb_substr(basename($file['name']), 0, 255), $now]));
        $credId = (int)$pdo->lastInsertId();
    }

    $payload = provider_payload($pdo, $uid);
    $stmt = $pdo->prepare('SELECT * FROM provider_credentials WHERE id = ?');
    $stmt->execute([$credId]);
    $creds = provider_credential_states($pdo, $uid);
    provider_email_credential_received($pdo, $p, $type, $stmt->fetch(), $creds['license'], $creds['malpractice']);
    json_response(['success' => true] + $payload);
}

// Credential documents live outside the web root and are only ever served
// through here, to their owner or the admin.
function handle_credential_file(PDO $pdo) {
    $user = require_login();
    $stmt = $pdo->prepare('SELECT * FROM provider_credentials WHERE id = ?');
    $stmt->execute([(int)($_GET['id'] ?? 0)]);
    $c = $stmt->fetch();
    if (!$c || !$c['file_path'] || (!$user['is_admin'] && (int)$c['provider_id'] !== (int)$user['id'])) json_response(['error' => 'Not found'], 404);
    $path = realpath(__DIR__ . '/../../php_backend/uploads/' . $c['file_path']);
    $base = realpath(provider_upload_dir());
    if (!$path || !$base || strpos($path, $base . DIRECTORY_SEPARATOR) !== 0 || !is_file($path)) json_response(['error' => 'File missing'], 404);
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $mime = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png'][$ext] ?? 'application/octet-stream';
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $c['file_name'] ?: basename($path)) . '"');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf");
    readfile($path);
    exit;
}

function shift_json(array $s, bool $full, ?array $provider = null) {
    $miles = $provider ? provider_distance_miles($provider['lat'], $provider['lng'], $s['lat'], $s['lng']) : null;
    return [
        'id' => $s['id'], 'date' => $s['shift_date'], 'dayType' => $s['day_type'], 'startTime' => $s['start_time'], 'endTime' => $s['end_time'],
        'city' => $s['city'], 'state' => $s['state'], 'zip' => $s['zip_code'], 'pay' => (float)$s['pay_amount'],
        'notes' => $full ? $s['notes'] : null,
        'clinicName' => $full ? html_entity_decode((string)$s['clinic_name'], ENT_QUOTES, 'UTF-8') : null,
        'address' => $full ? $s['address'] : null,
        'status' => $s['status'], 'miles' => $miles,
        'withinRadius' => $provider && $miles !== null ? $miles <= (int)$provider['travel_radius'] : null,
    ];
}

// Open shifts are only shown to providers who are eligible right now;
// everyone else sees a locked panel with the count and what's missing.
function handle_shifts(PDO $pdo) {
    $p = require_provider($pdo);
    $uid = (int)$p['user_id'];
    $today = date('Y-m-d');
    $elig = provider_shift_eligibility($pdo, $uid);
    $stmt = $pdo->prepare("SELECT * FROM provider_shifts WHERE provider_id = ? AND status IN ('assigned', 'completed') ORDER BY shift_date DESC");
    $stmt->execute([$uid]);
    $mine = array_map(fn($s) => shift_json($s, true, $p) + ['needsReview' => (bool)$s['needs_review']], $stmt->fetchAll());
    $stmt = $pdo->prepare("SELECT * FROM provider_shifts WHERE status = 'open' AND shift_date >= ? ORDER BY shift_date");
    $stmt->execute([$today]);
    $open = $stmt->fetchAll();
    if (!$elig['eligible']) {
        json_response(['locked' => true, 'reasons' => $elig['reasons'], 'openCount' => count($open), 'mine' => $mine]);
    }
    $list = [];
    foreach ($open as $s) {
        $e = provider_shift_eligibility($pdo, $uid, $s['shift_date'], $s['state'] ?: 'FL');
        $list[] = shift_json($s, false, $p) + ['canAccept' => $e['eligible'], 'blockedBy' => $e['reasons']];
    }
    usort($list, fn($a, $b) => [$a['withinRadius'] ? 0 : 1, $a['date']] <=> [$b['withinRadius'] ? 0 : 1, $b['date']]);
    json_response(['locked' => false, 'open' => $list, 'mine' => $mine]);
}

function handle_accept_shift(PDO $pdo) {
    require_post();
    $p = require_provider($pdo);
    $id = (string)(json_body()['id'] ?? '');
    $shift = assign_provider_to_shift($pdo, $id, (int)$p['user_id'], 'self');
    provider_email_shift_confirmed($pdo, $p, $shift);
    json_response(['success' => true, 'shift' => shift_json($shift, true, $p)]);
}

// ================= admin =================

function all_credentials_by_provider(PDO $pdo) {
    $by = [];
    foreach ($pdo->query('SELECT * FROM provider_credentials ORDER BY submitted_at DESC, id DESC')->fetchAll() as $r) $by[(int)$r['provider_id']][] = $r;
    return $by;
}

function shift_counts_by_provider(PDO $pdo) {
    $rows = $pdo->query("SELECT provider_id, COUNT(*) AS c, SUM(status = 'completed') AS done FROM provider_shifts WHERE provider_id IS NOT NULL AND status IN ('assigned', 'completed') GROUP BY provider_id")->fetchAll();
    $out = [];
    foreach ($rows as $r) $out[(int)$r['provider_id']] = ['total' => (int)$r['c'], 'completed' => (int)$r['done']];
    return $out;
}

function admin_provider_rows(PDO $pdo) {
    return $pdo->query('SELECT p.*, u.email, u.name, u.phone, u.email_verified, s.name AS school_label, s.slug AS school_slug
        FROM providers p JOIN users u ON u.id = p.user_id LEFT JOIN provider_schools s ON s.id = p.school_id ORDER BY p.created_at DESC')->fetchAll();
}

function handle_admin_list(PDO $pdo) {
    require_admin();
    $creds = all_credentials_by_provider($pdo);
    $shifts = shift_counts_by_provider($pdo);
    $out = [];
    $queue = [];
    foreach (admin_provider_rows($pdo) as $p) {
        $uid = (int)$p['user_id'];
        $rows = $creds[$uid] ?? [];
        $lic = provider_credential_state($rows, 'license');
        $mal = provider_credential_state($rows, 'malpractice');
        foreach ($rows as $r) {
            if ($r['status'] === 'pending') $queue[] = credential_json($r, true) + ['providerId' => $uid, 'providerName' => html_entity_decode($p['name'], ENT_QUOTES, 'UTF-8'), 'providerEmail' => $p['email']];
        }
        $out[] = profile_json($p) + [
            'schoolSlug' => $p['school_slug'], 'source' => $p['source'], 'sourceDetail' => $p['source_detail'],
            'utmCampaign' => $p['utm_campaign'], 'eligible' => (bool)$p['shift_eligible'],
            'license' => ['status' => $lic['status'], 'expiresAt' => $lic['expiresAt'], 'renewal' => (bool)$lic['renewal']],
            'malpractice' => ['status' => $mal['status'], 'expiresAt' => $mal['expiresAt'], 'renewal' => (bool)$mal['renewal']],
            'shifts' => $shifts[$uid]['total'] ?? 0, 'lastFollowupAt' => to_iso($p['last_followup_at']), 'lastFollowupKind' => $p['last_followup_kind'],
        ];
    }
    usort($queue, fn($a, $b) => strcmp($a['submittedAt'], $b['submittedAt']));
    json_response(['providers' => $out, 'queue' => $queue, 'lifecycle' => PROVIDER_LIFECYCLE, 'sources' => PROVIDER_SOURCES]);
}

function handle_admin_provider(PDO $pdo) {
    require_admin();
    $uid = (int)($_GET['id'] ?? 0);
    $stmt = $pdo->prepare('SELECT p.*, u.email, u.name, u.phone, u.email_verified FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?');
    $stmt->execute([$uid]);
    $p = $stmt->fetch();
    if (!$p) json_response(['error' => 'Provider not found'], 404);
    $refresh = provider_refresh_status($pdo, $uid, true);
    $stmt = $pdo->prepare('SELECT kind, subject, ok, sent_at FROM provider_messages WHERE provider_id = ? ORDER BY sent_at DESC, id DESC LIMIT 50');
    $stmt->execute([$uid]);
    $messages = array_map(fn($m) => ['kind' => $m['kind'], 'subject' => $m['subject'], 'ok' => (bool)$m['ok'], 'sentAt' => to_iso($m['sent_at'])], $stmt->fetchAll());
    $stmt = $pdo->prepare('SELECT * FROM provider_shifts WHERE provider_id = ? ORDER BY shift_date DESC');
    $stmt->execute([$uid]);
    $shifts = array_map(fn($s) => shift_json($s, true, $p) + ['needsReview' => (bool)$s['needs_review'], 'reviewReason' => $s['review_reason']], $stmt->fetchAll());
    json_response([
        'profile' => profile_json(array_merge($p, ['lifecycle_status' => $refresh['stage']])) + [
            'source' => $p['source'], 'sourceDetail' => $p['source_detail'], 'referredBy' => $p['referred_by'], 'referrer' => $p['referrer'], 'landingPath' => $p['landing_path'],
            'utm' => ['source' => $p['utm_source'], 'medium' => $p['utm_medium'], 'campaign' => $p['utm_campaign'], 'term' => $p['utm_term'], 'content' => $p['utm_content']],
            'suspendedReason' => $p['suspended_reason'], 'smsConsentAt' => to_iso($p['sms_consent_at']),
            'followupStep' => (int)$p['followup_step'], 'firstReadyAt' => to_iso($p['first_ready_at']), 'firstShiftAt' => to_iso($p['first_shift_at']),
        ],
        'eligibility' => $refresh['eligibility'],
        'license' => credential_state_json($refresh['credentials']['license']),
        'malpractice' => credential_state_json($refresh['credentials']['malpractice']),
        'credentials' => array_map(fn($r) => credential_json($r, true), $refresh['credentials']['rows']),
        'messages' => $messages,
        'shifts' => $shifts,
    ]);
}

// verify | reject | revoke one credential submission. Verification requires
// the fields that make the credential checkable, and a future expiry date.
function handle_admin_review_credential(PDO $pdo) {
    require_post();
    $admin = require_admin();
    $b = json_body();
    $stmt = $pdo->prepare('SELECT * FROM provider_credentials WHERE id = ?');
    $stmt->execute([(int)($b['id'] ?? 0)]);
    $c = $stmt->fetch();
    if (!$c) json_response(['error' => 'Credential not found'], 404);
    $uid = (int)$c['provider_id'];
    $decision = $b['decision'] ?? '';
    $notes = trim((string)($b['notes'] ?? ''));
    $now = date('Y-m-d H:i:s');

    if ($decision === 'verify') {
        if (!in_array($c['status'], ['pending', 'uploaded', 'rejected'], true)) throw new ProviderRuleException('Only a submission awaiting review can be verified.');
        // The admin may correct details read off the document while verifying.
        $fix = [
            'expiration_date' => array_key_exists('expirationDate', $b) ? clean_date($b['expirationDate']) : $c['expiration_date'],
            'license_number' => array_key_exists('licenseNumber', $b) ? (clean_str($b['licenseNumber'], 60) ?: null) : $c['license_number'],
            'license_state' => array_key_exists('licenseState', $b) ? (in_array(strtoupper((string)$b['licenseState']), US_STATES, true) ? strtoupper($b['licenseState']) : null) : $c['license_state'],
            'carrier' => array_key_exists('carrier', $b) ? (clean_str($b['carrier'], 150) ?: null) : $c['carrier'],
            'policy_number' => array_key_exists('policyNumber', $b) ? (clean_str($b['policyNumber'], 100) ?: null) : $c['policy_number'],
        ];
        if (!$c['file_path']) throw new ProviderRuleException('There is no document to verify against.');
        if (!$fix['expiration_date'] || $fix['expiration_date'] < date('Y-m-d')) throw new ProviderRuleException('A current (future) expiration date is required to verify.');
        if ($c['type'] === 'license' && (!$fix['license_number'] || !$fix['license_state'])) throw new ProviderRuleException('License number and state are required to verify.');
        if ($c['type'] === 'malpractice' && (!$fix['carrier'] || !$fix['policy_number'])) throw new ProviderRuleException('Carrier and policy number are required to verify.');
        $pdo->beginTransaction();
        $pdo->prepare("UPDATE provider_credentials SET status = 'verified', expiration_date = ?, license_number = ?, license_state = ?, carrier = ?, policy_number = ?,
                verified_by = ?, verified_at = ?, reviewed_at = ?, review_notes = ?, renewal_reminded_days = NULL, expired_notified_at = NULL WHERE id = ?")
            ->execute([$fix['expiration_date'], $fix['license_number'], $fix['license_state'], $fix['carrier'], $fix['policy_number'], $admin['email'], $now, $now, $notes ?: null, $c['id']]);
        // A newly verified credential replaces the one it renews (same state, for licenses).
        $sql = "UPDATE provider_credentials SET status = 'superseded' WHERE provider_id = ? AND type = ? AND id <> ? AND status IN ('verified', 'expired')";
        $args = [$uid, $c['type'], $c['id']];
        if ($c['type'] === 'license') { $sql .= ' AND license_state = ?'; $args[] = $fix['license_state']; }
        $pdo->prepare($sql)->execute($args);
        $pdo->commit();
        $decisionKey = 'verified';
    } elseif ($decision === 'reject' || $decision === 'revoke') {
        if ($notes === '') throw new ProviderRuleException('Add a note telling the provider what needs to be corrected.');
        $allowed = $decision === 'reject' ? ['pending', 'uploaded'] : ['verified'];
        if (!in_array($c['status'], $allowed, true)) throw new ProviderRuleException($decision === 'reject' ? 'Only a submission awaiting review can be rejected.' : 'Only a verified credential can be revoked.');
        $pdo->prepare("UPDATE provider_credentials SET status = 'rejected', reviewed_at = ?, review_notes = ?, verified_by = ? WHERE id = ?")
            ->execute([$now, mb_substr($notes, 0, 500), $admin['email'], $c['id']]);
        $decisionKey = 'rejected';
    } else {
        throw new ProviderRuleException('Unknown decision.');
    }

    $refresh = provider_refresh_status($pdo, $uid, true);
    $flagged = provider_flag_ineligible_assignments($pdo, $uid);
    $u = $pdo->prepare('SELECT p.user_id, p.unsubscribe_token, u.email, u.name FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?');
    $u->execute([$uid]);
    $p = $u->fetch();
    // When verification completes eligibility, the Coverage Ready email
    // (sent by provider_refresh_status) says it all.
    if (!($decisionKey === 'verified' && $refresh['eligible'])) {
        provider_email_credential_reviewed($pdo, $p, $c['type'], $decisionKey, $notes ?: null, $refresh['credentials']['license'], $refresh['credentials']['malpractice']);
    }
    json_response(['success' => true, 'eligible' => $refresh['eligible'], 'stage' => $refresh['stage'], 'flaggedShifts' => count($flagged)]);
}

function handle_admin_set_account(PDO $pdo) {
    require_post();
    require_admin();
    $b = json_body();
    $uid = (int)($b['id'] ?? 0);
    $status = ($b['status'] ?? '') === 'suspended' ? 'suspended' : 'active';
    $reason = $status === 'suspended' ? clean_str($b['reason'] ?? '', 255) : null;
    $stmt = $pdo->prepare('UPDATE providers SET account_status = ?, suspended_reason = ? WHERE user_id = ?');
    $stmt->execute([$status, $reason, $uid]);
    $refresh = provider_refresh_status($pdo, $uid, true);
    $flagged = provider_flag_ineligible_assignments($pdo, $uid);
    json_response(['success' => true, 'eligible' => $refresh['eligible'] ?? false, 'flaggedShifts' => count($flagged)]);
}

function source_spend(PDO $pdo) {
    $stmt = $pdo->prepare('SELECT value_json FROM app_settings WHERE name = "provider_source_spend"');
    $stmt->execute();
    $raw = $stmt->fetchColumn();
    return $raw ? (json_decode($raw, true) ?: []) : [];
}

// Registered vs coverage-ready, the cumulative pipeline, today's stage mix,
// and conversion + cost by source and by school/campaign.
function handle_admin_funnel(PDO $pdo) {
    require_admin();
    $today = date('Y-m-d');
    $creds = all_credentials_by_provider($pdo);
    $shifts = shift_counts_by_provider($pdo);
    $providers = admin_provider_rows($pdo);
    $leadEmails = array_map('strtolower', $pdo->query('SELECT email FROM provider_leads')->fetchAll(PDO::FETCH_COLUMN));
    $allEmails = array_unique(array_merge($leadEmails, array_map(fn($p) => strtolower($p['email']), $providers)));

    $stages = array_fill_keys(array_keys(PROVIDER_LIFECYCLE), 0);
    $f = ['leads' => count($allEmails), 'accounts' => 0, 'graduated' => 0, 'licenseSubmitted' => 0, 'licensed' => 0, 'bothSubmitted' => 0,
          'coverageReady' => 0, 'firstShift' => 0, 'repeat' => 0];
    $bySource = [];
    $bySchool = [];
    $current = ['registered' => 0, 'coverageReady' => 0, 'suspended' => 0];
    $bump = function (&$bucket, $key, $label, $fields) {
        if (!isset($bucket[$key])) $bucket[$key] = ['key' => $key, 'label' => $label, 'registered' => 0, 'licensed' => 0, 'coverageReady' => 0, 'readyNow' => 0, 'firstShift' => 0];
        foreach ($fields as $k => $v) $bucket[$key][$k] += $v ? 1 : 0;
    };
    foreach ($providers as $p) {
        $uid = (int)$p['user_id'];
        $rows = $creds[$uid] ?? [];
        $hasLic = (bool)array_filter($rows, fn($r) => $r['type'] === 'license');
        $licVerified = (bool)array_filter($rows, fn($r) => $r['type'] === 'license' && $r['verified_at']);
        $hasMal = (bool)array_filter($rows, fn($r) => $r['type'] === 'malpractice');
        $sh = $shifts[$uid]['total'] ?? 0;
        $f['accounts']++;
        if ($p['graduation_date'] && $p['graduation_date'] <= $today) $f['graduated']++;
        if ($hasLic) $f['licenseSubmitted']++;
        if ($licVerified) $f['licensed']++;
        if ($hasLic && $hasMal) $f['bothSubmitted']++;
        if ($p['first_ready_at']) $f['coverageReady']++;
        if ($p['first_shift_at']) $f['firstShift']++;
        if ($sh >= 2) $f['repeat']++;
        $stages[$p['lifecycle_status']] = ($stages[$p['lifecycle_status']] ?? 0) + 1;
        $current['registered']++;
        if ($p['shift_eligible']) $current['coverageReady']++;
        if ($p['account_status'] === 'suspended') $current['suspended']++;
        $fields = ['registered' => true, 'licensed' => $licVerified, 'coverageReady' => (bool)$p['first_ready_at'], 'readyNow' => (bool)$p['shift_eligible'], 'firstShift' => (bool)$p['first_shift_at']];
        $bump($bySource, $p['source'], PROVIDER_SOURCES[$p['source']] ?? $p['source'], $fields);
        $schoolKey = $p['school_id'] ? 'id:' . $p['school_id'] : 'name:' . strtolower(trim((string)$p['school_name']));
        $bump($bySchool, $schoolKey, $p['school_label'] ?: html_entity_decode((string)$p['school_name'], ENT_QUOTES, 'UTF-8') ?: 'Unknown', $fields);
    }
    $spend = source_spend($pdo);
    foreach ($bySource as &$s) { $s['spend'] = (float)($spend[$s['key']] ?? 0); }
    unset($s);
    // Campaign URL attribution (/join/<slug>), with spend and visits.
    $campaigns = [];
    foreach ($pdo->query('SELECT * FROM provider_schools ORDER BY name')->fetchAll() as $c) {
        $viaUrl = array_filter($providers, fn($p) => $p['source_detail'] === $c['slug'] && in_array($p['source'], ['school', 'event'], true));
        $leads = (int)$pdo->query('SELECT COUNT(*) FROM provider_leads WHERE school_id = ' . (int)$c['id'])->fetchColumn();
        if (!$viaUrl && !$c['visits'] && !$leads && !(float)$c['campaign_cost']) continue;
        $campaigns[] = [
            'slug' => $c['slug'], 'name' => $c['name'], 'visits' => (int)$c['visits'], 'leads' => $leads, 'cost' => (float)$c['campaign_cost'],
            'registered' => count($viaUrl),
            'coverageReady' => count(array_filter($viaUrl, fn($p) => $p['first_ready_at'])),
            'firstShift' => count(array_filter($viaUrl, fn($p) => $p['first_shift_at'])),
        ];
    }
    $months = [];
    foreach ($providers as $p) { $m = substr($p['created_at'], 0, 7); $months[$m] = ($months[$m] ?? 0) + 1; }
    ksort($months);
    json_response([
        'current' => $current, 'funnel' => $f, 'stages' => $stages, 'stageLabels' => PROVIDER_LIFECYCLE,
        'bySource' => array_values($bySource), 'bySchool' => array_values($bySchool), 'campaigns' => $campaigns,
        'monthly' => array_map(fn($k, $v) => ['month' => $k, 'registered' => $v], array_keys($months), $months),
    ]);
}

// Provider density by geography, and — for a clinic ZIP — how many
// coverage-ready DCs are within 25/50/75/100 miles, and how many of those
// have said they'll travel that far.
function handle_admin_supply(PDO $pdo) {
    require_admin();
    $providers = $pdo->query("SELECT p.user_id, u.name, p.zip_code, p.city, p.county, p.state, p.metro, p.lat, p.lng, p.travel_radius, p.shift_eligible, p.lifecycle_status, p.account_status
        FROM providers p JOIN users u ON u.id = p.user_id")->fetchAll();
    $group = function ($keyFn) use ($providers) {
        $g = [];
        foreach ($providers as $p) {
            $k = $keyFn($p) ?: 'Unknown';
            $g[$k] ??= ['key' => $k, 'registered' => 0, 'pipeline' => 0, 'ready' => 0];
            $g[$k]['registered']++;
            if ($p['shift_eligible']) $g[$k]['ready']++; else $g[$k]['pipeline']++;
        }
        usort($g, fn($a, $b) => [$b['ready'], $b['registered']] <=> [$a['ready'], $a['registered']]);
        return array_values($g);
    };
    $out = [
        'byState' => $group(fn($p) => $p['state']),
        'byMetro' => $group(fn($p) => $p['metro'] ? $p['metro'] . ($p['state'] ? ", {$p['state']}" : '') : null),
        'byCounty' => $group(fn($p) => $p['county'] ? $p['county'] . ($p['state'] ? ", {$p['state']}" : '') : null),
        'byZip' => $group(fn($p) => $p['zip_code']),
        'points' => array_values(array_map(fn($p) => ['name' => html_entity_decode($p['name'], ENT_QUOTES, 'UTF-8'), 'lat' => (float)$p['lat'], 'lng' => (float)$p['lng'],
            'ready' => (bool)$p['shift_eligible'], 'radius' => (int)$p['travel_radius'], 'stage' => $p['lifecycle_status']],
            array_filter($providers, fn($p) => $p['lat'] !== null))),
        'radius' => null,
    ];
    $zip = trim($_GET['zip'] ?? '');
    if ($zip !== '') {
        if (!preg_match('/^\d{5}$/', $zip)) throw new ProviderRuleException('Enter a 5-digit ZIP code.');
        $geo = zip_geo($pdo, $zip);
        if ($geo['lat'] === null) throw new ProviderRuleException('Couldn’t locate that ZIP code.');
        $rings = [];
        foreach ([25, 50, 75, 100] as $r) $rings[$r] = ['miles' => $r, 'ready' => 0, 'readyWillTravel' => 0, 'pipeline' => 0];
        foreach ($providers as $p) {
            $d = provider_distance_miles($geo['lat'], $geo['lng'], $p['lat'], $p['lng']);
            if ($d === null) continue;
            foreach ($rings as $r => &$ring) {
                if ($d > $r) continue;
                if ($p['shift_eligible']) { $ring['ready']++; if ($d <= (int)$p['travel_radius']) $ring['readyWillTravel']++; }
                else $ring['pipeline']++;
            }
            unset($ring);
        }
        $out['radius'] = ['zip' => $zip, 'city' => $geo['city'], 'county' => $geo['county'], 'state' => $geo['state'], 'lat' => $geo['lat'], 'lng' => $geo['lng'], 'rings' => array_values($rings)];
    }
    json_response($out);
}

function handle_admin_schools(PDO $pdo) {
    require_admin();
    $rows = $pdo->query('SELECT s.*, (SELECT COUNT(*) FROM providers p WHERE p.school_id = s.id) AS students,
        (SELECT COUNT(*) FROM providers p WHERE p.source_detail = s.slug AND p.source IN ("school", "event")) AS via_link
        FROM provider_schools s ORDER BY s.active DESC, s.name')->fetchAll();
    json_response(['schools' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'slug' => $r['slug'], 'name' => $r['name'], 'city' => $r['city'], 'state' => $r['state'], 'kind' => $r['kind'],
        'headline' => $r['headline'], 'campaignCost' => (float)$r['campaign_cost'], 'active' => (bool)$r['active'], 'visits' => (int)$r['visits'],
        'students' => (int)$r['students'], 'viaLink' => (int)$r['via_link'], 'url' => SITE_URL . '/join/' . $r['slug'],
    ], $rows)]);
}

function handle_admin_school_save(PDO $pdo) {
    require_post();
    require_admin();
    $b = json_body();
    $slug = strtolower(trim((string)($b['slug'] ?? '')));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{1,58}$/', $slug)) throw new ProviderRuleException('Link name: 2–60 lowercase letters, numbers or dashes.');
    $name = clean_str($b['name'] ?? '', 200);
    if ($name === '') throw new ProviderRuleException('Enter a name.');
    $kind = in_array($b['kind'] ?? '', ['school', 'event', 'campaign'], true) ? $b['kind'] : 'school';
    $state = strtoupper(trim((string)($b['state'] ?? '')));
    $vals = [$slug, $name, clean_str($b['city'] ?? '', 100) ?: null, in_array($state, US_STATES, true) ? $state : null, $kind,
        clean_str($b['headline'] ?? '', 200) ?: null, max(0, (float)($b['campaignCost'] ?? 0)), !empty($b['active']) ? 1 : 0];
    $id = (int)($b['id'] ?? 0);
    $dupe = $pdo->prepare('SELECT id FROM provider_schools WHERE slug = ? AND id <> ?');
    $dupe->execute([$slug, $id]);
    if ($dupe->fetch()) throw new ProviderRuleException('That link name is already used.');
    if ($id) {
        $pdo->prepare('UPDATE provider_schools SET slug = ?, name = ?, city = ?, state = ?, kind = ?, headline = ?, campaign_cost = ?, active = ? WHERE id = ?')->execute(array_merge($vals, [$id]));
    } else {
        $pdo->prepare('INSERT INTO provider_schools (slug, name, city, state, kind, headline, campaign_cost, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(array_merge($vals, [date('Y-m-d H:i:s')]));
    }
    json_response(['success' => true]);
}

function handle_admin_settings(PDO $pdo) {
    require_admin();
    json_response(['automation' => provider_automation_settings($pdo), 'spend' => source_spend($pdo), 'sources' => PROVIDER_SOURCES]);
}

function handle_admin_settings_save(PDO $pdo) {
    require_post();
    require_admin();
    $b = json_body();
    $out = [];
    if (isset($b['automation'])) $out['automation'] = provider_save_automation_settings($pdo, (array)$b['automation']);
    if (isset($b['spend'])) {
        $spend = [];
        foreach ((array)$b['spend'] as $k => $v) if (isset(PROVIDER_SOURCES[$k]) && (float)$v > 0) $spend[$k] = round((float)$v, 2);
        $pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES ("provider_source_spend", ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)')->execute([json_encode((object)$spend)]);
        $out['spend'] = $spend;
    }
    json_response(['success' => true] + $out);
}

function admin_shift_json(array $s) {
    return shift_json($s, true) + [
        'providerId' => $s['provider_id'] ? (int)$s['provider_id'] : null,
        'providerName' => isset($s['provider_name']) ? html_entity_decode((string)$s['provider_name'], ENT_QUOTES, 'UTF-8') : null,
        'providerEmail' => $s['provider_email'] ?? null, 'bookingId' => $s['booking_id'],
        'assignedBy' => $s['assigned_by'], 'assignedAt' => to_iso($s['assigned_at']),
        'needsReview' => (bool)$s['needs_review'], 'reviewReason' => $s['review_reason'],
    ];
}

function handle_admin_shifts(PDO $pdo) {
    require_admin();
    $stmt = $pdo->prepare('SELECT s.*, u.name AS provider_name, u.email AS provider_email FROM provider_shifts s LEFT JOIN users u ON u.id = s.provider_id
        WHERE s.shift_date >= ? OR s.needs_review = 1 ORDER BY s.needs_review DESC, s.shift_date');
    $stmt->execute([date('Y-m-d', strtotime('-60 days'))]);
    json_response(['shifts' => array_map('admin_shift_json', $stmt->fetchAll())]);
}

function load_shift(PDO $pdo, string $id) {
    $stmt = $pdo->prepare('SELECT s.*, u.name AS provider_name, u.email AS provider_email FROM provider_shifts s LEFT JOIN users u ON u.id = s.provider_id WHERE s.id = ?');
    $stmt->execute([$id]);
    $s = $stmt->fetch();
    if (!$s) json_response(['error' => 'Shift not found'], 404);
    return $s;
}

// Create (or edit the details of) a shift. Optionally prefilled from an
// existing clinic booking, and optionally announced to every provider who is
// eligible on that date and whose travel radius reaches it.
function handle_admin_shift_save(PDO $pdo) {
    require_post();
    require_admin();
    $b = json_body();
    $date = clean_date($b['date'] ?? '');
    if (!$date || $date < date('Y-m-d')) throw new ProviderRuleException('Choose a shift date today or later.');
    $pay = clean_money($b['pay'] ?? '');
    if (!$pay) throw new ProviderRuleException('Enter the pay for this shift.');
    $booking = null;
    if (!empty($b['bookingId'])) {
        $stmt = $pdo->prepare('SELECT b.*, u.clinic_name, u.name AS client_name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
        $stmt->execute([$b['bookingId']]);
        $booking = $stmt->fetch() ?: null;
        if (!$booking) throw new ProviderRuleException('Booking not found.');
    }
    $zip = trim((string)($b['zip'] ?? '')) ?: ($booking['zip_code'] ?? '');
    $address = clean_str($b['address'] ?? '', 255) ?: ($booking['address'] ?? null);
    $geo = $zip ? zip_geo($pdo, $zip) : ['lat' => null, 'lng' => null, 'city' => null, 'state' => null];
    $lat = !empty($booking['lat']) ? $booking['lat'] : $geo['lat'];
    $lng = !empty($booking['lng']) ? $booking['lng'] : $geo['lng'];
    $state = strtoupper(trim((string)($b['state'] ?? ''))) ?: ($geo['state'] ?: 'FL');
    if (!in_array($state, US_STATES, true)) throw new ProviderRuleException('Choose a valid state.');
    $time = fn($v) => preg_match('/^\d{2}:\d{2}$/', (string)$v) ? $v : null;
    $fields = [
        'booking_id' => $booking['id'] ?? null, 'shift_date' => $date, 'day_type' => ($b['dayType'] ?? '') === 'half' ? 'half' : 'full',
        'start_time' => $time($b['startTime'] ?? ''), 'end_time' => $time($b['endTime'] ?? ''),
        'clinic_name' => clean_str($b['clinicName'] ?? '', 255) ?: ($booking ? ($booking['clinic_name'] ?: $booking['client_name']) : null),
        'address' => $address, 'city' => clean_str($b['city'] ?? '', 100) ?: $geo['city'], 'state' => $state, 'zip_code' => $zip ?: null,
        'lat' => $lat, 'lng' => $lng, 'pay_amount' => $pay, 'notes' => clean_str($b['notes'] ?? '', 2000) ?: null,
    ];
    $id = (string)($b['id'] ?? '');
    if ($id) {
        $s = load_shift($pdo, $id);
        if (!in_array($s['status'], ['open', 'assigned'], true)) throw new ProviderRuleException('Only open or assigned shifts can be edited.');
        if ($s['status'] === 'assigned' && ($s['shift_date'] !== $date || $s['state'] !== $state)) throw new ProviderRuleException('Unassign the provider before changing the date or state.');
        $sets = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($fields)));
        $pdo->prepare("UPDATE provider_shifts SET {$sets} WHERE id = ?")->execute(array_merge(array_values($fields), [$id]));
    } else {
        $id = generate_id('SH');
        $cols = array_keys($fields);
        $pdo->prepare('INSERT INTO provider_shifts (id, ' . implode(', ', $cols) . ', status, created_at) VALUES (?, ' . implode(', ', array_fill(0, count($cols), '?')) . ", 'open', ?)")
            ->execute(array_merge([$id], array_values($fields), [date('Y-m-d H:i:s')]));
    }
    $notified = 0;
    if (!empty($b['notify'])) {
        $s = load_shift($pdo, $id);
        foreach (shift_candidates($pdo, $s) as $c) {
            if (!$c['withinRadius'] || $c['optOut']) continue;
            if (provider_email_shift_available($pdo, $c['row'], $s, $c['miles'])) $notified++;
        }
    }
    json_response(['success' => true, 'id' => $id, 'notified' => $notified]);
}

// Providers eligible for this specific shift (date + state), nearest first.
function shift_candidates(PDO $pdo, array $s) {
    $rows = $pdo->query("SELECT p.*, u.email, u.name FROM providers p JOIN users u ON u.id = p.user_id WHERE p.shift_eligible = 1 AND p.account_status = 'active'")->fetchAll();
    $out = [];
    foreach ($rows as $p) {
        $e = provider_shift_eligibility($pdo, (int)$p['user_id'], $s['shift_date'], $s['state'] ?: 'FL');
        if (!$e['eligible']) continue;
        $miles = provider_distance_miles($p['lat'], $p['lng'], $s['lat'], $s['lng']);
        $out[] = ['row' => $p, 'miles' => $miles, 'withinRadius' => $miles !== null && $miles <= (int)$p['travel_radius'], 'optOut' => (bool)$p['followups_opt_out']];
    }
    usort($out, fn($a, $b) => ($a['miles'] ?? PHP_INT_MAX) <=> ($b['miles'] ?? PHP_INT_MAX));
    return $out;
}

function handle_admin_shift_candidates(PDO $pdo) {
    require_admin();
    $s = load_shift($pdo, (string)($_GET['id'] ?? ''));
    $list = shift_candidates($pdo, $s);
    json_response(['candidates' => array_map(fn($c) => [
        'id' => (int)$c['row']['user_id'], 'name' => html_entity_decode($c['row']['name'], ENT_QUOTES, 'UTF-8'), 'email' => $c['row']['email'],
        'city' => $c['row']['city'], 'zip' => $c['row']['zip_code'], 'miles' => $c['miles'], 'travelRadius' => (int)$c['row']['travel_radius'], 'withinRadius' => $c['withinRadius'],
    ], $list)]);
}

// Admin assignment goes through exactly the same eligibility guard as a
// provider accepting — there is no override.
function handle_admin_shift_assign(PDO $pdo) {
    require_post();
    $admin = require_admin();
    $b = json_body();
    $shift = assign_provider_to_shift($pdo, (string)($b['id'] ?? ''), (int)($b['providerId'] ?? 0), $admin['email']);
    $stmt = $pdo->prepare('SELECT p.user_id, u.email, u.name FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?');
    $stmt->execute([(int)$shift['provider_id']]);
    provider_email_shift_confirmed($pdo, $stmt->fetch(), $shift);
    json_response(['success' => true]);
}

function release_shift(PDO $pdo, array $s, string $newStatus, ?string $reason) {
    $pdo->prepare("UPDATE provider_shifts SET status = ?, provider_id = NULL, assigned_at = NULL, assigned_by = NULL, needs_review = 0, review_reason = NULL, flagged_at = NULL WHERE id = ?")
        ->execute([$newStatus, $s['id']]);
    if ($s['provider_id']) {
        provider_email_shift_released($pdo, ['user_id' => $s['provider_id'], 'email' => $s['provider_email'], 'name' => $s['provider_name']], $s, $reason);
        provider_refresh_status($pdo, (int)$s['provider_id'], false);
    }
}

function handle_admin_shift_unassign(PDO $pdo) {
    require_post();
    require_admin();
    $b = json_body();
    $s = load_shift($pdo, (string)($b['id'] ?? ''));
    if ($s['status'] !== 'assigned') throw new ProviderRuleException('This shift isn’t assigned.');
    release_shift($pdo, $s, 'open', clean_str($b['reason'] ?? '', 500) ?: null);
    json_response(['success' => true]);
}

function handle_admin_shift_status(PDO $pdo) {
    require_post();
    require_admin();
    $b = json_body();
    $s = load_shift($pdo, (string)($b['id'] ?? ''));
    $status = $b['status'] ?? '';
    if ($status === 'completed') {
        if ($s['status'] !== 'assigned') throw new ProviderRuleException('Only an assigned shift can be marked completed.');
        if ($s['shift_date'] > date('Y-m-d')) throw new ProviderRuleException('This shift hasn’t happened yet.');
        $pdo->prepare("UPDATE provider_shifts SET status = 'completed', completed_at = ?, needs_review = 0 WHERE id = ?")->execute([date('Y-m-d H:i:s'), $s['id']]);
        provider_refresh_status($pdo, (int)$s['provider_id'], false);
    } elseif ($status === 'cancelled') {
        if (!in_array($s['status'], ['open', 'assigned'], true)) throw new ProviderRuleException('This shift can’t be cancelled.');
        release_shift($pdo, $s, 'cancelled', clean_str($b['reason'] ?? '', 500) ?: 'The clinic no longer needs coverage on this date.');
    } else {
        throw new ProviderRuleException('Unknown status.');
    }
    json_response(['success' => true]);
}

// Clearing a review flag keeps the provider on the shift — allowed only if
// they are eligible again for that date (e.g. renewal now verified).
function handle_admin_shift_review(PDO $pdo) {
    require_post();
    require_admin();
    $s = load_shift($pdo, (string)(json_body()['id'] ?? ''));
    if (!$s['needs_review'] || !$s['provider_id']) throw new ProviderRuleException('Nothing to review on this shift.');
    $e = provider_shift_eligibility($pdo, (int)$s['provider_id'], $s['shift_date'], $s['state'] ?: 'FL');
    if (!$e['eligible']) throw new ProviderRuleException('The provider still isn’t eligible for this date: ' . implode('; ', $e['reasons']) . '. Unassign them or wait for renewed credentials to be verified.', $e['reasons']);
    $pdo->prepare('UPDATE provider_shifts SET needs_review = 0, review_reason = NULL, flagged_at = NULL WHERE id = ?')->execute([$s['id']]);
    json_response(['success' => true]);
}
