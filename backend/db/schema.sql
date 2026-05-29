-- Irrigation System Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS irrigation;
USE irrigation;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    username      VARCHAR(32) NOT NULL UNIQUE,
    email         VARCHAR(128),
    password_hash VARCHAR(255) NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    last_login    TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── ESP-32 controller units ───────────────────────────────────────────────────
CREATE TABLE units (
    id          TINYINT UNSIGNED PRIMARY KEY,  -- 1=A, 2=B, 3=C
    name        VARCHAR(32) NOT NULL,
    ip_address  VARCHAR(15),
    last_seen   TIMESTAMP,
    firmware    VARCHAR(16),
    UNIQUE KEY uq_name (name)
);

INSERT INTO units (id, name) VALUES (1, 'Unit-A'), (2, 'Unit-B'), (3, 'Unit-C');

-- ── Irrigation zones ──────────────────────────────────────────────────────────
CREATE TABLE zones (
    id                TINYINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    unit_id           TINYINT UNSIGNED NOT NULL,
    local_index       TINYINT UNSIGNED NOT NULL,
    name              VARCHAR(64) NOT NULL,
    description       TEXT,
    valve_state       ENUM('open','closed') NOT NULL DEFAULT 'closed',
    last_state_change TIMESTAMP,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    is_special        BOOLEAN NOT NULL DEFAULT FALSE,
    notes             TEXT,
    FOREIGN KEY (unit_id) REFERENCES units(id),
    UNIQUE KEY uq_unit_local (unit_id, local_index)
);

INSERT INTO zones (id, unit_id, local_index, name, is_special, notes) VALUES
(1,  1, 0, 'Creek Intake',      TRUE,  'Opens creek water supply — check pond level before activating'),
(2,  1, 1, 'Zone 2',            FALSE, NULL),
(3,  1, 2, 'Zone 3',            FALSE, NULL),
(4,  1, 3, 'Zone 4',            FALSE, NULL),
(5,  1, 4, 'Zone 5',            FALSE, NULL),
(6,  2, 0, 'Pond to Pump Tank', TRUE,  'Fills pump tank from pond — interlock: cannot open with creek intake'),
(7,  2, 1, 'Zone 7',            FALSE, NULL),
(8,  2, 2, 'Zone 8',            FALSE, NULL),
(9,  2, 3, 'Zone 9',            FALSE, NULL),
(10, 2, 4, 'Zone 10',           FALSE, NULL),
(11, 3, 0, 'Zone 11',           FALSE, NULL),
(12, 3, 1, 'Zone 12',           FALSE, NULL),
(13, 3, 2, 'Zone 13',           FALSE, NULL),
(14, 3, 3, 'Zone 14',           FALSE, NULL),
(15, 3, 4, 'Zone 15',           FALSE, NULL);

-- ── Moisture sensor readings ──────────────────────────────────────────────────
CREATE TABLE moisture_readings (
    id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    zone_id      TINYINT UNSIGNED NOT NULL,
    raw_value    SMALLINT UNSIGNED NOT NULL,
    moisture_pct TINYINT UNSIGNED,
    recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id),
    INDEX idx_zone_time (zone_id, recorded_at)
);

-- ── Temperature sensor readings ───────────────────────────────────────────────
CREATE TABLE temperature_readings (
    id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    unit_id     TINYINT UNSIGNED NOT NULL,
    sensor_addr VARCHAR(16) NOT NULL,
    temp_c      DECIMAL(5,2) NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (unit_id) REFERENCES units(id),
    INDEX idx_unit_time (unit_id, recorded_at)
);

-- ── Valve event log ───────────────────────────────────────────────────────────
CREATE TABLE valve_events (
    id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    zone_id      TINYINT UNSIGNED NOT NULL,
    action       ENUM('open','close') NOT NULL,
    trigger      ENUM('manual','schedule','auto_moisture','auto_temperature') NOT NULL,
    initiated_by VARCHAR(64),
    executed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success      BOOLEAN NOT NULL DEFAULT TRUE,
    notes        TEXT,
    FOREIGN KEY (zone_id) REFERENCES zones(id),
    INDEX idx_zone_time (zone_id, executed_at)
);

-- ── Watering schedules ────────────────────────────────────────────────────────
CREATE TABLE schedules (
    id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    zone_id         TINYINT UNSIGNED NOT NULL,
    name            VARCHAR(64),
    cron_expression VARCHAR(64) NOT NULL,
    duration_sec    SMALLINT UNSIGNED NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    skip_if_moist   BOOLEAN NOT NULL DEFAULT TRUE,
    skip_threshold  TINYINT UNSIGNED NOT NULL DEFAULT 60,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

-- ── Pending valve closes (scheduled auto-close after timed watering) ──────────
CREATE TABLE pending_closes (
    zone_id     TINYINT UNSIGNED PRIMARY KEY,
    unit_id     TINYINT UNSIGNED NOT NULL,
    local_index TINYINT UNSIGNED NOT NULL,
    close_at    TIMESTAMP NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

-- ── Moisture sensor calibration ───────────────────────────────────────────────
CREATE TABLE sensor_calibration (
    zone_id       TINYINT UNSIGNED PRIMARY KEY,
    dry_value     SMALLINT UNSIGNED NOT NULL DEFAULT 3300,
    wet_value     SMALLINT UNSIGNED NOT NULL DEFAULT 1300,
    calibrated_at TIMESTAMP,
    FOREIGN KEY (zone_id) REFERENCES zones(id)
);

INSERT INTO sensor_calibration (zone_id, dry_value, wet_value)
SELECT id, 3300, 1300 FROM zones;

-- ── System settings ───────────────────────────────────────────────────────────
CREATE TABLE settings (
    key_name   VARCHAR(64) PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO settings (key_name, value) VALUES
('auto_mode_enabled',         'true'),
('moisture_trigger_threshold','30'),
('temp_trigger_threshold_c',  '35'),
('sensor_poll_interval_sec',  '60'),
('max_zone_duration_sec',     '3600'),
('creek_pond_interlock',      'true');

-- ── Create application DB user (run as root) ──────────────────────────────────
-- CREATE USER 'irrigation_user'@'localhost' IDENTIFIED BY 'CHANGE_THIS_PASSWORD';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON irrigation.* TO 'irrigation_user'@'localhost';
-- FLUSH PRIVILEGES;
