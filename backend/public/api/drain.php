<?php
// Web UI — move the Unit E Pond Drain (status comes from api/filter.php)
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/PondDrain.php';
require_once __DIR__ . '/../../src/PondFill.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Method not allowed']); exit;
}

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$target = $body['target_pct'] ?? null;

if (!PondDrain::validTarget($target)) {
    echo json_encode(['error' => 'target_pct must be 0–100 in steps of 10']); exit;
}

// A Pond Drain button ends a Pond Fill run (the unit opens Pond Fill first, then moves the drain)
if (PondFill::desired()['active']) {
    PondFill::command(null);
}
PondDrain::setTarget($target);
echo json_encode(['success' => true, 'desired' => PondDrain::desired()]);
