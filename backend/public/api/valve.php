<?php
// Web UI — open or close a zone valve (Units A–C). The request is stored and the
// unit applies it on its next check-in (within ~5 s); the event log entry is
// written when the unit reports the valve actually moved.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/ZoneUnit.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body     = json_decode(file_get_contents('php://input'), true);
$zoneId   = (int)($body['zone_id'] ?? 0);
$open     = (bool)($body['open']    ?? false);
$duration = (int)($body['duration_sec'] ?? 0);   // 0 = the maximum (max_zone_duration_sec)

if ($zoneId < 1 || $zoneId > 15) {
    echo json_encode(['error' => 'Invalid zone_id']);
    exit;
}

$db   = Database::get();
$zone = $db->prepare('SELECT id, unit_id, name, is_special FROM zones WHERE id = ? AND enabled = 1');
$zone->execute([$zoneId]);
$z = $zone->fetch();

if (!$z) {
    echo json_encode(['error' => 'Zone not found or disabled']);
    exit;
}

if (!ZoneUnit::isOnline((int)$z['unit_id'])) {
    echo json_encode(['error' => 'Unit ' . chr(64 + $z['unit_id']) . ' is offline']);
    exit;
}

// Interlock: no two special zones open at once (or about to open). Since zone 6
// became a regular zone, Creek Source (zone 1) is the only special zone.
if ($open && $z['is_special']) {
    $setting = $db->query("SELECT value FROM settings WHERE key_name = 'creek_pond_interlock'")->fetchColumn();
    if ($setting === 'true') {
        $other = $db->prepare("
            SELECT id FROM zones
            WHERE is_special = 1 AND id != ? AND id <= 15
              AND (valve_state = 'open' OR (desired_state = 'open' AND desired_until > NOW()))
        ");
        $other->execute([$z['id']]);
        if ($other->fetch()) {
            echo json_encode(['error' => 'Interlock: another special valve is already open']);
            exit;
        }
    }
}

ZoneUnit::requestValve($zoneId, $open, 'manual', Auth::user(), $duration);
echo json_encode(['success' => true, 'zone_id' => $zoneId, 'desired' => $open ? 'open' : 'closed']);
