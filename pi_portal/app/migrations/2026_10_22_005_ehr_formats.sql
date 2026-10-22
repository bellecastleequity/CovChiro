CREATE TABLE IF NOT EXISTS ehr_formats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  layout ENUM('lines','transactions') NOT NULL,
  signature CHAR(64) NOT NULL,
  mapping TEXT NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  UNIQUE KEY uq_ehr_format (practice_id, signature)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
