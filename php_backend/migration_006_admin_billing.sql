-- Adds admin billing controls: itemized charges/discounts on a booking
-- (booking_adjustments), plus manual (check/cash) payment recording on the
-- existing payments table. Idempotent — safe to run even if some of this
-- already exists.

CREATE TABLE IF NOT EXISTS booking_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL, -- positive = additional charge, negative = discount
  reason VARCHAR(255) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

SET @dbname = DATABASE();

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
