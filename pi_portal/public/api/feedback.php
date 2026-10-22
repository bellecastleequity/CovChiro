<?php
// Feature suggestions from inside the portal. Practice users suggest new
// features or changes and see their practice's suggestions with the
// status and reply; platform operators review them all. Suggestions must
// not contain patient information (the form says so, and operators never
// see PHI), so the text is stored as entered.
define('PI_ALLOW_WHEN_LAPSED', true);
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

const FEEDBACK_KINDS = ['feature' => 'New feature', 'change' => 'Change to an existing feature', 'problem' => 'Something isn\'t working'];
const FEEDBACK_AREAS = ['Cases & case page', 'Next steps & suggestions', 'Visits & referrals', 'Financials & insurance', 'EHR ledger upload', 'Tasks & daily huddle',
    'Letters & exports', 'Users & settings', 'Billing & plans', 'Other'];
const FEEDBACK_STATUS = ['new' => 'Received', 'reviewing' => 'Under review', 'planned' => 'Planned', 'done' => 'Done', 'declined' => 'Not planned'];

function feedback_row(array $r): array {
    return ['id' => (int)$r['id'], 'kind' => $r['kind'], 'area' => $r['area'], 'title' => $r['title'], 'body' => $r['body'], 'status' => $r['status'],
        'response' => $r['response'], 'by' => $r['user_name'] ?? null, 'practice' => $r['practice_name'] ?? null, 'at' => $r['created_at'], 'updatedAt' => $r['updated_at']];
}

function handle_submit() {
    require_method('POST');
    $user = require_user();
    if (is_operator($user)) json_response(['error' => 'Operators can\'t submit suggestions.'], 403);
    $b = json_body();
    $kind = enum_or($b['kind'] ?? '', array_keys(FEEDBACK_KINDS), 'feature');
    $title = str_or_null($b['title'] ?? null, 160);
    $body = str_or_null($b['body'] ?? null, 5000);
    if (!$title) json_response(['error' => 'Give your suggestion a short title.'], 400);
    $area = in_array($b['area'] ?? '', FEEDBACK_AREAS, true) ? $b['area'] : 'Other';
    pi_db()->prepare('INSERT INTO feedback (practice_id, user_id, kind, area, title, body, page, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        ->execute([pid(), $user['id'], $kind, $area, $title, $body, str_or_null($b['page'] ?? null, 80), now_str(), now_str()]);
    $id = (int)pi_db()->lastInsertId();
    audit('create', 'feedback', $id, null, $user, $title);
    json_response(['ok' => true, 'id' => $id]);
}

// The practice's suggestions (everyone on the team sees them).
function handle_list() {
    $user = require_user();
    if (is_operator($user)) json_response(['error' => 'Use the operator console.'], 403);
    $s = pi_db()->prepare('SELECT f.*, u.name user_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.practice_id = ? ORDER BY f.id DESC LIMIT 200');
    $s->execute([pid()]);
    json_response(['items' => array_map('feedback_row', $s->fetchAll()), 'kinds' => FEEDBACK_KINDS, 'areas' => FEEDBACK_AREAS, 'statuses' => FEEDBACK_STATUS]);
}

// ---- operators ----
function handle_all() {
    require_user('platform.manage');
    $where = '1=1'; $args = [];
    if (!empty($_GET['status']) && isset(FEEDBACK_STATUS[$_GET['status']])) { $where = 'f.status = ?'; $args[] = $_GET['status']; }
    $s = pi_db()->prepare("SELECT f.*, u.name user_name, p.name practice_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN practices p ON p.id = f.practice_id
        WHERE $where ORDER BY FIELD(f.status, 'new', 'reviewing', 'planned', 'done', 'declined'), f.id DESC LIMIT 500");
    $s->execute($args);
    $counts = pi_db()->query('SELECT status, COUNT(*) n FROM feedback GROUP BY status')->fetchAll(PDO::FETCH_KEY_PAIR);
    json_response(['items' => array_map('feedback_row', $s->fetchAll()), 'counts' => $counts, 'kinds' => FEEDBACK_KINDS, 'statuses' => FEEDBACK_STATUS]);
}

function handle_update() {
    require_method('POST');
    $op = require_user('platform.manage');
    $b = json_body();
    $id = (int)($b['id'] ?? 0);
    $status = enum_or($b['status'] ?? '', array_keys(FEEDBACK_STATUS), null);
    if (!$status) json_response(['error' => 'Pick a status.'], 400);
    $s = pi_db()->prepare('SELECT * FROM feedback WHERE id = ?'); $s->execute([$id]);
    $before = $s->fetch() ?: json_response(['error' => 'Not found'], 404);
    pi_db()->prepare('UPDATE feedback SET status = ?, response = ?, updated_at = ? WHERE id = ?')->execute([$status, str_or_null($b['response'] ?? null, 2000), now_str(), $id]);
    audit('update', 'feedback', $id, null, $op, $before['title'], [['f' => 'status', 't' => 'enum', 'from' => $before['status'], 'to' => $status]]);
    json_response(['ok' => true]);
}

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'submit': handle_submit(); break;
    case 'list': handle_list(); break;
    case 'all': handle_all(); break;
    case 'update': handle_update(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}
