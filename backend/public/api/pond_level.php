<?php
// Web UI — Unit D pond level. GET ?days=1|7|30 returns the current level and the
// 30-minute readings for the graph; POST {"action": "set_normal"} makes the latest
// reading the pond's normal level.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/ZoneUnit.php';
require_once __DIR__ . '/../../src/PondLevel.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    if (($body['action'] ?? '') !== 'set_normal') {
        echo json_encode(['error' => 'Unknown action']); exit;
    }
    $cur = PondLevel::current();
    if ($cur['distance_mm'] === null || !ZoneUnit::isOnline(PondLevel::UNIT_ID)) {
        echo json_encode(['error' => 'No current pond reading — is Unit D online?']); exit;
    }
    PondLevel::setNormal($cur['distance_mm']);
    echo json_encode(['success' => true, 'pond' => PondLevel::summary()]);
    exit;
}

$days = (int)($_GET['days'] ?? 7);
if (!in_array($days, [1, 7, 30], true)) $days = 7;

echo json_encode([
    'pond'     => PondLevel::summary(),
    'days'     => $days,
    'readings' => PondLevel::history($days),
]);
