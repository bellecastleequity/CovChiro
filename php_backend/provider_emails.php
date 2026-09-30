<?php
// Emails to providers in the coverage network: welcome, state-aware
// credential follow-ups, verification results, renewal/expiry notices and
// shift messages. Loaded by providers.php. Every one is sent through
// provider_send(), which logs it on the provider's record.

function provider_first_name(array $p) {
    return email_first_name($p['name'] ?? '');
}

function provider_readiness_facts(array $lic, array $mal) {
    $fmt = function ($s) {
        $label = $s['statusLabel'];
        if ($s['status'] === 'verified' && $s['expiresAt']) $label .= ' · expires ' . date('M j, Y', strtotime($s['expiresAt']));
        if ($s['renewal']) $label .= ' (renewal ' . ($s['renewal']['status'] === 'rejected' ? 'needs correction' : 'under review') . ')';
        return $label;
    };
    return email_facts(['Chiropractic license' => $fmt($lic), 'Malpractice insurance' => $fmt($mal)], 'Your coverage readiness');
}

function provider_email_welcome(PDO $pdo, array $p, string $verifyToken) {
    $verify = SITE_URL . '/provider.html?verify=' . urlencode($verifyToken);
    $content = email_heading('Welcome to the network, ' . provider_first_name($p) . '.', 'Provider profile created')
        . email_p('Your provider profile is set up. You can finish it now — school, location, travel radius, techniques — so everything is ready the day you’re licensed.')
        . email_buttons([['Confirm my email', $verify]])
        . email_callout('<strong>How you become coverage-ready:</strong><br>1. Confirm your email (button above)<br>2. Add your chiropractic license once it’s issued<br>3. Add your malpractice insurance<br>4. We verify both — then you can accept paid coverage shifts')
        . email_small('Coverage shifts stay locked until your license and malpractice insurance are both verified. Uploading a document doesn’t unlock them on its own — we check every credential first.')
        . email_small('Button not working? Copy this link: <a href="' . em($verify) . '" style="color:' . EM_TEAL . ';word-break:break-all;">' . em($verify) . '</a>');
    return provider_send($pdo, $p, 'welcome', 'Welcome to the coverage network — confirm your email', $content,
        ['preheader' => 'Your provider profile is ready. Here’s how to become coverage-ready.']);
}

// Which reminder a not-yet-ready provider should get next — or null when
// nothing is being asked of them (everything is submitted and under review,
// or they're already coverage-ready). Never asks for something already done.
function provider_followup_kind(array $lic, array $mal) {
    $map = ['not_provided' => 'missing', 'uploaded' => 'incomplete', 'rejected' => 'rejected', 'expired' => 'expired'];
    if (isset($map[$lic['status']])) return 'license_' . $map[$lic['status']];
    if (isset($map[$mal['status']])) return 'malpractice_' . $map[$mal['status']];
    return null;
}

// Subject + body for a follow-up kind. The copy reflects exactly what is
// missing and acknowledges what's already done.
function provider_followup_content(array $p, string $kind, array $lic, array $mal) {
    $first = em(provider_first_name($p));
    $licBtn = [['I’m Licensed — Complete My Profile', provider_portal_url('license')]];
    $malBtn = [['Add my malpractice insurance', provider_portal_url('malpractice')]];
    $notes = fn($s) => !empty($s['current']['review_notes']) ? email_quote($s['current']['review_notes']) : '';
    $licensePendingNote = $lic['status'] === 'pending' ? email_callout('<strong>License verification pending</strong> — we’ve received your license and are reviewing it. Nothing more is needed for it right now.') : '';
    switch ($kind) {
        case 'license_missing':
            return ['Have you received your chiropractic license?',
                email_heading('Have you received your chiropractic license?', 'Coverage readiness')
                . email_p("Hi {$first} — have you received your chiropractic license? Upload your license information to continue becoming coverage-ready.")
                . email_p('Once your license and malpractice insurance are verified, you can start accepting paid coverage shifts around your schedule.')
                . email_buttons($licBtn)
                . email_small('Still waiting on the board? No problem — we’ll check back in a few weeks.')];
        case 'license_incomplete':
            return ['Finish your chiropractic license details',
                email_heading('Your license upload is almost done', 'Coverage readiness')
                . email_p("Hi {$first} — we have your license document, but a few details (license number, state or expiration date) are still missing, so it can’t be verified yet.")
                . email_buttons([['Finish my license details', provider_portal_url('license')]])];
        case 'license_rejected':
            return ['Your chiropractic license needs a correction',
                email_heading('Your license needs a correction', 'Coverage readiness')
                . email_p("Hi {$first} — we weren’t able to verify the license information you submitted. Please review the note below and upload a corrected copy.")
                . $notes($lic) . email_buttons([['Update my license', provider_portal_url('license')]])];
        case 'license_expired':
            return ['Your chiropractic license has expired',
                email_heading('Your license on file has expired', 'Coverage readiness')
                . email_p("Hi {$first} — the chiropractic license on your profile has passed its expiration date, so coverage shifts are paused. Upload your renewed license to be verified again.")
                . email_buttons([['Upload my renewed license', provider_portal_url('license')]])];
        case 'malpractice_missing':
            return $lic['status'] === 'verified'
                ? ['Your license is verified — add your malpractice insurance',
                    email_heading('License verified — one step to go', 'Coverage readiness')
                    . email_p("Hi {$first} — your chiropractic license has been received and verified. Add your malpractice insurance to complete your coverage eligibility.")
                    . email_buttons($malBtn)]
                : ['Add your malpractice insurance',
                    email_heading('Add your malpractice insurance', 'Coverage readiness')
                    . $licensePendingNote
                    . email_p("Hi {$first} — while we review your license, add your malpractice insurance so both credentials can be verified together.")
                    . email_buttons($malBtn)];
        case 'malpractice_incomplete':
            return ['Finish your malpractice insurance details',
                email_heading('Your malpractice upload is almost done', 'Coverage readiness')
                . $licensePendingNote
                . email_p("Hi {$first} — we have your insurance document, but a few details (carrier, policy number or expiration date) are still missing, so it can’t be verified yet.")
                . email_buttons([['Finish my insurance details', provider_portal_url('malpractice')]])];
        case 'malpractice_rejected':
            return ['Your malpractice insurance needs a correction',
                email_heading('Your malpractice insurance needs a correction', 'Coverage readiness')
                . email_p("Hi {$first} — we weren’t able to verify the malpractice insurance you submitted. Please review the note below and upload a corrected certificate.")
                . $notes($mal) . email_buttons([['Update my insurance', provider_portal_url('malpractice')]])];
        case 'malpractice_expired':
            return ['Your malpractice insurance has expired',
                email_heading('Your malpractice policy on file has expired', 'Coverage readiness')
                . email_p("Hi {$first} — the malpractice insurance on your profile has passed its expiration date, so coverage shifts are paused. Upload your renewed policy to be verified again.")
                . email_buttons([['Upload my renewed policy', provider_portal_url('malpractice')]])];
    }
    throw new InvalidArgumentException("Unknown follow-up kind {$kind}");
}

function provider_send_followup(PDO $pdo, array $p, string $kind, array $lic, array $mal) {
    [$subject, $body] = provider_followup_content($p, $kind, $lic, $mal);
    return provider_send($pdo, $p, 'followup:' . $kind, $subject, $body . provider_readiness_facts($lic, $mal), [
        'unsubscribe' => provider_unsubscribe_url($p),
        'footer_note' => 'You’re receiving this because you created a provider profile on CoverageChiropractor.com. These reminders stop automatically once your credentials are verified.',
    ]);
}

function provider_email_credential_received(PDO $pdo, array $p, string $type, array $cred, array $lic, array $mal) {
    $label = PROVIDER_CREDENTIAL_LABELS[$type];
    $complete = $cred['status'] === 'pending';
    $body = email_heading($complete ? "{$label} received" : "{$label} saved — details needed", 'Credential verification')
        . email_p($complete
            ? 'Thanks, ' . em(provider_first_name($p)) . ' — your ' . strtolower($label) . ' is now <strong>pending verification</strong>. We’ll email you as soon as it’s reviewed.'
            : 'We saved your document, but some required details are missing, so it can’t be verified yet. Add them from your dashboard.')
        . provider_readiness_facts($lic, $mal)
        . email_buttons([['Open my dashboard', provider_portal_url()]]);
    provider_send($pdo, $p, 'credential_received:' . $type, $complete ? "{$label} received — verification pending" : "{$label} saved — details needed", $body);
    if ($complete) {
        send_admin_email("Verify {$label} — " . html_entity_decode($p['name'], ENT_QUOTES, 'UTF-8'), "{$label} awaiting verification",
            email_facts([
                'Provider' => $p['name'] . ' (' . $p['email'] . ')',
                'License #' => $cred['license_number'] ?? null, 'State' => $cred['license_state'] ?? null,
                'Carrier' => $cred['carrier'] ?? null, 'Policy #' => $cred['policy_number'] ?? null,
                'Expires' => $cred['expiration_date'] ? date('F j, Y', strtotime($cred['expiration_date'])) : null,
            ]) . email_p('Review the document and verify or reject it in Providers → Verification queue.'),
            ['kicker' => 'Credential submitted', 'cta' => 'Open the verification queue']);
    }
}

// After an admin decision. A verification that completes eligibility is
// followed by the Coverage Ready email instead (see provider_refresh_status).
function provider_email_credential_reviewed(PDO $pdo, array $p, string $type, string $decision, ?string $notes, array $lic, array $mal) {
    $label = PROVIDER_CREDENTIAL_LABELS[$type];
    $first = em(provider_first_name($p));
    if ($decision === 'rejected') {
        $body = email_heading("Your {$label} needs a correction", 'Credential verification')
            . email_p("Hi {$first} — we weren’t able to verify the " . strtolower($label) . ' you submitted.' . ($notes ? ' Here’s what needs to change:' : ' Please upload a corrected copy.'))
            . ($notes ? email_quote($notes) : '')
            . provider_readiness_facts($lic, $mal)
            . email_buttons([['Update my ' . strtolower($label), provider_portal_url($type)]]);
        return provider_send($pdo, $p, 'credential_rejected:' . $type, "{$label} needs a correction", $body);
    }
    if ($type === 'license' && in_array($mal['status'], ['not_provided', 'uploaded', 'rejected', 'expired'], true)) {
        [$subject, $content] = provider_followup_content($p, 'malpractice_' . ($mal['status'] === 'not_provided' ? 'missing' : ($mal['status'] === 'uploaded' ? 'incomplete' : $mal['status'])), $lic, $mal);
        return provider_send($pdo, $p, 'credential_verified:license', $subject, $content . provider_readiness_facts($lic, $mal));
    }
    $other = $type === 'license' ? $mal : $lic;
    $otherLabel = PROVIDER_CREDENTIAL_LABELS[$other['type']];
    $next = $other['status'] === 'pending'
        ? email_callout('<strong>Credentials under review</strong> — your ' . strtolower($otherLabel) . ' is still being verified. We’ll let you know when it’s done.')
        : ($other['status'] === 'verified'
            ? email_p('One last account step is still open — check your dashboard to finish it.')
            : email_p('Next step: add your ' . strtolower($otherLabel) . ' to complete your coverage eligibility.') . email_buttons([['Add my ' . strtolower($otherLabel), provider_portal_url($other['type'])]]));
    $body = email_heading("Your {$label} is verified", 'Credential verification')
        . email_p("Good news, {$first} — your " . strtolower($label) . ' has been received and verified.')
        . $next . provider_readiness_facts($lic, $mal);
    return provider_send($pdo, $p, 'credential_verified:' . $type, "{$label} verified", $body);
}

function provider_email_coverage_ready(PDO $pdo, array $p) {
    $body = email_heading('You’re coverage-ready, ' . provider_first_name($p) . '!', 'Coverage ready')
        . email_p('Your chiropractic license and malpractice insurance are both verified. <strong>You are eligible to accept available coverage shifts.</strong>')
        . email_callout('<strong>Get the most out of the network:</strong><br>• Keep your ZIP code and travel radius current so you see shifts you can realistically reach<br>• Add the techniques you use so clinics know what to expect<br>• Watch your email — we’ll let you know when a shift opens near you')
        . email_buttons([['See available shifts', provider_portal_url('shifts')], ['Update my preferences', provider_portal_url('profile'), 'secondary']])
        . email_small('You’ll see the pay, date, hours and location of every shift before you accept it. No subscription, no long-term commitment.');
    return provider_send($pdo, $p, 'coverage_ready', 'You’re coverage-ready — shifts are unlocked', $body, ['preheader' => 'Your credentials are verified. You can now accept coverage shifts.']);
}

function provider_email_renewal_reminder(PDO $pdo, array $p, array $cred, int $daysLeft) {
    $label = PROVIDER_CREDENTIAL_LABELS[$cred['type']];
    $exp = date('F j, Y', strtotime($cred['expiration_date']));
    $body = email_heading("Your {$label} expires in {$daysLeft} day" . ($daysLeft === 1 ? '' : 's'), 'Renewal reminder')
        . email_p('Hi ' . em(provider_first_name($p)) . " — the " . strtolower($label) . " on your profile expires on <strong>{$exp}</strong>. Upload the renewed document before then so there’s no gap in your eligibility.")
        . email_callout('If it lapses without a verified replacement, you won’t be able to accept new shifts, and any shifts you’re already booked for after that date will be reviewed.', 'warn')
        . email_buttons([['Upload my renewal', provider_portal_url($cred['type'])]]);
    return provider_send($pdo, $p, 'renewal:' . $cred['type'] . ':' . $daysLeft, "Renewal reminder: your {$label} expires {$exp}", $body);
}

function provider_email_credential_expired(PDO $pdo, array $p, array $cred, array $flaggedShifts) {
    $label = PROVIDER_CREDENTIAL_LABELS[$cred['type']];
    $body = email_heading("Your {$label} has expired", 'Coverage paused')
        . email_p('Hi ' . em(provider_first_name($p)) . ' — the ' . strtolower($label) . ' on your profile expired on ' . date('F j, Y', strtotime($cred['expiration_date'])) . '. Until a renewed document is uploaded and verified, you can’t accept new coverage shifts.')
        . ($flaggedShifts ? email_callout('You have ' . count($flaggedShifts) . ' upcoming shift' . (count($flaggedShifts) === 1 ? '' : 's') . ' that we’re now reviewing. Upload your renewal as soon as possible — we’ll be in touch about them.', 'warn') : '')
        . email_buttons([['Upload my renewal', provider_portal_url($cred['type'])]]);
    return provider_send($pdo, $p, 'expired:' . $cred['type'], "Your {$label} has expired — coverage paused", $body);
}

function provider_shift_facts(array $s, bool $withAddress, ?int $miles = null) {
    $when = date('l, F j, Y', strtotime($s['shift_date']));
    $hours = ($s['start_time'] && $s['end_time']) ? "{$s['start_time']}–{$s['end_time']}" : ($s['day_type'] === 'half' ? 'Half day' : 'Full day');
    return email_facts([
        'Date' => $when, 'Hours' => $hours, 'Pay' => em_money($s['pay_amount']),
        'Clinic' => $withAddress ? $s['clinic_name'] : null,
        'Location' => $withAddress ? ($s['address'] ?: trim("{$s['city']}, {$s['state']} {$s['zip_code']}")) : trim(($s['city'] ? "{$s['city']}, " : '') . "{$s['state']} {$s['zip_code']}"),
        'Distance' => $miles !== null ? "About {$miles} miles from your ZIP" : null,
        'Reference' => $s['id'],
    ], 'Shift details');
}

function provider_email_shift_confirmed(PDO $pdo, array $p, array $s) {
    $addr = $s['address'] ?: trim("{$s['city']}, {$s['state']} {$s['zip_code']}");
    $body = email_heading('You’re confirmed for ' . date('M j', strtotime($s['shift_date'])), 'Shift confirmed')
        . email_p('Thanks, ' . em(provider_first_name($p)) . ' — this coverage shift is yours. Here are the details:')
        . provider_shift_facts($s, true)
        . ($s['notes'] ? email_quote($s['notes']) : '')
        . email_buttons([['Get directions', maps_directions_link($addr)], ['My shifts', provider_portal_url('shifts'), 'secondary']])
        . email_small('Can’t make it after all? Call ' . em(PHONE_NUMBER) . ' right away so the clinic can be covered.');
    provider_send($pdo, $p, 'shift_confirmed', 'Shift confirmed — ' . date('D, M j', strtotime($s['shift_date'])), $body);
    send_admin_email('Shift filled — ' . $s['id'], 'Shift filled',
        email_facts(['Provider' => $p['name'] . ' (' . $p['email'] . ')', 'Date' => date('l, F j, Y', strtotime($s['shift_date'])), 'Clinic' => $s['clinic_name'], 'Assigned by' => $s['assigned_by'] === 'self' ? 'Provider accepted' : $s['assigned_by']]),
        ['kicker' => 'Coverage network']);
}

function provider_email_shift_available(PDO $pdo, array $p, array $s, ?int $miles) {
    $body = email_heading('A coverage shift is open near you', 'New shift')
        . email_p('Hi ' . em(provider_first_name($p)) . ' — a new shift inside your travel radius is open. It’s first come, first served:')
        . provider_shift_facts($s, false, $miles)
        . email_buttons([['View & accept', provider_portal_url('shifts')]]);
    return provider_send($pdo, $p, 'shift_available', 'Open shift ' . date('D, M j', strtotime($s['shift_date'])) . ' — ' . em_money($s['pay_amount']), $body, [
        'unsubscribe' => provider_unsubscribe_url($p),
    ]);
}

function provider_email_shift_released(PDO $pdo, array $p, array $s, ?string $reason) {
    $body = email_heading('A shift has been removed from your schedule', 'Schedule change')
        . email_p('Hi ' . em(provider_first_name($p)) . ' — you’re no longer scheduled for the shift below.' . ($reason ? ' Note from our team:' : ''))
        . ($reason ? email_quote($reason) : '')
        . provider_shift_facts($s, true)
        . email_buttons([['My shifts', provider_portal_url('shifts')]]);
    return provider_send($pdo, $p, 'shift_released', 'Schedule change — ' . date('D, M j', strtotime($s['shift_date'])), $body);
}
