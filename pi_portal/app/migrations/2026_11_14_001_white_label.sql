-- White label (top plan): the practice's own product name, color, logo and
-- branded sign-in link.
ALTER TABLE practices ADD COLUMN white_label TEXT NULL AFTER narrative_fees, ADD COLUMN brand_slug VARCHAR(40) NULL UNIQUE AFTER white_label;
CREATE TABLE practice_logos (
  practice_id INT PRIMARY KEY,
  png MEDIUMBLOB NOT NULL,
  updated_at DATETIME NOT NULL,
  CONSTRAINT fk_logo_practice FOREIGN KEY (practice_id) REFERENCES practices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
