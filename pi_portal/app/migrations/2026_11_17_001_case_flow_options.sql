-- Insurance vs letter-of-protection billing on each case (and the last
-- switch, for the on-screen notice); the optional chart-setup steps;
-- intake details; and "push off" for checklist steps, logged for the huddle.
ALTER TABLE cases ADD COLUMN billing_basis ENUM('insurance','lop') NULL AFTER emc_on, ADD COLUMN basis_change TEXT NULL AFTER billing_basis, ADD COLUMN initial_care ENUM('unknown','none','doctor','urgent_care','hospital') NOT NULL DEFAULT 'unknown' AFTER basis_change, ADD COLUMN ambulance ENUM('unknown','no','yes') NOT NULL DEFAULT 'unknown' AFTER initial_care, ADD COLUMN case_updates TINYINT(1) NOT NULL DEFAULT 1 AFTER ambulance, ADD COLUMN case_update_last_on DATE NULL AFTER case_updates;
ALTER TABLE practices ADD COLUMN chart_setup_steps TINYINT(1) NOT NULL DEFAULT 0 AFTER brand_slug, ADD COLUMN reduction_terms TEXT NULL AFTER chart_setup_steps, ADD COLUMN case_updates TINYINT(1) NOT NULL DEFAULT 1 AFTER reduction_terms;
ALTER TABLE patients ADD COLUMN preferred_name VARCHAR(80) NULL AFTER last_name, ADD COLUMN hipaa_contacts_enc TEXT NULL AFTER address_enc;
ALTER TABLE case_milestones ADD COLUMN snoozed_until DATE NULL AFTER note, ADD COLUMN snoozed_by INT NULL AFTER snoozed_until;
CREATE TABLE pushoffs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  case_id INT NULL,
  kind ENUM('step','guide','task') NOT NULL,
  item_key VARCHAR(60) NOT NULL,
  label VARCHAR(255) NOT NULL,
  from_date DATE NULL,
  to_date DATE NOT NULL,
  user_id INT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_pushoffs_practice (practice_id, created_at),
  CONSTRAINT fk_push_practice FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE case_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  case_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  kind ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  sent_to VARCHAR(400) NOT NULL,
  sent_by INT NULL,
  sent_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  viewed_at DATETIME NULL,
  snapshot_enc MEDIUMTEXT NOT NULL,
  INDEX idx_case_reports_case (case_id, sent_at),
  CONSTRAINT fk_cr_case FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
