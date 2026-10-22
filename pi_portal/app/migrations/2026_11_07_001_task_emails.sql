ALTER TABLE practices ADD COLUMN task_email_rules TEXT NULL AFTER cost_estimates;
ALTER TABLE users ADD COLUMN notify_tasks TINYINT(1) NOT NULL DEFAULT 1 AFTER notify_criteria;
ALTER TABLE tasks ADD COLUMN email_on VARCHAR(40) NULL AFTER due_on, ADD COLUMN email_who VARCHAR(40) NULL AFTER email_on, ADD COLUMN late_repeat_days TINYINT NULL AFTER email_who, ADD COLUMN late_emailed_at DATETIME NULL AFTER late_repeat_days;
CREATE TABLE IF NOT EXISTS task_email_to (
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
