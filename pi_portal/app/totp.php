<?php
// RFC 6238 time-based one-time passwords — works with Google Authenticator,
// Microsoft Authenticator, 1Password, Authy, etc. 30-second steps, 6 digits,
// one step of clock drift allowed either side.

function base32_encode(string $bin): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 5) as $chunk) $out .= $alphabet[bindec(str_pad($chunk, 5, '0'))];
    return $out;
}

function base32_decode(string $b32): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split(strtoupper(rtrim($b32, '='))) as $c) {
        $i = strpos($alphabet, $c);
        if ($i === false) continue;
        $bits .= str_pad(decbin($i), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
    return $out;
}

function totp_new_secret(): string { return base32_encode(random_bytes(20)); }

function totp_code(string $secretB32, int $step): string {
    $key = base32_decode($secretB32);
    $hash = hash_hmac('sha1', pack('N*', 0) . pack('N*', $step), $key, true);
    $offset = ord($hash[19]) & 0x0f;
    $bin = ((ord($hash[$offset]) & 0x7f) << 24) | (ord($hash[$offset + 1]) << 16) | (ord($hash[$offset + 2]) << 8) | ord($hash[$offset + 3]);
    return str_pad((string)($bin % 1000000), 6, '0', STR_PAD_LEFT);
}

// Returns the matched time step, or null. The caller stores the step and
// rejects any code at or before it, so a code can't be replayed.
function totp_verify(string $secretB32, string $code, ?int $lastStep = null): ?int {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) return null;
    $now = intdiv(time(), 30);
    for ($s = $now - 1; $s <= $now + 1; $s++) {
        if ($lastStep !== null && $s <= $lastStep) continue;
        if (hash_equals(totp_code($secretB32, $s), $code)) return $s;
    }
    return null;
}

function totp_uri(string $secretB32, string $email): string {
    $issuer = rawurlencode(BRAND_NAME);
    return 'otpauth://totp/' . $issuer . ':' . rawurlencode($email) . '?secret=' . $secretB32 . '&issuer=' . $issuer . '&period=30&digits=6';
}
