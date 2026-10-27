-- Add Unit D (placeholder) and Unit E (pondwater pre-filter flush, 192.168.1.47)
-- Safe to run more than once.
USE irrigation;

INSERT IGNORE INTO units (id, name, ip_address) VALUES
(4, 'Unit-D', NULL),
(5, 'Unit-E', '192.168.1.47');

INSERT IGNORE INTO settings (key_name, value) VALUES
('filter_cycle_enabled', 'false'),
('filter_flush_sec',     '30'),
('filter_wait_min',      '60');
