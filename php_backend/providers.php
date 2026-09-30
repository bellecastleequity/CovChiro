<?php
// Provider network: pre-licensure recruitment, credentialing and shift
// eligibility. Loaded by config.php, so every API endpoint and cron script
// has these available. Requires migration_015_provider_network.sql.
//
// The one rule everything here protects:
//   A provider may register and build a profile at any time, but can only
//   accept — or be assigned — a coverage shift when a chiropractic license
//   AND malpractice insurance have both been VERIFIED by the admin and are
//   unexpired on the shift date (plus the other account requirements in
//   provider_shift_eligibility()).
// provider_shift_eligibility() recomputes that from the credential rows on
// every call — it never trusts the cached providers.shift_eligible column —
// and assign_provider_to_shift() is the only code that puts a provider on a
// shift. Uploading a document never makes anyone eligible on its own.

class ProviderRuleException extends RuntimeException {
    public array $reasons;
    public function __construct(string $message, array $reasons = []) {
        parent::__construct($message);
        $this->reasons = $reasons;
    }
}

const PROVIDER_CREDENTIAL_TYPES = ['license', 'malpractice'];
const PROVIDER_CREDENTIAL_LABELS = ['license' => 'Chiropractic license', 'malpractice' => 'Malpractice insurance'];
const PROVIDER_CREDENTIAL_STATUS_LABELS = [
    'not_provided' => 'Not provided',
    'uploaded' => 'Uploaded — details incomplete',
    'pending' => 'Verification pending',
    'verified' => 'Verified',
    'rejected' => 'Needs correction',
    'expired' => 'Expired',
];
const PROVIDER_LIFECYCLE = [
    'registered' => 'Registered / New Graduate',
    'pending_license' => 'Pending License',
    'pending_malpractice' => 'Licensed / Pending Malpractice',
    'verification_pending' => 'Credential Verification Pending',
    'coverage_ready' => 'Coverage Ready',
    'active' => 'Active Provider',
];
const PROVIDER_SOURCES = [
    'school' => 'Chiropractic school', 'event' => 'Graduation / school event', 'facebook' => 'Facebook',
    'instagram' => 'Instagram', 'google' => 'Google', 'referral' => 'Referral', 'provider_referral' => 'Existing provider',
    'clinic_referral' => 'Clinic referral', 'organic' => 'Organic search', 'direct' => 'Direct', 'other' => 'Other',
];
const PROVIDER_EXPECTED_LICENSURE = [
    'licensed' => 'Already licensed', '0-1' => 'Within a month', '1-3' => '1–3 months', '3-6' => '3–6 months',
    '6-12' => '6–12 months', '12+' => 'More than a year', 'unsure' => 'Not sure yet',
];
const PROVIDER_UPLOAD_ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png'];
const PROVIDER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const PROVIDER_AUTOMATION_DEFAULTS = [
    'enabled' => true,
    'followupDays' => [30, 60, 90], // days after graduation (or sign-up, if later)
    'repeatDays' => 60,             // then every N days while still incomplete
    'minGapDays' => 14,             // never two follow-ups closer than this
    'renewalDays' => [60, 30, 14, 7],
];
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function provider_upload_dir() {
    return __DIR__ . '/uploads/provider_credentials';
}

function provider_portal_url($view = null) {
    return SITE_URL . '/provider.html' . ($view ? '?view=' . urlencode($view) : '');
}

// ---------- settings ----------

function provider_automation_settings(PDO $pdo) {
    $stmt = $pdo->prepare('SELECT value_json FROM app_settings WHERE name = "provider_automation"');
    $stmt->execute();
    $raw = $stmt->fetchColumn();
    $saved = $raw ? (json_decode($raw, true) ?: []) : [];
    return array_merge(PROVIDER_AUTOMATION_DEFAULTS, array_intersect_key($saved, PROVIDER_AUTOMATION_DEFAULTS));
}

// Validates and stores the admin-editable cadence. Day lists are cleaned to
// positive whole numbers, de-duplicated and sorted.
function provider_save_automation_settings(PDO $pdo, array $in) {
    $days = function ($list, $max) {
        $out = array_values(array_unique(array_filter(array_map('intval', (array)$list), fn($d) => $d > 0 && $d <= $max)));
        sort($out);
        return $out;
    };
    $s = [
        'enabled' => !empty($in['enabled']),
        'followupDays' => $days($in['followupDays'] ?? [], 730),
        'repeatDays' => max(7, min(365, (int)($in['repeatDays'] ?? 60))),
        'minGapDays' => max(1, min(90, (int)($in['minGapDays'] ?? 14))),
        'renewalDays' => array_reverse($days($in['renewalDays'] ?? [], 365)),
    ];
    if (!$s['followupDays']) throw new ProviderRuleException('Enter at least one follow-up day.');
    if (!$s['renewalDays']) throw new ProviderRuleException('Enter at least one renewal reminder day.');
    $stmt = $pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES ("provider_automation", ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
    $stmt->execute([json_encode($s)]);
    return $s;
}

// ---------- credentials ----------

function provider_credential_rows(PDO $pdo, int $providerId) {
    $stmt = $pdo->prepare('SELECT * FROM provider_credentials WHERE provider_id = ? ORDER BY submitted_at DESC, id DESC');
    $stmt->execute([$providerId]);
    return $stmt->fetchAll();
}

function credential_is_active(array $r, string $asOf) {
    return $r['status'] === 'verified' && !empty($r['expiration_date']) && $r['expiration_date'] >= $asOf;
}

// The display status of one credential type, from all of a provider's
// submissions (newest first):
//   verified      — a verified, unexpired row exists (a newer renewal may be
//                   under review or rejected; reported as 'renewal')
//   uploaded / pending / rejected — the newest submission's status
//   expired       — the newest verified row has passed its expiration date
//   not_provided  — nothing submitted
function provider_credential_state(array $rows, string $type, ?string $today = null) {
    $today = $today ?? date('Y-m-d');
    $ofType = array_values(array_filter($rows, fn($r) => $r['type'] === $type));
    $active = null; $latest = null;
    foreach ($ofType as $r) {
        if (!$active && credential_is_active($r, $today)) $active = $r;
        if (!$latest && $r['status'] !== 'superseded') $latest = $r;
    }
    $renewal = null;
    if ($active) {
        $status = 'verified';
        $current = $active;
        if ($latest && (int)$latest['id'] !== (int)$active['id'] && in_array($latest['status'], ['uploaded', 'pending', 'rejected'], true)) $renewal = $latest;
    } elseif ($latest) {
        $status = $latest['status'] === 'verified' ? 'expired' : $latest['status'];
        $current = $latest;
    } else {
        $status = 'not_provided';
        $current = null;
    }
    $exp = $active['expiration_date'] ?? null;
    return [
        'type' => $type,
        'status' => $status,
        'statusLabel' => PROVIDER_CREDENTIAL_STATUS_LABELS[$status],
        'current' => $current,
        'active' => $active,
        'renewal' => $renewal,
        'expiresAt' => $exp,
        'daysToExpiry' => $exp ? (int)floor((strtotime($exp) - strtotime($today)) / 86400) : null,
    ];
}

function provider_credential_states(PDO $pdo, int $providerId) {
    $rows = provider_credential_rows($pdo, $providerId);
    return [
        'license' => provider_credential_state($rows, 'license'),
        'malpractice' => provider_credential_state($rows, 'malpractice'),
        'rows' => $rows,
    ];
}

function credential_submitted($state) {
    return in_array($state['status'], ['uploaded', 'pending', 'verified'], true);
}

// ---------- eligibility (authoritative) ----------

// Whether $userId may accept or be assigned a coverage shift — optionally
// one on $forDate in $state. Every requirement is re-read from the database.
// Returns ['eligible' => bool, 'requirements' => [...], 'reasons' => [...]].
function provider_shift_eligibility(PDO $pdo, int $userId, ?string $forDate = null, ?string $state = null) {
    $today = date('Y-m-d');
    $asOf = ($forDate && $forDate > $today) ? $forDate : $today;
    $stmt = $pdo->prepare('SELECT u.id, u.email_verified, u.phone, u.account_type, p.user_id AS provider_row, p.account_status, p.zip_code
        FROM users u LEFT JOIN providers p ON p.user_id = u.id WHERE u.id = ?');
    $stmt->execute([$userId]);
    $u = $stmt->fetch();

    $isProvider = $u && ($u['account_type'] ?? 'clinic') === 'provider' && $u['provider_row'];
    $count = function ($type, $extraSql = '', array $extraArgs = []) use ($pdo, $userId, $asOf) {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM provider_credentials WHERE provider_id = ? AND type = ? AND status = 'verified'
            AND expiration_date IS NOT NULL AND expiration_date >= ? {$extraSql}");
        $stmt->execute(array_merge([$userId, $type, $asOf], $extraArgs));
        return (int)$stmt->fetchColumn();
    };
    $licenseOk = $isProvider && ($state ? $count('license', 'AND license_state = ?', [$state]) : $count('license')) > 0;
    $malpracticeOk = $isProvider && $count('malpractice') > 0;
    $dateNote = $asOf > $today ? ' through ' . date('M j, Y', strtotime($asOf)) : '';

    $req = [
        ['key' => 'account', 'label' => 'Provider account in good standing', 'met' => $isProvider && $u['account_status'] === 'active'],
        ['key' => 'email', 'label' => 'Email address confirmed', 'met' => $isProvider && (int)$u['email_verified'] === 1],
        ['key' => 'contact', 'label' => 'Mobile number and ZIP code on file', 'met' => $isProvider && trim((string)$u['phone']) !== '' && trim((string)$u['zip_code']) !== ''],
        ['key' => 'license', 'label' => 'Chiropractic license verified' . ($state ? " for {$state}" : '') . $dateNote, 'met' => $licenseOk],
        ['key' => 'malpractice', 'label' => 'Malpractice insurance verified' . $dateNote, 'met' => $malpracticeOk],
    ];
    $unmet = array_values(array_filter($req, fn($r) => !$r['met']));
    return [
        'eligible' => !$unmet,
        'asOf' => $asOf,
        'requirements' => $req,
        'reasons' => array_map(fn($r) => $r['label'], $unmet),
    ];
}

// ---------- lifecycle ----------

function provider_lifecycle(array $provider, array $lic, array $mal, bool $eligible, int $shiftCount) {
    if ($eligible) return $shiftCount > 0 ? 'active' : 'coverage_ready';
    if (!credential_submitted($lic)) {
        $grad = $provider['graduation_date'] ?? null;
        // "Registered / New Graduate" only until graduation, and only while
        // no license has ever been submitted (an expired or rejected one
        // means they're waiting on a license, not still in school).
        return ($lic['status'] === 'not_provided' && $grad && $grad > date('Y-m-d')) ? 'registered' : 'pending_license';
    }
    if (!credential_submitted($mal)) return 'pending_malpractice';
    return 'verification_pending';
}

// Recomputes and caches a provider's lifecycle stage + eligibility flag, and
// moves them into the Coverage Ready workflow the first time they qualify.
function provider_refresh_status(PDO $pdo, int $userId, bool $notify = true) {
    $stmt = $pdo->prepare('SELECT p.*, u.email, u.name FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?');
    $stmt->execute([$userId]);
    $p = $stmt->fetch();
    if (!$p) return null;
    $creds = provider_credential_states($pdo, $userId);
    $elig = provider_shift_eligibility($pdo, $userId);
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM provider_shifts WHERE provider_id = ? AND status IN ('assigned', 'completed')");
    $stmt->execute([$userId]);
    $shiftCount = (int)$stmt->fetchColumn();
    $stage = provider_lifecycle($p, $creds['license'], $creds['malpractice'], $elig['eligible'], $shiftCount);
    $now = date('Y-m-d H:i:s');

    $sets = ['lifecycle_status = ?', 'shift_eligible = ?'];
    $args = [$stage, $elig['eligible'] ? 1 : 0];
    if ($stage !== $p['lifecycle_status']) { $sets[] = 'status_changed_at = ?'; $args[] = $now; }
    if ($elig['eligible'] && !$p['first_ready_at']) { $sets[] = 'first_ready_at = ?'; $args[] = $now; }
    $sendReady = $notify && $elig['eligible'] && !$p['ready_notified_at'];
    if ($sendReady) { $sets[] = 'ready_notified_at = ?'; $args[] = $now; }
    // Lost eligibility (expired / revoked): the next time they qualify they
    // get the "you're coverage-ready" message again.
    if (!$elig['eligible'] && $p['ready_notified_at']) $sets[] = 'ready_notified_at = NULL';
    $args[] = $userId;
    $pdo->prepare('UPDATE providers SET ' . implode(', ', $sets) . ' WHERE user_id = ?')->execute($args);

    if ($sendReady) provider_email_coverage_ready($pdo, $p);
    return ['stage' => $stage, 'eligible' => $elig['eligible'], 'eligibility' => $elig, 'credentials' => $creds];
}

// ---------- shifts ----------

// The single place a provider is put on a shift, for both "accept" by the
// provider and "assign" by the admin. Row-locks the shift so two providers
// can't take it at once, and re-checks eligibility for the shift's own date
// and state inside the same transaction.
function assign_provider_to_shift(PDO $pdo, string $shiftId, int $providerId, string $by) {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT * FROM provider_shifts WHERE id = ? FOR UPDATE');
        $stmt->execute([$shiftId]);
        $shift = $stmt->fetch();
        if (!$shift) throw new ProviderRuleException('Shift not found.');
        if ($shift['status'] !== 'open' || $shift['provider_id']) throw new ProviderRuleException('This shift has already been filled.');
        if ($shift['shift_date'] < date('Y-m-d')) throw new ProviderRuleException('This shift date has passed.');

        $elig = provider_shift_eligibility($pdo, $providerId, $shift['shift_date'], $shift['state'] ?: 'FL');
        if (!$elig['eligible']) {
            throw new ProviderRuleException('Not eligible for this shift — credential verification is incomplete: ' . implode('; ', $elig['reasons']) . '.', $elig['reasons']);
        }
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM provider_shifts WHERE provider_id = ? AND shift_date = ? AND status IN ('assigned', 'completed')");
        $stmt->execute([$providerId, $shift['shift_date']]);
        if ((int)$stmt->fetchColumn() > 0) throw new ProviderRuleException('Already assigned to another shift on that date.');

        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare("UPDATE provider_shifts SET status = 'assigned', provider_id = ?, assigned_at = ?, assigned_by = ?, needs_review = 0, review_reason = NULL, flagged_at = NULL
            WHERE id = ? AND status = 'open' AND provider_id IS NULL");
        $stmt->execute([$providerId, $now, $by, $shiftId]);
        if ($stmt->rowCount() !== 1) throw new ProviderRuleException('This shift has already been filled.');
        $pdo->prepare('UPDATE providers SET first_shift_at = COALESCE(first_shift_at, ?) WHERE user_id = ?')->execute([$now, $providerId]);
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    provider_refresh_status($pdo, $providerId, false);
    $stmt = $pdo->prepare('SELECT * FROM provider_shifts WHERE id = ?');
    $stmt->execute([$shiftId]);
    return $stmt->fetch();
}

// Flags (rather than silently keeps or drops) every future assignment a
// provider is no longer eligible to work — used when a credential expires,
// is revoked, or the account is suspended. Returns the newly flagged shifts.
function provider_flag_ineligible_assignments(PDO $pdo, int $providerId, bool $notifyAdmin = true) {
    $stmt = $pdo->prepare("SELECT * FROM provider_shifts WHERE provider_id = ? AND status = 'assigned' AND shift_date >= ?");
    $stmt->execute([$providerId, date('Y-m-d')]);
    $flagged = [];
    foreach ($stmt->fetchAll() as $s) {
        $elig = provider_shift_eligibility($pdo, $providerId, $s['shift_date'], $s['state'] ?: 'FL');
        if ($elig['eligible'] || (int)$s['needs_review'] === 1) continue;
        $reason = 'Provider no longer eligible: ' . implode('; ', $elig['reasons']);
        $pdo->prepare('UPDATE provider_shifts SET needs_review = 1, review_reason = ?, flagged_at = ? WHERE id = ?')
            ->execute([mb_substr($reason, 0, 255), date('Y-m-d H:i:s'), $s['id']]);
        $s['review_reason'] = $reason;
        $flagged[] = $s;
    }
    if ($flagged && $notifyAdmin) {
        $u = $pdo->prepare('SELECT name, email FROM users WHERE id = ?');
        $u->execute([$providerId]);
        $who = $u->fetch() ?: ['name' => "Provider #{$providerId}", 'email' => ''];
        $body = email_p(em($who['name']) . ' (' . em($who['email']) . ') is assigned to ' . count($flagged) . ' upcoming shift' . (count($flagged) === 1 ? '' : 's')
            . ' they are no longer eligible to work. They have <strong>not</strong> been removed automatically — review each one in Providers → Shifts and reassign or confirm once credentials are renewed.');
        foreach ($flagged as $s) {
            $body .= email_facts(['Shift' => $s['id'], 'Date' => date('l, F j, Y', strtotime($s['shift_date'])), 'Clinic' => $s['clinic_name'], 'Why' => $s['review_reason']]);
        }
        send_admin_email('Shift assignments need review — ' . html_entity_decode($who['name'], ENT_QUOTES, 'UTF-8'), 'Assignments need review', $body, ['kicker' => 'Credential alert']);
    }
    return $flagged;
}

// ---------- geography ----------

const FL_METRO_BY_ZIP3 = [
    '320' => 'Jacksonville', '322' => 'Jacksonville', '321' => 'Daytona Beach / Space Coast', '323' => 'Tallahassee',
    '324' => 'Panama City', '325' => 'Pensacola', '326' => 'Gainesville', '344' => 'Gainesville / Ocala',
    '327' => 'Orlando', '328' => 'Orlando', '329' => 'Melbourne / Space Coast', '347' => 'Orlando',
    '330' => 'Miami–Fort Lauderdale', '331' => 'Miami–Fort Lauderdale', '332' => 'Miami–Fort Lauderdale', '333' => 'Miami–Fort Lauderdale',
    '334' => 'West Palm Beach', '335' => 'Tampa–St. Petersburg', '336' => 'Tampa–St. Petersburg', '337' => 'Tampa–St. Petersburg',
    '338' => 'Lakeland', '339' => 'Fort Myers', '341' => 'Naples', '342' => 'Sarasota', '346' => 'Tampa–St. Petersburg (north)',
    '349' => 'Port St. Lucie / Treasure Coast',
];

// State from a ZIP code's first three digits (USPS prefix ranges), used when
// the geocoder can't be reached.
function zip_state_code(string $zip) {
    if (!preg_match('/^\d{5}$/', $zip)) return null;
    $p = (int)substr($zip, 0, 3);
    $ranges = [
        [5, 5, 'NY'], [6, 7, 'PR'], [9, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'],
        [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'],
        [202, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'],
        [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'],
        [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'],
        [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'],
        [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'],
        [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'],
        [995, 999, 'AK'],
    ];
    foreach ($ranges as [$lo, $hi, $st]) if ($p >= $lo && $p <= $hi) return $st;
    return null;
}

// Coordinates, city, county, state and (Florida) metro area for a ZIP code.
// Asks OpenStreetMap's Nominatim once per ZIP and caches the answer; falls
// back to the Florida ZIP3 centroids and prefix→state table when offline.
function zip_geo(PDO $pdo, string $zip) {
    $zip = substr(preg_replace('/\D/', '', $zip), 0, 5);
    $out = ['lat' => null, 'lng' => null, 'city' => null, 'county' => null, 'state' => zip_state_code($zip), 'metro' => FL_METRO_BY_ZIP3[substr($zip, 0, 3)] ?? null];
    if (strlen($zip) !== 5) return $out;

    $stmt = $pdo->prepare('SELECT * FROM zip_geo_cache WHERE zip = ?');
    $stmt->execute([$zip]);
    $row = $stmt->fetch();
    if (!$row && !defined('GEOCODE_DISABLED')) {
        $raw = geocode_http_get('https://nominatim.openstreetmap.org/search?' . http_build_query([
            'postalcode' => $zip, 'countrycodes' => 'us', 'format' => 'json', 'addressdetails' => 1, 'limit' => 1,
        ]));
        $res = $raw ? json_decode($raw, true) : null;
        if (!empty($res[0]['lat'])) {
            $a = $res[0]['address'] ?? [];
            $iso = $a['ISO3166-2-lvl4'] ?? '';
            $row = [
                'zip' => $zip, 'lat' => (float)$res[0]['lat'], 'lng' => (float)$res[0]['lon'],
                'city' => $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['hamlet'] ?? null,
                'county' => $a['county'] ?? null,
                'state' => strpos($iso, 'US-') === 0 ? substr($iso, 3, 2) : $out['state'],
            ];
            $pdo->prepare('INSERT INTO zip_geo_cache (zip, lat, lng, city, county, state, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE lat = VALUES(lat)')
                ->execute([$zip, $row['lat'], $row['lng'], $row['city'], $row['county'], $row['state'], date('Y-m-d H:i:s')]);
        }
    }
    if ($row) {
        return array_merge($out, [
            'lat' => $row['lat'] !== null ? (float)$row['lat'] : null, 'lng' => $row['lng'] !== null ? (float)$row['lng'] : null,
            'city' => $row['city'], 'county' => $row['county'], 'state' => $row['state'] ?: $out['state'],
        ]);
    }
    $z3 = ZIP3[substr($zip, 0, 3)] ?? null;
    if ($z3) { $out['lat'] = $z3[0]; $out['lng'] = $z3[1]; }
    return $out;
}

// Approximate driving miles (straight line × the same road factor pricing uses).
function provider_distance_miles($lat1, $lng1, $lat2, $lng2) {
    if ($lat1 === null || $lat2 === null || $lng1 === null || $lng2 === null) return null;
    return (int)round(haversine_miles((float)$lat1, (float)$lng1, (float)$lat2, (float)$lng2) * ROAD_FACTOR);
}

// ---------- messaging ----------

function provider_log_message(PDO $pdo, int $providerId, string $kind, string $subject, bool $ok) {
    $pdo->prepare('INSERT INTO provider_messages (provider_id, kind, subject, ok, sent_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$providerId, $kind, mb_substr($subject, 0, 255), $ok ? 1 : 0, date('Y-m-d H:i:s')]);
}

// $p needs user_id, email, name. Every provider email goes through here so
// it is branded for the network and logged on the provider's record.
function provider_send(PDO $pdo, array $p, string $kind, string $subject, string $content, array $opts = []) {
    $ok = send_branded_email($p['email'], $subject, $content, ['site' => 'coverage', 'network' => true] + $opts);
    provider_log_message($pdo, (int)$p['user_id'], $kind, $subject, (bool)$ok);
    return $ok;
}

function provider_unsubscribe_url(array $p) {
    return SITE_URL . '/api/provider.php?action=unsubscribe&token=' . urlencode($p['unsubscribe_token']);
}

require_once __DIR__ . '/provider_emails.php';
