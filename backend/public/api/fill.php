<?php
// Web UI — start a Unit E Pond Fill run ({"hours": 1–24}) or stop it ({"stop": true}).
// Status comes from api/filter.php.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/PondFill.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Method not allowed']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];

if (!empty($body['stop'])) {
    PondFill::command(null);
} elseif (PondFill::validHours($body['hours'] ?? null)) {
    PondFill::command($body['hours']);
} else {
    echo json_encode(['error' => 'hours must be 1–24']); exit;
}
echo json_encode(['success' => true, 'desired' => PondFill::desired()]);
