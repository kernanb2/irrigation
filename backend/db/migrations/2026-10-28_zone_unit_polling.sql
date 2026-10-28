-- Zone units (A–C) poll the server instead of being called by it.
-- The web page and the schedule cron set a desired state per zone; the unit
-- picks it up on its next check-in (api/unit_report.php) and reports back.
-- Needs ALTER/CREATE — run as root:  mysql -u root -p < 2026-10-28_zone_unit_polling.sql
USE irrigation;

-- desired_until: the unit closes the valve itself at this time, even if it
-- loses contact with the server. desired_trigger/desired_by label the event log.
ALTER TABLE zones
    ADD COLUMN desired_state   ENUM('open','closed') NOT NULL DEFAULT 'closed' AFTER valve_state,
    ADD COLUMN desired_until   DATETIME NULL AFTER desired_state,
    ADD COLUMN desired_trigger ENUM('manual','schedule','auto_moisture','auto_temperature') NOT NULL DEFAULT 'manual' AFTER desired_until,
    ADD COLUMN desired_by      VARCHAR(64) NULL AFTER desired_trigger;

-- Latest check-in from each zone unit, and the event-log cursor (boot_id + seq)
CREATE TABLE IF NOT EXISTS unit_status (
    unit_id     TINYINT UNSIGNED PRIMARY KEY,
    report      JSON,
    boot_id     VARCHAR(16),
    event_seq   INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (unit_id) REFERENCES units(id)
);
