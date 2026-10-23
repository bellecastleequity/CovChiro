<?php
// White label (top plan): a practice can run the app under its own name,
// color and logo, with a branded sign-in link (app.html?b=<slug>). It applies
// wherever the practice's own people and its attorneys see the product: the
// app, the attorney reply page, and the emails sent for the practice. The
// contract stays with InjuryCase, so the legal pages, billing, the BAA and
// the Certified badge keep the InjuryCase name. Branding switches off by
// itself if the practice moves to a plan without the feature (settings are
// kept for when they come back).

const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;      // upload limit
const BRAND_LOGO_BOX = [800, 240];                  // stored size limit (px)
const BRAND_SLUG_RESERVED = ['app', 'api', 'admin', 'www', 'injurycase', 'support', 'help', 'login', 'signin', 'status', 'verify', 'legal', 'billing', 'mail', 'static', 'assets'];

function practice_row(?int $id): ?array {
    if (!$id) return null;
    $s = pi_db()->prepare('SELECT * FROM practices WHERE id = ?'); $s->execute([$id]);
    return $s->fetch() ?: null;
}

// Saved settings, whether or not the plan currently includes them.
function white_label_settings(?array $p): array {
    $j = $p && !empty($p['white_label']) ? json_decode($p['white_label'], true) : null;
    return ['name' => is_array($j) ? ($j['name'] ?? null) : null, 'color' => is_array($j) ? ($j['color'] ?? null) : null,
        'slug' => $p['brand_slug'] ?? null, 'hasLogo' => $p ? practice_has_logo((int)$p['id']) : false];
}

function practice_has_logo(int $pid): bool {
    static $has = [];
    if (!array_key_exists($pid, $has)) { $s = pi_db()->prepare('SELECT updated_at FROM practice_logos WHERE practice_id = ?'); $s->execute([$pid]); $has[$pid] = $s->fetchColumn() ?: false; }
    return (bool)$has[$pid];
}

function practice_logo_version(int $pid): string {
    $s = pi_db()->prepare('SELECT updated_at FROM practice_logos WHERE practice_id = ?'); $s->execute([$pid]);
    return substr(md5((string)$s->fetchColumn()), 0, 8);
}

// Whether white label is in effect: the plan includes it and a name is set.
function white_label_active(?array $p): bool {
    return $p && has_feature($p, 'white_label') && white_label_settings($p)['name'];
}

// The brand people see: InjuryCase, or the practice's own when white-labelled.
// 'vendor' is always InjuryCase (for contracts, billing and the BAA).
function practice_brand(?array $p): array {
    $base = ['name' => BRAND_NAME, 'tagline' => BRAND_TAGLINE, 'support' => SUPPORT_EMAIL, 'vendor' => BRAND_NAME, 'logo' => null, 'color' => null, 'custom' => false];
    if (!white_label_active($p)) return $base;
    $w = white_label_settings($p);
    return ['name' => $w['name'], 'tagline' => '', 'logo' => $w['hasLogo'] ? brand_logo_url($p) : null, 'color' => $w['color'], 'custom' => true] + $base;
}

function brand_name_for(?array $p): string {
    return practice_brand($p)['name'];
}

// Public logo URL. With a sign-in link the slug is used; otherwise an
// unguessable per-practice token (the logo isn't PHI, but practice ids
// shouldn't be enumerable).
function brand_logo_url(array $p): string {
    return 'api/brand.php?action=logo&k=' . brand_logo_key($p) . '&v=' . practice_logo_version((int)$p['id']);
}
function brand_logo_key(array $p): string {
    return (int)$p['id'] . '-' . substr(hash_hmac('sha256', 'brand-logo:' . $p['id'], PI_ENCRYPTION_KEY), 0, 16);
}
function practice_by_logo_key(string $k): ?array {
    if (!preg_match('/^(\d+)-([0-9a-f]{16})$/', $k, $m)) return null;
    $s = pi_db()->prepare('SELECT * FROM practices WHERE id = ?'); $s->execute([(int)$m[1]]);
    $p = $s->fetch();
    return $p && hash_equals(brand_logo_key($p), $k) ? $p : null;
}

// WCAG contrast ratio between two #RRGGBB colors.
function color_contrast(string $a, string $b): float {
    $lum = function (string $hex) {
        $c = array_map(fn($i) => hexdec(substr($hex, $i, 2)) / 255, [1, 3, 5]);
        $c = array_map(fn($v) => $v <= 0.03928 ? $v / 12.92 : (($v + 0.055) / 1.055) ** 2.4, $c);
        return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
    };
    [$x, $y] = [$lum($a), $lum($b)];
    return (max($x, $y) + 0.05) / (min($x, $y) + 0.05);
}

function brand_slug_problem(string $slug): ?string {
    if (!preg_match('/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/', $slug)) return 'Use 3–40 lowercase letters, numbers and dashes for the sign-in link.';
    if (in_array($slug, BRAND_SLUG_RESERVED, true)) return 'That sign-in link name is reserved. Try another.';
    return null;
}

// Re-encodes an uploaded image (PNG, JPEG, WebP or GIF) as a PNG no larger
// than BRAND_LOGO_BOX, keeping transparency. Returns the PNG bytes, or an
// error message. SVG isn't accepted (it can carry scripts).
function brand_logo_from_upload(string $path): array {
    $info = @getimagesize($path);
    $types = [IMAGETYPE_PNG => 'imagecreatefrompng', IMAGETYPE_JPEG => 'imagecreatefromjpeg', IMAGETYPE_WEBP => 'imagecreatefromwebp', IMAGETYPE_GIF => 'imagecreatefromgif'];
    if (!$info || !isset($types[$info[2]])) return ['error' => 'Upload the logo as a PNG, JPG or WebP image (a PNG with a transparent background looks best).'];
    if ($info[0] < 40 || $info[1] < 20) return ['error' => 'That image is too small — use one at least 300 pixels wide.'];
    if ($info[0] * $info[1] > 40e6) return ['error' => 'That image is too large. Try a smaller export.'];
    $src = @($types[$info[2]])($path);
    if (!$src) return ['error' => 'That image could not be read. Try exporting it again as a PNG.'];
    [$w, $h] = [imagesx($src), imagesy($src)];
    $scale = min(1, BRAND_LOGO_BOX[0] / $w, BRAND_LOGO_BOX[1] / $h);
    [$nw, $nh] = [max(1, (int)round($w * $scale)), max(1, (int)round($h * $scale))];
    $dst = imagecreatetruecolor($nw, $nh);
    imagealphablending($dst, false); imagesavealpha($dst, true);
    imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    ob_start(); imagepng($dst, null, 9); $png = ob_get_clean();
    return ['png' => $png, 'width' => $nw, 'height' => $nh];
}
