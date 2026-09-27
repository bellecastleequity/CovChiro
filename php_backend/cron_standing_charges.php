<?php
// Run once daily via a cPanel Cron Job:
//   php /home/YOURCPANELUSER/php_backend/cron_standing_charges.php
//
// Auto-charges standing-day agreements' scheduled dates using the card on
// file collected at request time (see api/standing.php). Safe to run more
// than once a day, or to miss a day — every charge is gated on the date (or
// installment slot) not already being paid, so re-runs and catch-up days
// are both no-ops where nothing is actually due.
//
// Three independent things happen per agreement, in order:
//   1. Backstop (every plan): any scheduled date within 7 days that's still
//      unpaid gets charged individually. This is the safety net — even if
//      prepay/installment billing below has a problem, no date ever goes
//      uncharged past its own 7-day window.
//   2. Prepay: a one-time full-remaining-balance charge, normally already
//      handled at approval time in standing.php — this just retries it if
//      that first attempt failed or hasn't run yet.
//   3. Installment: one fixed slice charged every ~30 days until
//      installment_count is reached, with the final slice absorbing
//      whatever's actually still unpaid so the total always matches.

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit("This script is for the server's cron only.\n");
}

require_once __DIR__ . '/config.php';
$autoload = __DIR__ . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    log_error('Standing autopay cron: Stripe vendor not installed, nothing charged');
    exit("Stripe library not installed — run composer install in php_backend/.\n");
}
require_once $autoload;
\Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);

function standing_cron_charge($customerId, $paymentMethodId, $amount, $description, $metadata) {
    return \Stripe\PaymentIntent::create([
        'amount' => (int)round($amount * 100),
        'currency' => 'usd',
        'customer' => $customerId,
        'payment_method' => $paymentMethodId,
        'off_session' => true,
        'confirm' => true,
        'description' => $description,
        'metadata' => $metadata,
    ]);
}

function standing_cron_remaining_total(array $agreement, array $dates) {
    $remaining = 0;
    foreach ($dates as $d) {
        if ($d['status'] === 'scheduled' && empty($d['paidAt'])) $remaining += standing_date_rate($agreement, $d['type'])['total'];
    }
    return $remaining;
}

$today = date('Y-m-d');
$sevenDaysOut = date('Y-m-d', strtotime('+7 days'));
$charged = 0;
$failed = 0;

$agreements = $pdo->query("SELECT * FROM standing_agreements WHERE status IN ('active', 'cancelling')")->fetchAll();

foreach ($agreements as $a) {
    if (!$a['stripe_customer_id'] || !$a['stripe_payment_method_id']) continue; // predates auto-pay — nothing to do automatically

    // Re-fetch fresh before each write below so agreements aren't clobbered
    // by a stale in-memory copy across the three steps for the same row.
    $refetch = function () use ($pdo, $a) {
        $s = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
        $s->execute([$a['id']]);
        return $s->fetch();
    };

    // ---------- 1. Per-date backstop ----------
    $agreement = $refetch();
    $dates = json_decode($agreement['scheduled_dates'], true) ?: [];
    $dateChanged = false;
    foreach ($dates as &$d) {
        if ($d['status'] !== 'scheduled' || !empty($d['paidAt'])) continue;
        if ($d['date'] > $sevenDaysOut) continue;
        $price = standing_date_rate($agreement, $d['type']);
        if ($price['total'] <= 0) continue;
        try {
            $intent = standing_cron_charge($agreement['stripe_customer_id'], $agreement['stripe_payment_method_id'], $price['total'],
                "Coverage Chiropractic — standing day {$d['date']}",
                ['standing_agreement_id' => $agreement['id'], 'standing_date' => $d['date']]);
            if ($intent->status === 'succeeded') {
                apply_successful_standing_payment($pdo, $agreement['id'], $d['date'], $intent->id, $price['total'], $intent->latest_charge ?? null);
                $d['status'] = 'paid';
                $d['paidAt'] = date('c');
                $charged++;
            }
        } catch (\Stripe\Exception\CardException $e) {
            $failed++;
            log_error('Standing autopay declined', ['agreement' => $agreement['id'], 'date' => $d['date'], 'error' => $e->getMessage()]);
            send_email($agreement['contact_email'], 'Action needed — payment declined for your standing day coverage',
                "<p>We tried to charge your card on file for your {$d['date']} standing day coverage and it was declined.</p>" .
                '<p>Please log into your account to update your payment method, or reply to this email so we can resolve it before that date.</p>');
        } catch (\Exception $e) {
            $failed++;
            log_error('Standing autopay error', ['agreement' => $agreement['id'], 'date' => $d['date'], 'error' => $e->getMessage()]);
        }
    }
    unset($d);
    // apply_successful_standing_payment() already persists scheduled_dates
    // itself on success, so this is only a local mirror for step 3 below —
    // no separate write needed here.

    // ---------- 2. Prepay retry ----------
    $agreement = $refetch();
    if ($agreement['payment_plan'] === 'prepay' && !$agreement['prepay_charged']) {
        $dates = json_decode($agreement['scheduled_dates'], true) ?: [];
        $remaining = standing_cron_remaining_total($agreement, $dates);
        if ($remaining > 0.005) {
            try {
                $intent = standing_cron_charge($agreement['stripe_customer_id'], $agreement['stripe_payment_method_id'], $remaining,
                    "Coverage Chiropractic — standing day agreement {$agreement['id']} (prepay)",
                    ['standing_agreement_id' => $agreement['id'], 'purpose' => 'prepay']);
                if ($intent->status === 'succeeded') {
                    apply_successful_standing_bulk_payment($pdo, $agreement['id'], $intent->id, $remaining, $intent->latest_charge ?? null, 'prepay');
                    $charged++;
                }
            } catch (\Exception $e) {
                $failed++;
                log_error('Standing prepay retry failed', ['agreement' => $agreement['id'], 'error' => $e->getMessage()]);
                send_email($agreement['contact_email'], 'Action needed — prepay charge failed for your standing day agreement',
                    '<p>We tried to charge your card on file for your prepay standing day agreement and it failed.</p>' .
                    '<p>Please log into your account or reply to this email so we can resolve it.</p>');
            }
        }
        $pdo->prepare('UPDATE standing_agreements SET prepay_charged = 1 WHERE id = ?')->execute([$agreement['id']]);
    }

    // ---------- 3. Installment ----------
    $agreement = $refetch();
    if ($agreement['payment_plan'] === 'installment' && $agreement['installment_count']
        && (int)$agreement['installments_charged'] < (int)$agreement['installment_count']) {
        $due = !$agreement['last_installment_at'] || strtotime($agreement['last_installment_at']) <= strtotime('-30 days');
        if ($due) {
            $dates = json_decode($agreement['scheduled_dates'], true) ?: [];
            $remaining = standing_cron_remaining_total($agreement, $dates);
            $isLast = (int)$agreement['installments_charged'] + 1 >= (int)$agreement['installment_count'];
            $amount = $isLast ? $remaining : min((float)$agreement['installment_amount'], $remaining);
            if ($amount > 0.005) {
                try {
                    $intent = standing_cron_charge($agreement['stripe_customer_id'], $agreement['stripe_payment_method_id'], $amount,
                        "Coverage Chiropractic — standing day agreement {$agreement['id']} (installment)",
                        ['standing_agreement_id' => $agreement['id'], 'purpose' => 'installment']);
                    if ($intent->status === 'succeeded') {
                        apply_successful_standing_bulk_payment($pdo, $agreement['id'], $intent->id, $amount, $intent->latest_charge ?? null, 'installment');
                        $pdo->prepare('UPDATE standing_agreements SET installments_charged = installments_charged + 1, last_installment_at = ? WHERE id = ?')
                            ->execute([$today, $agreement['id']]);
                        $charged++;
                    }
                } catch (\Exception $e) {
                    $failed++;
                    log_error('Standing installment charge failed', ['agreement' => $agreement['id'], 'error' => $e->getMessage()]);
                    send_email($agreement['contact_email'], 'Action needed — installment payment failed for your standing day agreement',
                        '<p>We tried to charge your scheduled installment payment and it failed.</p>' .
                        '<p>Please log into your account or reply to this email so we can resolve it.</p>');
                }
            }
        }
    }
}

echo "Standing autopay cron complete — {$charged} charge(s) succeeded, {$failed} failed.\n";
