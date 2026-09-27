-- Full street addresses + geocoded coordinates, replacing ZIP-only location
-- capture. zip_code columns are kept (still used for the region/rate lookup
-- table and as a fallback when geocoding is unavailable) — address/lat/lng
-- are added alongside them, not instead of them. Safe to run multiple times.

SET @dbname = DATABASE();

-- ---------- bookings ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'address') = 0,
  'ALTER TABLE bookings ADD COLUMN address VARCHAR(500) NULL AFTER zip_code',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'lat') = 0,
  'ALTER TABLE bookings ADD COLUMN lat DECIMAL(10,7) NULL, ADD COLUMN lng DECIMAL(10,7) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- standing_requests ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_requests' AND COLUMN_NAME = 'address') = 0,
  'ALTER TABLE standing_requests ADD COLUMN address VARCHAR(500) NULL AFTER zip_code',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_requests' AND COLUMN_NAME = 'lat') = 0,
  'ALTER TABLE standing_requests ADD COLUMN lat DECIMAL(10,7) NULL, ADD COLUMN lng DECIMAL(10,7) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- standing_agreements ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'address') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN address VARCHAR(500) NULL AFTER zip_code',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'standing_agreements' AND COLUMN_NAME = 'lat') = 0,
  'ALTER TABLE standing_agreements ADD COLUMN lat DECIMAL(10,7) NULL, ADD COLUMN lng DECIMAL(10,7) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- geocode cache ----------
-- Nominatim's usage policy requires caching results rather than re-querying
-- the same address repeatedly. Keyed by a hash of the normalized address so
-- repeat lookups (the same clinic/home address booking again) are free and
-- instant, and so the public Nominatim server sees far less traffic than one
-- request per quote/booking.
CREATE TABLE IF NOT EXISTS geocode_cache (
  address_hash CHAR(32) PRIMARY KEY,
  address VARCHAR(500) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  postcode VARCHAR(10) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
