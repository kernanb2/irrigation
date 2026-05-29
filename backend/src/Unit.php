<?php
class Unit {
    // Send a valve command to an ESP-32 unit
    public static function valveCommand(int $unitId, int $localZoneIndex, bool $open): array {
        $db   = Database::get();
        $unit = $db->prepare('SELECT ip_address FROM units WHERE id = ?');
        $unit->execute([$unitId]);
        $row  = $unit->fetch();

        if (!$row || !$row['ip_address']) {
            return ['success' => false, 'error' => 'Unit not found or no IP'];
        }

        $payload = json_encode(['zone' => $localZoneIndex, 'open' => $open]);
        $url     = "http://{$row['ip_address']}/valve";

        $ctx = stream_context_create(['http' => [
            'method'  => 'POST',
            'header'  => "Content-Type: application/json\r\nContent-Length: " . strlen($payload),
            'content' => $payload,
            'timeout' => 5,
        ]]);

        $result = @file_get_contents($url, false, $ctx);

        if ($result === false) {
            return ['success' => false, 'error' => 'Could not reach unit'];
        }

        $response = json_decode($result, true);
        return ['success' => true, 'response' => $response];
    }

    // Fetch live status from an ESP-32 unit
    public static function fetchStatus(int $unitId): ?array {
        $db   = Database::get();
        $stmt = $db->prepare('SELECT ip_address FROM units WHERE id = ?');
        $stmt->execute([$unitId]);
        $row  = $stmt->fetch();

        if (!$row || !$row['ip_address']) return null;

        $url = "http://{$row['ip_address']}/status";
        $ctx = stream_context_create(['http' => ['timeout' => 3]]);
        $result = @file_get_contents($url, false, $ctx);

        return $result ? json_decode($result, true) : null;
    }
}
