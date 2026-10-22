<?php
// Directory of attorneys, insurers, imaging centers and co-managing
// providers. Business contact details only — no patient data lives here.
require_once __DIR__ . '/../../app/bootstrap.php';
pi_start_session();

const CONTACT_TYPES = ['attorney','insurer','imaging','pain_mgmt','ortho','neuro','md','hospital','pt','other'];

$action = $_GET['action'] ?? '';
switch ($action) {
    case 'list': handle_list(); break;
    case 'save': handle_save(); break;
    case 'archive': handle_archive(); break;
    default: json_response(['error' => 'Unknown action'], 400);
}

function handle_list() {
    require_user('case.read');
    $stmt = pi_db()->prepare('SELECT k.*,
            ((SELECT COUNT(*) FROM cases c WHERE c.archived_at IS NULL AND c.attorney_contact_id = k.id)
             + (SELECT COUNT(*) FROM coverages cv WHERE cv.archived_at IS NULL AND cv.carrier_contact_id = k.id)) case_count,
            (SELECT COUNT(*) FROM referrals r WHERE r.archived_at IS NULL AND r.contact_id = k.id) referral_count
        FROM contacts k WHERE k.practice_id = ? AND k.archived_at IS NULL ORDER BY k.type, k.organization, k.name');
    $stmt->execute([pid()]);
    $rows = $stmt->fetchAll();
    json_response(['contacts' => $rows]);
}

function handle_save() {
    require_method('POST');
    $user = require_user('contacts.write');
    $b = json_body();
    $type = $b['type'] ?? '';
    if (!in_array($type, CONTACT_TYPES, true)) json_response(['error' => 'Pick a contact type.'], 400);
    $cols = [
        'type' => $type,
        'organization' => str_or_null($b['organization'] ?? null, 160),
        'name' => str_or_null($b['name'] ?? null, 160),
        'email' => str_or_null($b['email'] ?? null, 190),
        'phone' => str_or_null($b['phone'] ?? null, 40),
        'fax' => str_or_null($b['fax'] ?? null, 40),
        'address' => str_or_null($b['address'] ?? null, 255),
        'notes' => str_or_null($b['notes'] ?? null, 2000),
    ];
    if (!$cols['organization'] && !$cols['name']) json_response(['error' => 'Enter an organization or a name.'], 400);
    if ($cols['email'] && !filter_var($cols['email'], FILTER_VALIDATE_EMAIL)) json_response(['error' => 'That email address looks wrong.'], 400);
    $pdo = pi_db();
    $id = (int)($b['id'] ?? 0);
    $spec = ['type' => 'label', 'organization' => 'label', 'name' => 'label', 'email' => 'label', 'phone' => 'label', 'fax' => 'label', 'address' => 'label', 'notes' => 'str:2000'];
    $label = $cols['organization'] ?: $cols['name'];
    if ($id) {
        $before = $pdo->prepare('SELECT * FROM contacts WHERE id = ? AND practice_id = ?');
        $before->execute([$id, pid()]);
        $before = $before->fetch() ?: json_response(['error' => 'Contact not found'], 404);
        $pdo->prepare('UPDATE contacts SET type=?, organization=?, name=?, email=?, phone=?, fax=?, address=?, notes=? WHERE id = ? AND practice_id = ?')
            ->execute([...array_values($cols), $id, pid()]);
        $changes = audit_diff($spec, $before, $cols);
        if ($changes) audit('update', 'contact', $id, null, $user, $label, $changes);
    } else {
        $pdo->prepare('INSERT INTO contacts (type, organization, name, email, phone, fax, address, notes, practice_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([...array_values($cols), pid(), now_str()]);
        $id = (int)$pdo->lastInsertId();
        audit('create', 'contact', $id, null, $user, $label);
    }
    $stmt = $pdo->prepare('SELECT * FROM contacts WHERE id = ? AND practice_id = ?');
    $stmt->execute([$id, pid()]);
    json_response(['contact' => $stmt->fetch()]);
}

function handle_archive() {
    require_method('POST');
    $user = require_user('contacts.write');
    $id = (int)(json_body()['id'] ?? 0);
    pi_db()->prepare('UPDATE contacts SET archived_at = ? WHERE id = ? AND practice_id = ?')->execute([now_str(), $id, pid()]);
    audit('archive', 'contact', $id, null, $user);
    json_response(['ok' => true]);
}
