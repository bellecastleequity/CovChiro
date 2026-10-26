<?php
// A case's benefits (derived from its coverages) and its billing basis —
// insurance or letter of protection — with the switch notice and email.
// Shared by the case and EOB endpoints.

function sync_benefits(int $caseId) {
    $c = case_or_404($caseId);
    $s = pi_db()->prepare('SELECT * FROM coverages WHERE case_id = ? AND archived_at IS NULL ORDER BY priority, id');
    $s->execute([$caseId]);
    $new = derive_benefits($s->fetchAll(), $c['injury_type']);
    $basis = $c['billing_basis'];
    if ($new !== $c['benefits'] && $c['injury_type'] === 'auto') {
        if (in_array($new, ['denied', 'lop', 'health'], true)) $basis = 'lop';
        elseif ($new === 'pip') $basis = 'insurance';
    }
    pi_db()->prepare('UPDATE cases SET benefits = ?, billing_basis = ? WHERE id = ?')->execute([$new, $basis, $caseId]);
}

// Insurance ↔ LOP switches. Call basis_watch() before a change and the
// returned function after it: if the billing basis changed, the steps that
// were added and removed are saved on the case (shown until dismissed),
// logged, and emailed to the practice's administrators.
function basis_steps(array $case): array {
    $out = [];
    foreach (case_checklist($case, [], []) as $i) $out[$i['key']] = $i['label'];
    return $out;
}
function basis_watch(int $caseId): callable {
    $before = case_or_404($caseId);
    $steps = $before['injury_type'] === 'auto' ? basis_steps($before) : [];
    return function (array $user, string $why = '') use ($caseId, $before, $steps): ?array {
        $after = case_or_404($caseId);
        $from = case_billing_basis($before); $to = case_billing_basis($after);
        if ($after['injury_type'] !== 'auto' || $before['injury_type'] !== 'auto' || $from === $to) return null;
        $now = basis_steps($after);
        $change = ['from' => $from, 'to' => $to, 'at' => now_str(), 'by' => $user['name'] ?? null, 'why' => $why ?: null,
            'added' => array_values(array_diff_key($now, $steps)), 'removed' => array_values(array_diff_key($steps, $now))];
        pi_db()->prepare('UPDATE cases SET basis_change = ? WHERE id = ?')->execute([json_encode($change), $caseId]);
        audit('update', 'case', $caseId, $caseId, $user, 'billing basis', [['f' => 'billing_basis', 't' => 'enum', 'from' => $from, 'to' => $to]]);
        basis_change_email($after, $change, $user);
        return $change;
    };
}
const BASIS_LABELS = ['insurance' => 'PIP insurance billing', 'lop' => 'a letter of protection (balance held until the case settles)'];
// The summary email: no patient details, just the case number, the switch
// and the steps — sign in for the rest.
function basis_change_email(array $case, array $change, array $actor): void {
    require_once __DIR__ . '/mailer.php';
    if (!mail_configured()) return;
    $p = current_practice();
    $brand = brand_name_for($p);
    $list = fn($a) => $a ? implode("\n", array_map(fn($x) => "  • $x", $a)) : '  (none)';
    $text = "Case {$case['case_number']} at {$p['name']} was switched from " . BASIS_LABELS[$change['from']] . ' to ' . BASIS_LABELS[$change['to']]
        . ($change['by'] ? " by {$change['by']}" : '') . ($change['why'] ? " ({$change['why']})" : '') . ".\n\n"
        . "Steps added to the case:\n" . $list($change['added']) . "\n\nSteps removed (no longer needed):\n" . $list($change['removed']) . "\n\n"
        . "Open the case:\n" . APP_URL . '/app.html#/case/' . $case['id'] . "\n\n"
        . "For privacy, this email never includes patient names or details — sign in to see them.\n\n— $brand\n";
    $s = pi_db()->prepare("SELECT DISTINCT email FROM users WHERE practice_id = ? AND active = 1 AND (role = 'admin' OR id = ?)");
    $s->execute([$p['id'], $actor['id'] ?? 0]);
    foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $to) send_mail($to, "$brand: a case switched to " . ($change['to'] === 'lop' ? 'a letter of protection' : 'insurance billing'), $text, $brand);
}
