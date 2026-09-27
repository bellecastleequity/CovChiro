<?php
// Welcome-offer lead emails: the immediate "here's your code" message plus the
// four-step drip the cron sends afterwards. Loaded by config.php, so every
// API endpoint and cron script has these available.

function promo_by_code(PDO $pdo, string $code) {
    $stmt = $pdo->prepare('SELECT * FROM promo_codes WHERE code = ?');
    $stmt->execute([strtoupper(trim($code))]);
    return $stmt->fetch() ?: null;
}

function mark_lead_converted(PDO $pdo, string $promoCode, string $bookingId) {
    $stmt = $pdo->prepare("UPDATE leads SET status = 'converted', converted_at = ?, converted_booking_id = ? WHERE promo_code = ? AND status != 'converted'");
    $stmt->execute([date('Y-m-d H:i:s'), $bookingId, strtoupper(trim($promoCode))]);
}

function lead_unsubscribe_url(array $lead) {
    return site_url_for($lead['site']) . '/api/leads.php?action=unsubscribe&token=' . urlencode($lead['unsubscribe_token']);
}

// Deep link that lands on the booking form with the code pre-applied — the
// pop-up script on the homepage reads ?welcome= and ?lead= and fills them in.
function lead_booking_url(array $lead, array $promo) {
    $anchor = $lead['site'] === 'florida' ? '#book' : '#rates';
    return site_url_for($lead['site']) . '/index.html?welcome=' . urlencode($promo['code']) . '&lead=' . urlencode($lead['email']) . $anchor;
}

function lead_first_name(array $lead) {
    $first = trim(explode(' ', trim($lead['name']))[0] ?? '');
    return $first !== '' ? $first : 'there';
}

function lead_email_layout(array $lead, ?array $promo, string $heading, string $bodyHtml, string $ctaLabel) {
    $site = $lead['site'];
    $siteName = site_name_for($site);
    $tagline = $site === 'florida' ? 'Home visits &amp; event coverage across Florida' : 'Chiropractic office coverage across Florida';
    $codeBox = '';
    if ($promo) {
        $expires = $promo['expires_at'] ? date('F j, Y', strtotime($promo['expires_at'])) : '';
        $codeBox = '<div style="margin:22px 0;padding:16px;border:1px dashed #2F5D53;border-radius:6px;background:#E5DFD2;text-align:center;">'
            . '<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8171;">Your welcome code</div>'
            . '<div style="font-family:Menlo,Consolas,monospace;font-size:24px;font-weight:700;color:#1F3F38;margin:6px 0;">' . htmlspecialchars($promo['code']) . '</div>'
            . '<div style="font-size:13px;color:#4b5563;">' . (int)$promo['value'] . '% off your first booking' . ($expires ? ' &middot; good through ' . $expires : '') . '</div>'
            . '</div>';
    }
    $cta = $promo
        ? '<p style="text-align:center;margin:24px 0;"><a href="' . htmlspecialchars(lead_booking_url($lead, $promo)) . '" style="display:inline-block;background:#2F5D53;color:#FBF9F4;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:600;">' . htmlspecialchars($ctaLabel) . '</a></p>'
        : '';
    return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1C2430;max-width:560px;margin:0 auto;">'
        . '<div style="padding:18px 0 10px;border-bottom:2px solid #2F5D53;margin-bottom:18px;">'
        . '<div style="font-size:19px;font-weight:700;color:#1F3F38;">' . htmlspecialchars($siteName) . '</div>'
        . '<div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#8a8171;">' . $tagline . '</div>'
        . '</div>'
        . '<h2 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:#1C2430;">' . htmlspecialchars($heading) . '</h2>'
        . $bodyHtml . $codeBox . $cta
        . '<p style="margin-top:22px;">Dr. Michael McPherson, D.C.<br><span style="color:#6b7280;font-size:13px;">' . htmlspecialchars($siteName) . '</span></p>'
        . '<p style="margin-top:28px;padding-top:14px;border-top:1px solid #CFC7B4;font-size:12px;color:#8a8171;line-height:1.5;">'
        . 'You\'re receiving this because you requested a welcome offer at ' . htmlspecialchars($siteName) . '. '
        . 'The code is single-use, for a first booking only, and can\'t be combined with other promo codes. '
        . '<a href="' . htmlspecialchars(lead_unsubscribe_url($lead)) . '" style="color:#8a8171;">Unsubscribe</a> from these emails any time.'
        . '</p></div>';
}

// One entry per step: 0 is the immediate welcome, 1-4 are the drip (sent at
// 3, 10, 30 and 80 days by cron/lead_drip.php). Copy differs by site since
// coveragechiropractor.com sells office coverage to practice owners and
// thefloridachiropractor.com sells home visits and event coverage.
function lead_email_content(array $lead, array $promo, int $step) {
    $first = htmlspecialchars(lead_first_name($lead));
    $pct = (int)$promo['value'];
    $expires = $promo['expires_at'] ? date('F j, Y', strtotime($promo['expires_at'])) : 'its expiry date';
    $florida = $lead['site'] === 'florida';

    if ($step === 0) {
        return [
            'subject' => "Your {$pct}% welcome code, " . lead_first_name($lead),
            'heading' => "Here's your {$pct}% off — no rush to use it",
            'cta' => 'Book with ' . $pct . '% off',
            'body' => "<p>Hi {$first},</p><p>Thanks for stopping by. Your welcome code is below — it's good for 90 days, so there's no pressure to decide today. "
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
            'cta' => 'Book with ' . $pct . '% off',
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
            'subject' => "60 days left on your {$pct}% code",
            'heading' => $florida ? 'Planning a trip, a season, or an event?' : 'Planning time away this season?',
            'cta' => 'Check available dates',
            'body' => "<p>Hi {$first},</p>"
                . ($florida
                    ? "<p>Your welcome code is still good through {$expires}. If a trip to Florida, a tournament, or a corporate wellness day is on the calendar, it's worth locking the date in early — event weekends and peak-season weeks fill first.</p><p>And if something comes up suddenly — a visiting athlete who needs care today, a guest who can't get to an office — same-day requests get a fast, direct reply.</p>"
                    : "<p>Your welcome code is still good through {$expires}. If a vacation, CE weekend, or holiday closure is coming up, the dates around them fill first — booking a few weeks ahead keeps your patients on schedule and your revenue steady.</p><p>And if you're ever caught short — an associate out sick, a sudden gap in the schedule — same-day and next-day coverage requests get an immediate response, any hour.</p>"),
        ];
    }
    return [
        'subject' => "Last call: your {$pct}% welcome code expires {$expires}",
        'heading' => 'Your welcome code is almost up',
        'cta' => 'Use my ' . $pct . '% before it expires',
        'body' => "<p>Hi {$first},</p><p>Just a heads-up that your {$pct}% welcome code expires on {$expires}. After that it can't be extended, so if there's a date you've been meaning to book, this is the week to do it.</p>"
            . "<p>No hard feelings if the timing isn't right — you can always book at the standard published rates later, and " . ($florida ? "I'm happy to answer questions any time." : "first-time practices still receive an automatic discount.") . "</p>",
    ];
}

function send_lead_email(array $lead, array $promo, int $step) {
    $c = lead_email_content($lead, $promo, $step);
    $html = lead_email_layout($lead, $promo, $c['heading'], $c['body'], $c['cta']);
    return send_email($lead['email'], $c['subject'], $html, null, $lead['site']);
}
