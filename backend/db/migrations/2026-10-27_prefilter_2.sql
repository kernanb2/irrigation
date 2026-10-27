-- Unit E: second pre-filter valve (GPIO 27) and valve event logging.
-- Filter settings become per-filter (filter1_*, filter2_*); filter 1 keeps its current values.
-- Safe to run more than once.
USE irrigation;

-- Zones rows so flushes can be logged in valve_events (ids 16/17 are outside the 1–15
-- range valve.php and schedules.php accept, so they can't be opened as irrigation zones)
INSERT IGNORE INTO zones (id, unit_id, local_index, name, is_special, notes) VALUES
(16, 5, 0, 'Pondwater Pre-filter',   FALSE, 'Flush valve, GPIO 26 — controlled by the flush cycle'),
(17, 5, 1, 'Pondwater Pre-filter-2', FALSE, 'Flush valve, GPIO 27 — controlled by the flush cycle');

UPDATE IGNORE settings SET key_name = 'filter1_cycle_enabled' WHERE key_name = 'filter_cycle_enabled';
UPDATE IGNORE settings SET key_name = 'filter1_flush_sec'     WHERE key_name = 'filter_flush_sec';
UPDATE IGNORE settings SET key_name = 'filter1_wait_min'      WHERE key_name = 'filter_wait_min';

INSERT IGNORE INTO settings (key_name, value) VALUES
('filter1_cycle_enabled', 'false'),
('filter1_flush_sec',     '30'),
('filter1_wait_min',      '60'),
('filter2_cycle_enabled', 'false'),
('filter2_flush_sec',     '30'),
('filter2_wait_min',      '60');

-- Old single-filter report format; the next report from Unit E replaces it
DELETE FROM settings WHERE key_name = 'filter_last_report';
