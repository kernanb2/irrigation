<?php
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';

Auth::require();
header('Content-Type: application/json');

$db     = Database::get();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $rows = $db->query("
        SELECT s.*, z.name AS zone_name
        FROM schedules s JOIN zones z ON z.id = s.zone_id
        ORDER BY s.zone_id, s.id
    ")->fetchAll();
    echo json_encode($rows);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);

if ($method === 'POST') {
    $zoneId      = (int)($body['zone_id']       ?? 0);
    $name        = trim($body['name']            ?? '');
    $cron        = trim($body['cron_expression'] ?? '');
    $duration    = (int)($body['duration_sec']   ?? 0);
    $skipMoist   = (bool)($body['skip_if_moist'] ?? true);
    $skipThresh  = (int)($body['skip_threshold'] ?? 60);

    if ($zoneId < 1 || !$cron || $duration < 1 || $duration > MAX_ZONE_DURATION_SEC) {
        
        echo json_encode(['error' => 'Invalid schedule parameters']);
        exit;
    }

    $db->prepare("
        INSERT INTO schedules (zone_id, name, cron_expression, duration_sec, skip_if_moist, skip_threshold)
        VALUES (?, ?, ?, ?, ?, ?)
    ")->execute([$zoneId, $name, $cron, $duration, $skipMoist, $skipThresh]);

    echo json_encode(['success' => true, 'id' => $db->lastInsertId()]);
    exit;
}

if ($method === 'DELETE') {
    $id = (int)($body['id'] ?? 0);
    if ($id < 1) {  echo json_encode(['error' => 'Invalid id']); exit; }
    $db->prepare("DELETE FROM schedules WHERE id = ?")->execute([$id]);
    echo json_encode(['success' => true]);
    exit;
}

if ($method === 'PATCH') {
    $id      = (int)($body['id']      ?? 0);
    $enabled = (bool)($body['enabled'] ?? false);
    if ($id < 1) {  echo json_encode(['error' => 'Invalid id']); exit; }
    $db->prepare("UPDATE schedules SET enabled = ? WHERE id = ?")->execute([$enabled, $id]);
    echo json_encode(['success' => true]);
    exit;
}


echo json_encode(['error' => 'Method not allowed']);
