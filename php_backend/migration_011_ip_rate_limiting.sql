-- Per-IP rate limiting for login/register/password-reset-request. These are
-- the three public, unauthenticated endpoints an attacker can hit directly;
-- account-level lockout (users.failed_logins/locked_until) only stops
-- brute-forcing ONE known account, so this adds a second gate that catches
-- password-spraying across many guessed emails, mass fake registrations,
-- and reset-email spam from a single source. Safe to run multiple times.

CREATE TABLE IF NOT EXISTS ip_rate_limits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  action VARCHAR(32) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 1,
  window_start DATETIME NOT NULL,
  blocked_until DATETIME NULL,
  UNIQUE KEY ip_action (ip_address, action)
);
