ALTER TABLE cases MODIFY injury_type ENUM('auto','slip_fall','workers_comp','other_pi') NOT NULL DEFAULT 'auto'
