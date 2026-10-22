CREATE TABLE IF NOT EXISTS locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  fax VARCHAR(40) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE users ADD COLUMN location_id INT NULL AFTER finance_access, ADD COLUMN location_restricted TINYINT(1) NOT NULL DEFAULT 0 AFTER location_id;
ALTER TABLE cases ADD COLUMN location_id INT NULL AFTER patient_id;
ALTER TABLE visits ADD COLUMN location_id INT NULL AFTER visit_type
