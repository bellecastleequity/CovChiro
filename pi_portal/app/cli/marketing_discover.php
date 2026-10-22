<?php
// Daily: add new prospects from the NPI Registry (up to the daily limit in
// Marketing settings), for the chosen specialties and states. See
// app/marketing.php. Run from cron:  php app/cli/marketing_discover.php
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../marketing.php';
$s = mkt_settings();
if (!$s['discover']) exit("Discovery is switched off in Marketing settings.\n");
$n = mkt_discover($s, $s['discover_daily']);
mkt_log(null, 'discover', "$n added");
echo "$n new prospect(s).\n";
