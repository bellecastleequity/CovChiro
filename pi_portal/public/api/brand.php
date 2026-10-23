<?php
// Public white-label assets (no sign-in; nothing here is PHI):
//   GET brand.php?action=logo&k=KEY     the practice's logo (PNG)
//   GET brand.php?action=signin&b=SLUG  name, color and logo for a branded sign-in page
// Both answer only while the practice's plan includes white label.
require_once __DIR__ . '/../../app/bootstrap.php';
header('X-Robots-Tag: noindex, nofollow');
$action = $_GET['action'] ?? '';
if ($action === 'logo') {
    $p = practice_by_logo_key((string)($_GET['k'] ?? ''));
    $png = null;
    if ($p && white_label_active($p)) { $s = pi_db()->prepare('SELECT png FROM practice_logos WHERE practice_id = ?'); $s->execute([$p['id']]); $png = $s->fetchColumn() ?: null; }
    if (!$png) { http_response_code(404); header('Content-Type: text/plain'); exit('Not found'); }
    header('Content-Type: image/png');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'");
    header('Cache-Control: public, max-age=86400');
    header('Content-Length: ' . strlen($png));
    echo $png;
    exit;
}
if ($action === 'signin') {
    $slug = strtolower((string)($_GET['b'] ?? ''));
    $p = null;
    if (!brand_slug_problem($slug)) { $s = pi_db()->prepare('SELECT * FROM practices WHERE brand_slug = ?'); $s->execute([$slug]); $p = $s->fetch() ?: null; }
    if (!$p || !white_label_active($p)) json_response(['error' => 'Not found'], 404);
    $b = practice_brand($p);
    json_response(['name' => $b['name'], 'color' => $b['color'], 'logo' => $b['logo'], 'vendor' => $b['vendor']]);
}
json_response(['error' => 'Unknown action'], 400);
