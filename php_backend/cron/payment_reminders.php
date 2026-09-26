<?php
// Run via cPanel Cron Jobs twice daily (e.g. 9:00 and 21:00) so the ~12-hour
// cadence shown in the client dashboard ("next reminder in ~Xh") stays accurate.
//   Command: /usr/bin/php /home/[USERNAME]/php_backend/cron/payment_reminders.php
require_once __DIR__ . '/../config.php';

const MAX_REMINDERS = 10; // stop auto-reminding after this many; needs manual follow-up past that

$stmt = $pdo->query("SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.balance_status = 'due' AND b.completed_at IS NOT NULL");
$due = $stmt->fetchAll();

$sentCount = 0;
foreach ($due as $b) {
    $countStmt = $pdo->prepare('SELECT COUNT(*) AS c, MAX(sent_at) AS last FROM payment_reminders WHERE booking_id = ?');
    $countStmt->execute([$b['id']]);
    $row = $countStmt->fetch();
    $sent = (int)$row['c'];
    if ($sent >= MAX_REMINDERS) continue;

    $hoursSinceLast = $row['last'] ? (time() - strtotime($row['last'])) / 3600 : (time() - strtotime($b['completed_at'])) / 3600;
    if ($hoursSinceLast < 11.5) continue; // not due for the next reminder yet

    $owed = round($b['total'] - $b['paid'], 2);
    $ok = send_email($b['user_email'], "Reminder: balance due on {$b['id']}",
        "<p>This is a reminder that the remaining balance of $" . number_format($owed, 2) . " on booking {$b['id']} is due.</p>" .
        '<p>Pay it from your account dashboard at ' . SITE_URL . '.</p>');

    if ($ok) {
        $ins = $pdo->prepare('INSERT INTO payment_reminders (booking_id, reminder_number) VALUES (?, ?)');
        $ins->execute([$b['id'], $sent + 1]);
        $sentCount++;
    } else {
        log_error('Payment reminder email failed to send', ['booking' => $b['id']]);
    }
}

log_error("Payment reminders cron ran, sent {$sentCount}", ['checked' => count($due)]);
echo "Checked " . count($due) . " due bookings, sent {$sentCount} reminders.\n";
