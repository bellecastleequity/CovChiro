ALTER TABLE practices ADD COLUMN status_request_rules TEXT NULL AFTER task_email_rules;
ALTER TABLE cases ADD COLUMN case_manager_name VARCHAR(160) NULL AFTER paralegal, ADD COLUMN case_manager_email VARCHAR(190) NULL AFTER case_manager_name, ADD COLUMN auto_status TINYINT(1) NOT NULL DEFAULT 0 AFTER case_manager_email, ADD COLUMN auto_status_to VARCHAR(20) NOT NULL DEFAULT 'attorney' AFTER auto_status, ADD COLUMN auto_status_every SMALLINT NULL AFTER auto_status_to, ADD COLUMN auto_status_last_on DATE NULL AFTER auto_status_every;
CREATE TABLE IF NOT EXISTS status_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  case_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  kind ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  sent_to VARCHAR(400) NOT NULL,
  sent_by INT NULL,
  sent_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  viewed_at DATETIME NULL,
  responded_at DATETIME NULL,
  response_enc TEXT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  FOREIGN KEY (case_id) REFERENCES cases(id),
  UNIQUE KEY uq_status_token (token_hash),
  INDEX idx_status_case (case_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
