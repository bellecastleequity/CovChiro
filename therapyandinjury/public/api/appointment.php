<?php
/**
 * Appointment request handler — [PLACEHOLDER BACKEND]
 *
 * Minimal handler for Namecheap cPanel hosting. It emails each request to the
 * branch's inbox. Before launch:
 *   1. Fill in $RECIPIENTS with real branch inboxes (and the FROM address on your domain).
 *   2. Decide whether plain email is acceptable for these requests, or switch to a
 *      HIPAA-eligible form service / encrypted inbox (see TODO.md).
 * Until $RECIPIENTS is filled in, this returns 503 and the site tells visitors to call.
 *
 * Accepts ONLY: branch, type, name, phone, preferred_time, accident_date, consent.
 * Never extend it to medical details, insurance numbers, or SSNs.
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');

$RECIPIENTS = [
    // 'ocala' => 'ocala@therapyandinjury.com',   // [OCALA EMAIL]
];
$FROM = 'no-reply@therapyandinjury.com';          // [CONFIRM SENDING ADDRESS]

function respond(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'method']);
}

// Honeypot: real visitors never fill this in.
if (!empty($_POST['website'])) {
    respond(200, ['ok' => true]);
}

$clean = static fn(string $k, int $max): string =>
    mb_substr(trim(preg_replace('/[\r\n\t]+/', ' ', strip_tags((string)($_POST[$k] ?? '')))), 0, $max);

$branch   = preg_replace('/[^a-z0-9-]/', '', strtolower($clean('branch', 40)));
$type     = $clean('type', 20) === 'notify' ? 'notify' : 'appointment';
$name     = $clean('name', 100);
$phone    = $clean('phone', 20);
$time     = $clean('preferred_time', 120);
$accident = $clean('accident_date', 10);
$consent  = ($_POST['consent'] ?? '') === 'yes';

$digits = preg_replace('/\D/', '', $phone);
if ($name === '' || strlen($digits) < 10 || !$consent) {
    respond(422, ['ok' => false, 'error' => 'validation']);
}
if ($accident !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $accident)) {
    $accident = '';
}
if (!isset($RECIPIENTS[$branch])) {
    respond(503, ['ok' => false, 'error' => 'not_configured']);
}

$subject = $type === 'notify'
    ? "Opening notification request — {$branch}"
    : "Appointment request — {$branch}";
$body = implode("\n", [
    "Type: {$type}",
    "Location: {$branch}",
    "Name: {$name}",
    "Phone: {$phone}",
    "Preferred time: " . ($time ?: '—'),
    "Accident date: " . ($accident ?: '—'),
    "Consent to call/text: yes",
    "Submitted: " . gmdate('Y-m-d H:i') . ' UTC',
]);
$headers = "From: {$FROM}\r\nContent-Type: text/plain; charset=UTF-8";

if (!mail($RECIPIENTS[$branch], $subject, $body, $headers)) {
    respond(500, ['ok' => false, 'error' => 'send']);
}

// Non-JS form posts get redirected back with a flag.
if (strpos($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json') === false) {
    header('Location: /' . $branch . '/?sent=1#request', true, 303);
    exit;
}
respond(200, ['ok' => true]);
