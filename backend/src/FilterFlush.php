<?php
// Unit E — pondwater pre-filter flush cycles (two valves, numbered 1 and 2).
// The web UI stores each filter's desired cycle in the settings table; the ESP32
// picks it up when it reports in (it polls the server — the server can't reach the LAN).
class FilterFlush {
    const UNIT_ID = 5;

    // Filter number => zones row used for valve_events and valve_state
    const ZONE_IDS = [1 => 16, 2 => 17];

    // Device number in reported events => zones row (3 = Pond Drain)
    const EVENT_ZONE_IDS = [1 => 16, 2 => 17, 3 => 18];

    // Both web UI lists run 10–120 in steps of 10
    const MIN_VALUE = 10;
    const MAX_VALUE = 120;
    const STEP      = 10;

    // Unit counts as online if it reported within this many seconds (it reports every 2 s)
    const ONLINE_SEC = 30;

    const DEFAULTS = ['cycle_enabled' => 'false', 'flush_sec' => '30', 'wait_min' => '60'];

    public static function validFilter($n): bool {
        return is_int($n) && isset(self::ZONE_IDS[$n]);
    }

    public static function validValue($v): bool {
        return is_int($v) && $v >= self::MIN_VALUE && $v <= self::MAX_VALUE && $v % self::STEP === 0;
    }

    // Desired cycle for every filter, keyed by filter number
    public static function desiredAll(): array {
        $rows = Database::get()->query("
            SELECT key_name, value FROM settings WHERE key_name LIKE 'filter%'
        ")->fetchAll(PDO::FETCH_KEY_PAIR);

        $all = [];
        foreach (array_keys(self::ZONE_IDS) as $n) {
            $s = [];
            foreach (self::DEFAULTS as $k => $default) {
                $s[$k] = $rows["filter{$n}_{$k}"] ?? $default;
            }
            $all[$n] = [
                'cycle_enabled' => $s['cycle_enabled'] === 'true',
                'flush_sec'     => (int)$s['flush_sec'],
                'wait_min'      => (int)$s['wait_min'],
            ];
        }
        return $all;
    }

    public static function setDesired(int $n, array $changes): void {
        $stmt = Database::get()->prepare("
            INSERT INTO settings (key_name, value) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ");
        if (array_key_exists('cycle_enabled', $changes)) {
            $stmt->execute(["filter{$n}_cycle_enabled", $changes['cycle_enabled'] ? 'true' : 'false']);
        }
        foreach (['flush_sec', 'wait_min'] as $k) {
            if (array_key_exists($k, $changes)) {
                $stmt->execute(["filter{$n}_{$k}", (string)$changes[$k]]);
            }
        }
    }

    // Store valve events reported by the unit (filters 1–2 and device 3, the Pond Drain). Each report repeats unacknowledged
    // events, so skip any seq already stored for this boot of the ESP32.
    public static function logEvents(array $events, string $bootId): void {
        $db     = Database::get();
        $cursor = $db->query("SELECT value FROM settings WHERE key_name = 'filter_event_cursor'")->fetchColumn();
        [$lastBoot, $lastSeq] = $cursor ? explode(':', $cursor) + [1 => 0] : ['', 0];
        $lastSeq = $lastBoot === $bootId ? (int)$lastSeq : -1;

        $notes = [
            'cycle'   => 'flush cycle',
            'stop'    => 'cycle stopped',
            'manual'  => 'local LAN command',
            'web'     => 'web page',
            'restart'   => 'closed after restart',
            'tank_full' => 'tank full',
            'tank_low'  => 'tank below refill sensor',
        ];
        $insert = $db->prepare("
            INSERT INTO valve_events (zone_id, action, trigger_type, initiated_by, executed_at, notes)
            VALUES (?, ?, ?, 'Unit E', NOW() - INTERVAL ? SECOND, ?)
        ");

        foreach ($events as $ev) {
            $seq = (int)($ev['seq'] ?? -1);
            $n   = (int)($ev['filter'] ?? 0);
            if ($seq <= $lastSeq || !isset(self::EVENT_ZONE_IDS[$n])) continue;

            $reason = $ev['reason'] ?? 'manual';
            $note   = $notes[$reason] ?? $reason;
            // Drain moves to a partial position carry the target
            if (isset($ev['pct']) && $ev['pct'] > 0 && $ev['pct'] < 100) {
                $note .= " — {$ev['pct']}% open";
            }
            $insert->execute([
                self::EVENT_ZONE_IDS[$n],
                ($ev['action'] ?? '') === 'open' ? 'open' : 'close',
                in_array($reason, ['cycle', 'tank_full', 'tank_low'], true) ? 'schedule' : 'manual',
                max(0, (int)($ev['ago_s'] ?? 0)),
                $note,
            ]);
            $lastSeq = $seq;
        }

        $db->prepare("
            INSERT INTO settings (key_name, value) VALUES ('filter_event_cursor', ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ")->execute(["$bootId:" . max($lastSeq, 0)]);
    }
}
