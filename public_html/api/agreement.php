<?php
// Renders the actual signed agreement for a booking or standing-day
// agreement as a printable HTML page — generated on demand from data
// already on the record, rather than a manually-drafted document. The
// provider's counter-signature is applied automatically at the same
// moment the booking/agreement itself was created (bookings are
// auto-confirmed on deposit; standing agreements are created exactly when
// admin approves the request) — there is no separate manual signing step.
require_once __DIR__ . '/../../php_backend/config.php';

$type = $_GET['type'] ?? '';
$id = $_GET['id'] ?? '';
$user = current_user_or_null();
if (!$user) { http_response_code(401); echo 'Sign in to view this agreement.'; exit; }

if ($type === 'standing') {
    $stmt = $pdo->prepare('SELECT * FROM standing_agreements WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    $owns = $row && ((int)($row['user_id'] ?? 0) === (int)$user['id'] || strtolower($row['contact_email']) === strtolower($user['email']));
    if (!$row || (!$owns && !$user['is_admin'])) { http_response_code(404); echo 'Not found.'; exit; }
    render_standing_agreement($row);
} else {
    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    $owns = $row && (int)$row['user_id'] === (int)$user['id'];
    if (!$row || (!$owns && !$user['is_admin'])) { http_response_code(404); echo 'Not found.'; exit; }
    render_booking_agreement($row);
}

function page_shell($title, $bodyHtml) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' .
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' .
        '<title>' . htmlspecialchars($title) . '</title><meta name="robots" content="noindex">' .
        '<link rel="preconnect" href="https://fonts.googleapis.com">' .
        '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">' .
        '<style>
          :root{--ink:#1C2430;--paper:#EFEAE0;--teal:#2F5D53;--teal-dark:#1F3F38;--line:#CFC7B4;--white:#FBF9F4;}
          *{box-sizing:border-box;} body{margin:0;background:var(--white);color:var(--ink);font-family:"IBM Plex Sans",sans-serif;font-size:16px;line-height:1.6;}
          h1,h2,h3{font-family:"Playfair Display",serif;font-weight:500;color:var(--teal-dark);}
          .wrap{max-width:700px;margin:0 auto;padding:36px 28px 60px;}
          .mono{font-family:"IBM Plex Mono",monospace;letter-spacing:0.05em;text-transform:uppercase;font-size:0.72rem;color:var(--teal-dark);}
          .toolbar{background:#E5DFD2;padding:12px 0;text-align:center;}
          .toolbar button{font-family:"IBM Plex Sans",sans-serif;font-size:0.85rem;background:var(--teal);color:var(--white);border:none;padding:9px 18px;border-radius:4px;cursor:pointer;}
          table.meta{width:100%;border-collapse:collapse;margin:16px 0;font-size:0.9rem;}
          table.meta td{padding:6px 0;border-bottom:1px solid var(--line);}
          table.meta td:first-child{color:#6b7280;width:40%;}
          .sig-block{display:flex;gap:30px;margin-top:32px;flex-wrap:wrap;}
          .sig-box{flex:1;min-width:220px;border-top:1px solid var(--ink);padding-top:8px;}
          .sig-name{font-family:"Playfair Display",serif;font-size:1.1rem;}
          .sig-date{font-size:0.8rem;color:#6b7280;margin-top:2px;}
          @media print{ .toolbar{display:none;} }
        </style></head><body>' .
        '<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>' .
        '<div class="wrap">' . $bodyHtml . '</div></body></html>';
}

function office_terms_html() {
    return '<h3>Fees, Deposit &amp; Payment</h3><ul>
      <li>The total coverage fee is calculated based on region, coverage type, and duration, plus mileage calculated one way from Provider\'s base location.</li>
      <li>Mileage is billed on a tiered basis: $0.20/mile for the first 150 miles, $0.40/mile for miles 151&ndash;300, $0.60/mile beyond 300 miles.</li>
      <li>Coverage beyond 300 miles one way includes a $110/night hotel allowance, confirmed at booking.</li>
      <li>A 10% deposit is due at booking. Booking is confirmed instantly upon deposit. The remaining balance is invoiced after coverage is marked complete.</li>
      <li>Payments are made to Key Global LLC. Credit card only &mdash; no cash accepted. Insurance is not billed on Host Practice\'s behalf.</li>
    </ul><h3>Cancellation &amp; Refund Policy</h3><ul>
      <li>Cancellations 48+ hours before the coverage start date: full refund of deposit and any fees paid.</li>
      <li>Cancellations inside 48 hours: the 10% deposit is forfeited.</li>
      <li>If Provider must cancel confirmed coverage, Host Practice receives a full refund regardless of timing.</li>
    </ul><h3>Independent Contractor Status</h3><ul>
      <li>Provider performs services as an independent contractor, not an employee, partner, or agent of Host Practice.</li>
    </ul><h3>Licensure &amp; Confidentiality</h3><ul>
      <li>Provider holds a current, valid, unrestricted chiropractic license and maintains malpractice insurance, available on request.</li>
      <li>Provider keeps confidential all patient records and practice information encountered while providing coverage.</li>
    </ul>';
}

function homevisit_event_terms_html() {
    return '<h3>Fees, Deposit &amp; Payment</h3><ul>
      <li>Home visits are billed per patient ($100/adult, $70/child add-on) plus mileage ($0.20/mile one way, charged once per visit). Events are billed at $100/hour, 2-hour minimum, no mileage.</li>
      <li>A 10% deposit is due at booking. Booking is confirmed instantly upon deposit. Any remaining balance is invoiced after the visit or event is marked complete.</li>
      <li>Payments are made to Key Global LLC. Credit card only &mdash; no cash accepted.</li>
    </ul><h3>Cancellation &amp; Refund Policy</h3><ul>
      <li>Cancellations 48+ hours before the scheduled date: full refund of deposit and any fees paid.</li>
      <li>Cancellations inside 48 hours: the 10% deposit is forfeited.</li>
    </ul><h3>Independent Contractor Status</h3><ul>
      <li>Services are performed as an independent contractor, not an employee, partner, or agent of the client.</li>
    </ul><h3>Licensure</h3><ul>
      <li>Provider holds a current, valid, unrestricted chiropractic license and maintains malpractice insurance, available on request.</li>
    </ul>';
}

function standing_terms_html() {
    return '<h3>Billing &amp; Payment</h3><ul>
      <li>Each scheduled coverage date is charged automatically 7 days before it occurs, at the agreed rate. A manual "Pay now" option is also available in the account dashboard.</li>
      <li>Payments are made to Key Global LLC. Credit card only &mdash; no cash accepted.</li>
      <li>If a prepay or installment plan was selected, billing follows that plan\'s terms instead of the standard per-date schedule.</li>
    </ul><h3>Cancellation &amp; Notice</h3><ul>
      <li>Either party may cancel this agreement with 30 days\' notice. Dates falling within that 30-day window still occur and are billed as scheduled; dates after it are released.</li>
      <li>A single scheduled date can be cancelled individually &mdash; 80% refunded if cancelled 24+ hours before that date, forfeited if cancelled inside 24 hours.</li>
    </ul><h3>Independent Contractor Status</h3><ul>
      <li>Provider performs services as an independent contractor, not an employee, partner, or agent of Host Practice.</li>
    </ul><h3>Licensure &amp; Confidentiality</h3><ul>
      <li>Provider holds a current, valid, unrestricted chiropractic license and maintains malpractice insurance, available on request.</li>
      <li>Provider keeps confidential all patient records and practice information encountered while providing coverage.</li>
    </ul>';
}

function sig_block_html($signature, $providerSignedAt) {
    $clientName = $signature['name'] ?? '(unsigned)';
    $clientDate = !empty($signature['signedAt']) ? date('F j, Y g:ia', strtotime($signature['signedAt'])) : '';
    $providerDate = date('F j, Y g:ia', strtotime($providerSignedAt));
    return '<div class="sig-block">
      <div class="sig-box"><div class="sig-name">' . htmlspecialchars($clientName) . '</div><div class="sig-date">Electronically signed ' . $clientDate . '</div></div>
      <div class="sig-box"><div class="sig-name">Michael L. McPherson, D.C.</div><div class="sig-date">Electronically countersigned ' . $providerDate . '</div></div>
    </div>';
}

function render_booking_agreement(array $b) {
    $coverageType = $b['coverage_type'];
    $titleMap = ['office' => 'Office Coverage Agreement', 'homevisit' => 'Home Visit Agreement', 'event' => 'Event Coverage Agreement'];
    $title = $titleMap[$coverageType] ?? 'Coverage Agreement';
    $signature = json_decode($b['signature'] ?? 'null', true) ?: [];
    $dates = json_decode($b['dates'], true) ?: [];

    $body = "<span class=\"mono\">Key Global LLC</span><h1 style=\"margin-top:6px;\">{$title}</h1>" .
        '<table class="meta">' .
        '<tr><td>Reference</td><td>' . htmlspecialchars($b['id']) . '</td></tr>' .
        '<tr><td>Client</td><td>' . htmlspecialchars($signature['name'] ?? '') . '</td></tr>' .
        '<tr><td>Coverage</td><td>' . htmlspecialchars($b['title']) . '</td></tr>' .
        '<tr><td>Details</td><td>' . htmlspecialchars($b['meta']) . '</td></tr>' .
        '<tr><td>Date' . (count($dates) > 1 ? 's' : '') . '</td><td>' . htmlspecialchars(implode(', ', $dates)) . '</td></tr>' .
        '<tr><td>Total</td><td>$' . number_format((float)$b['total'], 2) . '</td></tr>' .
        '</table>' .
        ($coverageType === 'office' ? office_terms_html() : homevisit_event_terms_html()) .
        sig_block_html($signature, $b['created_at']);

    page_shell("{$title} — {$b['id']}", $body);
}

function render_standing_agreement(array $a) {
    $signature = json_decode($a['signature'] ?? 'null', true) ?: [];
    $patterns = json_decode($a['patterns'], true) ?: [];
    $dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    $typeLabel = ['full' => 'Full day', 'half-am' => 'Half day (AM)', 'half-pm' => 'Half day (PM)'];
    $patternSummary = implode('; ', array_map(fn($p) => "{$dowNames[$p['dow']]}s, {$p['freq']}, " . ($typeLabel[$p['type']] ?? $p['type']) . " × {$p['count']}", $patterns));

    $body = '<span class="mono">Key Global LLC</span><h1 style="margin-top:6px;">Standing Day Agreement</h1>' .
        '<table class="meta">' .
        '<tr><td>Reference</td><td>' . htmlspecialchars($a['id']) . '</td></tr>' .
        '<tr><td>Client</td><td>' . htmlspecialchars($a['clinic_name']) . '</td></tr>' .
        '<tr><td>Contact</td><td>' . htmlspecialchars($a['contact_email']) . '</td></tr>' .
        '<tr><td>Pattern</td><td>' . htmlspecialchars($patternSummary) . '</td></tr>' .
        '<tr><td>Rate</td><td>' . round((float)$a['effective_rate'] * 100, 1) . '% off standard rate</td></tr>' .
        '<tr><td>Payment plan</td><td>' . htmlspecialchars(ucfirst($a['payment_plan'])) . '</td></tr>' .
        '</table>' .
        standing_terms_html() .
        sig_block_html($signature, $a['created_at']);

    page_shell("Standing Day Agreement — {$a['id']}", $body);
}
