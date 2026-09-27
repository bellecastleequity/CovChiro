<?php
// Run once daily via a cPanel Cron Job:
//   php /home/YOURCPANELUSER/php_backend/cron_billing.php
//
// Handles the billing side of an overdue balance, on both bookings and
// standalone invoices:
//   1. Auto-completes any booking whose last coverage date has passed and
//      hasn't been marked complete yet — this is what actually starts the
//      billing clock (a balance becomes "due" the moment coverage ends,
//      not only once someone remembers to click "mark complete").
//   2. A flat late fee once a balance is 24+ hours overdue.
//   3. Interest re-applied every 7 days it stays unpaid, compounding on the
//      balance (including fees/interest already added) — see
//      apply_late_billing() in config.php for the shared logic.
// Both fees land in the existing adjustments ledger (booking_adjustments /
// invoice_adjustments), so the dashboard's existing balance display and
// "Billing adjustments" breakdown pick them up with no separate UI needed.
// Safe to run more than once a day or to miss a day — everything is gated
// on whether that exact fee/interest period has already been charged.

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit("This script is for the server's cron only.\n");
}

require_once __DIR__ . '/config.php';

$today = date('Y-m-d');
$completed = 0;
$feesApplied = 0;

// ---------- 1. Auto-complete bookings whose coverage has ended ----------
$stmt = $pdo->query("SELECT id, dates FROM bookings WHERE completed_at IS NULL AND balance_status = 'not_due' AND status IN ('upcoming', 'pending')");
foreach ($stmt->fetchAll() as $b) {
    $dates = json_decode($b['dates'], true) ?: [];
    if (!count($dates)) continue;
    $lastDate = max($dates);
    if ($lastDate < $today) {
        $pdo->prepare("UPDATE bookings SET completed_at = NOW(), balance_status = 'due' WHERE id = ?")->execute([$b['id']]);
        $completed++;
    }
}

// ---------- 2. Late fee + interest on overdue booking balances ----------
$stmt = $pdo->query("SELECT b.*, u.email AS user_email, u.name AS user_name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.balance_status = 'due' AND b.completed_at IS NOT NULL");
foreach ($stmt->fetchAll() as $b) {
    $dueAt = new DateTime($b['completed_at']);
    apply_late_billing(
        $pdo, 'booking_adjustments', 'booking_id', $b['id'], $dueAt,
        function () use ($pdo, &$b) {
            $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
            $stmt->execute([$b['id']]);
            $fresh = $stmt->fetch();
            return booking_balance_due($pdo, $fresh);
        },
        function ($amount, $reason) use ($pdo, $b) {
            $pdo->prepare('INSERT INTO booking_adjustments (booking_id, amount, reason, created_by) VALUES (?, ?, ?, ?)')
                ->execute([$b['id'], $amount, $reason, 'system (auto-billing)']);
        },
        function ($kind, $amount, $reason) use ($pdo, $b, &$feesApplied) {
            $feesApplied++;
            $label = $kind === 'late_fee' ? 'a late fee' : 'interest';
            send_email($b['user_email'], "Balance overdue — {$b['id']}",
                "<p>Your balance on {$b['id']} ({$b['title']}) is still unpaid, and {$label} of $" . number_format($amount, 2) . " has been added.</p>" .
                '<p>Pay any time from your account dashboard to stop further charges.</p>');
            send_email(ADMIN_EMAIL, "Overdue {$kind} applied — {$b['id']}",
                "<p>{$b['user_name']} — {$reason}: $" . number_format($amount, 2) . " added to {$b['id']}.</p>");
        }
    );
}

// ---------- 3. Late fee + interest on overdue invoices ----------
$stmt = $pdo->query("SELECT i.*, u.email AS user_email, u.name AS user_name FROM invoices i JOIN users u ON u.id = i.user_id WHERE i.status = 'due'");
foreach ($stmt->fetchAll() as $inv) {
    $dueAt = new DateTime($inv['created_at']); // invoices are due immediately on creation
    apply_late_billing(
        $pdo, 'invoice_adjustments', 'invoice_id', $inv['id'], $dueAt,
        function () use ($pdo, &$inv) {
            $stmt = $pdo->prepare('SELECT * FROM invoices WHERE id = ?');
            $stmt->execute([$inv['id']]);
            $fresh = $stmt->fetch();
            return invoice_balance_due($pdo, $fresh);
        },
        function ($amount, $reason) use ($pdo, $inv) {
            $pdo->prepare('INSERT INTO invoice_adjustments (invoice_id, amount, reason, created_by) VALUES (?, ?, ?, ?)')
                ->execute([$inv['id'], $amount, $reason, 'system (auto-billing)']);
        },
        function ($kind, $amount, $reason) use ($pdo, $inv, &$feesApplied) {
            $feesApplied++;
            $label = $kind === 'late_fee' ? 'a late fee' : 'interest';
            send_email($inv['user_email'], "Invoice overdue — {$inv['description']}",
                "<p>Your invoice for \"{$inv['description']}\" is still unpaid, and {$label} of $" . number_format($amount, 2) . " has been added.</p>" .
                '<p>Pay any time from your account dashboard to stop further charges.</p>');
            send_email(ADMIN_EMAIL, "Overdue {$kind} applied — invoice {$inv['id']}",
                "<p>{$inv['user_name']} — {$reason}: $" . number_format($amount, 2) . " added to invoice {$inv['id']}.</p>");
        }
    );
}

echo "Billing cron complete — {$completed} booking(s) auto-completed, {$feesApplied} fee/interest charge(s) applied.\n";
