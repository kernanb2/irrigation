<?php
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Auth.php';

Auth::require();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$body  = json_decode(file_get_contents('php://input'), true);
$key   = preg_replace('/[^a-z0-9_]/', '', $body['key']   ?? '');
$value = $body['value'] ?? '';

if (!$key) { http_response_code(400); echo json_encode(['error' => 'Invalid key']); exit; }

Database::get()->prepare("
    INSERT INTO settings (key_name, value) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)
")->execute([$key, $value]);

echo json_encode(['success' => true]);
