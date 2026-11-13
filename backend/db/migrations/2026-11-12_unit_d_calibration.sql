-- Unit D's SEN0308 on 3.3V, measured on Zone 21's sensor: ~2.2V in air (raw ~2600),
-- ~0V in water (raw 0). The server now uses the wet value as the "no sensor" floor
-- when it is below 1000.
UPDATE sensor_calibration SET dry_value = 2600, wet_value = 0, calibrated_at = NOW()
WHERE zone_id BETWEEN 21 AND 24;
