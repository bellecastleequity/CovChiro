-- Each user's own acceptance of the Terms of Service and User Agreement.
ALTER TABLE users ADD COLUMN terms_version VARCHAR(20) NULL AFTER location_restricted, ADD COLUMN terms_accepted_at DATETIME NULL AFTER terms_version, ADD COLUMN terms_accepted_name VARCHAR(120) NULL AFTER terms_accepted_at, ADD COLUMN terms_accepted_ip VARCHAR(45) NULL AFTER terms_accepted_name
