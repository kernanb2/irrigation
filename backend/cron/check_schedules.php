<?php
// Run every minute via crontab: * * * * * php /var/www/irrigation/backend/cron/check_schedules.php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Unit.php';

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

    // Open valve
    log_msg("Opening zone {$sched['zone_id']} ({$sched['zone_name']}) for {$sched['duration_sec']}s" . ($hotOverride ? ' [heat override]' : ''));
    $result = Unit::valveCommand((int)$sched['unit_id'], (int)$sched['local_index'], true);

    if ($result['success']) {
        $db->prepare("UPDATE zones SET valve_state = 'open', last_state_change = NOW() WHERE id = ?")
           ->execute([$sched['zone_id']]);
        $db->prepare("INSERT INTO valve_events (zone_id, action, trigger_type, initiated_by) VALUES (?, 'open', 'schedule', 'system')")
           ->execute([$sched['zone_id']]);

        // Schedule close — store in a pending_closes table or use a background sleep
        // Simple approach: write a close job with a future timestamp
        $closeAt = (new DateTime())->modify("+{$sched['duration_sec']} seconds")->format('Y-m-d H:i:s');
        $db->prepare("INSERT INTO pending_closes (zone_id, unit_id, local_index, close_at) VALUES (?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE close_at = VALUES(close_at)")
           ->execute([$sched['zone_id'], $sched['unit_id'], $sched['local_index'], $closeAt]);
    } else {
        log_msg("ERROR opening zone {$sched['zone_id']}: " . ($result['error'] ?? 'unknown'));
    }
}

// Process pending closes
$closes = $db->query("SELECT * FROM pending_closes WHERE close_at <= NOW()")->fetchAll();
foreach ($closes as $c) {
    log_msg("Closing zone {$c['zone_id']} after scheduled run");
    $result = Unit::valveCommand((int)$c['unit_id'], (int)$c['local_index'], false);
    if ($result['success']) {
        $db->prepare("UPDATE zones SET valve_state = 'closed', last_state_change = NOW() WHERE id = ?")
           ->execute([$c['zone_id']]);
        $db->prepare("INSERT INTO valve_events (zone_id, action, trigger_type, initiated_by) VALUES (?, 'close', 'schedule', 'system')")
           ->execute([$c['zone_id']]);
        $db->prepare("DELETE FROM pending_closes WHERE zone_id = ?")
           ->execute([$c['zone_id']]);
    }
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
