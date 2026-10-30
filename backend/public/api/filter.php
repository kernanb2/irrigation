<?php
// Web UI — read Unit E status (flush cycles, Pond Drain, Pond Fill) or change the flush cycles
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/FilterFlush.php';
require_once __DIR__ . '/../../src/PondDrain.php';
require_once __DIR__ . '/../../src/PondFill.php';

Auth::require();
header('Content-Type: application/json');

$db = Database::get();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $filter  = $body['filter'] ?? null;
    $changes = [];

    if (!FilterFlush::validFilter($filter)) {
        echo json_encode(['error' => 'Invalid filter']); exit;
    }
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

    FilterFlush::setDesired($filter, $changes);
    echo json_encode(['success' => true]);
    exit;
}

$unit = $db->prepare("
    SELECT last_seen, TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS seen_ago
    FROM units WHERE id = ?
");
$unit->execute([FilterFlush::UNIT_ID]);
$u = $unit->fetch();

$names = $db->query("
    SELECT id, name FROM zones WHERE id IN (" . implode(',', FilterFlush::ZONE_IDS) . ")
")->fetchAll(PDO::FETCH_KEY_PAIR);

$report      = $db->query("SELECT value FROM settings WHERE key_name = 'filter_last_report'")->fetchColumn();
$reportData  = $report ? json_decode($report, true) : [];
$reported    = $reportData['filters'] ?? [];

$filters = [];
foreach (FilterFlush::desiredAll() as $n => $desired) {
    $filters[] = [
        'filter'   => $n,
        'name'     => $names[FilterFlush::ZONE_IDS[$n]] ?? "Filter $n",
        'desired'  => $desired,
        'reported' => $reported[$n - 1] ?? null,
    ];
}

echo json_encode([
    'filters'   => $filters,
    'drain'     => ['desired' => PondDrain::desired(), 'reported' => $reportData['drain'] ?? null],
    'fill'      => ['desired' => PondFill::desired(),  'reported' => $reportData['fill'] ?? null],
    'online'    => $u && $u['seen_ago'] !== null && (int)$u['seen_ago'] < FilterFlush::ONLINE_SEC,
    'last_seen' => $u['last_seen'] ?? null,
]);
