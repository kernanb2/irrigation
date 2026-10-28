<?php
// Set a new password for an existing login (passwords are stored only as hashes,
// so a forgotten one can't be looked up). Run from a terminal:
//   php backend/db/reset_password.php admin
// It asks for the new password twice without echoing it.
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Database.php';

if (php_sapi_name() !== 'cli') { die("CLI only\n"); }

$username = $argv[1] ?? null;
if (!$username) {
    die("Usage: php reset_password.php <username>\n");
}

$db   = Database::get();
$stmt = $db->prepare("SELECT id FROM users WHERE username = ?");
$stmt->execute([$username]);
if (!$stmt->fetch()) {
    die("No user '{$username}'.\n");
}

function ask(string $prompt): string {
    echo $prompt;
    shell_exec('stty -echo');
    $value = rtrim(fgets(STDIN), "\r\n");
    shell_exec('stty echo');
    echo "\n";
    return $value;
}

$password = ask('New password: ');
if (strlen($password) < 8) {
    die("Use at least 8 characters.\n");
}
if (ask('Again: ') !== $password) {
    die("Passwords don't match — nothing changed.\n");
}

$db->prepare("UPDATE users SET password_hash = ?, active = 1 WHERE username = ?")
   ->execute([password_hash($password, PASSWORD_BCRYPT), $username]);

echo "Password for '{$username}' updated.\n";
