<?php
// Called by Unit E every 10 seconds — API key auth, no session required.
// Stores the unit's status and replies with the desired flush cycle.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/FilterFlush.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
     echo json_encode(['error' => 'Method not allowed']); exit;
}

$device = Auth::apiDevice();
if (!$device || $device['unit_id'] !== FilterFlush::UNIT_ID) {
     echo json_encode(['error' => 'Unauthorized']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$db   = Database::get();

// Use IP from payload (REMOTE_ADDR is Cloudflare's proxy)
$ip = filter_var($body['ip'] ?? '', FILTER_VALIDATE_IP) ?: null;
$db->prepare("UPDATE units SET last_seen = NOW(), ip_address = COALESCE(?, ip_address) WHERE id = ?")
   ->execute([$ip, FilterFlush::UNIT_ID]);

$report = [
    'valve'             => ($body['valve'] ?? '') === 'open' ? 'open' : 'closed',
    'flush_remaining_s' => (int)($body['flush_remaining_s'] ?? 0),
    'cycle_enabled'     => (bool)($body['cycle_enabled'] ?? false),
    'flush_sec'         => (int)($body['flush_sec'] ?? 0),
    'wait_min'          => (int)($body['wait_min'] ?? 0),
    'next_flush_in_s'   => isset($body['next_flush_in_s']) ? (int)$body['next_flush_in_s'] : null,
    'uptime_s'          => (int)($body['uptime_s'] ?? 0),
];
$db->prepare("
    INSERT INTO settings (key_name, value) VALUES ('filter_last_report', ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)
")->execute([json_encode($report)]);

echo json_encode(FilterFlush::desired());
