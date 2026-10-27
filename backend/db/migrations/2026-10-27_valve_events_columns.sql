-- The live valve_events table was missing trigger_type and initiated_by (schema.sql has them),
-- so every INSERT into valve_events failed and the event log stayed empty.
-- Needs ALTER privilege — run as MySQL root:
--   mysql -u root -p irrigation < backend/db/migrations/2026-10-27_valve_events_columns.sql
USE irrigation;

ALTER TABLE valve_events
    ADD COLUMN trigger_type ENUM('manual','schedule','auto_moisture','auto_temperature') NOT NULL DEFAULT 'manual' AFTER action,
    ADD COLUMN initiated_by VARCHAR(64) AFTER trigger_type;
