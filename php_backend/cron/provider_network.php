<?php
// Provider network daily automation. Run once a day via cPanel Cron Jobs:
//   Command: /usr/bin/php /home/[USERNAME]/php_backend/cron/provider_network.php
//
// 1. Expirations — a verified credential past its expiration date becomes
//    "expired"; the provider loses shift eligibility, is told, and any
//    upcoming shifts they're assigned to are flagged for admin review
//    (never silently kept or dropped).
// 2. Renewal reminders — before a verified credential expires, at each of
//    the admin-configured thresholds (default 60/30/14/7 days), unless a
//    replacement is already under review.
// 3. Look-ahead — flags assignments that fall after a credential's expiry
//    date even before it expires.
// 4. Status refresh — recomputes every provider's lifecycle stage.
// 5. Credential follow-ups — for providers who aren't coverage-ready yet:
//    30/60/90 days after graduation (or sign-up, if later), then every 60
//    days (all configurable). The message names exactly what's missing, and
//    nothing is sent while everything is submitted and under review.
//    At most one follow-up per provider per run.
require_once __DIR__ . '/../config.php';

$settings = provider_automation_settings($pdo);
$today = date('Y-m-d');
$now = date('Y-m-d H:i:s');
$stats = ['expired' => 0, 'renewals' => 0, 'flagged' => 0, 'followups' => 0, 'refreshed' => 0];

$providerRow = function (int $uid) use ($pdo) {
    $stmt = $pdo->prepare('SELECT p.*, u.email, u.name FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?');
    $stmt->execute([$uid]);
    return $stmt->fetch();
};

// ---------- 1. expirations ----------
$expired = $pdo->prepare("SELECT * FROM provider_credentials WHERE status = 'verified' AND expiration_date < ?");
$expired->execute([$today]);
foreach ($expired->fetchAll() as $c) {
    $pdo->prepare("UPDATE provider_credentials SET status = 'expired' WHERE id = ?")->execute([$c['id']]);
    $stats['expired']++;
    $uid = (int)$c['provider_id'];
    $refresh = provider_refresh_status($pdo, $uid, true);
    $flagged = provider_flag_ineligible_assignments($pdo, $uid);
    $stats['flagged'] += count($flagged);
    $p = $providerRow($uid);
    // Only tell them if this actually leaves them without a valid one.
    if ($p && !$c['expired_notified_at'] && $refresh['credentials'][$c['type']]['status'] !== 'verified') {
        provider_email_credential_expired($pdo, $p, $c, $flagged);
        $pdo->prepare('UPDATE provider_credentials SET expired_notified_at = ? WHERE id = ?')->execute([$now, $c['id']]);
        send_admin_email('Credential expired — ' . html_entity_decode($p['name'], ENT_QUOTES, 'UTF-8'), 'Credential expired',
            email_facts(['Provider' => $p['name'] . ' (' . $p['email'] . ')', 'Credential' => PROVIDER_CREDENTIAL_LABELS[$c['type']],
                'Expired' => date('F j, Y', strtotime($c['expiration_date'])), 'Upcoming shifts flagged' => (string)count($flagged)]),
            ['kicker' => 'Credential alert']);
    }
}

// ---------- 2. renewal reminders ----------
$thresholds = $settings['renewalDays']; // largest first
$maxDays = $thresholds ? max($thresholds) : 0;
if ($maxDays > 0) {
    $stmt = $pdo->prepare("SELECT * FROM provider_credentials WHERE status = 'verified' AND expiration_date >= ? AND expiration_date <= ?");
    $stmt->execute([$today, date('Y-m-d', strtotime("+{$maxDays} days"))]);
    foreach ($stmt->fetchAll() as $c) {
        $daysLeft = (int)floor((strtotime($c['expiration_date']) - strtotime($today)) / 86400);
        $due = null;
        foreach ($thresholds as $t) if ($daysLeft <= $t) $due = $t; // smallest threshold reached
        if ($due === null || ($c['renewal_reminded_days'] !== null && (int)$c['renewal_reminded_days'] <= $due)) continue;
        // A replacement already submitted or verified — nothing to remind about.
        $newer = $pdo->prepare("SELECT COUNT(*) FROM provider_credentials WHERE provider_id = ? AND type = ? AND id <> ? AND submitted_at >= ?
            AND (status IN ('uploaded', 'pending') OR (status = 'verified' AND expiration_date > ?))" . ($c['type'] === 'license' ? ' AND (license_state = ? OR license_state IS NULL)' : ''));
        $newer->execute(array_merge([$c['provider_id'], $c['type'], $c['id'], $c['submitted_at'], $c['expiration_date']], $c['type'] === 'license' ? [$c['license_state']] : []));
        $pdo->prepare('UPDATE provider_credentials SET renewal_reminded_days = ? WHERE id = ?')->execute([$due, $c['id']]);
        if ((int)$newer->fetchColumn() > 0) continue;
        $p = $providerRow((int)$c['provider_id']);
        if ($p && provider_email_renewal_reminder($pdo, $p, $c, $daysLeft)) $stats['renewals']++;
    }
}

// ---------- 3. look-ahead on upcoming assignments ----------
$stmt = $pdo->prepare("SELECT DISTINCT provider_id FROM provider_shifts WHERE status = 'assigned' AND shift_date >= ? AND needs_review = 0 AND provider_id IS NOT NULL");
$stmt->execute([$today]);
foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $uid) {
    $stats['flagged'] += count(provider_flag_ineligible_assignments($pdo, (int)$uid));
}

// ---------- 4 + 5. refresh everyone, then follow-ups ----------
$offsets = $settings['followupDays'];
$dueDay = function (int $step) use ($offsets, $settings) {
    if ($step < count($offsets)) return $offsets[$step];
    return end($offsets) + $settings['repeatDays'] * ($step - count($offsets) + 1);
};

foreach ($pdo->query('SELECT user_id FROM providers')->fetchAll(PDO::FETCH_COLUMN) as $uid) {
    $uid = (int)$uid;
    $refresh = provider_refresh_status($pdo, $uid, true);
    $stats['refreshed']++;
    if (!$settings['enabled'] || $refresh['eligible']) continue;
    $p = $providerRow($uid);
    if (!$p || $p['followups_opt_out'] || $p['account_status'] !== 'active') continue;

    $kind = provider_followup_kind($refresh['credentials']['license'], $refresh['credentials']['malpractice']);
    if ($kind === null) continue; // everything submitted — under review, nothing to ask for

    $created = substr($p['created_at'], 0, 10);
    $anchor = ($p['graduation_date'] && $p['graduation_date'] > $created) ? $p['graduation_date'] : $created;
    $daysSince = (int)floor((strtotime($today) - strtotime($anchor)) / 86400);
    $step = (int)$p['followup_step'];
    if ($daysSince < $dueDay($step)) continue;
    if ($p['last_followup_at'] && (time() - strtotime($p['last_followup_at'])) < $settings['minGapDays'] * 86400) continue;

    if (provider_send_followup($pdo, $p, $kind, $refresh['credentials']['license'], $refresh['credentials']['malpractice'])) {
        // Skip past any steps missed while the cron was down, so a late run
        // sends one catch-up email rather than several.
        $next = $step + 1;
        while ($dueDay($next) <= $daysSince) $next++;
        $pdo->prepare('UPDATE providers SET followup_step = ?, last_followup_at = ?, last_followup_kind = ? WHERE user_id = ?')
            ->execute([$next, $now, $kind, $uid]);
        $stats['followups']++;
    } else {
        log_error('Provider follow-up email failed', ['provider' => $uid, 'kind' => $kind]);
    }
}

$pdo->prepare('INSERT INTO app_settings (name, value_json) VALUES ("provider_cron_last_ran", ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)')
    ->execute([json_encode(['at' => date('c')] + $stats)]);
log_error('Provider network cron ran', $stats);
echo 'Provider network: ' . json_encode($stats) . "\n";
