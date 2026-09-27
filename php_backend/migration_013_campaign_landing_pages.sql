-- Campaign landing pages. Any code in the promo library can be given its own
-- landing page (/offer/CODE) that captures name + email and issues that
-- person a unique, single-use version of the code bound to their email, then
-- starts the same follow-up sequence as the homepage welcome offer. Requires
-- migration_012_lead_capture.sql. Safe to run multiple times.

SET @dbname = DATABASE();

-- ---------- promo_codes: landing page settings + per-person child codes ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'promo_codes' AND COLUMN_NAME = 'landing_enabled') = 0,
  'ALTER TABLE promo_codes ADD COLUMN landing_enabled TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN landing_site VARCHAR(20) NOT NULL DEFAULT ''coverage'', ADD COLUMN landing_headline VARCHAR(200) NULL, ADD COLUMN landing_description TEXT NULL, ADD COLUMN landing_visits INT NOT NULL DEFAULT 0',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'promo_codes' AND COLUMN_NAME = 'parent_code') = 0,
  'ALTER TABLE promo_codes ADD COLUMN parent_code VARCHAR(50) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- leads: which campaign a signup came from ('' = homepage pop-up) ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'campaign_code') = 0,
  'ALTER TABLE leads ADD COLUMN campaign_code VARCHAR(50) NOT NULL DEFAULT ''''',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- One lead record per email per campaign (was: one per email), so the same
-- person can sign up for the welcome offer and for later campaigns.
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'leads' AND INDEX_NAME = 'leads_email') > 0,
  'ALTER TABLE leads DROP INDEX leads_email',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'leads' AND INDEX_NAME = 'leads_email_campaign') = 0,
  'ALTER TABLE leads ADD UNIQUE KEY leads_email_campaign (email, campaign_code)',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
