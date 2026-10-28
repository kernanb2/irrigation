<?php
// Zone units A–C (unit ids 1–3). The server can't reach the boards, so each board
// checks in every few seconds (api/unit_report.php) and the reply carries the
// desired state of its five valves. An open valve always has an end time
// (desired_until); the board closes it itself when that passes, even offline.
class ZoneUnit {
    const UNIT_IDS   = [1, 2, 3];
    const NUM_ZONES  = 5;
    const ONLINE_SEC = 30;   // boards check in every 5 s
    // Capacitive sensors read ~1300 (wet) to ~3300 (dry). An unconnected input reads
    // near 0, which would look like soaking wet — store the raw value but no percentage.
    const MIN_SENSOR_RAW = 1000;

    // Longest a valve may be open in one go (settings.max_zone_duration_sec, capped by config)
    public static function maxDuration(): int {
        $v = (int)Database::get()->query("SELECT value FROM settings WHERE key_name = 'max_zone_duration_sec'")->fetchColumn();
        return $v > 0 ? min($v, MAX_ZONE_DURATION_SEC) : MAX_ZONE_DURATION_SEC;
    }

    public static function isOnline(int $unitId): bool {
        $stmt = Database::get()->prepare("SELECT TIMESTAMPDIFF(SECOND, last_seen, NOW()) FROM units WHERE id = ?");
        $stmt->execute([$unitId]);
        $ago = $stmt->fetchColumn();
        return $ago !== false && $ago !== null && (int)$ago < self::ONLINE_SEC;
    }

    // Ask for a valve to open (for $durationSec) or close. The unit applies it on its next check-in.
    public static function requestValve(int $zoneId, bool $open, string $trigger, string $by, int $durationSec = 0): void {
        if ($open) {
            $durationSec = max(1, min($durationSec ?: self::maxDuration(), self::maxDuration()));
            Database::get()->prepare("
                UPDATE zones SET desired_state = 'open', desired_until = NOW() + INTERVAL ? SECOND,
                                 desired_trigger = ?, desired_by = ?
                WHERE id = ?
            ")->execute([$durationSec, $trigger, $by, $zoneId]);
        } else {
            Database::get()->prepare("
                UPDATE zones SET desired_state = 'closed', desired_until = NULL,
                                 desired_trigger = ?, desired_by = ?
                WHERE id = ?
            ")->execute([$trigger, $by, $zoneId]);
        }
    }

    // Reply for a unit: one entry per local index, open ones with seconds left to run
    public static function desired(int $unitId): array {
        $db = Database::get();
        // Runs whose time is up count as closed from now on
        $db->prepare("
            UPDATE zones SET desired_state = 'closed', desired_until = NULL
            WHERE unit_id = ? AND desired_state = 'open' AND desired_until <= NOW()
        ")->execute([$unitId]);

        $stmt = $db->prepare("
            SELECT local_index, desired_state, enabled,
                   GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), desired_until)) AS run_s
            FROM zones WHERE unit_id = ?
        ");
        $stmt->execute([$unitId]);

        $out = array_fill(0, self::NUM_ZONES, ['open' => false, 'run_s' => 0]);
        foreach ($stmt as $r) {
            $i = (int)$r['local_index'];
            if ($i >= self::NUM_ZONES) continue;
            $open    = $r['desired_state'] === 'open' && $r['enabled'] && (int)$r['run_s'] > 0;
            $out[$i] = ['open' => $open, 'run_s' => $open ? (int)$r['run_s'] : 0];
        }
        return $out;
    }

    // Check-in from a unit: valve states, queued events, and (once a minute) sensor readings
    public static function applyReport(int $unitId, array $body): void {
        $db = Database::get();

        $ip = filter_var($body['ip'] ?? '', FILTER_VALIDATE_IP) ?: null;
        $db->prepare("UPDATE units SET last_seen = NOW(), ip_address = COALESCE(?, ip_address) WHERE id = ?")
           ->execute([$ip, $unitId]);

        $valves    = [];
        $stateStmt = $db->prepare("
            UPDATE zones SET valve_state = ?, last_state_change = IF(valve_state = ?, last_state_change, NOW())
            WHERE unit_id = ? AND local_index = ?
        ");
        foreach (array_slice($body['valves'] ?? [], 0, self::NUM_ZONES) as $i => $v) {
            if (!is_array($v)) continue;
            $state    = ($v['open'] ?? false) ? 'open' : 'closed';
            $valves[] = ['open' => $state === 'open', 'remaining_s' => max(0, (int)($v['remaining_s'] ?? 0))];
            $stateStmt->execute([$state, $state, $unitId, $i]);
        }

        $report = json_encode(['valves' => $valves, 'uptime_s' => (int)($body['uptime_s'] ?? 0)]);
        $db->prepare("
            INSERT INTO unit_status (unit_id, report) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE report = VALUES(report)
        ")->execute([$unitId, $report]);

        // Logging and sensor storage must never block the reply — the unit needs it
        try {
            if (!empty($body['events']) && is_array($body['events'])) {
                self::logEvents($unitId, $body['events'], (string)($body['boot_id'] ?? ''));
            }
            if (is_array($body['sensors'] ?? null)) {
                self::storeSensors($unitId, $body['sensors']);
            }
        } catch (Throwable $e) {
            error_log("Unit $unitId report storage failed: " . $e->getMessage());
        }
    }

    // Events carry boot_id + seq so a report sent twice isn't logged twice.
    // reason: server = applied the web page / schedule request, timer = run time ended
    // on the board, restart = closed at power-up.
    private static function logEvents(int $unitId, array $events, string $bootId): void {
        $db   = Database::get();
        $stmt = $db->prepare("SELECT boot_id, event_seq FROM unit_status WHERE unit_id = ?");
        $stmt->execute([$unitId]);
        $cur     = $stmt->fetch();
        $lastSeq = $cur && $cur['boot_id'] === $bootId ? (int)$cur['event_seq'] : -1;

        $zoneStmt = $db->prepare("SELECT id, desired_trigger, desired_by FROM zones WHERE unit_id = ? AND local_index = ?");
        $insert   = $db->prepare("
            INSERT INTO valve_events (zone_id, action, trigger_type, initiated_by, executed_at, notes)
            VALUES (?, ?, ?, ?, NOW() - INTERVAL ? SECOND, ?)
        ");
        $unitName = 'Unit ' . chr(64 + $unitId);

        foreach ($events as $ev) {
            $seq = (int)($ev['seq'] ?? -1);
            if ($seq <= $lastSeq) continue;
            $zoneStmt->execute([$unitId, (int)($ev['zone'] ?? -1)]);
            $z = $zoneStmt->fetch();
            if (!$z) { $lastSeq = $seq; continue; }

            $reason = $ev['reason'] ?? 'server';
            $notes  = ['server' => null, 'timer' => 'run time ended', 'restart' => 'closed after restart'];
            $note   = array_key_exists($reason, $notes) ? $notes[$reason] : $reason;
            $insert->execute([
                $z['id'],
                ($ev['action'] ?? '') === 'open' ? 'open' : 'close',
                $reason === 'restart' ? 'manual' : $z['desired_trigger'],
                $reason === 'server' && $z['desired_by'] ? $z['desired_by'] : $unitName,
                max(0, (int)($ev['ago_s'] ?? 0)),
                $note,
            ]);
            $lastSeq = $seq;
        }

        $db->prepare("UPDATE unit_status SET boot_id = ?, event_seq = ? WHERE unit_id = ?")
           ->execute([$bootId, max(0, $lastSeq), $unitId]);
    }

    // moisture: raw ADC per local index (0–4095); temp_c from the DS18B20 (-127 = not connected).
    // Readings below MIN_SENSOR_RAW are kept with moisture_pct NULL ("No sensor data").
    private static function storeSensors(int $unitId, array $s): void {
        $db = Database::get();

        $zoneStmt = $db->prepare("
            SELECT z.id, sc.dry_value, sc.wet_value FROM zones z
            LEFT JOIN sensor_calibration sc ON sc.zone_id = z.id
            WHERE z.unit_id = ? AND z.local_index = ?
        ");
        $insert = $db->prepare("INSERT INTO moisture_readings (zone_id, raw_value, moisture_pct) VALUES (?, ?, ?)");
        foreach (array_slice($s['moisture'] ?? [], 0, self::NUM_ZONES) as $i => $raw) {
            if (!is_numeric($raw)) continue;
            $zoneStmt->execute([$unitId, $i]);
            $z = $zoneStmt->fetch();
            if (!$z) continue;

            $pct = null;
            if ($raw >= self::MIN_SENSOR_RAW && $z['dry_value'] !== null && $z['dry_value'] != $z['wet_value']) {
                $pct = (int)round(($z['dry_value'] - $raw) / ($z['dry_value'] - $z['wet_value']) * 100);
                $pct = max(0, min(100, $pct));
            }
            $insert->execute([$z['id'], (int)$raw, $pct]);
        }

        if (isset($s['temp_c']) && is_numeric($s['temp_c']) && $s['temp_c'] > -100) {
            $db->prepare("INSERT INTO temperature_readings (unit_id, sensor_addr, temp_c) VALUES (?, ?, ?)")
               ->execute([$unitId, $s['sensor_addr'] ?? 'unknown', (float)$s['temp_c']]);
        }
    }
}
