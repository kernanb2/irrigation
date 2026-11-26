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
  <link rel="stylesheet" href="<?= BASE_PATH ?>/css/style.css?v=<?= filemtime(__DIR__ . '/css/style.css') ?>">
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

    <!-- Unit D pond level (built once; polling only updates its text and graph) -->
    <div id="pondLevel" class="zone-grid"></div>

    <!-- Unit E (rendered separately so polling doesn't reset an open dropdown) -->
    <div id="extraUnits" class="zone-grid"></div>

    <!-- Automation panel (rules are built once; polling only updates their status) -->
    <section class="panel" id="automationPanel">
      <div class="panel-header"><h2>Automation</h2></div>
      <div id="automationNote" class="auto-note hidden"></div>
      <div id="automationRules" class="auto-rules"><div class="loading">Loading…</div></div>
    </section>

    <!-- Week schedule: the timed runs and zone watering laid out over the next 7 days -->
    <section class="panel" id="schedulePanel">
      <button type="button" class="help-btn" onclick="showHelp('schedule', this)" title="What this card shows" aria-label="What this card shows">?</button>
      <div class="panel-header"><h2>Week Schedule</h2></div>
      <div id="weekSchedule"><div class="loading">Loading…</div></div>
    </section>

    <!-- Event log -->
    <section class="panel">
      <button type="button" class="help-btn" onclick="showHelp('events', this)" title="What this card shows" aria-label="What this card shows">?</button>
      <div class="panel-header"><h2>Valve Events — Last 48 Hours</h2></div>
      <table id="eventsTable">
        <thead>
          <tr><th>Time</th><th>Zone</th><th>Action</th><th>Trigger</th><th>By</th></tr>
        </thead>
        <tbody></tbody>
      </table>
    </section>
  </main>

  <!-- "?" help box: one for the whole page, filled from CARD_HELP in app.js -->
  <div id="helpModal" class="modal hidden" onclick="if (event.target === this) closeHelp()">
    <div class="modal-box help-box" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
      <h3 id="helpTitle"></h3>
      <div id="helpBody" class="help-body"></div>
      <div class="modal-actions"><button type="button" id="helpClose" onclick="closeHelp()">Close</button></div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
  <script>const BASE = '<?= BASE_PATH ?>';</script>
  <script src="<?= BASE_PATH ?>/js/app.js?v=<?= filemtime(__DIR__ . '/js/app.js') ?>"></script>
</body>
</html>
