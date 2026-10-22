ALTER TABLE practices ADD COLUMN schedule_settings TEXT NULL AFTER status_request_rules;
CREATE TABLE IF NOT EXISTS schedule_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  file_kind ENUM('csv','xlsx','pdf') NOT NULL,
  file_sha256 CHAR(64) NOT NULL,
  first_date DATE NULL,
  last_date DATE NULL,
  visits_added INT NOT NULL DEFAULT 0,
  no_shows_added INT NOT NULL DEFAULT 0,
  rows_matched INT NOT NULL DEFAULT 0,
  rows_unmatched INT NOT NULL DEFAULT 0,
  uploaded_by INT NULL,
  uploaded_at DATETIME NOT NULL,
  undone_at DATETIME NULL,
  undone_by INT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  INDEX idx_sched_practice (practice_id, uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE visits MODIFY source ENUM('manual','ehr','schedule') NOT NULL DEFAULT 'manual', ADD COLUMN schedule_import_id INT NULL AFTER source;
ALTER TABLE ehr_formats MODIFY layout ENUM('lines','transactions','schedule') NOT NULL
