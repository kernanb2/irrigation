<?php
// Unit E — Storage Tank Drain. A 1" valve near the bottom of the storage tank, normally
// closed. A run (10–120 min) has the unit open the Pond Drain fully and close Pond Fill,
// so no spring water reaches the tank, then open this valve. Like Pond Fill, each command
// bumps a counter and the unit applies it only when the counter changes, so a reboot
// (which closes the valve and ends any run) never replays one.
class TankDrain {
    const ZONE_ID     = 20;
    const MIN_MINUTES = 10;
    const MAX_MINUTES = 120;
    const STEP        = 10;

    public static function validMinutes($v): bool {
        return is_int($v) && $v >= self::MIN_MINUTES && $v <= self::MAX_MINUTES && $v % self::STEP === 0;
    }

    public static function desired(): array {
        $rows = Database::get()->query("
            SELECT key_name, value FROM settings
            WHERE key_name IN ('tank_drain_minutes', 'tank_drain_active', 'tank_drain_cmd_seq')
        ")->fetchAll(PDO::FETCH_KEY_PAIR);

        $minutes = (int)($rows['tank_drain_minutes'] ?? 30);
        return [
            'active'  => ($rows['tank_drain_active'] ?? 'false') === 'true',
            'minutes' => self::validMinutes($minutes) ? $minutes : 30,
            'seq'     => (int)($rows['tank_drain_cmd_seq'] ?? 0),
        ];
    }

    // Start a run of $minutes, or stop the current one ($minutes = null)
    public static function command(?int $minutes): void {
        $db   = Database::get();
        $stmt = $db->prepare("
            INSERT INTO settings (key_name, value) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ");
        $db->beginTransaction();
        $stmt->execute(['tank_drain_active', $minutes === null ? 'false' : 'true']);
        if ($minutes !== null) $stmt->execute(['tank_drain_minutes', (string)$minutes]);
        $db->exec("
            INSERT INTO settings (key_name, value) VALUES ('tank_drain_cmd_seq', '1')
            ON DUPLICATE KEY UPDATE value = CAST(value AS UNSIGNED) + 1
        ");
        $db->commit();
    }

    // The unit ended the run itself (time up, or a restart) — stop showing it as wanted
    public static function runEnded(array $reported): void {
        $want = self::desired();
        if ($want['active'] && empty($reported['active']) && (int)($reported['seq'] ?? -1) === $want['seq']) {
            Database::get()->exec("UPDATE settings SET value = 'false' WHERE key_name = 'tank_drain_active'");
        }
    }
}
