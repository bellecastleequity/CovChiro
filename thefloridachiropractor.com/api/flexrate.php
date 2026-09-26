<?php
require_once __DIR__ . '/../../php_backend/config.php';

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list': handle_list($pdo); break;
    case 'publish': handle_publish($pdo); break;
    case 'unpublish': handle_unpublish($pdo); break;
    case 'bulk_publish': handle_bulk_publish($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_list(PDO $pdo) {
    $today = date('Y-m-d');
    $stmt = $pdo->prepare("SELECT * FROM flex_rate_dates WHERE status = 'open' AND date >= ? ORDER BY date");
    $stmt->execute([$today]);
    json_response(['flexRates' => array_map('flex_to_json', $stmt->fetchAll())]);
}

function handle_publish(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $date = $body['date'] ?? '';
    $type = in_array($body['type'] ?? 'full', ['full', 'half-am', 'half-pm'], true) ? $body['type'] : 'full';
    $discountPct = max(0, min(90, (float)($body['discountPct'] ?? 0)));
    $note = trim($body['note'] ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_response(['error' => 'Invalid date.'], 400);

    // Replace any existing open listing for this date, same as the original UI intent.
    $pdo->prepare("UPDATE flex_rate_dates SET status = 'withdrawn' WHERE date = ? AND status = 'open'")->execute([$date]);

    // The discount is a % off whatever region rate the client who books it
    // already qualifies for — there's one calendar and one doctor, so a Flex
    // Rate date isn't tied to a region; region is left blank here.
    $stmt = $pdo->prepare('INSERT INTO flex_rate_dates (date, region, day_type, discount_rate, note, status) VALUES (?, ?, ?, ?, ?, "open")');
    $stmt->execute([$date, '', $type, $discountPct / 100, sanitize($note)]);
    json_response(['success' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function handle_bulk_publish(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $mode = ($body['mode'] ?? 'range') === 'weekday' ? 'weekday' : 'range';
    $type = in_array($body['type'] ?? 'full', ['full', 'half-am', 'half-pm'], true) ? $body['type'] : 'full';
    $discountPct = max(0, min(90, (float)($body['discountPct'] ?? 0)));
    $note = trim($body['note'] ?? '');

    $today = new DateTime('today');
    $candidates = [];

    if ($mode === 'weekday') {
        $weekdays = array_values(array_filter(array_map('intval', $body['weekdays'] ?? []), fn($d) => $d >= 0 && $d <= 6));
        $weeksAhead = max(1, min(12, (int)($body['weeksAhead'] ?? 4)));
        if (!$weekdays) json_response(['error' => 'Pick at least one day of the week.'], 400);
        $end = (clone $today)->modify('+' . ($weeksAhead * 7) . ' days');
        $d = (clone $today)->modify('+1 day');
        while ($d <= $end) {
            if (in_array((int)$d->format('w'), $weekdays, true)) $candidates[] = $d->format('Y-m-d');
            $d->modify('+1 day');
        }
    } else {
        $start = $body['startDate'] ?? '';
        $end = $body['endDate'] ?? '';
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
            json_response(['error' => 'Pick a valid start and end date.'], 400);
        }
        $d = new DateTime($start);
        $endD = new DateTime($end);
        if ($endD < $d) json_response(['error' => 'End date is before the start date.'], 400);
        // Cap the range so a typo can't try to publish years of dates at once.
        $maxEnd = (clone $d)->modify('+180 days');
        if ($endD > $maxEnd) $endD = $maxEnd;
        while ($d <= $endD) { $candidates[] = $d->format('Y-m-d'); $d->modify('+1 day'); }
    }

    // Never publish a date that's already booked or blacked out, regardless
    // of what the admin's browser thought was open when the form was filled in.
    $committed = array_flip(all_committed_dates($pdo));
    $blackouts = $pdo->query('SELECT * FROM blackout_dates')->fetchAll();

    $published = [];
    $skipped = [];
    $pdo->beginTransaction();
    try {
        $withdrawStmt = $pdo->prepare("UPDATE flex_rate_dates SET status = 'withdrawn' WHERE date = ? AND status = 'open'");
        $insertStmt = $pdo->prepare('INSERT INTO flex_rate_dates (date, region, day_type, discount_rate, note, status) VALUES (?, ?, ?, ?, ?, "open")');
        foreach ($candidates as $date) {
            if (isset($committed[$date])) { $skipped[] = $date; continue; }
            $blocked = false;
            foreach ($blackouts as $b) {
                if ($date < $b['date_start'] || $date > $b['date_end']) continue;
                if ($b['scope'] === 'all') { $blocked = true; break; }
                if ($type === 'full') { $blocked = true; break; }
                if ($b['scope'] === 'am' && $type === 'half-am') { $blocked = true; break; }
                if ($b['scope'] === 'pm' && $type === 'half-pm') { $blocked = true; break; }
            }
            if ($blocked) { $skipped[] = $date; continue; }
            $withdrawStmt->execute([$date]);
            $insertStmt->execute([$date, '', $type, $discountPct / 100, sanitize($note)]);
            $published[] = $date;
        }
        $pdo->commit();
    } catch (\Exception $e) {
        $pdo->rollBack();
        json_response(['error' => 'Could not publish these dates. Try again.'], 500);
    }

    json_response(['success' => true, 'published' => $published, 'skipped' => $skipped]);
}

function handle_unpublish(PDO $pdo) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
    require_admin();
    $body = json_body();
    $id = (int)($body['id'] ?? 0);
    $stmt = $pdo->prepare("UPDATE flex_rate_dates SET status = 'withdrawn' WHERE id = ? AND status = 'open'");
    $stmt->execute([$id]);
    json_response(['success' => true]);
}

function flex_to_json(array $r) {
    return [
        'id' => (int)$r['id'],
        'date' => $r['date'],
        'region' => $r['region'],
        'type' => $r['day_type'],
        'discountRate' => (float)$r['discount_rate'],
        'note' => $r['note'] ?: '',
        'status' => $r['status'],
        'createdAt' => to_iso($r['created_at']),
    ];
}
