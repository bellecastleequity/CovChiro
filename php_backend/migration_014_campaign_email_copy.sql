-- Custom follow-up email copy per campaign (subject line + opening paragraph
-- for each of the 5 offer emails), stored as JSON on the library code. Blank
-- entries fall back to the standard emails. Requires
-- migration_013_campaign_landing_pages.sql. Safe to run multiple times.

SET @dbname = DATABASE();

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'promo_codes' AND COLUMN_NAME = 'drip_custom') = 0,
  'ALTER TABLE promo_codes ADD COLUMN drip_custom TEXT NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
