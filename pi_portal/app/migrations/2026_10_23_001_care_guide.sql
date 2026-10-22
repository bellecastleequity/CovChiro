ALTER TABLE cases ADD COLUMN head_injury ENUM('unknown','yes','no') NOT NULL DEFAULT 'unknown' AFTER notes_enc;
ALTER TABLE referrals MODIFY type ENUM('mri','xray','ct','emg','emc','ortho','neuro','pain_mgmt','surgical','pt','other') NOT NULL, ADD COLUMN specialty VARCHAR(80) NULL AFTER type;
CREATE TABLE IF NOT EXISTS case_guide (
  case_id INT NOT NULL,
  step VARCHAR(20) NOT NULL,
  status ENUM('dismissed','snoozed') NOT NULL,
  until DATE NULL,
  reason VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (case_id, step),
  FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
