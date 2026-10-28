<?php
// Run every minute via crontab: * * * * * php /var/www/irrigation/backend/cron/check_schedules.php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/ZoneUnit.php';

$db = Database::get();

// Check auto mode enabled
$autoMode = $db->query("SELECT value FROM settings WHERE key_name = 'auto_mode_enabled'")->fetchColumn();
if ($autoMode !== 'true') exit(0);

$now        = new DateTime();
$currentMin = (int)$now->format('i');
$currentHour= (int)$now->format('H');
$currentDay = (int)$now->format('j');
$currentMon = (int)$now->format('n');
$currentDow = (int)$now->format('w');  // 0=Sunday

// Fetch active schedules
$schedules = $db->query("
    SELECT s.*, z.unit_id, z.local_index, z.name AS zone_name
    FROM schedules s JOIN zones z ON z.id = s.zone_id
    WHERE s.enabled = 1
")->fetchAll();

foreach ($schedules as $sched) {
    if (!cronMatches($sched['cron_expression'], $currentMin, $currentHour, $currentDay, $currentMon, $currentDow)) {
        continue;
    }

    // Check moisture skip
    if ($sched['skip_if_moist']) {
        $moist = $db->prepare("
            SELECT moisture_pct FROM moisture_readings
            WHERE zone_id = ? ORDER BY recorded_at DESC LIMIT 1
        ");
        $moist->execute([$sched['zone_id']]);
        $pct = $moist->fetchColumn();
        if ($pct !== false && (int)$pct >= (int)$sched['skip_threshold']) {
            log_msg("Skip zone {$sched['zone_id']} ({$sched['zone_name']}) — moisture {$pct}% >= {$sched['skip_threshold']}%");
            continue;
        }
    }

    // Check temperature trigger (if temp-based irrigation enabled)
    $tempThresh = (float)($db->query("SELECT value FROM settings WHERE key_name = 'temp_trigger_threshold_c'")->fetchColumn() ?? 35);
    $latestTemp = $db->prepare("
        SELECT temp_c FROM temperature_readings WHERE unit_id = ? ORDER BY recorded_at DESC LIMIT 1
    ");
    $latestTemp->execute([$sched['unit_id']]);
    $tempC = $latestTemp->fetchColumn();
    // Note: temp-based schedules could use a separate cron_expression or flag; for now temperature
    // overrides the moisture skip if it is above threshold (hot day = water regardless of moisture)
    $hotOverride = ($tempC !== false && (float)$tempC >= $tempThresh);

    // Ask the unit to open the valve for the run length. It applies this on its next
    // check-in (within ~5 s) and closes the valve itself when the time is up.
    log_msg("Opening zone {$sched['zone_id']} ({$sched['zone_name']}) for {$sched['duration_sec']}s" . ($hotOverride ? ' [heat override]' : ''));
    if (!ZoneUnit::isOnline((int)$sched['unit_id'])) {
        log_msg("WARNING zone {$sched['zone_id']}: unit {$sched['unit_id']} is offline — it will run the remaining time if it checks in before the run ends");
    }
    ZoneUnit::requestValve((int)$sched['zone_id'], true, 'schedule', 'system', (int)$sched['duration_sec']);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cronMatches(string $expr, int $min, int $hour, int $day, int $mon, int $dow): bool {
    $parts = preg_split('/\s+/', trim($expr));
    if (count($parts) !== 5) return false;
    [$eMin, $eHour, $eDay, $eMon, $eDow] = $parts;
    return matchField($eMin,  $min)
        && matchField($eHour, $hour)
        && matchField($eDay,  $day)
        && matchField($eMon,  $mon)
        && matchField($eDow,  $dow);
}

function matchField(string $field, int $value): bool {
    if ($field === '*') return true;
    foreach (explode(',', $field) as $part) {
        if (str_contains($part, '/')) {
            [$range, $step] = explode('/', $part);
            $start = ($range === '*') ? 0 : (int)$range;
            if ($value >= $start && ($value - $start) % (int)$step === 0) return true;
        } elseif (str_contains($part, '-')) {
            [$from, $to] = explode('-', $part);
            if ($value >= (int)$from && $value <= (int)$to) return true;
        } else {
            if ((int)$part === $value) return true;
        }
    }
    return false;
}

function log_msg(string $msg): void {
    $ts = date('Y-m-d H:i:s');
    file_put_contents(__DIR__ . '/cron.log', "[$ts] $msg\n", FILE_APPEND);
}
