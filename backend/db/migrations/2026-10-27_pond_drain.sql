-- Unit E: Pond Drain (BOKYWOX/Tonhe A150 2" valve on relays 3+4, GPIO 25/33).
-- Safe to run more than once.
USE irrigation;

-- Zones row so drain moves can be logged in valve_events (outside the 1–15 irrigation range)
INSERT IGNORE INTO zones (id, unit_id, local_index, name, is_special, notes) VALUES
(18, 5, 2, 'Pond Drain', FALSE, '2" drain valve, relays 3+4 (GPIO 25/33) — supports partial open');

-- Desired position (0 = closed, 100 = fully open) and a command counter. The unit applies a
-- target only when the counter changes, so after a reboot the drain stays closed.
INSERT IGNORE INTO settings (key_name, value) VALUES
('drain_target_pct', '0'),
('drain_cmd_seq',    '0');
