-- Unit D: zones 21–24 (Rainbird 9V latching + DRV8871, like Units A–C), a DFRobot
-- SEN0308 moisture sensor per zone, and a Taidacent UART ultrasonic sensor for the
-- pond level. Safe to run more than once.
USE irrigation;

INSERT IGNORE INTO zones (id, unit_id, local_index, name, is_special, notes) VALUES
(21, 4, 0, 'Zone 21', FALSE, NULL),
(22, 4, 1, 'Zone 22', FALSE, NULL),
(23, 4, 2, 'Zone 23', FALSE, NULL),
(24, 4, 3, 'Zone 24', FALSE, NULL);

-- SEN0308 starts on the same defaults as the A–C sensors; calibrate on the bench
INSERT IGNORE INTO sensor_calibration (zone_id, dry_value, wet_value) VALUES
(21, 3300, 1300), (22, 3300, 1300), (23, 3300, 1300), (24, 3300, 1300);

-- One row every 30 minutes: distance from the sensor down to the water (mm).
-- Smaller distance = higher water.
CREATE TABLE IF NOT EXISTS pond_level_readings (
    id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    distance_mm SMALLINT UNSIGNED NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_time (recorded_at)
);

-- Distance at the pond's normal level, set from the dashboard ('' = not set yet)
INSERT IGNORE INTO settings (key_name, value) VALUES ('pond_normal_distance_mm', '');
