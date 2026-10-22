ALTER TABLE practices ADD COLUMN cost_estimates TEXT NULL AFTER notify_rules;
CREATE TABLE IF NOT EXISTS case_estimates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  referral_id INT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'custom',
  description VARCHAR(160) NULL,
  qty DECIMAL(8,2) NOT NULL DEFAULT 1,
  unit_cost DECIMAL(10,2) NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_est_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
