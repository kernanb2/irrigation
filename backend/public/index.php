<?php
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Auth.php';
Auth::require();
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= APP_NAME ?></title>
  <link rel="stylesheet" href="<?= BASE_PATH ?>/css/style.css">
</head>
<body>
  <header>
    <div class="header-inner">
      <h1>Irrigation Controller</h1>
      <div class="header-right">
        <span class="user-label"><?= htmlspecialchars(Auth::user()) ?></span>
        <span id="clock"></span>
        <a href="<?= BASE_PATH ?>/logout.php" class="btn-logout">Sign Out</a>
      </div>
    </div>
  </header>

  <main>
    <!-- System status bar -->
    <div class="status-bar">
      <div class="status-item">
        <span class="label">Auto Mode</span>
        <label class="toggle">
          <input type="checkbox" id="autoToggle">
          <span class="slider"></span>
        </label>
      </div>
      <div class="status-item">
        <span class="label">Last Update</span>
        <span id="lastUpdate">—</span>
      </div>
      <div id="unitStatus" class="unit-pills"></div>
    </div>

    <!-- Zone grid -->
    <div id="zoneGrid" class="zone-grid">
      <div class="loading">Loading zones…</div>
    </div>

    <!-- Schedules panel -->
    <section class="panel" id="schedulesPanel">
      <div class="panel-header">
        <h2>Schedules</h2>
        <button class="btn-primary" onclick="openScheduleModal()">+ Add Schedule</button>
      </div>
      <table id="schedulesTable">
        <thead>
          <tr>
            <th>Zone</th><th>Name</th><th>Cron</th>
            <th>Duration</th><th>Skip if Moist</th><th>Active</th><th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>

    <!-- Event log -->
    <section class="panel">
      <h2>Recent Valve Events</h2>
      <table id="eventsTable">
        <thead>
          <tr><th>Time</th><th>Zone</th><th>Action</th><th>Trigger</th><th>By</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>
  </main>

  <!-- Add Schedule Modal -->
  <div id="scheduleModal" class="modal hidden">
    <div class="modal-box">
      <h3>Add Schedule</h3>
      <form id="scheduleForm">
        <label>Zone
          <select name="zone_id" required id="schedZone"></select>
        </label>
        <label>Name
          <input type="text" name="name" placeholder="e.g. Morning run">
        </label>
        <label>Cron Expression
          <input type="text" name="cron_expression" placeholder="0 6 * * 1,3,5" required>
          <small>Standard 5-field cron: min hour day month weekday</small>
        </label>
        <label>Duration (seconds)
          <input type="number" name="duration_sec" min="30" max="3600" value="600" required>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" name="skip_if_moist" checked>
          Skip if soil moisture &gt; threshold
        </label>
        <label>Skip threshold (% moisture)
          <input type="number" name="skip_threshold" min="0" max="100" value="60">
        </label>
        <div class="modal-actions">
          <button type="button" onclick="closeScheduleModal()">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>

  <script>const BASE = '<?= BASE_PATH ?>';</script>
  <script src="<?= BASE_PATH ?>/js/app.js"></script>
</body>
</html>
