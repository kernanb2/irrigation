<?php
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';

Auth::require();
header('Content-Type: application/json');

$rows = Database::get()->query("
    SELECT e.*, z.name AS zone_name
    FROM valve_events e JOIN zones z ON z.id = e.zone_id
    ORDER BY e.executed_at DESC
    LIMIT 100
")->fetchAll();

echo json_encode($rows);
