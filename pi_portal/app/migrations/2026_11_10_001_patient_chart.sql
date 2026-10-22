ALTER TABLE patients ADD COLUMN chart_number VARCHAR(40) NULL AFTER last_name, ADD INDEX idx_patients_chart (practice_id, chart_number);
ALTER TABLE cases ADD COLUMN ehr_case_label VARCHAR(80) NULL AFTER case_number
