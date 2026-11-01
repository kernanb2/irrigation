<?php
// Web UI — start a Unit E Storage Tank Drain run ({"minutes": 10–120}) or stop it ({"stop": true}).
// Status comes from api/filter.php.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/TankDrain.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Method not allowed']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];

if (!empty($body['stop'])) {
    TankDrain::command(null);
} elseif (TankDrain::validMinutes($body['minutes'] ?? null)) {
    TankDrain::command($body['minutes']);
} else {
    echo json_encode(['error' => 'minutes must be 10–120 in steps of 10']); exit;
}
echo json_encode(['success' => true, 'desired' => TankDrain::desired()]);
