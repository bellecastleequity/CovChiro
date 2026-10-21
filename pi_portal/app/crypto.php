<?php
// Field- and file-level encryption with libsodium (XSalsa20-Poly1305,
// authenticated — a tampered value fails to decrypt rather than returning
// garbage). Values are stored as "v1:" + base64(nonce || ciphertext); the
// version prefix leaves room for key rotation later.

function pi_key(): string {
    static $key = null;
    if ($key !== null) return $key;
    $raw = base64_decode(PI_ENCRYPTION_KEY, true);
    if ($raw === false || strlen($raw) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
        throw new RuntimeException('PI_ENCRYPTION_KEY must be 32 random bytes, base64-encoded');
    }
    return $key = $raw;
}

function enc(?string $plain): ?string {
    if ($plain === null || $plain === '') return null;
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return 'v1:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, pi_key()));
}

function dec(?string $stored): ?string {
    if ($stored === null || $stored === '') return null;
    if (strncmp($stored, 'v1:', 3) !== 0) throw new RuntimeException('Unknown ciphertext version');
    $raw = base64_decode(substr($stored, 3), true);
    $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, pi_key());
    if ($plain === false) throw new RuntimeException('Decryption failed (wrong key or corrupted value)');
    return $plain;
}

// Documents: same construction, whole file in memory (uploads are capped
// at 25 MB, well inside PHP's usual memory limit for this).
function enc_file(string $plain): string {
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return "PIF1" . $nonce . sodium_crypto_secretbox($plain, $nonce, pi_key());
}

function dec_file(string $blob): string {
    if (substr($blob, 0, 4) !== 'PIF1') throw new RuntimeException('Unknown file format');
    $nonce = substr($blob, 4, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $plain = sodium_crypto_secretbox_open(substr($blob, 4 + SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, pi_key());
    if ($plain === false) throw new RuntimeException('File decryption failed');
    return $plain;
}
