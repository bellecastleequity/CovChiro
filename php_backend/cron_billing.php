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
// "pending" is deliberately excluded here — that status means an
// admin-created phone booking the client never signed/paid for (see
// apply_successful_payment() in config.php, which is the only thing that
// ever moves a booking from "pending" to "upcoming"). If one of those is
// still "pending" once its date arrives, nobody confirmed it; step 1a below
// releases it instead of billing for coverage that was never agreed to.
$stmt = $pdo->query("SELECT id, dates FROM bookings WHERE completed_at IS NULL AND balance_status = 'not_due' AND status = 'upcoming'");
foreach ($stmt->fetchAll() as $b) {
    $dates = json_decode($b['dates'], true) ?: [];
    if (!count($dates)) continue;
    $lastDate = max($dates);
    if ($lastDate < $today) {
        $pdo->prepare("UPDATE bookings SET completed_at = NOW(), balance_status = 'due' WHERE id = ?")->execute([$b['id']]);
        $completed++;
    }
}

// ---------- 1a. Release abandoned phone-booking invites ----------
// A "pending" booking (admin-created via admin_create_for_client, awaiting
// the client's signature + deposit) that's sat unconfirmed for a week is
// treated as declined — cancel it to free the calendar hold rather than
// leaving dates blocked indefinitely for a booking that's never coming.
$released = 0;
$stmt = $pdo->query("SELECT id, title, meta, created_at FROM bookings WHERE status = 'pending' AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)");
foreach ($stmt->fetchAll() as $b) {
    $pdo->prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?")->execute([$b['id']]);
    $released++;
    send_admin_email("Phone booking invite expired — {$b['id']}", 'Phone booking invite expired',
        email_facts(['Booking' => $b['title'], 'Details' => $b['meta'], 'Reference' => $b['id']])
        . email_p('It was never signed or paid for within 7 days, so the held dates have been released.'), ['kicker' => 'Released']);
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
            $site = booking_site($b);
            $owed = booking_balance_due($pdo, $b);
            send_branded_email($b['user_email'], "Balance overdue — {$b['id']}",
                email_heading('Your balance is overdue', 'Payment reminder')
                . email_amount('Balance now due', $owed, 'includes ' . em($label) . ' of ' . em_money($amount), 'red')
                . email_booking_facts($b)
                . email_buttons([['Pay balance now', dashboard_url($site, 'balance')]])
                . email_small('Paying now stops any further late charges. If you’ve already sent payment another way, or need to talk about it, just reply to this email.'),
                ['site' => $site, 'preheader' => em_money($owed) . ' is overdue — pay now to stop further charges.']);
            send_admin_email("Overdue " . str_replace("_", " ", $kind) . " applied — {$b['id']}", 'Overdue charge applied',
                email_facts(['Client' => $b['user_name'], 'Charge' => $reason, 'Amount' => em_money($amount), 'Reference' => $b['id']]), ['kicker' => 'Auto-billing']);
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
            $site = user_site($pdo, $inv['user_id']);
            $owed = invoice_balance_due($pdo, $inv);
            send_branded_email($inv['user_email'], 'Invoice overdue — ' . html_entity_decode($inv['description'], ENT_QUOTES, 'UTF-8'),
                email_heading('Your invoice is overdue', 'Payment reminder')
                . email_amount('Amount now due', $owed, 'includes ' . em($label) . ' of ' . em_money($amount), 'red')
                . email_facts(['Invoice' => $inv['description'], 'Reference' => $inv['id'], 'Issued' => date('F j, Y', strtotime($inv['created_at']))])
                . email_buttons([['Pay invoice now', dashboard_url($site, 'invoices')]])
                . email_small('Paying now stops any further late charges. Questions? Just reply to this email.'),
                ['site' => $site, 'preheader' => em_money($owed) . ' is overdue — pay now to stop further charges.']);
            send_admin_email("Overdue " . str_replace("_", " ", $kind) . " applied — invoice {$inv['id']}", 'Overdue charge applied',
                email_facts(['Client' => $inv['user_name'], 'Charge' => $reason, 'Amount' => em_money($amount), 'Invoice' => $inv['id']]), ['kicker' => 'Auto-billing']);
        }
    );
}

echo "Billing cron complete — {$completed} booking(s) auto-completed, {$released} abandoned invite(s) released, {$feesApplied} fee/interest charge(s) applied.\n";
