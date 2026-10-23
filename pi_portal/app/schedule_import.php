<?php
// Daily appointment list upload (Gold plan and up): the front desk exports
// yesterday's appointments from any EHR — a spreadsheet (CSV / Excel) or a
// PDF report — and the attended visits and no-shows are logged on the
// matching injury cases, so gaps in care, treatment-plan adherence, the
// no-show and outreach steps all stay current without an EHR connection.
//
// Works with any EHR's layout because it doesn't depend on one: each row
// (or PDF line) is matched to the practice's open-case patients by name
// (date of birth breaks ties), then the appointment date and status are
// read from the row — from named columns when the spreadsheet has them,
// otherwise from the text itself. Status words are recognised from a broad
// built-in list; any wording an EHR uses that isn't in it is mapped once
// and remembered. Rows that match no open injury case (the clinic's other
// patients) are ignored. Nothing is saved until the preview is applied.

require_once __DIR__ . '/ehr/spreadsheet.php';

const SCHED_OUTCOMES = ['attended' => 'Kept / seen', 'no_show' => 'No-show', 'late_cancel' => 'Late cancellation', 'cancelled' => 'Cancelled / rescheduled', 'scheduled' => 'Scheduled (no outcome yet)', 'ignore' => 'Not an appointment status'];
const SCHED_SETTINGS_DEFAULTS = ['cancel_counts' => 'late', 'unknown_as' => 'ask', 'multi_case' => 'ask', 'status_map' => []];
const SCHED_MAX_ROWS = 5000;

// Built-in status wording, most specific first (a "late cancel" is not a
// plain "cancel"; "no show" must win over "show").
const SCHED_STATUS_WORDS = [
    'late_cancel' => ['late cancel', 'late cancellation', 'late cx', 'late cxl', 'lc', 'same day cancel', 'same-day cancel', 'cancelled late', 'canceled late'],
    'no_show' => ['no show', 'no-show', 'noshow', 'no shows', 'n/s', 'ns', 'missed', 'missed appointment', 'did not show', 'did not arrive', 'dna', 'fta', 'failed', 'failed appointment', 'no call no show', 'ncns'],
    'cancelled' => ['cancelled', 'canceled', 'cancel', 'cancellation', 'cx', 'cxl', 'rescheduled', 'resched', 'reschedule', 'moved', 'bumped', 'deleted'],
    'attended' => ['checked out', 'check out', 'checked-out', 'checkout', 'checked in', 'check in', 'checked-in', 'arrived', 'completed', 'complete', 'seen', 'kept', 'done', 'in room', 'in treatment', 'with provider', 'ready for checkout', 'billed', 'visit complete', 'attended', 'present', 'showed', 'show'],
    'scheduled' => ['scheduled', 'confirmed', 'unconfirmed', 'booked', 'pending', 'reminder sent', 'left message', 'not confirmed', 'tentative', 'open', 'requested'],
];

const SCHED_COLS = [
    'name' => ['Patient name', ['patient', 'patientname', 'name', 'patientfullname', 'fullname', 'client', 'clientname', 'ptname', 'patientlastfirst', 'lastfirst', 'patientnamelastfirst']],
    'last' => ['Last name', ['lastname', 'last', 'lname', 'patientlastname', 'surname', 'familyname', 'patientlast']],
    'first' => ['First name', ['firstname', 'first', 'fname', 'patientfirstname', 'givenname', 'patientfirst']],
    'chart' => ['Chart / account #', ['chart', 'chartno', 'chartnumber', 'chartid', 'account', 'accountno', 'accountnumber', 'acct', 'acctno', 'acctnumber', 'mrn', 'medicalrecordnumber', 'patientid', 'patientnumber', 'patientno', 'ptid', 'ptno', 'recordnumber', 'recordno', 'patientaccount', 'patientacct', 'id']],
    'dob' => ['Date of birth', ['dob', 'dateofbirth', 'birthdate', 'patientdob', 'birthday', 'birth']],
    'case' => ['Case / injury', ['case', 'casename', 'casetype', 'caselabel', 'casenumber', 'caseno', 'injury', 'injurydate', 'doi', 'dateofinjury', 'accident', 'accidentdate', 'billingcase', 'episode', 'casedescription']],
    'date' => ['Appointment date', ['date', 'appointmentdate', 'apptdate', 'appointment', 'appt', 'startdate', 'start', 'scheduleddate', 'dateofservice', 'dos', 'visitdate', 'servicedate', 'appointmentdatetime', 'datetime', 'when', 'day', 'startdatetime', 'appointmentstart']],
    'status' => ['Status', ['status', 'appointmentstatus', 'apptstatus', 'visitstatus', 'state', 'checkinstatus', 'arrivalstatus', 'appointmentstate', 'outcome', 'flowstatus', 'apptstate', 'confirmationstatus', 'attendance']],
    'provider' => ['Provider', ['provider', 'doctor', 'practitioner', 'resource', 'staff', 'renderingprovider', 'clinician', 'therapist', 'physician', 'dr']],
];

function sched_settings(?array $practice = null): array {
    $p = $practice ?? current_practice();
    $saved = $p && !empty($p['schedule_settings']) ? (json_decode($p['schedule_settings'], true) ?: []) : [];
    $s = array_merge(SCHED_SETTINGS_DEFAULTS, array_intersect_key($saved, SCHED_SETTINGS_DEFAULTS));
    if (!in_array($s['cancel_counts'], ['none', 'late', 'all'], true)) $s['cancel_counts'] = 'late';
    if (!in_array($s['unknown_as'], ['ask', 'attended', 'skip'], true)) $s['unknown_as'] = 'ask';
    if (!in_array($s['multi_case'], ['ask', 'all', 'newest'], true)) $s['multi_case'] = 'ask';
    $s['status_map'] = array_filter((array)$s['status_map'], fn($v) => isset(SCHED_OUTCOMES[$v]));
    return $s;
}

// Lowercase ASCII words, for comparing names and status text.
function sched_words(string $s): array {
    $a = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
    $a = strtolower($a === false ? $s : $a);
    return array_values(array_filter(preg_split('/[^a-z]+/', $a)));
}

function sched_norm_status(string $s): string { return trim(preg_replace('/\s+/', ' ', strtolower(preg_replace('/[^A-Za-z\/\- ]+/', ' ', $s)))); }

// The outcome a piece of status text means, or null. $whole: the text is a
// status cell (match the whole value, then any phrase in it); otherwise
// it's a free-text line and only multi-letter phrases count (so a stray
// "NS" or "LC" in a name doesn't).
function sched_status(string $text, array $custom, bool $whole): ?string {
    $n = sched_norm_status($text);
    if ($n === '') return null;
    if ($whole && isset($custom[$n])) return $custom[$n];
    foreach ($custom as $w => $o) if (strlen($w) >= 3 && preg_match('/(^|[^a-z])' . preg_quote($w, '/') . '($|[^a-z])/', $n)) return $o;
    foreach (SCHED_STATUS_WORDS as $o => $words) {
        foreach ($words as $w) {
            if (!$whole && (strlen(str_replace(['/', '-', ' '], '', $w)) <= 2 || in_array($w, ['show', 'open', 'moved', 'present', 'done', 'seen', 'start'], true))) continue;
            if ($whole && $n === $w) return $o;
            if (preg_match('/(^|[^a-z])' . preg_quote($w, '/') . '($|[^a-z])/', $n)) return $o;
        }
    }
    return null;
}

// Every date written in a piece of text (as Y-m-d), in order. Dates with no
// year take $year.
function sched_dates(string $text, int $year): array {
    $out = [];
    if (preg_match_all('#\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b|\b(\d{1,2})/(\d{1,2})\b(?![/.\d])|\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?![\d:])(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?#i', $text, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) {
            if (!empty($x[1])) [$y, $mo, $d] = [(int)$x[1], (int)$x[2], (int)$x[3]];
            elseif (!empty($x[4])) { [$mo, $d, $y] = [(int)$x[4], (int)$x[5], (int)$x[6]]; if ($y < 100) $y += $y > 69 ? 1900 : 2000; }
            elseif (!empty($x[7])) [$mo, $d, $y] = [(int)$x[7], (int)$x[8], $year];
            else { $mo = (int)date('n', strtotime($x[9] . ' 1 2000')); $d = (int)$x[10]; $y = !empty($x[11]) ? (int)$x[11] : $year; }
            if (checkdate($mo, $d, $y)) $out[] = sprintf('%04d-%02d-%02d', $y, $mo, $d);
        }
    }
    return $out;
}

// The practice's open injury cases, indexed for matching. A team member
// limited to some locations only sees those locations' cases. One entry per
// case; a patient with several open cases has several entries.
function sched_patient_index(int $practiceId): array {
    [$locSql, $locArgs] = loc_in('c.location_id');
    $sql = "SELECT c.id case_id, c.case_number, c.ehr_case_label, c.injury_type, c.date_of_injury, c.first_visit, c.location_id, p.id patient_id, p.first_name, p.last_name, p.chart_number, p.dob_enc
        FROM cases c JOIN patients p ON p.id = c.patient_id
        WHERE c.practice_id = ? AND c.archived_at IS NULL AND c.stage IN ('" . implode("','", OPEN_STAGES) . "')" . $locSql . ' ORDER BY c.date_of_injury DESC, c.id DESC';
    $s = pi_db()->prepare($sql);
    $s->execute(array_merge([$practiceId], $locArgs));
    $out = [];
    foreach ($s->fetchAll() as $r) {
        $f = sched_words($r['first_name']); $l = sched_words($r['last_name']);
        if (!$f || !$l) continue;
        $out[] = ['case_id' => (int)$r['case_id'], 'case_number' => $r['case_number'], 'label' => $r['ehr_case_label'], 'type' => $r['injury_type'], 'doi' => $r['date_of_injury'],
            'patient_id' => (int)$r['patient_id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'chart' => sched_chart($r['chart_number']),
            'first' => $f, 'last' => $l, 'dob' => date_or_null(dec($r['dob_enc']))];
    }
    return $out;
}

function sched_chart(?string $v): ?string { return chart_norm($v); }

// Whether $words (a row or a name cell) names this patient. In a name cell
// every part of the name must appear (in any order, nothing much else);
// in free text the name must appear as "First [M] Last" or "Last First [M]".
function sched_name_hit(array $words, array $pt, bool $cell): bool {
    if ($cell) {
        if (count($words) > count($pt['first']) + count($pt['last']) + 2) return false;
        return !array_diff($pt['first'], $words) && !array_diff($pt['last'], $words);
    }
    $n = count($words); $f = $pt['first']; $l = $pt['last'];
    $at = function (array $seq, int $i) use ($words): bool { foreach ($seq as $k => $w) if (($words[$i + $k] ?? null) !== $w) return false; return true; };
    for ($i = 0; $i < $n; $i++) {
        if ($at($l, $i) && $at($f, $i + count($l))) return true;
        if ($at($f, $i)) {
            $j = $i + count($f);
            if ($at($l, $j)) return true;
            if (strlen($words[$j] ?? '') === 1 && $at($l, $j + 1)) return true;   // middle initial
        }
    }
    return false;
}

// The open cases a row belongs to (all of one patient's), and how the
// patient was recognised. The chart number decides when the file has one;
// otherwise the name, with date of birth or a chart number in the text
// telling apart two people with the same name.
function sched_match(array $index, array $r, array $rowDates): array {
    $chart = sched_chart($r['chart'] ?? null);
    if ($chart !== null) {
        $hits = array_values(array_filter($index, fn($pt) => $pt['chart'] === $chart));
        if ($hits) return [$hits, 'chart'];
    }
    $words = sched_words($r['name'] ?? $r['text']);
    if (!$words) return [[], null];
    $hits = array_values(array_filter($index, fn($pt) => sched_name_hit($words, $pt, $r['name'] !== null)));
    $how = 'name';
    if (count(array_unique(array_column($hits, 'patient_id'))) > 1) {
        $byDob = array_values(array_filter($hits, fn($pt) => $pt['dob'] && in_array($pt['dob'], $rowDates, true)));
        $tokens = array_map('sched_chart', preg_split('/[^A-Za-z0-9-]+/', $r['text']));
        $byChart = array_values(array_filter($hits, fn($pt) => $pt['chart'] && in_array($pt['chart'], $tokens, true)));
        if ($byDob) { $hits = $byDob; $how = 'name + date of birth'; }
        elseif ($byChart) { $hits = $byChart; $how = 'name + chart #'; }
        // Prefer the longest name (Mary Ann Smith over Ann Smith).
        $len = max(array_map(fn($pt) => count($pt['first']) + count($pt['last']), $hits));
        $hits = array_values(array_filter($hits, fn($pt) => count($pt['first']) + count($pt['last']) === $len));
    }
    return [$hits, $how];
}

// Which of a patient's open cases a row is for: one named in the row (our
// case #, the EHR's case name, or the date of injury), else the practice's
// rule — every open case, the newest, or ask. Returns [case_id|'all'|null, why].
function sched_pick_case(array $cases, array $r, array $rowDates, string $rule): array {
    if (count($cases) === 1) return [$cases[0]['case_id'], null];
    $hay = strtolower(($r['case'] ?? '') . ' ' . $r['text']);
    foreach ($cases as $c) if (str_contains(preg_replace('/[^a-z0-9]/', '', $hay), preg_replace('/[^a-z0-9]/', '', strtolower($c['case_number'])))) return [$c['case_id'], 'case # in the file'];
    $flat = preg_replace('/[^a-z0-9]/', '', $hay);
    foreach ($cases as $c) if ($c['label'] && strlen($l = preg_replace('/[^a-z0-9]/', '', strtolower($c['label']))) >= 3 && str_contains($flat, $l)) return [$c['case_id'], 'EHR case name'];
    $caseDates = array_merge($rowDates, ($r['case'] ?? '') !== '' ? array_filter([sheet_date($r['case'])]) : []);
    foreach ($cases as $c) if ($c['doi'] && in_array($c['doi'], $caseDates, true)) return [$c['case_id'], 'date of injury'];
    if ($rule === 'all') return ['all', null];
    if ($rule === 'newest') return [$cases[0]['case_id'], null];
    return [null, null];
}

// ---------- reading the file into rows ----------

// Spreadsheet: the header row (if any) and which column holds what.
function sched_sheet_columns(array $rows, ?array $saved = null): array {
    $best = null; $bestScore = 1;
    foreach (array_slice($rows, 0, 30, true) as $i => $r) {
        $score = 0;
        foreach ($r as $c) { $n = sheet_norm($c); if ($n === '') continue; foreach (SCHED_COLS as [, $syn]) if (in_array($n, $syn, true)) { $score++; break; } }
        if ($score > $bestScore) { $best = $i; $bestScore = $score; }
    }
    if ($saved) return ['header' => $saved['header'], 'cols' => $saved['cols']];
    if ($best === null) return ['header' => null, 'cols' => []];
    $norm = array_map('sheet_norm', $rows[$best]);
    $cols = []; $taken = [];
    // Exact heading names first, for every field; then headings that
    // contain a known name ("Patient Appt Date"), so "Last Name" isn't
    // mistaken for the full-name column.
    foreach (SCHED_COLS as $f => [, $syn]) {
        foreach ($syn as $w) { $i = array_search($w, $norm, true); if ($i !== false && !in_array($i, $taken, true)) { $cols[$f] = $i; $taken[] = $i; break; } }
    }
    foreach (SCHED_COLS as $f => [, $syn]) {
        if (isset($cols[$f])) continue;
        foreach ($norm as $i => $n) {
            if (in_array($i, $taken, true) || $n === '') continue;
            if ($f === 'date' && str_contains($n, 'birth')) continue;
            if ($f === 'name' && preg_match('/first|last|given|family|sur|provider|doctor|staff|user/', $n)) continue;
            foreach ($syn as $w) if (strlen($w) >= 4 && str_contains($n, $w)) { $cols[$f] = $i; $taken[] = $i; break 2; }
        }
    }
    // A full-name column wins over separate first / last ones only if
    // there's no last-name column.
    if (isset($cols['name'], $cols['last'])) unset($cols['name']);
    return ['header' => $best, 'cols' => $cols];
}

// Rows of a spreadsheet as [text, cells] with mapped values pulled out.
function sched_rows_from_sheet(array $rows, array $layout): array {
    $out = [];
    $cols = $layout['cols'];
    foreach ($rows as $i => $r) {
        if ($layout['header'] !== null && $i <= $layout['header']) continue;
        $get = fn($f) => isset($cols[$f]) ? trim((string)($r[$cols[$f]] ?? '')) : null;
        $name = $get('name');
        if ($name === null && ($get('first') !== null || $get('last') !== null)) $name = trim($get('first') . ' ' . $get('last'));
        $out[] = ['line' => $i + 1, 'text' => implode(' | ', array_filter($r, fn($c) => $c !== '')), 'name' => $name, 'date' => $get('date'), 'status' => $get('status'), 'dob' => $get('dob'), 'provider' => $get('provider'), 'chart' => $get('chart'), 'case' => $get('case')];
    }
    return $out;
}

function sched_pdf_text(string $path): string {
    $out = tempnam(sys_get_temp_dir(), 'pi');
    exec('pdftotext -layout ' . escapeshellarg($path) . ' ' . escapeshellarg($out) . ' 2>/dev/null', $o, $code);
    $text = (string)@file_get_contents($out);
    @unlink($out);
    if ($code !== 0) throw new RuntimeException("Couldn't read this PDF. Export the appointment list again, or as a spreadsheet (CSV or Excel).");
    if (trim(preg_replace('/\s+/', '', $text)) === '') throw new RuntimeException('This PDF is a scanned image, so there is no text to read. Export the appointment list from your EHR as a PDF report or a spreadsheet instead of scanning or printing it.');
    return $text;
}

function sched_rows_from_pdf(string $text): array {
    $out = [];
    foreach (preg_split('/\R/', $text) as $i => $line) {
        if (trim($line) === '') continue;
        $out[] = ['line' => $i + 1, 'text' => trim(preg_replace('/\s{2,}/', '  ', $line)), 'name' => null, 'date' => null, 'status' => null, 'dob' => null, 'provider' => null, 'chart' => null, 'case' => null];
    }
    return $out;
}

// ---------- building the preview ----------

// $rows from either reader; $fallbackDate is used for rows with no date of
// their own (most daily reports put the date once, at the top).
function sched_analyze(array $rows, array $index, string $fallbackDate, array $settings, PDO $pdo): array {
    $today = date('Y-m-d');
    $year = (int)substr($fallbackDate, 0, 4);
    $lo = add_days($today, -120); $hi = add_days($today, 60);
    $inRange = fn($d) => $d >= $lo && $d <= $hi;
    $custom = $settings['status_map'];
    $current = null;           // a date heading seen above (PDF reports grouped by day)
    $matched = []; $unmatched = []; $unknownWords = []; $dateFromFile = false;
    foreach (array_slice($rows, 0, SCHED_MAX_ROWS) as $r) {
        $rowDates = sched_dates($r['text'], $year);
        [$hits, $how] = sched_match($index, $r, array_merge($rowDates, $r['dob'] ? [sheet_date($r['dob'])] : []));
        if (!$hits) {
            $st = $r['status'] !== null && $r['status'] !== '' ? sched_status($r['status'], $custom, true) : sched_status($r['text'], $custom, false);
            // A line with a date but no patient: a date heading for the lines below.
            if ($r['name'] === null && ($d = array_values(array_filter($rowDates, $inRange))) && !$st) { $current = $d[0]; continue; }
            // Appointment rows for patients without an open injury case are
            // listed (so one can be linked by hand) but never saved.
            if (($r['name'] !== null && trim($r['name']) !== '') || ($r['name'] === null && $st)) {
                $d = $r['date'] ? sheet_date($r['date']) : (array_values(array_filter($rowDates, $inRange))[0] ?? null);
                $unmatched[] = ['line' => $r['line'], 'text' => mb_substr($r['name'] ?? $r['text'], 0, 120), 'date' => $d ?: ($current ?: $fallbackDate), 'outcome' => $st ?: 'unknown', 'raw' => $r['status'] ?? sched_status_phrase($r['text'])];
            }
            continue;
        }
        $pt = $hits[0];
        // Appointment date: its column, else a date in the row that isn't the
        // patient's birthday, else the date heading above, else the fallback.
        $date = $r['date'] !== null ? sheet_date($r['date']) : null;
        $dois = array_column($hits, 'doi');
        if (!$date) { $cand = array_values(array_filter($rowDates, fn($d) => $d !== $pt['dob'] && !in_array($d, $dois, true) && $inRange($d))); $date = $cand[0] ?? null; }
        if ($date || $current) $dateFromFile = true;
        $date = $date ?: ($current ?: $fallbackDate);
        // Status: its column, else words in the row.
        $raw = $r['status'] ?? null;
        $outcome = $raw !== null && $raw !== '' ? sched_status($raw, $custom, true) : sched_status($r['text'], $custom, false);
        if ($raw !== null && $raw !== '' && !$outcome) $unknownWords[sched_norm_status($raw)] = ($unknownWords[sched_norm_status($raw)] ?? 0) + 1;
        // Two people with the same name the row can't tell apart: keep the
        // first, flagged, with the others offered as cases to choose from.
        $ambiguous = count(array_unique(array_column($hits, 'patient_id'))) > 1;
        $mine = $ambiguous ? $hits : array_values(array_filter($hits, fn($h) => $h['patient_id'] === $pt['patient_id']));
        [$caseId, $caseWhy] = $ambiguous ? [null, null] : sched_pick_case($mine, $r, $rowDates, $settings['multi_case']);
        $matched[] = ['line' => $r['line'], 'patient' => $pt['name'], 'patient_id' => $pt['patient_id'], 'matchedBy' => $how, 'chartInFile' => $r['chart'] ?? null,
            'cases' => array_map(fn($h) => ['id' => $h['case_id'], 'number' => $h['case_number'], 'label' => $h['label'], 'type' => $h['type'], 'doi' => $h['doi'], 'patient' => $h['name']], $mine),
            'case_id' => $caseId, 'caseWhy' => $caseWhy, 'date' => $date, 'raw' => $raw ?? sched_status_phrase($r['text']), 'outcome' => $outcome ?: 'unknown', 'ambiguous' => $ambiguous,
            'text' => mb_substr($r['text'], 0, 160), 'action' => sched_default_action($outcome ?: 'unknown', $date, $settings, $today)];
    }
    foreach ($matched as &$m) $m['why'] = sched_why($m, $settings, $today);
    unset($m);
    return ['rows' => $matched, 'unmatched' => array_slice($unmatched, 0, 300), 'unmatchedCount' => count($unmatched), 'unknownStatuses' => $unknownWords, 'dateFromFile' => $dateFromFile, 'truncated' => count($rows) > SCHED_MAX_ROWS];
}

// A short status phrase found in a free-text line, for display.
function sched_status_phrase(string $text): ?string {
    $n = sched_norm_status($text);
    foreach (SCHED_STATUS_WORDS as $words) foreach ($words as $w) if (strlen($w) > 2 && preg_match('/(^|[^a-z])' . preg_quote($w, '/') . '($|[^a-z])/', $n)) return $w;
    return null;
}

function sched_default_action(string $outcome, string $date, array $settings, string $today): string {
    if ($date > $today) return 'skip';
    switch ($outcome) {
        case 'attended': return 'visit';
        case 'no_show': return 'no_show';
        case 'late_cancel': return in_array($settings['cancel_counts'], ['late', 'all'], true) ? 'no_show' : 'skip';
        case 'cancelled': return $settings['cancel_counts'] === 'all' ? 'no_show' : 'skip';
        case 'unknown': return $settings['unknown_as'] === 'attended' ? 'visit' : ($settings['unknown_as'] === 'skip' ? 'skip' : 'ask');
        default: return 'skip';
    }
}

function sched_why(array $m, array $settings, string $today): ?string {
    if ($m['date'] > $today) return 'Upcoming appointment';
    if ($m['action'] === 'ask') return 'No status in the file — choose';
    if ($m['action'] !== 'skip') return null;
    return ['cancelled' => 'Cancellation (not counted as missed)', 'late_cancel' => 'Late cancellation (not counted as missed)', 'scheduled' => 'No outcome yet', 'ignore' => 'Not an appointment', 'unknown' => 'No status in the file'][$m['outcome']] ?? null;
}

// ---------- the import plan ----------

// What an upload will do, row by row, with the clinic's choices from the
// preview applied: for each row its action, the case(s) it goes on and the
// ones actually written (a date already logged on a case is skipped).
// $choices: {line: {action, case_id}} — case_id a case id or "all"; for a
// row that matched no case, a case id links it.
function sched_plan(array $pv, array $choices, PDO $pdo): array {
    $today = date('Y-m-d');
    $open = array_column($pv['openCases'], null, 'id');
    $entries = [];
    foreach ($pv['rows'] as $r) {
        $c = (array)($choices[$r['line']] ?? []);
        $r['action'] = $c['action'] ?? $r['action'];
        if (array_key_exists('case_id', $c)) $r['case_id'] = $c['case_id'] === 'all' ? 'all' : ($c['case_id'] === null || $c['case_id'] === '' ? null : (int)$c['case_id']);
        if (is_int($r['case_id']) && !in_array($r['case_id'], array_column($r['cases'], 'id'), true)) throw new RuntimeException('A chosen case doesn\'t belong to that patient.');
        $entries[] = $r;
    }
    foreach ($pv['unmatched'] as $u) {
        $c = (array)($choices[$u['line']] ?? []);
        if (empty($c['case_id']) || !isset($open[(int)$c['case_id']])) continue;
        $o = $open[(int)$c['case_id']];
        $entries[] = $u + ['patient' => $o['patient'], 'patient_id' => $o['patientId'], 'matchedBy' => 'linked by hand', 'cases' => [['id' => $o['id'], 'number' => $o['number'], 'label' => $o['caseLabel'], 'type' => $o['type'], 'doi' => $o['doi']]],
            'case_id' => $o['id'], 'action' => $c['action'] ?? sched_default_action($u['outcome'], $u['date'], $pv['settings'], $today), 'linked' => true, 'why' => null];
    }
    $ids = array_values(array_unique(array_merge(...array_map(fn($e) => array_column($e['cases'], 'id'), $entries ?: [['cases' => []]]))));
    $have = [];
    if ($ids) {
        $s = $pdo->prepare('SELECT case_id, visit_date FROM visits WHERE archived_at IS NULL AND case_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
        $s->execute($ids);
        foreach ($s as $v) $have[$v['case_id'] . '|' . $v['visit_date']] = true;
    }
    foreach ($entries as &$e) {
        $e['needs'] = $e['action'] === 'ask' ? 'status' : (in_array($e['action'], ['visit', 'no_show'], true) && $e['case_id'] === null ? 'case' : null);
        $e['targets'] = [];
        if ($e['needs'] || !in_array($e['action'], ['visit', 'no_show'], true)) continue;
        if ($e['date'] > $today) { $e['action'] = 'skip'; $e['why'] = 'Upcoming appointment'; continue; }
        foreach ($e['case_id'] === 'all' ? array_column($e['cases'], 'id') : [$e['case_id']] as $cid) {
            if (isset($have[$cid . '|' . $e['date']])) continue;
            $have[$cid . '|' . $e['date']] = true;
            $e['targets'][] = $cid;
        }
        if (!$e['targets']) { $e['action'] = 'skip'; $e['why'] = 'Already logged for this date'; }
    }
    unset($e);
    return $entries;
}
