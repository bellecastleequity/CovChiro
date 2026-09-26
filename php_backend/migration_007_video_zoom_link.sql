-- Adds a processing step to video interview requests: admin can attach a
-- Zoom link and mark a request scheduled (emails the client + shows in
-- their portal) or mark it done once the call happens. Idempotent.

SET @dbname = DATABASE();

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'video_requests' AND COLUMN_NAME = 'zoom_link') = 0,
  'ALTER TABLE video_requests ADD COLUMN zoom_link VARCHAR(500) NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'video_requests' AND COLUMN_NAME = 'link_sent_at') = 0,
  'ALTER TABLE video_requests ADD COLUMN link_sent_at DATETIME NULL',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
