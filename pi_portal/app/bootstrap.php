<?php
// CaseMGR — bootstrap: secrets, DB, hardened session, CSRF, auth,
// tenant scoping, roles, audit logging. Every API endpoint requires this file first.
//
// This portal holds PHI, so it deliberately differs from the marketing
// sites' php_backend/config.php in a few ways: errors never echo detail
// back to the browser, sessions expire after 15 idle minutes, every
// request that changes data needs a CSRF token, and every read or write of
// a patient's case is written to audit_log.

require_once __DIR__ . '/secrets.php';
require_once __DIR__ . '/crypto.php';
require_once __DIR__ . '/totp.php';
require_once __DIR__ . '/pi_rules.php';
require_once __DIR__ . '/saas.php';

define('PI_TIMEZONE', 'America/New_York');
define('PI_IDLE_TIMEOUT_SECONDS', 15 * 60);
define('PI_ABSOLUTE_TIMEOUT_SECONDS', 12 * 3600);
define('PI_MAX_FAILED_LOGINS', 5);
define('PI_LOCKOUT_MINUTES', 30);
define('PI_MIN_PASSWORD_LENGTH', 12);
define('PI_STORAGE_DIR', dirname(__DIR__) . '/storage/documents');
define('PI_MAX_UPLOAD_BYTES', 25 * 1024 * 1024);
date_default_timezone_set(PI_TIMEZONE);

// ========== ERROR HANDLING ==========
// Warnings become exceptions; exceptions are logged server-side (no PHI in
// the message — just the location) and the browser only ever sees a
// generic error with a reference it can quote back to you.
set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return false;
    throw new ErrorException($message, 0, $severity, $file, $line);
});
set_exception_handler(function ($e) {
    $ref = strtoupper(bin2hex(random_bytes(4)));
    pi_log_error('Uncaught ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine() . ' ref=' . $ref);
    // On the command line the person running the script is the server's
    // operator, so they get the full message.
    if (PHP_SAPI === 'cli') { fwrite(STDERR, $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine() . "\n"); exit(1); }
    if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
    echo json_encode(['error' => 'Server error (ref ' . $ref . ')']);
    exit;
});

// Exception messages can contain query values (i.e. PHI), so only the
// caller-supplied text is logged, never $e->getMessage().
function pi_log_error(string $message) {
    $dir = dirname(__DIR__) . '/storage/logs';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    error_log('[' . date('Y-m-d H:i:s') . '] ' . $message . "\n", 3, $dir . '/error.log');
}

// ========== DATABASE ==========
function pi_db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO(
        'mysql:host=' . PI_DB_HOST . ';dbname=' . PI_DB_NAME . ';charset=utf8mb4',
        PI_DB_USER,
        PI_DB_PASSWORD,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ] + pi_db_tls_options()
    );
    return $pdo;
}

// On AWS the database is a separate RDS server, so traffic to it must be
// encrypted: set PI_DB_SSL_CA to the RDS certificate bundle and PDO
// refuses to connect without TLS and a valid RDS certificate.
function pi_db_tls_options(): array {
    if (!defined('PI_DB_SSL_CA') || !PI_DB_SSL_CA) return [];
    return [PDO::MYSQL_ATTR_SSL_CA => PI_DB_SSL_CA, PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT => true];
}

function now_str() { return date('Y-m-d H:i:s'); }

// ========== RESPONSES / INPUT ==========
function json_response($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store, max-age=0');
    header('Pragma: no-cache');
    echo json_encode($data);
    exit;
}

function json_body() {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function require_method(string $method) {
    if ($_SERVER['REQUEST_METHOD'] !== $method) json_response(['error' => $method . ' required'], 405);
}

// Trimmed string or null; enforces a max length so a pasted novel can't
// land in a VARCHAR column.
function str_or_null($v, int $max = 255) {
    if ($v === null) return null;
    $v = trim((string)$v);
    if ($v === '') return null;
    return mb_substr($v, 0, $max);
}

function date_or_null($v) {
    $v = trim((string)($v ?? ''));
    if ($v === '') return null;
    $d = DateTime::createFromFormat('Y-m-d', $v);
    if (!$d || $d->format('Y-m-d') !== $v) json_response(['error' => 'Invalid date: ' . $v], 400);
    return $v;
}

function money_or_null($v) {
    if ($v === null || $v === '') return null;
    $n = (float)str_replace([',', '$'], '', (string)$v);
    return round($n, 2);
}

function enum_or($v, array $allowed, $default) {
    return in_array($v, $allowed, true) ? $v : $default;
}

// ========== SESSION ==========
// __Host- cookie: Secure, host-only, path=/ — can't be set or overwritten
// by a subdomain. SameSite=Strict because nothing should ever link into
// the portal with a session attached. On plain-http localhost (dev only)
// the prefix is dropped since browsers refuse __Host- without HTTPS.
function pi_start_session() {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name($https ? '__Host-pi_session' : 'pi_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_start();

    if (!empty($_SESSION['uid'])) {
        $now = time();
        $idle = $now - ($_SESSION['last_seen'] ?? 0);
        $age = $now - ($_SESSION['started_at'] ?? 0);
        if ($idle > PI_IDLE_TIMEOUT_SECONDS || $age > PI_ABSOLUTE_TIMEOUT_SECONDS) {
            audit('session_timeout', null, null, null, ['id' => $_SESSION['uid'], 'email' => $_SESSION['email'] ?? null]);
            pi_end_session();
            json_response(['error' => 'Your session expired. Please sign in again.', 'code' => 'session_expired'], 401);
        }
        // Background keepalive polls don't count as activity.
        if (empty($_SERVER['HTTP_X_PI_PASSIVE'])) $_SESSION['last_seen'] = $now;
    }
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function pi_end_session() {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Strict']);
    }
    session_destroy();
}

// Every non-GET request must echo the session's CSRF token in a header.
// SameSite=Strict already blocks cross-site posts in modern browsers; this
// is the second lock on the door.
function check_csrf() {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') return;
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
        json_response(['error' => 'Security token mismatch — reload the page.', 'code' => 'csrf'], 403);
    }
}

// ========== ROLES ==========
// admin    — everything, plus user management and the audit log
// provider — the doctor: everything clinical and financial
// staff    — front desk / case manager: cases, checklist, referrals,
//            visits, correspondence, documents; can SEE balances but not
//            post payments, reductions or settlements
// billing  — A/R: financials and correspondence; reads clinical data
const ROLE_PERMS = [
    'admin'    => ['case.read', 'case.write', 'clinical.write', 'finance.read', 'finance.write', 'contacts.write', 'export', 'users.manage', 'audit.read', 'import'],
    'provider' => ['case.read', 'case.write', 'clinical.write', 'finance.read', 'finance.write', 'contacts.write', 'export'],
    'staff'    => ['case.read', 'case.write', 'clinical.write', 'finance.read', 'contacts.write'],
    'billing'  => ['case.read', 'finance.read', 'finance.write', 'contacts.write', 'export'],
];

// Platform operators (users with no practice) run the service: they see
// practices and subscriptions, never patient data.
function is_operator(array $user): bool { return $user['practice_id'] === null; }

function can(array $user, string $perm): bool {
    if (is_operator($user)) return $perm === 'platform.manage';
    return in_array($perm, ROLE_PERMS[$user['role']] ?? [], true);
}

// ---------- tenant context ----------
// Set by require_user(); every query on practice data filters by pid().
function current_practice(?array $set = null): ?array {
    static $practice = null;
    if ($set !== null) $practice = $set;
    return $practice;
}

function pid(): int {
    $p = current_practice();
    if (!$p) throw new LogicException('No practice in context');
    return (int)$p['id'];
}

// A user is only "signed in" once both password AND 2FA have passed.
// $allowPending lets the 2FA-enrollment and password-change endpoints run
// for someone who has passed the password step only.
function require_user(?string $perm = null, bool $allowPending = false): array {
    if (empty($_SESSION['uid'])) json_response(['error' => 'Not signed in', 'code' => 'auth'], 401);
    if (!$allowPending && empty($_SESSION['mfa_ok'])) json_response(['error' => 'Two-factor verification required', 'code' => 'mfa'], 401);
    $stmt = pi_db()->prepare('SELECT id, practice_id, email, name, role, active, must_change_password, totp_enabled FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['uid']]);
    $user = $stmt->fetch();
    if (!$user || !$user['active']) {
        pi_end_session();
        json_response(['error' => 'Account disabled', 'code' => 'auth'], 401);
    }
    if (!$allowPending && $user['must_change_password']) json_response(['error' => 'Password change required', 'code' => 'pw_change'], 401);
    check_csrf();
    if ($user['practice_id'] !== null) {
        $s = pi_db()->prepare('SELECT * FROM practices WHERE id = ?');
        $s->execute([$user['practice_id']]);
        current_practice($s->fetch());
        // Lapsed trial / canceled subscription: records stay readable, but
        // nothing can be changed. Endpoints that must keep working (sign-in,
        // billing, user admin) define PI_ALLOW_WHEN_LAPSED.
        if ($_SERVER['REQUEST_METHOD'] !== 'GET' && !defined('PI_ALLOW_WHEN_LAPSED') && practice_access(current_practice()) === 'read_only') {
            json_response(['error' => 'Your trial or subscription has ended. Your records are read-only until you subscribe under Billing.', 'code' => 'read_only'], 402);
        }
    } elseif ($perm !== null && $perm !== 'platform.manage') {
        json_response(['error' => 'Operator accounts cannot open practice records.'], 403);
    }
    if ($perm && !can($user, $perm)) {
        audit('access_denied', 'permission', $perm, null, $user);
        json_response(['error' => 'Your role does not allow this.'], 403);
    }
    return $user;
}

// ========== AUDIT ==========
// Keep `detail` free of clinical content — it records WHAT was touched
// (field names, ids), not the PHI values themselves.
function audit(string $action, ?string $entity = null, $entityId = null, $caseId = null, ?array $user = null, $detail = null) {
    $uid = $user['id'] ?? ($_SESSION['uid'] ?? null);
    $email = $user['email'] ?? ($_SESSION['email'] ?? null);
    if (is_array($detail)) $detail = json_encode($detail);
    $practiceId = current_practice()['id'] ?? ($user['practice_id'] ?? null);
    pi_db()->prepare('INSERT INTO audit_log (occurred_at, practice_id, user_id, user_email, action, entity, entity_id, case_id, ip_address, user_agent, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            now_str(), $practiceId, $uid, $email, $action, $entity,
            $entityId === null ? null : (string)$entityId,
            $caseId, $_SERVER['REMOTE_ADDR'] ?? 'cli',
            mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
            $detail === null ? null : mb_substr($detail, 0, 500),
        ]);
}

// ========== SHARED LOOKUPS ==========
// A case id from another practice is simply "not found".
function case_or_404(int $id): array {
    $stmt = pi_db()->prepare('SELECT * FROM cases WHERE id = ? AND practice_id = ?');
    $stmt->execute([$id, pid()]);
    $row = $stmt->fetch();
    if (!$row) json_response(['error' => 'Case not found'], 404);
    return $row;
}

// Child rows (visits, referrals, ...) are always looked up together with
// the case they belong to, and through it the practice, so an id from one
// case — or one practice — can never be used to read or edit another's.
function child_or_404(string $table, int $id, ?int $caseId = null): array {
    static $tables = ['referrals', 'visits', 'outcomes', 'correspondence', 'ledger', 'tasks', 'documents'];
    if (!in_array($table, $tables, true)) throw new InvalidArgumentException('bad table');
    if ($table === 'tasks') {
        $sql = 'SELECT * FROM tasks WHERE id = ? AND practice_id = ?';
        $args = [$id, pid()];
    } else {
        $sql = "SELECT t.* FROM $table t JOIN cases c ON c.id = t.case_id WHERE t.id = ? AND c.practice_id = ?";
        $args = [$id, pid()];
    }
    if ($caseId !== null) { $sql .= ' AND t.case_id = ?'; $args[] = $caseId; }
    $stmt = pi_db()->prepare($sql);
    $stmt->execute($args);
    $row = $stmt->fetch();
    if (!$row) json_response(['error' => 'Not found'], 404);
    return $row;
}

function touch_case(int $caseId) {
    pi_db()->prepare('UPDATE cases SET updated_at = ? WHERE id = ? AND practice_id = ?')->execute([now_str(), $caseId, pid()]);
}
