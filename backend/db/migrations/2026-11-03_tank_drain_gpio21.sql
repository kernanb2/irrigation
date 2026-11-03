-- Unit E: Storage Tank Drain relay moved again, from GPIO 22 (also damaged) to GPIO 21.
USE irrigation;
UPDATE zones SET notes = '1" valve, relay 7 (GPIO 21) — normally closed' WHERE id = 20;
