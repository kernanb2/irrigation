<?php
// Web UI — Unit D pond level. GET ?days=1|7|30 returns the current level, the graph's
// readings (30-minute for 1 day, daily averages for 7 and 30) and the 7-day trend;
// POST {"action": "set_normal"} makes the latest reading the pond's normal level.
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

// 24 hours: every 30-minute reading (the graph draws the held 3-hour average).
// 7 and 30 days: one average per day, so slow changes like evaporation show.
echo json_encode([
    'pond'     => PondLevel::summary(),
    'days'     => $days,
    'readings' => $days === 1 ? PondLevel::history(1) : [],
    'daily'    => $days === 1 ? [] : PondLevel::daily($days),
    'trend'    => PondLevel::trend(),
]);
