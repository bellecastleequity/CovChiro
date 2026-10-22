<?php
// Daily: email practice admins as their free trial runs out, if they
// haven't subscribed. Three emails at most per practice — 3 days left,
// 1 day left, and the day after it ends — each sent once. Account details
// only, never patient information. Run from cron (setup.sh installs it):
//   php app/cli/trial_reminders.php [--dry-run]
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../mailer.php';

$dry = in_array('--dry-run', $argv, true);
if (!$dry && !mail_configured()) exit("Email isn't configured (SMTP_HOST / MAIL_FROM in secrets.php) — nothing sent.\n");
$pdo = pi_db();
$practices = $pdo->query("SELECT * FROM practices WHERE subscription_status = 'trialing' AND stripe_subscription_id IS NULL AND trial_ends_at IS NOT NULL
    AND trial_ends_at BETWEEN NOW() - INTERVAL 3 DAY AND NOW() + INTERVAL 4 DAY")->fetchAll();
$sent = 0;
foreach ($practices as $p) {
    $left = (strtotime($p['trial_ends_at']) - time()) / 86400;
    $kind = $left <= 0 ? 'trial_ended' : ($left <= 1 ? 'trial_1d' : ($left <= 3 ? 'trial_3d' : null));
    if (!$kind) continue;
    $done = $pdo->prepare('SELECT 1 FROM trial_notices WHERE practice_id = ? AND kind = ?');
    $done->execute([$p['id'], $kind]);
    if ($done->fetchColumn()) continue;
    // The ended email only right after the end, not for practices that
    // lapsed before this job existed.
    if ($kind === 'trial_ended' && $left < -2) continue;
    $admins = $pdo->prepare("SELECT email, name FROM users WHERE practice_id = ? AND role = 'admin' AND active = 1");
    $admins->execute([$p['id']]);
    [$subject, $text] = trial_email($p, $kind);
    $ok = false;
    foreach ($admins->fetchAll() as $a) {
        if ($dry) { echo "[dry run] {$a['email']}: $subject\n"; $ok = true; continue; }
        $ok = send_mail($a['email'], $subject, "Hi " . explode(' ', $a['name'])[0] . ",\n\n" . $text) || $ok;
    }
    if ($ok && !$dry) {
        $pdo->prepare('INSERT INTO trial_notices (practice_id, kind, sent_at) VALUES (?, ?, ?)')->execute([$p['id'], $kind, now_str()]);
        audit('email_' . $kind, 'practice', $p['id'], null, ['id' => null, 'email' => 'system', 'practice_id' => $p['id']]);
        $sent++;
    }
}
echo ($dry ? 'Dry run: ' : '') . "$sent practice(s) emailed.\n";

function trial_email(array $p, string $kind): array {
    $plan = plan_for($p);
    $url = APP_URL . '/app.html#/billing';
    $end = date('F j', strtotime($p['trial_ends_at']));
    $prices = implode("\n", array_map(fn($k, $v) => sprintf('  %-9s $%d/month, or $%d/year (2 months free)', $v['name'], $v['price'], $v['price'] * ANNUAL_MONTHS_CHARGED), array_keys(PLANS), PLANS));
    $keep = "If you add your card now, you keep the rest of your free trial — the first charge is on $end.";
    $after = "If the trial ends without a plan, your account becomes read-only. Nothing is deleted, and choosing a plan restores full access.";
    $lead = [
        'trial_3d' => ["Your " . BRAND_NAME . " trial ends in 3 days", "Your free trial for {$p['name']} ends on $end. To keep your team working without interruption, choose a plan:\n\n$url\n\n$keep"],
        'trial_1d' => ["Your " . BRAND_NAME . " trial ends tomorrow", "Your free trial for {$p['name']} ends tomorrow ($end). Choose a plan to keep full access:\n\n$url\n\n$keep"],
        'trial_ended' => ["Your " . BRAND_NAME . " trial has ended", "Your free trial for {$p['name']} ended on $end, so your account is read-only for now. Your cases and documents are safe. Choose a plan to pick up where you left off:\n\n$url"],
    ][$kind];
    return [$lead[0], $lead[1] . "\n\nPlans (your selection: {$plan['name']}):\n$prices\n\n" . ($kind === 'trial_ended' ? '' : "$after\n\n")
        . "Questions? Just reply, or write to " . SUPPORT_EMAIL . ".\n\n— The " . BRAND_NAME . " team\n"];
}
