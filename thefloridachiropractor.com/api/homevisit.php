<?php
// Backend for TheFloridaChiropractor.com — home visits and sporting/corporate
// event coverage. Deliberately its own file rather than folded into
// booking.php: the pricing model (per-patient / hourly) is unrelated to
// office-coverage day-rates. Everything else — accounts, the shared
// calendar, Stripe payments, cancellation, review/feedback, admin views —
// is reused as-is from the existing endpoints, since bookings created here
// live in the same `bookings` table (coverage_type 'homevisit' or 'event')
// and every one of those endpoints already operates generically on any row.
require_once __DIR__ . '/../../php_backend/config.php';
// HOMEVISIT_ADULT_RATE, HOMEVISIT_CHILD_RATE, EVENT_HOURLY_RATE,
// EVENT_MIN_HOURS, and HOMEVISIT_MILEAGE_RATE are defined in config.php —
// booking.php's address-change handler needs HOMEVISIT_MILEAGE_RATE too.

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'quote': handle_quote($pdo); break;
    case 'create': handle_create($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function compute_quote(PDO $pdo, $body) {
    $kind = ($body['kind'] ?? '') === 'event' ? 'event' : 'homevisit';
    $address = trim($body['address'] ?? '');
    if ($kind === 'event') {
        $hours = max(EVENT_MIN_HOURS, (float)($body['hours'] ?? 0));
        $subtotal = round($hours * EVENT_HOURLY_RATE, 2);
        // Event pricing is flat hourly with no mileage component — the venue
        // address (when given) is geocoded purely so it shows up on the
        // admin map, and never changes the price.
        $loc = $address !== '' ? resolve_location($pdo, $address) : null;
        return [
            'kind' => 'event', 'hours' => $hours, 'subtotal' => $subtotal,
            'mileage' => 0, 'miles' => 0, 'region' => null, 'total' => $subtotal,
            'lat' => $loc['lat'] ?? null, 'lng' => $loc['lng'] ?? null,
        ];
    }
    $adults = max(1, (int)($body['adults'] ?? 1));
    $children = max(0, (int)($body['children'] ?? 0));
    $subtotal = round($adults * HOMEVISIT_ADULT_RATE + $children * HOMEVISIT_CHILD_RATE, 2);
    $found = $address !== '' ? resolve_location($pdo, $address) : lookup_zip(trim($body['zip'] ?? ''));
    $miles = $found['miles'] ?? 0;
    $region = $found['region'] ?? null;
    $mileage = round($miles * HOMEVISIT_MILEAGE_RATE, 2);
    return [
        'kind' => 'homevisit', 'adults' => $adults, 'children' => $children, 'subtotal' => $subtotal,
        'mileage' => $mileage, 'miles' => $miles, 'region' => $region, 'total' => round($subtotal + $mileage, 2),
        'lat' => $found['lat'] ?? null, 'lng' => $found['lng'] ?? null,
    ];
}

function handle_quote(PDO $pdo) {
    json_response(compute_quote($pdo, json_body()));
}

function handle_create(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();

    $date = $body['date'] ?? '';
    $kind = ($body['kind'] ?? '') === 'event' ? 'event' : 'homevisit';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_response(['error' => 'Pick a valid date.'], 400);
    if (strtotime($date) < strtotime('today')) json_response(['error' => 'Pick a date today or later.'], 400);
    // Home visits are Monday-Friday only; event coverage (sporting events,
    // corporate wellness days) commonly falls on weekends, so it's exempt.
    if ($kind === 'homevisit' && in_array((int)date('w', strtotime($date)), [0, 6], true)) {
        json_response(['error' => 'Home visits are available Monday through Friday only.'], 400);
    }

    $signature = $body['signature'] ?? null;
    if (!$signature || empty($signature['name']) || empty($signature['agreementType'])) {
        json_response(['error' => 'Please review and sign the agreement first.'], 400);
    }

    // Shared calendar with coveragechiropractor.com — a date already
    // committed on either site can't be booked again.
    if (in_array($date, all_committed_dates($pdo), true)) {
        json_response(['error' => 'That date is no longer available. Pick another.'], 409);
    }
    foreach ($pdo->query('SELECT * FROM blackout_dates')->fetchAll() as $b) {
        if ($date >= $b['date_start'] && $date <= $b['date_end'] && $b['scope'] === 'all') {
            json_response(['error' => 'That date is not available. Pick another.'], 409);
        }
    }

    $quote = compute_quote($pdo, $body);

    $promoCode = trim($body['promoCode'] ?? '');
    $promoRow = null;
    $promoDiscount = 0;
    if ($promoCode !== '') {
        $check = validate_promo_code($pdo, $promoCode);
        if (isset($check['error'])) json_response(['error' => $check['error']], 400);
        $promoRow = $check['promo'];
        $promoDiscount = promo_discount_amount($promoRow, $quote['total']);
    }
    $total = round(max(0, $quote['total'] - $promoDiscount), 2);
    if ($total <= 0) json_response(['error' => 'Could not price this booking. Contact us directly.'], 400);

    $address = trim($body['address'] ?? '');
    $zip = trim($body['zip'] ?? '') ?: extract_zip_from_address($address);
    $locationLabel = $address !== '' ? $address : ($zip ? "ZIP {$zip}" : '');
    if ($quote['kind'] === 'event') {
        $eventName = trim($body['eventName'] ?? '');
        $title = 'Sporting / corporate event coverage';
        $hoursLabel = $quote['hours'] . ' hour' . ($quote['hours'] != 1 ? 's' : '');
        $meta = $hoursLabel . ($eventName ? " · {$eventName}" : '') . ($locationLabel ? " · {$locationLabel}" : '');
    } else {
        $title = 'Home visit';
        $parts = [$quote['adults'] . ' adult' . ($quote['adults'] != 1 ? 's' : '')];
        if ($quote['children']) $parts[] = $quote['children'] . ' child add-on' . ($quote['children'] != 1 ? 's' : '');
        $meta = implode(' + ', $parts) . ($locationLabel ? " · {$locationLabel} · {$quote['miles']} mi one way" : '');
    }

    $coverage = [
        'notes' => sanitize(trim($body['notes'] ?? '')),
        'pocName' => sanitize(trim($body['pocName'] ?? '')),
        'pocPhone' => sanitize(trim($body['pocPhone'] ?? '')),
    ];

    $bookingId = generate_id($quote['kind'] === 'event' ? 'EV' : 'HV');
    $stmt = $pdo->prepare('INSERT INTO bookings
        (id, user_id, status, dates, day_types, day_times, coverage_type, coverage, signature, title, meta, region, zip_code, address, lat, lng, miles, total, paid, balance_status, pay_type, promo_code, created_at, start_date)
        VALUES (?, ?, "upcoming", ?, JSON_ARRAY("full"), JSON_ARRAY(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, "not_due", "deposit", ?, NOW(), ?)');
    $stmt->execute([
        $bookingId, $user['id'], json_encode([$date]), $quote['kind'],
        json_encode($coverage), json_encode($signature), sanitize($title), sanitize($meta),
        $quote['region'], sanitize($zip), $address !== '' ? sanitize($address) : null, $quote['lat'] ?? null, $quote['lng'] ?? null,
        $quote['miles'] ?? 0, $total, $promoRow ? $promoRow['code'] : null, $date,
    ]);

    if ($promoRow) {
        $upd = $pdo->prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?');
        $upd->execute([$promoRow['id']]);
    }

    json_response([
        'success' => true,
        'booking_id' => $bookingId,
        'total' => $total,
        'deposit' => round($total * DEPOSIT_RATE, 2),
        'title' => sanitize($title),
        'meta' => sanitize($meta),
    ]);
}
