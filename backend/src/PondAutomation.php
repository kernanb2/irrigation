<?php
// Automation rule "Pond level", set up on the dashboard's Automation panel.
//
// When the pond is below full by the chosen amount, fill it from one source (Unit E
// Pond Fill, the Creek or the Pond Fountain) until it's back to full. "Full" is the
// normal level set on the Pond Level card, and the level is the 3-hour average of
// the stored readings, so the sensor's ±0.5 in wander can't start or stop a fill.
//
// Low water mark: the tanks draw pond water through the Pond Drain. If the pond falls
// to the low water mark, the rule closes the drain (remembering its position) and
// puts it back once the pond is 0.5 in above the mark again. The override switch lets
// the pond go below the mark: the drain is left alone.
//
// The rule runs each time Unit D sends a pond reading (once a minute) and when it's
// saved. It only works while Auto Mode is on, and it only stops what it started.
// Every run has an end time on the unit itself, so if Unit D or the server goes quiet
// the Creek or Fountain closes within an hour and a Pond Fill run within FILL_HOURS.
require_once __DIR__ . '/TimedRuns.php';

class PondAutomation {
    const KIND        = 'pond_level';
    const BY          = 'Pond automation';   // desired_by / initiated_by on its valve runs
    const BELOW_IN    = [0.5, 1, 1.5, 2, 3, 4, 6];        // "below full by" choices
    const LOW_MARK_IN = [2, 3, 4, 6, 8, 12, 18, 24];      // low water mark choices
    const SOURCES     = ['pond_fill' => 'Pond Fill', 'creek' => 'Creek', 'fountain' => 'Pond Fountain'];
    const ZONES       = ['creek' => 1, 'fountain' => 21];
    const FILL_HOURS  = 4;       // each Pond Fill run; started again if the pond's still low
    const LOW_CLEAR_IN = 0.5;    // drain goes back once the pond is this far above the mark
    const STALE_SEC   = 3600;    // no reading for this long = level unknown

    const DEFAULTS = ['below_in' => 1, 'source' => 'pond_fill', 'low_mark_in' => 6, 'allow_below_low' => false];

    public static function load(): array {
        $row = Database::get()->query("SELECT enabled, config, state FROM automation_rules WHERE kind = '" . self::KIND . "'")->fetch();
        return [
            'enabled' => $row && $row['enabled'],
            'config'  => array_merge(self::DEFAULTS, json_decode($row['config'] ?? '{}', true) ?: []),
            'state'   => json_decode($row['state'] ?? '{}', true) ?: [],
        ];
    }

    // Check and store choices from the page; returns an error message or null
    public static function save(bool $enabled, array $in): ?string {
        $cfg = [
            'below_in'        => (float)($in['below_in'] ?? 0),
            'source'          => (string)($in['source'] ?? ''),
            'low_mark_in'     => (float)($in['low_mark_in'] ?? 0),
            'allow_below_low' => (bool)($in['allow_below_low'] ?? false),
        ];
        if (!in_array($cfg['below_in'], self::BELOW_IN))       return 'Pick how far below full';
        if (!isset(self::SOURCES[$cfg['source']]))             return 'Pick how to fill the pond';
        if (!in_array($cfg['low_mark_in'], self::LOW_MARK_IN)) return 'Pick a low water mark';
        if ($cfg['low_mark_in'] <= $cfg['below_in'])           return 'The low water mark must be further below full than the fill point';

        Database::get()->prepare("
            INSERT INTO automation_rules (kind, enabled, config) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), config = VALUES(config)
        ")->execute([self::KIND, (int)$enabled, json_encode($cfg)]);
        return null;
    }

    private static function saveState(array $state): void {
        Database::get()->prepare("UPDATE automation_rules SET state = ? WHERE kind = ?")
            ->execute([json_encode($state), self::KIND]);
    }

    public static function autoModeOn(): bool {
        return Database::get()->query("SELECT value FROM settings WHERE key_name = 'auto_mode_enabled'")->fetchColumn() === 'true';
    }

    // Inches below full (negative = above), from the 3-hour average; null if unknown
    public static function belowFullIn(): ?float {
        $normal = PondLevel::normalMm();
        $avg    = PondLevel::recentAvgMm(self::STALE_SEC);
        return $normal === null || $avg === null ? null : round(($avg - $normal) / PondLevel::MM_PER_INCH, 2);
    }

    // The source this rule is filling with now, or null
    public static function fillingSource(): ?string {
        return self::load()['state']['filling'] ?? null;
    }

    // Is the source running right now (whoever started it)?
    public static function sourceRunning(string $source): bool {
        if ($source === 'pond_fill') return PondFill::desired()['active'];
        $stmt = Database::get()->prepare("SELECT desired_state = 'open' AND desired_until > NOW() FROM zones WHERE id = ?");
        $stmt->execute([self::ZONES[$source]]);
        return (bool)$stmt->fetchColumn();
    }

    // Start the source, or keep it going: zone valves get their end time pushed out
    // each check, and a Pond Fill run that ended is started again. While a timed run
    // has the source, it's left to that.
    private static function runSource(string $source): void {
        if (TimedRuns::isRunning($source)) return;
        if ($source === 'pond_fill') {
            if (!PondFill::desired()['active']) PondFill::command(self::FILL_HOURS);
        } else {
            ZoneUnit::requestValve(self::ZONES[$source], true, 'schedule', self::BY);
        }
    }

    // Stop the source if this rule is what's running it (not while a timed run has it)
    private static function stopSource(string $source): void {
        if (TimedRuns::isRunning($source)) return;
        if ($source === 'pond_fill') {
            if (PondFill::desired()['active']) PondFill::command(null);
            return;
        }
        $stmt = Database::get()->prepare("SELECT desired_state, desired_by FROM zones WHERE id = ?");
        $stmt->execute([self::ZONES[$source]]);
        $z = $stmt->fetch();
        if ($z && $z['desired_state'] === 'open' && $z['desired_by'] === self::BY) {
            ZoneUnit::requestValve(self::ZONES[$source], false, 'schedule', self::BY);
        }
    }

    public static function evaluate(): void {
        $rule  = self::load();
        $cfg   = $rule['config'];
        $state = $rule['state'];
        $on    = $rule['enabled'] && self::autoModeOn();
        $below = $on ? self::belowFullIn() : null;
        $note  = function (string $msg) use (&$state) {
            $state['last_action'] = $msg;
            $state['last_at']     = date('Y-m-d H:i:s');
        };
        $fmt = fn($in) => rtrim(rtrim(number_format(abs($in), 1), '0'), '.') . ' in';

        // ── Filling ──
        $filling = $state['filling'] ?? null;   // the source this rule started
        if ($filling) {
            if (!$on || $filling !== $cfg['source']) {
                self::stopSource($filling);
                $state['filling'] = null;
                $note('Stopped ' . self::SOURCES[$filling] . (!$on ? ' (rule off)' : ' (fill source changed)'));
            } elseif ($below !== null && $below <= 0) {
                self::stopSource($filling);
                $state['filling'] = null;
                $note('Pond back to full — stopped ' . self::SOURCES[$filling]);
            } elseif ($below !== null) {
                self::runSource($filling);
            }
            // Level unknown (Unit D quiet): leave it, the run ends on the unit's own timer
        }
        if (empty($state['filling']) && $on && $below !== null && $below >= $cfg['below_in']) {
            self::runSource($cfg['source']);
            $state['filling']    = $cfg['source'];
            $state['started_at'] = date('Y-m-d H:i:s');
            $note('Pond ' . $fmt($below) . ' below full — started ' . self::SOURCES[$cfg['source']]);
        }

        // ── Low water mark: hold the Pond Drain closed ──
        $held = $state['drain_held_pct'] ?? null;   // drain position to put back
        if ($held === null) {
            // Not during a Pond Fill run: it opens the drain itself to send spring water to the pond
            if ($on && !$cfg['allow_below_low'] && $below !== null && $below >= $cfg['low_mark_in']
                && !PondFill::desired()['active'] && ($pct = PondDrain::desired()['target_pct']) > 0) {
                PondDrain::setTarget(0);
                $state['drain_held_pct'] = $pct;
                $note('Pond at the low water mark — closed the Pond Drain (was ' . $pct . '%)');
            }
        } elseif (!$on || $cfg['allow_below_low']
                  || ($below !== null && $below <= $cfg['low_mark_in'] - self::LOW_CLEAR_IN)) {
            // Put it back unless someone has moved it since
            if (PondDrain::desired()['target_pct'] === 0) PondDrain::setTarget((int)$held);
            $state['drain_held_pct'] = null;
            $note('Pond Drain back to ' . $held . '%' . (!$on ? ' (rule off)' : ($cfg['allow_below_low'] ? ' (override on)' : '')));
        }

        if ($state !== $rule['state']) self::saveState($state);
    }

    // For the page: the rule, its choices, and what it's doing
    public static function status(): array {
        $rule  = self::load();
        $state = $rule['state'];
        $src   = $rule['config']['source'];
        return [
            'enabled'    => $rule['enabled'],
            'config'     => $rule['config'],
            'auto_mode'  => self::autoModeOn(),
            'normal_set' => PondLevel::normalMm() !== null,
            'below_in'   => self::belowFullIn(),
            'filling'    => $state['filling'] ?? null,
            'started_at' => $state['started_at'] ?? null,
            'drain_held_pct' => $state['drain_held_pct'] ?? null,
            'last_action' => $state['last_action'] ?? null,
            'last_at'    => $state['last_at'] ?? null,
            'source_online' => $src === 'pond_fill' ? self::unitEOnline()
                             : ZoneUnit::isOnline($src === 'creek' ? 1 : 4),
            'choices'    => ['below_in' => self::BELOW_IN, 'low_mark_in' => self::LOW_MARK_IN, 'sources' => self::SOURCES],
        ];
    }

    private static function unitEOnline(): bool {
        $ago = Database::get()->query("SELECT TIMESTAMPDIFF(SECOND, last_seen, NOW()) FROM units WHERE id = 5")->fetchColumn();
        return $ago !== false && $ago !== null && (int)$ago < 30;
    }
}
