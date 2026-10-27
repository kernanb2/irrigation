<?php
// Unit E — pondwater pre-filter flush cycle.
// The web UI stores the desired cycle in the settings table; the ESP32 picks it
// up when it reports in (it polls the server — the server can't reach the LAN).
class FilterFlush {
    const UNIT_ID = 5;

    // Both web UI lists run 10–120 in steps of 10
    const MIN_VALUE = 10;
    const MAX_VALUE = 120;
    const STEP      = 10;

    // Unit counts as online if it reported within this many seconds (it reports every 10 s)
    const ONLINE_SEC = 30;

    const DEFAULTS = [
        'filter_cycle_enabled' => 'false',
        'filter_flush_sec'     => '30',
        'filter_wait_min'      => '60',
    ];

    public static function validValue($v): bool {
        return is_int($v) && $v >= self::MIN_VALUE && $v <= self::MAX_VALUE && $v % self::STEP === 0;
    }

    public static function desired(): array {
        $rows = Database::get()->query("
            SELECT key_name, value FROM settings
            WHERE key_name IN ('filter_cycle_enabled', 'filter_flush_sec', 'filter_wait_min')
        ")->fetchAll(PDO::FETCH_KEY_PAIR);
        $s = array_merge(self::DEFAULTS, $rows);

        return [
            'cycle_enabled' => $s['filter_cycle_enabled'] === 'true',
            'flush_sec'     => (int)$s['filter_flush_sec'],
            'wait_min'      => (int)$s['filter_wait_min'],
        ];
    }

    public static function setDesired(array $changes): void {
        $stmt = Database::get()->prepare("
            INSERT INTO settings (key_name, value) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ");
        if (array_key_exists('cycle_enabled', $changes)) {
            $stmt->execute(['filter_cycle_enabled', $changes['cycle_enabled'] ? 'true' : 'false']);
        }
        if (array_key_exists('flush_sec', $changes)) {
            $stmt->execute(['filter_flush_sec', (string)$changes['flush_sec']]);
        }
        if (array_key_exists('wait_min', $changes)) {
            $stmt->execute(['filter_wait_min', (string)$changes['wait_min']]);
        }
    }
}
