<?php
// Web UI — Automation panel. GET: the rules with their choices and what they're doing.
// POST {"kind": "pond_level", "enabled": bool, "config": {...}} or
// {"kind": "timed_runs", "runs": [...]}: save and run straight away.
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/ZoneUnit.php';
require_once __DIR__ . '/../../src/PondLevel.php';
require_once __DIR__ . '/../../src/PondFill.php';
require_once __DIR__ . '/../../src/PondDrain.php';
require_once __DIR__ . '/../../src/PondAutomation.php';
require_once __DIR__ . '/../../src/TimedRuns.php';

Auth::require();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $kind = $body['kind'] ?? '';
    if ($kind === PondAutomation::KIND) {
        $err = PondAutomation::save(!empty($body['enabled']), (array)($body['config'] ?? []));
        if ($err) { echo json_encode(['error' => $err]); exit; }
        PondAutomation::evaluate();
    } elseif ($kind === TimedRuns::KIND) {
        $err = TimedRuns::save((array)($body['runs'] ?? []));
        if ($err) { echo json_encode(['error' => $err]); exit; }
        TimedRuns::evaluate();
    } else {
        echo json_encode(['error' => 'Unknown rule']); exit;
    }
} elseif ($method !== 'GET') {
    echo json_encode(['error' => 'Method not allowed']); exit;
}

echo json_encode(['pond_level' => PondAutomation::status(), 'timed_runs' => TimedRuns::status()]);
