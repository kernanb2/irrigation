<?php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Auth.php';

Auth::start();
if (Auth::check()) { header('Location: ' . BASE_PATH . '/'); exit; }

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = trim($_POST['username'] ?? '');
    $pass = $_POST['password'] ?? '';
    if (Auth::login($user, $pass)) {
        header('Location: ' . BASE_PATH . '/');
        exit;
    }
    $error = 'Invalid username or password.';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — <?= APP_NAME ?></title>
  <link rel="stylesheet" href="<?= BASE_PATH ?>/css/style.css">
</head>
<body class="login-page">
  <div class="login-box">
    <h1>Irrigation Controller</h1>
    <p class="subtitle">paradisepond.tech</p>
    <?php if ($error): ?>
      <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>
    <form method="POST">
      <label>Username
        <input type="text" name="username" autocomplete="username" required autofocus>
      </label>
      <label>Password
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>
