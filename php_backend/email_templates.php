<?php
// Branded HTML email layout shared by every outgoing email on both sites:
// logo header, content card, CTA buttons, summary boxes, the doctor's
// signature, "helpful reading" links and a footer. Table-based with inline
// styles so it renders the same in Gmail, Outlook and Apple Mail.
// Loaded by config.php.

const EM_INK = '#1C2430';
const EM_MUTED = '#5b6472';
const EM_SOFT = '#8a8171';
const EM_TEAL = '#2F5D53';
const EM_TEAL_DARK = '#1F3F38';
const EM_GOLD = '#B8863F';
const EM_PAPER = '#EFEAE0';
const EM_PAPER_2 = '#F6F3EC';
const EM_LINE = '#DDD5C4';
const EM_RED = '#9B3B2E';
const EM_FONT = "Helvetica,Arial,sans-serif";
const EM_SERIF = "Georgia,'Times New Roman',serif";

// Escape for email HTML. Many values come out of the database already
// HTML-escaped by sanitize(), so decode first — escaping stays single.
function em($s) {
    return htmlspecialchars(html_entity_decode((string)$s, ENT_QUOTES, 'UTF-8'), ENT_QUOTES, 'UTF-8');
}

function em_money($amount) {
    return '$' . number_format((float)$amount, 2);
}

function email_site($site = null) {
    if ($site === 'florida' || $site === 'coverage') return $site;
    return site_key_from_host() ?? 'coverage';
}

// Office coverage belongs to coveragechiropractor.com; home visits and
// events to thefloridachiropractor.com.
function booking_site(array $b) {
    return in_array($b['coverage_type'] ?? 'office', ['homevisit', 'event'], true) ? 'florida' : 'coverage';
}

// A client's site, from their most recent booking (clients don't have a
// site of their own). Falls back to the site the request came in on.
function user_site(PDO $pdo, $userId) {
    $stmt = $pdo->prepare('SELECT coverage_type FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1');
    $stmt->execute([$userId]);
    $type = $stmt->fetchColumn();
    return $type !== false ? booking_site(['coverage_type' => $type]) : email_site(null);
}

function email_brand($site) {
    $site = email_site($site);
    $url = site_url_for($site);
    if ($site === 'florida') {
        return [
            'site' => 'florida', 'name' => 'The Florida Chiropractor', 'domain' => 'thefloridachiropractor.com', 'url' => $url,
            'tagline' => 'Home visits &amp; event coverage across Florida',
            'book' => $url . '/index.html#book', 'bookLabel' => 'Book a visit',
            'reading' => [
                ['Home visits &amp; event pricing', $url . '/index.html#pricing'],
                ['What patients say', $url . '/index.html#reviews'],
                ['Frequently asked questions', $url . '/index.html#faq'],
            ],
        ];
    }
    return [
        'site' => 'coverage', 'name' => 'CoverageChiropractor.com', 'domain' => 'coveragechiropractor.com', 'url' => $url,
        'tagline' => 'Chiropractic office coverage across Florida',
        'book' => $url . '/index.html#rates', 'bookLabel' => 'Book coverage',
        'reading' => [
            ['Why every Florida practice needs a reliable fill-in doctor', $url . '/articles.html#article-fill-in-doctor'],
            ['Staffing agencies vs. booking coverage directly', $url . '/articles.html#article-agency-vs-direct'],
            ['The midnight call: when your associate can’t make it tomorrow', $url . '/articles.html#article-midnight-call'],
        ],
    ];
}

// Dashboard deep link — signed-out clients are sent through sign-in and
// land on the same tab afterwards.
function dashboard_url($site, $view = null, array $params = []) {
    if ($view) $params = ['view' => $view] + $params;
    return site_url_for(email_site($site)) . '/dashboard.html' . ($params ? '?' . http_build_query($params) : '');
}

// ---------- building blocks ----------

function email_heading($text, $kicker = null) {
    return ($kicker ? '<div style="font-family:' . EM_FONT . ';font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:' . EM_GOLD . ';font-weight:bold;margin:0 0 8px;">' . em($kicker) . '</div>' : '')
        . '<h1 style="font-family:' . EM_SERIF . ';font-size:26px;line-height:1.25;font-weight:normal;color:' . EM_INK . ';margin:0 0 18px;">' . em($text) . '</h1>';
}

// $html is trusted markup — escape any dynamic values with em() first.
function email_p($html, $style = '') {
    return '<p style="font-family:' . EM_FONT . ';font-size:16px;line-height:1.6;color:' . EM_INK . ';margin:0 0 16px;' . $style . '">' . $html . '</p>';
}

function email_small($html) {
    return '<p style="font-family:' . EM_FONT . ';font-size:13px;line-height:1.55;color:' . EM_MUTED . ';margin:0 0 14px;">' . $html . '</p>';
}

// Bulletproof button (a padded table cell), so it stays a real button even
// where Outlook ignores padding on links.
function email_button($label, $url, $variant = 'primary') {
    $bg = $variant === 'primary' ? EM_TEAL : '#FFFFFF';
    $fg = $variant === 'primary' ? '#FFFFFF' : EM_TEAL_DARK;
    $border = $variant === 'primary' ? EM_TEAL : EM_TEAL;
    return '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="display:inline-table;margin:0 8px 10px 0;"><tr>'
        . '<td style="border-radius:6px;background:' . $bg . ';border:2px solid ' . $border . ';">'
        . '<a href="' . em($url) . '" style="display:inline-block;padding:13px 24px;font-family:' . EM_FONT . ';font-size:15px;font-weight:bold;color:' . $fg . ';text-decoration:none;border-radius:6px;">' . em($label) . '</a>'
        . '</td></tr></table>';
}

// One or more buttons: [[label, url], [label, url, 'secondary']]
function email_buttons(array $buttons, $align = 'left') {
    $html = '';
    foreach ($buttons as $b) $html .= email_button($b[0], $b[1], $b[2] ?? ($html === '' ? 'primary' : 'secondary'));
    return '<div style="margin:22px 0 14px;text-align:' . $align . ';">' . $html . '</div>';
}

// Label/value summary box. Values are escaped; pass ['html' => '...'] for markup.
function email_facts(array $rows, $title = null) {
    $html = '';
    foreach ($rows as $label => $value) {
        if ($value === null || $value === '') continue;
        $v = is_array($value) ? $value['html'] : em($value);
        $html .= '<tr><td style="padding:9px 0;border-bottom:1px solid ' . EM_LINE . ';font-family:' . EM_FONT . ';font-size:13px;color:' . EM_MUTED . ';vertical-align:top;width:38%;">' . em($label) . '</td>'
            . '<td style="padding:9px 0 9px 12px;border-bottom:1px solid ' . EM_LINE . ';font-family:' . EM_FONT . ';font-size:15px;color:' . EM_INK . ';vertical-align:top;">' . $v . '</td></tr>';
    }
    return '<div style="margin:18px 0 22px;padding:6px 18px 8px;background:' . EM_PAPER_2 . ';border:1px solid ' . EM_LINE . ';border-radius:8px;">'
        . ($title ? '<div style="font-family:' . EM_FONT . ';font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:' . EM_SOFT . ';font-weight:bold;padding:10px 0 4px;">' . em($title) . '</div>' : '')
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">' . $html . '</table></div>';
}

// Big centered amount, e.g. "Amount due $25.00".
function email_amount($label, $amount, $sub = null, $tone = 'teal') {
    $color = $tone === 'red' ? EM_RED : EM_TEAL_DARK;
    return '<div style="margin:18px 0 22px;padding:20px;text-align:center;background:' . EM_PAPER_2 . ';border:1px solid ' . EM_LINE . ';border-radius:8px;">'
        . '<div style="font-family:' . EM_FONT . ';font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:' . EM_SOFT . ';font-weight:bold;">' . em($label) . '</div>'
        . '<div style="font-family:' . EM_SERIF . ';font-size:36px;line-height:1.2;color:' . $color . ';margin:6px 0 2px;">' . em_money($amount) . '</div>'
        . ($sub ? '<div style="font-family:' . EM_FONT . ';font-size:13px;color:' . EM_MUTED . ';">' . $sub . '</div>' : '')
        . '</div>';
}

// Tinted note. $tone: info | success | warn
function email_callout($html, $tone = 'info') {
    $map = ['info' => [EM_TEAL, '#EEF4F2'], 'success' => [EM_TEAL, '#EAF3EE'], 'warn' => [EM_GOLD, '#FBF4E6']];
    [$bar, $bg] = $map[$tone] ?? $map['info'];
    return '<div style="margin:18px 0 20px;padding:14px 16px;background:' . $bg . ';border-left:4px solid ' . $bar . ';border-radius:4px;font-family:' . EM_FONT . ';font-size:14px;line-height:1.55;color:' . EM_INK . ';">' . $html . '</div>';
}

function email_quote($text) {
    return '<div style="margin:14px 0 18px;padding:12px 16px;background:' . EM_PAPER_2 . ';border-left:3px solid ' . EM_GOLD . ';font-family:' . EM_FONT . ';font-size:15px;line-height:1.55;color:' . EM_INK . ';">' . nl2br(em($text)) . '</div>';
}

function email_signature($site) {
    $b = email_brand($site);
    return '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 4px;"><tr>'
        . '<td style="vertical-align:middle;padding-right:14px;"><img src="' . em($b['url']) . '/assets/headshot.jpg" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:26px;object-fit:cover;border:2px solid ' . EM_LINE . ';"></td>'
        . '<td style="vertical-align:middle;font-family:' . EM_FONT . ';">'
        . '<div style="font-size:15px;font-weight:bold;color:' . EM_INK . ';">Dr. Michael L. McPherson, D.C.</div>'
        . '<div style="font-size:13px;color:' . EM_MUTED . ';">Licensed &amp; insured · ' . em($b['domain']) . '</div>'
        . '</td></tr></table>';
}

function email_reading($site) {
    $b = email_brand($site);
    $links = '';
    foreach ($b['reading'] as [$label, $url]) {
        $links .= '<tr><td style="padding:7px 0;font-family:' . EM_FONT . ';font-size:14px;"><a href="' . em($url) . '" style="color:' . EM_TEAL . ';text-decoration:none;">&rsaquo;&nbsp; ' . $label . '</a></td></tr>';
    }
    return '<div style="margin:28px 0 0;padding-top:18px;border-top:1px solid ' . EM_LINE . ';">'
        . '<div style="font-family:' . EM_FONT . ';font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:' . EM_SOFT . ';font-weight:bold;margin-bottom:4px;">' . ($b['site'] === 'florida' ? 'Helpful links' : 'Helpful reading') . '</div>'
        . '<table role="presentation" cellspacing="0" cellpadding="0" border="0">' . $links . '</table></div>';
}

// ---------- the full email ----------

// $opts: site, preheader, admin (bool: provider-portal notification),
//        network (bool: to a provider in the coverage network rather than a
//        clinic client), signature (bool), reading (bool), unsubscribe (url),
//        footer_note (html)
function email_shell($content, array $opts = []) {
    $site = email_site($opts['site'] ?? null);
    $b = email_brand($site);
    $admin = !empty($opts['admin']);
    $network = !$admin && !empty($opts['network']);
    $signature = $opts['signature'] ?? !$admin;
    $reading = $opts['reading'] ?? false;
    $pre = $opts['preheader'] ?? '';

    $header = '<tr><td style="background:' . EM_TEAL_DARK . ';padding:18px 28px;">'
        . '<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>'
        . '<td style="vertical-align:middle;padding-right:12px;"><a href="' . em($b['url']) . '"><img src="' . em($b['url']) . '/assets/logo.png" width="44" height="44" alt="' . em($b['name']) . '" style="display:block;width:44px;height:44px;border-radius:8px;background:#FFFFFF;"></a></td>'
        . '<td style="vertical-align:middle;">'
        . '<div style="font-family:' . EM_SERIF . ';font-size:20px;color:#FFFFFF;line-height:1.2;">' . em($b['name']) . '</div>'
        . '<div style="font-family:' . EM_FONT . ';font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#E3C58F;margin-top:3px;">' . ($admin ? 'Provider portal notification' : ($network ? 'Chiropractic coverage network' : $b['tagline'])) . '</div>'
        . '</td></tr></table></td></tr>'
        . '<tr><td style="background:' . EM_GOLD . ';height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>';

    $body = '<tr><td class="em-body" style="background:#FFFFFF;padding:32px 30px 30px;font-family:' . EM_FONT . ';font-size:16px;line-height:1.6;color:' . EM_INK . ';">'
        . $content
        . ($signature ? email_signature($site) : '')
        . ($reading ? email_reading($site) : '')
        . '</td></tr>';

    $footerLinks = $admin
        ? '<a href="' . em(SITE_URL) . '/admin.html" style="color:' . EM_TEAL . ';text-decoration:none;">Open the provider portal</a>'
        : ($network
        ? '<a href="' . em(SITE_URL) . '/provider.html" style="color:' . EM_TEAL . ';text-decoration:none;">My provider dashboard</a>'
            . ' &nbsp;·&nbsp; <a href="tel:' . preg_replace('/[^0-9+]/', '', PHONE_NUMBER) . '" style="color:' . EM_TEAL . ';text-decoration:none;white-space:nowrap;">' . em(PHONE_NUMBER) . '</a>'
        : '<a href="' . em($b['book']) . '" style="color:' . EM_TEAL . ';text-decoration:none;">' . em($b['bookLabel']) . '</a>'
            . ' &nbsp;·&nbsp; <a href="' . em(dashboard_url($site)) . '" style="color:' . EM_TEAL . ';text-decoration:none;">My account</a>'
            . ($site === 'coverage' ? ' &nbsp;·&nbsp; <a href="' . em($b['url']) . '/help-center.html" style="color:' . EM_TEAL . ';text-decoration:none;">Help center</a>' : '')
            . ' &nbsp;·&nbsp; <a href="tel:' . preg_replace('/[^0-9+]/', '', PHONE_NUMBER) . '" style="color:' . EM_TEAL . ';text-decoration:none;white-space:nowrap;">' . em(PHONE_NUMBER) . '</a>');
    $footer = '<tr><td style="padding:22px 30px 30px;text-align:center;font-family:' . EM_FONT . ';font-size:12px;line-height:1.7;color:' . EM_SOFT . ';">'
        . '<div style="margin-bottom:8px;">' . $footerLinks . '</div>'
        . (!empty($opts['footer_note']) ? '<div style="margin-bottom:6px;">' . $opts['footer_note'] . '</div>' : '')
        . '<div>' . em($b['name']) . ' · Dr. Michael L. McPherson, D.C. · Florida</div>'
        . (!empty($opts['unsubscribe']) ? '<div style="margin-top:6px;"><a href="' . em($opts['unsubscribe']) . '" style="color:' . EM_SOFT . ';">Unsubscribe</a> from these emails</div>' : '')
        . '</td></tr>';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
        . '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>' . em($b['name']) . '</title>'
        . '<style>@media only screen and (max-width:620px){.em-body{padding:24px 18px 22px !important;}.em-wrap{padding:12px 6px !important;}}</style></head>'
        . '<body style="margin:0;padding:0;background:' . EM_PAPER . ';">'
        . ($pre !== '' ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' . em($pre) . str_repeat('&#847;&zwnj;&nbsp;', 40) . '</div>' : '')
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:' . EM_PAPER . ';"><tr><td class="em-wrap" align="center" style="padding:28px 12px;">'
        . '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-radius:10px;overflow:hidden;border:1px solid ' . EM_LINE . ';">'
        . $header . $body
        . '</table>'
        . '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">' . $footer . '</table>'
        . '</td></tr></table></body></html>';
}

// Plain-text version for the multipart email (spam filters and text-only
// clients): links become "label (url)", blocks become line breaks.
function email_plain_text($html) {
    $html = preg_replace('#<(head|style|title)\b.*?</\1>#is', '', $html);
    $html = preg_replace('#<div style="display:none[^"]*">.*?</div>#is', '', $html);
    $html = preg_replace_callback('#<a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>#is', function ($m) {
        $label = trim(strip_tags($m[2]));
        $url = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
        return ($label === '' || $label === $url || stripos($url, 'tel:') === 0) ? ($label ?: $url) : "{$label} ({$url})";
    }, $html);
    $html = preg_replace('#<br\s*/?>#i', "\n", $html);
    $html = preg_replace('#</(p|div|h1|h2|h3|tr|li|table)>#i', "\n", $html);
    $html = preg_replace('#</td>#i', ' ', $html);
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8');
    $text = preg_replace("/[ \t\x{00A0}\x{034F}\x{200C}]+/u", ' ', $text) ?? $text; // null on invalid UTF-8
    $text = preg_replace("/ *\n */", "\n", $text);
    return trim(preg_replace("/\n{3,}/", "\n\n", $text));
}

// Sends a branded email. $content is the inner HTML built from the blocks
// above; $opts as email_shell() plus reply_to.
function send_branded_email($to, $subject, $content, array $opts = []) {
    $site = email_site($opts['site'] ?? null);
    return send_email($to, $subject, email_shell($content, ['site' => $site] + $opts), $opts['reply_to'] ?? null, $site);
}

// Provider-portal notification to the admin: a heading, facts, optional
// body and a button to the relevant admin tab.
function send_admin_email($subject, $heading, $contentHtml, array $opts = []) {
    $content = email_heading($heading, $opts['kicker'] ?? null) . $contentHtml
        . email_buttons([[$opts['cta'] ?? 'Open the provider portal', SITE_URL . '/admin.html']]);
    return send_email(ADMIN_EMAIL, $subject, email_shell($content, ['admin' => true, 'site' => $opts['site'] ?? 'coverage', 'preheader' => $opts['preheader'] ?? '']), $opts['reply_to'] ?? null, $opts['site'] ?? 'coverage');
}

function email_booking_dates(array $b) {
    $dates = json_decode($b['dates'] ?? '[]', true);
    if (!is_array($dates) || !$dates) return !empty($b['start_date']) ? date('l, F j, Y', strtotime($b['start_date'])) : null;
    sort($dates);
    if (count($dates) === 1) return date('l, F j, Y', strtotime($dates[0]));
    if (count($dates) <= 5) return implode(', ', array_map(fn($d) => date('D, M j', strtotime($d)), $dates)) . ', ' . date('Y', strtotime(end($dates)));
    return date('M j', strtotime($dates[0])) . ' – ' . date('M j, Y', strtotime(end($dates))) . ' (' . count($dates) . ' days)';
}

// Standard booking summary box, plus any extra rows (e.g. amounts).
function email_booking_facts(array $b, array $extra = [], $title = 'Booking summary') {
    return email_facts(['Service' => $b['title'] ?? null, 'Date(s)' => email_booking_dates($b), 'Details' => $b['meta'] ?? null, 'Reference' => $b['id'] ?? null] + $extra, $title);
}

function email_first_name($name) {
    $first = trim(explode(' ', trim(html_entity_decode((string)$name, ENT_QUOTES, 'UTF-8')))[0] ?? '');
    return $first !== '' ? $first : 'there';
}
