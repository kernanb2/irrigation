<?php
// Called by zone Units A–C every 5 seconds — API key auth, no session required.
// Stores valve states, events and sensor readings, and replies with the desired
// valve states: {"zones": [{"open": bool, "run_s": seconds left}, ×5]}.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/ZoneUnit.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
     echo json_encode(['error' => 'Method not allowed']); exit;
}

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$unitId = (int)($body['unit_id'] ?? 0);

// Each key may only report for its own unit
$device = Auth::apiDevice();
if (!$device || !in_array($unitId, ZoneUnit::UNIT_IDS, true) || $device['unit_id'] !== $unitId) {
     echo json_encode(['error' => 'Unauthorized']); exit;
}

ZoneUnit::applyReport($unitId, $body);
echo json_encode(['zones' => ZoneUnit::desired($unitId)]);
