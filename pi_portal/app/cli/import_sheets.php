<?php
// One-time import of the practice's existing Google Sheets (exported as CSV):
//
//   php pi_portal/app/cli/import_sheets.php --practice=ID --ar=ar.csv --tracking=tracking.csv [--dry-run]
//
//   --ar        "CASE STATUS UPDATES - PERSONAL INJURY A/R - PIP" export
//   --tracking  "Auto Injury Case Information - Injury Tracking Sheet" export
//
// The sheets were kept by hand, so dates come in every format imaginable
// ("10/08/21", "11.09.17", "12/3/2021 TBI", "TBD"); anything that can't be
// read as a date is kept as a note instead of being guessed at. Each
// imported case gets a note saying it came from the sheet, so staff know
// to verify it. Run with --dry-run first to see what would be created.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

$opts = getopt('', ['practice:', 'ar:', 'tracking:', 'dry-run']);
if (empty($opts['practice']) || (empty($opts['ar']) && empty($opts['tracking']))) exit("Usage: php import_sheets.php --practice=ID --ar=file.csv --tracking=file.csv [--dry-run]\n");
$dry = isset($opts['dry-run']);
$pdo = pi_db();
$ps = $pdo->prepare('SELECT * FROM practices WHERE id = ?');
$ps->execute([(int)$opts['practice']]);
if (!($practiceRow = $ps->fetch())) exit("No practice with id {$opts['practice']}.\n");
current_practice($practiceRow);
echo "Importing into: {$practiceRow['name']} (id {$practiceRow['id']})\n";
$importUser = ['id' => null, 'email' => 'import'];
$stats = ['cases' => 0, 'contacts' => 0, 'coverages' => 0, 'referrals' => 0, 'ledger' => 0, 'milestones' => 0, 'skipped' => 0];

// ---------- parsing helpers ----------
// First date found anywhere in the string, as Y-m-d; null when there isn't
// a believable one.
function parse_date_loose(?string $s): ?string {
    $s = trim((string)$s);
    if ($s === '') return null;
    if (preg_match('/(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-(\d{2,4})/i', $s, $m)) {
        $t = strtotime("$m[1] $m[2] $m[3]");
        return $t ? date('Y-m-d', $t) : null;
    }
    if (!preg_match('#(\d{1,2})\s*[/.\-]+\s*(\d{1,2})\s*[/.\-]+\s*(\d{2,4})#', $s, $m)) return null;
    [$_, $mo, $d, $y] = $m;
    $y = (int)$y;
    if ($y < 100) $y += 2000;
    if ($y < 2000 || $y > 2100 || !checkdate((int)$mo, (int)$d, $y)) return null;
    return sprintf('%04d-%02d-%02d', $y, $mo, $d);
}

// Whatever follows the date ("12/3/2021 TBI" -> "TBI").
function text_after_date(string $s): ?string {
    $rest = trim(preg_replace('#^\s*\d{1,2}\s*[/.\-]+\s*\d{1,2}\s*[/.\-]+\s*\d{2,4}\s*#', '', $s), " -,");
    return $rest === '' ? null : $rest;
}

function money_cell($s): float {
    $s = trim((string)$s);
    if ($s === '' || !preg_match('/\d/', $s)) return 0.0;
    return round((float)str_replace(['$', ','], '', $s), 2);
}

function is_yes($s): bool { return (bool)preg_match('/^(y|yes|true|done|sent|uploaded)/i', trim((string)$s)); }
function is_na($s): bool { return (bool)preg_match('#^(n/?a|na)$#i', trim((string)$s)); }

function find_or_create_contact(PDO $pdo, string $type, ?string $org, ?string $name, ?string $email, bool $dry, array &$stats): ?int {
    static $cache = [];
    $org = $org ? trim($org) : null; $name = $name ? trim($name) : null;
    $email = $email ? strtolower(trim(rtrim(trim($email), '>.'), '<')) : null;
    if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) $email = null;
    if (!$org && !$name) return null;
    $key = $type . '|' . ($email ?: strtolower($org . '|' . $name));
    if (isset($cache[$key])) return $cache[$key];
    if ($email) { $s = $pdo->prepare('SELECT id FROM contacts WHERE practice_id = ? AND email = ?'); $s->execute([pid(), $email]); }
    else { $s = $pdo->prepare('SELECT id FROM contacts WHERE practice_id = ? AND type = ? AND COALESCE(organization, "") = ? AND COALESCE(name, "") = ?'); $s->execute([pid(), $type, $org ?? '', $name ?? '']); }
    if ($id = $s->fetchColumn()) return $cache[$key] = (int)$id;
    $stats['contacts']++;
    if ($dry) return $cache[$key] = -count($cache) - 1;
    $pdo->prepare('INSERT INTO contacts (practice_id, type, organization, name, email, created_at) VALUES (?,?,?,?,?,?)')->execute([pid(), $type, $org, $name, $email, now_str()]);
    return $cache[$key] = (int)$pdo->lastInsertId();
}

// Law firm from the email domain where we recognise it.
function firm_from_email(?string $email): ?string {
    if (!$email || !str_contains($email, '@')) return null;
    $domain = strtolower(trim(explode('@', $email)[1], '>. '));
    if (in_array($domain, ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'], true)) return null;
    $known = ['forthepeople.com' => 'Morgan & Morgan'];
    return $known[$domain] ?? $domain;
}

function create_case(PDO $pdo, array $patient, array $case, bool $dry, array &$stats): ?int {
    $stats['cases']++;
    if ($dry) return null;
    $now = now_str();
    $pdo->prepare('INSERT INTO patients (practice_id, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?)')->execute([pid(), $patient['first'], $patient['last'], $now, $now]);
    $pid = (int)$pdo->lastInsertId();
    $prefix = 'PI-' . date('y') . '-';
    $s = $pdo->prepare('SELECT case_number FROM cases WHERE practice_id = ? AND case_number LIKE ? ORDER BY case_number DESC LIMIT 1');
    $s->execute([pid(), $prefix . '%']);
    $last = $s->fetchColumn();
    $case += ['case_number' => $prefix . str_pad((string)(($last ? (int)substr($last, strlen($prefix)) : 0) + 1), 4, '0', STR_PAD_LEFT),
              'practice_id' => pid(), 'patient_id' => $pid, 'created_at' => $now, 'updated_at' => $now];
    if (isset($case['notes'])) { $case['notes_enc'] = enc($case['notes']); unset($case['notes']); }
    $cols = array_keys($case);
    $pdo->prepare('INSERT INTO cases (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute(array_values($case));
    return (int)$pdo->lastInsertId();
}

function add_row(PDO $pdo, string $table, array $cols, bool $dry) {
    if ($dry) return;
    foreach (['notes', 'findings'] as $f) if (array_key_exists($f, $cols)) { $cols[$f . '_enc'] = enc($cols[$f]); unset($cols[$f]); }
    $cols['created_at'] = now_str();
    if ($table === 'referrals') $cols['updated_at'] = now_str();
    $keys = array_keys($cols);
    $pdo->prepare("INSERT INTO $table (" . implode(',', $keys) . ') VALUES (' . implode(',', array_fill(0, count($keys), '?')) . ')')->execute(array_values($cols));
}

function add_milestone(PDO $pdo, ?int $caseId, string $key, ?string $date, bool $na, ?string $note, bool $dry, array &$stats) {
    $stats['milestones']++;
    if ($dry) return;
    $pdo->prepare('REPLACE INTO case_milestones (case_id, milestone, completed_on, not_applicable, note, updated_at) VALUES (?,?,?,?,?,?)')
        ->execute([$caseId, $key, $date, $na ? 1 : 0, $note ? mb_substr($note, 0, 255) : null, now_str()]);
}

function read_csv(string $path): array {
    if (!is_readable($path)) exit("Can't read $path\n");
    $rows = [];
    $fh = fopen($path, 'r');
    while (($r = fgetcsv($fh, 0, ',', '"', '')) !== false) $rows[] = $r;
    fclose($fh);
    return $rows;
}

function split_name(string $raw): array {
    $raw = trim(preg_replace('/\s+/', ' ', $raw));
    if (str_contains($raw, ',')) { [$last, $first] = array_map('trim', explode(',', $raw, 2)); return ['first' => $first ?: $last, 'last' => $first ? $last : '']; }
    $parts = explode(' ', $raw);
    $first = array_shift($parts);
    return ['first' => mb_substr($first, 0, 80), 'last' => mb_substr(implode(' ', $parts), 0, 80)];
}

if (!$dry) $pdo->beginTransaction();

// ================= A/R sheet =================
if (!empty($opts['ar'])) {
    $stageMap = ['pending in litigation' => 'litigation', 'in demand/pre-suit' => 'demand', 'mediation scheduled' => 'mediation', 'settled' => 'settled'];
    // Sheet "Benefits" column -> the insurance coverage behind the balance:
    // [coverage type, status]. LOP / blank = no insurance on file.
    $coverageMap = ['PIP' => ['pip', 'active'], 'BENEX' => ['pip', 'exhausted'], 'DENIED' => ['pip', 'denied'], 'MEDPAY' => ['medpay', 'active']];
    foreach (read_csv($opts['ar']) as $i => $r) {
        $r = array_pad($r, 23, '');
        $rawName = trim($r[1]);
        // Skips the header, blank rows, the totals row and the letter text
        // pasted under the table.
        if ($i === 0 || $rawName === '' || stripos($rawName, 'total') === 0 || mb_strlen($rawName) > 60) { if ($i > 0 && trim(implode('', $r)) !== '') $stats['skipped']++; continue; }
        $notes = ['Imported from the PI A/R sheet on ' . date('Y-m-d') . ' — verify details.'];
        $doi = null;
        // "Donika (DOA 9.19.2023)", "Lisa (2nd)"
        if (preg_match('/\(([^)]*)\)/', $rawName, $m)) {
            $doi = parse_date_loose($m[1]);
            if (!$doi) $notes[] = 'Sheet name note: ' . $m[1];
            $rawName = trim(str_replace($m[0], '', $rawName));
        }
        $name = split_name($rawName);
        $statusText = strtolower(trim($r[13]));
        $isSettled = strtolower(trim($r[7])) === 'settled' || $statusText === 'settled';
        $stage = $isSettled ? 'settled' : ($stageMap[$statusText] ?? 'tx_complete');
        $attyEmail = trim($r[15]) ?: null;
        $attyId = (trim($r[14]) || $attyEmail) ? find_or_create_contact($pdo, 'attorney', firm_from_email($attyEmail), trim($r[14]) ?: null, $attyEmail, $dry, $stats) : null;
        $insId = trim($r[11]) ? find_or_create_contact($pdo, 'insurer', trim($r[11]), null, null, $dry, $stats) : null;
        if (strtoupper(trim($r[0])) === 'TRUE') $notes[] = 'Marked "good status update" on the sheet.';
        $checkReceived = trim($r[22]);
        $case = [
            'stage' => $stage, 'injury_type' => 'auto', 'date_of_injury' => $doi,
            'attorney_contact_id' => $attyId > 0 ? $attyId : null,
            'actively_treating' => 0, 'referral_source' => $attyId ? 'attorney' : null,
            'atty_offer' => money_cell($r[16]) ?: null,
            'final_settlement' => money_cell($r[19]) ?: null,
            'date_authorized' => parse_date_loose($r[21]),
            'check_received_on' => parse_date_loose($checkReceived),
        ];
        if ($checkReceived !== '' && !$case['check_received_on']) $notes[] = 'Check received: ' . $checkReceived;
        $case['notes'] = implode("\n", $notes);
        $caseId = create_case($pdo, $name, $case, $dry, $stats);
        $cov = $coverageMap[strtoupper(trim($r[3]))] ?? null;
        // An insurance balance with no coverage named still came from PIP.
        if (!$cov && money_cell($r[6]) > 0) $cov = ['pip', strtoupper(trim($r[3])) === 'LOP' ? 'exhausted' : 'active'];
        $coverageId = null;
        if ($cov) {
            $stats['coverages']++;
            if (!$dry) {
                $pdo->prepare('INSERT INTO coverages (case_id, type, priority, carrier_contact_id, status, benefit_limit, created_at, updated_at) VALUES (?,?,1,?,?,?,?,?)')
                    ->execute([$caseId, $cov[0], $insId > 0 ? $insId : null, $cov[1], $cov[0] === 'pip' ? jurisdiction_rules(current_practice()['state'] ?? 'FL')['pip_medical'] : null, now_str(), now_str()]);
                $coverageId = (int)$pdo->lastInsertId();
            }
        }
        if (!$dry) {
            $cs = $pdo->prepare('SELECT * FROM coverages WHERE case_id = ?'); $cs->execute([$caseId]);
            $pdo->prepare('UPDATE cases SET benefits = ? WHERE id = ?')->execute([derive_benefits($cs->fetchAll(), 'auto'), $caseId]);
        }

        if ($lastVisit = parse_date_loose($r[4])) {
            add_row($pdo, 'visits', ['case_id' => $caseId, 'visit_date' => $lastVisit, 'visit_type' => 'treatment', 'notes' => 'Last visit on record (imported from A/R sheet).'], $dry);
        }
        // Opening balances, split the way the sheet split them. A settled
        // row's balance is whatever the sheet still showed as owed.
        foreach (['insurance' => money_cell($r[6]), 'patient' => money_cell($r[5])] as $bucket => $amt) {
            if ($amt <= 0) continue;
            $stats['ledger']++;
            add_row($pdo, 'ledger', ['case_id' => $caseId, 'entry_date' => $lastVisit ?? date('Y-m-d'), 'kind' => 'charge', 'bucket' => $bucket,
                'coverage_id' => $bucket === 'insurance' ? $coverageId : null, 'amount' => $amt, 'memo' => 'Opening balance imported from A/R sheet'], $dry);
        }
        if ($corr = parse_date_loose($r[10])) {
            $method = strtolower(trim($r[12])) ?: 'fax';
            add_row($pdo, 'correspondence', ['case_id' => $caseId, 'occurred_on' => $corr, 'direction' => 'out',
                'method' => in_array($method, ['fax', 'email', 'phone', 'mail'], true) ? $method : 'fax',
                'contact_id' => $attyId > 0 ? $attyId : null, 'subject' => 'Case status update request (imported)'], $dry);
        }
    }
}

// ================= Injury tracking sheet =================
if (!empty($opts['tracking'])) {
    $rows = read_csv($opts['tracking']);
    $headerIdx = null;
    foreach ($rows as $i => $r) if (isset($r[1]) && trim($r[1]) === 'DOI') { $headerIdx = $i; break; }
    if ($headerIdx === null) exit("Couldn't find the header row (the one with 'DOI') in the tracking sheet.\n");
    $oatNames = ['Back Bournemouth', 'Neck Bournemouth', 'Shoulder', 'Knee', 'Oswestry', 'HDI'];
    $priorNames = ['X-rays', 'CT', 'MRI', 'EMC', 'MD/DO', 'Neuro'];

    foreach (array_slice($rows, $headerIdx + 1, null, true) as $i => $r) {
        $r = array_pad($r, 39, '');
        if (trim(implode('', array_map(fn($v) => preg_replace('/^(FALSE|No)$/', '', trim($v)), $r))) === '') continue;
        $rowNum = $i + 1;
        $name = trim($r[0]) !== '' ? split_name($r[0]) : ['first' => '(name missing)', 'last' => 'sheet row ' . $rowNum];
        $notes = ['Imported from the Injury Tracking Sheet (row ' . $rowNum . ') on ' . date('Y-m-d') . ' — verify details.'];
        $doi = parse_date_loose($r[1]);
        if (!$doi && trim($r[1]) !== '') $notes[] = 'DOI on sheet: ' . trim($r[1]);
        $firstVisit = parse_date_loose($r[3]);
        $ref = trim($r[2]);
        $refSource = null; $refText = null;
        if (preg_match('/^(atty|attny|attorney)$/i', $ref)) $refSource = 'attorney';
        elseif (preg_match('/^self$/i', $ref)) $refSource = 'self';
        elseif ($ref !== '' && !is_na($ref)) { $refSource = 'other'; $refText = $ref; }

        $txLetter = trim($r[28]);
        $stage = (stripos($txLetter, 'still treating') !== false || $txLetter === '') ? 'treating' : 'tx_complete';
        // The sheet was rarely updated at discharge; a "still treating" case
        // that started over a year ago almost certainly isn't.
        if ($stage === 'treating' && $firstVisit && $firstVisit < date('Y-m-d', strtotime('-1 year'))) {
            $stage = 'tx_complete';
            $notes[] = 'Sheet said "' . ($txLetter ?: 'blank') . '" but care began over a year ago — moved to Treatment complete.';
        }
        $usedOats = [];
        foreach ($oatNames as $k => $label) if (strtoupper(trim($r[22 + $k])) === 'TRUE') $usedOats[] = $label;
        if ($usedOats) $notes[] = 'Outcome tools in use: ' . implode(', ', $usedOats) . (trim($r[21]) ? ' (last OATs ' . trim($r[21]) . ')' : '');
        $prior = [];
        foreach ($priorNames as $k => $label) { $v = trim($r[32 + $k]); if ($v !== '' && strcasecmp($v, 'No') !== 0) $prior[] = "$label: $v"; }
        if (trim($r[38]) !== '') $prior[] = 'Extra referrals: ' . trim($r[38]);
        if ($prior) $notes[] = 'Completed prior to care: ' . implode('; ', $prior);

        $caseId = create_case($pdo, $name, [
            'stage' => $stage, 'injury_type' => 'auto', 'date_of_injury' => $doi, 'first_visit' => $firstVisit,
            'referral_source' => $refSource, 'referred_by_text' => $refText,
            'actively_treating' => $stage === 'treating' ? 1 : 0, 'notes' => implode("\n", $notes),
        ], $dry, $stats);
        $fallbackDate = $firstVisit ?? $doi;

        // 48-hour items: Y / date / N/A.
        $simple = [4 => 'attorney_contacted', 5 => 'lor_received', 6 => 'prior_records_requested', 7 => 'prior_records_received', 8 => 'prior_imaging_requested', 9 => 'initial_adl'];
        foreach ($simple as $col => $key) {
            $v = trim($r[$col]);
            if ($v === '' || preg_match('/^(n|no|needed)$/i', $v)) continue;
            if (is_na($v)) { add_milestone($pdo, $caseId, $key, null, true, null, $dry, $stats); continue; }
            $d = parse_date_loose($v);
            if ($d || is_yes($v)) add_milestone($pdo, $caseId, $key, $d ?? $fallbackDate, false, $d ? null : 'Date not recorded on sheet', $dry, $stats);
            elseif ($col === 6 || $col === 7) add_milestone($pdo, $caseId, $key, $fallbackDate, false, mb_substr($v, 0, 200), $dry, $stats); // e.g. "Bayfront"
        }
        if (stripos($r[10], 'uploaded') !== false) add_milestone($pdo, $caseId, 'adl_entered', parse_date_loose($r[11]) ?? $fallbackDate, false, null, $dry, $stats);

        // Referrals: MRI (12-14), EMC (15-17), consult (18-20, only when it
        // differs from the EMC columns — the sheet often copies them).
        $mkReferral = function (string $type, string $orderCell, string $doneCell, string $reportCell) use ($pdo, $caseId, $dry, &$stats) {
            $orderCell = trim($orderCell); $doneCell = trim($doneCell);
            if (($orderCell === '' || is_na($orderCell) || $orderCell === 'X') && ($doneCell === '' || is_na($doneCell))) return;
            $ordered = parse_date_loose($orderCell);
            $completed = parse_date_loose($doneCell);
            $facility = $ordered ? text_after_date($orderCell) : ($orderCell ?: null);
            $uploaded = stripos($reportCell, 'uploaded') !== false;
            $dropped = preg_match('/dropped|no show|no showed|can\'t reach/i', $doneCell);
            $status = $dropped ? 'no_show' : ($uploaded ? 'report_received' : ($completed ? 'completed' : 'ordered'));
            if ($type === 'consult') {
                $f = strtolower((string)$facility);
                $type = str_contains($f, 'neuro') ? 'neuro' : (preg_match('/pain|fpm|waypoint|alleviate|phy med/', $f) ? 'pain_mgmt' : 'ortho');
            }
            $stats['referrals']++;
            add_row($pdo, 'referrals', [
                'case_id' => $caseId, 'direction' => 'out', 'type' => $type, 'facility_text' => $facility ? mb_substr($facility, 0, 160) : null,
                'status' => $status, 'ordered_on' => $ordered, 'completed_on' => $completed,
                'report_received_on' => $uploaded ? ($completed ?? $ordered) : null, 'entered_in_chart' => stripos($reportCell, 'entered') !== false ? 1 : 0,
                'notes' => 'Imported. Sheet: "' . mb_substr($orderCell . ' | ' . $doneCell . ' | ' . trim($reportCell), 0, 300) . '"',
            ], $dry);
        };
        $mkReferral('mri', $r[12], $r[13], $r[14]);
        $mkReferral('emc', $r[15], $r[16], $r[17]);
        if (trim($r[18]) !== trim($r[15]) || trim($r[19]) !== trim($r[16])) $mkReferral('consult', $r[18], $r[19], $r[20]);

        // Discharge items.
        if (preg_match('/sent letter|sent case status/i', $txLetter)) add_milestone($pdo, $caseId, 'tx_complete_letter', $fallbackDate, false, 'Date not recorded on sheet', $dry, $stats);
        if (stripos($r[29], 'sent') !== false) add_milestone($pdo, $caseId, 'final_narrative', $fallbackDate, false, 'Date not recorded on sheet', $dry, $stats);
        $rr = trim($r[30]);
        if (stripos($rr, 'fulfilled') !== false) add_milestone($pdo, $caseId, 'records_request', $fallbackDate, false, $rr, $dry, $stats);
        elseif ($rr !== '') add_milestone($pdo, $caseId, 'records_request', null, false, $rr, $dry, $stats);
        if (is_yes($r[31])) add_milestone($pdo, $caseId, 'final_adl', $fallbackDate, false, 'Date not recorded on sheet', $dry, $stats);
    }
}

if (!$dry) {
    $pdo->commit();
    audit('import', 'sheets', null, null, $importUser, json_encode($stats));
}
echo ($dry ? "DRY RUN — nothing written.\n" : "Import complete.\n");
foreach ($stats as $k => $v) echo str_pad($k, 12) . $v . "\n";
