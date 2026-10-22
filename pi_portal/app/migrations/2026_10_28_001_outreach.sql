ALTER TABLE cases ADD COLUMN outreach_hold_on DATE NULL AFTER plan_set_on, ADD COLUMN paralegal VARCHAR(160) NULL AFTER outreach_hold_on;
CREATE TABLE IF NOT EXISTS outreach (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  attempted_on DATE NOT NULL,
  method ENUM('call','text','email','letter') NOT NULL DEFAULT 'call',
  outcome ENUM('no_answer','left_message','spoke_scheduled','spoke_will_call','unable_to_schedule','wrong_number') NOT NULL,
  notes_enc TEXT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_outreach_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
