<?php
// Creates a practice with its first admin, outside the public signup —
// e.g. your own clinic, comped (no subscription needed):
//   php pi_portal/app/cli/create_practice.php "Practice Name" admin@practice.com "Dr. Name" --comped
// Prints the practice id (needed by import_sheets.php) and a one-time password.
if (PHP_SAPI !== 'cli') exit("CLI only\n");
require_once __DIR__ . '/../bootstrap.php';

$args = array_values(array_filter(array_slice($argv, 1), fn($a) => strpos($a, '--') !== 0));
$comped = in_array('--comped', $argv, true);
[$practiceName, $email, $name] = array_pad($args, 3, null);
$email = strtolower(trim((string)$email));
if (!$practiceName || !filter_var($email, FILTER_VALIDATE_EMAIL) || !$name) exit("Usage: php create_practice.php \"Practice Name\" admin@example.com \"Full Name\" [--comped]\n");
$pdo = pi_db();
$s = $pdo->prepare('SELECT id FROM users WHERE email = ?');
$s->execute([$email]);
if ($s->fetch()) exit("A user with that email already exists.\n");
$pdo->beginTransaction();
$practiceId = create_practice($practiceName, 'group', $comped ? 'comped' : 'trialing');
$pw = rtrim(strtr(base64_encode(random_bytes(12)), '+/', 'Kq'), '=');
$pdo->prepare("INSERT INTO users (practice_id, email, name, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, 'admin', ?, 1, ?)")
    ->execute([$practiceId, $email, $name, password_hash($pw, PASSWORD_ARGON2ID), now_str()]);
$pdo->commit();
audit('create', 'practice', $practiceId, null, ['id' => null, 'email' => 'cli', 'practice_id' => $practiceId], $comped ? 'comped' : 'trial');
echo "Practice created (id $practiceId" . ($comped ? ', comped' : ', ' . TRIAL_DAYS . '-day trial') . ").\nAdmin email:        $email\nOne-time password:  $pw\n";
echo "The admin accepts the Business Associate Agreement under Settings at first sign-in.\n";
