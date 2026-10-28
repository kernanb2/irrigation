-- Zone 1 renamed Creek Intake → Creek Source. It has no moisture sensor:
-- a zone without a sensor_calibration row has no sensor, so its readings are
-- ignored and the card shows no moisture line. Safe to run more than once.
USE irrigation;

UPDATE zones SET name = 'Creek Source' WHERE id = 1;
UPDATE zones SET notes = 'Fills pump tank from pond — interlock: cannot open with Creek Source' WHERE id = 6;

DELETE FROM sensor_calibration WHERE zone_id = 1;
DELETE FROM moisture_readings  WHERE zone_id = 1;
