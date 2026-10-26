<?php
// Auto / PIP insurance EOB reader. A clinic scans the day's insurance mail
// (one EOB or a whole batch in one PDF) and uploads it; this turns it into
// structured EOBs — payer, claim, dates, service lines, totals and the
// check — for the review screen. Nothing is saved here.
//
// Reading the page: scanners often embed a text layer, but theirs drops
// whole lines and misreads digits, so each page is read by OCR when an OCR
// engine is configured (tesseract on the server, or Amazon Textract, which
// is HIPAA-eligible under the AWS BAA), falling back to the scanner's text.
//
// Auto / PIP EOBs come in a few families, each read by the column headings
// it prints, not by fixed positions:
//   * "Explanation of Review / Reimbursement" (bill-review vendors such as
//     Auto Injury Solutions) — GEICO, USAA and others
//   * "Explanation of Benefits — This is not a bill" with Amount Charged /
//     Deductible Applied / Remaining Balance / Amount Allowed — MetLife
//     (now Farmers), AAA, Progressive and others
//   * Travelers' label-per-line layout (SERVICE DATE / PROC CD / AMT
//     CHARGED / AMT ALLOWED), which prints the 80% payable amount
// Anything else is read generically from its column headings. Commercial,
// Medicare and attorney paperwork in a batch is recognised and skipped.
// Every result goes through checks (line totals, the 80% PIP payment) and a
// person confirms it before anything is posted.

const EOB_MAX_PAGES = 60;
const EOB_PIP_RATE = 0.80;

// Auto carriers that write Florida PIP (and other no-fault states).
const EOB_AUTO_PAYERS = [
    'GEICO' => 'GEICO', 'USAA' => 'USAA', 'PROGRESSIVE' => 'Progressive', 'METLIFE' => 'MetLife Auto & Home', 'METROPOLITAN PROPERTY' => 'MetLife Auto & Home',
    'TRAVELERS' => 'Travelers', 'STANDARD FIRE' => 'Travelers', 'STATE FARM' => 'State Farm', 'ALLSTATE' => 'Allstate', 'ESURANCE' => 'Esurance',
    'AAA ' => 'AAA', 'AUTO CLUB' => 'AAA', 'MEMBER SELECT' => 'AAA', 'INFINITY' => 'Infinity', 'DIRECT GENERAL' => 'Direct General', 'SECURITY NATIONAL' => 'Security National',
    'OCEAN HARBOR' => 'Ocean Harbor', 'UNITED AUTOMOBILE' => 'United Automobile', 'PERMANENT GENERAL' => 'The General', 'THE GENERAL' => 'The General',
    'LIBERTY MUTUAL' => 'Liberty Mutual', 'SAFECO' => 'Safeco', 'NATIONWIDE' => 'Nationwide', 'MERCURY' => 'Mercury', 'KEMPER' => 'Kemper', 'BRISTOL WEST' => 'Bristol West',
    'WINDHAVEN' => 'Windhaven', 'FIRST ACCEPTANCE' => 'First Acceptance', 'FARMERS' => 'Farmers', 'HARTFORD' => 'The Hartford', 'AUTO-OWNERS' => 'Auto-Owners',
    'AMICA' => 'Amica', 'ASSURANCEAMERICA' => 'AssuranceAmerica', 'DAIRYLAND' => 'Dairyland', 'CENTURY-NATIONAL' => 'Century-National', 'ROOT INSURANCE' => 'Root',
    'HALLMARK' => 'Hallmark', 'SEMINOLE CASUALTY' => 'Seminole Casualty', 'STAR CASUALTY' => 'Star Casualty', 'EQUITY INSURANCE' => 'Equity', 'ACCEPTANCE INSURANCE' => 'Acceptance',
];
// Commercial health / Medicare paperwork that arrives in the same mail.
const EOB_NOT_AUTO = ['MEDICARE', 'AETNA', 'BLUE CROSS', 'BLUECROSS', 'BLUE SHIELD', 'UNITEDHEALTHCARE', 'UNITED HEALTHCARE', 'WELLMED', 'GLOBE LIFE', 'HUMANA', 'CIGNA', 'TRICARE', 'MEDICAID', 'AMBETTER', 'OSCAR HEALTH', 'SIMPLY HEALTHCARE', 'SUNSHINE HEALTH', 'AVMED', 'FLORIDA BLUE'];
const EOB_PIP_WORDS = ['PERSONAL INJURY PROTECTION', 'PERSONAL INJURY PROTECT', 'NO-FAULT', 'NO FAULT', '627.736', 'BPIP', 'PIP MEDICAL', 'COVERAGE: PIP', 'MEDICAL PAYMENTS', 'MEDPAY', 'DATE OF LOSS', 'LOSS DATE'];

// ---------- reading pages ----------

function eob_ocr_engine(): ?string {
    if (defined('EOB_OCR') && EOB_OCR === 'off') return null;
    if (defined('EOB_OCR') && EOB_OCR === 'textract') return 'textract';
    static $tess = null;
    if ($tess === null) { exec('command -v tesseract 2>/dev/null', $o, $c); $tess = $c === 0; }
    return $tess ? 'tesseract' : null;
}

function eob_page_count(string $pdf): int {
    exec('pdfinfo ' . escapeshellarg($pdf) . ' 2>/dev/null', $out, $code);
    foreach ($out as $l) if (preg_match('/^Pages:\s+(\d+)/', $l, $m)) return (int)$m[1];
    return 0;
}

function eob_text_layer(string $pdf, int $page): string {
    $out = tempnam(sys_get_temp_dir(), 'eob');
    exec(sprintf('pdftotext -layout -f %d -l %d %s %s 2>/dev/null', $page, $page, escapeshellarg($pdf), escapeshellarg($out)));
    $t = (string)@file_get_contents($out);
    @unlink($out);
    return $t;
}

// The page as a 300 dpi greyscale PNG (deleted by the caller).
function eob_page_png(string $pdf, int $page): ?string {
    $base = tempnam(sys_get_temp_dir(), 'eobp');
    exec(sprintf('pdftoppm -r 300 -gray -png -singlefile -f %d -l %d %s %s 2>/dev/null', $page, $page, escapeshellarg($pdf), escapeshellarg($base)), $o, $code);
    @unlink($base);
    return is_file($base . '.png') ? $base . '.png' : null;
}

// How much a page's text reads like an EOB (words and amounts), to choose
// between orientations.
function eob_text_score(string $t): int {
    return preg_match_all('/\b(?:DATE|CLAIM|TOTAL|AMOUNT|SERVICE|CHARGE[DS]?|PATIENT|PAY(?:MENT)?|INSURANCE|POLICY|EXPLANATION|PROVIDER|ALLOWED|BILL(?:ED)?|CHECK|LOSS)\b/i', $t)
        + preg_match_all('/' . EOB_MONEY_RX . '/', $t);
}

function eob_tesseract(string $png): string {
    $run = function () use ($png) { $o = []; exec('tesseract ' . escapeshellarg($png) . ' - --psm 6 -c preserve_interword_spaces=1 2>/dev/null', $o); return implode("\n", $o); };
    $text = $run();
    // Upside-down or sideways pages (return slips, rotated remittances):
    // only when the page as scanned doesn't read, ask tesseract which way
    // up it is (its guess is unreliable on sparse pages), and keep the
    // better reading.
    if (eob_text_score($text) < 6 && function_exists('imagecreatefrompng')) {
        exec('tesseract ' . escapeshellarg($png) . ' - --psm 0 2>/dev/null', $osd);
        foreach ($osd as $l) {
            if (preg_match('/^Rotate:\s*(90|180|270)/', $l, $m) && ($im = @imagecreatefrompng($png))) {
                $orig = $png . '.orig.png'; copy($png, $orig);
                imagepng(imagerotate($im, -(int)$m[1], 0xFFFFFF), $png);
                $turned = $run();
                if (eob_text_score($turned) > eob_text_score($text)) $text = $turned;
                @unlink($orig);
            }
        }
    }
    return $text;
}

// Amazon Textract (DetectDocumentText) through the AWS CLI and the server's
// instance role; its lines are laid back out on a character grid so the
// same column readers work.
function eob_textract(string $png): string {
    // The page goes in a request file (too big for the command line).
    $req = tempnam(sys_get_temp_dir(), 'txr');
    file_put_contents($req, json_encode(['Document' => ['Bytes' => base64_encode((string)file_get_contents($png))]]));
    exec('aws textract detect-document-text --output json --cli-input-json ' . escapeshellarg('file://' . $req) . ' 2>/dev/null', $out, $code);
    @unlink($req);
    if ($code !== 0) return '';
    return eob_layout_from_textract(json_decode(implode("\n", $out), true) ?: []);
}

function eob_layout_from_textract(array $resp, int $width = 130): string {
    $lines = [];
    foreach ($resp['Blocks'] ?? [] as $b) if (($b['BlockType'] ?? '') === 'LINE' && isset($b['Geometry']['Polygon'][1])) $lines[] = $b;
    if (!$lines) return '';
    // Rotated scan: turn the coordinates so text runs left to right.
    $dx = $dy = 0.0;
    foreach ($lines as $b) { $p = $b['Geometry']['Polygon']; $dx += $p[1]['X'] - $p[0]['X']; $dy += $p[1]['Y'] - $p[0]['Y']; }
    $rot = abs($dx) >= abs($dy) ? ($dx >= 0 ? 0 : 180) : ($dy >= 0 ? 90 : 270);
    $pt = function ($x, $y) use ($rot) { return match ($rot) { 90 => [$y, 1 - $x], 180 => [1 - $x, 1 - $y], 270 => [1 - $y, $x], default => [$x, $y] }; };
    $items = [];
    foreach ($lines as $b) {
        $p = $b['Geometry']['Polygon'];
        [$x0, $y0] = $pt($p[0]['X'], $p[0]['Y']); [$x3, $y3] = $pt($p[3]['X'], $p[3]['Y']);
        $items[] = ['x' => $x0, 'y' => ($y0 + $y3) / 2, 'h' => abs($y3 - $y0), 't' => $b['Text']];
    }
    usort($items, fn($a, $b) => $a['y'] <=> $b['y']);
    $rows = []; $cur = []; $curY = null; $h = 0.01;
    foreach ($items as $it) {
        if ($curY !== null && abs($it['y'] - $curY) > max($h, $it['h']) * 0.6) { $rows[] = $cur; $cur = []; }
        $cur[] = $it; $curY = $curY === null || !$cur ? $it['y'] : $it['y']; $h = $it['h'] ?: $h;
    }
    if ($cur) $rows[] = $cur;
    $out = [];
    foreach ($rows as $r) {
        usort($r, fn($a, $b) => $a['x'] <=> $b['x']);
        $s = '';
        foreach ($r as $it) { $col = (int)round($it['x'] * $width); $s .= str_repeat(' ', max(1, $col - strlen($s))) . $it['t']; }
        $out[] = rtrim($s);
    }
    return implode("\n", $out);
}

// One text per page: OCR when an engine is set up, otherwise the scanner's
// text layer. Returns [['text' => ..., 'source' => 'ocr'|'textract'|'layer']].
function eob_read_pages(string $pdf): array {
    $n = eob_page_count($pdf);
    if ($n < 1) throw new RuntimeException("Couldn't open this PDF.");
    if ($n > EOB_MAX_PAGES) throw new RuntimeException('Upload ' . EOB_MAX_PAGES . ' pages or fewer at a time.');
    $engine = eob_ocr_engine();
    $pages = [];
    for ($i = 1; $i <= $n; $i++) {
        $text = ''; $source = 'layer';
        if ($engine && ($png = eob_page_png($pdf, $i))) {
            $text = $engine === 'textract' ? eob_textract($png) : eob_tesseract($png);
            $source = $engine === 'textract' ? 'textract' : 'ocr';
            @unlink($png);
        }
        if (trim($text) === '') { $text = eob_text_layer($pdf, $i); $source = 'layer'; }
        $pages[] = ['text' => $text, 'source' => $source];
    }
    if (!array_filter($pages, fn($p) => trim($p['text']) !== '')) throw new RuntimeException('No text could be read from this scan. Enter the EOB by hand, or rescan it at 300 dpi.');
    return $pages;
}

// ---------- small readers ----------

// "$1,234.56", "$29s.00" (OCR), "50,00" → float, or null.
function eob_money(?string $s): ?float {
    if ($s === null) return null;
    $s = strtr(trim($s), ['s' => '5', 'S' => '5', 'O' => '0', 'o' => '0', 'l' => '1', 'I' => '1', '§' => '5', ' ' => '']);
    $s = ltrim($s, '$*');
    if (preg_match('/^(\d{1,3}(?:[,.]\d{3})*|\d+)[.,](\d{2})$/', $s, $m)) return round((float)(str_replace([',', '.'], '', $m[1]) . '.' . $m[2]), 2);
    return null;
}

function eob_date(?string $s): ?string {
    $s = trim((string)$s);
    $s = preg_replace('/(?<=\d)\s*[tl|]\s*(?=\d)/', '/', $s);        // OCR "02t17t2021"
    if (preg_match('#^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$#', $s, $m)) {
        // OCR reads a leading 1 as 4 or 7 ("41/30/2018").
        if ((int)$m[1] > 12 && strlen($m[1]) === 2 && in_array($m[1][0], ['4', '7'], true)) $m[1] = '1' . $m[1][1];
        $y = strlen($m[3]) === 2 ? 2000 + (int)$m[3] : (int)$m[3];
        if (!checkdate((int)$m[1], (int)$m[2], $y) || $y < 2000 || $y > 2100) return null;
        return sprintf('%04d-%02d-%02d', $y, $m[1], $m[2]);
    }
    if (preg_match('/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i', $s) && ($t = strtotime($s))) return date('Y-m-d', $t);
    if (preg_match('/^(\d{8})$/', $s) && checkdate((int)substr($s, 0, 2), (int)substr($s, 2, 2), (int)substr($s, 4))) return sprintf('%s-%s-%s', substr($s, 4), substr($s, 0, 2), substr($s, 2, 2));
    return null;
}

const EOB_DATE_RX = '(?:\d{1,2}\s?[\/\-.tl|]\s?\d{1,2}\s?[\/\-.tl|]\s?(?:\d{4}|\d{2})(?!\d)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})';
const EOB_MONEY_RX = '(?<![\w.,])\$?\s?\d{1,3}(?:,\d{3})*[.,]\d{2}(?![\d%])';
// CPT (5 digits) or HCPCS (letter + 4 digits), not part of a longer number.
const EOB_CODE_RX = '(?<![\w\/.\-$,])(?:\d{4}[0-9A-Z]|[A-HJ-NP-V]\d{4})(?![\w\/.,%])';

// The value printed after a label ("Claim Number : 123"), across the line.
function eob_label(string $text, string $labelRx, string $valueRx): ?string {
    if (preg_match('/(?:' . $labelRx . ')[ \t]*[:.;#|]*[ \t]*(' . $valueRx . ')/i', $text, $m)) return trim($m[1]);
    return null;
}

// Two-column layouts print the value under its label: look in the next
// two lines, in the label's column.
function eob_label_below(string $text, string $labelRx, string $valueRx): ?string {
    $lines = preg_split('/\R/', $text);
    foreach ($lines as $i => $l) {
        if (!preg_match('/(?:' . $labelRx . ')\s*[:;]?/i', $l, $m, PREG_OFFSET_CAPTURE)) continue;
        $x0 = max(0, $m[0][1] - 6); $x1 = $m[0][1] + strlen($m[0][0]) + 30;
        for ($j = $i + 1; $j <= $i + 2 && $j < count($lines); $j++) {
            if (preg_match_all('/' . $valueRx . '/', $lines[$j], $vm, PREG_OFFSET_CAPTURE)) {
                foreach ($vm[0] as $v) if ($v[1] + strlen($v[0]) >= $x0 && $v[1] <= $x1) return trim($v[0]);
            }
        }
    }
    return null;
}

// Evens out OCR noise inside amounts: "$500}.00", "$231 .48", "$231|.48".
function eob_norm(string $text): string {
    $text = preg_replace('/(?<=\d)\s?[}\]|]?\s?\.(?=\d{2}(?!\d))/', '.', $text);
    return preg_replace('/(?<=\$)\s+(?=\d)/', '', $text);
}

function eob_first_money(string $text, array $labels): ?float {
    foreach ($labels as $l) if (($v = eob_label_money($text, $l)) !== null) return $v;
    return null;
}

function eob_label_date(string $text, string $labelRx): ?string {
    $v = eob_label($text, $labelRx, EOB_DATE_RX) ?? eob_label_below($text, $labelRx, EOB_DATE_RX);
    return $v ? eob_date(preg_match('/^\d/', $v) ? preg_replace('/\s+/', '', $v) : $v) : null;
}

function eob_label_money(string $text, string $labelRx): ?float {
    if (preg_match('/(?:' . $labelRx . ')[^\n$\d]{0,60}(' . EOB_MONEY_RX . '|\$[\*\s]*\d[\d,]*[.,]\d{2})/i', $text, $m)) return eob_money(preg_replace('/[\s*]/', '', $m[1]));
    return null;
}

// ---------- page classification and batches ----------

function eob_payer(string $text): ?string {
    $u = strtoupper($text);
    $best = null; $pos = PHP_INT_MAX;
    foreach (EOB_AUTO_PAYERS as $needle => $name) {
        $p = strpos($u, $needle);
        if ($p !== false && $p < $pos) { $pos = $p; $best = $name; }
    }
    return $best;
}

const EOB_LETTER_RX = '/ENCLOSED\s+(?:PLEASE\s+FIND|IS|ARE|YOU\s+WILL\s+FIND)\s+(?:A\s+|THE\s+|OUR\s+)?(?:CHECK|DRAFT|SETTLEMENT\s+CHECK)|CHECK\(?S?\)?\s+(?:OUR\s+OFFICE\s+)?RECEIVED\s+FROM|ENCLOSURE\S*\s*[-\x{2013}\x{2014}:]+\s*CHECK/u';
// Money that comes through an attorney: a pre-suit demand (§627.736(10)), a
// PIP suit or a settlement, often "to include interest".
const EOB_RECOVERY_RX = '/627\.736\s*\(\s*10\s*\)|\bDEMAND\b|PRE-?SUIT|\bSUIT\b|LAWSUIT|LITIGATION|SETTLEMENT|COUNTY\s+COURT|CASE\s+(?:NO|NUMBER)|ATTORNEY\S?\s+FEES?|MORGAN\s*&\s*MORGAN|\bLAW\s+(?:GROUP|FIRM|OFFICES?)|\bP\.\s?A\.(?=\s|$)|\bPLLC\b|\bESQ/';

// 'eob' | 'payment' (check, draft or payment advice) | 'letter' (an
// attorney's cover letter for a check) | 'other'; and whether
// it is auto/PIP paperwork at all.
function eob_classify(string $text): array {
    $u = strtoupper($text);
    $payer = eob_payer($text);
    // PIP EOBs quote "200% of the Medicare Part B fee schedule": that alone
    // doesn't make a page a Medicare remittance.
    $uNoFee = preg_replace('/MEDICARE\s+(?:PART\s+B\s+)?(?:FEE|PREVAILING|PARTICIPATING)|PARTICIPATING\s+LEVEL\s+OF\s+MEDICARE|MEDICARE\s+PART\s+B/', '', $u);
    $notAuto = null;
    foreach (EOB_NOT_AUTO as $w) if (str_contains($uNoFee, $w)) { $notAuto = $w; break; }
    $pip = false;
    foreach (EOB_PIP_WORDS as $w) if (str_contains($u, $w)) { $pip = true; break; }
    $auto = $payer !== null || ($pip && !$notAuto);
    if (preg_match('/ATTORNEY|P\.A\.|LAW (?:GROUP|FIRM|OFFICES?)|TRUST ACCOUNT/', $u) && !$payer && !$pip) $auto = false;
    $isEob = (bool)preg_match('/EXPLANATION\s+OF\s+(?:BENEFITS|REVIEW|REIMBURSEMENT|PAYMENT)|SUBMITTED\s+CHARGES|AMOUNT\s+ALLOWED|REIM\w*\s+AMOUNT|PROVIDER\s+REIMBURSE|AMT\s+ALLOWED|PROC(?:EDURE)?\s+C(?:O)?D/', $u);
    $isPay = (bool)preg_match('/PAY\s+TO\s+THE|ORDER\s+OF|DRAFT\s+NUMBER|ADVICE\s+FOR\s+PAYMENT|NON[\s-]?NEGOTIABLE|CHECK\s+(?:NUMBER|NO|#)|PAY\s+EXACTLY|VOID\s+(?:IF|AFTER)/', $u);
    // A check stub that only summarises the payment ("Explanation of
    // payment … total paid") has no service lines: it's a payment page.
    $hasRows = eob_table_lines($text) || eob_travelers_lines($text);
    if ($isEob && $isPay && !$hasRows) $isEob = false;
    if (!$isEob && $hasRows && !$isPay) $isEob = true;
    // A law firm's cover letter for an insurer's check it forwards (PIP
    // demand and suit payments are mailed to the attorney).
    $isLetter = !$isEob && !$isPay && (bool)preg_match(EOB_LETTER_RX, $u);
    if ($isLetter) $auto = $auto || (bool)preg_match('/INSURANCE|CASUALTY|INDEMNITY|DATE\s+OF\s+LOSS/', $u);
    $kind = $isEob ? 'eob' : ($isPay ? 'payment' : ($isLetter ? 'letter' : 'other'));
    return ['kind' => $kind, 'auto' => $auto, 'payer' => $payer, 'skipReason' => $auto ? null : ($notAuto ? ucwords(strtolower($notAuto)) . ' (not auto / PIP)' : 'Not an auto / PIP insurance document')];
}

function eob_claim_number(string $text): ?string {
    $v = eob_label($text, 'Claim\s*(?:Number|No\.?|#)|CLAIM\s*NUMBER|FILE\s*NUMBER', '(?=[A-Z0-9\-]{0,10}\d)(?:[A-Z0-9][A-Z0-9\-]{4,24}|[A-Z0-9]{2,4}(?=[ ][A-Z0-9]))(?:[ ][A-Z0-9]{1,8}){0,3}');
    if ($v === null) $v = eob_label_below($text, '(?-i:CLAIM\s*NUMBER)', '(?=[A-Z0-9\- ]{0,12}\d)[A-Z0-9][A-Z0-9\-]{2,24}(?:[ ][A-Z0-9]{1,8}){0,3}');
    if ($v === null) $v = eob_label($text, 'USAA\s*#|Member\s*Number', '\d[\d\-]{6,24}');
    if ($v === null) return null;
    $v = preg_replace('/\s+(?:Date|Bill|Policy|Claimant|Patient|Loss|Total|Charges?)\b.*$/i', '', $v);
    // Extra words only when they look like part of a claim ("297 PP IHH7809 002").
    $parts = explode(' ', trim($v));
    $keep = [array_shift($parts)];
    foreach ($parts as $pt) { if (!preg_match('/\d/', $pt) && strlen($pt) > 3) break; $keep[] = $pt; }
    $v = implode(' ', $keep);
    return strtoupper(trim($v));
}

// Splits the batch into documents: consecutive EOB pages with the same
// payer and claim belong together (continuation pages have no claim of
// their own); payment pages are kept apart and matched to an EOB after.
function eob_split(array $pages): array {
    $docs = []; $skipped = []; $cur = null;
    foreach ($pages as $i => $p) {
        $c = eob_classify($p['text']);
        $claim = eob_claim_number($p['text']);
        $first = (bool)preg_match('/Page\s*1\s*(?:of|0f|ot)\s*\d/i', $p['text']);
        $titled = (bool)preg_match('/EXPLANATION\s+OF\s+(?:BENEFITS|REVIEW|REIMBURSEMENT)|REMITTANCE\s+ADVICE/i', $p['text']);
        $later = (bool)preg_match('/Page\s*[2-9]\d*\s*(?:of|0f|ot)\s*\d/i', $p['text']);
        $continues = $cur !== null && !$first && $c['kind'] !== 'payment' && $c['kind'] !== 'letter' && (!$c['payer'] || $c['payer'] === $docs[$cur]['payer'])
            && (($claim && $docs[$cur]['claim'] && eob_same_claim($claim, $docs[$cur]['claim'])) || (!$claim && ($later || !$titled)));
        if (!$c['auto'] && !$continues) {
            $skipped[] = ['page' => $i + 1, 'why' => $c['skipReason']];
            $cur = null; continue;
        }
        if ($c['kind'] === 'payment' || $c['kind'] === 'letter') {
            $docs[] = ['kind' => $c['kind'], 'pages' => [$i + 1], 'text' => $p['text'], 'payer' => $c['payer'], 'claim' => $c['kind'] === 'letter' ? null : $claim, 'sources' => [$p['source']]];
            $cur = null;
            continue;
        }
        $same = $cur !== null && !$first && (!$claim || !$docs[$cur]['claim'] || eob_same_claim($claim, $docs[$cur]['claim'])) && (!$c['payer'] || !$docs[$cur]['payer'] || $c['payer'] === $docs[$cur]['payer']);
        if ($c['kind'] === 'other' && $cur === null) { $skipped[] = ['page' => $i + 1, 'why' => 'No EOB on this page']; continue; }
        if ($same) {
            $docs[$cur]['pages'][] = $i + 1; $docs[$cur]['text'] .= "\n\f\n" . $p['text']; $docs[$cur]['sources'][] = $p['source'];
            $docs[$cur]['claim'] = $docs[$cur]['claim'] ?: $claim; $docs[$cur]['payer'] = $docs[$cur]['payer'] ?: $c['payer'];
        } else {
            $docs[] = ['kind' => 'eob', 'pages' => [$i + 1], 'text' => $p['text'], 'payer' => $c['payer'], 'claim' => $claim, 'sources' => [$p['source']]];
            $cur = count($docs) - 1;
        }
    }
    return [$docs, $skipped];
}

function eob_same_claim(string $a, string $b): bool {
    $n = fn($s) => preg_replace('/[^A-Z0-9]/', '', strtoupper($s));
    return $n($a) === $n($b) || (strlen($n($a)) >= 6 && (str_contains($n($a), $n($b)) || str_contains($n($b), $n($a))));
}

// ---------- service lines ----------

// Table rows read by scanners and OCR carry the table's ruling as stray
// characters ("11}99203}", "$500}.00") and misread a few letters; this
// evens them out before the row is read.
function eob_clean_row(string $line): string {
    $line = preg_replace('/(?<=\d)[}\]|)](?=[.,]?\d)/', '', $line);       // "$500}.00"
    $line = preg_replace('/[|}\]\[(){]/', ' ', $line);
    // Place of service 11 run into the code: "11197140" / "197140" → "97140".
    $line = preg_replace('/(?<![\d.,$])1{1,3}(\d{5})(?![\d.,])/', ' $1', $line);
    $line = preg_replace('/(?<![\w.])£(\d{4})(?![\d.,])/', 'E$1', $line);
    $line = preg_replace('/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/', ' ', $line);              // "TX 79998-1106"
    // "S9090" read as "$9090" or "s9090".
    $line = preg_replace('/(?<![\w.])[$§sS](\d{4})(?![\d.,])/', 'S$1', $line);
    return $line;
}

function eob_tokens(string $line, string $rx): array {
    preg_match_all('/' . $rx . '/', $line, $m, PREG_OFFSET_CAPTURE);
    return array_map(fn($t) => ['v' => $t[0], 'x' => $t[1] + strlen($t[0]) / 2, 'at' => $t[1], 'end' => $t[1] + strlen($t[0])], $m[0]);
}

// Service lines from a column table (review, benefits and generic layouts).
// On every auto/PIP layout the first amount on a row is the charge and the
// last is the allowed (or reimbursed) amount; a middle amount under a
// "Deductible" heading is the deductible. Rows must carry a date of
// service, or follow a row that did (dates are printed once per visit).
function eob_table_lines(string $text): array {
    $raw = preg_split('/\R/', $text);
    $rows = []; $lastDate = null; $lastRowAt = -99; $dedCol = false; $inTable = false;
    foreach ($raw as $i => $line0) {
        $u = strtoupper($line0);
        if (preg_match('/CHARGE|BILLED/', $u) && preg_match('/ALLOW|REIM|DEDUCT|UNITS|PAID/', $u . ' ' . strtoupper($raw[$i + 1] ?? ''))) $inTable = true;
        if (preg_match('/DEDUCTIBLE/', $u) && preg_match('/CHARGE|BILLED/', $u . strtoupper($raw[$i - 1] ?? '')) && !preg_match('/REMAINING|BALANCE/', $u)) $dedCol = true;
        if (preg_match('/^\s*(?:\W{0,3})(?:Sub\s*-?\s*Totals?|Totals?\b|Total\s+Lines)/i', $line0)) { $lastRowAt = -99; $inTable = false; continue; }
        if (preg_match('/(?:EXPLANATION\s+CODE\s+GUIDE|PROCEDURE\s+CODE\s*\(|ICD\s+DIAGNOSIS\s+CODE\s+GUIDE|^\s*EXPLANATIONS?\s*:|^\s*Comments\b)/i', $line0)) { $lastRowAt = -99; $inTable = false; }
        $line = eob_clean_row($line0);
        if (preg_match('/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/', $line) && !preg_match('/\$\s?\d/', $line)) continue;   // addresses
        $codes = eob_tokens($line, EOB_CODE_RX);
        $money = eob_tokens($line, EOB_MONEY_RX);
        if (!$codes || !$money) continue;
        $dates = eob_tokens($line, EOB_DATE_RX);
        $date = null;
        foreach ($dates as $d) if ($d['at'] < $codes[0]['at'] && ($date = eob_date(preg_replace('/\s+/', '', $d['v'])))) break;
        if (!$date && $i - $lastRowAt > 4 && !($inTable && $lastDate)) continue;
        $code = $codes[0];
        foreach ($codes as $c) if ($date && $dates && $c['at'] > $dates[0]['end']) { $code = $c; break; }
        $money = array_values(array_filter($money, fn($m) => $m['at'] > $code['end']));
        if (!$money) continue;
        $date = $date ?: $lastDate;
        $lastDate = $date; $lastRowAt = $i;
        $vals = array_map(fn($m) => eob_money(str_replace(' ', '', $m['v'])), $money);
        $row = ['dos' => $date, 'code' => strtoupper($code['v']), 'modifiers' => null, 'units' => null, 'charged' => $vals[0], 'allowed' => count($vals) >= 2 ? end($vals) : null, 'paid' => null,
            'deductible' => $dedCol && count($vals) >= 3 ? $vals[1] : null, 'reasons' => null];
        // Between the code and the first amount: modifiers and units.
        $mid = substr($line, $code['end'], max(0, $money[0]['at'] - $code['end']));
        $modRx = '/(?<![\w.])(25|59|GP|GO|GN|AT|KX|XS|XU|XE|XP|76|77|51|52|GA|GY|GZ|RT|LT|AA|QW)(?![\w.])/';
        if (preg_match_all($modRx, $mid, $mm)) $row['modifiers'] = implode(',', array_unique($mm[1]));
        if (preg_match('/(?<![\w.,])(\d{1,2}(?:\.\d{1,2})?)\s*$/', rtrim(preg_replace($modRx, ' ', $mid)), $um)) $row['units'] = (float)$um[1];
        $tail = strtoupper(substr($line, end($money)['end']));
        if (preg_match_all('/(?<![\w.$])([A-Z]{0,3}[_\-]?[A-Z0-9]{2,8})(?![\w.])/', $tail, $rm)) {
            $r = array_values(array_filter($rm[1], fn($v) => preg_match('/\d/', $v) || preg_match('/^[A-Z]{2,}[_\-][A-Z0-9]+$/', $v)));
            if ($r) $row['reasons'] = implode(', ', array_slice($r, 0, 6));
        }
        $rows[] = $row;
    }
    return $rows;
}

// Travelers: one label-per-line block per service (OCR misreads a letter
// here and there: "SERWICE", "ALLQWED", "s9090").
function eob_travelers_lines(string $text): array {
    $rows = [];
    $t = preg_replace('/[ \t]+/', ' ', eob_clean_row(str_replace("\n", " \n ", $text)));
    if (!preg_match_all('/SER\w{0,3}CE\s*DATE\s*[:;z]?\s*(' . EOB_DATE_RX . ')(.{0,300}?)AMT\.?\s*CHAR\w*\s*[:;]?\s*(' . EOB_MONEY_RX . ')(.{0,80}?)AMT\.?\s*AL\w{2,4}D\s*[:;]?\s*(' . EOB_MONEY_RX . ')((?:(?!SER\w{0,3}CE\s*DATE).){0,160})/is', $t, $m, PREG_SET_ORDER)) return [];
    foreach ($m as $b) {
        preg_match('/PROC\s*C\s*D\s*[:;]?\s*(' . EOB_CODE_RX . ')/i', $b[2], $c);
        preg_match('/MODIFIER\s*\(?S\)?\s*[:;]?\s*((?:\b(?:25|59|GP|GO|GN|AT|XS|XU|76|77|51)\b[ ,]*)+)/i', $b[2], $md);
        preg_match('/UNITS\s*[:;]?\s*(\d+(?:\.\d)?)/i', $b[2] . $b[4], $un);
        preg_match('/EXP\w{0,3}ANATION\s*CODE\s*\(?S\)?\s*[:;z]?\s*((?:[A-Z*]?\d{2,5}\s*,?\s*)+)/i', $b[6], $ex);
        $rows[] = ['dos' => eob_date(preg_replace('/\s+/', '', $b[1])), 'code' => strtoupper($c[1] ?? '?'), 'modifiers' => isset($md[1]) ? trim(preg_replace('/[ ,]+/', ',', $md[1]), ',') : null, 'units' => isset($un[1]) ? (float)$un[1] : null,
            'charged' => eob_money($b[3]), 'allowed' => eob_money($b[5]), 'paid' => null, 'deductible' => null, 'reasons' => isset($ex[1]) ? trim(preg_replace('/\s*,\s*|\s+/', ', ', trim($ex[1])), ', ') : null];
    }
    return $rows;
}

// ---------- one EOB ----------

function eob_layout(string $text): string {
    $u = strtoupper($text);
    if (str_contains($u, 'TRAVELERS') && preg_match('/AMT\.?\s*CHARGED|EXPLANATION OF PAYMENT/', $u)) return 'travelers';
    if (preg_match('/EXPLANATION\s+OF\s+(?:REVIEW|REIMBURSEMENT)|EOR\s+CHECK\s+AMOUNT/', $u)) return 'review';
    if (preg_match('/DEDUCTIBLE\s+APPLIED|REMAINING\s+BALANCE|THIS IS NOT A BILL/', $u)) return 'benefits';
    return 'generic';
}

const EOB_LAYOUT_NAMES = ['review' => 'Explanation of Review (bill-review format)', 'benefits' => 'Explanation of Benefits (charged / allowed format)', 'travelers' => 'Travelers explanation of benefits', 'generic' => 'Read from its column headings', 'manual' => 'Entered by hand', 'payment' => 'Check without an EOB'];

// Code → explanation pairs printed in the EOB's glossary.
function eob_reason_glossary(string $text): array {
    $out = [];
    foreach (preg_split('/\R/', $text) as $l) {
        if (preg_match('/^\s*(\d{2,4}|[A-Z]{1,3}[_\-]?[A-Z0-9]{2,8}|X\d{3,4})\s{2,}([A-Z][A-Za-z].{8,160})$/', $l, $m) && !preg_match('/^\d{5}$/', $m[1])) {
            $code = strtoupper($m[1]);
            if (!isset($out[$code]) && preg_match('/[a-z]{3}/i', $m[2]) && !preg_match('/^(Office|Ther|Manual|Chiropractic|Application|Electrical|Vertebral|E-stim|Unlist|Segmental|Sprain|Strain|Other|Head|Pain|Cervical|Low back)/i', $m[2])) $out[$code] = trim(preg_replace('/\s+/', ' ', $m[2]));
        }
    }
    return array_slice($out, 0, 30, true);
}

function eob_parse_doc(array $doc): array {
    $text = eob_norm($doc['text']);
    $layout = eob_layout($text);
    $lines = $layout === 'travelers' ? eob_travelers_lines($text) : eob_table_lines($text);
    $dateLbl = fn($rx) => eob_label_date($text, $rx);
    $h = [
        'payer' => $doc['payer'] ?? eob_payer($text),
        'claim' => $doc['claim'] ?? eob_claim_number($text),
        'patient' => eob_patient_name($text),
        'dateOfLoss' => $dateLbl('Date\s*of\s*Loss|Loss\s*Date|Date\s*of\s*Accident|Accident\s*Date|DATE\s*OF\s*INJURY'),
        'receivedOn' => $dateLbl('Receive[d]?\s*Date|Date\s*Received|Date\s*Bill\s*Received|DATE\s*BILL\s*RE\w*|Date\s*Rec\'?d'),
        'eobDate' => $dateLbl('Document\s*Date|EOB\s*Date|DATE\s*EOB|Date\s*Processed|Process(?:ed)?\s*Date|Issue\s*Date|Printed\s*On\s*-*') ?: $dateLbl('(?<!\w)Date(?!\s*of)'),
        'billRef' => eob_label($text, 'Bill\s*Number|EOR\s*#|Provider\s*Invoice\s*(?:#|Number)?|Invoice\s*(?:#|Number)|REFERENCE\s*#', '[A-Z0-9][A-Z0-9\-]{4,24}'),
        'checkNumber' => eob_label($text, 'Check\s*(?:Number|No\.?|#)|DRAFT\s*NUMBER|Payment\s*Number', '\d{5,14}'),
        'checkDate' => $dateLbl('CHECK\s*DATE|Payment\s*Date'),
    ];
    $tot = [
        'charged' => eob_label_money($text, 'Total\s*Charges|Total\s*Billed|AMOUNT\s*CHAR\w*'),
        'allowed' => eob_label_money($text, 'Reimbursement\s*Amount(?!\s*$)') ?? eob_label_money($text, 'AMOUNT\s*ALLOWED|Total\s*Allowed'),
        'deductible' => eob_label_money($text, 'Less\s*Deductible|Deductible\s*\/\s*Co-?Pay(?!ment)') ,
        'coinsurance' => eob_label_money($text, 'Limited\s*Benefits\s*\/\s*Copay|Co-?insurance|Co-?Payment'),
        'interest' => eob_label_money($text, 'Interest\s*(?:&|and)\s*Penalty|Statutory\s*Interest|Late\s*Payment\s*Interest|Interest\s*(?:Amount|Paid)'),
        'paid' => eob_first_money($text, ['EOR\s*Check\s*Amount', 'TOTAL\s*PAID(?:\s*AMT)?', 'Total\s*Payment\s*Amount', 'Total\s*Amount\s*Paid', 'Check\s*Amount', 'Amount\s*Paid', '(?<![A-Z])PAY\s*EXACTLY']),
    ];
    // "Totals" row in the table (charged … allowed).
    if (preg_match_all('/^\s*(?:Sub\s*-?\s*Totals?|Totals?)\s*:?(.*)$/mi', $text, $tm, PREG_SET_ORDER)) {
        foreach ($tm as $t) {
            $vals = array_values(array_filter(array_map(fn($x) => eob_money(str_replace(' ', '', $x['v'])), eob_tokens($t[1], EOB_MONEY_RX)), fn($v) => $v !== null));
            if (count($vals) >= 2) { $tot['charged'] = $tot['charged'] ?? $vals[0]; $tableAllowed = end($vals); }
        }
    }
    if (preg_match('/Total\s*Lines\s*:?\s*\d+(.*)$/mi', $text, $tl)) {
        $vals = array_map(fn($x) => eob_money(str_replace(' ', '', $x['v'])), eob_tokens($tl[1], EOB_MONEY_RX));
        if ($vals) $tot['charged'] = $tot['charged'] ?? $vals[0];
    }
    $reasons = eob_reason_glossary($text);
    $u = strtoupper($text);
    $pct = EOB_PIP_RATE;
    if ($layout === 'travelers') {
        // Travelers prints the payable (80%) amount as "allowed".
        foreach ($lines as &$l) { $l['paid'] = $l['allowed']; $l['allowed'] = $l['allowed'] !== null ? round($l['allowed'] / $pct, 2) : null; }
        unset($l);
        $tot['allowed'] = null;
    }
    if ($layout === 'benefits' && isset($tableAllowed) && $tot['deductible'] !== null && $tot['paid'] === null) $tot['paid'] = $tableAllowed;   // Progressive totals block
    $r = ['layout' => $layout, 'header' => $h, 'lines' => array_values($lines), 'totals' => $tot, 'reasons' => $reasons, 'pages' => $doc['pages'], 'sources' => array_values(array_unique($doc['sources'] ?? []))];
    $r['upper'] = $u;
    return eob_finish($r, $u);
}

function eob_patient_name(string $text): ?string {
    foreach (['Patient\s*Name|PATIENT\s*NAME|Patient(?!\s*Acc)|PATIENT\s*:|Claimant\s*Name|CLAIMANT|Insured\s*\/\s*claimant'] as $rx) {
        if (preg_match('/(?:' . $rx . ')[ \t]*[:.;]*[ \t]*([A-Z][A-Za-z\'\-]+[ \t]*,[ \t]*[A-Z][A-Za-z\'\-]+(?:[ \t]+[A-Z]\.?)?|[A-Z][A-Za-z\'\-]+(?:[ \t]+[A-Z]\.?)?[ \t]+[A-Z][A-Za-z\'\-]{1,})/', $text, $m)) {
            $n = trim(preg_replace('/\s+/', ' ', $m[1]));
            if (!preg_match('/^(Account|Name|Number|Responsibility|Information|Progressive|Control|Check|Date)\b/i', $n)) return $n;
        }
    }
    // "Patient:" with the name on the next line.
    if (preg_match('/^\s*(?:Patient|PATIENT|Claimant|CLAIMANT)\s*:?\s*$\R\s*([A-Z][A-Za-z\'\-]+(?:\s+[A-Z]\.?)?\s+[A-Z][A-Za-z\'\-]{1,})/m', $text, $m)) return trim($m[1]);
    if (preg_match('/^\s*(?:Patient|PATIENT)\s*:(?:[ \t]*\d[\d \t]*|[ \t]{3,}\S[^\n]*|[ \t]*)\R\s*([A-Z][A-Z\'\-]+(?:[ \t]+[A-Z]\.?)?[ \t]+[A-Z][A-Z\'\-]{1,})\b/m', $text, $m)) return trim($m[1]);
    return null;
}

// Totals from the lines, the PIP math, status and the checks shown on review.
function eob_finish(array $r, string $upper = ''): array {
    $L = $r['lines']; $t = &$r['totals'];
    $sum = fn($k) => array_sum(array_map(fn($l) => (float)($l[$k] ?? 0), $L));
    $has = fn($k) => (bool)array_filter($L, fn($l) => $l[$k] !== null);
    $lineCharged = round($sum('charged'), 2);
    $lineAllowed = $has('allowed') ? round($sum('allowed'), 2) : null;
    $linePaid = $has('paid') ? round($sum('paid'), 2) : null;
    $checks = [];
    if ($t['charged'] !== null) $checks[] = ['label' => 'Line charges add up to the EOB total', 'ok' => abs($lineCharged - $t['charged']) < 0.02, 'detail' => '$' . number_format($lineCharged, 2) . ' vs $' . number_format($t['charged'], 2)];
    if ($t['allowed'] !== null && $lineAllowed !== null) $checks[] = ['label' => 'Allowed amounts add up to the EOB total', 'ok' => abs($lineAllowed - $t['allowed']) < 0.02, 'detail' => '$' . number_format($lineAllowed, 2) . ' vs $' . number_format($t['allowed'], 2)];
    $t['charged'] = $t['charged'] ?? $lineCharged;
    $t['allowed'] = $t['allowed'] ?? $lineAllowed;
    if ($t['paid'] === null && $linePaid !== null) $t['paid'] = $linePaid;
    // PIP pays 80% of the allowed amount, less any deductible.
    $exhausted = (bool)preg_match('/BENEFITS?\s+(?:ARE\s+|HAVE\s+BEEN\s+)?EXHAUSTED|EXHAUSTED\s+BENEFITS|POLICY\s+LIMITS?\s+(?:HAVE\s+BEEN\s+|HAS\s+BEEN\s+)?(?:MET|REACHED|EXHAUSTED)/', $upper . ' ' . strtoupper(implode(' ', $r['reasons'] ?? [])));
    if ($exhausted && $t['paid'] === null) $t['paid'] = 0.0;       // nothing paid once benefits are exhausted
    // "Deductible/Co-Pay" that is exactly 20% of the allowed amount is the PIP copay, not a deductible.
    if ($t['coinsurance'] === null && $t['deductible'] !== null && $t['allowed'] && abs($t['deductible'] - $t['allowed'] * (1 - EOB_PIP_RATE)) <= 0.05) { $t['coinsurance'] = $t['deductible']; $t['deductible'] = null; }
    $math = null;
    // MedPay pays the reasonable charge (in Florida, usually the 20% PIP leaves) — no 80% rule.
    $r['medpay'] = (bool)preg_match('/MEDICAL\s+PAYMENTS?\s+COVERAGE|\bMED\s?PAY\b/', $upper) && !preg_match('/PERSONAL\s+INJURY\s+PROTECTION|\bPIP\b/', $upper);
    if ($r['medpay'] && $t['allowed'] !== null && $t['paid'] !== null) {
        $checks[] = ['label' => 'MedPay payment', 'ok' => $t['paid'] <= $t['allowed'] + 0.05, 'detail' => '$' . number_format($t['paid'], 2) . ' paid on $' . number_format($t['allowed'], 2) . ' allowed (MedPay has no 80% rule)'];
    } elseif ($t['allowed'] !== null && $t['paid'] !== null && $t['allowed'] > 0) {
        $expect = round($t['allowed'] * EOB_PIP_RATE - (float)$t['deductible'] * ($t['coinsurance'] !== null ? 1 : 0), 2);
        if ($t['coinsurance'] !== null) $expect = round($t['allowed'] - $t['coinsurance'] - (float)($t['deductible'] ?? 0), 2);
        $full = round($t['allowed'] - (float)($t['deductible'] ?? 0), 2);
        $p = $t['paid'] - (float)($t['interest'] ?? 0);
        if (abs($p - $expect) <= 0.05) $math = 'pip80';
        elseif (abs($p - $full) <= 0.05) $math = 'full';
        elseif ($t['deductible'] !== null && abs($p - round($t['allowed'] - $t['deductible'], 2)) <= 0.05) $math = 'deductible';
        $checks[] = ['label' => 'Payment matches the PIP math', 'ok' => $math !== null || $exhausted,
            'detail' => $math === 'pip80' ? '80% of $' . number_format($t['allowed'], 2) . ($t['deductible'] ? ' less the deductible' : '') . ' = $' . number_format($t['paid'], 2)
                : ($math === 'full' ? 'Paid at 100% of the allowed amount' : 'Expected $' . number_format($expect, 2) . ' (80% of $' . number_format($t['allowed'], 2) . ' allowed' . ($t['deductible'] ? ', less the deductible' : '') . ') — paid $' . number_format($t['paid'], 2) . ' (' . ($t['paid'] > $expect ? '$' . number_format($t['paid'] - $expect, 2) . ' more' : '$' . number_format($expect - $t['paid'], 2) . ' less') . ')')];
    }
    $r['estimatedPaid'] = $t['paid'] === null && $t['allowed'] !== null ? round($t['allowed'] * EOB_PIP_RATE, 2) : null;
    $r['math'] = $math;
    $allZero = $t['allowed'] !== null && $t['allowed'] < 0.01;
    $r['status'] = $exhausted ? 'exhausted' : ($allZero || ($t['paid'] !== null && $t['paid'] < 0.01 && $t['charged'] > 0) ? 'denied' : ($t['paid'] === null && $t['allowed'] === null ? 'pending' : ($t['allowed'] !== null && $t['allowed'] + 0.01 < $t['charged'] ? 'reduced' : 'paid')));
    if (!$L) $checks[] = ['label' => 'Service lines found', 'ok' => false, 'detail' => 'No service lines could be read — add them below or enter the totals.'];
    $r['checks'] = $checks;
    $r['confident'] = $L && !array_filter($checks, fn($c) => !$c['ok']) && count($checks) >= 1;
    $dos = array_filter(array_column($L, 'dos'));
    $r['header']['dosFrom'] = $dos ? min($dos) : null;
    $r['header']['dosTo'] = $dos ? max($dos) : null;
    return $r;
}

// Payment pages (checks, drafts, payment advices): number, amount, date.
function eob_parse_payment(array $doc): array {
    $t = eob_norm($doc['text']);
    // OCR reads the decimal point on a check's protected amount as "!" or ":" ("$****192!15").
    $t = preg_replace('/(?<=\d)[!:;](?=\d{2}(?!\d))/', '.', $t);
    $amount = eob_label_money($t, 'Total\s*Payment\s*Amount|Check\s*Amount|AMOUNT\s*:?|PAY\s*EXACTLY|PAY\s*:?|TOTAL\s*PAID');
    if ($amount === null && preg_match('/\$\s*\*{2,}\s*([\d,]+[.,]\d{2})/', $t, $m)) $amount = eob_money($m[1]);
    // The amount in words is the legal amount of a check: it settles a misread figure.
    $words = eob_words_amount($t);
    if ($words !== null && ($amount === null || abs($amount - $words) >= 0.01)) $amount = $words;
    $u = strtoupper($t);
    $patient = eob_patient_name($t);
    if ($patient === null && preg_match('/(?<![A-Z])NAME\s*[:;]\s*([A-Z][A-Za-z\'\-]+\s*,\s*[A-Z][A-Za-z\'\-]+)/', $t, $m)) $patient = preg_replace('/\s*,\s*/', ', ', $m[1]);
    return ['payer' => $doc['payer'], 'claim' => $doc['claim'], 'pages' => $doc['pages'],
        'checkNumber' => eob_label($t, 'Check\s*(?:Number|No\.?|#)|DRAFT\s*N\w{1,3}BER|ADVICE\s*FOR\s*PAYMENT', '\d{6,14}') ?? eob_label_below($t, 'DRAFT\s*N\w{1,3}BER|CHECK\s*(?:NUMBER|NO)', '\d{8,14}')
            ?? (preg_match('/DRAFT\s*N\w{1,3}BER\s*:?[ \t]*\R[^\n]*?(?<![\d\-])(\d{8,14})(?![\d\-])/', $t, $m) ? $m[1] : null),
        'amount' => $amount,
        'date' => eob_label_date($t, 'Check\s*Date|Payment\s*Date|ISSUE\s*DATE') ?? eob_label_date($t, '(?<![\w ])DATE') ?? eob_first_date($t),
        'patient' => $patient, 'dateOfLoss' => eob_label_date($t, 'Date\s*of\s*Loss|Loss\s*Date|Date\s*of\s*Accident'),
        'recovery' => (bool)preg_match(EOB_RECOVERY_RX, $u), 'interestIncluded' => (bool)preg_match('/\bINT(?:EREST)?\s*(?:\/|&|AND)\s*BEN|INCLUD\w*\s+INT(?:EREST)?\b|\bINTEREST\b/', $u),
        'interest' => eob_label_money($t, 'Statutory\s*Interest|Interest\s*(?:Amount|Paid|Due)?|INT\s*AMT'),
        'fees' => eob_label_money($t, 'Attorney\'?s?\s*Fees?(?:\s*(?:&|and)\s*Costs)?'),
        'via' => eob_firm_line($t), 'viaRef' => null, 'letterPages' => [], 'fileStatus' => null, 'upper' => $u];
}

// The law firm a check was mailed to, from its address block ("MORGAN & MORGAN").
function eob_firm_line(string $t): ?string {
    if (preg_match('/^[ \t]*((?:[A-Z][A-Z.\']*[ \t]+)*(?:&|AND)[ \t]+[A-Z][A-Z.\']+(?:,?[ \t]+(?:P\.?A\.?|PLLC|LLP|LLC))?|[A-Z][A-Z.,&\' ]{2,50}(?:LAW\s+(?:GROUP|FIRM|OFFICES?)|P\.\s?A\.|PLLC|LLP))[ \t]*$/m', $t, $m)
        && !preg_match('/INSURANCE|CASUALTY|SPINE|CHIRO|CLINIC|MEDICAL|HEALTH|REHAB|CENTER|JOINT/', $m[1])) return trim($m[1]);
    return null;
}

// A law firm's cover letter for a check it forwards: the patient, the
// firm's file number, the insurer, the amount and whether the firm is still
// pursuing benefits or closing its file.
function eob_parse_letter(array $doc): array {
    $t = eob_norm($doc['text']); $u = strtoupper($t);
    $one = preg_replace('/\s+/', ' ', $t);
    $insurer = preg_match('/(?:RECEIVED|CHECK\(?S?\)?)\s+FROM\s+(.{3,80}?)\s+(?:IN\s+THE\s+AMOUNT|FOR\s+THE\s+AMOUNT|TOTALING|\(|,|$)/i', $one, $m) ? trim($m[1]) : null;
    $amount = preg_match('/AMOUNT\s+OF\s+\$\s?([\d,]+[.,]\d{2})/i', $one, $m) ? eob_money($m[1]) : null;
    $firm = null;
    if (preg_match('/^\s*([A-Z][A-Za-z.,&\' ]{2,60}?(?:,?\s+P\.\s?A\.|,?\s+PLLC|,?\s+LLP|,?\s+LLC|\s+LAW\s+(?:GROUP|FIRM|OFFICES?)|\s+&\s+[A-Z][A-Za-z]+))\s*$/m', $t, $m)) $firm = trim($m[1]);
    elseif (preg_match_all('/\b(?:WWW\.)?([A-Z0-9\-]{3,40})[.,]COM\b/', $u, $mm)) { usort($mm[1], fn($a, $b) => strlen($b) <=> strlen($a)); $firm = strtolower($mm[1][0]) . '.com'; }
    $patient = preg_match('/(?:Re:?\s*)?(?:Patient|Client|Our\s+Client|Claimant)\s*:?\s*([A-Z][A-Za-z\'\-]+(?:\s+[A-Z]\.?)?\s+[A-Z][A-Za-z\'\-]+)/', $t, $m) ? trim($m[1]) : null;
    return ['payer' => eob_payer((string)$insurer) ?? $doc['payer'], 'insurer' => $insurer, 'amount' => $amount, 'pages' => $doc['pages'], 'patient' => $patient,
        'fileNumber' => eob_label($t, '(?:Our\s+)?File\s*(?:Number|No\.?|#)', '[A-Z0-9][A-Z0-9\-]{2,20}'),
        'dateOfLoss' => eob_label_date($t, 'Date\s*of\s*(?:Loss|Accident)|D\.?O\.?L\.?'), 'firm' => $firm,
        'date' => eob_first_date($t),
        'fileStatus' => preg_match('/CLOSING\s+OUR\s+FILE|CLOSE\s+OUR\s+FILE|FILE\s+(?:IS|WILL\s+BE)\s+CLOSED|BALANCE\s+OWED/', $u) ? 'closed' : (preg_match('/CONTINU\w*\s+TO\s+PURSUE|ADDITIONAL\s+BENEFITS|REMAINING\s+BALANCE/', $u) ? 'open' : null),
        'interestIncluded' => (bool)preg_match('/\bINTEREST\b/', $u), 'upper' => $u];
}

function eob_first_date(string $t): ?string {
    if (preg_match('/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}|(?<![\d\/])\d{1,2}\/\d{1,2}\/\d{4}(?![\d\/])/', $t, $m)) return eob_date(preg_replace('/,(?=\d)/', ', ', $m[0]));
    return null;
}

// "ONE HUNDRED NINETY-TWO AND 15/100", "SEVENTY-ONE DOLLARS AND SEVENTY-FIVE CENTS" → 192.15, 71.75.
function eob_words_amount(string $t): ?float {
    static $n = ['ZERO' => 0, 'ONE' => 1, 'TWO' => 2, 'THREE' => 3, 'FOUR' => 4, 'FIVE' => 5, 'SIX' => 6, 'SEVEN' => 7, 'EIGHT' => 8, 'NINE' => 9, 'TEN' => 10, 'ELEVEN' => 11, 'TWELVE' => 12,
        'THIRTEEN' => 13, 'FOURTEEN' => 14, 'FIFTEEN' => 15, 'SIXTEEN' => 16, 'SEVENTEEN' => 17, 'EIGHTEEN' => 18, 'NINETEEN' => 19, 'TWENTY' => 20, 'THIRTY' => 30, 'FORTY' => 40,
        'FIFTY' => 50, 'SIXTY' => 60, 'SEVENTY' => 70, 'EIGHTY' => 80, 'NINETY' => 90];
    $u = strtoupper($t);
    // OCR reads I for 1 and l for I in words ("NINETY-IWO").
    $u = preg_replace(['/\bIWO\b/', '/-IWO\b/'], ['TWO', '-TWO'], $u);
    $w = implode('|', array_keys($n));
    if (!preg_match('/((?:(?:' . $w . '|HUNDRED|THOUSAND)[\s\-]+)*(?:' . $w . '|HUNDRED|THOUSAND))\s+(?:DOLLARS?\s+)?AND\s+(?:(\d{1,2})\s*\/\s*1\s?0\s?0|((?:' . $w . ')(?:[\s\-]+(?:' . $w . '))?|NO)\s+CENTS?)/', $u, $m)) return null;
    $total = 0; $cur = 0;
    foreach (preg_split('/[\s\-]+/', trim($m[1])) as $tok) {
        if (isset($n[$tok])) $cur += $n[$tok];
        elseif ($tok === 'HUNDRED') $cur = max(1, $cur) * 100;
        elseif ($tok === 'THOUSAND') { $total += max(1, $cur) * 1000; $cur = 0; }
    }
    $dollars = $total + $cur;
    if (isset($m[2]) && $m[2] !== '') $cents = (int)$m[2];
    else { $cents = 0; if (($m[3] ?? 'NO') !== 'NO') foreach (preg_split('/[\s\-]+/', $m[3]) as $tok) $cents += $n[$tok] ?? 0; }
    return $dollars > 0 || $cents > 0 ? round($dollars + $cents / 100, 2) : null;
}

// The whole upload: documents, the payments matched to them, skipped pages.
function eob_read(string $pdf): array {
    $pages = eob_read_pages($pdf);
    return eob_read_texts($pages) + ['ocr' => eob_ocr_engine()];
}

// Does this check pay this EOB? Same payer, and the amount is what the EOB
// pays (or, when the EOB doesn't print it, what PIP would pay on it).
function eob_check_fits(array $p, array $e): bool {
    if ($p['payer'] && $e['header']['payer'] && $p['payer'] !== $e['header']['payer']) return false;
    // The EOB names this check ("Payment Number", "Check #").
    if ($p['checkNumber'] && strlen($p['checkNumber']) >= 6 && str_contains($e['upper'] ?? '', $p['checkNumber'])) return true;
    if ($p['amount'] === null) return (bool)($p['claim'] && $e['header']['claim'] && eob_same_claim($p['claim'], $e['header']['claim']));
    $t = $e['totals'];
    if ($t['paid'] !== null) return abs($p['amount'] - $t['paid']) < 0.01;
    if ($t['allowed'] === null) return false;
    $ded = (float)($t['deductible'] ?? 0);
    foreach ([round($t['allowed'] * EOB_PIP_RATE, 2), round($t['allowed'] * EOB_PIP_RATE - $ded, 2), round($t['allowed'] - $ded, 2), $t['allowed']] as $v) if (abs($p['amount'] - $v) <= 0.05) return true;
    return false;
}

// An attorney's cover letter goes with the check it forwards: same insurer
// and amount, or the check on the page next to it. A letter whose check
// isn't in the scan still describes the payment.
function eob_pair_letters(array $payments, array $letters): array {
    foreach ($letters as $l) {
        $best = null; $bestScore = 0;
        foreach ($payments as $i => $p) {
            if ($p['letterPages']) continue;
            $score = 0;
            if ($l['amount'] !== null && $p['amount'] !== null && abs($l['amount'] - $p['amount']) < 0.01) $score += 3;
            if ($l['payer'] && $p['payer'] && $l['payer'] === $p['payer']) $score += 2;
            if ($l['payer'] && $p['payer'] && $l['payer'] !== $p['payer']) $score -= 5;
            if (abs(min($p['pages']) - max($l['pages'])) === 1 || abs(max($p['pages']) - min($l['pages'])) === 1) $score += 1;
            if ($score > $bestScore) { $bestScore = $score; $best = $i; }
        }
        if ($best !== null && $bestScore >= 2) {
            $p = &$payments[$best];
            $p['letterPages'] = $l['pages']; $p['pages'] = array_values(array_unique(array_merge($p['pages'], $l['pages']))); sort($p['pages']);
            $p['patient'] = $l['patient'] ?? $p['patient'];          // the check may name the insured, not the patient
            $p['dateOfLoss'] = $p['dateOfLoss'] ?? $l['dateOfLoss'];
            $p['amount'] = $p['amount'] ?? $l['amount']; $p['payer'] = $p['payer'] ?? $l['payer'];
            $p['via'] = $p['via'] ?? $l['firm']; $p['viaRef'] = $l['fileNumber']; $p['fileStatus'] = $l['fileStatus'];
            $p['upper'] .= "\n" . $l['upper'];
            $p['recovery'] = true; $p['interestIncluded'] = $p['interestIncluded'] || $l['interestIncluded'];
            unset($p);
        } else {
            $payments[] = ['payer' => $l['payer'], 'claim' => null, 'pages' => $l['pages'], 'checkNumber' => null, 'amount' => $l['amount'], 'date' => null, 'patient' => $l['patient'],
                'dateOfLoss' => $l['dateOfLoss'], 'recovery' => true, 'interestIncluded' => $l['interestIncluded'], 'interest' => null, 'fees' => null,
                'via' => $l['firm'], 'viaRef' => $l['fileNumber'], 'letterPages' => $l['pages'], 'fileStatus' => $l['fileStatus'], 'checkMissing' => true, 'upper' => $l['upper']];
        }
    }
    usort($payments, fn($a, $b) => min($a['pages']) <=> min($b['pages']));
    return $payments;
}

function eob_read_texts(array $pages): array {
    [$docs, $skipped] = eob_split($pages);
    $eobs = []; $payments = []; $letters = [];
    foreach ($docs as $d) {
        if ($d['kind'] === 'payment') $payments[] = eob_parse_payment($d);
        elseif ($d['kind'] === 'letter') $letters[] = eob_parse_letter($d);
        else $eobs[] = eob_parse_doc($d);
    }
    // The same check is often printed twice (check and stub, or check and
    // payment advice): keep one per check number, preferring one with an amount.
    $byNo = [];
    foreach ($payments as $p) {
        $k = $p['checkNumber'] ?: 'p' . $p['pages'][0];
        if (!isset($byNo[$k])) { $byNo[$k] = $p; continue; }
        $byNo[$k]['pages'] = array_merge($byNo[$k]['pages'], $p['pages']);
        foreach (['amount', 'date', 'claim', 'payer', 'patient', 'dateOfLoss', 'interest', 'fees'] as $f) $byNo[$k][$f] = $byNo[$k][$f] ?? $p[$f];
        foreach (['recovery', 'interestIncluded'] as $f) $byNo[$k][$f] = $byNo[$k][$f] || $p[$f];
    }
    $loose = [];
    foreach ($byNo as $p) {
        $hit = null;
        foreach ($eobs as $i => $e) if (empty($e['payment']) && eob_check_fits($p, $e)) { $hit = $i; break; }
        if ($hit === null) { $loose[] = $p; continue; }
        $e = &$eobs[$hit];
        $e['pages'] = array_values(array_unique(array_merge($e['pages'], $p['pages']))); sort($e['pages']);
        $e['header']['checkNumber'] = $e['header']['checkNumber'] ?: $p['checkNumber'];
        $e['header']['checkDate'] = $e['header']['checkDate'] ?: $p['date'];
        $e['payment'] = $p;
        if ($e['totals']['paid'] === null && $p['amount'] !== null) { $e['totals']['paid'] = $p['amount']; $e = eob_finish($e, $e['upper'] ?? ''); }
        unset($e);
    }
    foreach ($eobs as &$e) unset($e['upper']);
    unset($e);
    $loose = eob_pair_letters($loose, $letters);
    return ['eobs' => $eobs, 'payments' => $loose, 'skipped' => $skipped, 'pageCount' => count($pages)];
}
