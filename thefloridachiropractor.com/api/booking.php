<?php
require_once __DIR__ . '/../../php_backend/config.php';

expire_stale_reservations($pdo);

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'availability': handle_availability($pdo); break;
    case 'create': handle_create($pdo); break;
    case 'list': handle_list($pdo); break;
    case 'get': handle_get($pdo); break;
    case 'cancel': handle_cancel($pdo); break;
    case 'update_coverage': handle_update_coverage($pdo); break;
    case 'update_patient_volume': handle_update_patient_volume($pdo); break;
    case 'preview_address_change': handle_preview_address_change($pdo); break;
    case 'update_address': handle_update_address($pdo); break;
    case 'review': handle_review($pdo); break;
    case 'feedback': handle_feedback($pdo); break;
    case 'list_all': handle_list_all($pdo); break;
    case 'mark_complete': handle_mark_complete($pdo); break;
    case 'blackout_add': handle_blackout_add($pdo); break;
    case 'blackout_remove': handle_blackout_remove($pdo); break;
    case 'admin_add_adjustment': handle_admin_add_adjustment($pdo); break;
    case 'admin_record_payment': handle_admin_record_payment($pdo); break;
    case 'admin_refund': handle_admin_refund($pdo); break;
    case 'admin_reschedule': handle_admin_reschedule($pdo); break;
    case 'admin_cancel': handle_admin_cancel($pdo); break;
    case 'admin_delete': handle_admin_delete($pdo); break;
    case 'admin_create_for_client': handle_admin_create_for_client($pdo); break;
    case 'sign_pending': handle_sign_pending($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

// A booking reserved but never paid (payment abandoned) within 30 minutes
// is released so it stops blocking the date for everyone else.
function expire_stale_reservations(PDO $pdo) {
    $cutoff = date('Y-m-d H:i:s', time() - 1800);
    $stmt = $pdo->prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW()
        WHERE status = 'upcoming' AND paid = 0 AND balance_status = 'not_due' AND created_at < ?");
    $stmt->execute([$cutoff]);
}

function handle_availability(PDO $pdo) {
    $blackouts = $pdo->query('SELECT id, date_start AS start, date_end AS `end`, scope, note FROM blackout_dates ORDER BY date_start')->fetchAll();
    $bookedDates = all_committed_dates($pdo);
    json_response(['blackouts' => $blackouts, 'bookedDates' => array_values(array_unique($bookedDates))]);
}

function handle_create(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();

    $dates = $body['dates'] ?? [];
    $dayTypes = $body['dayTypes'] ?? [];
    $dayTimes = $body['dayTimes'] ?? [];
    $address = trim($body['address'] ?? '');
    $zip = trim($body['zip'] ?? '') ?: extract_zip_from_address($address);
    $clientRegion = $body['region'] ?? 'central';
    $coverage = $body['coverage'] ?? [];
    $signature = $body['signature'] ?? null;
    $hotelNightsInput = isset($body['hotelNights']) ? (int)$body['hotelNights'] : null;

    if (!$signature || empty($signature['name']) || empty($signature['agreementType'])) {
        json_response(['error' => 'A signed agreement is required to book.'], 400);
    }

    if (!is_array($dates) || !count($dates) || count($dates) !== count($dayTypes)) {
        json_response(['error' => 'Select at least one coverage date.'], 400);
    }
    foreach ($dayTypes as $t) {
        if (!in_array($t, ['full', 'half-am', 'half-pm'], true)) json_response(['error' => 'Invalid day type.'], 400);
    }
    if (!isset(RATES[$clientRegion])) json_response(['error' => 'Invalid region.'], 400);

    // Availability check (authoritative — re-checked regardless of what the client showed)
    $entries = [];
    foreach ($dates as $i => $d) {
        $half = $dayTypes[$i] !== 'full';
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $d) { $timeEntry = $dt; break; } }
        $entries[] = ['date' => $d, 'half' => $half, 'time' => $timeEntry['startTime'] ?? null];
    }
    $conflict = check_availability($pdo, $entries);
    if ($conflict) json_response(['error' => "That date ({$conflict['day']}) is {$conflict['why']}. Pick a different date."], 409);

    // Region/mileage: authoritative from the geocoded address (falls back to
    // the ZIP3-centroid estimate if geocoding is unavailable); client region
    // only used as a last resort for locations the lookup can't place at all.
    $location = $address !== '' ? resolve_location($pdo, $address) : lookup_zip($zip);
    $region = $location['region'] ?? $clientRegion;
    $miles = $location['miles'] ?? 0;
    $lat = $location['lat'] ?? null;
    $lng = $location['lng'] ?? null;
    if (!isset(RATES[$region])) $region = $clientRegion;

    $rate = RATES[$region];
    $sorted = $dates;
    $sortedTypes = $dayTypes;
    array_multisort($sorted, $sortedTypes);

    $fullCount = count(array_filter($sortedTypes, fn($t) => $t === 'full'));
    $halfCount = count($sortedTypes) - $fullCount;
    $base = 0;
    foreach ($sortedTypes as $t) { $base += $t === 'full' ? $rate['full'] : $rate['half']; }

    $overtimeCost = 0;
    foreach ($sorted as $i => $d) {
        $type = $sortedTypes[$i];
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $d) { $timeEntry = $dt; break; } }
        if ($timeEntry) {
            $ot = overtime_for_entry($type, $timeEntry['startTime'] ?? null, $timeEntry['endTime'] ?? null);
            $overtimeCost += $ot['cost'];
        }
    }

    $mileRate = tiered_mileage_rate($miles);
    $numTrips = count(group_consecutive_dates($sorted));
    $mileage = $miles * $mileRate * $numTrips;

    $longDistance = $miles > 300;
    $hotelNights = $longDistance ? max(1, $hotelNightsInput ?: $fullCount ?: 1) : 0;
    $hotel = $hotelNights * HOTEL_RATE;

    // Flex Rate (admin-published promotional rate for a specific date) takes
    // priority per date; the automatic last-minute discount only applies to
    // dates that don't already have one — a date never gets both.
    $lastMinuteOn = last_minute_enabled($pdo);
    $lastMinuteDiscount = 0;
    $flexDiscount = 0;
    $flexRateRowsUsed = [];
    foreach ($sorted as $i => $d) {
        $dayRate = $sortedTypes[$i] === 'full' ? $rate['full'] : $rate['half'];
        $stmt = $pdo->prepare("SELECT * FROM flex_rate_dates WHERE date = ? AND status = 'open' ORDER BY id DESC LIMIT 1");
        $stmt->execute([$d]);
        $flex = $stmt->fetch();
        if ($flex) {
            $flexDiscount += $dayRate * (float)$flex['discount_rate'];
            $flexRateRowsUsed[] = $flex;
        } elseif ($lastMinuteOn && is_last_minute($d)) {
            $lastMinuteDiscount += $dayRate * LAST_MINUTE_RATE;
        }
    }

    $preDiscountSubtotal = $base + $mileage + $hotel;
    $isFirstTimeEver = !has_any_bookings($pdo, $user['id']);
    $rStatus = recurring_status($pdo, $user['id']);
    $clientDiscount = 0;
    if ($isFirstTimeEver && $preDiscountSubtotal > 0) {
        $clientDiscount = $preDiscountSubtotal * FIRST_BOOKING_RATE;
    } elseif ($rStatus['active']) {
        $clientDiscount = $preDiscountSubtotal * RECURRING_DISCOUNT_RATE;
    }

    $preprocessedTotal = round($base + $mileage + $hotel + $overtimeCost - $lastMinuteDiscount - $flexDiscount - $clientDiscount, 2);

    // Promo code (optional) — re-validated server-side; a client can never
    // dictate its own discount amount.
    $promoCode = trim($body['promoCode'] ?? '');
    $promoRow = null;
    $promoDiscount = 0;
    if ($promoCode !== '') {
        $check = validate_promo_code($pdo, $promoCode);
        if (isset($check['error'])) json_response(['error' => $check['error']], 400);
        $promoRow = $check['promo'];
        $promoDiscount = promo_discount_amount($promoRow, $preprocessedTotal);
    }

    $total = round(max(0, $preprocessedTotal - $promoDiscount), 2);
    if ($total <= 0) json_response(['error' => 'Could not price this booking. Contact us directly.'], 400);

    $deposit = round($total * DEPOSIT_RATE, 2);
    $parts = [];
    if ($fullCount) $parts[] = "$fullCount full day" . ($fullCount > 1 ? 's' : '');
    if ($halfCount) $parts[] = "$halfCount half day" . ($halfCount > 1 ? 's' : '');
    $dayDesc = $parts ? implode(' + ', $parts) : 'No dates selected';
    $locationLabel = $address !== '' ? $address : "ZIP $zip";
    $meta = "$dayDesc · $locationLabel · $miles mi one way" . ($longDistance ? " · $hotelNights hotel night" . ($hotelNights > 1 ? 's' : '') : '');
    $title = "Office coverage — {$rate['label']}";

    $bookingId = generate_id('MM');
    $sanitizedCoverage = sanitize($coverage);
    // patientVolume needs to stay a number (or absent) for the dashboard's
    // truthiness checks and any future arithmetic — sanitize() stringifies
    // everything it touches.
    if (isset($sanitizedCoverage['patientVolume'])) {
        $sanitizedCoverage['patientVolume'] = $sanitizedCoverage['patientVolume'] !== '' ? (int)$sanitizedCoverage['patientVolume'] : null;
    }
    $stmt = $pdo->prepare('INSERT INTO bookings
        (id, user_id, status, dates, day_types, day_times, coverage_type, coverage, signature, title, meta, region, zip_code, address, lat, lng, miles, total, paid, balance_status, pay_type, promo_code, created_at, start_date)
        VALUES (?, ?, "upcoming", ?, ?, ?, "office", ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, "not_due", "deposit", ?, NOW(), ?)');
    $stmt->execute([
        $bookingId, $user['id'], json_encode(array_values($sorted)), json_encode(array_values($sortedTypes)), json_encode($dayTimes),
        json_encode($sanitizedCoverage), json_encode($signature), sanitize($title), sanitize($meta), $region, sanitize($zip),
        $address !== '' ? sanitize($address) : null, $lat, $lng, $miles, $total,
        $promoRow ? $promoRow['code'] : null, $sorted[0],
    ]);

    // Mark any Flex Rate listing used by this booking as booked, so it drops
    // off the public list and counts toward the real conversion rate.
    foreach ($flexRateRowsUsed as $flex) {
        $upd = $pdo->prepare("UPDATE flex_rate_dates SET status = 'booked', booked_booking_id = ? WHERE id = ?");
        $upd->execute([$bookingId, $flex['id']]);
    }
    if ($promoRow) {
        $upd = $pdo->prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?');
        $upd->execute([$promoRow['id']]);
    }

    json_response([
        'success' => true,
        'booking_id' => $bookingId,
        'total' => $total,
        'deposit' => $deposit,
        'title' => $title,
        'meta' => $meta,
    ]);
}

// Lets the provider create a booking on behalf of a caller (a phone
// booking) without needing that person's password. The booking is created
// with no signature and no payment — status "pending" — which keeps it off
// the 30-minute stale-reservation sweep (that only targets "upcoming") while
// still blocking the calendar like any other committed booking. The client
// gets an email inviting them to review, sign, and pay the deposit
// themselves at index.html?booking=ID — the same signature + Stripe flow as
// booking directly, just picking up partway through. A brand-new client
// gets an account created for them with a password-reset link folded into
// the same email, since handle_reset_password() already logs them in on
// success.
//
// Deliberately simpler pricing than handle_create(): day rate + mileage +
// hotel + overtime only — no flex-rate, last-minute, first-booking/recurring
// discounts, or promo codes. This is a phone-quoted booking; add a discount
// afterward as a billing adjustment from "Manage booking" if one applies.
function handle_admin_create_for_client(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();

    $name = trim($body['name'] ?? '');
    $email = strtolower(trim($body['email'] ?? ''));
    $phone = trim($body['phone'] ?? '');
    $dates = $body['dates'] ?? [];
    $dayTypes = $body['dayTypes'] ?? [];
    $dayTimes = is_array($body['dayTimes'] ?? null) ? $body['dayTimes'] : [];
    $address = trim($body['address'] ?? '');
    $clientRegion = $body['region'] ?? 'central';
    $notes = trim($body['notes'] ?? '');
    $hotelNightsInput = isset($body['hotelNights']) ? (int)$body['hotelNights'] : null;

    if (!$name) json_response(['error' => "Enter the client's name."], 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid client email.'], 400);
    if (!$address) json_response(['error' => 'Enter the clinic address.'], 400);
    if (!is_array($dates) || !count($dates) || count($dates) !== count($dayTypes)) {
        json_response(['error' => 'Add at least one coverage date.'], 400);
    }
    foreach ($dayTypes as $t) {
        if (!in_array($t, ['full', 'half-am', 'half-pm'], true)) json_response(['error' => 'Invalid day type.'], 400);
    }

    $entries = [];
    foreach ($dates as $i => $d) {
        $half = $dayTypes[$i] !== 'full';
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $d) { $timeEntry = $dt; break; } }
        $entries[] = ['date' => $d, 'half' => $half, 'time' => $timeEntry['startTime'] ?? null];
    }
    $conflict = check_availability($pdo, $entries);
    if ($conflict) json_response(['error' => "That date ({$conflict['day']}) is {$conflict['why']}. Pick a different date."], 409);

    $location = resolve_location($pdo, $address);
    $region = ($location['region'] && isset(RATES[$location['region']])) ? $location['region'] : $clientRegion;
    $miles = $location['miles'] ?? 0;
    $lat = $location['lat'] ?? null;
    $lng = $location['lng'] ?? null;
    if (!isset(RATES[$region])) $region = 'central';

    $rate = RATES[$region];
    $sorted = $dates; $sortedTypes = $dayTypes;
    array_multisort($sorted, $sortedTypes);

    $fullCount = count(array_filter($sortedTypes, fn($t) => $t === 'full'));
    $halfCount = count($sortedTypes) - $fullCount;
    $base = 0;
    foreach ($sortedTypes as $t) { $base += $t === 'full' ? $rate['full'] : $rate['half']; }

    $overtimeCost = 0;
    foreach ($sorted as $i => $d) {
        $type = $sortedTypes[$i];
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $d) { $timeEntry = $dt; break; } }
        if ($timeEntry) {
            $ot = overtime_for_entry($type, $timeEntry['startTime'] ?? null, $timeEntry['endTime'] ?? null);
            $overtimeCost += $ot['cost'];
        }
    }

    $mileRate = tiered_mileage_rate($miles);
    $numTrips = count(group_consecutive_dates($sorted));
    $mileage = $miles * $mileRate * $numTrips;

    $longDistance = $miles > 300;
    $hotelNights = $longDistance ? max(1, $hotelNightsInput ?: $fullCount ?: 1) : 0;
    $hotel = $hotelNights * HOTEL_RATE;

    $total = round($base + $mileage + $hotel + $overtimeCost, 2);
    if ($total <= 0) json_response(['error' => 'Could not price this booking.'], 400);
    $deposit = round($total * DEPOSIT_RATE, 2);

    $parts = [];
    if ($fullCount) $parts[] = "$fullCount full day" . ($fullCount > 1 ? 's' : '');
    if ($halfCount) $parts[] = "$halfCount half day" . ($halfCount > 1 ? 's' : '');
    $dayDesc = $parts ? implode(' + ', $parts) : 'No dates selected';
    $meta = "$dayDesc · $address · $miles mi one way" . ($longDistance ? " · $hotelNights hotel night" . ($hotelNights > 1 ? 's' : '') : '');
    $title = "Office coverage — {$rate['label']}";

    // Find or create the client's account. A brand-new one gets a random,
    // never-communicated password plus a reset token — handle_reset_password()
    // already logs the user in on success, so "set your password" doubles as
    // "activate your account."
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $existingUser = $stmt->fetch();
    $isNewClient = !$existingUser;
    $resetToken = null;

    if ($existingUser) {
        $userId = (int)$existingUser['id'];
    } else {
        $randomPassword = bin2hex(random_bytes(16));
        $hash = password_hash($randomPassword, PASSWORD_DEFAULT);
        $resetToken = bin2hex(random_bytes(24));
        $resetExpires = date('Y-m-d H:i:s', time() + 7 * 86400);
        $stmt = $pdo->prepare('INSERT INTO users (name, email, password_hash, phone, reset_token, reset_expires, email_verified) VALUES (?, ?, ?, ?, ?, ?, 1)');
        $stmt->execute([sanitize($name), $email, $hash, sanitize($phone), $resetToken, $resetExpires]);
        $userId = (int)$pdo->lastInsertId();
    }

    $bookingId = generate_id('MM');
    $coverage = ['notes' => sanitize($notes)];
    $stmt = $pdo->prepare('INSERT INTO bookings
        (id, user_id, status, dates, day_types, day_times, coverage_type, coverage, signature, title, meta, region, zip_code, address, lat, lng, miles, total, paid, balance_status, pay_type, created_at, start_date)
        VALUES (?, ?, "pending", ?, ?, ?, "office", ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, "not_due", "deposit", NOW(), ?)');
    $stmt->execute([
        $bookingId, $userId, json_encode(array_values($sorted)), json_encode(array_values($sortedTypes)), json_encode($dayTimes),
        json_encode($coverage), sanitize($title), sanitize($meta), $region, extract_zip_from_address($address),
        sanitize($address), $lat, $lng, $miles, $total, $sorted[0],
    ]);

    $reviewLink = SITE_URL . '/index.html?booking=' . $bookingId . ($resetToken ? '&reset=' . $resetToken : '');
    if ($isNewClient) {
        send_email($email, 'A booking has been started for you',
            "<p>Hi {$name},</p><p>A booking has been started for you at coveragechiropractor.com:</p>" .
            "<p><strong>{$title}</strong><br>{$meta}<br>Total: $" . number_format($total, 2) . ' · Deposit due: $' . number_format($deposit, 2) . '</p>' .
            '<p>Click below to set a password, review the coverage agreement, and pay the deposit to confirm:</p>' .
            "<p><a href=\"{$reviewLink}\">{$reviewLink}</a></p><p>This link expires in 7 days.</p>");
    } else {
        send_email($email, 'A booking has been added to your account',
            "<p>Hi {$name},</p><p>A booking has been added to your account at coveragechiropractor.com:</p>" .
            "<p><strong>{$title}</strong><br>{$meta}<br>Total: $" . number_format($total, 2) . ' · Deposit due: $' . number_format($deposit, 2) . '</p>' .
            '<p>Sign in and review it to sign the coverage agreement and pay the deposit to confirm:</p>' .
            "<p><a href=\"{$reviewLink}\">{$reviewLink}</a></p>");
    }
    send_email(ADMIN_EMAIL, "Phone booking started — {$bookingId}",
        "<p>{$name} ({$email}) — {$title}, {$meta}. Awaiting their signature + deposit.</p>");

    json_response(['success' => true, 'booking_id' => $bookingId, 'is_new_client' => $isNewClient, 'total' => $total, 'deposit' => $deposit]);
}

function handle_list(PDO $pdo) {
    $user = require_login();
    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC');
    $stmt->execute([$user['id']]);
    json_response(['bookings' => array_map(fn($r) => booking_to_json($pdo, $r), $stmt->fetchAll())]);
}

function handle_get(PDO $pdo) {
    $user = require_login();
    $id = $_GET['id'] ?? '';
    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || ((int)$row['user_id'] !== (int)$user['id'] && !$user['is_admin'])) json_response(['error' => 'Not found'], 404);
    json_response(['booking' => booking_to_json($pdo, $row)]);
}

// The other half of handle_admin_create_for_client()'s flow: the client
// reviews the pending booking at index.html?booking=ID and signs the
// coverage agreement themselves (only they can meaningfully agree to it —
// admin can't sign on their behalf). Doesn't touch payment or status; the
// deposit PaymentIntent confirmation (apply_successful_payment) is what
// actually flips the booking from "pending" to "upcoming" once it's paid.
function handle_sign_pending(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $id = $body['id'] ?? '';
    $signature = $body['signature'] ?? null;
    if (!$signature || empty($signature['name']) || empty($signature['agreementType'])) {
        json_response(['error' => 'A signed agreement is required.'], 400);
    }

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if ($b['status'] !== 'pending') json_response(['error' => 'This booking has already been confirmed.'], 400);
    if ($b['signature']) json_response(['error' => 'This booking is already signed.'], 400);

    $pdo->prepare('UPDATE bookings SET signature = ? WHERE id = ?')->execute([json_encode($signature), $id]);

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    json_response(['success' => true, 'booking' => booking_to_json($pdo, $stmt->fetch())]);
}

function handle_cancel(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $id = $body['id'] ?? '';

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if ($b['status'] === 'cancelled') json_response(['error' => 'Already cancelled'], 400);

    $hoursUntil = (strtotime($b['start_date'] . ' 08:00:00') - time()) / 3600;
    $refundable = $hoursUntil >= CANCEL_FULL_REFUND_HOURS;
    $refundAmount = 0;

    if ($refundable && $b['paid'] > 0) {
        $refundAmount = (float)$b['paid'];
        stripe_refund_booking($pdo, $b, $refundAmount);
    }

    $stmt = $pdo->prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?");
    $stmt->execute([$id]);

    send_email($user['email'], "Booking {$id} cancelled", "<p>Your booking {$id} has been cancelled." .
        ($refundAmount > 0 ? " A refund of $" . number_format($refundAmount, 2) . " has been issued to your card." : " Since this was inside the 48-hour window, the deposit is not refundable.") . "</p>");
    send_email(ADMIN_EMAIL, "Booking {$id} cancelled by client", "<p>{$user['email']} cancelled booking {$id}.</p>");

    json_response(['success' => true, 'refund_amount' => $refundAmount]);
}

// Lets a client update the day-of coverage details (expected patient volume,
// dress code, techniques, notes, day-of contact) on a booking they haven't
// been covered for yet — these were previously only ever set once, during
// the original booking wizard, with no way to correct or add them after.
function handle_update_coverage(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $id = $body['id'] ?? '';

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || ((int)$b['user_id'] !== (int)$user['id'] && !$user['is_admin'])) json_response(['error' => 'Not found'], 404);
    // mark_complete only ever sets completed_at/balance_status — status stays
    // "upcoming" — so completed_at is the real signal that coverage already
    // happened and these details are now historical, not editable.
    if ($b['completed_at'] !== null || !in_array($b['status'], ['upcoming', 'pending'], true)) {
        json_response(['error' => 'This booking can no longer be edited.'], 400);
    }

    // Merge onto the existing coverage rather than replacing it outright —
    // the edit form doesn't resend fields like postedHours (or
    // patientVolumeByDate, set separately per date) that shouldn't get
    // wiped out just because this form doesn't carry them.
    $existing = json_decode($b['coverage'] ?? '{}', true) ?: [];
    $techniques = $body['techniques'] ?? [];
    $coverage = array_merge($existing, sanitize([
        'dress' => $body['dress'] ?? '',
        'techniques' => is_array($techniques) ? array_values($techniques) : [],
        'notes' => $body['notes'] ?? '',
        'pocName' => $body['pocName'] ?? '',
        'pocTitle' => $body['pocTitle'] ?? '',
        'pocPhone' => $body['pocPhone'] ?? '',
    ]));

    $stmt = $pdo->prepare('UPDATE bookings SET coverage = ? WHERE id = ?');
    $stmt->execute([json_encode($coverage), $id]);

    json_response(['success' => true, 'coverage' => $coverage]);
}

// Sets the expected patient volume for one specific date on a booking —
// separate from the rest of the coverage-details edit since volume can
// reasonably differ night to night across a multi-day booking, unlike
// dress code/techniques/notes which apply to the whole engagement.
function handle_update_patient_volume(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $id = $body['id'] ?? '';
    $date = $body['date'] ?? '';

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if ($b['completed_at'] !== null || !in_array($b['status'], ['upcoming', 'pending'], true)) {
        json_response(['error' => 'This booking can no longer be edited.'], 400);
    }
    $dates = json_decode($b['dates'], true) ?: [];
    if (!in_array($date, $dates, true)) json_response(['error' => 'That date is not part of this booking.'], 400);

    $volume = isset($body['patientVolume']) && $body['patientVolume'] !== '' ? (int)$body['patientVolume'] : null;
    $coverage = json_decode($b['coverage'] ?? '{}', true) ?: [];
    if (!isset($coverage['patientVolumeByDate']) || !is_array($coverage['patientVolumeByDate'])) {
        $coverage['patientVolumeByDate'] = [];
    }
    if ($volume === null) {
        unset($coverage['patientVolumeByDate'][$date]);
    } else {
        $coverage['patientVolumeByDate'][$date] = $volume;
    }

    $stmt = $pdo->prepare('UPDATE bookings SET coverage = ? WHERE id = ?');
    $stmt->execute([json_encode($coverage), $id]);
    json_response(['success' => true]);
}

function handle_review(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $id = $body['id'] ?? '';
    $rating = (int)($body['rating'] ?? 0);
    $text = trim($body['text'] ?? '');
    if ($rating < 1 || $rating > 5) json_response(['error' => 'Pick a star rating.'], 400);

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if ($b['balance_status'] !== 'paid') json_response(['error' => 'This booking is not eligible for a review yet.'], 400);

    $stmt = $pdo->prepare('UPDATE bookings SET review_rating = ?, review_text = ?, review_submitted_at = NOW() WHERE id = ?');
    $stmt->execute([$rating, sanitize($text), $id]);
    send_email(ADMIN_EMAIL, "New review on {$id}", "<p>{$rating}/5 — " . htmlspecialchars($text) . '</p>');
    json_response(['success' => true]);
}

function handle_feedback(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $id = $body['id'] ?? '';

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if (!$b['completed_at']) json_response(['error' => 'This booking is not complete yet.'], 400);

    $punctuality = (int)($body['punctuality'] ?? 0);
    $professionalism = (int)($body['professionalism'] ?? 0);
    $patientCare = (int)($body['patientCare'] ?? 0);
    $wouldRebook = sanitize($body['wouldRebook'] ?? '');
    $feedback = [
        'punctuality' => $punctuality,
        'professionalism' => $professionalism,
        'patientCare' => $patientCare,
        'wouldRebook' => $wouldRebook,
        'notes' => sanitize($body['notes'] ?? ''),
        'submittedAt' => date('c'),
    ];
    $stmt = $pdo->prepare('UPDATE bookings SET feedback = ? WHERE id = ?');
    $stmt->execute([json_encode($feedback), $id]);

    $lowScore = $punctuality <= 2 || $professionalism <= 2 || $patientCare <= 2 || $wouldRebook === 'no';
    if ($lowScore) {
        send_email(ADMIN_EMAIL, "Low-score feedback on {$id} — needs follow-up",
            "<p>Coverage feedback on {$id} needs a look:</p><ul>" .
            "<li>Punctuality: {$punctuality}/5</li><li>Professionalism: {$professionalism}/5</li>" .
            "<li>Patient care: {$patientCare}/5</li><li>Would rebook: " . ($wouldRebook ?: 'n/a') . '</li></ul>' .
            ($feedback['notes'] ? '<p>Notes: ' . htmlspecialchars($feedback['notes']) . '</p>' : ''));
    }

    $offerPublicReview = $punctuality >= 4 && $professionalism >= 4 && $patientCare >= 4 && $wouldRebook === 'yes';
    json_response(['success' => true, 'offerPublicReview' => $offerPublicReview, 'lowScore' => $lowScore]);
}

function handle_list_all(PDO $pdo) {
    require_admin();
    $stmt = $pdo->query('SELECT b.*, u.name AS user_name, u.email AS user_email FROM bookings b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC');
    $rows = $stmt->fetchAll();
    json_response(['bookings' => array_map(function ($r) use ($pdo) {
        $j = booking_to_json($pdo, $r);
        $j['who'] = $r['user_name'];
        $j['email'] = $r['user_email'];
        return $j;
    }, $rows)]);
}

function handle_mark_complete(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    if (!in_array($b['coverage_type'], ['office', 'homevisit', 'event'], true) || $b['balance_status'] !== 'not_due') json_response(['error' => 'Not eligible to mark complete.'], 400);

    $stmt = $pdo->prepare("UPDATE bookings SET completed_at = NOW(), balance_status = 'due' WHERE id = ?");
    $stmt->execute([$id]);

    $owed = booking_balance_due($pdo, $b);
    send_email($b['user_email'], "Coverage complete — balance due on {$id}",
        "<p>Your coverage for booking {$id} is marked complete. The remaining balance of $" . number_format($owed, 2) .
        " is now due. Pay it from your account dashboard at " . SITE_URL . ".</p>");

    if ((float)$b['total'] > 0) {
        send_email($b['user_email'], "Thank you — {$b['title']}",
            "<p>Dear {$b['user_name']},</p><p>Thank you for having me cover {$b['meta']}. It was a pleasure working with your team, " .
            "and I hope it went smoothly on your end as well.</p><p>If anything came up worth mentioning, or if you'd like to get " .
            "a future date on the calendar, I'm easy to reach — just reply to this email or reach out through your account.</p>" .
            "<p>Thanks again,<br>Michael L. McPherson, D.C.<br>coveragechiropractor.com</p>");

        send_email($b['user_email'], "Quick feedback on your recent coverage?",
            "<p>Thanks for having Dr. McPherson cover {$b['title']}. If you have two minutes, coverage feedback " .
            "helps improve future visits — it's separate from a public review and goes straight to him, never posted anywhere.</p>" .
            '<p><a href="' . SITE_URL . '/dashboard.html?feedback=' . urlencode($id) . '">Share feedback on this booking</a></p>');
    }

    json_response(['success' => true]);
}

// Adds an itemized charge (positive amount) or discount (negative amount)
// to a booking. The original total is never touched — this is a ledger
// entry on top of it, so the client's receipt can always explain exactly
// why the balance changed.
function handle_admin_add_adjustment(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $admin = require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $amount = round((float)($body['amount'] ?? 0), 2);
    $reason = trim($body['reason'] ?? '');

    if (!$amount) json_response(['error' => 'Enter a non-zero amount.'], 400);
    if ($reason === '') json_response(['error' => "Enter a reason — this shows on the client's receipt."], 400);

    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    if ($b['status'] === 'cancelled') json_response(['error' => 'This booking is cancelled.'], 400);

    $stmt = $pdo->prepare('INSERT INTO booking_adjustments (booking_id, amount, reason, created_by) VALUES (?, ?, ?, ?)');
    $stmt->execute([$id, $amount, sanitize($reason), $admin['email']]);

    $balanceDue = booking_balance_due($pdo, $b);
    // A balance that's already due (coverage completed) is recomputed right
    // away; one that isn't due yet just carries the adjustment forward to
    // whenever it's eventually invoiced.
    if ($b['balance_status'] === 'due') {
        $upd = $pdo->prepare("UPDATE bookings SET balance_status = ? WHERE id = ?");
        $upd->execute([$balanceDue <= 0 ? 'paid' : 'due', $id]);
    }

    $kind = $amount > 0 ? 'additional charge' : 'discount';
    send_email($b['user_email'], "Update to your booking {$id}",
        "<p>A {$kind} of \$" . number_format(abs($amount), 2) . " was applied to your booking <strong>{$b['title']}</strong> ({$id}).</p>" .
        '<p>Reason: ' . htmlspecialchars($reason) . '</p>' .
        '<p>Current balance ' . ($balanceDue < 0 ? 'credit' : 'due') . ': $' . number_format(abs($balanceDue), 2) . '</p>');

    json_response(['success' => true, 'balanceDue' => $balanceDue]);
}

// Records a payment collected outside Stripe (check, cash, Zelle, etc.).
// Stripe-collected payments still flow through payment.php/apply_successful_payment
// as before — this is only for money that arrived some other way.
function handle_admin_record_payment(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $admin = require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $amount = round((float)($body['amount'] ?? 0), 2);
    $method = in_array($body['method'] ?? '', ['check', 'cash', 'zelle', 'other'], true) ? $body['method'] : 'other';
    $reference = trim($body['reference'] ?? '');
    $note = trim($body['note'] ?? '');

    if ($amount <= 0) json_response(['error' => 'Enter a payment amount.'], 400);

    $stmt = $pdo->prepare('SELECT b.*, u.id AS uid, u.email AS user_email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    if ($b['status'] === 'cancelled') json_response(['error' => 'This booking is cancelled.'], 400);

    $newPaid = round((float)$b['paid'] + $amount, 2);
    $b['paid'] = $newPaid;
    $balanceDue = booking_balance_due($pdo, $b);

    $stmt = $pdo->prepare('UPDATE bookings SET paid = ?' . ($b['balance_status'] === 'due' && $balanceDue <= 0 ? ", balance_status = 'paid'" : '') . ' WHERE id = ?');
    $stmt->execute([$newPaid, $id]);

    $stmt = $pdo->prepare("INSERT INTO payments (booking_id, user_id, amount, purpose, payment_method, reference, note, recorded_by, status) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, 'succeeded')");
    $stmt->execute([$id, $b['uid'], $amount, $method, sanitize($reference) ?: null, sanitize($note) ?: null, $admin['email']]);

    send_email($b['user_email'], "Payment received — {$id}",
        '<p>A payment of $' . number_format($amount, 2) . " via {$method} has been recorded on your booking <strong>{$b['title']}</strong> ({$id}).</p>" .
        '<p>Remaining balance: $' . number_format(max(0, $balanceDue), 2) . '</p>');

    json_response(['success' => true, 'balanceDue' => $balanceDue]);
}

// Refunds money already collected via Stripe. Never automatic — always a
// deliberate admin action, since a check/cash payment can't be refunded
// through Stripe at all and has to be handled directly with the client.
function handle_admin_refund(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $amount = round((float)($body['amount'] ?? 0), 2);

    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    if ($amount <= 0 || $amount > (float)$b['paid']) json_response(['error' => 'Enter a valid refund amount (up to what has been paid).'], 400);
    if (!$b['stripe_payment_intent']) json_response(['error' => "No Stripe payment on file for this booking — refund the check/cash payment directly and record it as a note instead."], 400);

    stripe_refund_booking($pdo, $b, $amount);
    $newPaid = round((float)$b['paid'] - $amount, 2);
    $upd = $pdo->prepare('UPDATE bookings SET paid = ? WHERE id = ?');
    $upd->execute([$newPaid, $id]);

    send_email($b['user_email'], "Refund issued — {$id}",
        '<p>A refund of $' . number_format($amount, 2) . " has been issued to your card for booking <strong>{$b['title']}</strong> ({$id}).</p>");

    json_response(['success' => true]);
}

// Admin-side cancellation: unlike the client's self-service cancel action
// (handle_cancel, gated to the owner and the automatic 48-hour full-refund
// rule), this works on any booking and lets the admin decide the refund
// amount directly — for a provider-initiated cancellation (full refund
// regardless of timing) or a late cancellation a client requested by phone
// with whatever refund was agreed to. A $0 refund still cancels the
// booking; it just doesn't touch Stripe.
function handle_admin_cancel(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $refundAmount = round((float)($body['refundAmount'] ?? 0), 2);

    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    if ($b['status'] === 'cancelled') json_response(['error' => 'Already cancelled'], 400);

    if ($refundAmount > 0) {
        if ($refundAmount > (float)$b['paid']) json_response(['error' => "Refund amount can't exceed what has been paid."], 400);
        if (!$b['stripe_payment_intent']) json_response(['error' => 'No Stripe payment on file — refund the check/cash payment directly and cancel with a $0 refund here.'], 400);
        stripe_refund_booking($pdo, $b, $refundAmount);
    }

    $pdo->prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?")->execute([$id]);

    send_email($b['user_email'], "Booking {$id} cancelled", "<p>Your booking {$id} ({$b['title']}) has been cancelled." .
        ($refundAmount > 0 ? ' A refund of $' . number_format($refundAmount, 2) . ' has been issued to your card.' : '') . '</p>');

    json_response(['success' => true, 'refund_amount' => $refundAmount]);
}

// Only allowed when the booking has zero financial activity (nothing paid,
// no payment or adjustment rows) — a hard delete would otherwise destroy an
// audit trail real money leaves behind. Anything with financial history
// should be cancelled (handle_admin_cancel), not deleted; this is strictly
// for cleaning up test entries, duplicates, or mistaken bookings.
function handle_admin_delete(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    if ((float)$b['paid'] > 0) json_response(['error' => 'This booking has payments on file — cancel it instead of deleting.'], 400);

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM payments WHERE booking_id = ?');
    $stmt->execute([$id]);
    if ((int)$stmt->fetchColumn() > 0) json_response(['error' => 'This booking has payment records on file — cancel it instead of deleting.'], 400);

    $stmt = $pdo->prepare('SELECT COUNT(*) FROM booking_adjustments WHERE booking_id = ?');
    $stmt->execute([$id]);
    if ((int)$stmt->fetchColumn() > 0) json_response(['error' => 'This booking has billing adjustments on file — cancel it instead of deleting.'], 400);

    $pdo->prepare('DELETE FROM bookings WHERE id = ?')->execute([$id]);
    json_response(['success' => true]);
}

// Recomputes the base coverage cost (day rate + mileage + hotel + overtime,
// no promos/flex/first-time discounts) for a given schedule — used to price
// both the old and new schedule on a reschedule, so only the delta between
// them is charged/credited rather than re-deriving the whole total.
function booking_recompute_base(array $rate, int $miles, array $dayTypes, array $dayTimes, array $dates) {
    $fullCount = count(array_filter($dayTypes, fn($t) => $t === 'full'));
    $base = 0;
    foreach ($dayTypes as $t) { $base += $t === 'full' ? $rate['full'] : $rate['half']; }

    $overtimeCost = 0;
    foreach ($dates as $i => $d) {
        $type = $dayTypes[$i] ?? 'full';
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $d) { $timeEntry = $dt; break; } }
        if ($timeEntry) {
            $ot = overtime_for_entry($type, $timeEntry['startTime'] ?? null, $timeEntry['endTime'] ?? null);
            $overtimeCost += $ot['cost'];
        }
    }

    $mileRate = tiered_mileage_rate($miles);
    $numTrips = count(group_consecutive_dates($dates));
    $mileage = $miles * $mileRate * $numTrips;

    $longDistance = $miles > 300;
    $hotelNights = $longDistance ? max(1, $fullCount ?: 1) : 0;
    $hotel = $hotelNights * HOTEL_RATE;

    return round($base + $mileage + $hotel + $overtimeCost, 2);
}

// Shared by the two client-facing address-change handlers below: geocodes
// the new address and works out the price delta for whichever pricing model
// this booking's coverage_type uses. Office coverage's day-rate itself can
// differ by region, so both the base rate AND the mileage/hotel-nights can
// shift; home visits only have a flat per-mile mileage component; event
// coverage has no distance-based pricing at all, so an address change there
// never affects price — it's purely "so I know where I'm going."
function compute_address_change_delta(PDO $pdo, array $b, string $newAddress) {
    $location = resolve_location($pdo, $newAddress);
    $newMiles = $location['miles'] ?? 0;
    $newRegion = ($location['region'] && isset(RATES[$location['region']])) ? $location['region'] : $b['region'];

    if ($b['coverage_type'] === 'office') {
        $dates = json_decode($b['dates'], true) ?: [];
        $dayTypes = json_decode($b['day_types'], true) ?: [];
        $dayTimes = json_decode($b['day_times'] ?? '[]', true) ?: [];
        $oldRate = RATES[$b['region']] ?? RATES['central'];
        $newRate = RATES[$newRegion] ?? RATES['central'];
        $oldBase = booking_recompute_base($oldRate, (int)$b['miles'], $dayTypes, $dayTimes, $dates);
        $newBase = booking_recompute_base($newRate, $newMiles, $dayTypes, $dayTimes, $dates);
        $delta = round($newBase - $oldBase, 2);
    } elseif ($b['coverage_type'] === 'homevisit') {
        $oldMileage = (int)$b['miles'] * HOMEVISIT_MILEAGE_RATE;
        $newMileage = $newMiles * HOMEVISIT_MILEAGE_RATE;
        $delta = round($newMileage - $oldMileage, 2);
    } else {
        $delta = 0.0;
    }

    return ['location' => $location, 'newMiles' => $newMiles, 'newRegion' => $newRegion, 'delta' => $delta];
}

// The one-line "meta" description (shown in the dashboard) has the old
// address and mileage baked into it as plain text from whenever the booking
// was created — swapping the stored address/miles columns alone would leave
// that description silently stale. Rather than re-deriving the full string
// per coverage_type (day-count phrasing for office, adult/child counts for
// home visits — neither of which has its own column to rebuild from), just
// replace the old location text and mileage number wherever they appear;
// harmless no-ops if either substring isn't found (e.g. no address was ever
// on file, or an event booking with no mileage segment at all).
function rebuild_booking_meta(array $b, string $newAddress, int $newMiles) {
    $oldLabel = $b['address'] ?: ($b['zip_code'] ? "ZIP {$b['zip_code']}" : '');
    $meta = $b['meta'];
    if ($oldLabel !== '') $meta = str_replace($oldLabel, $newAddress, $meta);
    return preg_replace('/\d+ mi one way/', "{$newMiles} mi one way", $meta, 1);
}

function load_editable_own_booking(PDO $pdo, $user, $id) {
    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if ($b['completed_at'] !== null || !in_array($b['status'], ['upcoming', 'pending'], true)) {
        json_response(['error' => 'This booking can no longer be edited.'], 400);
    }
    return $b;
}

// Dry run for the dashboard's "edit address" flow — geocodes the candidate
// address and reports the price impact WITHOUT saving anything, so the
// client can be shown a clear warning before committing to a change that
// costs (or saves) money.
function handle_preview_address_change(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $newAddress = trim($body['address'] ?? '');
    if ($newAddress === '') json_response(['error' => 'Enter an address.'], 400);

    $b = load_editable_own_booking($pdo, $user, $body['id'] ?? '');
    $result = compute_address_change_delta($pdo, $b, $newAddress);
    $currentTotal = round((float)$b['total'] + booking_adjustments_total($pdo, $b['id']), 2);

    json_response([
        'address' => $newAddress,
        'miles' => $result['newMiles'],
        'region' => $result['newRegion'],
        'delta' => $result['delta'],
        'currentTotal' => $currentTotal,
        'newTotal' => round($currentTotal + $result['delta'], 2),
        'geocoded' => $result['location']['lat'] !== null,
    ]);
}

// Commits an address change. If it moves the price, a first call without
// `confirmed: true` is rejected with the delta so the frontend can show the
// same warning handle_preview_address_change describes and only resubmit
// with confirmation once the client has agreed — mirrors the two-step
// create/confirm pattern already used for payments.
function handle_update_address(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $newAddress = trim($body['address'] ?? '');
    $confirmed = !empty($body['confirmed']);
    if ($newAddress === '') json_response(['error' => 'Enter an address.'], 400);

    $b = load_editable_own_booking($pdo, $user, $body['id'] ?? '');
    $result = compute_address_change_delta($pdo, $b, $newAddress);

    if ($result['delta'] != 0 && !$confirmed) {
        json_response([
            'error' => 'This address change affects your total — confirm to continue.',
            'requiresConfirmation' => true,
            'delta' => $result['delta'],
        ], 409);
    }

    $location = $result['location'];
    $newZip = extract_zip_from_address($newAddress) ?: $b['zip_code'];
    $newMeta = rebuild_booking_meta($b, $newAddress, $result['newMiles']);
    $stmt = $pdo->prepare('UPDATE bookings SET address = ?, lat = ?, lng = ?, zip_code = ?, region = ?, miles = ?, meta = ? WHERE id = ?');
    $stmt->execute([sanitize($newAddress), $location['lat'], $location['lng'], sanitize($newZip), $result['newRegion'], $result['newMiles'], sanitize($newMeta), $b['id']]);

    if ($result['delta'] != 0) {
        $stmt = $pdo->prepare('INSERT INTO booking_adjustments (booking_id, amount, reason, created_by) VALUES (?, ?, ?, ?)');
        $stmt->execute([$b['id'], $result['delta'], sanitize("Address change: {$b['miles']} mi → {$result['newMiles']} mi"), $user['email']]);
    }

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$b['id']]);
    json_response(['success' => true, 'booking' => booking_to_json($pdo, $stmt->fetch())]);
}

// Admin-side reschedule: changes a booking's date(s)/day type (and ZIP, if
// it changed), re-checking availability so it can never create a silent
// double-booking. The original signed total is left untouched — the price
// difference between the old and new schedule is added as one itemized
// adjustment, so the client's receipt always shows exactly what changed and
// why the balance moved.
function handle_admin_reschedule(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $admin = require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';

    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$id]);
    $b = $stmt->fetch();
    if (!$b) json_response(['error' => 'Not found'], 404);
    // mark_complete only ever sets completed_at/balance_status — status stays
    // "upcoming" — so completed_at is the real signal that coverage already
    // happened and the schedule is now historical, not reschedulable.
    if ($b['completed_at'] !== null || !in_array($b['status'], ['upcoming', 'pending'], true)) {
        json_response(['error' => 'This booking can no longer be rescheduled.'], 400);
    }
    if ($b['coverage_type'] !== 'office') json_response(['error' => 'Admin reschedule currently only supports office coverage bookings.'], 400);

    $dates = $body['dates'] ?? [];
    $dayTypes = $body['dayTypes'] ?? [];
    $dayTimes = is_array($body['dayTimes'] ?? null) ? $body['dayTimes'] : [];
    $zip = trim($body['zip'] ?? '') ?: $b['zip_code'];

    if (!is_array($dates) || !count($dates) || count($dates) !== count($dayTypes)) {
        json_response(['error' => 'Select at least one coverage date.'], 400);
    }
    foreach ($dayTypes as $t) {
        if (!in_array($t, ['full', 'half-am', 'half-pm'], true)) json_response(['error' => 'Invalid day type.'], 400);
    }

    $entries = [];
    foreach ($dates as $i => $d) {
        $half = $dayTypes[$i] !== 'full';
        $timeEntry = null;
        foreach ($dayTimes as $dt) { if (($dt['date'] ?? null) === $d) { $timeEntry = $dt; break; } }
        $entries[] = ['date' => $d, 'half' => $half, 'time' => $timeEntry['startTime'] ?? null];
    }
    $conflict = check_availability($pdo, $entries, $id);
    if ($conflict) json_response(['error' => "That date ({$conflict['day']}) is {$conflict['why']}. Pick a different date."], 409);

    $oldDates = json_decode($b['dates'], true) ?: [];
    $oldDayTypes = json_decode($b['day_types'], true) ?: [];
    $oldDayTimes = json_decode($b['day_times'] ?? '[]', true) ?: [];
    $oldRate = RATES[$b['region']] ?? RATES['central'];
    $oldBase = booking_recompute_base($oldRate, (int)$b['miles'], $oldDayTypes, $oldDayTimes, $oldDates);

    $zipLookup = lookup_zip($zip);
    $newRegion = ($zipLookup && isset(RATES[$zipLookup['region'] ?? ''])) ? $zipLookup['region'] : $b['region'];
    $newMiles = ($zipLookup && isset(RATES[$zipLookup['region'] ?? ''])) ? $zipLookup['miles'] : (int)$b['miles'];

    $sorted = $dates; $sortedTypes = $dayTypes;
    array_multisort($sorted, $sortedTypes);
    $newRate = RATES[$newRegion] ?? RATES['central'];
    $newBase = booking_recompute_base($newRate, $newMiles, $sortedTypes, $dayTimes, $sorted);

    $delta = round($newBase - $oldBase, 2);

    $stmt = $pdo->prepare('UPDATE bookings SET dates = ?, day_types = ?, day_times = ?, region = ?, zip_code = ?, miles = ?, start_date = ? WHERE id = ?');
    $stmt->execute([
        json_encode(array_values($sorted)), json_encode(array_values($sortedTypes)), json_encode($dayTimes),
        $newRegion, sanitize($zip), $newMiles, $sorted[0], $id,
    ]);

    if ($delta != 0) {
        $stmt = $pdo->prepare('INSERT INTO booking_adjustments (booking_id, amount, reason, created_by) VALUES (?, ?, ?, ?)');
        $stmt->execute([$id, $delta, sanitize('Schedule change: ' . implode(', ', $oldDates) . ' → ' . implode(', ', $sorted)), $admin['email']]);
    }

    // Release any Flex Rate listing this booking had claimed — it no longer
    // covers that date, so the discount should become available again.
    $upd = $pdo->prepare("UPDATE flex_rate_dates SET status = 'open', booked_booking_id = NULL WHERE booked_booking_id = ?");
    $upd->execute([$id]);

    $b['total'] = (float)$b['total'];
    $balanceDue = booking_balance_due($pdo, $b);
    send_email($b['user_email'], "Your booking {$id} was rescheduled",
        "<p>Your coverage schedule for booking {$id} has been updated by the office.</p>" .
        '<p><strong>New date(s):</strong> ' . implode(', ', $sorted) . '</p>' .
        ($delta != 0 ? '<p>' . ($delta > 0 ? 'An additional $' : 'A credit of $') . number_format(abs($delta), 2) . ' was applied to reflect the schedule change.</p>' : '') .
        '<p>Current balance ' . ($balanceDue < 0 ? 'credit' : 'due') . ': $' . number_format(abs($balanceDue), 2) . '</p>');

    json_response(['success' => true, 'delta' => $delta, 'balanceDue' => $balanceDue]);
}

function handle_blackout_add(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $start = $body['start'] ?? '';
    $end = $body['end'] ?? $start;
    $scope = in_array($body['scope'] ?? 'all', ['all', 'am', 'pm'], true) ? $body['scope'] : 'all';
    $note = trim($body['note'] ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start)) json_response(['error' => 'Pick a start date.'], 400);
    if ($end < $start) json_response(['error' => 'End date is before the start date.'], 400);

    $stmt = $pdo->prepare("SELECT id, dates FROM bookings WHERE status != 'cancelled'");
    $stmt->execute();
    foreach ($stmt->fetchAll() as $row) {
        foreach (json_decode($row['dates'], true) ?: [] as $d) {
            if ($d >= $start && $d <= $end) {
                json_response(['error' => "That range overlaps booking {$row['id']}. Cancel it first if you need the time back."], 409);
            }
        }
    }

    $id = generate_id('BK');
    $stmt = $pdo->prepare('INSERT INTO blackout_dates (id, date_start, date_end, scope, note) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$id, $start, $end, $scope, sanitize($note)]);
    json_response(['success' => true, 'id' => $id]);
}

function handle_blackout_remove(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $stmt = $pdo->prepare('DELETE FROM blackout_dates WHERE id = ?');
    $stmt->execute([$id]);
    json_response(['success' => true]);
}

function stripe_refund_booking(PDO $pdo, array $booking, float $amount) {
    $autoload = __DIR__ . '/../../php_backend/vendor/autoload.php';
    if (!file_exists($autoload) || !$booking['stripe_payment_intent']) {
        log_error('Refund skipped — Stripe SDK missing or no payment intent on file', ['booking' => $booking['id']]);
        return;
    }
    require_once $autoload;
    \Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);
    try {
        $refund = \Stripe\Refund::create([
            'payment_intent' => $booking['stripe_payment_intent'],
            'amount' => (int)round($amount * 100),
        ]);
        $stmt = $pdo->prepare('INSERT INTO payments (booking_id, user_id, amount, purpose, stripe_payment_intent, status) VALUES (?, ?, ?, "refund", ?, "refunded")');
        $stmt->execute([$booking['id'], $booking['user_id'], $amount, $booking['stripe_payment_intent']]);
    } catch (\Exception $e) {
        log_error('Stripe refund failed', ['booking' => $booking['id'], 'error' => $e->getMessage()]);
    }
}
