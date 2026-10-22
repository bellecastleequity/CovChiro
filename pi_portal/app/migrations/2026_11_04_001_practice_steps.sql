CREATE TABLE IF NOT EXISTS practice_steps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  detail VARCHAR(500) NULL,
  cases VARCHAR(80) NULL,
  anchor ENUM('first_visit','date_of_injury','care_end','none') NOT NULL DEFAULT 'first_visit',
  days INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  INDEX idx_steps_practice (practice_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS practice_silenced (
  practice_id INT NOT NULL,
  item_key VARCHAR(80) NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (practice_id, item_key),
  FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
