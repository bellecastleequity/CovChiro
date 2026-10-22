CREATE TABLE IF NOT EXISTS mkt_settings (
  k VARCHAR(40) PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mkt_prospects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('npi','manual','import') NOT NULL DEFAULT 'npi',
  npi VARCHAR(10) NULL,
  name VARCHAR(200) NOT NULL,
  specialty VARCHAR(20) NOT NULL,
  contact_name VARCHAR(120) NULL,
  contact_role VARCHAR(80) NULL,
  email VARCHAR(190) NULL,
  email_source VARCHAR(20) NULL,
  phone VARCHAR(30) NULL,
  website VARCHAR(255) NULL,
  address VARCHAR(255) NULL,
  city VARCHAR(80) NULL,
  state CHAR(2) NULL,
  zip VARCHAR(10) NULL,
  status ENUM('new','qualified','not_fit','no_email','ready','in_sequence','done','unsubscribed','bounced','converted','paused','error') NOT NULL DEFAULT 'new',
  fit_score TINYINT NULL,
  fit_evidence VARCHAR(500) NULL,
  step TINYINT NOT NULL DEFAULT 0,
  next_send_at DATETIME NULL,
  last_sent_at DATETIME NULL,
  clicked_at DATETIME NULL,
  converted_practice_id INT NULL,
  token CHAR(32) NOT NULL,
  attempts TINYINT NOT NULL DEFAULT 0,
  error VARCHAR(255) NULL,
  researched_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_mkt_npi (npi),
  UNIQUE KEY uq_mkt_token (token),
  INDEX idx_mkt_status (status, next_send_at),
  INDEX idx_mkt_email (email),
  INDEX idx_mkt_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mkt_sends (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prospect_id INT NOT NULL,
  step TINYINT NOT NULL,
  email VARCHAR(190) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  ok TINYINT(1) NOT NULL,
  error VARCHAR(255) NULL,
  sent_at DATETIME NOT NULL,
  FOREIGN KEY (prospect_id) REFERENCES mkt_prospects(id),
  INDEX idx_mkt_sends_day (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mkt_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  prospect_id INT NULL,
  kind VARCHAR(20) NOT NULL,
  detail VARCHAR(255) NULL,
  ip VARCHAR(45) NULL,
  at DATETIME NOT NULL,
  INDEX idx_mkt_events (prospect_id, kind),
  INDEX idx_mkt_events_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mkt_suppressions (
  email VARCHAR(190) PRIMARY KEY,
  reason VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mkt_discovery (
  specialty VARCHAR(20) NOT NULL,
  zip_prefix VARCHAR(5) NOT NULL,
  skip INT NOT NULL DEFAULT 0,
  done_at DATETIME NULL,
  PRIMARY KEY (specialty, zip_prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS mkt_ai_usage (
  day DATE NOT NULL,
  provider VARCHAR(10) NOT NULL,
  calls INT NOT NULL DEFAULT 0,
  tokens INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
