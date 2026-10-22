CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_task_assignee_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO task_assignees (task_id, user_id) SELECT id, assigned_user_id FROM tasks WHERE assigned_user_id IS NOT NULL
