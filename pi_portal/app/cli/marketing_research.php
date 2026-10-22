<?php
// Every 10 minutes: research a few new prospects — website and whether
// they treat auto-accident patients (free Gemini model), then a contact
// email from their own site (low-cost OpenAI model only when needed).
// Stops for the day when the AI budgets in Marketing settings are used.
// Run from cron:  php app/cli/marketing_research.php
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../marketing.php';
$s = mkt_settings();
if (!$s['discover']) exit("Research is switched off in Marketing settings.\n");
if (mkt_secret('GEMINI_API_KEY') === '') exit("GEMINI_API_KEY isn't set.\n");
$rows = pi_db()->query("SELECT * FROM mkt_prospects WHERE status = 'new' ORDER BY id LIMIT " . (int)$s['research_per_run'])->fetchAll();
$tally = [];
foreach ($rows as $p) {
    try { $r = mkt_research($p, $s); }
    catch (Throwable $e) { mkt_set((int)$p['id'], ['status' => 'error', 'error' => mb_substr($e->getMessage(), 0, 250)]); $r = 'error'; }
    $tally[$r] = ($tally[$r] ?? 0) + 1;
    if ($r === 'ai_unavailable') break;     // daily AI budget used (or the service is down): try later
}
echo $tally ? json_encode($tally) . "\n" : "Nothing to research.\n";
