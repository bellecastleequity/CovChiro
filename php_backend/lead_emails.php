<?php
// Offer emails for leads captured by the homepage welcome pop-up or a
// campaign landing page: the immediate "here's your code" message plus the
// four-step follow-up the cron sends afterwards. Loaded by config.php, so
// every API endpoint and cron script has these available.

function promo_by_code(PDO $pdo, string $code) {
    $stmt = $pdo->prepare('SELECT * FROM promo_codes WHERE code = ?');
    $stmt->execute([strtoupper(trim($code))]);
    return $stmt->fetch() ?: null;
}

// "15% off" / "$50 off"
function promo_offer_label(array $promo) {
    $v = (float)$promo['value'];
    if (($promo['type'] ?? 'percent') === 'fixed') return '$' . number_format($v, floor($v) == $v ? 0 : 2) . ' off';
    return rtrim(rtrim(number_format($v, 2), '0'), '.') . '% off';
}

// A code used on any booking marks the lead it was issued to as converted;
// a no-op for codes that don't belong to a lead.
function mark_lead_converted(PDO $pdo, string $promoCode, string $bookingId) {
    $stmt = $pdo->prepare("UPDATE leads SET status = 'converted', converted_at = ?, converted_booking_id = ? WHERE promo_code = ? AND status != 'converted'");
    $stmt->execute([date('Y-m-d H:i:s'), $bookingId, strtoupper(trim($promoCode))]);
}

function lead_is_campaign(array $lead) {
    return !empty($lead['campaign_code']);
}

function lead_unsubscribe_url(array $lead) {
    return site_url_for($lead['site']) . '/api/leads.php?action=unsubscribe&token=' . urlencode($lead['unsubscribe_token']);
}

// Deep link that lands on the booking form with the code pre-applied — the
// homepage script reads ?welcome= and ?lead= and fills them in.
function lead_booking_url(array $lead, array $promo) {
    $anchor = $lead['site'] === 'florida' ? '#book' : '#rates';
    return site_url_for($lead['site']) . '/index.html?welcome=' . urlencode($promo['code']) . '&lead=' . urlencode($lead['email']) . $anchor;
}

// Plain text — leads.name is stored HTML-escaped, so decode it first.
function lead_first_name(array $lead) {
    $first = trim(explode(' ', trim(html_entity_decode($lead['name'], ENT_QUOTES, 'UTF-8')))[0] ?? '');
    return $first !== '' ? $first : 'there';
}

function lead_email_layout(array $lead, ?array $promo, string $heading, string $bodyHtml, string $ctaLabel) {
    $site = $lead['site'];
    $siteName = site_name_for($site);
    $campaign = lead_is_campaign($lead);
    $codeBox = '';
    if ($promo) {
        $expires = $promo['expires_at'] ? date('F j, Y', strtotime($promo['expires_at'])) : '';
        $codeBox = '<div style="margin:24px 0 8px;padding:20px 16px;border:2px dashed ' . EM_TEAL . ';border-radius:10px;background:' . EM_PAPER_2 . ';text-align:center;">'
            . '<div style="font-family:' . EM_FONT . ';font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:' . EM_GOLD . ';font-weight:bold;">' . ($campaign ? 'Your personal code' : 'Your welcome code') . '</div>'
            . '<div style="font-family:Menlo,Consolas,monospace;font-size:28px;font-weight:bold;letter-spacing:0.06em;color:' . EM_TEAL_DARK . ';margin:8px 0 6px;">' . em($promo['code']) . '</div>'
            . '<div style="font-family:' . EM_FONT . ';font-size:14px;color:' . EM_MUTED . ';">' . em(promo_offer_label($promo)) . ($campaign ? ' your next booking' : ' your first booking') . ($expires ? ' &middot; good through ' . em($expires) : '') . '</div>'
            . '</div>';
    }
    $cta = $promo ? email_buttons([[$ctaLabel, lead_booking_url($lead, $promo)]], 'center') : '';
    $footer = $campaign
        ? 'You’re receiving this because you requested an offer at ' . em($siteName) . '. The code is single-use, tied to your email address, and can’t be combined with other promo codes.'
        : 'You’re receiving this because you requested a welcome offer at ' . em($siteName) . '. The code is single-use, for a first booking only, and can’t be combined with other promo codes.';
    return email_shell(email_heading($heading) . $bodyHtml . $codeBox . $cta, [
        'site' => $site, 'reading' => true, 'footer_note' => $footer, 'unsubscribe' => lead_unsubscribe_url($lead),
        'preheader' => $promo ? promo_offer_label($promo) . ' with code ' . $promo['code'] . ($promo['expires_at'] ? ' — good through ' . date('F j', strtotime($promo['expires_at'])) : '') : '',
    ]);
}

// One entry per step: 0 is the immediate email with the code, 1-3 go out 3,
// 10 and 30 days after signup, and 4 is the "last call" sent once the code is
// within 10 days of expiring (see cron/lead_drip.php). Copy differs by site
// since coveragechiropractor.com sells office coverage to practice owners and
// thefloridachiropractor.com sells home visits and event coverage.
function lead_email_content(array $lead, array $promo, int $step) {
    $first = htmlspecialchars(lead_first_name($lead));
    $firstPlain = lead_first_name($lead);
    $offer = promo_offer_label($promo);
    $expires = $promo['expires_at'] ? date('F j, Y', strtotime($promo['expires_at'])) : 'its expiry date';
    $florida = $lead['site'] === 'florida';
    $campaign = lead_is_campaign($lead);

    if ($step === 0) {
        return [
            'subject' => $campaign ? "Your {$offer} code, {$firstPlain}" : 'Your ' . (($promo['type'] ?? 'percent') === 'percent' ? rtrim(rtrim(number_format((float)$promo['value'], 2), '0'), '.') . '%' : $offer) . " welcome code, {$firstPlain}",
            'heading' => "Here's your {$offer} — no rush to use it",
            'cta' => "Book with {$offer}",
            'body' => "<p>Hi {$first},</p><p>Thanks for stopping by. Your " . ($campaign ? 'personal code' : 'welcome code') . " is below — it's good through {$expires}, so there's no pressure to decide today. "
                . "When you're ready, book online and enter it at checkout (or just use the button below and it's applied for you).</p>"
                . ($florida
                    ? "<p>A quick reminder of what's on offer: chiropractic home visits at \$100 per patient (children seen alongside a parent are \$70), Monday through Friday, and on-site coverage for sporting events and corporate wellness days at \$100/hour with a 2-hour minimum. Licensed, insured, and available across Florida.</p>"
                    : "<p>A quick reminder of what's on offer: licensed, insured chiropractic office coverage anywhere in Florida — by the day, week, or month — booked directly with the covering doctor at published rates. Instant online confirmation, a signed agreement built into checkout, and just a 10% deposit to hold your dates.</p>"),
        ];
    }
    if ($step === 1) {
        return [
            'subject' => $florida ? 'How a visit or event booking works (2 minutes)' : 'How booking coverage works (it takes about 2 minutes)',
            'heading' => $florida ? 'From address to confirmation in a few clicks' : 'From dates to confirmation in a few clicks',
            'cta' => 'See live pricing',
            'body' => "<p>Hi {$first},</p>"
                . ($florida
                    ? "<p>In case it's useful, here's exactly what happens when you book:</p><ol style=\"padding-left:20px;\"><li>Pick a home visit or an event, add the address, and the price updates live — mileage is calculated automatically for home visits, and events have no mileage fee.</li><li>Review and sign a short agreement right on the page.</li><li>Pay a 10% deposit to confirm. That's it — you're booked instantly.</li></ol><p>The balance is settled after the visit. Home visits run Monday–Friday; events (including weekends) have a 2-hour minimum.</p>"
                    : "<p>In case it's useful, here's exactly what happens when you book:</p><ol style=\"padding-left:20px;\"><li>Choose your region and the dates you need covered — full or half days — and the quote updates live, mileage included.</li><li>Fill in what your covering doctor should know: posted hours, techniques you use, day-of contact.</li><li>Review and sign the coverage agreement on the page, then pay a 10% deposit. Your dates are confirmed instantly.</li></ol><p>On the day, your patients keep their appointments and their care plans. Your protocols, your schedule — high-volume days of 100+ patients are no problem. The balance is invoiced after coverage is complete.</p>"),
        ];
    }
    if ($step === 2) {
        return [
            'subject' => $florida ? 'What patients say about Dr. McPherson' : 'What practices and patients say',
            'heading' => 'A few words from people who\'ve been on the table',
            'cta' => "Book with {$offer}",
            'body' => "<p>Hi {$first},</p><p>Rather than tell you about the care, here's what patients have said:</p>"
                . "<blockquote style=\"margin:14px 0;padding:10px 14px;border-left:3px solid #B8863F;background:#F5F1E8;\">&ldquo;He's genuine, kind, and an excellent chiropractor. I recommended him to my husband as well.&rdquo; <span style=\"color:#6b7280;\">&mdash; L.</span></blockquote>"
                . "<blockquote style=\"margin:14px 0;padding:10px 14px;border-left:3px solid #B8863F;background:#F5F1E8;\">&ldquo;Very knowledgeable, professional &amp; has amazing interpersonal skills.&rdquo; <span style=\"color:#6b7280;\">&mdash; B.H.</span></blockquote>"
                . ($florida
                    ? "<p>It's the same doctor behind coveragechiropractor.com, which covers chiropractic offices across the state — so whether it's a hotel room, a sideline, or your front door, you're getting the same standard of care.</p>"
                    : "<p>That's who your patients meet while you're away. And because you book directly rather than through a staffing agency, there's no placement fee or markup — the published rate is the rate.</p>"),
        ];
    }
    if ($step === 3) {
        return [
            'subject' => "Your {$offer} code is good through {$expires}",
            'heading' => $florida ? 'Planning a trip, a season, or an event?' : 'Planning time away this season?',
            'cta' => 'Check available dates',
            'body' => "<p>Hi {$first},</p>"
                . ($florida
                    ? "<p>Your code is still good through {$expires}. If a trip to Florida, a tournament, or a corporate wellness day is on the calendar, it's worth locking the date in early — event weekends and peak-season weeks fill first.</p><p>And if something comes up suddenly — a visiting athlete who needs care today, a guest who can't get to an office — same-day requests get a fast, direct reply.</p>"
                    : "<p>Your code is still good through {$expires}. If a vacation, CE weekend, or holiday closure is coming up, the dates around them fill first — booking a few weeks ahead keeps your patients on schedule and your revenue steady.</p><p>And if you're ever caught short — an associate out sick, a sudden gap in the schedule — same-day and next-day coverage requests get an immediate response, any hour.</p>"),
        ];
    }
    return [
        'subject' => "Last call: your {$offer} " . ($campaign ? 'code' : 'welcome code') . " expires {$expires}",
        'heading' => $campaign ? 'Your code is almost up' : 'Your welcome code is almost up',
        'cta' => "Use my {$offer} before it expires",
        'body' => "<p>Hi {$first},</p><p>Just a heads-up that your {$offer} code expires on {$expires}. After that it can't be extended, so if there's a date you've been meaning to book, this is the week to do it.</p>"
            . "<p>No hard feelings if the timing isn't right — you can always book at the standard published rates later, and " . ($florida ? "I'm happy to answer questions any time." : "first-time practices still receive an automatic discount.") . "</p>",
    ];
}

define('DRIP_SUBJECT_MAX', 150);
define('DRIP_INTRO_MAX', 600);

// A campaign's custom email copy (promo_codes.drip_custom): always 5 entries
// of {subject, intro}, one per step; blank strings mean "use the standard".
function promo_drip_custom(?string $json) {
    $data = $json ? json_decode($json, true) : null;
    $out = [];
    for ($i = 0; $i < 5; $i++) {
        $e = is_array($data) && isset($data[$i]) && is_array($data[$i]) ? $data[$i] : [];
        $out[] = ['subject' => (string)($e['subject'] ?? ''), 'intro' => (string)($e['intro'] ?? '')];
    }
    return $out;
}

function lead_custom_copy(array $lead, int $step) {
    global $pdo;
    if (!lead_is_campaign($lead) || !($pdo instanceof PDO)) return null;
    try {
        $stmt = $pdo->prepare('SELECT drip_custom FROM promo_codes WHERE code = ?');
        $stmt->execute([$lead['campaign_code']]);
        $json = $stmt->fetchColumn();
    } catch (PDOException $e) {
        return null; // migration_014 not run yet — standard copy
    }
    $c = promo_drip_custom($json ?: null)[$step] ?? null;
    return $c && ($c['subject'] !== '' || $c['intro'] !== '') ? $c : null;
}

// Plain text in, plain text out — callers escape for HTML.
function fill_drip_placeholders(string $text, array $lead, array $promo) {
    return strtr($text, [
        '{name}' => lead_first_name($lead),
        '{offer}' => promo_offer_label($promo),
        '{expires}' => $promo['expires_at'] ? date('F j, Y', strtotime($promo['expires_at'])) : 'its expiry date',
        '{code}' => $promo['code'],
    ]);
}

// Returns ['subject' => ..., 'html' => ...] with any campaign-specific copy
// applied — the saved copy, or $custom ({subject, intro}) when previewing edits.
function lead_email_build(array $lead, array $promo, int $step, ?array $custom = null) {
    $c = lead_email_content($lead, $promo, $step);
    $custom = $custom ?? lead_custom_copy($lead, $step);
    if ($custom) {
        if ($custom['subject'] !== '') $c['subject'] = fill_drip_placeholders($custom['subject'], $lead, $promo);
        if ($custom['intro'] !== '') {
            $greeting = '<p>Hi ' . htmlspecialchars(lead_first_name($lead)) . ',</p>';
            $intro = '<p>' . nl2br(htmlspecialchars(fill_drip_placeholders($custom['intro'], $lead, $promo))) . '</p>';
            $c['body'] = strpos($c['body'], $greeting) === 0 ? $greeting . $intro . substr($c['body'], strlen($greeting)) : $intro . $c['body'];
        }
    }
    return ['subject' => $c['subject'], 'html' => lead_email_layout($lead, $promo, $c['heading'], $c['body'], $c['cta'])];
}

function send_lead_email(array $lead, array $promo, int $step) {
    $e = lead_email_build($lead, $promo, $step);
    return send_email($lead['email'], $e['subject'], $e['html'], null, $lead['site']);
}
