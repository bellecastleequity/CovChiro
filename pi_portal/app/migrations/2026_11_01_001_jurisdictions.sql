ALTER TABLE cases
  ADD COLUMN jurisdiction CHAR(2) NULL AFTER location_id,
  ADD COLUMN emc_by VARCHAR(10) NULL AFTER emc_status,
  ADD COLUMN emc_on DATE NULL AFTER emc_by,
  ADD COLUMN tort_option ENUM('unknown','limited','full') NOT NULL DEFAULT 'unknown' AFTER emc_on,
  ADD COLUMN lop_factored ENUM('unknown','no','yes') NOT NULL DEFAULT 'unknown' AFTER lop_acknowledged_on,
  ADD COLUMN lop_factor_company VARCHAR(160) NULL AFTER lop_factored,
  ADD COLUMN lop_factor_price DECIMAL(10,2) NULL AFTER lop_factor_company,
  ADD COLUMN lop_health_coverage ENUM('unknown','no','yes') NOT NULL DEFAULT 'unknown' AFTER lop_factor_price;
UPDATE cases c JOIN practices p ON p.id = c.practice_id SET c.jurisdiction = p.state WHERE c.jurisdiction IS NULL;
ALTER TABLE coverages
  ADD COLUMN policy_effective_on DATE NULL AFTER benefit_limit,
  ADD COLUMN demand_sent_on DATE NULL AFTER authorized_through;
ALTER TABLE locations
  ADD COLUMN state CHAR(2) NULL AFTER address
