<?php
// Sends ONE follow-up reminder 3 days after coverage is marked complete, if
// the clinic hasn't submitted feedback yet. Run once daily via cPanel Cron
// Jobs (any time of day is fine — this isn't time-sensitive like payment
// reminders).
//   Command: /usr/bin/php /home/[USERNAME]/php_backend/cron/feedback_reminders.php
require_once __DIR__ . '/../config.php';

// $0 standing-day placeholders and cancelled bookings are never eligible —
// same exclusion rule as the "awaiting feedback" admin list.
$stmt = $pdo->query("SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.completed_at IS NOT NULL
      AND b.completed_at <= DATE_SUB(NOW(), INTERVAL 3 DAY)
      AND b.feedback IS NULL
      AND b.feedback_reminder_sent_at IS NULL
      AND b.total > 0
      AND b.status != 'cancelled'");
$due = $stmt->fetchAll();

$sentCount = 0;
foreach ($due as $b) {
    $site = booking_site($b);
    $ok = send_branded_email($b['user_email'], $site === 'florida' ? 'Quick reminder — feedback on your recent visit?' : 'Quick reminder — feedback on your recent coverage?',
        email_heading('Got two minutes?', 'Quick follow-up')
        . email_p('Just a friendly follow-up — a few quick ratings on ' . em($b['title']) . ' help improve future ' . ($site === 'florida' ? 'visits' : 'coverage') . '. It’s private: it goes straight to Dr. McPherson and is never posted anywhere.')
        . email_buttons([['Share feedback', dashboard_url($site, null, ['feedback' => $b['id']])]]),
        ['site' => $site, 'preheader' => 'Three quick ratings — private, never posted.']);

    if ($ok) {
        $upd = $pdo->prepare('UPDATE bookings SET feedback_reminder_sent_at = NOW() WHERE id = ?');
        $upd->execute([$b['id']]);
        $sentCount++;
    } else {
        log_error('Feedback reminder email failed to send', ['booking' => $b['id']]);
    }
}

log_error("Feedback reminders cron ran, sent {$sentCount}", ['checked' => count($due)]);
echo "Checked " . count($due) . " completed bookings, sent {$sentCount} feedback reminders.\n";
