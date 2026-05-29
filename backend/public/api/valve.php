<?php
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/Unit.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$zoneId = (int)($body['zone_id'] ?? 0);
$open   = (bool)($body['open']    ?? false);

if ($zoneId < 1 || $zoneId > 15) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid zone_id']);
    exit;
}

$db   = Database::get();
$zone = $db->prepare('SELECT id, unit_id, local_index, name, is_special FROM zones WHERE id = ? AND enabled = 1');
$zone->execute([$zoneId]);
$z = $zone->fetch();

if (!$z) {
    http_response_code(404);
    echo json_encode(['error' => 'Zone not found or disabled']);
    exit;
}

// Interlock: creek (zone 1) and pond (zone 6) cannot both be open
if ($open && $z['is_special']) {
    $setting = $db->query("SELECT value FROM settings WHERE key_name = 'creek_pond_interlock'")->fetchColumn();
    if ($setting === 'true') {
        $otherSpecial = $db->query("
            SELECT id, valve_state FROM zones WHERE is_special = 1 AND id != {$z['id']} AND valve_state = 'open'
        ")->fetch();
        if ($otherSpecial) {
            http_response_code(409);
            echo json_encode(['error' => 'Interlock: another special valve is already open']);
            exit;
        }
    }
}

$result = Unit::valveCommand($z['unit_id'], $z['local_index'], $open);

if (!$result['success']) {
    http_response_code(502);
    echo json_encode(['error' => $result['error']]);
    exit;
}

// Update state in DB
$newState = $open ? 'open' : 'closed';
$db->prepare("UPDATE zones SET valve_state = ?, last_state_change = NOW() WHERE id = ?")
   ->execute([$newState, $zoneId]);

$db->prepare("INSERT INTO valve_events (zone_id, action, trigger, initiated_by) VALUES (?, ?, 'manual', ?)")
   ->execute([$zoneId, $open ? 'open' : 'close', Auth::user()]);

echo json_encode(['success' => true, 'zone_id' => $zoneId, 'state' => $newState]);
