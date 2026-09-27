-- Standalone invoices (charges not tied to any existing booking) plus their
-- own adjustment ledger for late fees/interest, mirroring how
-- booking_adjustments already works for bookings. Safe to run multiple
-- times — only creates what's missing.

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NOT NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'due', -- due | paid | void
  stripe_payment_intent VARCHAR(255) NULL,
  created_by VARCHAR(255), -- admin email
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (user_id), KEY (status)
);

CREATE TABLE IF NOT EXISTS invoice_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL, -- signed: + charge (late fee, interest) / - discount
  reason VARCHAR(255) NOT NULL,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  KEY (invoice_id)
);

-- payments.invoice_id: lets a standalone invoice payment land in the same
-- unified payments ledger as booking/standing-day payments (guarded like
-- migration_catchup_all.sql, since payments already exists on live databases).
SET @dbname = DATABASE();
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'invoice_id') = 0,
  'ALTER TABLE payments ADD COLUMN invoice_id VARCHAR(50) NULL, ADD KEY (invoice_id)',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
