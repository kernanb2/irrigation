<?php
// Run once from CLI to create the first admin user:
//   php backend/db/create_user.php admin yourpassword
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Database.php';

if (php_sapi_name() !== 'cli') { die("CLI only\n"); }

$username = $argv[1] ?? null;
$password = $argv[2] ?? null;

if (!$username || !$password) {
    die("Usage: php create_user.php <username> <password>\n");
}

$hash = password_hash($password, PASSWORD_BCRYPT);
$db   = Database::get();
$db->prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
   ->execute([$username, $hash]);

echo "User '{$username}' created.\n";
