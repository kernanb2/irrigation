<?php
// Called by ESP-32 units every 60 seconds — API key auth, no session required
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
     echo json_encode(['error' => 'Method not allowed']); exit;
}

if (!Auth::checkApiKey()) {
     echo json_encode(['error' => 'Unauthorized']); exit;
}

$body   = json_decode(file_get_contents('php://input'), true);
$unitId = (int)($body['unit_id'] ?? 0);

if ($unitId < 1 || $unitId > 3) {
     echo json_encode(['error' => 'Invalid unit_id']); exit;
}

$db = Database::get();

// Update unit last_seen and IP — use IP from payload (REMOTE_ADDR is Cloudflare's proxy)
$ip = $body['ip'] ?? '';
if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
    // Accept private IPs too (ESP-32 is on LAN) — just reject empty/loopback
    $ip = filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '';
}
if ($ip) {
    $db->prepare("UPDATE units SET last_seen = NOW(), ip_address = ? WHERE id = ?")
       ->execute([$ip, $unitId]);
} else {
    $db->prepare("UPDATE units SET last_seen = NOW() WHERE id = ?")
       ->execute([$unitId]);
}

// Store moisture readings
if (!empty($body['moisture']) && is_array($body['moisture'])) {
    $stmt = $db->prepare("
        SELECT id FROM zones WHERE unit_id = ? AND local_index = ? LIMIT 1
    ");
    $calStmt = $db->prepare("
        SELECT dry_value, wet_value FROM sensor_calibration WHERE zone_id = ?
    ");
    $insertStmt = $db->prepare("
        INSERT INTO moisture_readings (zone_id, raw_value, moisture_pct) VALUES (?, ?, ?)
    ");

    foreach ($body['moisture'] as $m) {
        $stmt->execute([$unitId, (int)$m['zone_index']]);
        $zone = $stmt->fetch();
        if (!$zone) continue;

        $raw = (int)$m['raw'];
        $calStmt->execute([$zone['id']]);
        $cal = $calStmt->fetch();

        $pct = null;
        if ($cal) {
            $pct = (int)round(($cal['dry_value'] - $raw) / ($cal['dry_value'] - $cal['wet_value']) * 100);
            $pct = max(0, min(100, $pct));
        }

        $insertStmt->execute([$zone['id'], $raw, $pct]);
    }
}

// Store temperature reading
if (isset($body['temp_c']) && is_numeric($body['temp_c'])) {
    $addr = $body['sensor_addr'] ?? 'unknown';
    $db->prepare("INSERT INTO temperature_readings (unit_id, sensor_addr, temp_c) VALUES (?, ?, ?)")
       ->execute([$unitId, $addr, (float)$body['temp_c']]);
}

echo json_encode(['success' => true]);
