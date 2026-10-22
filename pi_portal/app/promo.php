<?php
// Promo codes entered at registration. Operators create them in the
// console. Kinds:
//   trial_days — adds days to the free trial
//   percent / amount — a discount applied when the practice subscribes
//     (passed to Stripe Checkout as a coupon)
//   comp — the account is free (partners, pilot clinics)
// A code can be limited to plans, a number of redemptions and an end date.

const PROMO_KINDS = ['trial_days' => 'Extra free-trial days', 'percent' => '% off', 'amount' => '$ off per month', 'comp' => 'Free account (comped)'];
const PROMO_DURATIONS = ['once' => 'First payment', 'repeating' => 'For a number of months', 'forever' => 'For as long as they subscribe'];

function promo_normalize(?string $code): string {
    return strtoupper(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$code));
}

function promo_find(?string $code): ?array {
    $code = promo_normalize($code);
    if ($code === '') return null;
    $s = pi_db()->prepare('SELECT * FROM promo_codes WHERE code = ?');
    $s->execute([$code]);
    return $s->fetch() ?: null;
}

// Why a code can't be used (null when it can).
function promo_problem(?array $p, ?string $plan = null): ?string {
    if (!$p || !$p['active']) return "That promo code isn't valid.";
    if ($p['expires_on'] && $p['expires_on'] < date('Y-m-d')) return 'That promo code has expired.';
    if ($p['max_redemptions'] !== null && (int)$p['redeemed'] >= (int)$p['max_redemptions']) return 'That promo code has been fully used.';
    if ($plan && $p['plans'] && !in_array($plan, explode(',', $p['plans']), true)) {
        $names = array_map(fn($k) => PLANS[$k]['name'] ?? $k, explode(',', $p['plans']));
        return 'That promo code is for the ' . implode(' or ', $names) . ' plan.';
    }
    return null;
}

// Plain-language description, e.g. "20% off for 3 months".
function promo_summary(array $p): string {
    $dur = match ($p['duration']) {
        'once' => ' on the first payment',
        'repeating' => ' for ' . (int)$p['duration_months'] . ' month' . ((int)$p['duration_months'] === 1 ? '' : 's'),
        default => '',
    };
    return match ($p['kind']) {
        'trial_days' => (int)$p['trial_days'] . ' extra free-trial days',
        'percent' => (int)$p['percent_off'] . '% off' . $dur,
        'amount' => '$' . rtrim(rtrim(number_format((float)$p['amount_off'], 2), '0'), '.') . ' off each month' . $dur,
        'comp' => 'Free account',
        default => '',
    };
}

// Applies a code to a newly created practice inside the signup
// transaction. Returns false if the last redemption was taken meanwhile.
function promo_redeem(array $p, int $practiceId): bool {
    $pdo = pi_db();
    $u = $pdo->prepare('UPDATE promo_codes SET redeemed = redeemed + 1 WHERE id = ? AND active = 1 AND (max_redemptions IS NULL OR redeemed < max_redemptions)');
    $u->execute([$p['id']]);
    if ($u->rowCount() !== 1) return false;
    $pdo->prepare('UPDATE practices SET promo_code_id = ?, promo_applied_at = ? WHERE id = ?')->execute([$p['id'], now_str(), $practiceId]);
    if ($p['kind'] === 'trial_days') {
        $pdo->prepare('UPDATE practices SET trial_ends_at = DATE_ADD(trial_ends_at, INTERVAL ? DAY) WHERE id = ?')->execute([(int)$p['trial_days'], $practiceId]);
    } elseif ($p['kind'] === 'comp') {
        $pdo->prepare("UPDATE practices SET subscription_status = 'comped' WHERE id = ?")->execute([$practiceId]);
    }
    return true;
}

// The practice's code, if it carries a discount still to use at checkout.
function practice_discount(array $practice): ?array {
    if (empty($practice['promo_code_id'])) return null;
    $s = pi_db()->prepare("SELECT * FROM promo_codes WHERE id = ? AND kind IN ('percent','amount')");
    $s->execute([$practice['promo_code_id']]);
    return $s->fetch() ?: null;
}

// The Stripe coupon behind a discount code, created the first time it's used.
function promo_stripe_coupon(array $p): string {
    if (!empty($p['stripe_coupon_id'])) return $p['stripe_coupon_id'];
    $params = ['name' => mb_substr($p['code'] . ' — ' . promo_summary($p), 0, 40), 'duration' => $p['duration'], 'metadata[promo_code]' => $p['code']];
    if ($p['duration'] === 'repeating') $params['duration_in_months'] = max(1, (int)$p['duration_months']);
    if ($p['kind'] === 'percent') $params['percent_off'] = (int)$p['percent_off'];
    else { $params['amount_off'] = (int)round((float)$p['amount_off'] * 100); $params['currency'] = 'usd'; }
    $c = stripe_api('POST', 'coupons', $params);
    pi_db()->prepare('UPDATE promo_codes SET stripe_coupon_id = ? WHERE id = ?')->execute([$c['id'], $p['id']]);
    return $c['id'];
}
