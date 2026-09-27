<?php
// Welcome-offer drip. After the homepage pop-up issues a 15% code, this sends
// a short follow-up sequence (days 3, 10, 30 and 80 after signup) until the
// lead books, unsubscribes, or the code expires. At most one email per lead
// per run, so if the cron is down for a while it catches up one step a day
// rather than dumping the whole sequence at once. Run once daily via cPanel
// Cron Jobs.
//   Command: /usr/bin/php /home/[USERNAME]/php_backend/cron/lead_drip.php
require_once __DIR__ . '/../config.php';

$STEP_DAYS = [1 => 3, 2 => 10, 3 => 30, 4 => 80];
$today = date('Y-m-d');
$now = time();

$leads = $pdo->query("SELECT l.*, p.expires_at, p.used_count, p.active AS promo_active
    FROM leads l LEFT JOIN promo_codes p ON p.code = l.promo_code
    WHERE l.status = 'active'")->fetchAll();

$sent = 0; $converted = 0; $expired = 0;
foreach ($leads as $lead) {
    // Booked some other way (a different code, or none at all) — the sequence
    // has done its job, stop here.
    $u = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $u->execute([$lead['email']]);
    $userRow = $u->fetch();
    if ((int)$lead['used_count'] > 0 || ($userRow && has_any_bookings($pdo, (int)$userRow['id']))) {
        $pdo->prepare("UPDATE leads SET status = 'converted', converted_at = ? WHERE id = ?")->execute([date('Y-m-d H:i:s'), $lead['id']]);
        $converted++;
        continue;
    }
    if (!$lead['promo_active'] || ($lead['expires_at'] && $lead['expires_at'] < $today)) {
        $pdo->prepare("UPDATE leads SET status = 'expired' WHERE id = ?")->execute([$lead['id']]);
        $expired++;
        continue;
    }

    $nextStep = (int)$lead['drip_step'] + 1;
    if (!isset($STEP_DAYS[$nextStep])) continue;
    $daysSince = (int)floor(($now - strtotime($lead['created_at'])) / 86400);
    if ($daysSince < $STEP_DAYS[$nextStep]) continue;

    $promo = promo_by_code($pdo, $lead['promo_code']);
    if (!$promo) continue;
    if (send_lead_email($lead, $promo, $nextStep)) {
        $pdo->prepare('UPDATE leads SET drip_step = ?, last_drip_sent_at = ? WHERE id = ?')->execute([$nextStep, date('Y-m-d H:i:s'), $lead['id']]);
        $sent++;
    } else {
        log_error('Lead drip email failed to send', ['lead' => $lead['id'], 'step' => $nextStep]);
    }
}

log_error("Lead drip cron ran, sent {$sent}", ['checked' => count($leads), 'converted' => $converted, 'expired' => $expired]);
echo "Checked " . count($leads) . " active leads: sent {$sent}, marked {$converted} converted, {$expired} expired.\n";
