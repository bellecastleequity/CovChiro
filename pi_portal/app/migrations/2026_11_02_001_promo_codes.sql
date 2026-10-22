CREATE TABLE IF NOT EXISTS promo_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  description VARCHAR(200) NULL,
  kind ENUM('trial_days','percent','amount','comp') NOT NULL,
  trial_days INT NULL,
  percent_off INT NULL,
  amount_off DECIMAL(10,2) NULL,
  duration ENUM('once','repeating','forever') NOT NULL DEFAULT 'once',
  duration_months INT NULL,
  plans VARCHAR(60) NULL,
  max_redemptions INT NULL,
  redeemed INT NOT NULL DEFAULT 0,
  expires_on DATE NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  stripe_coupon_id VARCHAR(64) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE INDEX idx_promo_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE practices
  ADD COLUMN promo_code_id INT NULL AFTER billing_interval,
  ADD COLUMN promo_applied_at DATETIME NULL AFTER promo_code_id
