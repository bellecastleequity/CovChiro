CREATE TABLE IF NOT EXISTS feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  user_id INT NULL,
  kind ENUM('feature','change','problem') NOT NULL DEFAULT 'feature',
  area VARCHAR(60) NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NULL,
  page VARCHAR(80) NULL,
  status ENUM('new','reviewing','planned','done','declined') NOT NULL DEFAULT 'new',
  response TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  INDEX idx_feedback_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
