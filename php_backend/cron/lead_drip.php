<?php
// Offer follow-up drip, for leads from the homepage welcome pop-up and from
// campaign landing pages. Steps 1-3 go out 3, 10 and 30 days after signup;
// step 4 ("last call") goes out once the code is within 10 days of
// expiring — for a 90-day code that's about day 80, and for a shorter
// campaign it may come sooner, skipping any middle steps that no longer fit.
// Stops as soon as the lead books, unsubscribes, or the code expires. At most
// one email per lead per run, so if the cron is down for a while it catches
// up one step a day rather than sending several at once. Run once daily via
// cPanel Cron Jobs.
//   Command: /usr/bin/php /home/[USERNAME]/php_backend/cron/lead_drip.php
require_once __DIR__ . '/../config.php';

$STEP_DAYS = [1 => 3, 2 => 10, 3 => 30];
$LAST_CALL_DAYS = 10;
$MIN_DAYS_BEFORE_FOLLOWUP = 3;
$today = date('Y-m-d');
$now = time();

$leads = $pdo->query("SELECT l.*, p.expires_at, p.used_count, p.active AS promo_active
    FROM leads l LEFT JOIN promo_codes p ON p.code = l.promo_code
    WHERE l.status = 'active'")->fetchAll();

$sent = 0; $converted = 0; $expired = 0;
foreach ($leads as $lead) {
    // Booked some other way (a different code, or none at all) — the sequence
    // has done its job. A welcome lead converts on any booking (the welcome
    // code is first-booking-only, so a past client can't use it anyway); a
    // campaign can target past clients, so only a booking made after they
    // signed up counts.
    $convertedBookingId = null;
    $isConverted = (int)$lead['used_count'] > 0;
    if (!$isConverted) {
        $u = $pdo->prepare('SELECT id FROM users WHERE email = ?');
        $u->execute([$lead['email']]);
        $userRow = $u->fetch();
        if ($userRow) {
            $b = $pdo->prepare('SELECT id FROM bookings WHERE user_id = ? AND created_at >= ? ORDER BY created_at LIMIT 1');
            $b->execute([(int)$userRow['id'], lead_is_campaign($lead) ? $lead['created_at'] : '1970-01-01']);
            $booking = $b->fetch();
            if ($booking) { $isConverted = true; $convertedBookingId = $booking['id']; }
        }
    }
    if ($isConverted) {
        $pdo->prepare("UPDATE leads SET status = 'converted', converted_at = ?, converted_booking_id = COALESCE(converted_booking_id, ?) WHERE id = ?")
            ->execute([date('Y-m-d H:i:s'), $convertedBookingId, $lead['id']]);
        $converted++;
        continue;
    }
    if (!$lead['promo_active'] || ($lead['expires_at'] && $lead['expires_at'] < $today)) {
        $pdo->prepare("UPDATE leads SET status = 'expired' WHERE id = ?")->execute([$lead['id']]);
        $expired++;
        continue;
    }

    $step = (int)$lead['drip_step'];
    if ($step >= 4) continue;
    $daysSince = (int)floor(($now - strtotime($lead['created_at'])) / 86400);
    if ($daysSince < $MIN_DAYS_BEFORE_FOLLOWUP) continue;
    $daysLeft = $lead['expires_at'] ? (int)floor((strtotime($lead['expires_at'] . ' 23:59:59') - $now) / 86400) : null;

    if ($daysLeft !== null && $daysLeft <= $LAST_CALL_DAYS) {
        $sendStep = 4;
    } else {
        $sendStep = $step + 1;
        if (!isset($STEP_DAYS[$sendStep]) || $daysSince < $STEP_DAYS[$sendStep]) continue;
    }

    $promo = promo_by_code($pdo, $lead['promo_code']);
    if (!$promo) continue;
    if (send_lead_email($lead, $promo, $sendStep)) {
        $pdo->prepare('UPDATE leads SET drip_step = ?, last_drip_sent_at = ? WHERE id = ?')->execute([$sendStep, date('Y-m-d H:i:s'), $lead['id']]);
        $sent++;
    } else {
        log_error('Lead drip email failed to send', ['lead' => $lead['id'], 'step' => $sendStep]);
    }
}

log_error("Lead drip cron ran, sent {$sent}", ['checked' => count($leads), 'converted' => $converted, 'expired' => $expired]);
echo "Checked " . count($leads) . " active leads: sent {$sent}, marked {$converted} converted, {$expired} expired.\n";
