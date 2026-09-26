<?php
require_once __DIR__ . '/../../php_backend/config.php';

require_admin();

$action = $_GET['action'] ?? 'summary';
if ($action !== 'summary') json_response(['error' => 'Unknown action'], 400);

$totalEver = (int)$pdo->query('SELECT COUNT(*) AS c FROM bookings')->fetch()['c'];
$cancelledCount = (int)$pdo->query("SELECT COUNT(*) AS c FROM bookings WHERE status = 'cancelled'")->fetch()['c'];
$cancellationRate = $totalEver ? $cancelledCount / $totalEver : 0;

$active = $pdo->query("SELECT user_id, region, total, start_date, created_at, review_rating FROM bookings WHERE status != 'cancelled'")->fetchAll();
$activeCount = count($active);
$avgBookingValue = $activeCount ? array_sum(array_column($active, 'total')) / $activeCount : 0;

$geo = [];
foreach ($active as $b) { if ($b['region']) $geo[$b['region']] = ($geo[$b['region']] ?? 0) + 1; }

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

json_response([
    'totalEver' => $totalEver, 'cancelledCount' => $cancelledCount, 'avgBookingValue' => round($avgBookingValue, 2), 'cancellationRate' => $cancellationRate,
    'geo' => $geo, 'avgLeadTime' => $avgLeadTime !== null ? round($avgLeadTime, 1) : null, 'leadTimeSampleSize' => count($leadTimes),
    'retentionRate' => $retentionRate, 'clientCount' => $clientCount,
    'avgRating' => $avgRating !== null ? round($avgRating, 2) : null, 'ratingSampleSize' => count($ratings),
    'utilization' => $utilization, 'windowDays' => $windowDays,
    'seasonal' => $seasonal, 'flexPublished' => $flexPublished, 'flexBooked' => $flexBooked, 'flexConversionRate' => $flexConversionRate,
]);
