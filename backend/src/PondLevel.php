<?php
// Pond level from Unit D's ultrasonic sensor, mounted above the water looking down.
// Unit D sends the distance to the water (mm) with its once-a-minute sensor report;
// the latest is kept for the dashboard and one reading every 30 minutes goes into
// pond_level_readings for the graph. Level is shown against a "normal" distance set
// from the dashboard: a smaller distance means the water is higher.
class PondLevel {
    const UNIT_ID        = 4;
    const RECORD_SEC     = 1800;   // one stored reading every 30 minutes
    const MIN_MM         = 200;    // outside the sensor's range = bad reading
    const MAX_MM         = 4500;
    const MM_PER_INCH    = 25.4;

    public static function valid($mm): bool {
        return is_numeric($mm) && $mm >= self::MIN_MM && $mm <= self::MAX_MM;
    }

    // Store a reading if the last stored one is 30 minutes old (a little early is fine,
    // so the readings don't drift later by one report interval each time)
    public static function record(int $mm): void {
        $db   = Database::get();
        $last = $db->query("SELECT TIMESTAMPDIFF(SECOND, MAX(recorded_at), NOW()) FROM pond_level_readings")->fetchColumn();
        if ($last !== null && (int)$last < self::RECORD_SEC - 45) return;
        $db->prepare("INSERT INTO pond_level_readings (distance_mm) VALUES (?)")->execute([$mm]);
    }

    public static function normalMm(): ?int {
        $v = Database::get()->query("SELECT value FROM settings WHERE key_name = 'pond_normal_distance_mm'")->fetchColumn();
        return is_numeric($v) ? (int)$v : null;
    }

    public static function setNormal(int $mm): void {
        Database::get()->prepare("
            INSERT INTO settings (key_name, value) VALUES ('pond_normal_distance_mm', ?)
            ON DUPLICATE KEY UPDATE value = VALUES(value)
        ")->execute([(string)$mm]);
    }

    // Inches above (+) or below (−) normal, or null when either value is missing
    public static function offsetIn(?int $mm, ?int $normalMm): ?float {
        if ($mm === null || $normalMm === null) return null;
        return round(($normalMm - $mm) / self::MM_PER_INCH, 1);
    }

    // Latest reading from Unit D's last report: ['distance_mm' => int|null, 'at' => string|null]
    public static function current(): array {
        $row = Database::get()->query("
            SELECT JSON_EXTRACT(report, '$.pond_mm') AS mm, JSON_UNQUOTE(JSON_EXTRACT(report, '$.pond_at')) AS at
            FROM unit_status WHERE unit_id = " . self::UNIT_ID
        )->fetch();
        $mm = $row && is_numeric($row['mm']) ? (int)$row['mm'] : null;
        return ['distance_mm' => $mm, 'at' => $mm !== null ? $row['at'] : null];
    }

    // Summary for the dashboard (Unit D card and the Unit E pictorial)
    public static function summary(): array {
        $cur    = self::current();
        $normal = self::normalMm();
        return [
            'distance_mm' => $cur['distance_mm'],
            'at'          => $cur['at'],
            'normal_mm'   => $normal,
            'offset_in'   => self::offsetIn($cur['distance_mm'], $normal),
            'online'      => ZoneUnit::isOnline(self::UNIT_ID),
        ];
    }

    // Stored readings for the graph, oldest first. Each carries the raw distance and a
    // running average of the readings in the 3 hours up to it ('avg_mm'): the sensor
    // wanders about ±0.5 in between readings while a pond this size moves far slower.
    // Readings from the 3 hours before the range are fetched too, so the first points
    // in the range get a full average.
    const AVG_SEC = 3 * 3600;

    public static function history(int $days): array {
        $stmt = Database::get()->prepare("
            SELECT distance_mm, recorded_at, UNIX_TIMESTAMP(recorded_at) AS ts,
                   recorded_at >= NOW() - INTERVAL ? DAY AS in_range
            FROM pond_level_readings
            WHERE recorded_at >= NOW() - INTERVAL ? DAY - INTERVAL " . self::AVG_SEC . " SECOND
            ORDER BY recorded_at
        ");
        $stmt->execute([$days, $days]);
        $rows = $stmt->fetchAll();

        $out = []; $start = 0; $sum = 0;
        foreach ($rows as $i => $r) {
            $sum += (int)$r['distance_mm'];
            // Drop readings 3 hours or more older than this one
            while ($rows[$start]['ts'] <= $r['ts'] - self::AVG_SEC) $sum -= (int)$rows[$start++]['distance_mm'];
            if (!$r['in_range']) continue;
            $out[] = [
                'mm'     => (int)$r['distance_mm'],
                'avg_mm' => round($sum / ($i - $start + 1), 1),
                'at'     => $r['recorded_at'],
            ];
        }
        return $out;
    }
}
