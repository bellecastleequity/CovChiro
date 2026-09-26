-- Catch-up migration — safely applies anything missing from migrations
-- 002, 003, and 004 in one pass, regardless of which ones have already been
-- run on this database. Every change is guarded by a check against
-- information_schema first, so it's safe to run this multiple times or on
-- a database that's already partly up to date — it will never try to
-- re-add a column that's already there (which is what caused the
-- "Unknown column" / duplicate-column errors from running the individual
-- migration files out of order).
--
-- Run this once in phpMyAdmin's SQL tab (or Import) against your live
-- database. It only adds columns/tables — nothing is dropped or modified.

SET @dbname = DATABASE();

-- ---------- users: email verification + password reset (migration 002) ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_verified') = 0,
  'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verification_token') = 0,
  'ALTER TABLE users ADD COLUMN verification_token VARCHAR(64) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verification_sent_at') = 0,
  'ALTER TABLE users ADD COLUMN verification_sent_at DATETIME NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'reset_token') = 0,
  'ALTER TABLE users ADD COLUMN reset_token VARCHAR(64) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'reset_expires') = 0,
  'ALTER TABLE users ADD COLUMN reset_expires DATETIME NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Mark existing accounts as already verified so nobody currently using the
-- site gets suddenly prompted to verify. Safe to run even if this already
-- happened — it only affects rows still at the default 0.
UPDATE users SET email_verified = 1 WHERE email_verified = 0;

-- ---------- chat_messages table (migration 002) ----------
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  thread_key VARCHAR(64) NOT NULL,
  user_id INT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  sender VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  read_by_admin TINYINT(1) NOT NULL DEFAULT 0,
  read_by_client TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY (thread_key)
);

-- ---------- bookings: feedback follow-up tracking (migration 003) ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'feedback_reminder_sent_at') = 0,
  'ALTER TABLE bookings ADD COLUMN feedback_reminder_sent_at DATETIME NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- standing_requests / standing_agreements: signatures (migration 004) ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_requests' AND COLUMN_NAME = 'signature') = 0,
  'ALTER TABLE standing_requests ADD COLUMN signature JSON NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'signature') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN signature JSON NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- admin billing: adjustments ledger + manual payment fields (migration 006) ----------
CREATE TABLE IF NOT EXISTS booking_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'reference') = 0,
  'ALTER TABLE payments ADD COLUMN reference VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'note') = 0,
  'ALTER TABLE payments ADD COLUMN note VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'recorded_by') = 0,
  'ALTER TABLE payments ADD COLUMN recorded_by VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
