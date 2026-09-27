-- Standing day auto-pay — adds the columns needed to charge a card on file
-- automatically instead of requiring the client to log in and pay each
-- scheduled date manually. Safe to run multiple times (guarded like
-- migration_catchup_all.sql).
--
-- Run this once in phpMyAdmin's SQL tab (or Import) against your live
-- database. It only adds columns — nothing is dropped or modified.

SET @dbname = DATABASE();

-- ---------- standing_requests: card collected at request time ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_requests' AND COLUMN_NAME = 'stripe_customer_id') = 0,
  'ALTER TABLE standing_requests ADD COLUMN stripe_customer_id VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_requests' AND COLUMN_NAME = 'stripe_payment_method_id') = 0,
  'ALTER TABLE standing_requests ADD COLUMN stripe_payment_method_id VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_requests' AND COLUMN_NAME = 'deposit_payment_intent') = 0,
  'ALTER TABLE standing_requests ADD COLUMN deposit_payment_intent VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- standing_agreements: card carried over + billing-plan tracking ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'stripe_customer_id') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN stripe_customer_id VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'stripe_payment_method_id') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN stripe_payment_method_id VARCHAR(255) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'prepay_charged') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN prepay_charged TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'installment_count') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN installment_count INT NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'installment_amount') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN installment_amount DECIMAL(10,2) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'installments_charged') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN installments_charged INT NOT NULL DEFAULT 0',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'last_installment_at') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN last_installment_at DATE NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- payments: allow the new bulk purposes ----------
-- purpose is already a free VARCHAR(20) with no CHECK constraint, so
-- "prepay" and "installment" values need no schema change — noted here for
-- completeness only.
