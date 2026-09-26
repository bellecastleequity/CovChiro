<?php
// Stripe webhook endpoint — safety net in case a browser closes before the
// client-side confirm_payment call fires. Configure this URL in the Stripe
// Dashboard (Developers > Webhooks) for the payment_intent.succeeded event:
//   https://coveragechiropractor.com/api/stripe_webhook.php
require_once __DIR__ . '/../../php_backend/config.php';

$autoload = __DIR__ . '/../../php_backend/vendor/autoload.php';
if (!file_exists($autoload)) { http_response_code(503); exit; }
require_once $autoload;
\Stripe\Stripe::setApiKey(STRIPE_SECRET_KEY);

$payload = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

try {
    $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, STRIPE_WEBHOOK_SECRET);
} catch (\Exception $e) {
    log_error('Stripe webhook signature verification failed', ['error' => $e->getMessage()]);
    http_response_code(400);
    exit;
}

if ($event->type === 'payment_intent.succeeded') {
    $intent = $event->data->object;
    $bookingId = $intent->metadata->booking_id ?? null;
    $purpose = $intent->metadata->purpose ?? 'deposit';
    if ($bookingId) {
        apply_successful_payment($pdo, $bookingId, $intent->id, $purpose, $intent->amount_received / 100, $intent->latest_charge ?? null);
    }
}

http_response_code(200);
echo json_encode(['received' => true]);
