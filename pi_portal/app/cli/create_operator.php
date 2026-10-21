<?php
// Creates a platform operator account — you, running the service. Operators
// manage practices and subscriptions in the Operator console but can never
// open patient records.
//   php pi_portal/app/cli/create_operator.php you@company.com "Your Name"
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

[$_, $email, $name] = array_pad($argv, 3, null);
$email = strtolower(trim((string)$email));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !$name) exit("Usage: php create_operator.php email@example.com \"Full Name\"\n");
$pdo = pi_db();
$s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
$s->execute([$email]);
if ($s->fetch()) exit("A user with that email already exists.\n");
$pw = rtrim(strtr(base64_encode(random_bytes(12)), '+/', 'Kq'), '=');
$pdo->prepare("INSERT INTO users (practice_id, email, name, role, password_hash, must_change_password, created_at) VALUES (NULL, ?, ?, 'admin', ?, 1, ?)")
    ->execute([$email, $name, password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
audit('create', 'operator', $pdo->lastInsertId(), null, ['id' => null, 'email' => 'cli'], 'platform operator');
echo "Operator created.\nEmail:              $email\nOne-time password:  $pw\n";
