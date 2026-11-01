-- Unit E: Storage Tank Drain (U.S. Solid USS-MSV00213 1" valve on relay 7, GPIO 23).
-- Normally closed; a run opens the Pond Drain fully, closes Pond Fill, then opens this
-- valve for 10–120 min. Safe to run more than once.
USE irrigation;

-- Zones row so its moves can be logged in valve_events (outside the 1–15 irrigation range)
INSERT IGNORE INTO zones (id, unit_id, local_index, name, valve_state, is_special, notes) VALUES
(20, 5, 4, 'Storage Tank Drain', 'closed', FALSE, '1" valve, relay 7 (GPIO 23) — normally closed');

-- Run length (minutes), whether a run is wanted, and a command counter. The unit applies a
-- command only when the counter changes, so a reboot never restarts a run.
INSERT IGNORE INTO settings (key_name, value) VALUES
('tank_drain_minutes', '30'),
('tank_drain_active',  'false'),
('tank_drain_cmd_seq', '0');
