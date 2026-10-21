<?php
// Case-management rules: the stage pipeline, the checklist and its
// deadlines (taken from the practice's Injury Tracking Sheet), Florida PIP
// rules, balances, and the alerts that drive the dashboard. Edit the
// numbers here to match your own office protocol.

const STAGES = [
    'intake'      => 'Intake',
    'treating'    => 'Treating',
    'tx_complete' => 'Treatment complete',
    'demand'      => 'In demand / pre-suit',
    'litigation'  => 'Pending in litigation',
    'mediation'   => 'Mediation scheduled',
    'negotiating' => 'Reduction negotiation',
    'settled'     => 'Settled — awaiting check',
    'closed'      => 'Closed / paid',
    'dropped'     => 'Dropped',
];
const OPEN_STAGES = ['intake', 'treating', 'tx_complete', 'demand', 'litigation', 'mediation', 'negotiating', 'settled'];
const LEGAL_STAGES = ['demand', 'litigation', 'mediation', 'negotiating'];

const BENEFITS = [
    'pip' => 'PIP', 'benex' => 'PIP exhausted (BENEX)', 'lop' => 'Letter of protection',
    'medpay' => 'MedPay', 'denied' => 'Denied', 'health' => 'Health insurance', 'other' => 'Other',
];

const REFERRAL_TYPES = [
    'mri' => 'MRI', 'xray' => 'X-ray', 'ct' => 'CT', 'emc' => 'EMC determination (MD/DO)',
    'ortho' => 'Orthopedic consult', 'neuro' => 'Neurology consult', 'pain_mgmt' => 'Pain management',
    'surgical' => 'Surgical consult', 'pt' => 'Physical therapy', 'other' => 'Other',
];

const OUTCOME_MEASURES = [
    'bournemouth_neck' => 'Neck Bournemouth', 'bournemouth_back' => 'Back Bournemouth',
    'oswestry' => 'Oswestry (ODI)', 'ndi' => 'Neck Disability Index', 'hdi' => 'Headache Disability (HDI)',
    'shoulder' => 'Shoulder', 'knee' => 'Knee', 'adl' => 'ADL survey',
];

// Florida PIP (§627.736): initial treatment within 14 days of the accident
// or PIP medical benefits are denied; full $10,000 only with an Emergency
// Medical Condition determination by an MD/DO/DMD/PA/APRN, otherwise
// capped at $2,500. PIP pays 80% of reasonable charges.
define('PIP_INITIAL_CARE_DAYS', 14);
define('PIP_NO_EMC_CAP', 2500.00);
define('PIP_PAYS_PCT', 0.80);
// The lowest share of the balance the office will normally accept on a
// reduction request (the "80%" column on the A/R sheet).
define('REDUCTION_FLOOR_PCT', 0.80);

define('TREATMENT_GAP_DAYS', 14);
define('STALE_CORRESPONDENCE_DAYS', 30);
define('OUTCOME_INTERVAL_DAYS', 30);
define('REPORT_CHASE_DAYS', 7);

// Checklist. 'anchor' is the date the deadline counts from; 'days' is how
// long after it the item is due. 'source' => 'referral' items complete
// themselves from the Referrals tab; the rest are ticked off by hand.
const CHECKLIST = [
    // Within 48 hours of the first visit
    'attorney_contacted'      => ['label' => 'Called attorney',                     'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'lor_received'            => ['label' => 'Letter of representation received',   'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'aob_signed'              => ['label' => 'Assignment of benefits / PIP forms signed', 'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'prior_records_requested' => ['label' => 'Requested prior medical records (ER/hospital)', 'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'prior_imaging_requested' => ['label' => 'Requested prior imaging',             'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'initial_adl'             => ['label' => 'Initial ADL survey completed',        'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'adl_entered'             => ['label' => 'ADL uploaded & entered in chart',     'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2],
    'prior_records_received'  => ['label' => 'Prior medical records received',      'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 14],
    // Co-management (completed from the Referrals tab)
    'mri_ordered'             => ['label' => 'MRI ordered',                         'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 10, 'source' => 'referral', 'types' => ['mri', 'ct'], 'field' => 'ordered_on'],
    'mri_report'              => ['label' => 'MRI report received & in chart',      'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 21, 'source' => 'referral', 'types' => ['mri', 'ct'], 'field' => 'report_received_on'],
    'emc_referral'            => ['label' => 'Sent for EMC determination',          'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 21, 'source' => 'referral', 'types' => ['emc'], 'field' => 'ordered_on'],
    'emc_report'              => ['label' => 'EMC report received & in chart',      'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 35, 'source' => 'referral', 'types' => ['emc'], 'field' => 'report_received_on'],
    'consult_referral'        => ['label' => 'Sent for ortho/neuro/pain consult',   'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 45, 'source' => 'referral', 'types' => ['ortho', 'neuro', 'pain_mgmt', 'surgical'], 'field' => 'ordered_on'],
    'consult_report'          => ['label' => 'Consult report received & in chart',  'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 60, 'source' => 'referral', 'types' => ['ortho', 'neuro', 'pain_mgmt', 'surgical'], 'field' => 'report_received_on'],
    // Discharge
    'final_adl'               => ['label' => 'Final ADL survey completed',          'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 0],
    'tx_complete_letter'      => ['label' => 'Treatment complete letter sent',      'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 7],
    'final_narrative'         => ['label' => 'Final narrative report sent',         'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 14],
    'records_request'         => ['label' => 'Attorney records request fulfilled',  'group' => 'At discharge', 'anchor' => null, 'days' => null],
];

function days_between(?string $from, ?string $to): ?int {
    if (!$from || !$to) return null;
    return (int)round((strtotime($to) - strtotime($from)) / 86400);
}

function add_days(string $date, int $days): string {
    return date('Y-m-d', strtotime($date . ' ' . ($days >= 0 ? '+' : '') . $days . ' days'));
}

// ---------- Balances ----------
// Charges add; every other ledger kind is a credit.
function ledger_totals(array $entries): array {
    $t = ['insurance_charges' => 0.0, 'insurance_credits' => 0.0, 'patient_charges' => 0.0, 'patient_credits' => 0.0];
    foreach ($entries as $e) {
        if (!empty($e['archived_at'])) continue;
        $key = $e['bucket'] . ($e['kind'] === 'charge' ? '_charges' : '_credits');
        $t[$key] += (float)$e['amount'];
    }
    $t['insurance_balance'] = round($t['insurance_charges'] - $t['insurance_credits'], 2);
    $t['patient_balance'] = round($t['patient_charges'] - $t['patient_credits'], 2);
    $t['total_balance'] = round($t['insurance_balance'] + $t['patient_balance'], 2);
    $t['total_charges'] = round($t['insurance_charges'] + $t['patient_charges'], 2);
    $t['reduction_floor'] = round($t['total_balance'] * REDUCTION_FLOOR_PCT, 2);
    return $t;
}

// Bulk version for list screens: case_id => totals.
function ledger_totals_by_case(PDO $pdo, ?array $caseIds = null): array {
    $sql = 'SELECT case_id, kind, bucket, amount, archived_at FROM ledger WHERE archived_at IS NULL';
    if ($caseIds !== null) {
        if (!$caseIds) return [];
        $sql .= ' AND case_id IN (' . implode(',', array_map('intval', $caseIds)) . ')';
    }
    $rows = $pdo->query($sql)->fetchAll();
    $grouped = [];
    foreach ($rows as $r) $grouped[$r['case_id']][] = $r;
    $out = [];
    foreach ($caseIds ?? array_keys($grouped) as $id) $out[$id] = ledger_totals($grouped[$id] ?? []);
    return $out;
}

function pip_effective_limit(array $case): float {
    $limit = (float)$case['pip_limit'];
    return $case['emc_status'] === 'yes' ? $limit : min($limit, PIP_NO_EMC_CAP);
}

// ---------- Checklist ----------
// Returns each item with its status: done | na | overdue | due | upcoming | waiting
// ('waiting' = its anchor date, e.g. discharge, hasn't happened yet).
function case_checklist(array $case, array $milestoneRows, array $referrals): array {
    $byKey = [];
    foreach ($milestoneRows as $m) $byKey[$m['milestone']] = $m;
    $today = date('Y-m-d');
    $items = [];
    foreach (CHECKLIST as $key => $def) {
        $m = $byKey[$key] ?? null;
        $completedOn = $m['completed_on'] ?? null;
        if (($def['source'] ?? null) === 'referral' && !$completedOn) {
            foreach ($referrals as $r) {
                if (!empty($r['archived_at']) || !in_array($r['type'], $def['types'], true)) continue;
                $d = $r[$def['field']] ?? null;
                if ($d && (!$completedOn || $d < $completedOn)) $completedOn = $d;
            }
        }
        $anchorDate = $def['anchor'] ? ($case[$def['anchor']] ?? null) : null;
        $due = ($anchorDate && $def['days'] !== null) ? add_days($anchorDate, $def['days']) : null;
        if ($m && $m['not_applicable']) $status = 'na';
        elseif ($completedOn) $status = 'done';
        elseif ($def['anchor'] && !$anchorDate) $status = 'waiting';
        elseif ($due && $due < $today) $status = 'overdue';
        elseif ($due && $due <= add_days($today, 2)) $status = 'due';
        else $status = 'upcoming';
        $items[] = [
            'key' => $key, 'label' => $def['label'], 'group' => $def['group'],
            'auto' => ($def['source'] ?? null) === 'referral',
            'due' => $due, 'completedOn' => $completedOn, 'status' => $status,
            'note' => $m['note'] ?? null,
        ];
    }
    return $items;
}

// ---------- Alerts ----------
// $ctx: checklist, referrals, lastVisit, lastCorrespondence, lastOutcome,
// openFollowUps, totals. Each alert: [level => high|medium|low, text].
function case_alerts(array $case, array $ctx): array {
    $alerts = [];
    $today = date('Y-m-d');
    $open = in_array($case['stage'], OPEN_STAGES, true);
    if (!$open) return $alerts;
    $isAutoPip = $case['injury_type'] === 'auto' && in_array($case['benefits'], ['pip', null], true);
    $treatingPhase = in_array($case['stage'], ['intake', 'treating'], true);

    // Florida PIP 14-day rule.
    if ($isAutoPip && $treatingPhase && $case['date_of_injury']) {
        $deadline = add_days($case['date_of_injury'], PIP_INITIAL_CARE_DAYS);
        if ($case['first_visit'] && $case['first_visit'] > $deadline) {
            $alerts[] = ['level' => 'high', 'text' => 'First visit was ' . days_between($case['date_of_injury'], $case['first_visit']) . ' days after the accident — PIP requires initial care within 14 days.'];
        } elseif (!$case['first_visit'] && $today <= $deadline) {
            $alerts[] = ['level' => 'high', 'text' => 'Not seen yet — must be treated by ' . $deadline . ' to keep PIP eligibility.'];
        }
    }

    // EMC determination: without one, PIP medical benefits cap at $2,500.
    // Only actionable while the patient is still in care.
    if ($isAutoPip && $treatingPhase && $case['emc_status'] !== 'yes' && $case['first_visit'] && days_between($case['first_visit'], $today) > 14) {
        $alerts[] = ['level' => $case['emc_status'] === 'no' ? 'medium' : 'high',
            'text' => $case['emc_status'] === 'no'
                ? 'EMC determined NOT to exist — PIP benefits capped at $2,500.'
                : 'No EMC determination on file — PIP benefits are capped at $2,500 until one is made.'];
    }

    // Charges approaching the PIP limit (PIP pays 80%).
    if ($case['benefits'] === 'pip' && isset($ctx['totals'])) {
        $limit = pip_effective_limit($case);
        $expected = $ctx['totals']['insurance_charges'] * PIP_PAYS_PCT;
        if ($limit > 0 && $expected >= $limit * 0.85) {
            $alerts[] = ['level' => 'medium', 'text' => 'Insurance charges are at ' . round($expected / $limit * 100) . '% of the $' . number_format($limit) . ' PIP limit — plan for BENEX/LOP.'];
        }
    }

    // Intake/co-management items only nag while the patient is in care;
    // discharge items only once care has ended.
    foreach ($ctx['checklist'] ?? [] as $item) {
        if (($item['group'] === 'At discharge') === $treatingPhase) continue;
        if ($item['status'] === 'overdue') $alerts[] = ['level' => 'medium', 'text' => 'Overdue: ' . $item['label'] . ' (due ' . $item['due'] . ')'];
    }

    foreach ($ctx['referrals'] ?? [] as $r) {
        if (!empty($r['archived_at'])) continue;
        $label = REFERRAL_TYPES[$r['type']] ?? $r['type'];
        if ($r['status'] === 'completed' && !$r['report_received_on'] && $r['completed_on'] && days_between($r['completed_on'], $today) > REPORT_CHASE_DAYS) {
            $alerts[] = ['level' => 'medium', 'text' => $label . ' done ' . $r['completed_on'] . ' — report not received yet.'];
        } elseif ($r['status'] === 'ordered' && $r['ordered_on'] && days_between($r['ordered_on'], $today) > 7) {
            $alerts[] = ['level' => 'low', 'text' => $label . ' ordered ' . $r['ordered_on'] . ' — not scheduled yet.'];
        } elseif ($r['status'] === 'no_show') {
            $alerts[] = ['level' => 'medium', 'text' => 'Patient no-showed for ' . $label . ' — reschedule.'];
        } elseif ($r['status'] === 'report_received' && !$r['entered_in_chart']) {
            $alerts[] = ['level' => 'low', 'text' => $label . ' report received — not entered in chart.'];
        }
    }

    if ($treatingPhase && $case['actively_treating'] && $case['first_visit']) {
        $last = $ctx['lastVisit'] ?? $case['first_visit'];
        $gap = days_between($last, $today);
        if ($gap > TREATMENT_GAP_DAYS) $alerts[] = ['level' => 'medium', 'text' => 'No visit in ' . $gap . ' days — gap in care weakens the claim.'];
        $lastOutcome = $ctx['lastOutcome'] ?? null;
        if (!$lastOutcome && days_between($case['first_visit'], $today) > 7) {
            $alerts[] = ['level' => 'low', 'text' => 'No outcome assessments recorded yet.'];
        } elseif ($lastOutcome && days_between($lastOutcome, $today) > OUTCOME_INTERVAL_DAYS) {
            $alerts[] = ['level' => 'low', 'text' => 'Outcome assessments due (last ' . $lastOutcome . ').'];
        }
    }

    if (in_array($case['stage'], LEGAL_STAGES, true)) {
        $lc = $ctx['lastCorrespondence'] ?? null;
        if (!$lc || days_between($lc, $today) > STALE_CORRESPONDENCE_DAYS) {
            $alerts[] = ['level' => 'medium', 'text' => $lc ? 'No status update from the attorney since ' . $lc . '.' : 'No correspondence logged — request a case status update.'];
        }
    }

    foreach ($ctx['openFollowUps'] ?? [] as $f) {
        if ($f['follow_up_on'] <= $today) $alerts[] = ['level' => 'medium', 'text' => 'Follow-up due ' . $f['follow_up_on'] . ': ' . $f['subject']];
    }

    if ($case['stage'] === 'settled' && !$case['check_received_on'] && $case['date_authorized'] && days_between($case['date_authorized'], $today) > 30) {
        $alerts[] = ['level' => 'high', 'text' => 'Reduction authorized ' . $case['date_authorized'] . ' — check still not received.'];
    }

    $rank = ['high' => 0, 'medium' => 1, 'low' => 2];
    usort($alerts, fn($a, $b) => $rank[$a['level']] <=> $rank[$b['level']]);
    return $alerts;
}

// Everything the alerts need for every open case, in a handful of queries
// rather than one round trip per case. Returns case_id => context.
function bulk_case_context(PDO $pdo, array $cases): array {
    $ids = array_map(fn($c) => (int)$c['id'], $cases);
    $ctx = [];
    foreach ($ids as $id) $ctx[$id] = ['milestones' => [], 'referrals' => [], 'openFollowUps' => [], 'lastVisit' => null, 'lastCorrespondence' => null, 'lastOutcome' => null];
    if (!$ids) return $ctx;
    $in = implode(',', $ids);
    foreach ($pdo->query("SELECT * FROM case_milestones WHERE case_id IN ($in)") as $r) $ctx[$r['case_id']]['milestones'][] = $r;
    foreach ($pdo->query("SELECT * FROM referrals WHERE archived_at IS NULL AND case_id IN ($in)") as $r) $ctx[$r['case_id']]['referrals'][] = $r;
    foreach ($pdo->query("SELECT case_id, MAX(visit_date) d FROM visits WHERE archived_at IS NULL AND visit_type <> 'no_show' AND case_id IN ($in) GROUP BY case_id") as $r) $ctx[$r['case_id']]['lastVisit'] = $r['d'];
    foreach ($pdo->query("SELECT case_id, MAX(occurred_on) d FROM correspondence WHERE archived_at IS NULL AND case_id IN ($in) GROUP BY case_id") as $r) $ctx[$r['case_id']]['lastCorrespondence'] = $r['d'];
    foreach ($pdo->query("SELECT case_id, MAX(taken_on) d FROM outcomes WHERE archived_at IS NULL AND case_id IN ($in) GROUP BY case_id") as $r) $ctx[$r['case_id']]['lastOutcome'] = $r['d'];
    foreach ($pdo->query("SELECT case_id, follow_up_on, subject FROM correspondence WHERE archived_at IS NULL AND follow_up_on IS NOT NULL AND follow_up_done = 0 AND case_id IN ($in)") as $r) $ctx[$r['case_id']]['openFollowUps'][] = $r;
    $totals = ledger_totals_by_case($pdo, $ids);
    foreach ($cases as $c) {
        $id = (int)$c['id'];
        $ctx[$id]['totals'] = $totals[$id];
        $ctx[$id]['checklist'] = case_checklist($c, $ctx[$id]['milestones'], $ctx[$id]['referrals']);
    }
    return $ctx;
}
