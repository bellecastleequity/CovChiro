<?php
// Case-management rules: the stage pipeline, case types, insurance
// coverage, the checklist and its deadlines (from the practice's Injury
// Tracking Sheet), Florida PIP and workers' comp rules, balances, and the
// alerts that drive the dashboard. Edit the numbers here to match your own
// office protocol.

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

const INJURY_TYPES = ['auto' => 'Auto accident', 'slip_fall' => 'Slip & fall', 'workers_comp' => "Workers' comp"];

const COVERAGE_TYPES = ['pip' => 'PIP', 'medpay' => 'MedPay', 'health' => 'Health insurance', 'workers_comp' => "Workers' comp"];
const COVERAGE_STATUS = ['active' => 'Active', 'denied' => 'Denied', 'exhausted' => 'Exhausted', 'closed' => 'Closed'];

// Case-level summary of where the bills go, derived from the coverages.
const BENEFITS = [
    'pip' => 'PIP', 'benex' => 'PIP exhausted', 'denied' => 'PIP denied', 'medpay' => 'MedPay',
    'health' => 'Health insurance', 'wc' => "Workers' comp", 'lop' => 'Patient balance / LOP',
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
// capped at $2,500. PIP pays 80% of reasonable charges; the other 20% is
// moved to the patient balance.
define('PIP_INITIAL_CARE_DAYS', 14);
define('PIP_DEFAULT_LIMIT', 10000.00);
define('PIP_NO_EMC_CAP', 2500.00);
define('PIP_PAYS_PCT', 0.80);
// Florida workers' comp (§440.13(2)(a)) limits chiropractic care to 18
// treatments or 8 weeks after the first chiropractic treatment unless the
// carrier authorizes more. Verify against the current statute.
define('WC_CHIRO_MAX_VISITS', 18);
define('WC_CHIRO_MAX_DAYS', 56);
define('WC_DWC25_DAYS', 3);
// The lowest share of the patient balance the office will normally accept
// on an attorney's reduction request (the "80%" column on the A/R sheet).
define('REDUCTION_FLOOR_PCT', 0.80);

define('TREATMENT_GAP_DAYS', 14);
define('STALE_CORRESPONDENCE_DAYS', 30);
define('OUTCOME_INTERVAL_DAYS', 30);
define('REPORT_CHASE_DAYS', 7);
// Insurance charges still unpaid after this many days get flagged — the
// prompt to follow up with the carrier or move them to the patient balance.
define('INSURANCE_FOLLOWUP_DAYS', 45);

// Checklist. 'cases' limits an item to certain case types; 'anchor' is the
// date the deadline counts from and 'days' how long after it the item is due.
// 'source' => 'referral' items complete themselves from the Referrals tab,
// 'source' => 'case' items from a date field on the case; the rest are
// ticked off by hand.
const ALL_CASES = ['auto', 'slip_fall', 'workers_comp'];
const LIABILITY_CASES = ['auto', 'slip_fall'];
const CHECKLIST = [
    // Within 48 hours of the first visit
    'attorney_contacted'      => ['label' => 'Called attorney',                     'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => LIABILITY_CASES],
    'lor_received'            => ['label' => 'Letter of representation received',   'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => LIABILITY_CASES],
    'aob_signed'              => ['label' => 'PIP application / assignment of benefits signed', 'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ['auto']],
    'lop_signed'              => ['label' => 'Letter of protection signed by patient', 'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ['slip_fall'], 'source' => 'case', 'field' => 'lop_signed_on'],
    'incident_report'         => ['label' => 'Incident report & photos requested',  'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ['slip_fall']],
    'wc_first_report'         => ["label" => "Employer's first report of injury (DWC-1) on file", 'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ['workers_comp']],
    'wc_authorization'        => ['label' => 'Carrier authorization received',      'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 0, 'cases' => ['workers_comp']],
    'prior_records_requested' => ['label' => 'Requested prior medical records (ER/hospital)', 'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ALL_CASES],
    'prior_imaging_requested' => ['label' => 'Requested prior imaging',             'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ALL_CASES],
    'initial_adl'             => ['label' => 'Initial ADL survey completed',        'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ALL_CASES],
    'adl_entered'             => ['label' => 'ADL uploaded & entered in chart',     'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 2, 'cases' => ALL_CASES],
    'prior_records_received'  => ['label' => 'Prior medical records received',      'group' => 'Within 48 hours', 'anchor' => 'first_visit', 'days' => 14, 'cases' => ALL_CASES],
    // Co-management (completed from the Referrals tab)
    'mri_ordered'             => ['label' => 'MRI ordered',                         'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 10, 'cases' => ALL_CASES, 'source' => 'referral', 'types' => ['mri', 'ct'], 'field' => 'ordered_on'],
    'mri_report'              => ['label' => 'MRI report received & in chart',      'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 21, 'cases' => ALL_CASES, 'source' => 'referral', 'types' => ['mri', 'ct'], 'field' => 'report_received_on'],
    'emc_referral'            => ['label' => 'Sent for EMC determination',          'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 21, 'cases' => ['auto'], 'source' => 'referral', 'types' => ['emc'], 'field' => 'ordered_on'],
    'emc_report'              => ['label' => 'EMC report received & in chart',      'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 35, 'cases' => ['auto'], 'source' => 'referral', 'types' => ['emc'], 'field' => 'report_received_on'],
    'consult_referral'        => ['label' => 'Sent for ortho/neuro/pain consult',   'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 45, 'cases' => ALL_CASES, 'source' => 'referral', 'types' => ['ortho', 'neuro', 'pain_mgmt', 'surgical'], 'field' => 'ordered_on'],
    'consult_report'          => ['label' => 'Consult report received & in chart',  'group' => 'Imaging & co-management', 'anchor' => 'first_visit', 'days' => 60, 'cases' => ALL_CASES, 'source' => 'referral', 'types' => ['ortho', 'neuro', 'pain_mgmt', 'surgical'], 'field' => 'report_received_on'],
    // Discharge
    'final_adl'               => ['label' => 'Final ADL survey completed',          'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 0, 'cases' => ALL_CASES],
    'tx_complete_letter'      => ['label' => 'Treatment complete letter sent',      'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 7, 'cases' => LIABILITY_CASES],
    'final_narrative'         => ['label' => 'Final narrative report sent',         'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 14, 'cases' => LIABILITY_CASES],
    'wc_final_status'         => ['label' => 'Final DWC-25 (MMI / discharge status) sent to carrier', 'group' => 'At discharge', 'anchor' => 'discharge_date', 'days' => 3, 'cases' => ['workers_comp']],
    'records_request'         => ['label' => 'Attorney records request fulfilled',  'group' => 'At discharge', 'anchor' => null, 'days' => null, 'cases' => LIABILITY_CASES],
];

function days_between(?string $from, ?string $to): ?int {
    if (!$from || !$to) return null;
    return (int)round((strtotime($to) - strtotime($from)) / 86400);
}

function add_days(string $date, int $days): string {
    return date('Y-m-d', strtotime($date . ' ' . ($days >= 0 ? '+' : '') . $days . ' days'));
}

// ---------- Balances ----------
const CREDIT_KINDS = ['payment', 'adjustment', 'reduction', 'write_off'];

// Totals for one case: per bucket, per coverage, and the settlement floor.
// A charge adds to its bucket; payments, adjustments, reductions and
// write-offs subtract from theirs; a transfer subtracts from its source and
// adds to its destination (so it never changes the total owed).
function ledger_totals(array $entries): array {
    $t = ['insurance_charges' => 0.0, 'insurance_paid' => 0.0, 'insurance_adjusted' => 0.0,
          'patient_charges' => 0.0, 'patient_paid' => 0.0, 'patient_reduced' => 0.0,
          'moved_to_patient' => 0.0, 'insurance_balance' => 0.0, 'patient_balance' => 0.0];
    $cov = [];
    $covRow = function ($id) use (&$cov) {
        $id = (int)$id;
        if (!isset($cov[$id])) $cov[$id] = ['charges' => 0.0, 'paid' => 0.0, 'adjusted' => 0.0, 'moved_out' => 0.0, 'moved_in' => 0.0, 'balance' => 0.0];
        return $id;
    };
    foreach ($entries as $e) {
        if (!empty($e['archived_at'])) continue;
        $a = (float)$e['amount'];
        $ins = $e['bucket'] === 'insurance';
        if ($e['kind'] === 'charge') {
            if ($ins) { $t['insurance_charges'] += $a; $t['insurance_balance'] += $a; $c = $covRow($e['coverage_id']); $cov[$c]['charges'] += $a; $cov[$c]['balance'] += $a; }
            else { $t['patient_charges'] += $a; $t['patient_balance'] += $a; }
        } elseif (in_array($e['kind'], CREDIT_KINDS, true)) {
            $paid = $e['kind'] === 'payment';
            if ($ins) {
                $t[$paid ? 'insurance_paid' : 'insurance_adjusted'] += $a; $t['insurance_balance'] -= $a;
                $c = $covRow($e['coverage_id']); $cov[$c][$paid ? 'paid' : 'adjusted'] += $a; $cov[$c]['balance'] -= $a;
            } else {
                $t[$paid ? 'patient_paid' : 'patient_reduced'] += $a; $t['patient_balance'] -= $a;
            }
        } elseif ($e['kind'] === 'transfer') {
            if ($ins) { $t['insurance_balance'] -= $a; $c = $covRow($e['coverage_id']); $cov[$c]['moved_out'] += $a; $cov[$c]['balance'] -= $a; }
            else { $t['patient_balance'] -= $a; }
            if ($e['to_bucket'] === 'insurance') { $t['insurance_balance'] += $a; $c = $covRow($e['to_coverage_id']); $cov[$c]['moved_in'] += $a; $cov[$c]['balance'] += $a; }
            else { $t['patient_balance'] += $a; }
            if ($ins && $e['to_bucket'] === 'patient') $t['moved_to_patient'] += $a;
            if (!$ins && $e['to_bucket'] === 'insurance') $t['moved_to_patient'] -= $a;
        }
    }
    foreach ($t as $k => $v) $t[$k] = round($v, 2);
    foreach ($cov as $id => $row) foreach ($row as $k => $v) $cov[$id][$k] = round($v, 2);
    $t['insurance_credits'] = round($t['insurance_paid'] + $t['insurance_adjusted'], 2);
    $t['total_charges'] = round($t['insurance_charges'] + $t['patient_charges'], 2);
    $t['total_balance'] = round($t['insurance_balance'] + $t['patient_balance'], 2);
    // Reductions only ever apply to the patient balance the attorney pays.
    $t['reduction_floor'] = round(max(0, $t['patient_balance']) * REDUCTION_FLOOR_PCT, 2);
    $t['by_coverage'] = $cov;
    return $t;
}

// Per-charge view: for each charge (date of service), what insurance paid,
// what was moved, and what is still open with insurance and with the
// patient. Only entries linked to the charge (applies_to_id) count here.
function ledger_open_items(array $entries): array {
    $items = [];
    foreach ($entries as $e) {
        if (!empty($e['archived_at']) || $e['kind'] !== 'charge') continue;
        $ins = $e['bucket'] === 'insurance';
        $items[(int)$e['id']] = ['id' => (int)$e['id'], 'date' => $e['entry_date'], 'memo' => $e['memo'], 'reference' => $e['reference'],
            'visit_id' => $e['visit_id'] ? (int)$e['visit_id'] : null, 'amount' => (float)$e['amount'],
            'billed_to' => $ins ? 'insurance' : 'patient', 'billed_coverage_id' => $ins && $e['coverage_id'] ? (int)$e['coverage_id'] : null,
            'coverage_id' => $ins && $e['coverage_id'] ? (int)$e['coverage_id'] : null,
            'ins_paid' => 0.0, 'ins_adjusted' => 0.0, 'moved_to_patient' => 0.0, 'pat_paid' => 0.0, 'pat_reduced' => 0.0,
            'ins_open' => $ins ? (float)$e['amount'] : 0.0, 'pat_open' => $ins ? 0.0 : (float)$e['amount']];
    }
    foreach ($entries as $e) {
        if (!empty($e['archived_at']) || !$e['applies_to_id'] || !isset($items[(int)$e['applies_to_id']])) continue;
        $it = &$items[(int)$e['applies_to_id']];
        $a = (float)$e['amount'];
        $ins = $e['bucket'] === 'insurance';
        if (in_array($e['kind'], CREDIT_KINDS, true)) {
            $paid = $e['kind'] === 'payment';
            if ($ins) { $it[$paid ? 'ins_paid' : 'ins_adjusted'] += $a; $it['ins_open'] -= $a; }
            else { $it[$paid ? 'pat_paid' : 'pat_reduced'] += $a; $it['pat_open'] -= $a; }
        } elseif ($e['kind'] === 'transfer') {
            if ($ins) $it['ins_open'] -= $a; else $it['pat_open'] -= $a;
            if ($e['to_bucket'] === 'insurance') { $it['ins_open'] += $a; if ($e['to_coverage_id']) $it['coverage_id'] = (int)$e['to_coverage_id']; }
            else $it['pat_open'] += $a;
            if ($ins && $e['to_bucket'] === 'patient') $it['moved_to_patient'] += $a;
            if (!$ins && $e['to_bucket'] === 'insurance') $it['moved_to_patient'] -= $a;
        }
        unset($it);
    }
    foreach ($items as &$it) foreach (['ins_paid', 'ins_adjusted', 'moved_to_patient', 'pat_paid', 'pat_reduced', 'ins_open', 'pat_open'] as $k) $it[$k] = round($it[$k], 2);
    unset($it);
    return array_values($items);
}

// Bulk version for list screens: case_id => ledger rows.
function ledger_rows_by_case(PDO $pdo, array $caseIds): array {
    if (!$caseIds) return [];
    $rows = $pdo->query('SELECT * FROM ledger WHERE archived_at IS NULL AND case_id IN (' . implode(',', array_map('intval', $caseIds)) . ')')->fetchAll();
    $out = [];
    foreach ($rows as $r) $out[$r['case_id']][] = $r;
    return $out;
}

function ledger_totals_by_case(PDO $pdo, array $caseIds): array {
    $rows = ledger_rows_by_case($pdo, $caseIds);
    $out = [];
    foreach ($caseIds as $id) $out[$id] = ledger_totals($rows[$id] ?? []);
    return $out;
}

// ---------- Coverage ----------
function first_coverage(array $coverages, string $type): ?array {
    foreach ($coverages as $c) if ($c['type'] === $type && empty($c['archived_at'])) return $c;
    return null;
}

function active_coverages(array $coverages): array {
    $out = array_values(array_filter($coverages, fn($c) => empty($c['archived_at']) && $c['status'] === 'active'));
    usort($out, fn($a, $b) => $a['priority'] <=> $b['priority'] ?: $a['id'] <=> $b['id']);
    return $out;
}

// What the case summary ("benefits") should say, given its coverages. A
// slip & fall with no insurance is patient balance only; an auto or WC case
// with nothing entered yet is simply unknown.
function derive_benefits(array $coverages, string $injuryType): ?string {
    if ($wc = first_coverage($coverages, 'workers_comp')) return 'wc';
    if ($pip = first_coverage($coverages, 'pip')) {
        if ($pip['status'] === 'active') return 'pip';
        return $pip['status'] === 'denied' ? 'denied' : 'benex';
    }
    $active = active_coverages($coverages);
    if ($active) return $active[0]['type'] === 'medpay' ? 'medpay' : 'health';
    if (!$coverages && $injuryType !== 'slip_fall') return null;
    return 'lop';
}

function pip_effective_limit(array $case, ?array $pip): float {
    $limit = $pip && $pip['benefit_limit'] !== null ? (float)$pip['benefit_limit'] : PIP_DEFAULT_LIMIT;
    return $case['emc_status'] === 'yes' ? $limit : min($limit, PIP_NO_EMC_CAP);
}

// ---------- Checklist ----------
// Returns each item that applies to the case type with its status: done |
// na | overdue | due | upcoming | waiting ('waiting' = its anchor date,
// e.g. discharge, hasn't happened yet).
function case_checklist(array $case, array $milestoneRows, array $referrals): array {
    $byKey = [];
    foreach ($milestoneRows as $m) $byKey[$m['milestone']] = $m;
    $today = date('Y-m-d');
    $items = [];
    foreach (CHECKLIST as $key => $def) {
        if (!in_array($case['injury_type'], $def['cases'], true)) continue;
        $m = $byKey[$key] ?? null;
        $completedOn = $m['completed_on'] ?? null;
        $source = $def['source'] ?? null;
        if ($source === 'referral' && !$completedOn) {
            foreach ($referrals as $r) {
                if (!empty($r['archived_at']) || !in_array($r['type'], $def['types'], true)) continue;
                $d = $r[$def['field']] ?? null;
                if ($d && (!$completedOn || $d < $completedOn)) $completedOn = $d;
            }
        } elseif ($source === 'case' && !$completedOn) {
            $completedOn = $case[$def['field']] ?? null;
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
            'auto' => $source !== null, 'autoFrom' => $source,
            'due' => $due, 'completedOn' => $completedOn, 'status' => $status,
            'note' => $m['note'] ?? null,
        ];
    }
    return $items;
}

// ---------- Alerts ----------
// $ctx: checklist, referrals, coverages, ledger, visits (WC), lastVisit,
// lastCorrespondence, lastOutcome, openFollowUps, totals.
// Each alert: [level => high|medium|low, text].
function case_alerts(array $case, array $ctx): array {
    $alerts = [];
    $today = date('Y-m-d');
    if (!in_array($case['stage'], OPEN_STAGES, true)) return $alerts;
    $treatingPhase = in_array($case['stage'], ['intake', 'treating'], true);
    $coverages = $ctx['coverages'] ?? [];
    $pip = first_coverage($coverages, 'pip');
    $wc = first_coverage($coverages, 'workers_comp');
    // An auto case with no coverage entered yet is treated as PIP-eligible.
    $autoPip = $case['injury_type'] === 'auto' && (!$pip || $pip['status'] === 'active') && !$wc;

    // Florida PIP 14-day rule.
    if ($autoPip && $treatingPhase && $case['date_of_injury']) {
        $deadline = add_days($case['date_of_injury'], PIP_INITIAL_CARE_DAYS);
        if ($case['first_visit'] && $case['first_visit'] > $deadline) {
            $alerts[] = ['level' => 'high', 'text' => 'First visit was ' . days_between($case['date_of_injury'], $case['first_visit']) . ' days after the accident — PIP requires initial care within 14 days.'];
        } elseif (!$case['first_visit'] && $today <= $deadline) {
            $alerts[] = ['level' => 'high', 'text' => 'Not seen yet — must be treated by ' . $deadline . ' to keep PIP eligibility.'];
        }
    }
    if ($case['injury_type'] === 'auto' && !$pip && $treatingPhase && $case['first_visit']) {
        $alerts[] = ['level' => 'medium', 'text' => 'No PIP claim entered — add the PIP coverage and claim # under Financials.'];
    }

    // EMC determination: without one, PIP medical benefits cap at $2,500.
    if ($autoPip && $treatingPhase && $case['emc_status'] !== 'yes' && $case['first_visit'] && days_between($case['first_visit'], $today) > 14) {
        $alerts[] = ['level' => $case['emc_status'] === 'no' ? 'medium' : 'high',
            'text' => $case['emc_status'] === 'no'
                ? 'EMC determined NOT to exist — PIP benefits capped at $2,500.'
                : 'No EMC determination on file — PIP benefits are capped at $2,500 until one is made.'];
    }

    // Charges billed to PIP approaching its limit (PIP pays 80%).
    if ($pip && $pip['status'] === 'active' && isset($ctx['totals'])) {
        $limit = pip_effective_limit($case, $pip);
        $billed = $ctx['totals']['by_coverage'][(int)$pip['id']]['charges'] ?? 0;
        $expected = $billed * PIP_PAYS_PCT;
        if ($limit > 0 && $expected >= $limit * 0.85) {
            $alerts[] = ['level' => 'medium', 'text' => 'PIP charges are at ' . round($expected / $limit * 100) . '% of the $' . number_format($limit) . ' limit — when exhausted, move the remainder to the patient balance.'];
        }
    }

    // PIP ended: the patient balance needs a signed LOP behind it.
    if ($pip && in_array($pip['status'], ['denied', 'exhausted'], true) && !$case['lop_signed_on'] && $case['injury_type'] !== 'workers_comp') {
        $alerts[] = ['level' => 'medium', 'text' => 'PIP ' . $pip['status'] . ($pip['status_on'] ? ' ' . $pip['status_on'] : '') . ' — get a letter of protection signed for the patient balance.'];
    }

    // Insurance charges unpaid for a while: follow up, or (if denied) move
    // them to the patient balance. Never moved automatically.
    $stale = array_filter($ctx['openItems'] ?? [], fn($i) => $i['ins_open'] > 0.005 && days_between($i['date'], $today) > INSURANCE_FOLLOWUP_DAYS);
    if ($stale) {
        $alerts[] = ['level' => 'low', 'text' => count($stale) . ' insurance charge' . (count($stale) === 1 ? '' : 's') . ' unpaid after ' . INSURANCE_FOLLOWUP_DAYS . ' days ($' . number_format(array_sum(array_column($stale, 'ins_open')), 2) . ') — follow up with the carrier, or move to the patient balance.'];
    }

    // Workers' comp: authorization and DWC-25 status forms.
    if ($wc && $wc['status'] === 'active' && $treatingPhase) {
        $visits = $ctx['wcVisits'] ?? ['count' => 0, 'missing25' => 0];
        if ($wc['authorized_visits'] !== null) {
            $left = (int)$wc['authorized_visits'] - $visits['count'];
            if ($left <= 0) $alerts[] = ['level' => 'high', 'text' => 'All ' . $wc['authorized_visits'] . ' authorized visits used — request more authorization before the next visit.'];
            elseif ($left <= 2) $alerts[] = ['level' => 'medium', 'text' => $left . ' authorized visit' . ($left === 1 ? '' : 's') . ' left — request more authorization from the adjuster.'];
        } elseif ($visits['count'] >= WC_CHIRO_MAX_VISITS || ($case['first_visit'] && days_between($case['first_visit'], $today) > WC_CHIRO_MAX_DAYS)) {
            $alerts[] = ['level' => 'high', 'text' => 'Past the ' . WC_CHIRO_MAX_VISITS . '-visit / 8-week chiropractic limit — further care needs carrier authorization.'];
        }
        if ($wc['authorized_through'] && $wc['authorized_through'] < $today) {
            $alerts[] = ['level' => 'high', 'text' => 'Carrier authorization expired ' . $wc['authorized_through'] . '.'];
        }
        if ($visits['missing25'] > 0) {
            $alerts[] = ['level' => 'medium', 'text' => 'DWC-25 not sent for ' . $visits['missing25'] . ' visit' . ($visits['missing25'] === 1 ? '' : 's') . '.'];
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

    if ($case['stage'] === 'settled' && !$case['balance_forwarded_on'] && ($ctx['totals']['patient_balance'] ?? 0) > 0) {
        $alerts[] = ['level' => 'medium', 'text' => 'Case settled — forward the patient balance to the attorney.'];
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
    foreach ($ids as $id) $ctx[$id] = ['milestones' => [], 'referrals' => [], 'coverages' => [], 'openFollowUps' => [], 'lastVisit' => null,
        'lastCorrespondence' => null, 'lastOutcome' => null, 'wcVisits' => ['count' => 0, 'missing25' => 0]];
    if (!$ids) return $ctx;
    $in = implode(',', $ids);
    foreach ($pdo->query("SELECT * FROM case_milestones WHERE case_id IN ($in)") as $r) $ctx[$r['case_id']]['milestones'][] = $r;
    foreach ($pdo->query("SELECT * FROM referrals WHERE archived_at IS NULL AND case_id IN ($in)") as $r) $ctx[$r['case_id']]['referrals'][] = $r;
    foreach ($pdo->query("SELECT cv.*, k.organization carrier_org FROM coverages cv LEFT JOIN contacts k ON k.id = cv.carrier_contact_id WHERE cv.archived_at IS NULL AND cv.case_id IN ($in) ORDER BY cv.priority, cv.id") as $r) $ctx[$r['case_id']]['coverages'][] = $r;
    foreach ($pdo->query("SELECT case_id, MAX(visit_date) d FROM visits WHERE archived_at IS NULL AND visit_type <> 'no_show' AND case_id IN ($in) GROUP BY case_id") as $r) $ctx[$r['case_id']]['lastVisit'] = $r['d'];
    $cutoff = add_days(date('Y-m-d'), -WC_DWC25_DAYS);
    foreach ($pdo->query("SELECT case_id, COUNT(*) n, SUM(dwc25_sent = 0 AND visit_date <= '$cutoff') missing FROM visits WHERE archived_at IS NULL AND visit_type <> 'no_show' AND case_id IN ($in) GROUP BY case_id") as $r) {
        $ctx[$r['case_id']]['wcVisits'] = ['count' => (int)$r['n'], 'missing25' => (int)$r['missing']];
    }
    foreach ($pdo->query("SELECT case_id, MAX(occurred_on) d FROM correspondence WHERE archived_at IS NULL AND case_id IN ($in) GROUP BY case_id") as $r) $ctx[$r['case_id']]['lastCorrespondence'] = $r['d'];
    foreach ($pdo->query("SELECT case_id, MAX(taken_on) d FROM outcomes WHERE archived_at IS NULL AND case_id IN ($in) GROUP BY case_id") as $r) $ctx[$r['case_id']]['lastOutcome'] = $r['d'];
    foreach ($pdo->query("SELECT case_id, follow_up_on, subject FROM correspondence WHERE archived_at IS NULL AND follow_up_on IS NOT NULL AND follow_up_done = 0 AND case_id IN ($in)") as $r) $ctx[$r['case_id']]['openFollowUps'][] = $r;
    $ledger = ledger_rows_by_case($pdo, $ids);
    foreach ($cases as $c) {
        $id = (int)$c['id'];
        $ctx[$id]['totals'] = ledger_totals($ledger[$id] ?? []);
        $ctx[$id]['openItems'] = ledger_open_items($ledger[$id] ?? []);
        $ctx[$id]['checklist'] = case_checklist($c, $ctx[$id]['milestones'], $ctx[$id]['referrals']);
    }
    return $ctx;
}
