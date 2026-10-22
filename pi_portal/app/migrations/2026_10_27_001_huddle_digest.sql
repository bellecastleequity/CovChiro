ALTER TABLE practices ADD COLUMN notify_rules TEXT NULL AFTER ehr_name;
ALTER TABLE users ADD COLUMN notify_digest TINYINT(1) NOT NULL DEFAULT 0 AFTER finance_access, ADD COLUMN notify_criteria VARCHAR(255) NULL AFTER notify_digest;
UPDATE users SET notify_digest = 1 WHERE role = 'admin' AND practice_id IS NOT NULL;
ALTER TABLE cases ADD COLUMN plan_visits_per_week DECIMAL(3,1) NULL AFTER head_injury, ADD COLUMN plan_set_on DATE NULL AFTER plan_visits_per_week;
CREATE TABLE IF NOT EXISTS digest_log (
  user_id INT NOT NULL,
  sent_on DATE NOT NULL,
  items INT NOT NULL,
  PRIMARY KEY (user_id, sent_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
