<?php
// Prospecting and outreach to clinics that treat auto-accident patients
// (operator only — never touches practice or patient data).
//
// Pipeline, each step a cron job (see app/cli/marketing_*.php):
//   1. Discover  — the free federal NPI Registry lists every licensed
//      chiropractor, orthopedist, physical therapist, pain-management
//      physician, nurse practitioner and nursing facility with a practice
//      address and phone. Walked nationwide by ZIP prefix.
//   2. Research  — a free AI model (Google Gemini, with Google Search) finds
//      each practice's website and whether it treats auto-accident / PIP /
//      personal-injury patients; the site's own pages are read to confirm.
//   3. Contact   — email addresses published on the practice's own site
//      are pulled out directly; a low-cost OpenAI model picks the best
//      contact (and their name) only when that isn't clear. An address is
//      used only if it actually appears on the practice's site (never
//      guessed), and its domain must accept mail.
//   4. Send      — a 3-email sequence (intro with the video, two short
//      follow-ups) inside the send window in the prospect's own time zone;
//      whatever isn't sent by the end of the window waits for the next
//      day. Daily cap with warm-up. Stops on unsubscribe, bounce, signup
//      or reply.
// Every email has a working one-click unsubscribe (link + List-Unsubscribe
// headers), the sender's postal address, and is honored immediately and
// permanently (mkt_suppressions). Sending refuses to run without a postal
// address (CAN-SPAM).

require_once __DIR__ . '/mailer.php';

// Who we look for. NPI taxonomy descriptions to query, and how to address them.
const MKT_SPECIALTIES = [
    'chiro' => ['label' => 'Chiropractors', 'one' => 'chiropractic practice', 'npi' => ['Chiropractor']],
    'ortho' => ['label' => 'Orthopedists', 'one' => 'orthopedic practice', 'npi' => ['Orthopaedic Surgery']],
    'pt' => ['label' => 'Physical therapists', 'one' => 'physical therapy practice', 'npi' => ['Physical Therapist']],
    'pain' => ['label' => 'Pain management', 'one' => 'pain management practice', 'npi' => ['Pain Medicine']],
    'np' => ['label' => 'Nurse practitioners', 'one' => 'practice', 'npi' => ['Nurse Practitioner']],
    'facility' => ['label' => 'Nursing / rehab facilities', 'one' => 'facility', 'npi' => ['Skilled Nursing Facility']],
];

const MKT_DEFAULTS = [
    'enabled' => false,             // sending on/off
    'discover' => false,            // discovery + research on/off
    'specialties' => ['chiro', 'ortho', 'pt', 'pain'],
    'states' => [],                 // empty = all states
    'window_start' => 8, 'window_end' => 12, 'weekdays_only' => true,
    'daily_cap' => 150, 'warmup_start' => 20, 'warmup_step' => 10,
    'follow_up_days' => [4, 10],    // business days after the first email
    'video_url' => '', 'promo' => '',
    'from_name' => 'InjuryCase', 'from_email' => '', 'reply_to' => '', 'postal_address' => '',
    'gemini_model' => 'gemini-flash-lite-latest', 'openai_model' => 'gpt-4o-mini',
    'gemini_daily' => 400, 'openai_daily' => 300, 'discover_daily' => 300, 'research_per_run' => 8,
];

const MKT_AUTO_WORDS = ['auto accident', 'car accident', 'motor vehicle', 'personal injury', 'pip', 'whiplash', 'accident injur', 'no-fault', 'no fault', 'lop', 'letter of protection', 'workers comp', "workers' comp", 'auto injur', 'mva', 'collision'];
const MKT_WEBMAIL = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'msn.com', 'live.com', 'comcast.net', 'att.net', 'bellsouth.net', 'me.com'];

// ---------- settings ----------
function mkt_settings(): array {
    $saved = [];
    foreach (pi_db()->query('SELECT k, v FROM mkt_settings') as $r) $saved[$r['k']] = json_decode($r['v'], true);
    return array_merge(MKT_DEFAULTS, array_intersect_key($saved, MKT_DEFAULTS));
}

function mkt_save_settings(array $in): array {
    $cur = mkt_settings();
    $s = $cur;
    foreach (MKT_DEFAULTS as $k => $def) {
        if (!array_key_exists($k, $in)) continue;
        $v = $in[$k];
        if (is_bool($def)) $v = (bool)$v;
        elseif (is_int($def)) $v = (int)$v;
        elseif (is_array($def)) $v = array_values(array_filter((array)$v, 'is_scalar'));
        else $v = trim((string)$v);
        $s[$k] = $v;
    }
    $s['specialties'] = array_values(array_intersect(array_keys(MKT_SPECIALTIES), $s['specialties']));
    $s['states'] = array_values(array_filter(array_map(fn($x) => strtoupper(substr((string)$x, 0, 2)), $s['states']), fn($x) => isset(US_STATES[$x])));
    $s['window_start'] = max(0, min(23, $s['window_start'])); $s['window_end'] = max($s['window_start'] + 1, min(24, $s['window_end']));
    $s['follow_up_days'] = array_slice(array_map(fn($d) => max(1, min(60, (int)$d)), $s['follow_up_days']), 0, 4);
    foreach (['daily_cap' => [1, 2000], 'warmup_start' => [1, 500], 'warmup_step' => [0, 200], 'gemini_daily' => [0, 100000], 'openai_daily' => [0, 100000], 'discover_daily' => [0, 20000], 'research_per_run' => [1, 100]] as $k => [$lo, $hi]) $s[$k] = max($lo, min($hi, $s[$k]));
    foreach (['from_email', 'reply_to'] as $k) if ($s[$k] !== '' && !filter_var($s[$k], FILTER_VALIDATE_EMAIL)) throw new RuntimeException("Check the $k address.");
    if ($s['video_url'] !== '' && !preg_match('#^https://#', $s['video_url'])) throw new RuntimeException('The video link must start with https://');
    $ins = pi_db()->prepare('REPLACE INTO mkt_settings (k, v) VALUES (?, ?)');
    foreach ($s as $k => $v) $ins->execute([$k, json_encode($v)]);
    return $s;
}

// Why sending can't run, or null.
function mkt_send_blocker(array $s): ?string {
    if (!$s['enabled']) return 'Sending is switched off.';
    if (trim($s['postal_address']) === '') return 'Add your postal mailing address (required by law in every marketing email).';
    if ($s['from_email'] === '') return 'Add the address emails come from.';
    if (!mkt_smtp()) return 'The marketing mail account (MKT_SMTP_HOST) isn\'t set up in secrets.php.';
    return null;
}

// The marketing SMTP account — kept separate from the app's own email
// (trial reminders, alerts) so outreach can never affect their delivery.
function mkt_smtp(): ?array {
    if (!defined('MKT_SMTP_HOST') || MKT_SMTP_HOST === '') return null;
    return ['host' => MKT_SMTP_HOST, 'port' => defined('MKT_SMTP_PORT') ? (int)MKT_SMTP_PORT : null, 'secure' => defined('MKT_SMTP_SECURE') ? MKT_SMTP_SECURE : 'tls',
        'user' => defined('MKT_SMTP_USER') ? MKT_SMTP_USER : '', 'pass' => defined('MKT_SMTP_PASS') ? MKT_SMTP_PASS : '', 'from' => mkt_settings()['from_email']];
}

function mkt_secret(string $name): string {
    if (defined($name) && constant($name) !== '') return (string)constant($name);
    return (string)(getenv($name) ?: '');
}

function mkt_base(string $name, string $default): string { return defined($name) ? constant($name) : $default; }

function mkt_log(?int $prospectId, string $kind, ?string $detail = null) {
    pi_db()->prepare('INSERT INTO mkt_events (prospect_id, kind, detail, ip, at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$prospectId, $kind, $detail === null ? null : mb_substr($detail, 0, 255), $_SERVER['REMOTE_ADDR'] ?? null, now_str()]);
}

// ---------- HTTP and AI ----------
function mkt_http(string $method, string $url, ?array $json = null, array $headers = [], int $timeout = 45): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 4, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_USERAGENT => 'InjuryCaseBot/1.0 (+https://injurycase.com/legal.html; business contact research)',
        CURLOPT_HTTPHEADER => array_merge($json !== null ? ['Content-Type: application/json'] : [], $headers), CURLOPT_MAXFILESIZE => 2 * 1024 * 1024]);
    if ($json !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($json));
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $final = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    return ['code' => $code, 'body' => $body === false ? '' : $body, 'url' => $final, 'type' => $type];
}

// Daily AI call budgets (the free tier has daily limits; OpenAI costs money).
function mkt_ai_take(string $provider, int $limit): bool {
    $day = date('Y-m-d');
    $s = pi_db()->prepare('SELECT calls FROM mkt_ai_usage WHERE day = ? AND provider = ?');
    $s->execute([$day, $provider]);
    if ((int)$s->fetchColumn() >= $limit) return false;
    pi_db()->prepare('INSERT INTO mkt_ai_usage (day, provider, calls) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE calls = calls + 1')->execute([$day, $provider]);
    return true;
}

function mkt_ai_tokens(string $provider, int $n) {
    pi_db()->prepare('UPDATE mkt_ai_usage SET tokens = tokens + ? WHERE day = ? AND provider = ?')->execute([$n, date('Y-m-d'), $provider]);
}

// The first JSON object or array in a model's reply.
function mkt_json(string $text): ?array {
    $text = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($text));
    if (($j = json_decode($text, true)) !== null) return is_array($j) ? $j : null;
    if (preg_match('/(\{.*\}|\[.*\])/s', $text, $m) && is_array($j = json_decode($m[1], true))) return $j;
    return null;
}

// Free model (Gemini). $search: let it use Google Search.
function mkt_gemini(string $prompt, bool $search, array $s): ?array {
    $key = mkt_secret('GEMINI_API_KEY');
    if ($key === '' || !mkt_ai_take('gemini', $s['gemini_daily'])) return null;
    $body = ['contents' => [['parts' => [['text' => $prompt]]]], 'generationConfig' => ['temperature' => 0]];
    if ($search) $body['tools'] = [['google_search' => (object)[]]];
    $r = mkt_http('POST', mkt_base('MKT_GEMINI_BASE', 'https://generativelanguage.googleapis.com/v1beta/') . 'models/' . rawurlencode($s['gemini_model']) . ':generateContent', $body, ['x-goog-api-key: ' . $key], 90);
    $d = json_decode($r['body'], true);
    if ($r['code'] !== 200 || !isset($d['candidates'][0]['content']['parts'])) { pi_log_error('Gemini ' . $r['code'] . ': ' . mb_substr($r['body'], 0, 200)); return null; }
    mkt_ai_tokens('gemini', (int)($d['usageMetadata']['totalTokenCount'] ?? 0));
    return mkt_json((string)end($d['candidates'][0]['content']['parts'])['text']);
}

// Low-cost OpenAI model, JSON reply.
function mkt_openai(string $system, string $user, array $s): ?array {
    $key = mkt_secret('OPENAI_API_KEY');
    if ($key === '' || !mkt_ai_take('openai', $s['openai_daily'])) return null;
    $r = mkt_http('POST', mkt_base('MKT_OPENAI_BASE', 'https://api.openai.com/v1/') . 'chat/completions',
        ['model' => $s['openai_model'], 'temperature' => 0, 'response_format' => ['type' => 'json_object'], 'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $user]]],
        ['Authorization: Bearer ' . $key], 60);
    $d = json_decode($r['body'], true);
    if ($r['code'] !== 200 || !isset($d['choices'][0]['message']['content'])) { pi_log_error('OpenAI ' . $r['code'] . ': ' . mb_substr($r['body'], 0, 200)); return null; }
    mkt_ai_tokens('openai', (int)($d['usage']['total_tokens'] ?? 0));
    return mkt_json($d['choices'][0]['message']['content']);
}

// ---------- 1. discovery (NPI Registry) ----------
function mkt_digits(?string $s): string { return preg_replace('/\D/', '', (string)$s); }

// Adds new prospects, walking (specialty, ZIP prefix) pages. Returns how many were added.
function mkt_discover(array $s, int $budget): int {
    $pdo = pi_db();
    $ins = $pdo->prepare('INSERT IGNORE INTO mkt_discovery (specialty, zip_prefix) VALUES (?, ?)');
    foreach ($s['specialties'] as $sp) for ($i = 0; $i < 100; $i++) $ins->execute([$sp, sprintf('%02d', $i)]);
    $added = 0;
    $cursors = $pdo->query("SELECT * FROM mkt_discovery WHERE done_at IS NULL AND specialty IN ('" . implode("','", array_map('addslashes', $s['specialties'])) . "') ORDER BY RAND() LIMIT 40")->fetchAll();
    foreach ($cursors as $c) {
        if ($added >= $budget) break;
        $descs = MKT_SPECIALTIES[$c['specialty']]['npi'];
        $rows = [];
        foreach ($descs as $desc) {
            $url = mkt_base('MKT_NPI_BASE', 'https://npiregistry.cms.hhs.gov/api/') . '?' . http_build_query(['version' => '2.1', 'taxonomy_description' => $desc, 'postal_code' => $c['zip_prefix'] . '*', 'address_purpose' => 'LOCATION', 'limit' => 200, 'skip' => (int)$c['skip']]);
            $r = mkt_http('GET', $url);
            $d = json_decode($r['body'], true);
            if ($r['code'] !== 200 || !is_array($d)) { pi_log_error('NPI ' . $r['code']); continue 2; }
            $rows = array_merge($rows, $d['results'] ?? []);
        }
        foreach ($rows as $row) if (mkt_add_from_npi($row, $c['specialty'], $s)) $added++;
        $full = count($rows) >= 200;
        $next = (int)$c['skip'] + 200;
        if ($full && $next < 1200) $pdo->prepare('UPDATE mkt_discovery SET skip = ? WHERE specialty = ? AND zip_prefix = ?')->execute([$next, $c['specialty'], $c['zip_prefix']]);
        else {
            $pdo->prepare('UPDATE mkt_discovery SET done_at = ? WHERE specialty = ? AND zip_prefix = ?')->execute([now_str(), $c['specialty'], $c['zip_prefix']]);
            // The registry stops at 1,200 results: split a busy prefix one digit finer.
            if ($full && strlen($c['zip_prefix']) < 4) for ($i = 0; $i < 10; $i++) $ins->execute([$c['specialty'], $c['zip_prefix'] . $i]);
        }
    }
    return $added;
}

// One registry entry → a prospect (one per practice location: providers
// at the same phone number are the same practice).
function mkt_add_from_npi(array $r, string $specialty, array $s): bool {
    $loc = null;
    foreach ($r['addresses'] ?? [] as $a) if (($a['address_purpose'] ?? '') === 'LOCATION') $loc = $a;
    if (!$loc || ($loc['country_code'] ?? 'US') !== 'US') return false;
    $state = strtoupper((string)($loc['state'] ?? ''));
    if ($s['states'] && !in_array($state, $s['states'], true)) return false;
    $b = $r['basic'] ?? [];
    $org = ($r['enumeration_type'] ?? '') === 'NPI-2';
    if (($b['status'] ?? 'A') !== 'A') return false;
    $person = trim(ucwords(strtolower(trim(($b['first_name'] ?? '') . ' ' . ($b['last_name'] ?? '')))));
    $cred = trim((string)($b['credential'] ?? ''));
    $name = $org ? trim((string)($b['organization_name'] ?? '')) : ($person . ($cred ? ', ' . str_replace('.', '', $cred) : ''));
    if ($name === '') return false;
    $phone = mkt_digits($loc['telephone_number'] ?? '');
    $pdo = pi_db();
    if ($phone !== '') {
        $dup = $pdo->prepare('SELECT id, contact_name FROM mkt_prospects WHERE phone = ? LIMIT 1');
        $dup->execute([$phone]);
        if ($d = $dup->fetch()) {
            if (!$org && !$d['contact_name'] && $person) $pdo->prepare('UPDATE mkt_prospects SET contact_name = ? WHERE id = ?')->execute([$person, $d['id']]);
            return false;
        }
    }
    $zip = substr(mkt_digits($loc['postal_code'] ?? ''), 0, 5);
    $ins = $pdo->prepare("INSERT IGNORE INTO mkt_prospects (source, npi, name, specialty, contact_name, phone, address, city, state, zip, token, created_at, updated_at) VALUES ('npi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    // The registry writes most names in capitals.
    if (!preg_match('/[a-z]/', $name)) $name = ucwords(strtolower($name));
    $ins->execute([(string)($r['number'] ?? ''), mb_substr($name, 0, 200), $specialty, $org ? null : ($person ?: null), $phone ?: null,
        mb_substr(trim(($loc['address_1'] ?? '') . ' ' . ($loc['address_2'] ?? '')), 0, 255), mb_substr(ucwords(strtolower((string)($loc['city'] ?? ''))), 0, 80), $state ?: null, $zip ?: null,
        bin2hex(random_bytes(16)), now_str(), now_str()]);
    return $ins->rowCount() > 0;
}

// ---------- 2–3. research: website, fit, contact ----------
function mkt_host(string $url): string { return strtolower(preg_replace('/^www\./', '', (string)parse_url($url, PHP_URL_HOST))); }

// robots.txt: skip a site that disallows its pages to all bots.
function mkt_robots_ok(string $url): bool {
    $p = parse_url($url);
    if (empty($p['host'])) return false;
    $r = mkt_http('GET', ($p['scheme'] ?? 'https') . '://' . $p['host'] . '/robots.txt', null, [], 10);
    if ($r['code'] !== 200) return true;
    $applies = false; $path = $p['path'] ?? '/';
    foreach (preg_split('/\R/', $r['body']) as $line) {
        $line = trim(preg_replace('/#.*/', '', $line));
        if (stripos($line, 'user-agent:') === 0) $applies = in_array(trim(substr($line, 11)), ['*', 'InjuryCaseBot'], true);
        elseif ($applies && stripos($line, 'disallow:') === 0) { $rule = trim(substr($line, 9)); if ($rule !== '' && str_starts_with($path, $rule)) return false; }
    }
    return true;
}

// Visible text of a page.
function mkt_text(string $html): string {
    $html = preg_replace('#<(script|style|noscript|svg)[^>]*>.*?</\1>#is', ' ', $html);
    return trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags(str_replace(['<br', '</p', '</div', '</li', '</h'], ["\n<br", "\n</p", "\n</div", "\n</li", "\n</h"], $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
}

// Email addresses written on a page (mailto links, plain or "name [at] domain").
function mkt_emails(string $html): array {
    $t = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = preg_replace('/\s*(\[at\]|\(at\)|\{at\}| at )\s*/i', '@', $t);
    $t = preg_replace('/\s*(\[dot\]|\(dot\)| dot )\s*/i', '.', $t);
    preg_match_all('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}/', $t, $m);
    $out = [];
    foreach ($m[0] as $e) {
        $e = strtolower(trim($e, '.'));
        if (preg_match('/\.(png|jpe?g|gif|webp|svg|css|js)$/', $e) || preg_match('/(sentry|wixpress|example\.|domain\.com|email\.com|yourdomain|godaddy|squarespace|@2x|noreply|no-reply|donotreply)/', $e)) continue;
        if (filter_var($e, FILTER_VALIDATE_EMAIL)) $out[$e] = true;
    }
    return array_keys($out);
}

// The practice's home page plus up to 3 likely pages (contact, about,
// services / auto accident). Returns [url, text, emails, html] or null.
function mkt_fetch_site(string $url): ?array {
    if (!preg_match('#^https?://#i', $url)) $url = 'https://' . $url;
    if (!mkt_robots_ok($url)) return null;
    $home = mkt_http('GET', $url, null, [], 20);
    if ($home['code'] !== 200 || stripos($home['type'], 'html') === false) return null;
    $base = $home['url'];
    $host = mkt_host($base);
    $pages = [$home['body']];
    preg_match_all('#href=["\']([^"\'\#]+)["\']#i', $home['body'], $m);
    $links = [];
    foreach (array_unique($m[1]) as $href) {
        $abs = preg_match('#^https?://#i', $href) ? $href : (str_starts_with($href, '/') ? preg_replace('#^(https?://[^/]+).*$#', '$1', $base) . $href : rtrim($base, '/') . '/' . $href);
        if (mkt_host($abs) !== $host) continue;
        $score = preg_match('/contact/i', $abs) ? 3 : (preg_match('/(auto|accident|injur|pip|whiplash)/i', $abs) ? 2 : (preg_match('/(about|team|staff|services|new-patient)/i', $abs) ? 1 : 0));
        if ($score) $links[$abs] = max($links[$abs] ?? 0, $score);
    }
    arsort($links);
    foreach (array_slice(array_keys($links), 0, 3) as $l) { $r = mkt_http('GET', $l, null, [], 20); if ($r['code'] === 200 && stripos($r['type'], 'html') !== false) $pages[] = $r['body']; }
    $html = implode("\n", $pages);
    return ['url' => $base, 'text' => mb_substr(mkt_text($html), 0, 15000), 'emails' => mkt_emails($html), 'html' => $html];
}

function mkt_auto_evidence(string $text): ?string {
    $t = strtolower($text);
    foreach (MKT_AUTO_WORDS as $w) {
        if (!preg_match('/(^|[^a-z])' . preg_quote($w, '/') . '/', $t, $m, PREG_OFFSET_CAPTURE)) continue;
        if (in_array($w, ['pip', 'lop', 'mva'], true) && !preg_match('/(^|[^a-z])(pip|lop|mva)([^a-z]|$)/', $t)) continue;
        $at = $m[0][1];
        return trim(mb_substr($text, max(0, $at - 60), 180));
    }
    return null;
}

// The best address to write to: on the practice's own domain, preferring
// the office / front desk / manager over billing or careers addresses.
function mkt_pick_email(array $emails, string $siteHost): array {
    $score = function ($e) use ($siteHost) {
        [$local, $dom] = explode('@', $e);
        $s = 0;
        if ($dom === $siteHost || str_ends_with($dom, '.' . $siteHost)) $s += 10;
        elseif (in_array($dom, MKT_WEBMAIL, true)) $s += 4;
        if (preg_match('/^(office|info|frontdesk|front\.desk|contact|hello|admin|manager|officemanager|reception|appointments?|dr|doctor)/', $local)) $s += 3;
        if (preg_match('/(billing|careers|jobs|hr|records|fax|marketing|press|abuse|privacy|webmaster)/', $local)) $s -= 6;
        return $s;
    };
    usort($emails, fn($a, $b) => $score($b) <=> $score($a));
    $top = $emails[0] ?? null;
    $clear = $top && $score($top) >= 10 && (count($emails) === 1 || $score($top) > $score($emails[1]));
    return [$top, $clear, $top ? $score($top) : 0];
}

function mkt_domain_accepts_mail(string $email): bool {
    $d = substr(strrchr($email, '@'), 1);
    if (defined('MKT_SKIP_MX_CHECK') && MKT_SKIP_MX_CHECK) return true;
    return checkdnsrr($d, 'MX') || checkdnsrr($d, 'A');
}

function mkt_suppressed(string $email): bool {
    $e = strtolower($email);
    $s = pi_db()->prepare('SELECT 1 FROM mkt_suppressions WHERE email = ? OR email = ? LIMIT 1');
    $s->execute([$e, '@' . substr(strrchr($e, '@'), 1)]);
    if ($s->fetchColumn()) return true;
    // Already a customer (any user of any practice): never market to them.
    $u = pi_db()->prepare('SELECT 1 FROM users WHERE LOWER(email) = ? LIMIT 1');
    $u->execute([$e]);
    return (bool)$u->fetchColumn();
}

function mkt_set(int $id, array $cols) {
    $cols['updated_at'] = now_str();
    pi_db()->prepare('UPDATE mkt_prospects SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($cols))) . ' WHERE id = ?')->execute([...array_values($cols), $id]);
}

// Research one new prospect: website and fit (free model), then contact
// (site text first, low-cost model only when needed).
function mkt_research(array $p, array $s): string {
    $sp = MKT_SPECIALTIES[$p['specialty']] ?? MKT_SPECIALTIES['chiro'];
    $where = trim($p['address'] . ', ' . $p['city'] . ', ' . $p['state'] . ' ' . $p['zip'], ' ,');
    $found = null; $evidence = null; $fit = null;
    $website = $p['website'];
    if (!$website) {
        $g = mkt_gemini("Use Google Search. Find the official website of this healthcare provider and whether it treats auto accident / car accident / personal injury / PIP / no-fault patients.\n"
            . "Provider: {$p['name']} ({$sp['one']})\nAddress: $where\nPhone: {$p['phone']}\n"
            . 'Reply with JSON only: {"website": "https://… or null", "treats_auto_accident": true|false|null, "evidence": "short quote from a search result or null", "practice_name": "name used on its website or null"}. Use only facts from search results; never guess a website.', true, $s);
        if ($g === null) return 'ai_unavailable';
        $website = is_string($g['website'] ?? null) && preg_match('#^https?://#', $g['website']) ? $g['website'] : null;
        if (($g['treats_auto_accident'] ?? null) === true) { $fit = 70; $evidence = mb_substr((string)($g['evidence'] ?? ''), 0, 400); }
        elseif (($g['treats_auto_accident'] ?? null) === false) $fit = 10;
    }
    if ($website) $found = mkt_fetch_site($website);
    if ($found) {
        if ($e = mkt_auto_evidence($found['text'])) { $fit = max($fit ?? 0, 85); $evidence = $e; }
        elseif ($fit === null) {
            $g = mkt_gemini("Here is text from a healthcare practice's website. Does the practice treat patients injured in auto / car accidents (personal injury, PIP, no-fault, motor vehicle accidents)? Reply JSON only: {\"treats_auto_accident\": true|false, \"evidence\": \"short quote or null\"}.\n\n" . mb_substr($found['text'], 0, 8000), false, $s);
            if ($g !== null) { $fit = ($g['treats_auto_accident'] ?? false) === true ? 70 : 15; $evidence = mb_substr((string)($g['evidence'] ?? ''), 0, 400) ?: null; }
        }
    }
    $cols = ['researched_at' => now_str(), 'website' => $found['url'] ?? $website, 'fit_score' => $fit, 'fit_evidence' => $evidence];
    if ($fit === null || $fit < 50) { mkt_set((int)$p['id'], $cols + ['status' => 'not_fit']); return 'not_fit'; }

    // Contact: an address published on the practice's own site.
    $email = null; $source = null; $name = $p['contact_name']; $role = null;
    if ($found && $found['emails']) {
        [$top, $clear] = mkt_pick_email($found['emails'], mkt_host($found['url']));
        if ($clear) { $email = $top; $source = 'site'; }
    }
    if ((!$email || !$name) && $found) {
        $o = mkt_openai('You extract business contact details from a healthcare practice website. Reply with JSON only.',
            "Practice: {$p['name']}\nWebsite text:\n" . mb_substr($found['text'], 0, 6000) . "\n\nEmail addresses on the site: " . implode(', ', $found['emails']) .
            "\n\nReturn {\"email\": the best address to reach the office manager, practice owner or front desk about software (must be one of the addresses listed above, or null), \"contact_name\": person's name if the site names the owner/doctor or office manager, else null, \"role\": their role or null}.", $s);
        if ($o) {
            $cand = strtolower(trim((string)($o['email'] ?? '')));
            if (!$email && $cand !== '' && in_array($cand, $found['emails'], true)) { $email = $cand; $source = 'ai'; }
            if (!$name && !empty($o['contact_name']) && mb_strlen($o['contact_name']) <= 80) { $name = trim($o['contact_name']); $role = mb_substr((string)($o['role'] ?? ''), 0, 80) ?: null; }
        } elseif (!$email && $found['emails']) { [$top] = mkt_pick_email($found['emails'], mkt_host($found['url'])); $email = $top; $source = 'site'; }
    }
    $cols += ['contact_name' => $name, 'contact_role' => $role];
    if (!$email || !mkt_domain_accepts_mail($email)) { mkt_set((int)$p['id'], $cols + ['status' => 'no_email']); return 'no_email'; }
    if (mkt_suppressed($email)) { mkt_set((int)$p['id'], $cols + ['email' => $email, 'email_source' => $source, 'status' => 'unsubscribed']); return 'suppressed'; }
    // One prospect per address (several NPIs can share an office email).
    $dup = pi_db()->prepare('SELECT 1 FROM mkt_prospects WHERE email = ? AND id <> ? LIMIT 1');
    $dup->execute([$email, $p['id']]);
    if ($dup->fetchColumn()) { mkt_set((int)$p['id'], $cols + ['status' => 'done', 'error' => 'same email as another prospect']); return 'duplicate'; }
    mkt_set((int)$p['id'], $cols + ['email' => $email, 'email_source' => $source, 'status' => 'ready', 'next_send_at' => now_str()]);
    return 'ready';
}

// ---------- 4. sending ----------
const MKT_STATE_TZ = ['AL' => 'America/Chicago', 'AK' => 'America/Anchorage', 'AZ' => 'America/Phoenix', 'AR' => 'America/Chicago', 'CA' => 'America/Los_Angeles', 'CO' => 'America/Denver', 'CT' => 'America/New_York', 'DE' => 'America/New_York', 'DC' => 'America/New_York',
    'FL' => 'America/New_York', 'GA' => 'America/New_York', 'HI' => 'Pacific/Honolulu', 'ID' => 'America/Boise', 'IL' => 'America/Chicago', 'IN' => 'America/Indiana/Indianapolis', 'IA' => 'America/Chicago', 'KS' => 'America/Chicago', 'KY' => 'America/New_York',
    'LA' => 'America/Chicago', 'ME' => 'America/New_York', 'MD' => 'America/New_York', 'MA' => 'America/New_York', 'MI' => 'America/Detroit', 'MN' => 'America/Chicago', 'MS' => 'America/Chicago', 'MO' => 'America/Chicago', 'MT' => 'America/Denver', 'NE' => 'America/Chicago',
    'NV' => 'America/Los_Angeles', 'NH' => 'America/New_York', 'NJ' => 'America/New_York', 'NM' => 'America/Denver', 'NY' => 'America/New_York', 'NC' => 'America/New_York', 'ND' => 'America/Chicago', 'OH' => 'America/New_York', 'OK' => 'America/Chicago', 'OR' => 'America/Los_Angeles',
    'PA' => 'America/New_York', 'RI' => 'America/New_York', 'SC' => 'America/New_York', 'SD' => 'America/Chicago', 'TN' => 'America/Chicago', 'TX' => 'America/Chicago', 'UT' => 'America/Denver', 'VT' => 'America/New_York', 'VA' => 'America/New_York', 'WA' => 'America/Los_Angeles',
    'WV' => 'America/New_York', 'WI' => 'America/Chicago', 'WY' => 'America/Denver', 'PR' => 'America/Puerto_Rico'];

// Whether it's inside the send window where the prospect is.
function mkt_in_window(?string $state, array $s, ?int $now = null): bool {
    $dt = new DateTime('@' . ($now ?? time()));
    $dt->setTimezone(new DateTimeZone(MKT_STATE_TZ[$state ?? ''] ?? 'America/New_York'));
    if ($s['weekdays_only'] && (int)$dt->format('N') >= 6) return false;
    $h = (int)$dt->format('G');
    return $h >= $s['window_start'] && $h < $s['window_end'];
}

// Today's limit: warm-up from the first sending day up to the daily cap.
function mkt_today_cap(array $s): int {
    $first = pi_db()->query('SELECT MIN(DATE(sent_at)) FROM mkt_sends WHERE ok = 1')->fetchColumn();
    $days = $first ? (int)floor((strtotime(date('Y-m-d')) - strtotime($first)) / 86400) : 0;
    return min($s['daily_cap'], $s['warmup_start'] + $days * $s['warmup_step']);
}

function mkt_sent_today(): int {
    return (int)pi_db()->query("SELECT COUNT(*) FROM mkt_sends WHERE ok = 1 AND sent_at >= '" . date('Y-m-d') . " 00:00:00'")->fetchColumn();
}

function mkt_add_business_days(string $date, int $n): string {
    $t = strtotime($date);
    while ($n > 0) { $t += 86400; if ((int)date('N', $t) < 6) $n--; }
    return date('Y-m-d', $t);
}

// Sends what's due (up to $max this run). Returns [sent, failed, waiting].
function mkt_send_due(array $s, int $max, ?int $now = null): array {
    if (mkt_send_blocker($s)) return [0, 0, 0];
    $room = max(0, mkt_today_cap($s) - mkt_sent_today());
    $max = min($max, $room);
    $pdo = pi_db();
    $due = $pdo->query("SELECT * FROM mkt_prospects WHERE status IN ('ready','in_sequence') AND email IS NOT NULL AND next_send_at <= '" . date('Y-m-d H:i:s', $now ?? time()) . "' ORDER BY next_send_at, id LIMIT 2000")->fetchAll();
    $sent = 0; $failed = 0; $waiting = 0;
    foreach ($due as $p) {
        if (!mkt_in_window($p['state'], $s, $now)) { $waiting++; continue; }   // waits for its window (tomorrow, if today's has passed)
        if ($sent + $failed >= $max) { $waiting++; continue; }
        if (mkt_suppressed($p['email'])) { mkt_set((int)$p['id'], ['status' => 'unsubscribed', 'next_send_at' => null]); continue; }
        $r = mkt_send_one($p, (int)$p['step'] + 1, $s);
        $r['ok'] ? $sent++ : $failed++;
    }
    return [$sent, $failed, $waiting];
}

function mkt_send_one(array $p, int $step, array $s, ?string $to = null): array {
    [$subject, $html, $text] = mkt_render($p, $step, $s);
    $u = mkt_links($p);
    $res = send_mail_html(mkt_smtp(), $to ?? $p['email'], $subject, $text, $html, [
        'from' => $s['from_email'], 'from_name' => $s['from_name'], 'reply_to' => $s['reply_to'] ?: $s['from_email'],
        'headers' => ['List-Unsubscribe: <' . $u['unsub_post'] . '>, <mailto:' . ($s['reply_to'] ?: $s['from_email']) . '?subject=unsubscribe>', 'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
            'Precedence: bulk', 'X-Auto-Response-Suppress: OOF, AutoReply', 'Feedback-ID: s' . $step . ':outreach:injurycase']]);
    if ($to !== null) return $res;    // a test send
    pi_db()->prepare('INSERT INTO mkt_sends (prospect_id, step, email, subject, ok, error, sent_at) VALUES (?,?,?,?,?,?,?)')->execute([$p['id'], $step, $p['email'], $subject, $res['ok'] ? 1 : 0, $res['error'], now_str()]);
    if ($res['ok']) {
        $more = $step <= count($s['follow_up_days']);
        $next = $more ? mkt_add_business_days(date('Y-m-d'), $s['follow_up_days'][$step - 1] - ($step > 1 ? $s['follow_up_days'][$step - 2] : 0)) . ' 00:00:00' : null;
        mkt_set((int)$p['id'], ['step' => $step, 'last_sent_at' => now_str(), 'status' => $more ? 'in_sequence' : 'done', 'next_send_at' => $next, 'attempts' => 0, 'error' => null]);
    } elseif ($res['permanent']) {
        mkt_suppress($p['email'], 'bounce');
        mkt_set((int)$p['id'], ['status' => 'bounced', 'next_send_at' => null, 'error' => $res['error']]);
        mkt_log((int)$p['id'], 'bounce', $res['error']);
    } else {
        $a = (int)$p['attempts'] + 1;
        mkt_set((int)$p['id'], ['attempts' => $a, 'error' => $res['error']] + ($a >= 3 ? ['status' => 'error', 'next_send_at' => null] : ['next_send_at' => date('Y-m-d H:i:s', time() + 3600)]));
    }
    return $res;
}

function mkt_suppress(string $email, string $reason) {
    pi_db()->prepare('INSERT IGNORE INTO mkt_suppressions (email, reason, created_at) VALUES (?, ?, ?)')->execute([strtolower(trim($email)), $reason, now_str()]);
}

// Stop everything for a prospect (unsubscribe, complaint, bounce): their
// address and any other prospect with the same address.
function mkt_unsubscribe(array $p, string $reason = 'unsubscribe') {
    if ($p['email']) {
        mkt_suppress($p['email'], $reason);
        pi_db()->prepare("UPDATE mkt_prospects SET status = 'unsubscribed', next_send_at = NULL, updated_at = ? WHERE email = ? AND status <> 'converted'")->execute([now_str(), $p['email']]);
    }
    mkt_set((int)$p['id'], ['status' => $p['status'] === 'converted' ? 'converted' : 'unsubscribed', 'next_send_at' => null]);
    mkt_log((int)$p['id'], $reason);
}

function mkt_prospect_by_token(string $t): ?array {
    if (!preg_match('/^[a-f0-9]{32}$/', $t)) return null;
    $s = pi_db()->prepare('SELECT * FROM mkt_prospects WHERE token = ?');
    $s->execute([$t]);
    return $s->fetch() ?: null;
}

// A new practice that came from outreach (signup link, or the same email).
function mkt_mark_converted(int $practiceId, ?string $ref, string $email) {
    $p = $ref ? mkt_prospect_by_token($ref) : null;
    if (!$p) { $s = pi_db()->prepare('SELECT * FROM mkt_prospects WHERE email = ? LIMIT 1'); $s->execute([strtolower($email)]); $p = $s->fetch() ?: null; }
    if (!$p) return;
    mkt_set((int)$p['id'], ['status' => 'converted', 'converted_practice_id' => $practiceId, 'next_send_at' => null]);
    mkt_log((int)$p['id'], 'signup', 'practice ' . $practiceId);
}

// ---------- the emails ----------
function mkt_links(array $p): array {
    $t = $p['token'];
    $c = fn($l) => APP_URL . '/api/m.php?a=c&t=' . $t . '&l=' . $l;
    return ['video' => $c('video'), 'trial' => $c('trial'), 'site' => $c('site'), 'unsub' => APP_URL . '/unsubscribe.html?t=' . $t, 'unsub_post' => APP_URL . '/api/m.php?a=u&t=' . $t];
}

function mkt_greeting(array $p): string {
    $n = trim((string)$p['contact_name']);
    if ($n === '') return 'Hi there';
    $parts = preg_split('/\s+/', preg_replace('/,.*$/', '', $n));
    $doctor = $p['source'] === 'npi' && in_array($p['specialty'], ['chiro', 'ortho', 'pain'], true) && !$p['contact_role'];
    return $doctor ? 'Hi Dr. ' . end($parts) : 'Hi ' . $parts[0];
}

// [subject, html, text] for step 1 (introduction with the video), 2 and 3.
function mkt_render(array $p, int $step, array $s): array {
    $u = mkt_links($p);
    $sp = MKT_SPECIALTIES[$p['specialty']] ?? MKT_SPECIALTIES['chiro'];
    $h = fn($x) => htmlspecialchars((string)$x, ENT_QUOTES, 'UTF-8');
    $practice = trim((string)$p['name']);
    $hi = mkt_greeting($p);
    $video = $s['video_url'] !== '';
    $img = APP_URL . '/assets/email';
    $subjects = [
        1 => ["Better outcomes for your auto-accident patients", "Less chasing, better PI outcomes at {$practice}"],
        2 => ["Did you catch the 2-minute tour?", "Quick question about your PI cases"],
        3 => ["Last note — your free InjuryCase trial", "Closing the loop"],
    ];
    $subject = $subjects[$step][$p['id'] % 2] ?? $subjects[1][0];
    if (mb_strlen($subject) > 90) $subject = $subjects[$step][0];

    $btn = fn($label, $href) => '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0"><tr><td bgcolor="#1FA866" style="border-radius:10px">'
        . '<a href="' . $h($href) . '" style="display:inline-block;padding:15px 28px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#0B2340;text-decoration:none;border-radius:10px">' . $h($label) . '</a></td></tr></table>';
    $benefit = fn($icon, $title, $text) => '<tr><td valign="top" width="52" style="padding:10px 14px 10px 0"><div style="width:44px;height:44px;line-height:44px;border-radius:22px;background:#E3F6EC;text-align:center;font-size:22px">' . $icon . '</div></td>'
        . '<td valign="top" style="padding:10px 0;font-family:Arial,Helvetica,sans-serif"><div style="font-size:17px;font-weight:bold;color:#0B2340">' . $h($title) . '</div><div style="font-size:15px;line-height:22px;color:#3B4D63;margin-top:3px">' . $h($text) . '</div></td></tr>';
    $p_ = fn($t) => '<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#22344A">' . $t . '</p>';
    $trialLine = '14-day free trial &middot; No credit card &middot; No strings attached';

    if ($step === 1) {
        $body = $p_($h($hi) . ',')
            . $p_('Auto-accident cases are some of the most rewarding patients a ' . $h($sp['one']) . ' sees — and the most paperwork-heavy. Missed PIP deadlines, gaps in care, attorneys waiting on updates and a front desk juggling spreadsheets all cost patients and practices.')
            . $p_('<strong>InjuryCase</strong> keeps every injury case on track, from the first visit to the final check:')
            . ($video ? '<a href="' . $h($u['video']) . '" style="display:block;margin:6px 0 18px;text-decoration:none"><img src="' . $img . '/video-thumb.png" width="536" alt="Watch the 2-minute InjuryCase tour" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px"></a>' : '')
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            . $benefit('&#10084;', 'Better patient outcomes', 'Gaps in care, missed visits and overdue referrals are flagged every morning, so patients finish their treatment plans and get the care their recovery depends on.')
            . $benefit('&#9878;', 'Better attorney relationships', 'Status updates, treatment-complete and reduction letters in one click — and automatic status requests — so attorneys always have what they need.')
            . $benefit('&#9786;', 'A less stressed staff', 'One place for referrals, deadlines, balances and settlements. A 10-minute morning huddle replaces the spreadsheets and sticky notes.')
            . '</table>'
            . $p_('Built with physicians and shaped by more than 10 years of personal-injury attorney input. HIPAA-ready, with a Business Associate Agreement included.')
            . $btn('Start your free trial', $u['trial'])
            . '<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5A6B80">' . $trialLine . '</p>'
            . ($video ? $p_('<a href="' . $h($u['video']) . '" style="color:#127A49">Watch the 2-minute tour &rarr;</a>') : '')
            . $p_('If you\'re not the right person for this, I\'d be grateful if you passed it to whoever manages your PI cases.');
        $text = "$hi,\n\nAuto-accident cases are some of the most rewarding patients a {$sp['one']} sees — and the most paperwork-heavy. InjuryCase keeps every injury case on track, from the first visit to the final check:\n\n"
            . "- Better patient outcomes: gaps in care, missed visits and overdue referrals flagged every morning.\n- Better attorney relationships: status, treatment-complete and reduction letters in one click, plus automatic status requests.\n- A less stressed staff: referrals, deadlines, balances and settlements in one place.\n\n"
            . ($video ? "Watch the 2-minute tour: {$u['video']}\n\n" : '') . "Start your free trial (14 days, no credit card, no strings attached): {$u['trial']}\n\n";
    } elseif ($step === 2) {
        $body = $p_($h($hi) . ',')
            . $p_('Following up on my note about <strong>InjuryCase</strong>. The practices we work with say the biggest change is the front desk: instead of chasing attorneys and digging through spreadsheets, the morning huddle sheet shows exactly which patients need a call, which referrals are overdue and which settlements are still waiting on a check.')
            . $p_('Patients stay on their treatment plans, attorneys get updates without asking, and your team goes home on time.')
            . ($video ? $p_('<a href="' . $h($u['video']) . '" style="color:#127A49;font-weight:bold">See it in 2 minutes &rarr;</a>') : '')
            . $btn('Try it free for 14 days', $u['trial'])
            . '<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5A6B80">' . $trialLine . '</p>';
        $text = "$hi,\n\nFollowing up on my note about InjuryCase. Instead of chasing attorneys and digging through spreadsheets, the morning huddle sheet shows which patients need a call, which referrals are overdue and which settlements are waiting on a check. Patients stay on plan, attorneys get updates without asking, and your team goes home on time.\n\n"
            . ($video ? "See it in 2 minutes: {$u['video']}\n" : '') . "Try it free for 14 days (no card, no strings): {$u['trial']}\n\n";
    } else {
        $body = $p_($h($hi) . ',')
            . $p_('I won\'t keep filling your inbox — this is my last note. If managing auto-accident cases ever feels like more paperwork than patient care, InjuryCase is here: better outcomes for your patients, smoother relationships with attorneys, and a calmer front desk.')
            . $btn('Start a free trial', $u['trial'])
            . '<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5A6B80">' . $trialLine . '</p>'
            . $p_('Thanks for reading, and thank you for the care you give injured patients.');
        $text = "$hi,\n\nThis is my last note. If managing auto-accident cases ever feels like more paperwork than patient care, InjuryCase is here: better outcomes for your patients, smoother relationships with attorneys, and a calmer front desk.\n\nStart a free trial (no card, no strings): {$u['trial']}\n\nThanks for the care you give injured patients.\n\n";
    }
    $sign = $h($s['from_name']);
    $footer = 'You\'re receiving this because ' . $h($practice) . ' is listed publicly as a ' . $h($sp['one']) . '. '
        . '<a href="' . $h($u['unsub']) . '" style="color:#5A6B80;text-decoration:underline">Unsubscribe</a> and you won\'t hear from us again.<br>'
        . 'InjuryCase &middot; ' . $h($s['postal_address']) . ' &middot; <a href="' . APP_URL . '/legal.html#privacy" style="color:#5A6B80">Privacy</a>';
    $html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>' . $h($subject) . '</title></head>'
        . '<body style="margin:0;padding:0;background:#EEF2F7">'
        . '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' . $h($step === 1 ? 'Better patient outcomes, better attorney relationships, a less stressed staff — free trial, no card.' : 'Free trial, no card, no strings attached.') . '</div>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2F7"><tr><td align="center" style="padding:24px 12px">'
        . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">'
        . '<tr><td style="padding:6px 8px 16px"><a href="' . $h($u['site']) . '"><img src="' . $img . '/logo.png" width="170" alt="InjuryCase" style="display:block;border:0;width:170px;height:auto"></a></td></tr>'
        . '<tr><td bgcolor="#FFFFFF" style="border-radius:16px;padding:30px 32px 18px;box-shadow:0 6px 20px rgba(11,35,64,.08)">'
        . ($step === 1 ? '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1.5px;color:#1FA866;text-transform:uppercase;margin:0 0 8px">For injury-care practices</div>'
            . '<h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;color:#0B2340">Better outcomes for your auto-accident patients &mdash; with less paperwork</h1>' : '')
        . $body
        . '<p style="margin:6px 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#22344A">' . $sign . '<br><span style="color:#5A6B80;font-size:14px">InjuryCase &middot; <a href="' . $h($u['site']) . '" style="color:#127A49">injurycase.com</a></span></p>'
        . '</td></tr>'
        . '<tr><td style="padding:18px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#5A6B80;text-align:center">' . $footer . '</td></tr>'
        . '</table></td></tr></table></body></html>';
    $text .= $s['from_name'] . "\nInjuryCase · " . APP_URL . "\n\n---\nYou're receiving this because $practice is listed publicly as a {$sp['one']}. Unsubscribe: {$u['unsub']}\nInjuryCase · {$s['postal_address']}\n";
    return [$subject, $html, $text];
}
