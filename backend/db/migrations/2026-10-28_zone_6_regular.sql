-- Zone 6 (Unit B) was "Pond to Pump Tank", a special zone interlocked with
-- Creek Source. It's now an ordinary watering zone named "Zone 6", so the
-- interlock no longer applies to it. Safe to run more than once.
USE irrigation;

UPDATE zones SET name = 'Zone 6', is_special = FALSE, notes = NULL WHERE id = 6;
