<?php
require_once __DIR__ . '/../../php_backend/config.php';

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
    $zip = trim($body['zip'] ?? '');
    $name = trim($body['name'] ?? '');
    $contactEmail = trim($body['contactEmail'] ?? '');
    $notes = trim($body['notes'] ?? '');
    $paymentPlan = in_array($body['paymentPlan'] ?? 'standard', ['standard', 'prepay', 'installment'], true) ? $body['paymentPlan'] : 'standard';
    $patterns = $body['patterns'] ?? [];

    if (!preg_match('/^\d{5}$/', $zip)) json_response(['error' => 'Enter a valid 5-digit ZIP code.'], 400);
    $err = validate_patterns($patterns);
    if ($err) json_response(['error' => $err], 400);
    if (!$name) json_response(['error' => 'Enter your practice or clinic name.'], 400);
    if (!filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) json_response(['error' => 'Enter a valid contact email.'], 400);
    if (!isset(RATES[$region])) json_response(['error' => 'Invalid region.'], 400);

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

    $id = generate_id('SD');
    $stmt = $pdo->prepare('INSERT INTO standing_requests
        (id, user_id, clinic_name, contact_email, region, zip_code, patterns, notes, payment_plan, combined_count, tier_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $id, $user['id'] ?? null, sanitize($name), sanitize($contactEmail), $region, sanitize($zip),
        json_encode($patterns), sanitize($notes), $paymentPlan, $combinedCount, $tier ? $tier['rate'] : null,
    ]);

    send_email(ADMIN_EMAIL, "Standing day request — {$name}",
        "<p>{$name} ({$contactEmail}) requested a standing day agreement.</p><p>Combined coverage days: {$combinedCount} · Region: {$region} · Payment plan: {$paymentPlan}</p>" .
        '<p>Review it in the admin "Standing days" tab.</p>');

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

    $agreementId = generate_id('SA');
    $stmt = $pdo->prepare('INSERT INTO standing_agreements
        (id, user_id, request_id, clinic_name, contact_email, region, zip_code, patterns, tier_rate, custom_rate, effective_rate, payment_plan, scheduled_dates, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "active")');
    $stmt->execute([
        $agreementId, $req['user_id'], $req['id'], $req['clinic_name'], $req['contact_email'], $req['region'], $req['zip_code'],
        json_encode($patterns), $req['tier_rate'], $req['custom_rate'], $effectiveRate, $req['payment_plan'], json_encode($dates),
    ]);
    $pdo->prepare("UPDATE standing_requests SET status = 'approved' WHERE id = ?")->execute([$id]);

    send_email($req['contact_email'], 'Your standing day agreement is approved',
        "<p>Your standing day request has been approved at a {$effectiveRate}% rate.</p><p>" . count($dates) . ' coverage dates have been scheduled — view them in your account dashboard.</p>');

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
    send_email($req['contact_email'], 'Update on your standing day request',
        '<p>Thanks for your interest in a standing day agreement — unfortunately we\'re not able to accommodate this request right now. Feel free to reach out directly to discuss alternatives.</p>');
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
    send_email($a['contact_email'], 'Your standing day agreement is being cancelled',
        "<p>Your standing day agreement is being cancelled. Dates within the next 30 days still occur as scheduled; dates after that have been released.</p>");
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
        'patterns' => json_decode($r['patterns'], true) ?: [],
        'name' => $r['clinic_name'],
        'contactEmail' => $r['contact_email'],
        'notes' => $r['notes'],
        'paymentPlan' => $r['payment_plan'],
        'combinedCount' => (float)$r['combined_count'],
        'tier' => $r['tier_rate'] !== null ? ['rate' => (float)$r['tier_rate']] : null,
        'customRate' => $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null,
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
        'patterns' => json_decode($r['patterns'], true) ?: [],
        'tier' => $r['tier_rate'] !== null ? ['rate' => (float)$r['tier_rate']] : null,
        'paymentPlan' => $r['payment_plan'],
        'customRate' => $r['custom_rate'] !== null ? (float)$r['custom_rate'] : null,
        'effectiveRate' => (float)$r['effective_rate'],
        'dates' => json_decode($r['scheduled_dates'], true) ?: [],
    ];
}
