<?php
require_once __DIR__ . '/../../php_backend/config.php';

require_admin();

$action = $_GET['action'] ?? 'summary';
if ($action !== 'summary') json_response(['error' => 'Unknown action'], 400);

$totalEver = (int)$pdo->query('SELECT COUNT(*) AS c FROM bookings')->fetch()['c'];
$cancelledCount = (int)$pdo->query("SELECT COUNT(*) AS c FROM bookings WHERE status = 'cancelled'")->fetch()['c'];
$cancellationRate = $totalEver ? $cancelledCount / $totalEver : 0;

$active = $pdo->query("SELECT user_id, region, total, start_date, created_at, review_rating, coverage_type FROM bookings WHERE status != 'cancelled'")->fetchAll();
$activeCount = count($active);
$avgBookingValue = $activeCount ? array_sum(array_column($active, 'total')) / $activeCount : 0;

$geo = [];
foreach ($active as $b) { if ($b['region']) $geo[$b['region']] = ($geo[$b['region']] ?? 0) + 1; }

// Service-line breakdown — coveragechiropractor.com's office coverage vs.
// thefloridachiropractor.com's home visits and events, since they share this
// same bookings table.
$SERVICE_LABEL = ['office' => 'Office coverage', 'homevisit' => 'Home visits', 'event' => 'Events'];
$byService = [];
foreach ($active as $b) {
    $key = $SERVICE_LABEL[$b['coverage_type']] ?? $b['coverage_type'];
    if (!isset($byService[$key])) $byService[$key] = ['count' => 0, 'revenue' => 0];
    $byService[$key]['count']++;
    $byService[$key]['revenue'] += (float)$b['total'];
}

$leadTimes = [];
foreach ($active as $b) {
    if ($b['created_at'] && $b['start_date']) {
        $days = max(0, (int)round((strtotime($b['start_date']) - strtotime($b['created_at'])) / 86400));
        $leadTimes[] = $days;
    }
}
$avgLeadTime = count($leadTimes) ? array_sum($leadTimes) / count($leadTimes) : null;

$byClient = [];
foreach ($active as $b) { $byClient[$b['user_id']] = ($byClient[$b['user_id']] ?? 0) + 1; }
$clientCount = count($byClient);
$retained = count(array_filter($byClient, fn($c) => $c > 1));
$retentionRate = $clientCount ? $retained / $clientCount : 0;

// Recurring Clinic loyalty program visibility — how many distinct clients
// currently hold the active 5% recurring rate (see recurring_status()).
$recurringActiveCount = 0;
foreach (array_keys($byClient) as $uid) {
    if (recurring_status($pdo, (int)$uid)['active']) $recurringActiveCount++;
}

$ratings = array_values(array_filter(array_column($active, 'review_rating'), fn($r) => $r !== null));
$avgRating = count($ratings) ? array_sum($ratings) / count($ratings) : null;

// Utilization over the next 90 days: same rule as the client calendar —
// a day counts as "open" unless it's fully blacked out or already committed.
$windowDays = 90;
$blackoutFullDays = [];
foreach ($pdo->query("SELECT date_start, date_end FROM blackout_dates WHERE scope = 'all'")->fetchAll() as $b) {
    $d = strtotime($b['date_start']);
    $end = strtotime($b['date_end']);
    while ($d <= $end) { $blackoutFullDays[date('Y-m-d', $d)] = true; $d = strtotime('+1 day', $d); }
}
$committed = array_flip(all_committed_dates($pdo));
$openCount = 0;
$today = strtotime('today');
for ($i = 1; $i <= $windowDays; $i++) {
    $dateStr = date('Y-m-d', strtotime("+{$i} days", $today));
    if (!isset($blackoutFullDays[$dateStr]) && !isset($committed[$dateStr])) $openCount++;
}
$utilization = 1 - ($openCount / $windowDays);

$seasonal = [];
foreach ($active as $b) { if ($b['start_date']) { $m = substr($b['start_date'], 0, 7); $seasonal[$m] = ($seasonal[$m] ?? 0) + 1; } }
ksort($seasonal);

$flexCounts = $pdo->query("SELECT status, COUNT(*) AS c FROM flex_rate_dates GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR);
$flexPublished = ($flexCounts['open'] ?? 0) + ($flexCounts['booked'] ?? 0) + ($flexCounts['withdrawn'] ?? 0);
$flexBooked = (int)($flexCounts['booked'] ?? 0);
$flexConversionRate = $flexPublished ? $flexBooked / $flexPublished : null;

// Deeper Flex Rate breakdowns: which discount level, region, and how far
// ahead of the date it was published actually convert best. Only resolved
// listings (booked or withdrawn) count here — a still-open listing hasn't
// had its outcome decided yet, so including it would understate rates for
// dates published only recently.
function bucket_discount_pct($rate) {
    $pct = $rate * 100;
    if ($pct < 10) return '0-9%';
    if ($pct < 20) return '10-19%';
    if ($pct < 30) return '20-29%';
    return '30%+';
}
function bucket_lead_days($days) {
    if ($days <= 1) return 'Published 0-1 days out';
    if ($days <= 5) return 'Published 2-5 days out';
    if ($days <= 10) return 'Published 6-10 days out';
    return 'Published 11+ days out';
}
$flexByDiscount = []; $flexByRegion = []; $flexByLead = [];
$flexRows = $pdo->query("SELECT date, region, discount_rate, status, created_at FROM flex_rate_dates WHERE status IN ('booked', 'withdrawn')")->fetchAll();
foreach ($flexRows as $f) {
    $booked = $f['status'] === 'booked' ? 1 : 0;

    $dBucket = bucket_discount_pct($f['discount_rate']);
    if (!isset($flexByDiscount[$dBucket])) $flexByDiscount[$dBucket] = ['published' => 0, 'booked' => 0];
    $flexByDiscount[$dBucket]['published']++;
    $flexByDiscount[$dBucket]['booked'] += $booked;

    $r = $f['region'] ?: 'unknown';
    if (!isset($flexByRegion[$r])) $flexByRegion[$r] = ['published' => 0, 'booked' => 0];
    $flexByRegion[$r]['published']++;
    $flexByRegion[$r]['booked'] += $booked;

    $leadDays = max(0, (int)round((strtotime($f['date']) - strtotime($f['created_at'])) / 86400));
    $lBucket = bucket_lead_days($leadDays);
    if (!isset($flexByLead[$lBucket])) $flexByLead[$lBucket] = ['published' => 0, 'booked' => 0];
    $flexByLead[$lBucket]['published']++;
    $flexByLead[$lBucket]['booked'] += $booked;
}
foreach ([&$flexByDiscount, &$flexByRegion, &$flexByLead] as &$group) {
    foreach ($group as &$v) { $v['rate'] = $v['published'] ? $v['booked'] / $v['published'] : 0; }
}
unset($group, $v);

json_response([
    'totalEver' => $totalEver, 'cancelledCount' => $cancelledCount, 'avgBookingValue' => round($avgBookingValue, 2), 'cancellationRate' => $cancellationRate,
    'geo' => $geo, 'avgLeadTime' => $avgLeadTime !== null ? round($avgLeadTime, 1) : null, 'leadTimeSampleSize' => count($leadTimes),
    'retentionRate' => $retentionRate, 'clientCount' => $clientCount, 'recurringActiveCount' => $recurringActiveCount,
    'avgRating' => $avgRating !== null ? round($avgRating, 2) : null, 'ratingSampleSize' => count($ratings),
    'utilization' => $utilization, 'windowDays' => $windowDays,
    'seasonal' => $seasonal, 'flexPublished' => $flexPublished, 'flexBooked' => $flexBooked, 'flexConversionRate' => $flexConversionRate,
    'flexByDiscount' => $flexByDiscount, 'flexByRegion' => $flexByRegion, 'flexByLead' => $flexByLead,
    'byService' => $byService,
]);
