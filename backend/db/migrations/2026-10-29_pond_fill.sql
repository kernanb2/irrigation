-- Unit E: Pond Fill (second A150 2" valve on relays 5+6, GPIO 32/13). Normally open;
-- Pond Fill mode opens the drain fully and closes it for 1–24 h. Safe to run more than once.
USE irrigation;

-- Zones row so its moves can be logged in valve_events (outside the 1–15 irrigation range)
INSERT IGNORE INTO zones (id, unit_id, local_index, name, valve_state, is_special, notes) VALUES
(19, 5, 3, 'Pond Fill', 'open', FALSE, '2" valve, relays 5+6 (GPIO 32/13) — normally open');

-- Run length (hours), whether a run is wanted, and a command counter. The unit applies a
-- command only when the counter changes, so a reboot never restarts a run.
INSERT IGNORE INTO settings (key_name, value) VALUES
('fill_hours',    '4'),
('fill_active',   'false'),
('fill_cmd_seq',  '0');
