-- Extra locations beyond those included in Platinum are a paid add-on
-- (quantity mirrored from the Stripe subscription), and team members can be
-- limited to several locations rather than one.
ALTER TABLE practices ADD COLUMN extra_locations INT NOT NULL DEFAULT 0 AFTER billing_interval;
CREATE TABLE user_locations (
  user_id INT NOT NULL,
  location_id INT NOT NULL,
  PRIMARY KEY (user_id, location_id),
  CONSTRAINT fk_ul_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ul_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
