<?php
require_once __DIR__ . '/../../php_backend/config.php';

// Admin-only AI drafting. Everything returned here is a suggestion shown in
// the admin for review — nothing is saved or sent until the admin does so.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'POST required'], 405);
require_admin();
check_rate_limit($pdo, 'ai', 60, 60, 15);

$action = $_GET['action'] ?? '';
$body = json_body();
$note = ai_clean($body['note'] ?? '', 300);

switch ($action) {
    case 'landing_copy': ai_landing_copy($pdo, $body, $note); break;
    case 'ad_copy': ai_ad_copy($pdo, $body, $note); break;
    case 'drip_copy': ai_drip_copy($pdo, $body, $note); break;
    case 'promo_ideas': ai_promo_ideas($pdo, $note); break;
    case 'analytics_summary': ai_analytics_summary($pdo); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function ai_library_promo(PDO $pdo, array $body) {
    $promo = promo_by_code($pdo, (string)($body['code'] ?? ''));
    if (!$promo || !empty($promo['parent_code']) || !empty($promo['is_welcome'])) json_response(['error' => 'Promo code not found.'], 404);
    return $promo;
}

function ai_site(array $body) {
    return ($body['site'] ?? '') === 'florida' ? 'florida' : 'coverage';
}

function ai_run(string $prompt) {
    $r = ai_generate_json(ai_system_prompt(), $prompt);
    if (isset($r['error'])) json_response(['error' => $r['error']], 502);
    return $r['data'];
}

function ai_note_line(string $note) {
    return $note !== '' ? "Admin's notes for this campaign (theme, audience, timing): {$note}\n" : '';
}

function ai_landing_copy(PDO $pdo, array $body, string $note) {
    $promo = ai_library_promo($pdo, $body);
    $site = ai_site($body);
    $data = ai_run(ai_business_context($site) . "\n\n" . ai_offer_facts($promo, $site) . "\n" . ai_note_line($note)
        . "\nWrite 3 different options for this offer's landing page. Each has a headline (max 70 characters, mentions the offer) "
        . "and a description (1–3 sentences, max 300 characters) saying who it's for and why now, ending with a nudge to claim the code below. "
        . "Make the three options noticeably different in angle.\n"
        . 'JSON shape: {"options":[{"headline":"...","description":"..."}]}');
    $options = [];
    foreach (($data['options'] ?? []) as $o) {
        $h = ai_clean($o['headline'] ?? '', 200);
        $d = ai_clean($o['description'] ?? '', 1000);
        if ($h !== '' || $d !== '') $options[] = ['headline' => $h, 'description' => $d];
    }
    if (!$options) json_response(['error' => 'The AI came back empty. Try again.'], 502);
    json_response(['options' => array_slice($options, 0, 3)]);
}

function ai_ad_copy(PDO $pdo, array $body, string $note) {
    $promo = ai_library_promo($pdo, $body);
    $site = ai_site($body);
    $url = site_url_for($site) . '/offer/' . $promo['code'];
    $smsRoom = 160 - strlen($url) - 1;
    $data = ai_run(ai_business_context($site) . "\n\n" . ai_offer_facts($promo, $site) . "\n" . ai_note_line($note)
        . "\nWrite promotional copy for sharing this offer page. Do NOT include the link anywhere — it's added automatically.\n"
        . "- facebook: a Facebook/Instagram post, 2–4 short sentences, ending with a call to action to claim the code.\n"
        . "- googleHeadlines: 3 Google ad headlines, each max 30 characters.\n"
        . "- googleDescriptions: 2 Google ad descriptions, each max 90 characters.\n"
        . "- sms: one text message, max {$smsRoom} characters, friendly, mentions the offer, ends with a call to action (the link follows it).\n"
        . "- email: a short email blast — subject (max 60 characters) and body (2–4 short sentences, no greeting or sign-off).\n"
        . "- flyer: text for a printed flyer with a QR code — headline (max 40 characters), body (1–2 sentences, max 160 characters), cta (max 30 characters, e.g. telling them to scan the code).\n"
        . 'JSON shape: {"facebook":"...","googleHeadlines":["..."],"googleDescriptions":["..."],"sms":"...","email":{"subject":"...","body":"..."},"flyer":{"headline":"...","body":"...","cta":"..."}}');
    $list = fn($v, $n, $max) => array_values(array_filter(array_map(fn($x) => ai_clean($x, $max), array_slice(is_array($v) ? $v : [], 0, $n)), 'strlen'));
    $fb = ai_clean($data['facebook'] ?? '', 1200);
    $sms = ai_clean($data['sms'] ?? '', 400);
    json_response([
        'url' => $url,
        'facebook' => $fb !== '' ? $fb . "\n\n" . $url : '',
        'googleHeadlines' => $list($data['googleHeadlines'] ?? [], 3, 60),
        'googleDescriptions' => $list($data['googleDescriptions'] ?? [], 2, 180),
        'sms' => $sms !== '' ? $sms . ' ' . $url : '',
        'emailSubject' => ai_clean($data['email']['subject'] ?? '', 150),
        'emailBody' => ($eb = ai_clean($data['email']['body'] ?? '', 1500)) !== '' ? $eb . "\n\n" . $url : '',
        'flyerHeadline' => ai_clean($data['flyer']['headline'] ?? '', 100),
        'flyerBody' => ai_clean($data['flyer']['body'] ?? '', 400),
        'flyerCta' => ai_clean($data['flyer']['cta'] ?? '', 80),
    ]);
}

function ai_drip_copy(PDO $pdo, array $body, string $note) {
    $promo = ai_library_promo($pdo, $body);
    $site = ai_site($body);
    $data = ai_run(ai_business_context($site) . "\n\n" . ai_offer_facts($promo, $site) . "\n" . ai_note_line($note)
        . "\nEveryone who claims a code on this offer page gets 5 follow-up emails. Each already has standard text, the person's code, and a booking button. "
        . "For each email, write a campaign-specific subject line and a short opening paragraph that ties it to this campaign's theme. "
        . "The opening paragraph is inserted right after \"Hi {name},\" and before the standard text, so don't greet, don't sign off, and don't include the code or any link.\n"
        . "Email 0 — sent right away. Standard text: here's your code, good through {expires}, no rush; quick recap of the services.\n"
        . "Email 1 — 3 days later. Standard text: the 3 steps of booking online.\n"
        . "Email 2 — 10 days later. Standard text: two short patient testimonials.\n"
        . "Email 3 — 30 days later. Standard text: code still good through {expires}; book ahead before popular dates fill.\n"
        . "Email 4 — about 10 days before the code expires. Standard text: last call, the code can't be extended.\n"
        . "Rules: subject max 70 characters; opening paragraph 1–2 sentences, max 280 characters. You may use these placeholders, which are filled in per person: {name} (first name), {offer} (e.g. \"15% off\"), {expires} (the code's expiry date).\n"
        . 'JSON shape: {"emails":[{"subject":"...","intro":"..."},{"subject":"...","intro":"..."},{"subject":"...","intro":"..."},{"subject":"...","intro":"..."},{"subject":"...","intro":"..."}]} — exactly 5, in order.');
    $emails = [];
    foreach (array_slice(is_array($data['emails'] ?? null) ? $data['emails'] : [], 0, 5) as $e) {
        $emails[] = ['subject' => ai_clean($e['subject'] ?? '', DRIP_SUBJECT_MAX), 'intro' => ai_clean($e['intro'] ?? '', DRIP_INTRO_MAX)];
    }
    if (count($emails) < 5) json_response(['error' => 'The AI returned an incomplete set of emails. Try again.'], 502);
    json_response(['emails' => $emails]);
}

function ai_promo_ideas(PDO $pdo, string $note) {
    $existing = $pdo->query('SELECT code, type, value, expires_at FROM promo_codes WHERE parent_code IS NULL AND is_welcome = 0 ORDER BY created_at DESC LIMIT 40')->fetchAll();
    $existingLines = $existing ? implode("\n", array_map(fn($p) => '- ' . $p['code'] . ' (' . promo_offer_label($p) . ($p['expires_at'] ? ', ends ' . $p['expires_at'] : '') . ')', $existing)) : '(none yet)';
    $today = date('Y-m-d');
    $data = ai_run(ai_business_context('coverage') . "\n\n" . ai_business_context('florida')
        . "\n\nToday is " . date('l, F j, Y') . ". Existing promo codes (don't reuse these names):\n{$existingLines}\n"
        . ($note !== '' ? "Admin's request: {$note}\n" : "Admin's request: suggest timely campaigns for the next 2–3 months based on the calendar (seasons, holidays, school breaks, CE seminar season, Florida tourist and event seasons).\n")
        . "\nSuggest 3 promo campaigns. For each give: code (uppercase letters and digits only, 4–15 characters, memorable), site (\"coverage\" or \"florida\" — whichever the campaign suits), "
        . "type (\"percent\" or \"fixed\"), value (percent: 5–20; fixed: 25–100 dollars), expiresAt (YYYY-MM-DD, after {$today}, usually 3–8 weeks out), "
        . "why (one sentence on the timing and audience), and headline (landing page headline, max 70 characters).\n"
        . 'JSON shape: {"ideas":[{"code":"...","site":"coverage","type":"percent","value":10,"expiresAt":"YYYY-MM-DD","why":"...","headline":"..."}]}');
    $taken = array_flip(array_map(fn($p) => $p['code'], $existing));
    $ideas = [];
    foreach (($data['ideas'] ?? []) as $i) {
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($i['code'] ?? '')));
        $type = in_array($i['type'] ?? '', ['percent', 'fixed'], true) ? $i['type'] : null;
        $value = is_numeric($i['value'] ?? null) ? round((float)$i['value'], 2) : 0;
        if (strlen($code) < 3 || strlen($code) > 20 || isset($taken[$code]) || !$type || $value <= 0 || ($type === 'percent' && $value > 50)) continue;
        $exp = (string)($i['expiresAt'] ?? '');
        $expOk = preg_match('/^\d{4}-\d{2}-\d{2}$/', $exp) && strtotime($exp) !== false && $exp > $today;
        $taken[$code] = true;
        $ideas[] = [
            'code' => $code, 'site' => ($i['site'] ?? '') === 'florida' ? 'florida' : 'coverage', 'type' => $type, 'value' => $value,
            'expiresAt' => $expOk ? $exp : null, 'why' => ai_clean($i['why'] ?? '', 300), 'headline' => ai_clean($i['headline'] ?? '', 200),
        ];
    }
    if (!$ideas) json_response(['error' => 'The AI didn\'t come back with usable ideas. Try again.'], 502);
    json_response(['ideas' => array_slice($ideas, 0, 3)]);
}

// Totals only — no names, emails, addresses or notes ever leave the server.
function ai_analytics_summary(PDO $pdo) {
    $d30 = date('Y-m-d H:i:s', strtotime('-30 days'));
    $d60 = date('Y-m-d H:i:s', strtotime('-60 days'));
    $SERVICE = ['office' => 'office coverage', 'homevisit' => 'home visits', 'event' => 'events'];

    // The current window has no upper bound: bookings.created_at is stamped by
    // MySQL's clock, which may not match PHP's (America/New_York).
    $period = function ($from, $to) use ($pdo, $SERVICE) {
        $to = $to ?? '9999-12-31 00:00:00';
        $stmt = $pdo->prepare('SELECT coverage_type, status, total, user_id FROM bookings WHERE created_at >= ? AND created_at < ?');
        $stmt->execute([$from, $to]);
        $out = ['bookingsMade' => 0, 'revenueBooked' => 0.0, 'cancelled' => 0, 'byService' => [], 'newClients' => 0, 'returningClients' => 0];
        $users = [];
        foreach ($stmt->fetchAll() as $b) {
            if ($b['status'] === 'cancelled') { $out['cancelled']++; continue; }
            $out['bookingsMade']++;
            $out['revenueBooked'] += (float)$b['total'];
            $svc = $SERVICE[$b['coverage_type']] ?? $b['coverage_type'];
            $out['byService'][$svc] = ($out['byService'][$svc] ?? 0) + 1;
            $users[$b['user_id']] = true;
        }
        $prior = $pdo->prepare('SELECT COUNT(*) FROM bookings WHERE user_id = ? AND created_at < ?');
        foreach (array_keys($users) as $uid) {
            $prior->execute([$uid, $from]);
            $prior->fetchColumn() > 0 ? $out['returningClients']++ : $out['newClients']++;
        }
        $out['revenueBooked'] = round($out['revenueBooked'], 2);
        try {
            $l = $pdo->prepare("SELECT COUNT(*) AS captured, SUM(campaign_code = '') AS fromPopup, SUM(campaign_code != '') AS fromOfferPages FROM leads WHERE created_at >= ? AND created_at < ?");
            $l->execute([$from, $to]);
            $row = $l->fetch();
            $out['leadsCaptured'] = (int)$row['captured'];
            $out['leadsFromWelcomePopup'] = (int)$row['fromPopup'];
            $out['leadsFromOfferPages'] = (int)$row['fromOfferPages'];
            $c = $pdo->prepare("SELECT COUNT(*) FROM leads WHERE status = 'converted' AND converted_at >= ? AND converted_at < ?");
            $c->execute([$from, $to]);
            $out['leadsWhoBooked'] = (int)$c->fetchColumn();
        } catch (PDOException $e) { /* leads table not set up yet */ }
        return $out;
    };

    $data = [
        'last30Days' => $period($d30, null),
        'previous30Days' => $period($d60, $d30),
        'upcomingBookingsNext30Days' => (int)$pdo->query("SELECT COUNT(*) FROM bookings WHERE status != 'cancelled' AND start_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 30 DAY")->fetchColumn(),
    ];
    try {
        $data['leadsNow'] = [
            'activeInFollowUp' => (int)$pdo->query("SELECT COUNT(*) FROM leads WHERE status = 'active'")->fetchColumn(),
            'activeCodesExpiringWithin14Days' => (int)$pdo->query("SELECT COUNT(*) FROM leads l JOIN promo_codes p ON p.code = l.promo_code WHERE l.status = 'active' AND p.expires_at BETWEEN CURDATE() AND CURDATE() + INTERVAL 14 DAY")->fetchColumn(),
        ];
        $campaigns = [];
        $rows = $pdo->query("SELECT p.code, p.type, p.value, p.expires_at, p.landing_site, p.landing_visits, p.landing_enabled,
                (SELECT COUNT(*) FROM leads l WHERE l.campaign_code = p.code) AS signups,
                (SELECT COUNT(*) FROM leads l WHERE l.campaign_code = p.code AND l.status = 'converted') AS bookings
            FROM promo_codes p WHERE p.parent_code IS NULL AND p.is_welcome = 0 AND (p.landing_enabled = 1 OR p.landing_visits > 0) ORDER BY p.created_at DESC LIMIT 15")->fetchAll();
        foreach ($rows as $r) {
            $campaigns[] = ['code' => $r['code'], 'offer' => promo_offer_label($r), 'site' => $r['landing_site'], 'pageOn' => (bool)$r['landing_enabled'],
                'ends' => $r['expires_at'], 'pageVisits' => (int)$r['landing_visits'], 'signups' => (int)$r['signups'], 'bookings' => (int)$r['bookings']];
        }
        $data['offerPageCampaigns'] = $campaigns;
    } catch (PDOException $e) { /* campaign columns not set up yet */ }
    $flex = $pdo->query("SELECT status, COUNT(*) FROM flex_rate_dates WHERE created_at >= " . $pdo->quote($d30) . " GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR);
    $data['flexRateDatesPublishedLast30Days'] = ['open' => (int)($flex['open'] ?? 0), 'booked' => (int)($flex['booked'] ?? 0), 'withdrawn' => (int)($flex['withdrawn'] ?? 0)];

    $result = ai_run("This business runs two sites that share one booking system:\n" . ai_business_context('coverage') . "\n\n" . ai_business_context('florida')
        . "\n\nToday is " . date('F j, Y') . ". Here are the admin dashboard totals (JSON):\n" . json_encode($data, JSON_PRETTY_PRINT)
        . "\n\nWrite a short briefing for the owner. Compare the last 30 days to the previous 30 using only these numbers — never invent figures. "
        . "If numbers are small or zero, say so plainly rather than over-reading them. "
        . "- summary: 2–3 sentences on how the last 30 days went.\n- highlights: up to 4 short bullet points of notable changes or wins/concerns, with the numbers.\n"
        . "- suggestions: up to 3 short, concrete next actions (e.g. a campaign to run, leads with codes about to expire to follow up on, a service line to push).\n"
        . 'JSON shape: {"summary":"...","highlights":["..."],"suggestions":["..."]}');
    $clean = fn($v, $n) => array_values(array_filter(array_map(fn($x) => ai_clean($x, 400), array_slice(is_array($v) ? $v : [], 0, $n)), 'strlen'));
    json_response([
        'summary' => ai_clean($result['summary'] ?? '', 1200),
        'highlights' => $clean($result['highlights'] ?? [], 4),
        'suggestions' => $clean($result['suggestions'] ?? [], 3),
        'generatedAt' => date('c'),
    ]);
}
