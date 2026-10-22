ALTER TABLE practices ADD COLUMN billing_interval ENUM('monthly','annual') NOT NULL DEFAULT 'monthly' AFTER stripe_subscription_id;
CREATE TABLE IF NOT EXISTS trial_notices (
  practice_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  sent_at DATETIME NOT NULL,
  PRIMARY KEY (practice_id, kind),
  FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
