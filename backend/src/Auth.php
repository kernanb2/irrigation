<?php
class Auth {
    public static function start(): void {
        if (session_status() === PHP_SESSION_NONE) {
            session_name(SESSION_NAME);
            session_set_cookie_params([
                'lifetime' => 0,
                'path'     => '/',
                'secure'   => isset($_SERVER['HTTPS']),
                'httponly' => true,
                'samesite' => 'Strict',
            ]);
            session_start();
        }
    }

    public static function check(): bool {
        self::start();
        if (empty($_SESSION['user_id']) || empty($_SESSION['last_active'])) {
            return false;
        }
        if (time() - $_SESSION['last_active'] > SESSION_TIMEOUT) {
            self::logout();
            return false;
        }
        $_SESSION['last_active'] = time();
        return true;
    }

    public static function require(): void {
        if (!self::check()) {
            header('Location: /login.php');
            exit;
        }
    }

    public static function login(string $username, string $password): bool {
        $db   = Database::get();
        $stmt = $db->prepare('SELECT id, password_hash FROM users WHERE username = ? AND active = 1 LIMIT 1');
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }

        self::start();
        session_regenerate_id(true);
        $_SESSION['user_id']     = $user['id'];
        $_SESSION['username']    = $username;
        $_SESSION['last_active'] = time();

        $db->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')
           ->execute([$user['id']]);

        return true;
    }

    public static function logout(): void {
        self::start();
        $_SESSION = [];
        session_destroy();
    }

    public static function user(): ?string {
        return $_SESSION['username'] ?? null;
    }

    // Validate ESP-32 API key from Authorization: Bearer <key> header
    public static function checkApiKey(): bool {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
            return hash_equals(ESP32_API_KEY, $m[1]);
        }
        return false;
    }
}
