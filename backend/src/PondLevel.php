<?php
// Pond level from Unit D's ultrasonic sensor, mounted above the water looking down.
// Unit D sends the distance to the water (mm) with its once-a-minute sensor report;
// the latest is kept for the dashboard and one reading every 30 minutes goes into
// pond_level_readings for the graph. Level is shown against a "normal" distance set
// from the dashboard: a smaller distance means the water is higher.
//
// Temperature: a sensor that assumes a fixed speed of sound reads the water closer on a
// warm day (sound travels about 0.17% faster per °C, about 2.8 mm per °C at 1.6 m).
// corrected() undoes that from the DS18B20 next to the sensor, when the setting
// pond_temp_comp is '1'. It stays '0': a heater test on 2026-11-21 showed the Taidacent
// sensor corrects for temperature itself. See docs/unit-d.md.
class PondLevel {
    const UNIT_ID        = 4;
    const RECORD_SEC     = 1800;   // one stored reading every 30 minutes
    const MIN_MM         = 200;    // outside the sensor's range = bad reading
    const MAX_MM         = 4500;
    const MM_PER_INCH    = 25.4;
    const REF_C          = 20.0;   // speed of sound an uncorrected sensor is assumed to use

    public static function valid($mm): bool {
        return is_numeric($mm) && $mm >= self::MIN_MM && $mm <= self::MAX_MM;
    }

    // DS18B20 reading, or not: -127 = no sensor, 85 = read before a conversion finished
    public static function validTemp($c): bool {
        return is_numeric($c) && $c > -40 && $c < 70 && (float)$c != 85.0;
    }

    public static function tempCompOn(): bool {
        return Database::get()->query("SELECT value FROM settings WHERE key_name = 'pond_temp_comp'")->fetchColumn() === '1';
    }

    // Speed of sound in air (m/s) at a temperature
    private static function soundSpeed(float $c): float {
        return 331.3 * sqrt(1 + $c / 273.15);
    }

    // The true distance, for a sensor that assumes the speed of sound at REF_C: a warm
    // reading moves out, a cold one in. Returned unchanged when the correction is off
    // or there's no temperature with the reading.
    public static function corrected(int $mm, ?float $tempC, ?bool $on = null): float {
        $on ??= self::tempCompOn();
        if (!$on || $tempC === null) return (float)$mm;
        // The sensor reads distance × speed assumed ÷ speed actual, so multiply back
        return $mm * self::soundSpeed($tempC) / self::soundSpeed(self::REF_C);
    }

    // Store a reading (with the temperature at the time, when there's a DS18B20) if the
    // last stored one is 30 minutes old (a little early is fine, so the readings don't
    // drift later by one report interval each time)
    public static function record(int $mm, ?float $tempC = null): void {
        $db   = Database::get();
        $last = $db->query("SELECT TIMESTAMPDIFF(SECOND, MAX(recorded_at), NOW()) FROM pond_level_readings")->fetchColumn();
        if ($last !== null && (int)$last < self::RECORD_SEC - 45) return;
        $db->prepare("INSERT INTO pond_level_readings (distance_mm, temp_c) VALUES (?, ?)")->execute([$mm, $tempC]);
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

    // Latest reading from Unit D's last report, temperature corrected when that's on:
    // ['distance_mm' => int|null, 'raw_mm' => int|null, 'temp_c' => float|null, 'at' => string|null]
    public static function current(): array {
        $row = Database::get()->query("
            SELECT JSON_EXTRACT(report, '$.pond_mm') AS mm, JSON_EXTRACT(report, '$.pond_temp_c') AS t,
                   JSON_UNQUOTE(JSON_EXTRACT(report, '$.pond_at')) AS at
            FROM unit_status WHERE unit_id = " . self::UNIT_ID
        )->fetch();
        $mm = $row && is_numeric($row['mm']) ? (int)$row['mm'] : null;
        $t  = $row && is_numeric($row['t'])  ? (float)$row['t'] : null;
        return [
            'distance_mm' => $mm !== null ? (int)round(self::corrected($mm, $t)) : null,
            'raw_mm'      => $mm,
            'temp_c'      => $mm !== null ? $t : null,
            'at'          => $mm !== null ? $row['at'] : null,
        ];
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
            'temp_c'      => $cur['temp_c'],
            'temp_comp'   => self::tempCompOn(),
            'online'      => ZoneUnit::isOnline(self::UNIT_ID),
        ];
    }

    // Stored readings for the graph, oldest first. Each carries:
    //   mm       that reading's distance (temperature corrected when that's on)
    //   temp_c   the DS18B20 temperature with it, or null
    //   avg_mm   the average of the readings in the 3 hours up to it
    //   level_mm the graphed level: the 3-hour average held steady until it moves
    //            more than 0.5 in (the sensor's accuracy) away, then moved to the new
    //            average. A still pond draws a flat line; a real change of more than
    //            0.5 in shows as a step.
    // Readings from the 3 hours before the range are fetched too, so the first points
    // in the range get a full average.
    const AVG_SEC = 3 * 3600;
    const HOLD_MM = 12.7;   // 0.5 in

    public static function history(int $days): array {
        $stmt = Database::get()->prepare("
            SELECT distance_mm, temp_c, recorded_at, UNIX_TIMESTAMP(recorded_at) AS ts,
                   recorded_at >= NOW() - INTERVAL ? DAY AS in_range
            FROM pond_level_readings
            WHERE recorded_at >= NOW() - INTERVAL ? DAY - INTERVAL " . self::AVG_SEC . " SECOND
            ORDER BY recorded_at
        ");
        $stmt->execute([$days, $days]);
        $rows = $stmt->fetchAll();

        // Temperature corrected distances (when that's on) go into the average
        $on = self::tempCompOn();
        foreach ($rows as &$r) {
            $r['mm'] = self::corrected((int)$r['distance_mm'], $r['temp_c'] !== null ? (float)$r['temp_c'] : null, $on);
        }
        unset($r);

        $out = []; $start = 0; $sum = 0; $held = null;
        foreach ($rows as $i => $r) {
            $sum += $r['mm'];
            // Drop readings 3 hours or more older than this one
            while ($rows[$start]['ts'] <= $r['ts'] - self::AVG_SEC) $sum -= $rows[$start++]['mm'];
            $avg = $sum / ($i - $start + 1);
            if ($held === null || abs($avg - $held) > self::HOLD_MM) $held = $avg;
            if (!$r['in_range']) continue;
            $out[] = [
                'mm'       => round($r['mm'], 1),
                'temp_c'   => $r['temp_c'] !== null ? (float)$r['temp_c'] : null,
                'avg_mm'   => round($avg, 1),
                'level_mm' => round($held, 1),
                'at'       => $r['recorded_at'],
            ];
        }
        return $out;
    }

    // The 3-hour average distance up to now (temperature corrected when that's on), for
    // automation: null if there's no reading in the last $staleSec
    public static function recentAvgMm(int $staleSec): ?float {
        $rows = Database::get()->query("
            SELECT distance_mm, temp_c, TIMESTAMPDIFF(SECOND, recorded_at, NOW()) AS ago
            FROM pond_level_readings WHERE recorded_at >= NOW() - INTERVAL " . self::AVG_SEC . " SECOND
        ")->fetchAll();
        if (!$rows || min(array_column($rows, 'ago')) > $staleSec) return null;
        $on  = self::tempCompOn();
        $sum = 0;
        foreach ($rows as $r) $sum += self::corrected((int)$r['distance_mm'], $r['temp_c'] !== null ? (float)$r['temp_c'] : null, $on);
        return $sum / count($rows);
    }

    // ── Slow changes (evaporation, seepage) ──────────────────────────────────────
    // One reading wanders about ±2 mm, but the average of a day's 48 readings is good
    // to a fraction of a millimetre, so a 0.1 in/day drop that the 0.5 in hold hides
    // shows clearly in daily averages and in a straight-line trend.
    const TREND_DAYS     = 7;
    const TREND_MIN_DAYS = 2;      // need this much history before showing a trend
    const STEADY_IN_DAY  = 0.02;   // slower than this reads as "steady"

    // Readings since a time, temperature corrected when that's on, oldest first
    private static function rowsSince(string $sql): array {
        $rows = Database::get()->query("
            SELECT distance_mm, temp_c, recorded_at, DATE(recorded_at) AS d, UNIX_TIMESTAMP(recorded_at) AS ts
            FROM pond_level_readings WHERE recorded_at >= $sql ORDER BY recorded_at
        ")->fetchAll();
        $on = self::tempCompOn();
        foreach ($rows as &$r) {
            $r['mm'] = self::corrected((int)$r['distance_mm'], $r['temp_c'] !== null ? (float)$r['temp_c'] : null, $on);
        }
        return $rows;
    }

    // One point per calendar day for the 7- and 30-day graphs: the average distance,
    // placed at the middle of that day's readings (so today's partial day sits at its
    // own midpoint), with the day's average temperature and reading count
    public static function daily(int $days): array {
        $byDay = [];
        foreach (self::rowsSince("CURDATE() - INTERVAL " . ($days - 1) . " DAY") as $r) $byDay[$r['d']][] = $r;
        $out = [];
        foreach ($byDay as $d => $rs) {
            $temps = array_filter(array_column($rs, 'temp_c'), fn($t) => $t !== null);
            $mid   = array_sum(array_column($rs, 'ts')) / count($rs);
            $out[] = [
                'date'   => $d,
                'mm'     => round(array_sum(array_column($rs, 'mm')) / count($rs), 1),
                'temp_c' => $temps ? round(array_sum($temps) / count($temps), 2) : null,
                'count'  => count($rs),
                'at'     => date('Y-m-d H:i:s', (int)$mid),
            ];
        }
        return $out;
    }

    // Straight-line fit of level against time over the last 7 days:
    // ['in_per_day' => + rising / − falling, 'days' => history used, 'steady' => bool],
    // or null with less than 2 days of readings
    public static function trend(): ?array {
        $rows = self::rowsSince("NOW() - INTERVAL " . self::TREND_DAYS . " DAY");
        if (count($rows) < 2) return null;
        $span = $rows[count($rows) - 1]['ts'] - $rows[0]['ts'];
        if ($span < self::TREND_MIN_DAYS * 86400) return null;

        $n  = count($rows);
        $xs = array_map(fn($r) => ($r['ts'] - $rows[0]['ts']) / 86400, $rows);   // days
        $ys = array_map(fn($r) => -$r['mm'] / self::MM_PER_INCH, $rows);         // higher water = up
        $mx = array_sum($xs) / $n; $my = array_sum($ys) / $n;
        $sxy = 0; $sxx = 0;
        foreach ($xs as $i => $x) { $sxy += ($x - $mx) * ($ys[$i] - $my); $sxx += ($x - $mx) ** 2; }
        $slope = $sxy / $sxx;
        return [
            'in_per_day' => round($slope, 2),
            'days'       => round($span / 86400, 1),
            'steady'     => abs($slope) < self::STEADY_IN_DAY,
        ];
    }
}
