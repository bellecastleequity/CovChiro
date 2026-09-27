<?php
require_once __DIR__ . '/../../php_backend/config.php';

require_admin();

$action = $_GET['action'] ?? 'list';
if (!in_array($action, ['list', 'projected'], true)) json_response(['error' => 'Unknown action'], 400);
if ($action === 'projected') { handle_projected($pdo); exit; }

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

// Expected/contracted revenue from bookings that are active (status =
// "upcoming" — this schema never renames status on completion, so this
// covers already-completed coverage too) or booked standing-day dates that
// haven't been cancelled — regardless of whether they've actually been paid
// yet. This is a different lens than the payments ledger above: "how much
// business do I have on the books for this period" rather than "how much
// cash have I actually collected." A multi-day booking's total (including
// any billing adjustments) is split evenly across its coverage dates so a
// booking spanning a month/quarter boundary attributes fairly to each side,
// rather than crediting the whole thing to its start date. Standalone
// invoices are deliberately excluded — they're not tied to a "booking" at
// all, which is specifically what was asked to be projected here.
//
// Shaped identically to the payments list above (status/purpose forced to
// values earnPaymentNet() on the frontend already treats as a plain full
// contribution) so every existing filter/bucket/insight function on the
// admin side works unchanged against either data set.
function handle_projected(PDO $pdo) {
    $entries = [];

    $stmt = $pdo->query("SELECT b.*, COALESCE(adj.total, 0) AS adjustments_total FROM bookings b
        LEFT JOIN (SELECT booking_id, SUM(amount) AS total FROM booking_adjustments GROUP BY booking_id) adj
            ON adj.booking_id = b.id
        WHERE b.status = 'upcoming'");
    foreach ($stmt->fetchAll() as $b) {
        $dates = json_decode($b['dates'], true) ?: [];
        $n = count($dates);
        if (!$n) continue;
        $fullValue = (float)$b['total'] + (float)$b['adjustments_total'];
        $perDate = round($fullValue / $n, 2);
        foreach ($dates as $d) {
            $entries[] = [
                'id' => $b['id'] . '-' . $d,
                'amount' => $perDate,
                'purpose' => 'expected',
                'status' => 'succeeded',
                'createdAt' => to_iso($d),
                'service' => $b['coverage_type'] ?: 'office',
                'region' => $b['region'],
            ];
        }
    }

    $stmt = $pdo->query("SELECT * FROM standing_agreements WHERE status != 'cancelled'");
    foreach ($stmt->fetchAll() as $a) {
        foreach (json_decode($a['scheduled_dates'], true) ?: [] as $sd) {
            if (($sd['status'] ?? '') === 'cancelled') continue;
            $rate = standing_date_rate($a, $sd['type'] ?? 'full');
            $entries[] = [
                'id' => $a['id'] . '-' . $sd['date'],
                'amount' => $rate['total'],
                'purpose' => 'expected',
                'status' => 'succeeded',
                'createdAt' => to_iso($sd['date']),
                'service' => 'standing',
                'region' => $a['region'],
            ];
        }
    }

    json_response(['payments' => $entries]);
}
