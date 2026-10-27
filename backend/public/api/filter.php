<?php
// Web UI — read or change the Unit E pre-filter flush cycle
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/FilterFlush.php';

Auth::require();
header('Content-Type: application/json');

$db = Database::get();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $changes = [];

    if (array_key_exists('cycle_enabled', $body)) {
        $changes['cycle_enabled'] = (bool)$body['cycle_enabled'];
    }
    foreach (['flush_sec', 'wait_min'] as $k) {
        if (!array_key_exists($k, $body)) continue;
        if (!FilterFlush::validValue($body[$k])) {
            echo json_encode(['error' => "$k must be 10–120 in steps of 10"]); exit;
        }
        $changes[$k] = $body[$k];
    }
    if (!$changes) {
        echo json_encode(['error' => 'Nothing to change']); exit;
    }

    FilterFlush::setDesired($changes);
    echo json_encode(['success' => true, 'desired' => FilterFlush::desired()]);
    exit;
}

$unit = $db->prepare("
    SELECT last_seen, TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS seen_ago
    FROM units WHERE id = ?
");
$unit->execute([FilterFlush::UNIT_ID]);
$u = $unit->fetch();

$report = $db->query("SELECT value FROM settings WHERE key_name = 'filter_last_report'")->fetchColumn();

echo json_encode([
    'desired'   => FilterFlush::desired(),
    'reported'  => $report ? json_decode($report, true) : null,
    'online'    => $u && $u['seen_ago'] !== null && (int)$u['seen_ago'] < FilterFlush::ONLINE_SEC,
    'last_seen' => $u['last_seen'] ?? null,
]);
