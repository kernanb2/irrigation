<?php
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';

Auth::require();
header('Content-Type: application/json');

$db = Database::get();

$zones = $db->query("
    SELECT z.id, z.unit_id, z.local_index, z.name, z.valve_state,
           z.last_state_change, z.enabled, z.is_special,
           u.name AS unit_name, u.ip_address, u.last_seen,
           sc.dry_value, sc.wet_value,
           (SELECT moisture_pct FROM moisture_readings
            WHERE zone_id = z.id ORDER BY recorded_at DESC LIMIT 1) AS moisture_pct,
           (SELECT recorded_at FROM moisture_readings
            WHERE zone_id = z.id ORDER BY recorded_at DESC LIMIT 1) AS moisture_at
    FROM zones z
    JOIN units u ON u.id = z.unit_id
    LEFT JOIN sensor_calibration sc ON sc.zone_id = z.id
    ORDER BY z.id
")->fetchAll();

$temps = $db->query("
    SELECT t.unit_id, t.sensor_addr, t.temp_c, t.recorded_at
    FROM temperature_readings t
    INNER JOIN (
        SELECT unit_id, MAX(recorded_at) AS latest
        FROM temperature_readings
        GROUP BY unit_id
    ) r ON t.unit_id = r.unit_id AND t.recorded_at = r.latest
")->fetchAll();

$schedules = $db->query("
    SELECT s.*, z.name AS zone_name
    FROM schedules s JOIN zones z ON z.id = s.zone_id
    WHERE s.enabled = 1
    ORDER BY s.zone_id
")->fetchAll();

echo json_encode([
    'zones'     => $zones,
    'temps'     => $temps,
    'schedules' => $schedules,
    'ts'        => time(),
]);
