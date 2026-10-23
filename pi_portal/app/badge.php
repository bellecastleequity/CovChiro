<?php
// "InjuryCase Certified" badge a practice can show on its own website.
// The embed points at api/badge.php with the practice's badge token, so the
// badge stays live: it shows as certified only while the practice qualifies
// (see badge_status) and links to a public verification page. Nothing about
// patients is ever involved — only the practice name and state.

const BADGE_STYLES = ['light', 'dark', 'seal'];

// What it takes to show the badge. Each item: [key, label, met].
function badge_status(array $p): array {
    $paid = in_array($p['subscription_status'], ['active', 'comped'], true);
    $items = [
        ['subscription', 'Active paid subscription (not a trial)', $paid],
        ['baa', 'Current Business Associate Agreement accepted', $p['baa_version'] === BAA_VERSION],
        ['enabled', 'Badge switched on by an admin', !empty($p['badge_enabled'])],
    ];
    return ['certified' => !in_array(false, array_column($items, 2), true), 'items' => $items];
}

function badge_token_for(array $p): string {
    if (!empty($p['badge_token'])) return $p['badge_token'];
    $t = bin2hex(random_bytes(12));
    pi_db()->prepare('UPDATE practices SET badge_token = ? WHERE id = ?')->execute([$t, $p['id']]);
    return $t;
}

function badge_urls(string $token): array {
    $img = APP_URL . '/api/badge.php?t=' . $token;
    $verify = APP_URL . '/verify.html?t=' . $token;
    $embed = fn(string $style, int $w, int $h) => '<a href="' . $verify . '" target="_blank" rel="noopener" title="Verify ' . BRAND_NAME . ' Certified status">'
        . '<img src="' . $img . ($style === 'light' ? '' : '&style=' . $style) . '" width="' . $w . '" height="' . $h . '" alt="' . BRAND_NAME . ' Certified Practice"></a>';
    return ['image' => $img, 'verify' => $verify,
        'embed' => ['light' => $embed('light', 240, 72), 'dark' => $embed('dark', 240, 72), 'seal' => $embed('seal', 160, 160)]];
}

// ---- artwork (system fonts only: an <img> SVG can't load web fonts) ----
const BADGE_FONT = 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif';

function badge_shield(float $cx, float $top, float $s, bool $active, string $gid): string {
    // Crest shield with a check, scaled from a 36x48 design centred on $cx.
    $p = fn(array $pts) => implode(' ', array_map(fn($v) => is_string($v) ? $v : round($v, 2), $pts));
    $x = fn($v) => $cx + ($v - 18) * $s;
    $y = fn($v) => $top + $v * $s;
    $outer = $p(['M', $x(18), $y(0), 'L', $x(36), $y(6), 'V', $y(22), 'C', $x(36), $y(34), $x(28), $y(43), $x(18), $y(48), 'C', $x(8), $y(43), $x(0), $y(34), $x(0), $y(22), 'V', $y(6), 'Z']);
    $inner = $p(['M', $x(18), $y(4.5), 'L', $x(32), $y(9.2), 'V', $y(22), 'C', $x(32), $y(31.6), $x(26), $y(38.8), $x(18), $y(43.2), 'C', $x(10), $y(38.8), $x(4), $y(31.6), $x(4), $y(22), 'V', $y(9.2), 'Z']);
    $mark = $active ? $p(['M', $x(10.5), $y(23.5), 'L', $x(15.5), $y(28.5), 'L', $x(26), $y(17.5)]) : $p(['M', $x(11), $y(24), 'H', $x(25)]);
    return '<path d="' . $outer . '" fill="url(#' . $gid . ')"/>'
        . '<path d="' . $inner . '" fill="none" stroke="#FFFFFF" stroke-opacity="0.4" stroke-width="' . round(1.2 * $s, 2) . '"/>'
        . '<path d="' . $mark . '" fill="none" stroke="#FFFFFF" stroke-width="' . round(4 * $s, 2) . '" stroke-linecap="round" stroke-linejoin="round"/>';
}

function badge_gradient(string $id, bool $active): string {
    [$a, $b] = $active ? ['#4A5CF0', '#1F2DA6'] : ['#A9B3C1', '#7D8898'];
    return '<linearGradient id="' . $id . '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' . $a . '"/><stop offset="1" stop-color="' . $b . '"/></linearGradient>';
}

function badge_svg(string $style, bool $active): string {
    $style = in_array($style, BADGE_STYLES, true) ? $style : 'light';
    $font = BADGE_FONT;
    $label = $active ? BRAND_NAME . ' Certified Practice' : BRAND_NAME . ' verification unavailable';
    if ($style === 'seal') {
        $ring = $active ? '#5EEAD4' : '#9AA5B4';
        $bottom = $active ? 'CERTIFIED PRACTICE' : 'NOT VERIFIED';
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="' . $label . '">'
            . '<defs>' . badge_gradient($active ? 'icg-on' : 'icg-off', $active)
            . '<path id="ict" d="M 28 80 A 52 52 0 0 1 132 80"/><path id="icb" d="M 19 80 A 61 61 0 0 0 141 80"/></defs>'
            . '<circle cx="80" cy="80" r="78" fill="#0F1733"/>'
            . '<circle cx="80" cy="80" r="72" fill="none" stroke="' . $ring . '" stroke-width="2.5"/>'
            . '<circle cx="80" cy="80" r="44" fill="none" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1"/>'
            . '<text font-family="' . $font . '" font-size="13" font-weight="800" fill="#FFFFFF" text-anchor="middle"><textPath href="#ict" startOffset="50%" text-anchor="middle" textLength="104" lengthAdjust="spacing">INJURYCASE</textPath></text>'
            . '<text font-family="' . $font . '" font-size="10.5" font-weight="700" fill="' . ($active ? '#5EEAD4' : '#C3CBD6') . '" text-anchor="middle"><textPath href="#icb" startOffset="50%" text-anchor="middle" textLength="' . ($active ? 146 : 98) . '" lengthAdjust="spacing">' . $bottom . '</textPath></text>'
            . '<text x="21" y="84" font-family="' . $font . '" font-size="10" fill="' . $ring . '" text-anchor="middle">★</text>'
            . '<text x="139" y="84" font-family="' . $font . '" font-size="10" fill="' . $ring . '" text-anchor="middle">★</text>'
            . badge_shield(80, 53, 1.12, $active, $active ? 'icg-on' : 'icg-off')
            . '</svg>';
    }
    $dark = $style === 'dark';
    [$bg, $border, $ink, $muted] = $dark ? ['#0F1733', '#0F1733', '#FFFFFF', 'rgba(255,255,255,0.72)'] : ['#FFFFFF', '#D5DCE6', '#0F1733', 'rgba(15,23,51,0.68)'];
    [$l1, $l2, $l3] = $active ? ['INJURYCASE', 'Certified Practice', 'Secure PI case management'] : ['INJURYCASE', 'Not verified', 'This badge is not currently active'];
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 72" width="240" height="72" role="img" aria-label="' . $label . '">'
        . '<defs>' . badge_gradient($active ? 'icg-on' : 'icg-off', $active) . '</defs>'
        . '<rect x="0.5" y="0.5" width="239" height="71" rx="12" fill="' . $bg . '" stroke="' . $border . '"/>'
        . badge_shield(36, 12, 1, $active, $active ? 'icg-on' : 'icg-off')
        . '<text x="66" y="26" font-family="' . $font . '" font-size="10" font-weight="700" letter-spacing="1.8" fill="' . ($active ? ($dark ? '#5EEAD4' : '#2B3FD6') : $muted) . '">' . $l1 . '</text>'
        . '<text x="66" y="45" font-family="' . $font . '" font-size="17" font-weight="800" fill="' . $ink . '">' . $l2 . '</text>'
        . '<text x="66" y="59" font-family="' . $font . '" font-size="9.5" fill="' . $muted . '">' . $l3 . '</text>'
        . '</svg>';
}
