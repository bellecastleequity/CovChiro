ALTER TABLE practices ADD COLUMN ehr_name VARCHAR(80) NULL AFTER staff_finance;
ALTER TABLE ehr_imports MODIFY ehr_system VARCHAR(80) NOT NULL, ADD COLUMN method ENUM('pdf','spreadsheet','totals') NOT NULL DEFAULT 'pdf' AFTER ehr_system;
ALTER TABLE cases MODIFY ehr_system VARCHAR(80) NULL
