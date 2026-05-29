<?php
// ── Database ──────────────────────────────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'irrigation');
define('DB_USER', 'irrigation_user');      // create with limited privileges
define('DB_PASS', 'Irr!gate2024Pond');
define('DB_CHARSET', 'utf8mb4');

// ── ESP-32 API key ────────────────────────────────────────────────────────────
// ESP-32 units include this in Authorization: Bearer <key> when posting sensor data
define('ESP32_API_KEY', '293bdcd6c3e91dfb08d8c31a2c9ff8bf13ff634eafd812feaf2ab867d55cc145');

// ── Application ───────────────────────────────────────────────────────────────
define('APP_NAME', 'Irrigation Controller');
define('APP_URL',   'http://paradisepond.tech/irrigation');
define('BASE_PATH', '/irrigation');
define('TIMEZONE', 'America/Chicago');  // adjust to your timezone

// ── Session ───────────────────────────────────────────────────────────────────
define('SESSION_NAME',    'irrigation_session');
define('SESSION_TIMEOUT', 3600 * 8);  // 8 hours

// ── Valve safety ──────────────────────────────────────────────────────────────
define('MAX_ZONE_DURATION_SEC', 3600);   // 1 hour max per zone
define('VALVE_PULSE_CONFIRM_MS', 200);   // wait after pulse before confirming

date_default_timezone_set(TIMEZONE);
