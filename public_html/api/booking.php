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
    case 'review': handle_review($pdo); break;
    case 'feedback': handle_feedback($pdo); break;
    case 'list_all': handle_list_all($pdo); break;
    case 'mark_complete': handle_mark_complete($pdo); break;
    case 'blackout_add': handle_blackout_add($pdo); break;
    case 'blackout_remove': handle_blackout_remove($pdo); break;
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
    $zip = trim($body['zip'] ?? '');
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

    // Region/mileage: authoritative from ZIP lookup; client region only used as a fallback
    // for ZIPs the lookup table doesn't recognize.
    $zipLookup = lookup_zip($zip);
    $region = $zipLookup['region'] ?? $clientRegion;
    $miles = $zipLookup['miles'] ?? 0;
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
    $meta = "$dayDesc · ZIP $zip · $miles mi one way" . ($longDistance ? " · $hotelNights hotel night" . ($hotelNights > 1 ? 's' : '') : '');
    $title = "Office coverage — {$rate['label']}";

    $bookingId = generate_id('MM');
    $stmt = $pdo->prepare('INSERT INTO bookings
        (id, user_id, status, dates, day_types, day_times, coverage_type, coverage, signature, title, meta, region, zip_code, miles, total, paid, balance_status, pay_type, promo_code, created_at, start_date)
        VALUES (?, ?, "upcoming", ?, ?, ?, "office", ?, ?, ?, ?, ?, ?, ?, ?, 0, "not_due", "deposit", ?, NOW(), ?)');
    $stmt->execute([
        $bookingId, $user['id'], json_encode(array_values($sorted)), json_encode(array_values($sortedTypes)), json_encode($dayTimes),
        json_encode(sanitize($coverage)), json_encode($signature), sanitize($title), sanitize($meta), $region, sanitize($zip), $miles, $total,
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

function handle_list(PDO $pdo) {
    $user = require_login();
    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC');
    $stmt->execute([$user['id']]);
    json_response(['bookings' => array_map('booking_to_json', $stmt->fetchAll())]);
}

function handle_get(PDO $pdo) {
    $user = require_login();
    $id = $_GET['id'] ?? '';
    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || ((int)$row['user_id'] !== (int)$user['id'] && !$user['is_admin'])) json_response(['error' => 'Not found'], 404);
    json_response(['booking' => booking_to_json($row)]);
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
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Not found'], 404);
    if (!in_array($b['status'], ['upcoming', 'pending'], true)) {
        json_response(['error' => 'This booking can no longer be edited.'], 400);
    }

    // Merge onto the existing coverage rather than replacing it outright —
    // the edit form doesn't resend fields like postedHours that were only
    // ever set at original booking time, and those shouldn't get wiped out.
    $existing = json_decode($b['coverage'] ?? '{}', true) ?: [];
    $techniques = $body['techniques'] ?? [];
    $coverage = array_merge($existing, sanitize([
        'patientVolume' => isset($body['patientVolume']) && $body['patientVolume'] !== '' ? (int)$body['patientVolume'] : null,
        'dress' => $body['dress'] ?? '',
        'techniques' => is_array($techniques) ? array_values($techniques) : [],
        'notes' => $body['notes'] ?? '',
        'pocName' => $body['pocName'] ?? '',
        'pocTitle' => $body['pocTitle'] ?? '',
        'pocPhone' => $body['pocPhone'] ?? '',
    ]));
    // patientVolume needs to stay a number (or null) for the dashboard's
    // truthiness checks — sanitize() stringifies everything it touches.
    $coverage['patientVolume'] = $coverage['patientVolume'] !== '' ? (int)$coverage['patientVolume'] : null;

    $stmt = $pdo->prepare('UPDATE bookings SET coverage = ? WHERE id = ?');
    $stmt->execute([json_encode($coverage), $id]);

    json_response(['success' => true, 'coverage' => $coverage]);
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
    json_response(['bookings' => array_map(function ($r) {
        $j = booking_to_json($r);
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

    $owed = round($b['total'] - $b['paid'], 2);
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
