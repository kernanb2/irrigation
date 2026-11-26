<?php
// Automation: timed runs, set up on the dashboard's Automation panel.
//
// Each timed run is one source (Unit E Pond Fill, the Creek, the Pond Fountain, or an
// irrigation zone — Zone watering on the page) run
// for a length of time (20 min to 6 h, in 20-minute steps) from one or more start
// times, on the days of the week picked. All the timed runs are kept in one
// automation_rules row (kind 'timed_runs'): config = {"runs": [...]}, state = what's
// running now.
//
// There's no cron: tick() is called from the units' check-ins (zone units every 5 s,
// Unit E every 2 s) and does its work at most once every TICK_SEC. A start missed while
// the server was down still runs for the time left. Runs only start while Auto Mode
// is on.
//
// - Creek / Fountain: the zone valve is opened with an end time of at most an hour,
//   pushed out on each tick until the run ends. If the server goes quiet the valve
//   still closes on the unit's own timer.
// - Pond Fill: Unit E runs whole hours, so it's started for the run length rounded up
//   and stopped by the server when the run ends.
//
// A run never takes over a valve that was already running by hand: it leaves it
// alone. If someone stops a run partway, it isn't restarted until the next start time.
// Runs only take over from (and hand back to) the Pond level rule.
//
// Irrigation zones (ZONE_SOURCES) can skip a start when the soil is already wet: if the
// zone's latest moisture reading (from the last MOIST_MAX_AGE_SEC) is above the run's
// skip_above_pct, that start is skipped. No recent reading = water anyway.
require_once __DIR__ . '/ZoneUnit.php';
require_once __DIR__ . '/PondLevel.php';
require_once __DIR__ . '/PondFill.php';
require_once __DIR__ . '/PondDrain.php';
require_once __DIR__ . '/PondAutomation.php';

class TimedRuns {
    const KIND      = 'timed_runs';
    const BY        = 'Timed run';   // desired_by / initiated_by on its valve runs
    const STEP_MIN  = 20;
    const MAX_MIN   = 360;
    const MAX_TIMES = 12;            // start times per run
    const MAX_RUNS  = 20;
    const TICK_SEC  = 20;
    const ZONE_SOURCES = ['zone22' => 22, 'zone23' => 23, 'zone24' => 24];   // more zones later
    const SKIP_PCT     = [20, 30, 40, 50, 60, 70, 80, 90];   // "skip if moisture above" choices
    const MOIST_MAX_AGE_SEC = 3600;

    // Every source a timed run can use: key => label
    public static function sources(): array {
        $out  = PondAutomation::SOURCES;
        $ids  = implode(',', self::ZONE_SOURCES);
        $names = Database::get()->query("SELECT id, name FROM zones WHERE id IN ($ids)")->fetchAll(PDO::FETCH_KEY_PAIR);
        foreach (self::ZONE_SOURCES as $k => $id) $out[$k] = $names[$id] ?? "Zone $id";
        return $out;
    }

    private static function zoneOf(string $src): ?int {
        return PondAutomation::ZONES[$src] ?? self::ZONE_SOURCES[$src] ?? null;
    }

    private static function isRunningNow(string $src): bool {
        if ($src === 'pond_fill') return PondFill::desired()['active'];
        $stmt = Database::get()->prepare("SELECT desired_state = 'open' AND desired_until > NOW() FROM zones WHERE id = ?");
        $stmt->execute([self::zoneOf($src)]);
        return (bool)$stmt->fetchColumn();
    }

    // A zone's latest moisture % from the last MOIST_MAX_AGE_SEC, or null
    public static function moisture(int $zoneId): ?int {
        $stmt = Database::get()->prepare("
            SELECT moisture_pct FROM moisture_readings
            WHERE zone_id = ? AND recorded_at >= NOW() - INTERVAL " . self::MOIST_MAX_AGE_SEC . " SECOND
            ORDER BY recorded_at DESC LIMIT 1
        ");
        $stmt->execute([$zoneId]);
        $v = $stmt->fetchColumn();
        return $v === false || $v === null ? null : (int)$v;
    }

    private static function row(): array {
        $row = Database::get()->query("SELECT enabled, config, state FROM automation_rules WHERE kind = '" . self::KIND . "'")->fetch();
        $cfg = json_decode($row['config'] ?? '{}', true) ?: [];
        return [
            'runs'  => is_array($cfg['runs'] ?? null) ? $cfg['runs'] : [],
            'state' => json_decode($row['state'] ?? '{}', true) ?: [],
        ];
    }

    private static function saveState(array $state): void {
        Database::get()->prepare("UPDATE automation_rules SET state = ? WHERE kind = ?")
            ->execute([json_encode($state), self::KIND]);
    }

    // Check and store the list from the page; returns an error message or null
    public static function save(array $runs): ?string {
        if (count($runs) > self::MAX_RUNS) return 'Too many timed runs';
        $out = []; $nextId = 1; $sources = self::sources();
        foreach ($runs as $r) $nextId = max($nextId, (int)($r['id'] ?? 0) + 1);
        foreach ($runs as $r) {
            $source  = (string)($r['source'] ?? '');
            $minutes = (int)($r['minutes'] ?? 0);
            if (!isset($sources[$source])) return 'Pick what to run';
            $skip = $r['skip_above_pct'] ?? null;
            $skip = $skip === null || $skip === '' ? null : (int)$skip;
            if ($skip !== null && (!isset(self::ZONE_SOURCES[$source]) || !in_array($skip, self::SKIP_PCT, true))) return 'Pick a moisture level';
            if ($minutes < self::STEP_MIN || $minutes > self::MAX_MIN || $minutes % self::STEP_MIN) return 'Pick a run length';
            $times = [];
            foreach ((array)($r['times'] ?? []) as $t) {
                if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', (string)$t)) return "Start time \"$t\" isn't a time";
                $times[$t] = true;
            }
            $times = array_keys($times);
            sort($times);
            if (count($times) > self::MAX_TIMES) return 'Up to ' . self::MAX_TIMES . ' start times per run';
            $days = array_values(array_unique(array_filter(array_map('intval', (array)($r['days'] ?? [])), fn($d) => $d >= 0 && $d <= 6)));
            sort($days);
            $id = (int)($r['id'] ?? 0);
            $out[] = [
                'id'      => $id > 0 ? $id : $nextId++,
                'enabled' => (bool)($r['enabled'] ?? true),
                'source'  => $source,
                'minutes' => $minutes,
                'times'   => $times,
                'days'    => $days,
                'skip_above_pct' => $skip,
            ];
        }
        Database::get()->prepare("
            INSERT INTO automation_rules (kind, enabled, config) VALUES (?, TRUE, ?)
            ON DUPLICATE KEY UPDATE config = VALUES(config)
        ")->execute([self::KIND, json_encode(['runs' => $out])]);
        return null;
    }

    // Start/end times (unix) of a run's windows that are going on at $now. A window
    // belongs to the day it starts on, so a 22:00 run for 4 h carries on past midnight.
    private static function activeWindows(array $run, int $now): array {
        $out = [];
        foreach ([-1, 0] as $dayOff) {
            $day = strtotime(date('Y-m-d', $now) . " $dayOff day");
            if (!in_array((int)date('w', $day), $run['days'], true)) continue;
            foreach ($run['times'] as $t) {
                $start = strtotime(date('Y-m-d', $day) . " $t");
                $end   = $start + $run['minutes'] * 60;
                if ($now >= $start && $now < $end) {
                    $out[] = ['key' => $run['id'] . '|' . date('Y-m-d H:i', $start), 'start' => $start, 'end' => $end,
                              'run' => $run['id'], 'skip' => $run['skip_above_pct'] ?? null];
                }
            }
        }
        return $out;
    }

    // Next start of a run after $now, or null (no days or no times picked)
    private static function nextStart(array $run, int $now): ?int {
        for ($d = 0; $d <= 7; $d++) {
            $day = strtotime(date('Y-m-d', $now) . " +$d day");
            if (!in_array((int)date('w', $day), $run['days'], true)) continue;
            foreach ($run['times'] as $t) {
                $start = strtotime(date('Y-m-d', $day) . " $t");
                if ($start > $now) return $start;
            }
        }
        return null;
    }

    // Is a timed run driving this source now? (The Pond level rule leaves it alone then.)
    public static function isRunning(string $source): bool {
        $r = self::row()['state']['running'][$source] ?? null;
        return $r && $r['end'] > time();
    }

    // Called on every unit check-in; does the work at most once every TICK_SEC
    public static function tick(): void {
        $gate = Database::get()->prepare("
            INSERT INTO settings (key_name, value) VALUES ('automation_tick', UNIX_TIMESTAMP())
            ON DUPLICATE KEY UPDATE value = IF(CAST(value AS UNSIGNED) <= UNIX_TIMESTAMP() - ?, UNIX_TIMESTAMP(), value)
        ");
        $gate->execute([self::TICK_SEC]);
        if ($gate->rowCount() === 0) return;   // value unchanged = ticked recently
        self::evaluate();
    }

    public static function evaluate(): void {
        $row   = self::row();
        $state = $row['state'];
        $now   = time();
        $on    = PondAutomation::autoModeOn();
        $running = $state['running'] ?? [];   // source => ['end' => unix, 'fill_until' => unix]
        $started = $state['started'] ?? [];   // window key => unix start (so a start fires once)
        $note = function (string $msg) use (&$state) {
            $state['last_action'] = $msg;
            $state['last_at']     = date('Y-m-d H:i:s');
        };
        $names = self::sources();
        $label = fn($s) => $names[$s] ?? $s;
        $skipped = $state['skipped'] ?? [];   // run id => last start skipped for moisture

        // Windows going on now, by source
        $want = [];
        if ($on) {
            foreach ($row['runs'] as $run) {
                if (!$run['enabled']) continue;
                foreach (self::activeWindows($run, $now) as $w) $want[$run['source']][] = $w;
            }
        }

        // Runs already going: carry on, hand back or stop
        foreach ($running as $src => $r) {
            $ends = array_column($want[$src] ?? [], 'end');
            $end  = $ends ? max($r['end'], max($ends)) : $r['end'];
            if (!$on || $now >= $end) {
                // Hand back to the Pond level rule if it's filling with this source
                if (PondAutomation::fillingSource() !== $src) self::stopSource($src);
                elseif ($src !== 'pond_fill') ZoneUnit::requestValve(self::zoneOf($src), true, 'schedule', PondAutomation::BY);
                unset($running[$src]);
                $note('Stopped ' . $label($src) . (!$on ? ' (Auto Mode off)' : ' (run time ended)'));
            } elseif (!self::isRunningNow($src)) {
                unset($running[$src]);   // stopped by hand (or Unit E restarted): leave it
                $note($label($src) . ' was stopped before the run ended');
            } else {
                $running[$src]['end'] = $end;
                self::runSource($src, $end, $running[$src]);
            }
        }

        // New starts
        foreach ($want as $src => $windows) {
            $new = array_filter($windows, fn($w) => !isset($started[$w['key']]));
            if (!$new) continue;
            foreach ($new as $w) $started[$w['key']] = $w['start'];
            if (isset($running[$src])) continue;   // already running: the end was pushed out above

            // Zones: skip a start when the soil is already wetter than the run's setting
            if (isset(self::ZONE_SOURCES[$src])) {
                $pct = self::moisture(self::ZONE_SOURCES[$src]);
                $go  = array_filter($new, fn($w) => $w['skip'] === null || $pct === null || $pct <= $w['skip']);
                foreach ($new as $w) {
                    if (!in_array($w, $go, true)) {
                        $skipped[$w['run']] = ['at' => date('Y-m-d H:i:s', $w['start']), 'pct' => $pct];
                        $note('Skipped ' . $label($src) . " — moisture $pct% is above " . $w['skip'] . '%');
                    }
                }
                if (!$go) continue;
                // Older windows of this source already going (none started = all were skipped) don't count
                $windows = $go;
            }

            $end = max(array_column($windows, 'end'));
            if (self::isRunningNow($src) && PondAutomation::fillingSource() !== $src) {
                $note($label($src) . ' was already running by hand, so the timed run left it alone');
                continue;
            }
            $running[$src] = ['end' => $end];
            self::runSource($src, $end, $running[$src]);
            $note('Started ' . $label($src) . ' until ' . date('g:i A', $end));
        }

        // Forget starts more than a day old
        $started = array_filter($started, fn($t) => $t > $now - 2 * 86400);

        $state['running'] = $running;
        $state['started'] = $started;
        $state['skipped'] = $skipped;
        if ($state !== $row['state']) self::saveState($state);
    }

    private static function runSource(string $src, int $end, array &$r): void {
        $left = $end - time();
        if ($src === 'pond_fill') {
            // Unit E counts whole hours: (re)start it if it would stop before the run ends
            if (!PondFill::desired()['active'] || ($r['fill_until'] ?? 0) < $end) {
                $hours = (int)min(PondFill::MAX_HOURS, max(1, ceil($left / 3600)));
                PondFill::command($hours);
                $r['fill_until'] = time() + $hours * 3600;
            }
        } else {
            ZoneUnit::requestValve(self::zoneOf($src), true, 'schedule', self::BY, $left);
        }
    }

    private static function stopSource(string $src): void {
        if ($src === 'pond_fill') {
            if (PondFill::desired()['active']) PondFill::command(null);
            return;
        }
        $stmt = Database::get()->prepare("SELECT desired_state, desired_by FROM zones WHERE id = ?");
        $stmt->execute([self::zoneOf($src)]);
        $z = $stmt->fetch();
        if ($z && $z['desired_state'] === 'open' && $z['desired_by'] === self::BY) {
            ZoneUnit::requestValve(self::zoneOf($src), false, 'schedule', self::BY);
        }
    }

    // For the page: the runs, each with whether it's running and its next start
    public static function status(): array {
        $row  = self::row();
        $now  = time();
        $running = $row['state']['running'] ?? [];
        $runs = [];
        foreach ($row['runs'] as $run) {
            $active = self::activeWindows($run, $now);
            $isOn   = $run['enabled'] && $active && isset($running[$run['source']]);
            $next   = $run['enabled'] ? self::nextStart($run, $now) : null;
            $skip   = $row['state']['skipped'][$run['id']] ?? null;
            $runs[] = $run + ['skip_above_pct' => null] + [
                'running_until' => $isOn ? date('c', $running[$run['source']]['end']) : null,
                'next_start'    => $next ? date('c', $next) : null,
                'last_skipped'  => $skip && strtotime($skip['at']) > $now - 86400
                                   ? ['at' => date('c', strtotime($skip['at'])), 'pct' => $skip['pct']] : null,
            ];
        }
        $zones = [];
        foreach (self::ZONE_SOURCES as $k => $id) $zones[$k] = ['zone_id' => $id, 'moisture_pct' => self::moisture($id)];
        return [
            'runs'        => $runs,
            'last_action' => $row['state']['last_action'] ?? null,
            'last_at'     => $row['state']['last_at'] ?? null,
            'step_min'    => self::STEP_MIN,
            'max_min'     => self::MAX_MIN,
            'max_times'   => self::MAX_TIMES,
            'sources'     => self::sources(),
            'zone_sources' => $zones,
            'skip_pct'    => self::SKIP_PCT,
        ];
    }
}
