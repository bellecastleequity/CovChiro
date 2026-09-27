<?php
require_once __DIR__ . '/../../php_backend/config.php';

require_admin();

$action = $_GET['action'] ?? 'list';
if ($action !== 'list') json_response(['error' => 'Unknown action'], 400);

// One raw, tagged row per payment ledger entry — every real dollar in or out
// (bookings, standing-day agreements, and standalone invoices all post into
// this same payments table). Left as individual rows rather than
// pre-aggregated in SQL so the admin UI can bucket by day/month/quarter/year
// and filter by service/region entirely client-side, the same way the
// booked-dates and Flex Rate lists already work.
$stmt = $pdo->query("
    SELECT p.id, p.amount, p.purpose, p.status, p.created_at,
           b.coverage_type AS booking_service, b.region AS booking_region,
           sa.region AS standing_region,
           p.booking_id, p.standing_agreement_id, p.invoice_id
    FROM payments p
    LEFT JOIN bookings b ON p.booking_id = b.id
    LEFT JOIN standing_agreements sa ON p.standing_agreement_id = sa.id
    WHERE p.status IN ('succeeded', 'refunded')
    ORDER BY p.created_at
");

$payments = [];
foreach ($stmt->fetchAll() as $r) {
    if ($r['booking_id']) {
        $service = $r['booking_service'] ?: 'office';
        $region = $r['booking_region'];
    } elseif ($r['standing_agreement_id']) {
        $service = 'standing';
        $region = $r['standing_region'];
    } elseif ($r['invoice_id']) {
        $service = 'invoice';
        $region = null;
    } else {
        $service = 'other';
        $region = null;
    }
    $payments[] = [
        'id' => (int)$r['id'],
        'amount' => (float)$r['amount'],
        'purpose' => $r['purpose'],
        'status' => $r['status'],
        'createdAt' => to_iso($r['created_at']),
        'service' => $service,
        'region' => $region,
    ];
}

json_response(['payments' => $payments]);
