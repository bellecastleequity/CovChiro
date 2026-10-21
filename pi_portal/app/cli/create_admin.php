<?php
// Creates the first admin account. Run once from the server's terminal:
//   php pi_portal/app/cli/create_admin.php you@practice.com "Dr. Your Name"
// Prints a one-time password; you'll set your own and enroll 2FA at first sign-in.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

[$_, $email, $name] = array_pad($argv, 3, null);
$email = strtolower(trim((string)$email));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !$name) exit("Usage: php create_admin.php email@example.com \"Full Name\"\n");

$pdo = pi_db();
$s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
$s->execute([$email]);
if ($s->fetch()) exit("A user with that email already exists.\n");

$pw = rtrim(strtr(base64_encode(random_bytes(12)), '+/', 'Kq'), '=');
$pdo->prepare("INSERT INTO users (email, name, role, password_hash, must_change_password, created_at) VALUES (?, ?, 'admin', ?, 1, ?)")
    ->execute([$email, $name, password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
audit('create', 'user', $pdo->lastInsertId(), null, ['id' => null, 'email' => 'cli'], 'role=admin (first admin)');
echo "Admin created.\nEmail:              $email\nOne-time password:  $pw\n";
echo "Sign in, choose your own password, then scan the 2FA QR code with an authenticator app.\n";
