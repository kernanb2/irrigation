<?php
// Unit E — Pond Fill. Normally open; a run (1–24 h) has the unit open the Pond Drain
// fully and close this valve, so the water goes to the pond instead of the tanks.
// Like the drain, each command bumps a counter and the unit applies it only when the
// counter changes, so a reboot (which ends any run) never replays one.
class PondFill {
    const ZONE_ID   = 19;
    const MIN_HOURS = 1;
    const MAX_HOURS = 24;

    public static function validHours($v): bool {
        return is_int($v) && $v >= self::MIN_HOURS && $v <= self::MAX_HOURS;
    }

    public static function desired(): array {
        $rows = Database::get()->query("
            SELECT key_name, value FROM settings WHERE key_name IN ('fill_hours', 'fill_active', 'fill_cmd_seq')
        ")->fetchAll(PDO::FETCH_KEY_PAIR);

        $hours = (int)($rows['fill_hours'] ?? 4);
        return [
            'active' => ($rows['fill_active'] ?? 'false') === 'true',
            'hours'  => self::validHours($hours) ? $hours : 4,
            'seq'    => (int)($rows['fill_cmd_seq'] ?? 0),
        ];
    }

    // Start a run of $hours, or stop the current one ($hours = null)
    public static function command(?int $hours): void {
        $db   = Database::get();
        $stmt = $db->prepare("
            INSERT INTO settings (key_name, value) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ");
        $db->beginTransaction();
        $stmt->execute(['fill_active', $hours === null ? 'false' : 'true']);
        if ($hours !== null) $stmt->execute(['fill_hours', (string)$hours]);
        $db->exec("
            INSERT INTO settings (key_name, value) VALUES ('fill_cmd_seq', '1')
            ON DUPLICATE KEY UPDATE value = CAST(value AS UNSIGNED) + 1
        ");
        $db->commit();
    }

    // The unit ended the run itself (time up, or a restart) — stop showing it as wanted
    public static function runEnded(array $reported): void {
        $want = self::desired();
        if ($want['active'] && empty($reported['active']) && (int)($reported['seq'] ?? -1) === $want['seq']) {
            Database::get()->exec("UPDATE settings SET value = 'false' WHERE key_name = 'fill_active'");
        }
    }
}
