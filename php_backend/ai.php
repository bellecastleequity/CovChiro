<?php
// Google Gemini (free tier) for the admin's AI drafting buttons: landing page
// copy, ad/text copy, campaign email copy, promo ideas, and the analytics
// summary. Admin-only, and only ever sent offer details, business context and
// aggregate totals — never client or lead names, emails, or health details,
// since free-tier requests may be used by Google to improve its models.
// Loaded by config.php. Nothing here runs unless GEMINI_API_KEY is set in
// secrets.php.

function ai_configured() {
    return defined('GEMINI_API_KEY') && GEMINI_API_KEY !== '' && strpos(GEMINI_API_KEY, 'your_') === false;
}

// Models tried in order until one answers. Google's newest "latest" alias is
// often overloaded (503) or has no free-tier allowance on a given key
// ("limit: 0" 429s), so fall back through other Flash models; the last one
// that worked is remembered and tried first next time.
function ai_model_chain() {
    $chain = [];
    $last = @file_get_contents(__DIR__ . '/logs/ai_model.txt');
    if (is_string($last) && preg_match('/^[a-z0-9.\-]+$/', trim($last))) $chain[] = trim($last);
    if (defined('GEMINI_MODEL') && GEMINI_MODEL !== '') $chain[] = GEMINI_MODEL;
    foreach (['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as $m) $chain[] = $m;
    return array_values(array_unique($chain));
}

function gemini_request(string $model, array $payload, int $timeout) {
    $base = defined('GEMINI_API_BASE') ? GEMINI_API_BASE : 'https://generativelanguage.googleapis.com/v1beta';
    $ch = curl_init(rtrim($base, '/') . '/models/' . rawurlencode($model) . ':generateContent');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . GEMINI_API_KEY],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => $timeout,
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);
    return ['raw' => $raw, 'status' => $status, 'curlErr' => $curlErr, 'resp' => is_string($raw) ? json_decode($raw, true) : null];
}

// Which quota a 429 hit: none at all for this model ("limit: 0"), per day, or per minute.
function gemini_quota_kind(?array $resp) {
    $msg = (string)($resp['error']['message'] ?? '');
    $kind = preg_match('/limit:\s*0\b/', $msg) ? 'none' : null;
    foreach (($resp['error']['details'] ?? []) as $d) {
        foreach (($d['violations'] ?? []) as $v) {
            $q = (string)($v['quotaId'] ?? '');
            if ((string)($v['quotaValue'] ?? '') === '0') $kind = 'none';
            elseif (!$kind && stripos($q, 'PerDay') !== false) $kind = 'day';
            elseif (!$kind && stripos($q, 'PerMinute') !== false) $kind = 'minute';
        }
    }
    return $kind ?? 'minute';
}

// Returns ['data' => decoded JSON object] or ['error' => message for the admin].
function ai_generate_json(string $system, string $prompt) {
    if (!ai_configured()) return ['error' => "AI isn't set up yet — add your Gemini key as GEMINI_API_KEY in php_backend/secrets.php."];
    if (!function_exists('curl_init')) return ['error' => "This server's PHP doesn't have cURL enabled, which the AI features need."];

    $payload = [
        'systemInstruction' => ['parts' => [['text' => $system]]],
        'contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]],
        'generationConfig' => ['responseMimeType' => 'application/json'],
    ];
    @set_time_limit(180);
    $startedAt = time();
    $failures = [];
    $r = null;
    $model = null;
    foreach (ai_model_chain() as $model) {
        if ($failures && time() - $startedAt > 60) break;
        $r = gemini_request($model, $payload, 45);
        if ($r['raw'] !== false && $r['status'] === 200) break;
        $msg = (string)($r['resp']['error']['message'] ?? '');
        $kind = $r['status'] === 429 ? gemini_quota_kind($r['resp']) : null;
        $failures[] = ['model' => $model, 'status' => $r['status'], 'kind' => $kind];
        log_error('Gemini API error', ['model' => $model, 'status' => $r['status'], 'quota' => $kind, 'curl' => $r['curlErr'] ?: null, 'message' => mb_substr($msg !== '' ? $msg : (string)$r['raw'], 0, 500)]);
        // Key problems won't be fixed by another model; everything else might be.
        if ($r['status'] === 400 || $r['status'] === 401 || $r['status'] === 403) {
            if ($r['status'] !== 400 || stripos($msg, 'api key') !== false) return ['error' => 'Google rejected the API key. Check GEMINI_API_KEY in php_backend/secrets.php matches the key in Google AI Studio.'];
            return ['error' => 'The AI request failed (400). Details are in php_backend/logs/error.log.'];
        }
        if ($r['raw'] === false && stripos($r['curlErr'], 'resolve') !== false) return ['error' => "This server couldn't reach Google's AI service. Try again in a moment."];
    }

    if (!$r || $r['raw'] === false || $r['status'] !== 200) {
        $kinds = array_column($failures, 'kind');
        $statuses = array_column($failures, 'status');
        if ($kinds && count(array_filter($kinds, fn($k) => $k === 'none')) === count($failures)) {
            return ['error' => "Your Google key doesn't have any free AI allowance. In Google AI Studio, open the key's project and check it's on the free tier — or create a new key in a new project — then update GEMINI_API_KEY in secrets.php."];
        }
        if (in_array('day', $kinds, true)) return ['error' => "Today's free AI limit has been reached. It resets overnight (midnight Pacific time)."];
        if (in_array('minute', $kinds, true)) return ['error' => 'Too many AI requests in the last minute. Wait a minute and try again.'];
        if (count(array_filter($statuses, fn($s) => $s === 404)) === count($failures)) return ['error' => "Google didn't recognise any of the AI models tried. Set GEMINI_MODEL in secrets.php to a current model name from Google AI Studio."];
        if (array_filter($statuses, fn($s) => $s >= 500) || in_array(0, $statuses, true)) return ['error' => "Google's AI service is busy right now (tried " . count($failures) . ' models). Try again in a few minutes.'];
        return ['error' => 'The AI request failed. Details are in php_backend/logs/error.log.'];
    }
    if ($failures) @file_put_contents(__DIR__ . '/logs/ai_model.txt', $model);

    $resp = $r['resp'];
    if (!empty($resp['promptFeedback']['blockReason'])) return ['error' => "Google's safety filter declined this request. Try rewording your note."];
    $text = '';
    foreach (($resp['candidates'][0]['content']['parts'] ?? []) as $part) {
        if (empty($part['thought']) && isset($part['text'])) $text .= $part['text'];
    }
    $data = ai_decode_json($text);
    if (!is_array($data)) {
        log_error('Gemini returned unreadable output', ['model' => $model, 'finish' => $resp['candidates'][0]['finishReason'] ?? null, 'text' => mb_substr($text, 0, 500)]);
        return ['error' => 'The AI returned something unreadable. Try again.'];
    }
    return ['data' => $data];
}

function ai_decode_json(string $text) {
    $text = trim(preg_replace('/^```(?:json)?\s*|\s*```$/i', '', trim($text)));
    $data = json_decode($text, true);
    if (is_array($data)) return $data;
    $start = strpos($text, '{');
    $end = strrpos($text, '}');
    if ($start === false || $end === false || $end <= $start) return null;
    $data = json_decode(substr($text, $start, $end - $start + 1), true);
    return is_array($data) ? $data : null;
}

// Plain text, single spaces, no markup — every AI string is cleaned before it
// reaches the admin page, and escaped again when displayed.
function ai_clean($value, int $maxLen = 1000) {
    if (!is_string($value)) return '';
    $value = trim(preg_replace('/[ \t]+/', ' ', strip_tags($value)));
    $value = preg_replace('/\n{3,}/', "\n\n", $value);
    return mb_substr($value, 0, $maxLen);
}

// What each site sells and who it's for, so drafts stay accurate. Only
// published facts — prompts tell the model not to invent anything beyond this.
function ai_business_context(string $site) {
    if ($site === 'florida') {
        return "Business: TheFloridaChiropractor.com — Dr. Michael McPherson, D.C., a licensed and insured chiropractor.\n"
            . "Audience: people in Florida who want chiropractic care where they are — at home, in a hotel, or at an event — plus event organizers and employers.\n"
            . "Services and published prices: home/hotel visits \$100 per patient (children seen alongside a parent \$70), Monday–Friday, with a small mileage fee; on-site coverage for sporting events and corporate wellness days at \$100/hour with a 2-hour minimum, weekends included.\n"
            . "How booking works: online, live pricing, sign a short agreement on the page, 10% deposit confirms instantly, balance after the visit.";
    }
    return "Business: CoverageChiropractor.com — Dr. Michael McPherson, D.C., a licensed and insured chiropractor who covers other chiropractors' offices.\n"
        . "Audience: chiropractic practice owners in Florida who need a doctor to see their patients while they're away (vacation, CE seminars, illness, parental leave, holidays). This is business-to-business: the reader is a chiropractor, not a patient.\n"
        . "Services: temporary office coverage anywhere in Florida by the day, week or month; the covering doctor follows the owner's protocols and schedule, handles high-volume days (100+ patients); booked directly at published rates with no staffing-agency markup.\n"
        . "How booking works: online, pick dates, live quote including mileage, sign the coverage agreement on the page, 10% deposit confirms instantly, balance invoiced after coverage.";
}

function ai_system_prompt() {
    return "You write marketing copy for a solo chiropractor's small business. Tone: warm, direct, professional, plain English — like a real person, not an agency. "
        . "Never invent prices, statistics, testimonials, guarantees, awards, or medical claims (no promises to cure or treat conditions). Only use facts given to you. "
        . "No emojis, no hashtags, no ALL CAPS words, no exclamation-mark spam (at most one per piece). "
        . "Always respond with a single JSON object exactly matching the requested shape, with no extra commentary.";
}

// Offer facts for one promo code, for prompts.
function ai_offer_facts(array $promo, string $site) {
    $lines = ['Offer: ' . promo_offer_label($promo) . ' a booking'];
    if (!empty($promo['expires_at'])) $lines[] = 'Campaign ends: ' . date('F j, Y', strtotime($promo['expires_at']));
    $lines[] = 'How it is claimed: the visitor enters their name and email on the offer page and instantly receives a personal single-use code, valid for 90 days (or until the campaign ends, if sooner).';
    $lines[] = 'Offer page link: ' . site_url_for($site) . '/offer/' . $promo['code'];
    return implode("\n", $lines);
}
