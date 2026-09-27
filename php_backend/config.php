<?php
// Coverage Chiropractic - Configuration, DB connection, auth & pricing helpers
// Keep this file OUTSIDE public_html.

// ========== SECRETS / PER-ENVIRONMENT VALUES ==========
// DB credentials, Stripe keys, SendGrid key — the things that differ
// between environments and must never be overwritten by a code update.
// Lives in its own file (php_backend/secrets.php, .gitignore'd, never
// shipped in an update) so this file can always be replaced wholesale
// with a new version without you re-entering anything.
require_once __DIR__ . '/secrets.php';

// ========== ERROR HANDLING ==========
// Without this, a PHP warning/notice can silently corrupt a JSON response
// (the browser then sees a blank or malformed body with no clue why), and an
// uncaught exception produces a blank 500 with nothing in the browser and
// nothing in this app's own log. Converting both into a clean JSON error —
// logged here and, for now, echoed back so setup problems are visible — beats
// debugging blind. The echoed detail can be removed later once things are
// stable and you don't want file paths visible in an error response.
set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return false;
    throw new ErrorException($message, 0, $severity, $file, $line);
});
set_exception_handler(function ($e) {
    $detail = $e->getMessage() . ' at ' . basename($e->getFile()) . ':' . $e->getLine();
    log_error('Uncaught exception', ['detail' => $detail]);
    if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
    echo json_encode(['error' => 'Server error', 'debug' => $detail]);
    exit;
});

// ========== SENDGRID SENDER (not secret — just who mail appears from) ==========
// One shared config.php serves both sites' api/ folders, and each site now
// has its own verified Sender Identity in SendGrid (a Gmail address can
// never be used here — Gmail's own DMARC policy rejects mail claiming to be
// "From" gmail.com that wasn't actually sent through Google's servers,
// which is why nothing arrived even when SendGrid reported success).
// sendgrid_sender() picks the right one from the request's Host header, so
// a coveragechiropractor.com booking sends from that domain and a
// thefloridachiropractor.com one sends from its own.
define('SENDGRID_FROM_EMAIL', 'mail@coveragechiropractor.com');
define('SENDGRID_FROM_NAME', 'Michael L. McPherson, D.C.');
define('SENDGRID_FROM_EMAIL_FLORIDA', 'mail@thefloridachiropractor.com');
define('SENDGRID_FROM_NAME_FLORIDA', 'The Florida Chiropractor');
function sendgrid_sender() {
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (stripos($host, 'thefloridachiropractor.com') !== false) {
        return [SENDGRID_FROM_EMAIL_FLORIDA, SENDGRID_FROM_NAME_FLORIDA];
    }
    return [SENDGRID_FROM_EMAIL, SENDGRID_FROM_NAME];
}

// ========== SITE CONFIGURATION ==========
define('SITE_URL', 'https://coveragechiropractor.com');
define('ADMIN_EMAIL', 'drmichaelmcpherson@gmail.com');
define('PHONE_NUMBER', '(650) 713-4326');
define('TIMEZONE', 'America/New_York');
date_default_timezone_set(TIMEZONE);

// ========== PRICING (mirrors the client-side quote() logic — server is authoritative) ==========
define('ORIGIN_LAT', 28.5410);
define('ORIGIN_LNG', -81.3790);
define('ROAD_FACTOR', 1.22);
define('HOTEL_RATE', 110);
define('OVERTIME_RATE', 100);
define('LAST_MINUTE_RATE', 0.10);
define('FIRST_BOOKING_RATE', 0.10);
define('RECURRING_DISCOUNT_RATE', 0.05);
define('RECURRING_QUALIFY_DAYS', 3);
define('RECURRING_WINDOW_DAYS', 365);
define('DEPOSIT_RATE', 0.10);
define('CANCEL_FULL_REFUND_HOURS', 48);

// Late fee / interest — a flat fee once a balance is 24+ hours overdue, then
// interest re-applied every 7 days it stays unpaid, compounding on the
// balance (including any fees/interest already added). Confirm these numbers
// with an accountant/attorney before relying on them — allowed rates and
// required disclosures for late fees and interest can vary by state.
define('LATE_FEE_AMOUNT', 25.00);
define('LATE_FEE_GRACE_HOURS', 24);
define('INTEREST_RATE_PER_PERIOD', 0.015);
define('INTEREST_PERIOD_DAYS', 7);

const RATES = [
    'central' => ['half' => 325, 'full' => 575, 'label' => 'Central FL'],
    'north'   => ['half' => 375, 'full' => 625, 'label' => 'North FL'],
    'south'   => ['half' => 375, 'full' => 625, 'label' => 'South FL'],
];

const MILE_TIERS = [
    ['max' => 150, 'rate' => 0.20],
    ['max' => 300, 'rate' => 0.40],
    ['max' => PHP_INT_MAX, 'rate' => 0.60],
];

// TheFloridaChiropractor.com home visit / event coverage pricing (unrelated
// to the office-coverage day-rates/tiered mileage above) — kept here rather
// than in homevisit.php so booking.php's address-change handler can also
// reach HOMEVISIT_MILEAGE_RATE when recomputing a home visit's mileage.
define('HOMEVISIT_ADULT_RATE', 100.00);
define('HOMEVISIT_CHILD_RATE', 70.00);
define('EVENT_HOURLY_RATE', 100.00);
define('EVENT_MIN_HOURS', 2);
define('HOMEVISIT_MILEAGE_RATE', 0.20); // flat, one-way, once per visit — not the tiered office-coverage rate

// ZIP3 prefix -> [lat, lng, region]. Same demo dataset as the frontend.
const ZIP3 = [
    '320' => [30.33, -81.66, 'north'],   '321' => [29.21, -81.02, 'central'],
    '322' => [30.32, -81.70, 'north'],   '323' => [30.44, -84.28, 'north'],
    '324' => [30.16, -85.66, 'north'],   '325' => [30.42, -87.22, 'north'],
    '326' => [29.65, -82.32, 'north'],   '327' => [28.90, -81.26, 'central'],
    '328' => [28.54, -81.38, 'central'], '329' => [28.29, -81.41, 'central'],
    '330' => [26.12, -80.14, 'south'],   '331' => [25.77, -80.19, 'south'],
    '332' => [25.77, -80.19, 'south'],   '333' => [26.12, -80.14, 'south'],
    '334' => [26.71, -80.05, 'south'],   '335' => [27.95, -82.46, 'central'],
    '336' => [27.95, -82.46, 'central'], '337' => [27.77, -82.64, 'central'],
    '338' => [28.04, -81.95, 'central'], '339' => [26.64, -81.87, 'south'],
    '341' => [26.14, -81.79, 'south'],   '342' => [27.34, -82.53, 'central'],
    '344' => [29.65, -82.32, 'north'],   '346' => [28.55, -82.39, 'central'],
    '347' => [28.55, -81.77, 'central'], '349' => [27.64, -80.40, 'central'],
];

const KEYS_OVERRIDE = [
    33037 => 295, 33070 => 305, 33036 => 315, 33001 => 330,
    33050 => 345, 33051 => 345, 33052 => 345, 33042 => 365,
    33043 => 365, 33044 => 375, 33040 => 385, 33041 => 385, 33045 => 385,
];
const KEYS_BAND_MIN = 33001;
const KEYS_BAND_MAX = 33052;
const KEYS_FALLBACK_MILES = 365;

// ========== DATABASE CONNECTION ==========
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASSWORD,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (PDOException $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    log_error('Database connection failed', ['error' => $e->getMessage()]);
    die(json_encode(['error' => 'Database connection failed']));
}

// ========== SESSION ==========
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

// ========== HELPER FUNCTIONS ==========

function sanitize($input) {
    if (is_array($input)) {
        return array_map('sanitize', $input);
    }
    return htmlspecialchars(strip_tags((string)$input), ENT_QUOTES, 'UTF-8');
}

function generate_id($prefix) {
    return $prefix . '-' . strtoupper(bin2hex(random_bytes(3)));
}

function json_response($data, $status_code = 200) {
    http_response_code($status_code);
    header('Content-Type: application/json');
    // Every API response is dynamic (availability, balances, document
    // status, etc.) and must never be served stale by a browser or an
    // edge/reverse-proxy cache (this host runs LiteSpeed Cache) — a cached
    // "not available yet" or cached availability check would be a real bug,
    // not just a cosmetic one.
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    echo json_encode($data);
    exit;
}

function json_body() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function log_error($message, $context = []) {
    $log_dir = __DIR__ . '/logs';
    if (!is_dir($log_dir)) { @mkdir($log_dir, 0755, true); }
    $timestamp = date('Y-m-d H:i:s');
    $log_entry = "[$timestamp] $message " . json_encode($context) . "\n";
    error_log($log_entry, 3, $log_dir . '/error.log');
}

// Full-detail version of send_email() — used by send_email() itself and by
// the admin "Send test email" diagnostic. A plain true/false swallows *why*
// a send failed: the SendGrid SDK only throws for transport-level problems
// (DNS, connection refused, etc.); a rejected API key, an unverified sender
// identity, or bad content all come back as a normal HTTP response with a
// non-202 status and a body explaining why, which the old version of this
// function never even logged. That's the gap that made "emails just aren't
// arriving" impossible to diagnose from the logs alone.
function send_email_detailed($to, $subject, $body, $reply_to = null) {
    $autoload = __DIR__ . '/vendor/autoload.php';
    if (!file_exists($autoload)) {
        log_error('SendGrid vendor not installed, email not sent', ['to' => $to, 'subject' => $subject]);
        return ['ok' => false, 'reason' => 'SendGrid PHP library not installed — run `composer install` in php_backend/.'];
    }
    require_once $autoload;

    [$fromEmail, $fromName] = sendgrid_sender();
    $email = new \SendGrid\Mail\Mail();
    $email->setFrom($fromEmail, $fromName);
    $email->setSubject($subject);
    $email->addTo($to);
    $email->addContent('text/html', $body);
    if ($reply_to) { $email->setReplyTo($reply_to); }

    $sendgrid = new \SendGrid(SENDGRID_API_KEY);
    try {
        $response = $sendgrid->send($email);
        if ((int)$response->statusCode() === 202) {
            return ['ok' => true, 'status' => $response->statusCode()];
        }
        log_error('Email rejected by SendGrid', ['to' => $to, 'subject' => $subject, 'status' => $response->statusCode(), 'body' => $response->body()]);
        return ['ok' => false, 'status' => $response->statusCode(), 'body' => $response->body()];
    } catch (\Exception $e) {
        log_error('Email send failed', ['to' => $to, 'error' => $e->getMessage()]);
        return ['ok' => false, 'reason' => $e->getMessage()];
    }
}

function send_email($to, $subject, $body, $reply_to = null) {
    return send_email_detailed($to, $subject, $body, $reply_to)['ok'];
}

// A Google Maps "get directions" deep link — tapping it in the Gmail app on
// a phone opens turn-by-turn navigation straight away, no separate copy/paste
// of the address needed.
function maps_directions_link($address) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' . urlencode($address);
}

// One stop on the admin's route digest — used for both the on-demand
// per-booking "Send route" button and the 4:30am daily digest.
function route_stop_email_block($title, $address, $whenLabel, $note = null) {
    return "<div style=\"margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #ddd;\">" .
        "<strong>{$title}</strong><br>{$address}<br>{$whenLabel}" .
        ($note ? "<br>{$note}" : '') .
        "<br><a href=\"" . maps_directions_link($address) . "\">Get directions</a></div>";
}

// Every non-cancelled office/homevisit/event booking and standing-day
// occurrence scheduled for $dateStr (default today), across both sites —
// they share this same bookings/standing_agreements data. Used by the daily
// 4:30am route-digest cron and could be reused anywhere else that needs
// "what's on the calendar today."
function todays_appointments(PDO $pdo, ?string $dateStr = null) {
    $dateStr = $dateStr ?? date('Y-m-d');
    $stops = [];

    $stmt = $pdo->query("SELECT b.*, u.name AS client_name, u.clinic_name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.status != 'cancelled'");
    foreach ($stmt->fetchAll() as $b) {
        $dates = json_decode($b['dates'], true) ?: [];
        if (!in_array($dateStr, $dates, true)) continue;
        $dayTimes = json_decode($b['day_times'] ?? '[]', true) ?: [];
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $dateStr) { $timeEntry = $dt; break; } }
        $whenLabel = $timeEntry ? "{$timeEntry['startTime']}–{$timeEntry['endTime']}" : 'Time not specified';
        $stops[] = [
            'title' => $b['clinic_name'] ?: $b['client_name'],
            'address' => $b['address'] ?: "ZIP {$b['zip_code']}",
            'whenLabel' => $whenLabel,
            'note' => $b['title'],
            'sortTime' => $timeEntry['startTime'] ?? '99:99',
        ];
    }

    $stmt = $pdo->query("SELECT * FROM standing_agreements WHERE status != 'cancelled'");
    foreach ($stmt->fetchAll() as $a) {
        $scheduledDates = json_decode($a['scheduled_dates'], true) ?: [];
        foreach ($scheduledDates as $sd) {
            if ($sd['date'] !== $dateStr || ($sd['status'] ?? '') === 'cancelled') continue;
            $stops[] = [
                'title' => $a['clinic_name'],
                'address' => $a['address'] ?: "ZIP {$a['zip_code']}",
                'whenLabel' => $sd['type'] === 'half' ? 'Half day' : 'Full day',
                'note' => 'Standing day agreement',
                'sortTime' => '99:99',
            ];
        }
    }

    usort($stops, fn($a, $b) => $a['sortTime'] <=> $b['sortTime']);
    return $stops;
}

// Emails ADMIN_EMAIL every appointment scheduled for $dateStr (default
// today) in one digest, with a "get directions" link for each — sent every
// morning by cron_daily_routes.php regardless of whether there's anything on
// the calendar, so a quiet inbox never gets mistaken for a missed cron run.
function send_daily_route_digest(PDO $pdo, ?string $dateStr = null) {
    $dateStr = $dateStr ?? date('Y-m-d');
    $stops = todays_appointments($pdo, $dateStr);
    $dateLabel = date('l, F j, Y', strtotime($dateStr));

    if (!count($stops)) {
        send_email(ADMIN_EMAIL, "Today's route — {$dateLabel} — no appointments", "<p>No appointments or bookings scheduled for today ({$dateLabel}).</p>");
        return 0;
    }

    $body = "<p>" . count($stops) . " appointment" . (count($stops) === 1 ? '' : 's') . " scheduled for {$dateLabel}:</p>";
    foreach ($stops as $s) { $body .= route_stop_email_block($s['title'], $s['address'], $s['whenLabel'], $s['note']); }
    send_email(ADMIN_EMAIL, "Today's route — {$dateLabel} — " . count($stops) . " stop" . (count($stops) === 1 ? '' : 's'), $body);
    return count($stops);
}

function require_login() {
    if (empty($_SESSION['user_id'])) {
        json_response(['error' => 'Not signed in'], 401);
    }
    return [
        'id' => $_SESSION['user_id'],
        'email' => $_SESSION['email'],
        'is_admin' => !empty($_SESSION['is_admin']),
    ];
}

function require_admin() {
    $user = require_login();
    if (!$user['is_admin']) {
        json_response(['error' => 'Admin access required'], 403);
    }
    return $user;
}

function current_user_or_null() {
    if (empty($_SESSION['user_id'])) return null;
    return [
        'id' => $_SESSION['user_id'],
        'email' => $_SESSION['email'],
        'is_admin' => !empty($_SESSION['is_admin']),
    ];
}

// ---------- PRICING HELPERS (server-authoritative) ----------

function tiered_mileage_rate($miles) {
    foreach (MILE_TIERS as $tier) {
        if ($miles <= $tier['max']) return $tier['rate'];
    }
    return end(MILE_TIERS)['rate'];
}

function haversine_miles($lat1, $lng1, $lat2, $lng2) {
    $r = 3958.8;
    $toRad = fn($d) => $d * M_PI / 180;
    $dLat = $toRad($lat2 - $lat1);
    $dLng = $toRad($lng2 - $lng1);
    $h = sin($dLat / 2) ** 2 + cos($toRad($lat1)) * cos($toRad($lat2)) * sin($dLng / 2) ** 2;
    return 2 * $r * asin(sqrt($h));
}

function keys_mileage($zipNum) {
    if (isset(KEYS_OVERRIDE[$zipNum])) return KEYS_OVERRIDE[$zipNum];
    if ($zipNum >= KEYS_BAND_MIN && $zipNum <= KEYS_BAND_MAX) return KEYS_FALLBACK_MILES;
    return null;
}

// Returns ['miles' => int, 'region' => string] or null if the ZIP isn't recognized.
function lookup_zip($zip) {
    $z = trim((string)$zip);
    if (!preg_match('/^\d{5}$/', $z)) return null;
    $zipNum = (int)$z;
    $km = keys_mileage($zipNum);
    if ($km !== null) return ['miles' => $km, 'region' => 'south'];
    $prefix = substr($z, 0, 3);
    if (!isset(ZIP3[$prefix])) return null;
    [$lat, $lng, $region] = ZIP3[$prefix];
    $miles = (int)round(haversine_miles(ORIGIN_LAT, ORIGIN_LNG, $lat, $lng) * ROAD_FACTOR);
    return ['miles' => $miles, 'region' => $region];
}

define('GEOCODE_USER_AGENT', 'CoverageChiropractor.com booking system (contact: drmichaelmcpherson@gmail.com)');
define('GEOCODE_TIMEOUT_SECONDS', 6);

// Fetches a URL with a custom User-Agent, preferring cURL (nearly always
// enabled, even on locked-down shared hosting) over file_get_contents()
// (silently returns false when the host has allow_url_fopen disabled for
// outbound requests — common on shared cPanel hosting — which would
// otherwise make every geocode attempt fail with no clear signal why).
// Logs the specific failure reason so it's diagnosable from logs/error.log
// rather than just "the map never shows up."
function geocode_http_get(string $url) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['User-Agent: ' . GEOCODE_USER_AGENT],
            CURLOPT_TIMEOUT => GEOCODE_TIMEOUT_SECONDS,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $raw = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        if ($raw !== false && $httpCode >= 200 && $httpCode < 300) return $raw;
        log_error('Geocoding request failed (curl)', ['url' => $url, 'http_code' => $httpCode, 'curl_error' => $curlError]);
        return null;
    }

    if (!ini_get('allow_url_fopen')) {
        log_error('Geocoding unavailable: neither curl nor allow_url_fopen is enabled on this server', ['url' => $url]);
        return null;
    }
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "User-Agent: " . GEOCODE_USER_AGENT . "\r\n",
            'timeout' => GEOCODE_TIMEOUT_SECONDS,
        ],
    ]);
    $raw = @file_get_contents($url, false, $context);
    if ($raw === false) {
        log_error('Geocoding request failed (file_get_contents)', ['url' => $url]);
        return null;
    }
    return $raw;
}

// Looks up a full street address via OpenStreetMap's free Nominatim
// geocoder, caching the result in geocode_cache (Nominatim's usage policy
// requires caching rather than re-querying the same address repeatedly, and
// it makes repeat bookings at the same clinic/home address instant). Returns
// ['lat'=>float, 'lng'=>float, 'postcode'=>?string] or null if the address
// can't be resolved or the geocoder is unreachable.
function geocode_address(PDO $pdo, string $address) {
    $address = trim($address);
    if ($address === '') return null;
    $hash = md5(strtolower(preg_replace('/\s+/', ' ', $address)));

    $stmt = $pdo->prepare('SELECT lat, lng, postcode FROM geocode_cache WHERE address_hash = ?');
    $stmt->execute([$hash]);
    $cached = $stmt->fetch();
    if ($cached) return ['lat' => (float)$cached['lat'], 'lng' => (float)$cached['lng'], 'postcode' => $cached['postcode']];

    $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
        'q' => $address,
        'format' => 'json',
        'addressdetails' => 1,
        'limit' => 1,
        'countrycodes' => 'us',
    ]);

    $raw = geocode_http_get($url);
    if ($raw === null) return null;
    $results = json_decode($raw, true);
    if (empty($results[0]['lat']) || empty($results[0]['lon'])) return null;

    $lat = (float)$results[0]['lat'];
    $lng = (float)$results[0]['lon'];
    $postcode = $results[0]['address']['postcode'] ?? null;
    $postcode = $postcode ? substr(preg_replace('/[^0-9]/', '', $postcode), 0, 5) : null;

    $stmt = $pdo->prepare('INSERT INTO geocode_cache (address_hash, address, lat, lng, postcode) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE lat = VALUES(lat), lng = VALUES(lng), postcode = VALUES(postcode)');
    $stmt->execute([$hash, $address, $lat, $lng, $postcode]);

    return ['lat' => $lat, 'lng' => $lng, 'postcode' => $postcode];
}

// Pulls a trailing 5-digit ZIP out of a free-typed address ("123 Main St,
// Orlando, FL 32801") so the ZIP3 region/mileage fallback still works when
// geocoding is unavailable.
function extract_zip_from_address(string $address) {
    if (preg_match('/\b(\d{5})(-\d{4})?\b/', $address, $m)) return $m[1];
    return '';
}

// Resolves a booking location for pricing: prefers the real geocoded address
// (accurate straight-line distance to the actual door, not just a ZIP3
// centroid) and falls back to the existing ZIP-based estimate whenever
// geocoding is unavailable — Nominatim down, rate-limited, or an address it
// can't parse — so a network hiccup never blocks a booking, it just falls
// back to a less precise estimate instead of failing outright.
function resolve_location(PDO $pdo, string $address) {
    $geo = geocode_address($pdo, $address);
    if ($geo) {
        $miles = (int)round(haversine_miles(ORIGIN_LAT, ORIGIN_LNG, $geo['lat'], $geo['lng']) * ROAD_FACTOR);
        $zipLookup = lookup_zip($geo['postcode'] ?: extract_zip_from_address($address));
        return [
            'miles' => $miles,
            'region' => $zipLookup['region'] ?? null,
            'lat' => $geo['lat'],
            'lng' => $geo['lng'],
        ];
    }
    $zipLookup = lookup_zip(extract_zip_from_address($address));
    return [
        'miles' => $zipLookup['miles'] ?? 0,
        'region' => $zipLookup['region'] ?? null,
        'lat' => null,
        'lng' => null,
    ];
}

function is_last_minute($dateStr) {
    $today = new DateTime('today');
    $target = new DateTime($dateStr);
    $diffDays = (int)$today->diff($target)->format('%r%a');
    return $diffDays >= 0 && $diffDays <= 1;
}

function group_consecutive_dates(array $sortedDates) {
    $groups = [];
    $current = [];
    foreach ($sortedDates as $d) {
        if (!$current) { $current[] = $d; continue; }
        $prev = new DateTime(end($current));
        $cur = new DateTime($d);
        $diffDays = (int)$prev->diff($cur)->format('%a');
        if ($diffDays === 1) { $current[] = $d; }
        else { $groups[] = $current; $current = [$d]; }
    }
    if ($current) $groups[] = $current;
    return $groups;
}

function overtime_for_entry($type, $startTime, $endTime) {
    if (!$startTime || !$endTime) return ['hours' => 0, 'cost' => 0];
    [$sh, $sm] = array_map('intval', explode(':', $startTime));
    [$eh, $em] = array_map('intval', explode(':', $endTime));
    $elapsed = ($eh + $em / 60) - ($sh + $sm / 60);
    if ($elapsed <= 0) return ['hours' => 0, 'cost' => 0];
    $capHours = $type === 'full' ? 8 : 4;
    $lunchDeduction = $type === 'full' ? 1 : 0;
    $billableHours = max(0, $elapsed - $lunchDeduction);
    $overtimeHours = max(0, $billableHours - $capHours);
    return ['hours' => $overtimeHours, 'cost' => round($overtimeHours * OVERTIME_RATE, 2)];
}

// Sums full-day-equivalents across a clinic's own prior, non-cancelled office bookings.
function cumulative_day_equivalents(PDO $pdo, $userId) {
    $stmt = $pdo->prepare("SELECT day_types FROM bookings WHERE user_id = ? AND status != 'cancelled' AND coverage_type = 'office'");
    $stmt->execute([$userId]);
    $sum = 0.0;
    foreach ($stmt->fetchAll() as $row) {
        $types = json_decode($row['day_types'], true) ?: [];
        foreach ($types as $t) { $sum += $t === 'full' ? 1 : 0.5; }
    }
    return $sum;
}

function most_recent_booking_date(PDO $pdo, $userId) {
    $stmt = $pdo->prepare("SELECT MAX(start_date) AS last FROM bookings WHERE user_id = ? AND status != 'cancelled' AND coverage_type = 'office'");
    $stmt->execute([$userId]);
    return $stmt->fetch()['last'] ?? null;
}

function recurring_status(PDO $pdo, $userId) {
    $cumDays = cumulative_day_equivalents($pdo, $userId);
    $lastDate = most_recent_booking_date($pdo, $userId);
    $qualified = $cumDays >= RECURRING_QUALIFY_DAYS;
    $active = false;
    if ($qualified && $lastDate) {
        $daysSince = (int)(new DateTime('today'))->diff(new DateTime($lastDate))->format('%a');
        $active = $daysSince <= RECURRING_WINDOW_DAYS;
    }
    return ['cumDays' => $cumDays, 'qualified' => $qualified, 'active' => $active];
}

function has_any_bookings(PDO $pdo, $userId) {
    $stmt = $pdo->prepare('SELECT COUNT(*) AS c FROM bookings WHERE user_id = ?');
    $stmt->execute([$userId]);
    return (int)$stmt->fetch()['c'] > 0;
}

function last_minute_enabled(PDO $pdo) {
    $stmt = $pdo->query('SELECT value_json FROM app_settings WHERE name = "last_minute_discount"');
    $row = $stmt->fetch();
    if (!$row) return true; // default on, matching the site's advertised behavior
    $val = json_decode($row['value_json'], true);
    return $val['enabled'] ?? true;
}

// ---------- STANDING DAY (recurring coverage) ----------
const STANDING_TIER_1 = ['min' => 12, 'rate' => 0.10];
const STANDING_TIER_2 = ['min' => 24, 'rate' => 0.15];
const STANDING_TIER_3 = ['min' => 52, 'rate' => 0.20];
const STANDING_PREPAY_BONUS = 0.02;

function pattern_day_equivalents(array $patterns) {
    $sum = 0.0;
    foreach ($patterns as $p) { $sum += (float)$p['count'] * ($p['type'] === 'full' ? 1 : 0.5); }
    return $sum;
}

function standing_tier_for(float $count) {
    if ($count >= STANDING_TIER_3['min']) return STANDING_TIER_3;
    if ($count >= STANDING_TIER_2['min']) return STANDING_TIER_2;
    if ($count >= STANDING_TIER_1['min']) return STANDING_TIER_1;
    return null;
}

function effective_standing_rate(?array $tier, ?string $paymentPlan, $customRate) {
    if ($customRate !== null) return (float)$customRate;
    if (!$tier) return 0;
    return $tier['rate'] + ($paymentPlan === 'prepay' ? STANDING_PREPAY_BONUS : 0);
}

// Rolls a start date forward to the next occurrence of the requested weekday.
function next_weekday_on_or_after(string $dateStr, int $targetDow) {
    $d = new DateTime($dateStr);
    while ((int)$d->format('w') !== $targetDow) { $d->modify('+1 day'); }
    return $d->format('Y-m-d');
}

function generate_standing_dates(string $startDateStr, string $frequency, int $count) {
    $intervalDays = $frequency === 'weekly' ? 7 : ($frequency === 'biweekly' ? 14 : 28);
    $dates = [];
    $d = new DateTime($startDateStr);
    for ($i = 0; $i < $count; $i++) {
        $dates[] = $d->format('Y-m-d');
        $d->modify("+{$intervalDays} days");
    }
    return $dates;
}

// An agreement's lat/lng is geocoded once, at request/approval time, and
// stored on the row — recurring billing (this function, called for every
// scheduled date) never needs to re-geocode or even touch $pdo, it just
// measures from the coordinates already on hand. Falls back to the
// ZIP3-centroid estimate for agreements created before geocoding existed
// (no lat/lng stored) or whose address never resolved.
function standing_agreement_miles(array $agreement) {
    if (!empty($agreement['lat']) && !empty($agreement['lng'])) {
        return (int)round(haversine_miles(ORIGIN_LAT, ORIGIN_LNG, (float)$agreement['lat'], (float)$agreement['lng']) * ROAD_FACTOR);
    }
    $zipLookup = lookup_zip($agreement['zip_code']);
    return $zipLookup['miles'] ?? 0;
}

// Mirrors the frontend's standingDateRate(): the discounted day rate plus
// mileage for one specific scheduled date on an agreement.
function standing_date_rate(array $agreement, string $dateType) {
    $rate = RATES[$agreement['region']] ?? RATES['central'];
    $base = $dateType === 'full' ? $rate['full'] : $rate['half'];
    $discounted = $base * (1 - (float)$agreement['effective_rate']);
    $miles = standing_agreement_miles($agreement);
    $mileage = $miles * tiered_mileage_rate($miles);
    return ['discounted' => $discounted, 'mileage' => $mileage, 'total' => round($discounted + $mileage, 2), 'miles' => $miles];
}

// Estimates the signup-deposit amount for a standing-day REQUEST (before an
// agreement row exists), mirroring the frontend's updateStandingQuote(): the
// first pattern's day rate, discounted at the tier/plan the combined
// pattern count qualifies for, plus mileage from the clinic's geocoded
// address (falling back to the ZIP3-centroid estimate if geocoding is
// unavailable). Used to verify the client's deposit PaymentIntent wasn't for
// less than expected.
function estimate_standing_deposit(PDO $pdo, string $region, string $address, array $patterns, ?string $paymentPlan) {
    if (!count($patterns)) return 0;
    $rate = RATES[$region] ?? RATES['central'];
    $combined = pattern_day_equivalents($patterns);
    $tier = standing_tier_for($combined);
    $effectiveRate = effective_standing_rate($tier, $paymentPlan, null);
    $first = $patterns[0];
    $base = ($first['type'] ?? 'full') === 'full' ? $rate['full'] : $rate['half'];
    $location = resolve_location($pdo, $address);
    $miles = $location['miles'] ?? 0;
    $mileage = $miles * tiered_mileage_rate($miles);
    return round(($base * (1 - $effectiveRate)) + $mileage, 2);
}

// Like apply_successful_standing_payment(), but for a single Stripe charge
// that covers several scheduled dates at once (a prepay lump sum, or one
// installment slice) rather than exactly one date. Marks the earliest
// unpaid scheduled dates paid, in date order, until the charged amount is
// used up, and records one payments row for the whole charge — standing_date
// stays null since no single date applies to a bulk charge.
function apply_successful_standing_bulk_payment(PDO $pdo, string $agreementId, string $intentId, float $amount, ?string $chargeId, string $purpose) {
    $exists = $pdo->prepare('SELECT id FROM payments WHERE stripe_payment_intent = ? AND status = "succeeded"');
    $exists->execute([$intentId]);
    if ($exists->fetch()) return false;

    $stmt = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
    $stmt->execute([$agreementId]);
    $a = $stmt->fetch();
    if (!$a) return false;

    $dates = json_decode($a['scheduled_dates'], true) ?: [];
    usort($dates, fn($x, $y) => strcmp($x['date'], $y['date']));
    $remaining = $amount;
    foreach ($dates as &$d) {
        if ($remaining <= 0.005) break;
        if ($d['status'] !== 'scheduled' || !empty($d['paidAt'])) continue;
        $price = standing_date_rate($a, $d['type'])['total'];
        if ($price <= $remaining + 0.01) {
            $d['status'] = 'paid';
            $d['paidAt'] = date('c');
            $remaining -= $price;
        }
    }
    unset($d);

    $pdo->prepare('UPDATE standing_agreements SET scheduled_dates = ? WHERE id = ?')->execute([json_encode($dates), $agreementId]);
    $stmt = $pdo->prepare('INSERT INTO payments (standing_agreement_id, user_id, amount, purpose, stripe_payment_intent, stripe_charge_id, status) VALUES (?, ?, ?, ?, ?, ?, "succeeded")');
    $stmt->execute([$agreementId, $a['user_id'], $amount, $purpose, $intentId, $chargeId]);

    $label = $purpose === 'prepay' ? 'your full prepay commitment' : 'this installment';
    send_email($a['contact_email'], 'Payment received — standing day agreement',
        "<p>Thank you — your payment of $" . number_format($amount, 2) . " for {$label} has been received.</p>");
    send_email(ADMIN_EMAIL, "Standing day {$purpose} payment received — {$a['clinic_name']}",
        "<p>{$a['clinic_name']} paid $" . number_format($amount, 2) . " ({$purpose}).</p>");
    return true;
}

// ---------- AVAILABILITY ----------

// $entries: [['date' => 'YYYY-MM-DD', 'half' => bool, 'time' => 'HH:MM'|null], ...]
// Returns a conflict description array or null if clear.
// Every date already spoken for: ad-hoc bookings plus every non-cancelled
// date on an active/cancelling standing-day agreement.
function all_committed_dates(PDO $pdo, ?string $excludeBookingId = null) {
    $dates = [];
    $bookedStmt = $pdo->query("SELECT id, dates FROM bookings WHERE status != 'cancelled'");
    foreach ($bookedStmt->fetchAll() as $r) {
        if ($excludeBookingId !== null && $r['id'] === $excludeBookingId) continue;
        foreach (json_decode($r['dates'], true) ?: [] as $d) { $dates[] = $d; }
    }
    $agreementStmt = $pdo->query("SELECT scheduled_dates FROM standing_agreements WHERE status != 'cancelled'");
    foreach ($agreementStmt->fetchAll() as $r) {
        foreach (json_decode($r['scheduled_dates'], true) ?: [] as $sd) {
            if (($sd['status'] ?? '') !== 'cancelled') { $dates[] = $sd['date']; }
        }
    }
    return $dates;
}

function check_availability(PDO $pdo, array $entries, ?string $excludeBookingId = null) {
    $blackoutStmt = $pdo->query('SELECT * FROM blackout_dates');
    $blackouts = $blackoutStmt->fetchAll();
    $committedDates = all_committed_dates($pdo, $excludeBookingId);

    foreach ($entries as $entry) {
        $day = $entry['date'];
        foreach ($blackouts as $b) {
            if ($day < $b['date_start'] || $day > $b['date_end']) continue;
            if ($b['scope'] === 'all') return ['day' => $day, 'why' => 'blocked off'];
            if (empty($entry['half'])) {
                return ['day' => $day, 'why' => ($b['scope'] === 'am' ? 'mornings' : 'afternoons') . ' blocked off'];
            }
            if (!empty($entry['time'])) {
                $hour = (int)explode(':', $entry['time'])[0];
                if ($b['scope'] === 'am' && $hour < 12) return ['day' => $day, 'why' => 'mornings blocked off'];
                if ($b['scope'] === 'pm' && $hour >= 13) return ['day' => $day, 'why' => 'afternoons blocked off'];
            }
        }
        if (in_array($day, $committedDates, true)) return ['day' => $day, 'why' => 'already booked'];
    }
    return null;
}

// Validates a promo code the same way the original client-side
// findValidPromo() did. Returns ['promo' => row] or ['error' => message].
function validate_promo_code(PDO $pdo, string $codeStr) {
    $today = date('Y-m-d');
    $stmt = $pdo->prepare('SELECT * FROM promo_codes WHERE code = ?');
    $stmt->execute([strtoupper(trim($codeStr))]);
    $promo = $stmt->fetch();
    if (!$promo) return ['error' => "That code isn't valid."];
    if (!$promo['active']) return ['error' => 'That code is no longer active.'];
    if ($promo['expires_at'] && $promo['expires_at'] < $today) return ['error' => 'That code has expired.'];
    if ($promo['max_uses'] !== null && (int)$promo['used_count'] >= (int)$promo['max_uses']) return ['error' => 'That code has reached its usage limit.'];
    return ['promo' => $promo];
}

function promo_discount_amount(array $promo, float $subtotal) {
    if ($subtotal <= 0) return 0;
    $raw = $promo['type'] === 'percent' ? $subtotal * ((float)$promo['value'] / 100) : (float)$promo['value'];
    return min($raw, $subtotal);
}

// Applies a succeeded Stripe payment to a booking exactly once, whichever
// caller notices it first (the browser's confirm call or the Stripe
// webhook) — both funnel through here so the effect never double-applies.
function apply_successful_payment(PDO $pdo, string $bookingId, string $intentId, string $purpose, float $amount, ?string $chargeId) {
    $exists = $pdo->prepare('SELECT id FROM payments WHERE stripe_payment_intent = ? AND status = "succeeded"');
    $exists->execute([$intentId]);
    if ($exists->fetch()) return false;

    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$bookingId]);
    $b = $stmt->fetch();
    if (!$b) return false;

    $newPaid = round((float)$b['paid'] + $amount, 2);
    if ($purpose === 'balance') {
        $stmt = $pdo->prepare("UPDATE bookings SET paid = ?, balance_status = 'paid' WHERE id = ?");
        $stmt->execute([$newPaid, $bookingId]);
    } elseif ($purpose === 'deposit' && $b['status'] === 'pending') {
        // An admin-created phone booking sits in "pending" (signed but
        // unpaid, or not yet even signed) until the client pays their own
        // deposit — this is the moment it becomes a real, confirmed booking,
        // same as a self-service booking is "upcoming" from the instant it's
        // created.
        $stmt = $pdo->prepare("UPDATE bookings SET paid = ?, status = 'upcoming' WHERE id = ?");
        $stmt->execute([$newPaid, $bookingId]);
    } else {
        $stmt = $pdo->prepare('UPDATE bookings SET paid = ? WHERE id = ?');
        $stmt->execute([$newPaid, $bookingId]);
    }

    $stmt = $pdo->prepare('INSERT INTO payments (booking_id, user_id, amount, purpose, stripe_payment_intent, stripe_charge_id, status) VALUES (?, ?, ?, ?, ?, ?, "succeeded")');
    $stmt->execute([$bookingId, $b['user_id'], $amount, $purpose, $intentId, $chargeId]);

    if ($purpose === 'deposit') {
        send_email($b['user_email'], "Booking confirmed — {$b['id']}",
            "<p>Your booking is confirmed.</p><p><strong>{$b['title']}</strong><br>{$b['meta']}</p>" .
            '<p>Deposit charged: $' . number_format($amount, 2) . '<br>Total: $' . number_format($b['total'], 2) . '</p>' .
            "<p>Reference: {$b['id']}</p>");
        send_email(ADMIN_EMAIL, "New booking — {$b['id']}",
            "<p>{$b['user_name']} ({$b['user_email']}) booked {$b['title']}.</p><p>{$b['meta']}</p><p>Deposit paid: $" . number_format($amount, 2) . '</p>');
    } else {
        send_email($b['user_email'], "Balance paid — {$b['id']}",
            '<p>Thank you — the remaining balance of $' . number_format($amount, 2) . " on booking {$b['id']} has been received. You're paid in full.</p>");
        send_email(ADMIN_EMAIL, "Balance paid — {$b['id']}",
            "<p>{$b['user_name']} paid the remaining balance of $" . number_format($amount, 2) . " on {$b['id']}.</p>");
    }
    return true;
}

function apply_successful_invoice_payment(PDO $pdo, string $invoiceId, string $intentId, float $amount, ?string $chargeId) {
    $exists = $pdo->prepare('SELECT id FROM payments WHERE stripe_payment_intent = ? AND status = "succeeded"');
    $exists->execute([$intentId]);
    if ($exists->fetch()) return false;

    $stmt = $pdo->prepare('SELECT i.*, u.email AS user_email, u.name AS user_name FROM invoices i JOIN users u ON u.id = i.user_id WHERE i.id = ?');
    $stmt->execute([$invoiceId]);
    $inv = $stmt->fetch();
    if (!$inv) return false;

    $newPaid = round((float)$inv['paid'] + $amount, 2);
    $remaining = invoice_balance_due($pdo, array_merge($inv, ['paid' => $newPaid]));
    $stmt = $pdo->prepare('UPDATE invoices SET paid = ?' . ($remaining <= 0 ? ", status = 'paid'" : '') . ' WHERE id = ?');
    $stmt->execute([$newPaid, $invoiceId]);

    $stmt = $pdo->prepare('INSERT INTO payments (invoice_id, user_id, amount, purpose, stripe_payment_intent, stripe_charge_id, status) VALUES (?, ?, ?, "invoice", ?, ?, "succeeded")');
    $stmt->execute([$invoiceId, $inv['user_id'], $amount, $intentId, $chargeId]);

    send_email($inv['user_email'], "Payment received — {$inv['description']}",
        '<p>Thank you — your payment of $' . number_format($amount, 2) . " for \"{$inv['description']}\" has been received.</p>");
    send_email(ADMIN_EMAIL, "Invoice paid — {$invoiceId}",
        "<p>{$inv['user_name']} paid $" . number_format($amount, 2) . " on invoice {$invoiceId} ({$inv['description']}).</p>");
    return true;
}

// MySQL DATETIME/TIMESTAMP strings ("2025-01-15 10:23:45") aren't reliably
// parsed by `new Date(...)` in every browser — convert to ISO 8601 so the
// frontend's date math always works.
function to_iso($mysqlDatetime) {
    return $mysqlDatetime ? date('c', strtotime($mysqlDatetime)) : null;
}

// Same idempotent-apply pattern as apply_successful_payment(), for a single
// paid date on a standing-day agreement.
function apply_successful_standing_payment(PDO $pdo, string $agreementId, string $date, string $intentId, float $amount, ?string $chargeId) {
    $exists = $pdo->prepare('SELECT id FROM payments WHERE stripe_payment_intent = ? AND status = "succeeded"');
    $exists->execute([$intentId]);
    if ($exists->fetch()) return false;

    $stmt = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
    $stmt->execute([$agreementId]);
    $a = $stmt->fetch();
    if (!$a) return false;

    $dates = json_decode($a['scheduled_dates'], true) ?: [];
    $changed = false;
    foreach ($dates as &$d) {
        if ($d['date'] === $date && $d['status'] !== 'paid') {
            $d['status'] = 'paid';
            $d['paidAt'] = date('c');
            $changed = true;
        }
    }
    unset($d);
    if (!$changed) return false;

    $pdo->prepare('UPDATE standing_agreements SET scheduled_dates = ? WHERE id = ?')->execute([json_encode($dates), $agreementId]);
    $stmt = $pdo->prepare('INSERT INTO payments (standing_agreement_id, standing_date, user_id, amount, purpose, stripe_payment_intent, stripe_charge_id, status) VALUES (?, ?, ?, ?, "standing_date", ?, ?, "succeeded")');
    $stmt->execute([$agreementId, $date, $a['user_id'], $amount, $intentId, $chargeId]);

    send_email($a['contact_email'], "Payment received — {$date}",
        "<p>Thank you — your payment of $" . number_format($amount, 2) . " for the standing day coverage on {$date} has been received.</p>");
    send_email(ADMIN_EMAIL, "Standing day payment received — {$a['clinic_name']}",
        "<p>{$a['clinic_name']} paid $" . number_format($amount, 2) . " for {$date}.</p>");
    return true;
}

// Sum of all admin-applied adjustments (positive = charge, negative =
// discount) on a booking — see booking_adjustments in database_setup.sql.
function booking_adjustments_total(PDO $pdo, string $bookingId) {
    $stmt = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM booking_adjustments WHERE booking_id = ?');
    $stmt->execute([$bookingId]);
    return (float)$stmt->fetchColumn();
}

// The authoritative amount owed on a booking: the original signed total,
// plus any admin adjustments layered on since, minus what's been paid.
// Can be negative (a credit owed to the client).
function booking_balance_due(PDO $pdo, array $booking) {
    return round((float)$booking['total'] + booking_adjustments_total($pdo, $booking['id']) - (float)$booking['paid'], 2);
}

// ---------- STANDALONE INVOICES ----------
// A provider-created charge not tied to any booking (a broken piece of
// equipment, a no-show fee, anything ad hoc) — mirrors the booking
// adjustments ledger pattern above.

function invoice_adjustments_total(PDO $pdo, string $invoiceId) {
    $stmt = $pdo->prepare('SELECT COALESCE(SUM(amount), 0) FROM invoice_adjustments WHERE invoice_id = ?');
    $stmt->execute([$invoiceId]);
    return (float)$stmt->fetchColumn();
}

function invoice_balance_due(PDO $pdo, array $invoice) {
    return round((float)$invoice['amount'] + invoice_adjustments_total($pdo, $invoice['id']) - (float)$invoice['paid'], 2);
}

function invoice_to_json(PDO $pdo, array $r) {
    $stmt = $pdo->prepare('SELECT amount, reason, created_by, created_at FROM invoice_adjustments WHERE invoice_id = ? ORDER BY created_at');
    $stmt->execute([$r['id']]);
    $adjustmentRows = $stmt->fetchAll();
    $adjustmentsTotal = round(array_sum(array_column($adjustmentRows, 'amount')), 2);
    return [
        'id' => $r['id'],
        'description' => $r['description'],
        'amount' => (float)$r['amount'],
        'paid' => (float)$r['paid'],
        'status' => $r['status'],
        'adjustments' => array_map(fn($a) => [
            'amount' => (float)$a['amount'], 'reason' => $a['reason'], 'createdBy' => $a['created_by'], 'createdAt' => to_iso($a['created_at']),
        ], $adjustmentRows),
        'adjustmentsTotal' => $adjustmentsTotal,
        'balanceDue' => invoice_balance_due($pdo, $r),
        'createdAt' => to_iso($r['created_at']),
    ];
}

// Applies the standard automatic late fee (once, 24h after due) and
// compounding weekly interest to any due booking/invoice — shared by
// cron_billing.php for both bookings and standalone invoices, since the
// logic is identical apart from which ledger table and email copy is used.
// $dueAt: DateTime the balance became due. $currentBalance: callable that
// returns the fresh current balance (re-read after each insert, since
// interest compounds on top of previously-added fees/interest).
function apply_late_billing(PDO $pdo, string $ledgerTable, string $foreignKeyCol, string $id, DateTime $dueAt, callable $currentBalance, callable $insertAdjustment, callable $notify) {
    $now = new DateTime();
    $hoursLate = ($now->getTimestamp() - $dueAt->getTimestamp()) / 3600;
    if ($hoursLate < LATE_FEE_GRACE_HOURS) return;

    $lateFeeReason = 'Late fee (24+ hours overdue)';
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM {$ledgerTable} WHERE {$foreignKeyCol} = ? AND reason = ?");
    $stmt->execute([$id, $lateFeeReason]);
    if ((int)$stmt->fetchColumn() === 0 && $currentBalance() > 0) {
        $insertAdjustment(LATE_FEE_AMOUNT, $lateFeeReason);
        $notify('late_fee', LATE_FEE_AMOUNT, $lateFeeReason);
    }

    $weeksLate = (int)floor($hoursLate / (INTEREST_PERIOD_DAYS * 24));
    for ($week = 1; $week <= $weeksLate; $week++) {
        $reason = "Interest — week {$week} overdue";
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM {$ledgerTable} WHERE {$foreignKeyCol} = ? AND reason = ?");
        $stmt->execute([$id, $reason]);
        if ((int)$stmt->fetchColumn() > 0) continue;
        $balance = $currentBalance();
        if ($balance <= 0) break;
        $interest = round($balance * INTEREST_RATE_PER_PERIOD, 2);
        if ($interest <= 0) continue;
        $insertAdjustment($interest, $reason);
        $notify('interest', $interest, $reason);
    }
}

function booking_to_json(PDO $pdo, array $r) {
    $stmt = $pdo->prepare('SELECT amount, reason, created_by, created_at FROM booking_adjustments WHERE booking_id = ? ORDER BY created_at');
    $stmt->execute([$r['id']]);
    $adjustmentRows = $stmt->fetchAll();
    $adjustmentsTotal = round(array_sum(array_column($adjustmentRows, 'amount')), 2);

    $stmt = $pdo->prepare("SELECT amount, purpose, payment_method, reference, note, created_at FROM payments WHERE booking_id = ? AND status IN ('succeeded', 'refunded') ORDER BY created_at");
    $stmt->execute([$r['id']]);
    $paymentRows = $stmt->fetchAll();

    return [
        'id' => $r['id'],
        'service' => $r['coverage_type'],
        'title' => $r['title'],
        'meta' => $r['meta'],
        'usvi' => (bool)$r['usvi'],
        'total' => (float)$r['total'],
        'paid' => (float)$r['paid'],
        'payType' => $r['pay_type'],
        'start' => $r['start_date'],
        'dates' => json_decode($r['dates'], true) ?: [],
        'dayTypes' => json_decode($r['day_types'], true) ?: [],
        'dayTimes' => json_decode($r['day_times'] ?? '[]', true) ?: [],
        'status' => $r['status'],
        'created' => to_iso($r['created_at']),
        'coverage' => json_decode($r['coverage'] ?? '{}', true) ?: (object)[],
        'signature' => json_decode($r['signature'] ?? 'null', true),
        'balanceStatus' => $r['balance_status'],
        'completedAt' => to_iso($r['completed_at']),
        'review' => $r['review_rating'] ? ['rating' => (int)$r['review_rating'], 'text' => $r['review_text'], 'submittedAt' => to_iso($r['review_submitted_at'])] : null,
        'feedback' => json_decode($r['feedback'] ?? 'null', true),
        'feedbackReminderSentAt' => to_iso($r['feedback_reminder_sent_at'] ?? null),
        'promoCode' => $r['promo_code'],
        'region' => $r['region'],
        'zip' => $r['zip_code'],
        'address' => $r['address'] ?? null,
        'lat' => isset($r['lat']) ? (float)$r['lat'] : null,
        'lng' => isset($r['lng']) ? (float)$r['lng'] : null,
        'miles' => (int)$r['miles'],
        'adjustments' => array_map(fn($a) => [
            'amount' => (float)$a['amount'], 'reason' => $a['reason'], 'createdBy' => $a['created_by'], 'createdAt' => to_iso($a['created_at']),
        ], $adjustmentRows),
        'adjustmentsTotal' => $adjustmentsTotal,
        'payments' => array_map(fn($p) => [
            'amount' => (float)$p['amount'], 'purpose' => $p['purpose'], 'method' => $p['payment_method'],
            'reference' => $p['reference'], 'note' => $p['note'], 'createdAt' => to_iso($p['created_at']),
        ], $paymentRows),
        'balanceDue' => round((float)$r['total'] + $adjustmentsTotal - (float)$r['paid'], 2),
    ];
}

// ========== CORS HEADERS ==========
// Skipped entirely under CLI (cron jobs) — there's no HTTP request to
// attach headers to, and $_SERVER['REQUEST_METHOD'] doesn't exist there.
if (php_sapi_name() !== 'cli') {
    header('Access-Control-Allow-Origin: ' . SITE_URL);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(200);
        exit;
    }
}
