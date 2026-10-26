<?php
// ── Database ──────────────────────────────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'irrigation');
define('DB_USER', 'irrigation_user');      // create with limited privileges
define('DB_PASS', 'Irr!gate2024Pond');
define('DB_CHARSET', 'utf8mb4');

// ── ESP-32 API keys ───────────────────────────────────────────────────────────
// One key per board, kept in device_keys.php (git-ignored — copy from device_keys.example.php)
define('DEVICE_KEYS_FILE', __DIR__ . '/device_keys.php');

// ── Application ───────────────────────────────────────────────────────────────
define('APP_NAME', 'Irrigation Controller');
define('APP_URL',   'https://paradisepond.tech/irrigation');
define('BASE_PATH', '/irrigation');
define('TIMEZONE', 'America/Chicago');  // adjust to your timezone

// ── Session ───────────────────────────────────────────────────────────────────
define('SESSION_NAME',    'irrigation_session');
define('SESSION_TIMEOUT', 3600 * 8);  // 8 hours

// ── Valve safety ──────────────────────────────────────────────────────────────
define('MAX_ZONE_DURATION_SEC', 3600);   // 1 hour max per zone
define('VALVE_PULSE_CONFIRM_MS', 200);   // wait after pulse before confirming

date_default_timezone_set(TIMEZONE);
