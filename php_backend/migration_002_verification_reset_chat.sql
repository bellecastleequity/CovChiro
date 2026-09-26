-- Incremental migration for an EXISTING coveragechiropractor database.
-- Safe to run on live data: only adds new columns/tables, never drops or
-- modifies existing ones. Run this once in phpMyAdmin (SQL tab) against
-- your live database after uploading the updated PHP files.

ALTER TABLE users
  ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN verification_token VARCHAR(64) NULL,
  ADD COLUMN verification_sent_at DATETIME NULL,
  ADD COLUMN reset_token VARCHAR(64) NULL,
  ADD COLUMN reset_expires DATETIME NULL;

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

-- Mark any existing accounts as already verified so current users aren't
-- suddenly prompted to verify an account they've been using for a while.
UPDATE users SET email_verified = 1 WHERE email_verified = 0;
