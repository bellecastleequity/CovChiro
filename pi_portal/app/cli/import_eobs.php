<?php
// Brings a practice's past auto / PIP EOBs in from scans (done for them):
//
//   php pi_portal/app/cli/import_eobs.php --practice=ID [--create-cases[=STAGE]] [--post] [--dry-run] scans/ more.pdf ...
//
//   folders     every .pdf inside (and in subfolders) is read
//   --create-cases  a patient and auto case for people on the EOBs who aren't
//               set up yet (one per name + date of loss); STAGE defaults to
//               closed (treating, tx_complete, settled and closed are allowed)
//   --post      also post them to the ledger — only when the practice's
//               ledger doesn't already have these payments
//   --dry-run   read and match everything, save nothing
//
// Like the in-app "Bring in past EOBs", they're saved as past EOBs for the
// EOB Genie report: not posted (unless --post), no coverage or case changed.
// EOBs already saved (same payer, date of service and bill number) and
// checks already saved (same payer and check number on the case) are
// skipped, so a folder can be run again after adding scans. The scans are
// read and left where they are; nothing is copied. Patient names aren't
// printed — only case numbers and initials.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../eob_store.php';

$args = array_slice($argv, 1);
$opts = []; $paths = [];
foreach ($args as $a) {
    if (preg_match('/^--([a-z\-]+)(?:=(.*))?$/', $a, $m)) $opts[$m[1]] = $m[2] ?? true;
    else $paths[] = $a;
}
if (empty($opts['practice']) || !$paths) exit("Usage: php import_eobs.php --practice=ID [--create-cases[=closed]] [--post] [--dry-run] folder-or-file.pdf ...\n");
$dry = isset($opts['dry-run']);
$post = isset($opts['post']);
$create = isset($opts['create-cases']) ? (is_string($opts['create-cases']) ? $opts['create-cases'] : 'closed') : null;
if ($create !== null && !in_array($create, ['treating', 'tx_complete', 'settled', 'closed'], true)) exit("--create-cases takes treating, tx_complete, settled or closed.\n");
$pdo = pi_db();
$ps = $pdo->prepare('SELECT * FROM practices WHERE id = ?');
$ps->execute([(int)$opts['practice']]);
if (!($practice = $ps->fetch())) exit("No practice with id {$opts['practice']}.\n");
current_practice($practice);
$user = ['id' => null, 'email' => 'import', 'name' => 'EOB import'];
echo ($dry ? '[dry run] ' : '') . "Importing past EOBs into: {$practice['name']} (id {$practice['id']})" . ($post ? ' — posting to the ledger' : ' — not posted') . "\n";

$files = [];
foreach ($paths as $p) {
    if (is_dir($p)) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($p, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) if (strtolower($f->getExtension()) === 'pdf') $files[] = $f->getPathname();
    } elseif (is_file($p)) $files[] = $p;
    else echo "  ! not found: $p\n";
}
sort($files);
if (!$files) exit("No PDF files found.\n");

$initials = fn(?string $n) => implode('', array_map(fn($w) => strtoupper($w[0] ?? '') . '.', array_filter(eob_split_name($n))));
$st = ['files' => 0, 'pages' => 0, 'eobs' => 0, 'checks' => 0, 'saved' => 0, 'savedChecks' => 0, 'posted' => 0, 'duplicates' => 0, 'created' => 0, 'unmatched' => 0, 'errors' => 0, 'skippedPages' => 0];
$created = [];   // name|date of loss → case id (one new case per person)

// The case for an EOB or check: the best match, else a new case when asked.
$caseFor = function (?string $patient, ?string $dol, ?string $claim, ?string $payer) use (&$created, $create, $dry, $user, &$st): array {
    $m = eob_match_cases(['claim' => $claim, 'patient' => $patient, 'dateOfLoss' => $dol, 'payer' => $payer]);
    if ($m && $m[0]['score'] >= 55) return [$m[0]['caseId'], $m[0]['caseNumber'], 'matched (' . $m[0]['why'] . ')'];
    if ($create === null || !$patient) return [null, null, $m ? 'not sure — best guess ' . $m[0]['caseNumber'] . ' (' . $m[0]['why'] . ')' : 'no case'];
    $key = strtolower(preg_replace('/[^a-z]/i', '', implode('', eob_split_name($patient)))) . '|' . $dol;
    if (isset($created[$key])) return [$created[$key][0], $created[$key][1], 'new case'];
    $st['created']++;
    if ($dry) { $created[$key] = [0, '(new)']; return [0, '(new)', 'new case']; }
    $c = eob_create_case($patient, $dol, $claim, $payer, $create, $user);
    $created[$key] = [$c['caseId'], $c['caseNumber']];
    return [$c['caseId'], $c['caseNumber'], 'new case'];
};

foreach ($files as $file) {
    $st['files']++;
    echo "\n" . basename($file) . "\n";
    try { $r = eob_read($file); } catch (Throwable $e) { $st['errors']++; echo "  ! couldn't read: {$e->getMessage()}\n"; continue; }
    $st['pages'] += $r['pageCount']; $st['skippedPages'] += count($r['skipped']);
    foreach ($r['eobs'] as $e) {
        $st['eobs']++;
        $h = $e['header'];
        $label = '  EOB ' . ($h['payer'] ?: 'payer?') . ' ' . ($h['dosFrom'] ?? '') . ' ' . $initials($h['patient'] ?? null) . ' p' . implode(',', $e['pages']);
        [$caseId, $caseNo, $why] = $caseFor($h['patient'] ?? null, $h['dateOfLoss'] ?? null, $h['claim'] ?? null, $h['payer'] ?? null);
        if ($caseId === null) { $st['unmatched']++; echo "$label → NOT SAVED: $why\n"; continue; }
        if ($caseId && eob_case_info($caseId, $h)['duplicateOf']) { $st['duplicates']++; echo "$label → $caseNo: already saved, skipped\n"; continue; }
        $flag = $e['confident'] ? '' : ' — check it (a total or the PIP math didn\'t reconcile)';
        if ($dry) { $st['saved']++; echo "$label → $caseNo, $why$flag\n"; continue; }
        try {
            $info = eob_case_info($caseId, $h);
            $x = eob_save(['caseId' => $caseId, 'coverageId' => $info['coverageId'], 'header' => $h, 'lines' => $e['lines'], 'totals' => $e['totals'], 'layout' => $e['layout'], 'reasons' => $e['reasons'],
                'exhausted' => $e['status'] === 'exhausted', 'post' => $post], $user, true, true);
            $st['saved']++; if ($x['posted']) $st['posted']++;
            echo "$label → $caseNo, $why" . ($x['posted'] ? ', posted' : '') . ($x['notPostedWhy'] && $post ? ' (EHR case: not posted)' : '') . "$flag\n";
        } catch (Throwable $ex) { if ($pdo->inTransaction()) $pdo->rollBack(); $st['errors']++; echo "$label → ! {$ex->getMessage()}\n"; }
    }
    foreach ($r['payments'] as $p) {
        $st['checks']++;
        $p['via'] = eob_match_firm($p['upper'] ?? '') ?? $p['via'];
        $label = '  Check ' . ($p['payer'] ?: 'payer?') . ' $' . number_format((float)$p['amount'], 2) . ' ' . $initials($p['patient'] ?? null) . ' p' . implode(',', $p['pages']);
        if (!$p['amount']) { $st['unmatched']++; echo "$label → NOT SAVED: amount not read\n"; continue; }
        [$caseId, $caseNo, $why] = $caseFor($p['patient'] ?? null, $p['dateOfLoss'] ?? null, $p['claim'] ?? null, $p['payer'] ?? null);
        if ($caseId === null) { $st['unmatched']++; echo "$label → NOT SAVED: $why\n"; continue; }
        if ($caseId && $p['checkNumber']) {
            $d = $pdo->prepare("SELECT id FROM eobs WHERE case_id = ? AND kind = 'payment' AND check_number = ? AND payer = ? AND archived_at IS NULL");
            $d->execute([$caseId, $p['checkNumber'], $p['payer'] ?: '']);
            if ($d->fetch()) { $st['duplicates']++; echo "$label → $caseNo: already saved, skipped\n"; continue; }
        }
        if ($dry) { $st['savedChecks']++; echo "$label → $caseNo, $why\n"; continue; }
        try {
            $info = eob_case_info($caseId, ['claim' => $p['claim'], 'payer' => $p['payer']]);
            $x = eob_save_payment(['caseId' => $caseId, 'coverageId' => $info['coverageId'], 'post' => $post, 'header' => ['payer' => $p['payer'], 'claim' => $p['claim'], 'checkNumber' => $p['checkNumber'],
                'checkDate' => $p['date'], 'amount' => $p['amount'], 'interest' => $p['interest'], 'fees' => $p['fees'], 'via' => $p['via'], 'viaRef' => $p['viaRef'], 'recovery' => $p['recovery']]], $user, true, true);
            $st['savedChecks']++; if ($x['posted']) $st['posted']++;
            echo "$label → $caseNo, $why" . ($x['posted'] ? ', posted' : '') . "\n";
        } catch (Throwable $ex) { if ($pdo->inTransaction()) $pdo->rollBack(); $st['errors']++; echo "$label → ! {$ex->getMessage()}\n"; }
    }
    foreach ($r['skipped'] as $s) echo "  page {$s['page']} skipped: {$s['why']}\n";
}

echo "\n" . ($dry ? '[dry run] would save' : 'Saved') . " {$st['saved']} of {$st['eobs']} EOB(s) and {$st['savedChecks']} of {$st['checks']} check(s) from {$st['files']} file(s), {$st['pages']} page(s)"
    . ($st['posted'] ? "; {$st['posted']} posted" : '') . ($st['created'] ? "; {$st['created']} new case(s)" : '') . ($st['duplicates'] ? "; {$st['duplicates']} already saved" : '')
    . ($st['unmatched'] ? "; {$st['unmatched']} not saved (no matching case" . ($create === null ? ' — run with --create-cases, or add them in the app' : '') . ')' : '')
    . ($st['skippedPages'] ? "; {$st['skippedPages']} page(s) skipped (not auto / PIP)" : '') . ($st['errors'] ? "; {$st['errors']} error(s)" : '') . ".\n";
if (!$dry) audit('eob_import', 'practice', (int)$practice['id'], null, $user, "{$st['saved']} past EOB(s), {$st['savedChecks']} check(s) from {$st['files']} file(s)" . ($st['created'] ? ", {$st['created']} new case(s)" : ''));
