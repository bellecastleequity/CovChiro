<?php
require_once __DIR__ . '/../../php_backend/config.php';

// Loaded on demand (not unconditionally) since most actions here — listing,
// declining, cancelling — don't touch Stripe at all.
function require_stripe() {
    $autoload = __DIR__ . '/../../php_backend/vendor/autoload.php';
    if (!file_exists($autoload)) json_response(['error' => 'Payment system is not configured yet (Stripe library not installed on the server).'], 503);
    require_once $autoload;
    \Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'request': handle_request($pdo); break;
    case 'list_mine': handle_list_mine($pdo); break;
    case 'list_pending': handle_list_pending($pdo); break;
    case 'list_agreements': handle_list_agreements($pdo); break;
    case 'set_custom_rate': handle_set_custom_rate($pdo); break;
    case 'approve': handle_approve($pdo); break;
    case 'decline': handle_decline($pdo); break;
    case 'cancel_agreement': handle_cancel_agreement($pdo); break;
    case 'cancel_date': handle_cancel_date($pdo); break;
    case 'set_patient_volume': handle_set_patient_volume($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function validate_patterns($patterns) {
    if (!is_array($patterns) || !count($patterns)) return 'Add at least one coverage pattern.';
    foreach ($patterns as $p) {
        if (!isset($p['dow'], $p['freq'], $p['type'], $p['count'], $p['actualStart'])) return 'Invalid pattern.';
        if ((int)$p['dow'] < 0 || (int)$p['dow'] > 6) return 'Invalid day of week.';
        if (!in_array($p['freq'], ['weekly', 'biweekly', 'monthly'], true)) return 'Invalid frequency.';
        if (!in_array($p['type'], ['full', 'half-am', 'half-pm'], true)) return 'Invalid coverage type.';
        if ((int)$p['count'] < 1) return 'Invalid session count.';
    }
    return null;
}

function handle_request(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    // No account is required to submit a standing-day request — mirrors the
    // public form, which only ever asked for a clinic name and contact email.
    $user = current_user_or_null();
    $body = json_body();
    $region = $body['region'] ?? '';
    $address = trim($body['address'] ?? '');
    $zip = extract_zip_from_address($address);
    $name = trim($body['name'] ?? '');
    $contactEmail = trim($body['contactEmail'] ?? '');
    $notes = trim($body['notes'] ?? '');
    $paymentPlan = in_array($body['paymentPlan'] ?? 'standard', ['standard', 'prepay', 'installment'], true) ? $body['paymentPlan'] : 'standard';
    $patterns = $body['patterns'] ?? [];
    $signature = $body['signature'] ?? null;
    $depositIntentId = trim($body['depositPaymentIntentId'] ?? '');

    if (!$address) json_response(['error' => 'Enter your clinic address.'], 400);
    $err = validate_patterns($patterns);
    if ($err) json_response(['error' => $err], 400);
    if (!$name) json_response(['error' => 'Enter your practice or clinic name.'], 400);
    if (!filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid contact email.'], 400);
    if (!isset(RATES[$region])) json_response(['error' => 'Invalid region.'], 400);
    if (!$signature || empty($signature['name']) || empty($signature['agreementType'])) {
        json_response(['error' => 'Please review and sign the standing day agreement first.'], 400);
    }
    if (!$depositIntentId) json_response(['error' => 'Pay the signup deposit first.'], 400);

    // Verify the deposit was actually paid (never trust a client-supplied
    // amount/customer/payment-method) and pull the reusable card off of it —
    // setup_future_usage on that PaymentIntent is what makes payment_method
    // chargeable off-session later, once this request is approved.
    require_stripe();
    try {
        $intent = \Stripe\PaymentIntent::retrieve($depositIntentId);
    } catch (\Exception $e) {
        json_response(['error' => 'Could not verify your deposit payment.'], 502);
    }
    if ($intent->status !== 'succeeded') json_response(['error' => 'Your deposit payment has not completed yet.'], 402);
    if (($intent->metadata['purpose'] ?? null) !== 'standing_signup_deposit') {
        json_response(['error' => 'Payment does not match this request.'], 400);
    }
    $expectedDeposit = estimate_standing_deposit($pdo, $region, $address, $patterns, $paymentPlan);
    $depositPaid = $intent->amount_received / 100;
    if ($depositPaid < $expectedDeposit - 0.01) json_response(['error' => 'Deposit amount does not match this request.'], 400);
    $stripeCustomerId = $intent->customer;
    $stripePaymentMethodId = $intent->payment_method;
    if (!$stripeCustomerId || !$stripePaymentMethodId) {
        json_response(['error' => 'Could not save your card for future billing. Try again.'], 502);
    }

    // Recompute each pattern's actualStart server-side (rolled forward to the
    // requested weekday) rather than trusting the client's date math.
    foreach ($patterns as &$p) {
        $p['actualStart'] = next_weekday_on_or_after($p['actualStart'], (int)$p['dow']);
        $p['count'] = (int)$p['count'];
        $p['dow'] = (int)$p['dow'];
    }
    unset($p);

    $combinedCount = pattern_day_equivalents($patterns);
    $tier = standing_tier_for($combinedCount);
    $location = resolve_location($pdo, $address);

    $id = generate_id('SD');
    $stmt = $pdo->prepare('INSERT INTO standing_requests
        (id, user_id, clinic_name, contact_email, region, zip_code, address, lat, lng, patterns, notes, payment_plan, combined_count, tier_rate, signature,
         stripe_customer_id, stripe_payment_method_id, deposit_payment_intent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $id, $user['id'] ?? null, sanitize($name), sanitize($contactEmail), $region, sanitize($zip),
        sanitize($address), $location['lat'], $location['lng'],
        json_encode($patterns), sanitize($notes), $paymentPlan, $combinedCount, $tier ? $tier['rate'] : null, json_encode($signature),
        $stripeCustomerId, $stripePaymentMethodId, $depositIntentId,
    ]);

    send_admin_email("Standing day request — {$name}", 'New standing day request',
        email_facts(['Clinic' => $name, 'Email' => $contactEmail, 'Coverage days' => (string)$combinedCount, 'Region' => $region, 'Payment plan' => $paymentPlan])
        . email_p('Review and approve it in the Standing days tab.'), ['kicker' => 'Needs review', 'cta' => 'Review in Standing days', 'reply_to' => $contactEmail]);

    json_response(['success' => true, 'id' => $id]);
}

function handle_list_mine(PDO $pdo) {
    $user = require_login();
    // Matched by contact email, not user_id — a standing request never
    // required an account, so it may predate (or never have) one.
    $reqStmt = $pdo->prepare('SELECT * FROM standing_requests WHERE LOWER(contact_email) = LOWER(?) ORDER BY created_at DESC');
    $reqStmt->execute([$user['email']]);
    $agStmt = $pdo->prepare("SELECT * FROM standing_agreements WHERE LOWER(contact_email) = LOWER(?) AND status != 'cancelled' ORDER BY created_at DESC");
    $agStmt->execute([$user['email']]);
    json_response([
        'requests' => array_map('standing_request_to_json', $reqStmt->fetchAll()),
        'agreements' => array_map('standing_agreement_to_json', $agStmt->fetchAll()),
    ]);
}

function handle_list_pending(PDO $pdo) {
    require_admin();
    $stmt = $pdo->query("SELECT * FROM standing_requests WHERE status = 'pending' ORDER BY created_at");
    json_response(['requests' => array_map('standing_request_to_json', $stmt->fetchAll())]);
}

function handle_list_agreements(PDO $pdo) {
    require_admin();
    $stmt = $pdo->query("SELECT * FROM standing_agreements WHERE status = 'active' ORDER BY created_at");
    json_response(['agreements' => array_map('standing_agreement_to_json', $stmt->fetchAll())]);
}

function handle_set_custom_rate(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['requestId'] ?? '';
    $customRate = $body['customRate'] !== null && $body['customRate'] !== '' ? (float)$body['customRate'] / 100 : null;
    $stmt = $pdo->prepare('UPDATE standing_requests SET custom_rate = ? WHERE id = ?');
    $stmt->execute([$customRate, $id]);
    json_response(['success' => true]);
}

function handle_approve(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $stmt = $pdo->prepare('SELECT * FROM standing_requests WHERE id = ?');
    $stmt->execute([$id]);
    $req = $stmt->fetch();
    if (!$req) json_response(['error' => 'Not found'], 404);
    if ($req['status'] !== 'pending') json_response(['error' => 'Already processed.'], 400);

    $patterns = json_decode($req['patterns'], true) ?: [];
    $dates = [];
    foreach ($patterns as $p) {
        foreach (generate_standing_dates($p['actualStart'], $p['freq'], (int)$p['count']) as $date) {
            $dates[] = ['date' => $date, 'type' => $p['type'], 'status' => 'scheduled', 'patientVolume' => null, 'paidAt' => null];
        }
    }
    usort($dates, fn($a, $b) => strcmp($a['date'], $b['date']));

    $tier = $req['tier_rate'] !== null ? ['rate' => (float)$req['tier_rate']] : null;
    $effectiveRate = effective_standing_rate($tier, $req['payment_plan'], $req['custom_rate'] !== null ? (float)$req['custom_rate'] : null);

    // Installments split whatever's left after the signup deposit evenly
    // across the term (one calendar month per 30 days of coverage span,
    // minimum one), with the last installment absorbing any rounding so the
    // total always matches exactly — see the cron for how these are charged.
    $installmentCount = null;
    if ($req['payment_plan'] === 'installment' && count($dates)) {
        $spanDays = (strtotime(end($dates)['date']) - strtotime($dates[0]['date'])) / 86400;
        $installmentCount = max(1, (int)round($spanDays / 30));
    }

    $agreementId = generate_id('SA');
    $stmt = $pdo->prepare('INSERT INTO standing_agreements
        (id, user_id, request_id, clinic_name, contact_email, region, zip_code, address, lat, lng, patterns, tier_rate, custom_rate, effective_rate, payment_plan, scheduled_dates, signature,
         stripe_customer_id, stripe_payment_method_id, installment_count, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "active")');
    $stmt->execute([
        $agreementId, $req['user_id'], $req['id'], $req['clinic_name'], $req['contact_email'], $req['region'], $req['zip_code'],
        $req['address'], $req['lat'], $req['lng'],
        json_encode($patterns), $req['tier_rate'], $req['custom_rate'], $effectiveRate, $req['payment_plan'], json_encode($dates), $req['signature'],
        $req['stripe_customer_id'], $req['stripe_payment_method_id'], $installmentCount,
    ]);
    $pdo->prepare("UPDATE standing_requests SET status = 'approved' WHERE id = ?")->execute([$id]);

    // Apply the signup deposit already paid at request time — it counts
    // toward the earliest scheduled date(s) regardless of billing plan.
    if ($req['deposit_payment_intent'] && $req['stripe_customer_id']) {
        require_stripe();
        try {
            $depositIntent = \Stripe\PaymentIntent::retrieve($req['deposit_payment_intent']);
            if ($depositIntent->status === 'succeeded') {
                apply_successful_standing_bulk_payment($pdo, $agreementId, $depositIntent->id,
                    $depositIntent->amount_received / 100, $depositIntent->latest_charge ?? null, 'deposit');
            }
        } catch (\Exception $e) {
            log_error('Could not apply standing deposit at approval', ['agreement' => $agreementId, 'error' => $e->getMessage()]);
        }
    }

    // Prepay tries to collect everything else right away rather than waiting
    // on the cron; if it fails (declined card, etc.) the dates stay
    // "scheduled" and the cron's per-date 7-day backstop will keep retrying.
    if ($req['payment_plan'] === 'prepay' && $req['stripe_customer_id'] && $req['stripe_payment_method_id']) {
        require_stripe();
        $refreshed = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
        $refreshed->execute([$agreementId]);
        $agreement = $refreshed->fetch();
        $remaining = 0;
        foreach (json_decode($agreement['scheduled_dates'], true) ?: [] as $d) {
            if ($d['status'] === 'scheduled' && empty($d['paidAt'])) $remaining += standing_date_rate($agreement, $d['type'])['total'];
        }
        if ($remaining > 0.005) {
            try {
                $prepayIntent = \Stripe\PaymentIntent::create([
                    'amount' => (int)round($remaining * 100),
                    'currency' => 'usd',
                    'customer' => $req['stripe_customer_id'],
                    'payment_method' => $req['stripe_payment_method_id'],
                    'off_session' => true,
                    'confirm' => true,
                    'description' => "Coverage Chiropractic — standing day agreement {$agreementId} (prepay)",
                    'metadata' => ['standing_agreement_id' => $agreementId, 'purpose' => 'prepay'],
                ]);
                if ($prepayIntent->status === 'succeeded') {
                    apply_successful_standing_bulk_payment($pdo, $agreementId, $prepayIntent->id, $remaining, $prepayIntent->latest_charge ?? null, 'prepay');
                }
            } catch (\Exception $e) {
                log_error('Standing prepay charge failed at approval', ['agreement' => $agreementId, 'error' => $e->getMessage()]);
            }
        }
        $pdo->prepare('UPDATE standing_agreements SET prepay_charged = 1 WHERE id = ?')->execute([$agreementId]);
    }

    // Fix the per-installment amount once, now that the deposit has already
    // been deducted — the cron charges this amount each month and lets the
    // final installment absorb any rounding difference.
    if ($req['payment_plan'] === 'installment' && $installmentCount) {
        $refreshed = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
        $refreshed->execute([$agreementId]);
        $agreement = $refreshed->fetch();
        $remaining = 0;
        foreach (json_decode($agreement['scheduled_dates'], true) ?: [] as $d) {
            if ($d['status'] === 'scheduled' && empty($d['paidAt'])) $remaining += standing_date_rate($agreement, $d['type'])['total'];
        }
        $installmentAmount = round($remaining / $installmentCount, 2);
        $pdo->prepare('UPDATE standing_agreements SET installment_amount = ? WHERE id = ?')->execute([$installmentAmount, $agreementId]);
    }

    $sortedDates = array_map(fn($d) => $d['date'], $dates);
    sort($sortedDates);
    send_branded_email($req['contact_email'], 'Your standing day agreement is approved',
        email_heading('Your standing days are approved', 'Standing day agreement')
        . email_p('Great news — your standing day request is approved and your recurring coverage is on the calendar.')
        . email_facts(['Rate' => "{$effectiveRate}% standing-day rate", 'Dates scheduled' => (string)count($dates), 'First date' => $sortedDates ? date('l, F j, Y', strtotime($sortedDates[0])) : null, 'Billing' => 'Automatic, per your payment plan'])
        . email_callout('Your card on file is billed automatically on your selected plan — you never need to come back and pay manually unless you want to.', 'success')
        . email_buttons([['View my standing days', dashboard_url('coverage', 'upcoming')]]),
        ['site' => 'coverage', 'preheader' => count($dates) . ' coverage dates scheduled at your standing-day rate.']);

    json_response(['success' => true, 'agreement_id' => $agreementId]);
}

function handle_decline(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = $body['id'] ?? '';
    $stmt = $pdo->prepare('SELECT * FROM standing_requests WHERE id = ?');
    $stmt->execute([$id]);
    $req = $stmt->fetch();
    if (!$req) json_response(['error' => 'Not found'], 404);
    $pdo->prepare("UPDATE standing_requests SET status = 'declined' WHERE id = ?")->execute([$id]);
    send_branded_email($req['contact_email'], 'Update on your standing day request',
        email_heading('About your standing day request', 'Standing day agreement')
        . email_p('Thank you for your interest in a standing day agreement. Unfortunately I’m not able to accommodate this particular schedule right now.')
        . email_p('I’d still be glad to help — individual coverage dates can be booked online any time, and I’m happy to talk through alternatives. Just reply to this email.')
        . email_buttons([['See open dates', email_brand('coverage')['book']]]),
        ['site' => 'coverage', 'preheader' => 'An update on your standing day request.']);
    json_response(['success' => true]);
}

function handle_cancel_agreement(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $id = $body['id'] ?? '';
    $a = load_owned_agreement($pdo, $id);

    $cutoff = date('Y-m-d', strtotime('+30 days'));
    $dates = json_decode($a['scheduled_dates'], true) ?: [];
    foreach ($dates as &$d) {
        if ($d['date'] >= $cutoff && $d['status'] === 'scheduled') { $d['status'] = 'cancelled'; }
    }
    unset($d);
    $stmt = $pdo->prepare("UPDATE standing_agreements SET status = 'cancelling', scheduled_dates = ? WHERE id = ?");
    $stmt->execute([json_encode($dates), $id]);
    send_branded_email($a['contact_email'], 'Your standing day agreement is being cancelled',
        email_heading('Your standing day agreement is ending', 'Cancellation confirmed')
        . email_facts(['Next 30 days' => 'Still take place as scheduled', 'After that' => 'Released — no further charges'])
        . email_p('Thank you for having me as part of your schedule. If you ever need coverage again, individual dates can be booked online in minutes.')
        . email_buttons([['View my schedule', dashboard_url('coverage', 'upcoming')], ['Book individual dates', email_brand('coverage')['book'], 'secondary']]),
        ['site' => 'coverage', 'preheader' => 'Dates in the next 30 days still occur; later dates are released.']);
    json_response(['success' => true]);
}

// Loads an agreement and verifies the current session may act on it: its own
// clinic (matched by user_id when set, or by contact email — a standing
// request never required an account, so an agreement may have no user_id),
// or an admin.
function load_owned_agreement(PDO $pdo, $id) {
    $current = require_login();
    $stmt = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
    $stmt->execute([$id]);
    $a = $stmt->fetch();
    $owns = $a && (($a['user_id'] !== null && (int)$a['user_id'] === (int)$current['id']) || strtolower($a['contact_email']) === strtolower($current['email']));
    if (!$a || (!$owns && !$current['is_admin'])) json_response(['error' => 'Not found'], 404);
    return $a;
}

function handle_cancel_date(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $a = load_owned_agreement($pdo, $body['agreementId'] ?? '');
    $date = $body['date'] ?? '';
    $dates = json_decode($a['scheduled_dates'], true) ?: [];
    $found = false;
    foreach ($dates as &$d) {
        if ($d['date'] === $date && $d['status'] !== 'paid') { $d['status'] = 'cancelled'; $found = true; }
    }
    unset($d);
    if (!$found) json_response(['error' => 'That date cannot be cancelled.'], 400);
    $pdo->prepare('UPDATE standing_agreements SET scheduled_dates = ? WHERE id = ?')->execute([json_encode($dates), $a['id']]);
    json_response(['success' => true]);
}

function handle_set_patient_volume(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $a = load_owned_agreement($pdo, $body['agreementId'] ?? '');
    $date = $body['date'] ?? '';
    $volume = $body['patientVolume'] !== '' && $body['patientVolume'] !== null ? (int)$body['patientVolume'] : null;
    $dates = json_decode($a['scheduled_dates'], true) ?: [];
    foreach ($dates as &$d) { if ($d['date'] === $date) { $d['patientVolume'] = $volume; } }
    unset($d);
    $pdo->prepare('UPDATE standing_agreements SET scheduled_dates = ? WHERE id = ?')->execute([json_encode($dates), $a['id']]);
    json_response(['success' => true]);
}

function standing_request_to_json(array $r) {
    return [
        'id' => $r['id'],
        'status' => $r['status'],
        'createdAt' => to_iso($r['created_at']),
        'region' => $r['region'],
        'zip' => $r['zip_code'],
        'address' => $r['address'] ?? null,
        'lat' => isset($r['lat']) ? (float)$r['lat'] : null,
        'lng' => isset($r['lng']) ? (float)$r['lng'] : null,
        'patterns' => json_decode($r['patterns'], true) ?: [],
        'name' => $r['clinic_name'],
        'contactEmail' => $r['contact_email'],
        'notes' => $r['notes'],
        'paymentPlan' => $r['payment_plan'],
        'combinedCount' => (float)$r['combined_count'],
        'tier' => $r['tier_rate'] !== null ? ['rate' => (float)$r['tier_rate']] : null,
        'customRate' => $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null,
        'signature' => json_decode($r['signature'] ?? 'null', true),
        'cardOnFile' => !empty($r['stripe_customer_id']) && !empty($r['stripe_payment_method_id']),
    ];
}

function standing_agreement_to_json(array $r) {
    return [
        'id' => $r['id'],
        'status' => $r['status'],
        'createdAt' => to_iso($r['created_at']),
        'name' => $r['clinic_name'],
        'contactEmail' => $r['contact_email'],
        'region' => $r['region'],
        'zip' => $r['zip_code'],
        'address' => $r['address'] ?? null,
        'lat' => isset($r['lat']) ? (float)$r['lat'] : null,
        'lng' => isset($r['lng']) ? (float)$r['lng'] : null,
        'patterns' => json_decode($r['patterns'], true) ?: [],
        'tier' => $r['tier_rate'] !== null ? ['rate' => (float)$r['tier_rate']] : null,
        'paymentPlan' => $r['payment_plan'],
        'customRate' => $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null,
        'effectiveRate' => (float)$r['effective_rate'],
        'dates' => json_decode($r['scheduled_dates'], true) ?: [],
        'signature' => json_decode($r['signature'] ?? 'null', true),
        'providerSignedAt' => to_iso($r['created_at']),
    ];
}
