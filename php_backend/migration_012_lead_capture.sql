-- Welcome-offer lead capture. The homepage pop-up collects a name + email and
-- issues a single-use, 90-day, 15% promo code bound to that address; a daily
-- cron (cron/lead_drip.php) then sends a short follow-up sequence until the
-- lead books, unsubscribes, or the code expires. Safe to run multiple times.

SET @dbname = DATABASE();

CREATE TABLE IF NOT EXISTS leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  site VARCHAR(20) NOT NULL DEFAULT 'coverage',
  promo_code VARCHAR(50) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  unsubscribe_token CHAR(48) NOT NULL,
  drip_step TINYINT NOT NULL DEFAULT 0,
  last_drip_sent_at DATETIME NULL,
  converted_at DATETIME NULL,
  converted_booking_id VARCHAR(50) NULL,
  unsubscribed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY leads_email (email),
  KEY leads_status (status)
);

-- promo_codes: a code can be bound to one email address, and welcome codes are
-- flagged so they replace the automatic first-booking discount instead of
-- stacking on top of it.
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'promo_codes' AND COLUMN_NAME = 'assigned_email') = 0,
  'ALTER TABLE promo_codes ADD COLUMN assigned_email VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'promo_codes' AND COLUMN_NAME = 'is_welcome') = 0,
  'ALTER TABLE promo_codes ADD COLUMN is_welcome TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
