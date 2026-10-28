<?php
// Unit E — Pond Drain. The web UI stores a target position and bumps a command
// counter; the ESP32 applies the target when it sees a new counter value. After a
// reboot the unit closes the drain and keeps its last applied counter, so an old
// command is never replayed.
class PondDrain {
    const ZONE_ID = 18;
    const STEP    = 10;   // web UI offers 10%–90% partial positions

    public static function validTarget($v): bool {
        return is_int($v) && $v >= 0 && $v <= 100 && $v % self::STEP === 0;
    }

    public static function desired(): array {
        $rows = Database::get()->query("
            SELECT key_name, value FROM settings WHERE key_name IN ('drain_target_pct', 'drain_cmd_seq')
        ")->fetchAll(PDO::FETCH_KEY_PAIR);

        return [
            'target_pct' => (int)($rows['drain_target_pct'] ?? 0),
            'seq'        => (int)($rows['drain_cmd_seq'] ?? 0),
        ];
    }

    public static function setTarget(int $pct): void {
        $db = Database::get();
        $db->beginTransaction();
        $db->prepare("
            INSERT INTO settings (key_name, value) VALUES ('drain_target_pct', ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ")->execute([(string)$pct]);
        $db->exec("
            INSERT INTO settings (key_name, value) VALUES ('drain_cmd_seq', '1')
            ON DUPLICATE KEY UPDATE value = CAST(value AS UNSIGNED) + 1
        ");
        $db->commit();
    }
}
