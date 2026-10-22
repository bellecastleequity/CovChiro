<?php
// Every 5 minutes: send due outreach emails (through SendGrid) — only
// inside the send window in each prospect's own time zone (8am–noon by
// default, weekdays), up to today's cap (warming up from the first
// sending day). Anything not sent by the end of the window waits for the
// next day's. See app/marketing.php. Run from cron:
//   php app/cli/marketing_send.php
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../marketing.php';
$s = mkt_settings();
if ($why = mkt_send_blocker($s)) exit("$why\n");
// A steady trickle (about 12 a run) reads as normal mail to inbox providers.
[$sent, $failed, $waiting] = mkt_send_due($s, 12);
echo "$sent sent, $failed failed, $waiting waiting for their send window.\n";
