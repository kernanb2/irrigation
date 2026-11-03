-- Unit E: Storage Tank Drain relay moved from GPIO 23 (damaged on this board) to GPIO 22.
USE irrigation;
UPDATE zones SET notes = '1" valve, relay 7 (GPIO 22) — normally closed' WHERE id = 20;
