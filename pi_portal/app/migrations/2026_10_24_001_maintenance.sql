ALTER TABLE cases ADD COLUMN mmi_date DATE NULL AFTER head_injury, ADD COLUMN maintenance_every_days SMALLINT NULL AFTER mmi_date;
ALTER TABLE visits MODIFY visit_type ENUM('initial','treatment','re_exam','maintenance','discharge','no_show') NOT NULL DEFAULT 'treatment'
