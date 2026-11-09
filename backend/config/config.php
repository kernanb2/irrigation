<?php
// ── Database ──────────────────────────────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'irrigation');
define('DB_USER', 'irrigation_user');      // create with limited privileges
require_once __DIR__ . '/db_secrets.php';   // DB_PASS — git-ignored, copy from db_secrets.example.php
define('DB_CHARSET', 'utf8mb4');

// ── ESP-32 API keys ───────────────────────────────────────────────────────────
// One key per board, kept in device_keys.php (git-ignored — copy from device_keys.example.php)
define('DEVICE_KEYS_FILE', __DIR__ . '/device_keys.php');

// ── Application ───────────────────────────────────────────────────────────────
define('APP_NAME', 'Irrigation Controller');
define('APP_URL',   'https://paradisepond.tech/irrigation');
define('BASE_PATH', '/irrigation');
define('TIMEZONE', 'America/Los_Angeles');  // Pacific, same as the server's clock

// ── Session ───────────────────────────────────────────────────────────────────
define('SESSION_NAME',    'irrigation_session');
define('SESSION_TIMEOUT', 3600 * 8);  // 8 hours

// ── Valve safety ──────────────────────────────────────────────────────────────
define('MAX_ZONE_DURATION_SEC', 3600);   // 1 hour max per zone
define('VALVE_PULSE_CONFIRM_MS', 200);   // wait after pulse before confirming

// ── WiFi access points ────────────────────────────────────────────────────────
// BSSID (upper case) => name shown on the dashboard. Each Omada EAP broadcasts several
// BSSIDs (one per radio and SSID), listed under its WLAN details in the controller.
define('WIFI_AP_NAMES', [
    // Gym attic
    'B6:19:21:5A:16:46' => 'Gym attic',
    'BA:19:21:5A:16:46' => 'Gym attic',
    'BE:19:21:5A:16:46' => 'Gym attic',
    'B6:19:21:5A:16:47' => 'Gym attic',
    'BA:19:21:5A:16:47' => 'Gym attic',
    'BE:19:21:5A:16:47' => 'Gym attic',
    // LaundryRoom
    '3A:60:F9:5E:9D:5C' => 'LaundryRoom',
    '3E:60:F9:5E:9D:5C' => 'LaundryRoom',
    '42:60:F9:5E:9D:5C' => 'LaundryRoom',
    '3A:60:F9:5E:9D:5D' => 'LaundryRoom',
    '3E:60:F9:5E:9D:5D' => 'LaundryRoom',
    '42:60:F9:5E:9D:5D' => 'LaundryRoom',
    // ManRoom
    '34:60:F9:BB:90:C2' => 'ManRoom',
    '3A:60:F9:BB:90:C2' => 'ManRoom',
    '34:60:F9:BB:90:C3' => 'ManRoom',
    '3A:60:F9:BB:90:C3' => 'ManRoom',
    // Natasha's Closet
    '3A:60:F9:DE:3B:04' => 'Natasha\'s Closet',
    '3E:60:F9:DE:3B:04' => 'Natasha\'s Closet',
    '42:60:F9:DE:3B:04' => 'Natasha\'s Closet',
    '3A:60:F9:DE:3B:05' => 'Natasha\'s Closet',
    '3E:60:F9:DE:3B:05' => 'Natasha\'s Closet',
    '42:60:F9:DE:3B:05' => 'Natasha\'s Closet',
    // SE Corner of house
    '26:23:51:6C:7F:C2' => 'SE Corner of house',
    '2A:23:51:6C:7F:C2' => 'SE Corner of house',
    '2E:23:51:6C:7F:C2' => 'SE Corner of house',
    '26:23:51:6C:7F:C3' => 'SE Corner of house',
    '2A:23:51:6C:7F:C3' => 'SE Corner of house',
    '2E:23:51:6C:7F:C3' => 'SE Corner of house',
    // outside NW gym wall
    '2E:87:BA:D2:63:F6' => 'outside NW gym wall',
    '32:87:BA:D2:63:F6' => 'outside NW gym wall',
    '36:87:BA:D2:63:F6' => 'outside NW gym wall',
    '2E:87:BA:D2:63:F7' => 'outside NW gym wall',
    '32:87:BA:D2:63:F7' => 'outside NW gym wall',
    '36:87:BA:D2:63:F7' => 'outside NW gym wall',
    // outside SW gym wall
    '2E:87:BA:D2:5E:B8' => 'outside SW gym wall',
    '32:87:BA:D2:5E:B8' => 'outside SW gym wall',
    '36:87:BA:D2:5E:B8' => 'outside SW gym wall',
    '2E:87:BA:D2:5E:B9' => 'outside SW gym wall',
    '32:87:BA:D2:5E:B9' => 'outside SW gym wall',
    '36:87:BA:D2:5E:B9' => 'outside SW gym wall',
    // Battery bunker
    '46:ED:00:14:89:DE' => 'Battery bunker',
    '4A:ED:00:14:89:DE' => 'Battery bunker',
    '46:ED:00:14:89:DF' => 'Battery bunker',
    '4A:ED:00:14:89:DF' => 'Battery bunker',
]);

date_default_timezone_set(TIMEZONE);
