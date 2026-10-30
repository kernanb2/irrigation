<?php
// Called by Unit E every 2 seconds — API key auth, no session required.
// Stores the unit's status and valve events, and replies with the desired flush cycles
// and Pond Drain target.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/FilterFlush.php';
require_once __DIR__ . '/../../src/PondDrain.php';

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

// Latest status per filter, and keep zones.valve_state in step with the hardware
$filters    = [];
$stateStmt  = $db->prepare("
    UPDATE zones SET valve_state = ?, last_state_change = IF(valve_state = ?, last_state_change, NOW())
    WHERE id = ?
");
foreach (FilterFlush::ZONE_IDS as $n => $zoneId) {
    $f = $body['filters'][$n - 1] ?? null;
    if (!is_array($f)) { $filters[] = null; continue; }

    $valve = ($f['valve'] ?? '') === 'open' ? 'open' : 'closed';
    $filters[] = [
        'valve'             => $valve,
        'flush_remaining_s' => (int)($f['flush_remaining_s'] ?? 0),
        'cycle_enabled'     => (bool)($f['cycle_enabled'] ?? false),
        'flush_sec'         => (int)($f['flush_sec'] ?? 0),
        'wait_min'          => (int)($f['wait_min'] ?? 0),
        'next_flush_in_s'   => isset($f['next_flush_in_s']) ? (int)$f['next_flush_in_s'] : null,
        'waiting'           => (bool)($f['waiting'] ?? false),   // due, but the other valve is flushing
    ];
    $stateStmt->execute([$valve, $valve, $zoneId]);
}

// Pond Drain status
$drain = null;
if (is_array($body['drain'] ?? null)) {
    $d     = $body['drain'];
    $drain = [
        'position_pct' => max(0, min(100, (int)($d['position_pct'] ?? 0))),
        'target_pct'   => max(0, min(100, (int)($d['target_pct'] ?? 0))),
        'moving'       => (bool)($d['moving'] ?? false),
        'seq'          => (int)($d['seq'] ?? 0),
        'user_pct'     => max(0, min(100, (int)($d['user_pct'] ?? 0))),
        'tank'         => is_array($d['tank'] ?? null) ? [
            'top_wet'    => (bool)($d['tank']['top_wet'] ?? false),
            'refill_wet' => (bool)($d['tank']['refill_wet'] ?? false),
            'full'       => (bool)($d['tank']['full'] ?? false),
            'fault'      => (bool)($d['tank']['fault'] ?? false),
        ] : null,
    ];
    $drainState = $drain['position_pct'] > 0 || $drain['moving'] ? 'open' : 'closed';
    $stateStmt->execute([$drainState, $drainState, PondDrain::ZONE_ID]);
}

$db->prepare("
    INSERT INTO settings (key_name, value) VALUES ('filter_last_report', ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)
")->execute([json_encode(['filters' => $filters, 'drain' => $drain, 'uptime_s' => (int)($body['uptime_s'] ?? 0)])]);

// A logging failure must never block the reply — the unit needs it to get Start/Stop
if (!empty($body['events']) && is_array($body['events'])) {
    try {
        FilterFlush::logEvents($body['events'], (string)($body['boot_id'] ?? ''));
    } catch (Throwable $e) {
        error_log('Unit E event logging failed: ' . $e->getMessage());
    }
}

echo json_encode(['filters' => array_values(FilterFlush::desiredAll()), 'drain' => PondDrain::desired()]);
