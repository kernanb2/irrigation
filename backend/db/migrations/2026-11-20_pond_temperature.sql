-- Unit D pond level: keep the DS18B20 temperature with each reading so the distance
-- can be corrected for the speed of sound. The correction stays off ('0') until a
-- bench test shows the sensor doesn't already correct for temperature itself.
ALTER TABLE pond_level_readings ADD COLUMN temp_c DECIMAL(5,2) NULL AFTER distance_mm;
INSERT INTO settings (key_name, value) VALUES ('pond_temp_comp', '0')
    ON DUPLICATE KEY UPDATE value = value;
