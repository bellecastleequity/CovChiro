ALTER TABLE practices ADD COLUMN email VARCHAR(190) NULL AFTER fax, ADD COLUMN guide_order VARCHAR(255) NULL AFTER email;
ALTER TABLE cases ADD COLUMN guide_order VARCHAR(255) NULL AFTER ehr_case_label, ADD COLUMN end_reason VARCHAR(40) NULL AFTER discharge_date, ADD COLUMN narrative_request VARCHAR(20) NULL AFTER end_reason, ADD COLUMN narrative_requested_on DATE NULL AFTER narrative_request
