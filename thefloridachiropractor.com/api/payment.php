<?php
require_once __DIR__ . '/../../php_backend/config.php';

$autoload = __DIR__ . '/../../php_backend/vendor/autoload.php';
if (!file_exists($autoload)) {
    json_response(['error' => 'Payment system is not configured yet (Stripe library not installed on the server).'], 503);
}
require_once $autoload;
\Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'create_payment_intent': handle_create_intent($pdo); break;
    case 'confirm_payment': handle_confirm($pdo); break;
    case 'create_standing_payment_intent': handle_create_standing_intent($pdo); break;
    case 'confirm_standing_payment': handle_confirm_standing($pdo); break;
    case 'create_standing_deposit_intent': handle_create_standing_deposit_intent($pdo); break;
    case 'create_invoice_payment_intent': handle_create_invoice_intent($pdo); break;
    case 'confirm_invoice_payment': handle_confirm_invoice($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function load_owned_booking(PDO $pdo, $bookingId, $user) {
    $stmt = $pdo->prepare('SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?');
    $stmt->execute([$bookingId]);
    $b = $stmt->fetch();
    if (!$b || (int)$b['user_id'] !== (int)$user['id']) json_response(['error' => 'Booking not found'], 404);
    return $b;
}

function handle_create_intent(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $bookingId = $body['booking_id'] ?? '';
    $purpose = $body['purpose'] ?? 'deposit';

    $b = load_owned_booking($pdo, $bookingId, $user);
    if ($b['status'] === 'cancelled') json_response(['error' => 'This booking was cancelled.'], 400);

    if ($purpose === 'deposit') {
        if ((float)$b['paid'] > 0) json_response(['error' => 'Deposit already paid.'], 400);
        if ($b['status'] === 'pending' && !$b['signature']) json_response(['error' => 'Sign the coverage agreement before paying the deposit.'], 400);
        $amount = round($b['total'] * DEPOSIT_RATE, 2);
    } elseif ($purpose === 'balance') {
        if ($b['balance_status'] !== 'due') json_response(['error' => 'No balance is due on this booking.'], 400);
        $amount = booking_balance_due($pdo, $b);
    } else {
        json_response(['error' => 'Invalid purpose'], 400);
    }
    if ($amount <= 0) json_response(['error' => 'Nothing to charge.'], 400);

    try {
        $intent = \Stripe\PaymentIntent::create([
            'amount' => (int)round($amount * 100),
            'currency' => 'usd',
            'metadata' => ['booking_id' => $bookingId, 'purpose' => $purpose],
            'receipt_email' => $b['user_email'],
            'description' => "Coverage Chiropractic — {$b['title']} ({$purpose})",
        ]);
    } catch (\Exception $e) {
        log_error('Stripe PaymentIntent creation failed', ['booking' => $bookingId, 'error' => $e->getMessage()]);
        json_response(['error' => 'Could not start payment. Try again in a moment.'], 502);
    }

    $stmt = $pdo->prepare('UPDATE bookings SET stripe_payment_intent = ? WHERE id = ?');
    $stmt->execute([$intent->id, $bookingId]);

    json_response([
        'client_secret' => $intent->client_secret,
        'publishable_key' => STRIPE_PUBLISHABLE_KEY,
        'amount' => $amount,
    ]);
}

function handle_confirm(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $bookingId = $body['booking_id'] ?? '';
    $intentId = $body['payment_intent_id'] ?? '';

    $b = load_owned_booking($pdo, $bookingId, $user);
    if ($b['stripe_payment_intent'] !== $intentId) json_response(['error' => 'Payment does not match this booking.'], 400);

    try {
        $intent = \Stripe\PaymentIntent::retrieve($intentId);
    } catch (\Exception $e) {
        json_response(['error' => 'Could not verify payment.'], 502);
    }
    if ($intent->status !== 'succeeded') json_response(['error' => 'Payment has not completed yet.'], 402);

    $purpose = $intent->metadata['purpose'] ?? 'deposit';
    $amount = $intent->amount_received / 100;
    apply_successful_payment($pdo, $bookingId, $intentId, $purpose, $amount, $intent->latest_charge ?? null);

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$bookingId]);
    $updated = $stmt->fetch();
    json_response(['success' => true, 'booking' => booking_to_json($pdo, $updated)]);
}

function load_owned_agreement_for_payment(PDO $pdo, $agreementId, $user) {
    $stmt = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
    $stmt->execute([$agreementId]);
    $a = $stmt->fetch();
    $owns = $a && (($a['user_id'] !== null && (int)$a['user_id'] === (int)$user['id']) || strtolower($a['contact_email']) === strtolower($user['email']));
    if (!$a || !$owns) json_response(['error' => 'Agreement not found'], 404);
    $a['user_email'] = $a['contact_email'];
    return $a;
}

function handle_create_standing_intent(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $agreementId = $body['agreementId'] ?? '';
    $date = $body['date'] ?? '';

    $a = load_owned_agreement_for_payment($pdo, $agreementId, $user);
    $dates = json_decode($a['scheduled_dates'], true) ?: [];
    $entry = null;
    foreach ($dates as $d) { if ($d['date'] === $date) { $entry = $d; break; } }
    if (!$entry) json_response(['error' => 'That date is not on this agreement.'], 404);
    if ($entry['status'] === 'paid') json_response(['error' => 'Already paid.'], 400);
    if ($entry['status'] === 'cancelled') json_response(['error' => 'That date was cancelled.'], 400);

    $price = standing_date_rate($a, $entry['type']);
    $amount = $price['total'];
    if ($amount <= 0) json_response(['error' => 'Nothing to charge.'], 400);

    try {
        $intent = \Stripe\PaymentIntent::create([
            'amount' => (int)round($amount * 100),
            'currency' => 'usd',
            'metadata' => ['standing_agreement_id' => $agreementId, 'standing_date' => $date],
            'receipt_email' => $a['user_email'],
            'description' => "Coverage Chiropractic — standing day {$date}",
        ]);
    } catch (\Exception $e) {
        log_error('Stripe standing PaymentIntent creation failed', ['agreement' => $agreementId, 'date' => $date, 'error' => $e->getMessage()]);
        json_response(['error' => 'Could not start payment. Try again in a moment.'], 502);
    }

    json_response(['client_secret' => $intent->client_secret, 'publishable_key' => STRIPE_PUBLISHABLE_KEY, 'amount' => $amount]);
}

// Charges the signup deposit for a NOT-YET-SUBMITTED standing day request
// and, via setup_future_usage, saves the card on the resulting Customer so
// it can be charged automatically later without the client present — see
// standing.php's handle_request(), which verifies this PaymentIntent and
// pulls the customer/payment_method off of it before creating the request.
function handle_create_standing_deposit_intent(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $body = json_body();
    $email = trim($body['email'] ?? '');
    $name = trim($body['name'] ?? '');
    $region = $body['region'] ?? '';
    $address = trim($body['address'] ?? '');
    $patterns = $body['patterns'] ?? [];
    $paymentPlan = $body['paymentPlan'] ?? 'standard';

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'A valid contact email is required.'], 400);
    if (!isset(RATES[$region])) json_response(['error' => 'Invalid region.'], 400);
    if (!is_array($patterns) || !count($patterns)) json_response(['error' => 'Add at least one coverage pattern first.'], 400);

    $amount = estimate_standing_deposit($pdo, $region, $address, $patterns, $paymentPlan);
    if ($amount <= 0) json_response(['error' => 'Could not calculate a deposit amount.'], 400);

    try {
        $existing = \Stripe\Customer::all(['email' => $email, 'limit' => 1]);
        $customer = $existing->data[0] ?? \Stripe\Customer::create(['email' => $email, 'name' => $name ?: null]);
        $intent = \Stripe\PaymentIntent::create([
            'amount' => (int)round($amount * 100),
            'currency' => 'usd',
            'customer' => $customer->id,
            'setup_future_usage' => 'off_session',
            'receipt_email' => $email,
            'description' => 'Coverage Chiropractic — standing day signup deposit',
            'metadata' => ['purpose' => 'standing_signup_deposit'],
        ]);
    } catch (\Exception $e) {
        log_error('Stripe standing deposit intent creation failed', ['email' => $email, 'error' => $e->getMessage()]);
        json_response(['error' => 'Could not start payment. Try again in a moment.'], 502);
    }

    json_response(['client_secret' => $intent->client_secret, 'publishable_key' => STRIPE_PUBLISHABLE_KEY, 'amount' => $amount]);
}

function load_owned_invoice(PDO $pdo, $invoiceId, $user) {
    $stmt = $pdo->prepare('SELECT * FROM invoices WHERE id = ?');
    $stmt->execute([$invoiceId]);
    $inv = $stmt->fetch();
    if (!$inv || (int)$inv['user_id'] !== (int)$user['id']) json_response(['error' => 'Invoice not found'], 404);
    return $inv;
}

function handle_create_invoice_intent(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $invoiceId = $body['invoice_id'] ?? '';

    $inv = load_owned_invoice($pdo, $invoiceId, $user);
    if ($inv['status'] !== 'due') json_response(['error' => 'This invoice is not payable.'], 400);
    $amount = invoice_balance_due($pdo, $inv);
    if ($amount <= 0) json_response(['error' => 'Nothing to charge.'], 400);

    try {
        $intent = \Stripe\PaymentIntent::create([
            'amount' => (int)round($amount * 100),
            'currency' => 'usd',
            'metadata' => ['invoice_id' => $invoiceId],
            'receipt_email' => $user['email'],
            'description' => "Coverage Chiropractic — {$inv['description']}",
        ]);
    } catch (\Exception $e) {
        log_error('Stripe invoice PaymentIntent creation failed', ['invoice' => $invoiceId, 'error' => $e->getMessage()]);
        json_response(['error' => 'Could not start payment. Try again in a moment.'], 502);
    }

    $pdo->prepare('UPDATE invoices SET stripe_payment_intent = ? WHERE id = ?')->execute([$intent->id, $invoiceId]);
    json_response(['client_secret' => $intent->client_secret, 'publishable_key' => STRIPE_PUBLISHABLE_KEY, 'amount' => $amount]);
}

function handle_confirm_invoice(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $invoiceId = $body['invoice_id'] ?? '';
    $intentId = $body['payment_intent_id'] ?? '';

    $inv = load_owned_invoice($pdo, $invoiceId, $user);
    if ($inv['stripe_payment_intent'] !== $intentId) json_response(['error' => 'Payment does not match this invoice.'], 400);

    try {
        $intent = \Stripe\PaymentIntent::retrieve($intentId);
    } catch (\Exception $e) {
        json_response(['error' => 'Could not verify payment.'], 502);
    }
    if ($intent->status !== 'succeeded') json_response(['error' => 'Payment has not completed yet.'], 402);

    $amount = $intent->amount_received / 100;
    apply_successful_invoice_payment($pdo, $invoiceId, $intentId, $amount, $intent->latest_charge ?? null);

    $stmt = $pdo->prepare('SELECT * FROM invoices WHERE id = ?');
    $stmt->execute([$invoiceId]);
    json_response(['success' => true, 'invoice' => invoice_to_json($pdo, $stmt->fetch())]);
}

function handle_confirm_standing(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    $user = require_login();
    $body = json_body();
    $agreementId = $body['agreementId'] ?? '';
    $date = $body['date'] ?? '';
    $intentId = $body['payment_intent_id'] ?? '';

    load_owned_agreement_for_payment($pdo, $agreementId, $user);

    try {
        $intent = \Stripe\PaymentIntent::retrieve($intentId);
    } catch (\Exception $e) {
        json_response(['error' => 'Could not verify payment.'], 502);
    }
    if ($intent->status !== 'succeeded') json_response(['error' => 'Payment has not completed yet.'], 402);
    if (($intent->metadata['standing_agreement_id'] ?? null) !== $agreementId || ($intent->metadata['standing_date'] ?? null) !== $date) {
        json_response(['error' => 'Payment does not match this date.'], 400);
    }

    apply_successful_standing_payment($pdo, $agreementId, $date, $intentId, $intent->amount_received / 100, $intent->latest_charge ?? null);

    $stmt = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
    $stmt->execute([$agreementId]);
    json_response(['success' => true, 'agreement' => standing_agreement_to_json_public($stmt->fetch())]);
}

// Shares the same JSON shape as standing.php's mapper, duplicated locally to
// avoid a cross-file include of that dispatcher.
function standing_agreement_to_json_public(array $r) {
    return [
        'id' => $r['id'], 'status' => $r['status'], 'dates' => json_decode($r['scheduled_dates'], true) ?: [],
    ];
}
