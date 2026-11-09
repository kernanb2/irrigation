// ── State ─────────────────────────────────────────────────────────────────────
let zones = [], units = {}, schedules = [], pendingZone = null, filter = null, drainFollowTimer = null, zoneFollowTimer = null;
let fillHoursChoice = null;   // Pond Fill run time picked on the card (sent with Start)
let tankDrainMinutesChoice = null;   // Storage Tank Drain run time picked on the card
let pond = null, pondChart = null, pondHistoryMs = 0;   // Unit D pond level
let pondDays = (() => { try { return parseInt(localStorage.getItem('pondDays')) || 7; } catch { return 7; } })();
let pondDiagramOpen = (() => { try { return localStorage.getItem('pondDiagramOpen') !== 'false'; } catch { return true; } })();
const POLL_MS = 15000;

// ── API wrapper — redirects to login on session expiry ────────────────────────
async function apiFetch(path, options = {}) {
    const res = await fetch(BASE + path, options);
    if (res.redirected || res.url.includes('login.php')) {
        window.location = BASE + '/login.php';
        throw new Error('session_expired');
    }
    return res;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    clockTick();
    setInterval(clockTick, 1000);
    fetchAll();
    setInterval(fetchAll, POLL_MS);

    document.getElementById('scheduleForm').addEventListener('submit', submitSchedule);
    document.getElementById('autoToggle').addEventListener('change', toggleAutoMode);
});

function clockTick() {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString();
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchAll() {
    try {
        const [statusRes, eventsRes, filterRes] = await Promise.all([
            apiFetch('/api/status.php'),
            apiFetch('/api/events.php'),
            apiFetch('/api/filter.php'),
        ]);
        const status = await statusRes.json();
        const events = await eventsRes.json();
        filter       = await filterRes.json();

        zones     = status.zones     || [];
        schedules = status.schedules || [];
        units     = Object.fromEntries((status.units || []).map(u => [u.id, u]));
        pond      = status.pond || null;

        // Follow a zone valve until its unit has picked up the change (one timer at a time)
        if (zones.some(z => units[z.unit_id]?.online == 1 && z.desired_state !== z.valve_state) && !zoneFollowTimer) {
            zoneFollowTimer = setTimeout(() => { zoneFollowTimer = null; fetchAll(); }, 2000);
        }

        // Follow the drain, Pond Fill and Storage Tank Drain while they move (one timer at a time)
        if ((filter?.drain?.reported?.moving || filter?.fill?.reported?.moving
             || filter?.tank_drain?.reported?.moving) && !drainFollowTimer) {
            drainFollowTimer = setTimeout(() => { drainFollowTimer = null; fetchAll(); }, 2000);
        }

        // Show the saved Auto Mode setting (not while a change is being saved)
        const auto = document.getElementById('autoToggle');
        if (!auto.disabled) auto.checked = !!status.auto_mode;

        renderUnitPills();
        renderZones();
        renderPond();
        renderExtraUnits();
        renderSchedules();
        renderEvents(events);
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
    } catch (e) {
        console.error('Fetch failed:', e);
    }
}

// ── Unit status pills ─────────────────────────────────────────────────────────
function renderUnitPills() {
    const html = [1, 2, 3, 4, 5].map(uid => {
        const alive = uid === 5 ? filter?.online : units[uid]?.online == 1;
        return `<span class="unit-pill ${alive ? 'online' : 'offline'}">Unit ${String.fromCharCode(64 + uid)}</span>`;
    }).join('');

    document.getElementById('unitStatus').innerHTML = html;
}

// ── Zone grid ─────────────────────────────────────────────────────────────────
function renderZones() {
    const grid = document.getElementById('zoneGrid');
    let html = '';

    const byUnit = { 1: [], 2: [], 3: [], 4: [] };
    zones.forEach(z => (byUnit[z.unit_id] || []).push(z));

    const unitNames = { 1: 'Unit A — Zones 1–5', 2: 'Unit B — Zones 6–10', 3: 'Unit C — Zones 11–15', 4: 'Unit D — Zones 21–24' };

    [1, 2, 3, 4].forEach(uid => {
        html += `<div class="zone-unit-header">${unitNames[uid]}${wifiBadge(units[uid]?.online == 1, units[uid]?.rssi, units[uid]?.ap)}</div>`;
        byUnit[uid].forEach(z => { html += zoneCard(z); });
    });

    grid.innerHTML = html;
}

function zoneCard(z) {
    const isOpen     = z.valve_state === 'open';
    const wantOpen   = z.desired_state === 'open';
    const unit       = units[z.unit_id];
    const online     = unit?.online == 1;
    const pending    = online && wantOpen !== isOpen;
    const unitName   = 'Unit ' + String.fromCharCode(64 + parseInt(z.unit_id));
    const moist      = z.moisture_pct !== null ? parseInt(z.moisture_pct) : null;
    const moistColor = moist === null ? '' : moist > 65 ? 'moist-high' : moist > 40 ? 'moist-mid' : moist > 25 ? 'moist-low' : 'moist-dry';
    const hasSensor  = z.dry_value !== null;   // no calibration row = no moisture sensor on this zone
    const moistBar   = hasSensor && moist !== null ? `<div class="moisture-bar-wrap"><div class="moisture-bar ${moistColor}" style="width:${moist}%"></div></div>` : '';
    const moistLabel = !hasSensor ? '' : moist !== null ? `Moisture: ${moist}%` : 'No sensor data';

    let detail = '';
    if (!online) {
        detail = `${unitName} offline` + (unit?.last_seen ? ` — last seen ${new Date(unit.last_seen).toLocaleString()}` : '');
    } else if (pending) {
        detail = wantOpen ? `Opening — sending to ${unitName}…` : `Closing — sending to ${unitName}…`;
    } else if (isOpen && z.run_left_s > 0) {
        detail = `Closes in ${formatDuration(parseInt(z.run_left_s))}`;
    }

    return `
    <div class="zone-card ${isOpen ? 'valve-open' : ''} ${z.is_special == 1 ? 'special' : ''}" id="zone-${z.id}">
      <div class="zone-header">
        <div>
          <div class="zone-name">${escHtml(z.name)}</div>
          <div class="zone-id">Zone ${z.id}</div>
        </div>
        <span class="valve-badge ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>
      </div>
      <div class="card-info">
        ${detail ? `<div class="zone-sensors">${detail}</div>` : ''}
        ${moistLabel ? `<div class="zone-sensors">${moistLabel}</div>` : ''}
        ${moistBar}
      </div>
      <div class="zone-actions">
        <button class="btn-open"  onclick="valveCmd(${z.id}, true)"  ${!online || pending || isOpen  ? 'disabled' : ''}>Open</button>
        <button class="btn-close" onclick="valveCmd(${z.id}, false)" ${!online || pending || !isOpen ? 'disabled' : ''}>Close</button>
      </div>
    </div>`;
}

// ── Unit D pond level ─────────────────────────────────────────────────────────
// "▲ 2.5 in above normal" etc.; null when there's no reading or no normal level yet
function pondOffsetText(offset) {
    if (offset == null) return null;
    if (Math.abs(offset) < 0.1) return { arrow: '●', amount: 'At', words: 'normal level', cls: 'level-ok' };
    return offset > 0
        ? { arrow: '▲', amount: `${offset.toFixed(1)} in`, words: 'above normal', cls: 'level-up' }
        : { arrow: '▼', amount: `${Math.abs(offset).toFixed(1)} in`, words: 'below normal', cls: 'level-down' };
}

function renderPond() {
    const box = document.getElementById('pondLevel');
    if (!box.firstElementChild) {
        box.innerHTML = `
          <div class="pond-card">
            <div class="zone-header">
              <div>
                <div class="zone-name">Pond Level</div>
                <div class="zone-id">Ultrasonic sensor on Unit D · recorded every 30 minutes</div>
              </div>
              <button class="btn-close" id="pondNormalBtn" onclick="setPondNormal()">Set current level as normal</button>
            </div>
            <div class="pond-now"><span id="pondOffset" class="pond-offset"></span> <span id="pondDetail" class="zone-sensors"></span></div>
            <div class="pond-range">
              ${[[1, '24 hours'], [7, '7 days'], [30, '30 days']].map(([d, t]) =>
                `<button data-days="${d}" onclick="setPondDays(${d})">${t}</button>`).join('')}
            </div>
            <div class="pond-chart"><canvas id="pondChart" aria-label="Pond level graph"></canvas>
              <div id="pondChartEmpty" class="zone-sensors">No readings yet.</div></div>
          </div>`;
    }

    const online = pond?.online;
    const mm     = pond?.distance_mm;
    const off    = pondOffsetText(pond?.offset_in);
    const offEl  = document.getElementById('pondOffset');
    offEl.className   = 'pond-offset ' + (off?.cls || '');
    offEl.textContent = off ? `${off.arrow} ${off.amount} ${off.words}` : '';

    let detail;
    if (!online) {
        const seen = units[4]?.last_seen;
        detail = 'Unit D offline' + (seen ? ` — last seen ${new Date(seen).toLocaleString()}` : '');
    } else if (mm == null) {
        detail = 'No reading from the sensor — check its wiring';
    } else {
        detail = `Water is ${(mm / 25.4).toFixed(1)} in below the sensor`
            + (pond.normal_mm == null ? ' · normal level not set yet' : '');
    }
    document.getElementById('pondDetail').textContent = detail;
    document.getElementById('pondNormalBtn').disabled = !online || mm == null;
    document.querySelectorAll('.pond-range button').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.days) === pondDays));

    // A new reading is stored every 30 minutes, so refreshing the graph every 5 is plenty
    if (Date.now() - pondHistoryMs > 5 * 60000) loadPondHistory();
}

function setPondDays(days) {
    pondDays = days;
    try { localStorage.setItem('pondDays', days); } catch {}
    document.querySelectorAll('.pond-range button').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.days) === pondDays));
    loadPondHistory();
}

async function loadPondHistory() {
    pondHistoryMs = Date.now();
    try {
        const res  = await apiFetch(`/api/pond_level.php?days=${pondDays}`);
        const data = await res.json();
        drawPondChart(data.readings || [], data.pond?.normal_mm ?? null);
    } catch (e) {
        console.error('Pond history failed:', e);
    }
}

// Against the normal level once it's set; before that, inches below the sensor
// (drawn negative, so higher water is still higher on the graph)
function drawPondChart(readings, normalMm) {
    const empty = document.getElementById('pondChartEmpty');
    empty.style.display = readings.length ? 'none' : '';
    if (typeof Chart === 'undefined') { empty.textContent = 'Graph library did not load.'; empty.style.display = ''; return; }

    const css    = getComputedStyle(document.documentElement);
    const color  = n => css.getPropertyValue(n).trim();
    const points = readings.map(r => ({
        x: new Date(r.at.replace(' ', 'T')).getTime(),
        y: +((normalMm != null ? normalMm - r.mm : -r.mm) / 25.4).toFixed(1),
    }));
    const yTitle = normalMm != null ? 'Inches above / below normal' : 'Inches below sensor';
    const fmt    = ms => new Date(ms).toLocaleString([], pondDays === 1
        ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });

    if (pondChart) pondChart.destroy();
    pondChart = new Chart(document.getElementById('pondChart'), {
        type: 'line',
        data: { datasets: [{
            data: points, borderColor: color('--blue'), backgroundColor: color('--blue'),
            borderWidth: 2, pointRadius: points.length > 60 ? 0 : 2, tension: 0.25,
        }] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: {
                    title: items => new Date(items[0].parsed.x).toLocaleString(),
                    label: item => `${item.parsed.y > 0 ? '+' : ''}${item.parsed.y} in`,
                } },
            },
            scales: {
                x: { type: 'linear', ticks: { color: color('--muted'), callback: fmt, maxTicksLimit: 8 },
                     grid: { color: color('--border') } },
                y: { title: { display: true, text: yTitle, color: color('--muted') },
                     ticks: { color: color('--muted') },
                     grid: { color: ctx => normalMm != null && ctx.tick.value === 0 ? color('--green') : color('--border') } },
            },
        },
    });
}

async function setPondNormal() {
    const off = pond?.offset_in;
    const msg = 'Make the current pond level the normal level?'
        + (off != null ? `\n\nIt is now ${Math.abs(off).toFixed(1)} in ${off >= 0 ? 'above' : 'below'} the old normal.` : '');
    if (!confirm(msg)) return;
    const res  = await apiFetch('/api/pond_level.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_normal' }),
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    pond = data.pond;
    renderPond();
    loadPondHistory();
}

// ── Unit E ────────────────────────────────────────────────────────────────────
function renderExtraUnits() {
    const box = document.getElementById('extraUnits');
    // Don't rebuild while a dropdown is open — it would snap shut mid-choice
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;

    box.innerHTML = `
      <div class="zone-unit-header">Unit E — Pre-filter Flush &amp; Pond${wifiBadge(filter?.online, filter?.rssi, filter?.ap)}</div>
      ${filter ? pondDiagram() : ''}
      ${(filter?.filters || []).map(filterCard).join('')}
      ${filter?.drain ? drainCard(filter.drain) : ''}
      ${filter?.fill ? fillCard(filter.fill) : ''}
      ${filter?.tank_drain ? tankDrainCard(filter.tank_drain) : ''}`;
}

// WiFi signal from a unit's last report. Unit E's check-ins started failing at -83 dBm.
function wifiBadge(online, rssi, ap) {
    if (!online || rssi == null || rssi === 'null') return '';
    rssi = Number(rssi);
    const [label, cls] = rssi >= -67 ? ['good', 'good'] : rssi >= -75 ? ['fair', 'fair'] : ['weak', 'weak'];
    return `<span class="wifi-badge ${cls}" title="WiFi signal strength">WiFi ${rssi} dBm · ${label}${ap ? ` · ${escHtml(ap)}` : ''}</span>`;
}

function drainCard(d) {
    const want    = d.desired;
    const got     = d.reported;
    const online  = filter.online;
    const pending = online && got && got.seq !== want.seq;
    const pos     = got?.position_pct ?? 0;
    const isOpen  = online && got && (pos > 0 || got.moving);

    let detail, badge;
    if (!online) {
        detail = 'Unit E offline' + (filter.last_seen ? ` — last seen ${new Date(filter.last_seen).toLocaleString()}` : '');
    } else if (!got) {
        detail = 'Waiting for Unit E…';
    } else if (pending) {
        detail = 'Sending to Unit E…';
    } else if (got.moving) {
        detail = `Moving to ${got.target_pct === 0 ? 'closed' : got.target_pct + '% open'} — now about ${pos}%`;
    } else {
        detail = pos === 0 ? 'Closed' : pos === 100 ? 'Fully open' : `Partly open — ${pos}%`;
    }
    const mode    = pondMode();
    const filling = online && mode;
    const tank    = online && got?.tank;
    if (filling && !got.moving && !pending) {
        detail = `Fully open — ${mode} running (tank sensors ignored)`;
    } else if (tank?.full && !got.moving) {
        const back = got.user_pct === 100 ? 'fully open' : got.user_pct + '% open';
        detail = tank.fault
            ? 'Closed — tank sensor fault (top sensor wet, refill sensor dry)'
            : 'Closed — tank full' + (got.user_pct > 0 ? `, back to ${back} when it drops below the refill sensor` : '');
    }
    const tankLine = tank
        ? `<div class="zone-sensors">Tank: ${tank.top_wet ? 'at top sensor' : tank.refill_wet ? 'between sensors' : 'below refill sensor'}</div>`
        : '';
    badge = !isOpen ? 'Closed' : pos === 100 && !got.moving ? 'Open' : `${pos}%`;

    const partial = Array.from({ length: 9 }, (_, i) => (i + 1) * 10)
        .map(v => `<option value="${v}">${v}% open</option>`).join('');
    const busy = !online || !got || pending;

    return `
    <div class="zone-card special ${isOpen ? 'valve-open' : ''}" id="pond-drain">
      <div class="zone-header">
        <div>
          <div class="zone-name">Pond Drain</div>
          <div class="zone-id">2" drain valve</div>
        </div>
        <span class="valve-badge ${isOpen ? 'open' : 'closed'}">${badge}</span>
      </div>
      <div class="card-info">
        <div class="zone-sensors">${detail}</div>
        ${tankLine}
      </div>
      <div class="zone-actions">
        <button class="btn-open"  onclick="setDrain(100)" ${busy || (pos === 100 && !got?.moving && !filling) ? 'disabled' : ''}>Open</button>
        <button class="btn-close" onclick="setDrain(0)"   ${busy || (pos === 0 && !got?.moving) ? 'disabled' : ''}>Close</button>
      </div>
      <div class="card-fields">
        <label class="card-field">Partial open
          <select onchange="if (this.value) setDrain(parseInt(this.value))" ${busy ? 'disabled' : ''}>
            <option value="">Choose…</option>${partial}
          </select>
        </label>
      </div>
    </div>`;
}

async function setDrain(pct) {
    // Opening drains the pond — make sure it's intended. During Pond Fill or Storage Tank Drain
    // any drain button ends the run.
    const where = pct === 0 ? 'closed' : pct === 100 ? 'fully open' : pct + '% open';
    const mode  = pondMode();
    const question = mode
        ? `This ends ${mode}: ${mode === 'Storage Tank Drain' ? 'the tank drain closes and ' : ''}Pond Fill opens, then the Pond Drain goes to ${where}. Continue?`
        : pct > 0 ? `Open the Pond Drain ${pct === 100 ? 'fully' : 'to ' + pct + '%'}?` : null;
    if (question && !confirm(question)) {
        renderExtraUnits();
        return;
    }
    try {
        const res  = await apiFetch('/api/drain.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_pct: pct }),
        });
        const data = await res.json();
        if (!data.success) alert('Error: ' + (data.error || 'Unknown error'));
        document.activeElement?.blur();
        fetchAll();
        setTimeout(fetchAll, 3000);    // Unit E picks up changes within 2 s
    } catch (e) {
        if (e.message !== 'session_expired') alert('Network error — could not reach server.');
    }
}

// Pond Fill: normally open. A run opens the drain fully, then closes this valve.
function fillCard(p) {
    const want    = p.desired;
    const got     = p.reported;
    const online  = filter.online;
    const pending = online && got && got.seq !== want.seq;
    const active  = online && got?.active;
    const isOpen  = got ? got.valve === 'open' : true;
    const tankDraining = online && filter.tank_drain?.reported?.active;
    if (fillHoursChoice === null) fillHoursChoice = want.hours;

    let detail;
    if (!online) {
        detail = 'Unit E offline' + (filter.last_seen ? ` — last seen ${new Date(filter.last_seen).toLocaleString()}` : '');
    } else if (!got) {
        detail = 'Waiting for Unit E…';
    } else if (pending) {
        detail = 'Sending to Unit E…';
    } else if (got.moving) {
        detail = active || tankDraining ? 'Starting — opening the Pond Drain, then closing Pond Fill…'
                                        : 'Ending — opening Pond Fill, then the Pond Drain goes back to its setting…';
    } else if (active) {
        detail = `Filling the pond — ${formatDuration(got.remaining_s)} left`;
    } else if (tankDraining) {
        detail = 'Closed — Storage Tank Drain running (spring water goes back into the pond)';
    } else {
        detail = 'Open — water goes on to the storage tank';
    }

    const busy    = !online || !got || pending;
    const options = Array.from({ length: 24 }, (_, i) => i + 1)
        .map(h => `<option value="${h}" ${h === fillHoursChoice ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('');
    const badge   = got?.moving ? (got.valve === 'open' ? 'Opening' : 'Closing') : isOpen ? 'Open' : 'Closed';

    return `
    <div class="zone-card special ${active ? 'valve-open' : ''}" id="pond-fill">
      <div class="zone-header">
        <div>
          <div class="zone-name">Pond Fill</div>
          <div class="zone-id">2" valve — normally open</div>
        </div>
        <span class="valve-badge ${isOpen ? 'open' : 'closed'}">${badge}</span>
      </div>
      <div class="card-info"><div class="zone-sensors">${detail}</div></div>
      <div class="zone-actions">
        <button class="${active ? 'btn-close' : 'btn-open'}" onclick="${active ? 'stopFill()' : 'startFill()'}" ${busy ? 'disabled' : ''}>
          ${active ? 'Stop Pond Fill' : 'Start Pond Fill'}
        </button>
      </div>
      <div class="card-fields">
        <label class="card-field">Run time
          <select onchange="fillHoursChoice = parseInt(this.value)" ${busy || active ? 'disabled' : ''}>${options}</select>
        </label>
      </div>
    </div>`;
}

async function startFill() {
    const h = fillHoursChoice;
    if (!confirm(`Fill the pond for ${h} hour${h > 1 ? 's' : ''}? The Pond Drain opens fully, then Pond Fill closes.`)) return;
    await unitECmd('/api/fill.php', { hours: h });
}

async function stopFill() {
    if (!confirm('Stop Pond Fill? Pond Fill opens, then the Pond Drain goes back to its last setting.')) return;
    await unitECmd('/api/fill.php', { stop: true });
}

// Storage Tank Drain: normally closed. A run opens the Pond Drain fully and closes Pond
// Fill (so no spring water reaches the tank), then opens this valve.
function tankDrainCard(t) {
    const want    = t.desired;
    const got     = t.reported;
    const online  = filter.online;
    const pending = online && got && got.seq !== want.seq;
    const active  = online && got?.active;
    const isOpen  = online && got?.valve === 'open';
    if (tankDrainMinutesChoice === null) tankDrainMinutesChoice = want.minutes;

    let detail;
    if (!online) {
        detail = 'Unit E offline' + (filter.last_seen ? ` — last seen ${new Date(filter.last_seen).toLocaleString()}` : '');
    } else if (!got) {
        detail = 'Waiting for Unit E…';
    } else if (pending) {
        detail = 'Sending to Unit E…';
    } else if (got.moving) {
        detail = !active ? 'Ending — closing the tank drain, then Pond Fill opens…'
               : isOpen  ? 'Opening the tank drain…'
               : 'Starting — opening the Pond Drain and closing Pond Fill, then the tank drain opens…';
    } else if (active) {
        detail = `Draining the tank — ${formatDuration(got.remaining_s)} left`;
    } else {
        detail = 'Closed';
    }

    const busy    = !online || !got || pending;
    const options = Array.from({ length: 12 }, (_, i) => (i + 1) * 10)
        .map(m => `<option value="${m}" ${m === tankDrainMinutesChoice ? 'selected' : ''}>${m} minutes</option>`).join('');
    const badge   = isOpen ? (got.moving ? 'Opening' : 'Open') : got?.moving && !active ? 'Closing' : 'Closed';

    return `
    <div class="zone-card special ${isOpen ? 'valve-open' : ''}" id="tank-drain">
      <div class="zone-header">
        <div>
          <div class="zone-name">Storage Tank Drain</div>
          <div class="zone-id">1" valve — normally closed</div>
        </div>
        <span class="valve-badge ${isOpen ? 'open' : 'closed'}">${badge}</span>
      </div>
      <div class="card-info"><div class="zone-sensors">${detail}</div></div>
      <div class="zone-actions">
        <button class="${active ? 'btn-close' : 'btn-open'}" onclick="${active ? 'stopTankDrain()' : 'startTankDrain()'}" ${busy ? 'disabled' : ''}>
          ${active ? 'Stop draining' : 'Drain Tank'}
        </button>
      </div>
      <div class="card-fields">
        <label class="card-field">Run time
          <select onchange="tankDrainMinutesChoice = parseInt(this.value)" ${busy || active ? 'disabled' : ''}>${options}</select>
        </label>
      </div>
    </div>`;
}

async function startTankDrain() {
    const m = tankDrainMinutesChoice;
    if (!confirm(`Drain the storage tank for ${m} minutes? The Pond Drain opens fully and Pond Fill closes first, then the tank drain opens.`)) return;
    await unitECmd('/api/tank_drain.php', { minutes: m });
}

async function stopTankDrain() {
    if (!confirm('Stop draining the tank? The tank drain closes, then Pond Fill opens and the Pond Drain goes back to its last setting.')) return;
    await unitECmd('/api/tank_drain.php', { stop: true });
}

// Which run is holding the Pond Drain open and Pond Fill closed, if any
function pondMode() {
    if (!filter?.online) return null;
    return filter.tank_drain?.reported?.active ? 'Storage Tank Drain'
         : filter.fill?.reported?.active       ? 'Pond Fill' : null;
}

async function unitECmd(path, body) {
    try {
        const res  = await apiFetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.success) alert('Error: ' + (data.error || 'Unknown error'));
        fetchAll();
        setTimeout(fetchAll, 3000);    // Unit E picks up changes within 2 s
    } catch (e) {
        if (e.message !== 'session_expired') alert('Network error — could not reach server.');
    }
}

// Live plumbing picture: pond → Pond Drain → T (spring water joins) → Pond Fill →
// pre-filters (in parallel) → storage tank → pump → Orival auto filter → irrigation zones,
// plus the Storage Tank Drain near the bottom of the tank. Pipes with
// water moving in them are blue and animated, so anyone can see where it's going.
function pondDiagram() {
    const online   = filter.online;
    const d        = online ? filter.drain?.reported : null;
    const p        = online ? filter.fill?.reported  : null;
    const td       = online ? filter.tank_drain?.reported : null;
    const tankDrainOpen = td?.valve === 'open';
    const tank     = d?.tank;
    const drainPct = d?.position_pct ?? 0;
    const drainOpen = drainPct > 0;
    const fillOpen  = p ? p.valve === 'open' : true;
    const flushing  = [1, 2].map(n => online && filter.filters?.find(f => f.filter === n)?.reported?.valve === 'open');

    // Water only moves when the valves give it somewhere to go
    const springFlows = online && (fillOpen || drainOpen);
    const toTank      = online && fillOpen;
    const pondFlows   = online && drainOpen;   // out of the pond, or back into it when Pond Fill is closed

    const pipe = (path, flowing, rev = false) =>
        `<path class="pipe${flowing ? ' flow' : ''}${rev ? ' rev' : ''}" d="${path}"/>`;
    const valve = (x, y, state, vertical = false) => {
        const pts = vertical
            ? `${x-10},${y-14} ${x+10},${y+14} ${x-10},${y+14} ${x+10},${y-14}`
            : `${x-14},${y-10} ${x+14},${y+10} ${x+14},${y-10} ${x-14},${y+10}`;
        return `<polygon class="pd-valve ${state}" points="${pts}"/>`;
    };
    const drainState = !d ? 'unknown' : d.moving ? 'moving' : drainOpen ? 'open' : 'closed';
    const fillState  = !p ? 'unknown' : p.moving ? 'moving' : fillOpen ? 'open' : 'closed';
    const drainText  = !d ? '—' : d.moving ? 'moving' : drainPct === 0 ? 'closed' : drainPct === 100 ? 'open' : `${drainPct}% open`;
    const fillText   = !p ? '—' : p.moving ? (fillOpen ? 'opening' : 'closing') : p.valve;
    const tdState    = !td ? 'unknown' : td.moving && (tankDrainOpen || !td.active) ? 'moving' : tankDrainOpen ? 'open' : 'closed';
    const tdText     = !td ? '—' : tdState === 'moving' ? (tankDrainOpen ? 'opening' : 'closing') : tdState;
    const flushState = i => !online ? 'unknown' : flushing[i] ? 'open' : 'closed';
    const sensor     = (y, wet) => `<circle class="pd-sensor ${!tank ? 'unknown' : wet ? 'wet' : ''}" cx="700" cy="${y}" r="5"/>`;
    const waterTop   = !tank ? 215 : tank.top_wet ? 180 : tank.refill_wet ? 205 : 235;

    // Pond level from Unit D, beside the pond
    const lvl      = pondOffsetText(pond?.online ? pond.offset_in : null);
    const pondText = lvl ? `
          <text class="pd-label ${lvl.cls}" x="182" y="56">${lvl.arrow} ${lvl.amount}</text>
          <text class="pd-note" x="182" y="72">${lvl.words}</text>` : '';

    let caption;
    if (!online) {
        caption = 'Unit E is offline, so the valve positions are unknown.';
    } else if (d?.moving || p?.moving || td?.moving) {
        caption = 'A valve is moving — the picture updates when it stops.';
    } else if (tankDrainOpen) {
        caption = (td.active ? `Storage Tank Drain is running (${formatDuration(td.remaining_s)} left). ` : '')
            + 'The storage tank is emptying through its drain. Pond Fill is closed, '
            + 'so the spring water flows back through the open Pond Drain into the pond.';
    } else if (drainOpen && !fillOpen) {
        caption = (p.active ? `Pond Fill is running (${formatDuration(p.remaining_s)} left). ` : '')
            + "Pond Fill is closed, so the spring water can't reach the storage tank. "
            + 'It flows back through the open Pond Drain into the pond.';
    } else if (drainOpen) {
        caption = `The pond is draining${drainPct < 100 ? ` (Pond Drain ${drainPct}% open)` : ''}. `
            + 'Pond water joins the spring water and goes through the pre-filters to the storage tank.';
    } else if (fillOpen) {
        caption = 'Pond Drain is closed, so the pond is cut off. '
            + 'Spring water flows through Pond Fill and the pre-filters to the storage tank.';
    } else {
        caption = 'Pond Drain and Pond Fill are both closed, so no water reaches the storage tank.';
    }
    flushing.forEach((on, i) => { if (on) caption += ` Pre-filter ${i + 1} is flushing.`; });

    return `
    <details class="pond-diagram" ${pondDiagramOpen ? 'open' : ''} ontoggle="togglePondDiagram(this)">
      <summary>How the pond valves work</summary>
      <div class="pd-scroll">
        <svg viewBox="0 0 890 312" role="img" aria-label="Pond and storage tank plumbing">
          ${pipe('M95 90 V140 H300', pondFlows, !fillOpen)}
          ${pipe('M300 20 V140', springFlows)}
          ${pipe('M300 140 H420', toTank)}
          ${pipe('M420 140 V95 H540 V140', toTank)}
          ${pipe('M420 140 V185 H540 V140', toTank)}
          ${pipe('M540 140 H610 V165', toTank)}
          ${pipe('M485 83 V40', toTank && flushing[0])}
          ${pipe('M485 197 V245', toTank && flushing[1])}
          ${pipe('M665 248 V130 H880', false)}
          ${pipe('M580 262 H505', online && tankDrainOpen)}

          <path class="pd-water" d="M20 30 H170 V70 Q170 90 150 90 H40 Q20 90 20 70 Z"/>
          <text class="pd-label" x="95" y="64" text-anchor="middle">Pond</text>${pondText}
          <text class="pd-label" x="310" y="24">Spring</text>
          <circle class="pd-tee" cx="300" cy="140" r="5"/>

          ${valve(215, 140, drainState)}
          <text class="pd-label" x="215" y="168" text-anchor="middle">Pond Drain</text>
          <text class="pd-note"  x="215" y="183" text-anchor="middle">${drainText}</text>
          ${valve(365, 140, fillState)}
          <text class="pd-label" x="365" y="168" text-anchor="middle">Pond Fill</text>
          <text class="pd-note"  x="365" y="183" text-anchor="middle">${fillText}</text>

          <rect class="pd-box" x="455" y="83"  width="60" height="24" rx="4"/>
          <text class="pd-note" x="485" y="99"  text-anchor="middle">Filter 1</text>
          <rect class="pd-box" x="455" y="173" width="60" height="24" rx="4"/>
          <text class="pd-note" x="485" y="189" text-anchor="middle">Filter 2</text>
          ${valve(485, 62, flushState(0), true)}
          <text class="pd-note" x="499" y="46">flush</text>
          ${valve(485, 222, flushState(1), true)}
          <text class="pd-note" x="499" y="244">flush</text>

          <rect class="pd-box" x="580" y="165" width="120" height="110" rx="4"/>
          <rect class="pd-water" x="582" y="${waterTop}" width="116" height="${273 - waterTop}"/>
          ${sensor(185, tank?.top_wet)}
          <text class="pd-note" x="710" y="189">top sensor</text>
          ${sensor(215, tank?.refill_wet)}
          <text class="pd-note" x="710" y="219">refill sensor</text>
          <rect class="pd-box" x="650" y="248" width="30" height="20" rx="3"/>
          <text class="pd-note" x="645" y="262" text-anchor="end">pump</text>
          <text class="pd-label" x="640" y="292" text-anchor="middle">Storage tank</text>
          ${valve(548, 262, tdState)}
          <text class="pd-label" x="548" y="290" text-anchor="middle">Tank Drain</text>
          <text class="pd-note"  x="548" y="305" text-anchor="middle">${tdText}</text>
          <text class="pd-note"  x="500" y="266" text-anchor="end">outlet</text>
          <rect class="pd-box" x="690" y="117" width="80" height="26" rx="4"/>
          <text class="pd-note" x="730" y="134" text-anchor="middle">Auto filter</text>
          <text class="pd-label" x="730" y="108" text-anchor="middle">Orival ORG 3"</text>
          <text class="pd-note" x="730" y="158" text-anchor="middle">Omnitrol 300</text>
          <text class="pd-note" x="885" y="160" text-anchor="end">to irrigation zones</text>
        </svg>
      </div>
      <p class="pd-caption">${caption}</p>
      <ul class="pd-legend">
        <li><b>Pond Drain</b> opens the pipe from the bottom of the pond. Normally closed.</li>
        <li><b>Pond Fill</b> sits after the T where the spring water joins. Normally open, so water goes on to the tank. <b>Start Pond Fill</b> opens Pond Drain and closes Pond Fill, so the spring water runs back up into the pond.</li>
        <li><b>Pre-filters</b> are in parallel just before the tank. Each one flushes on its own cycle.</li>
        <li><b>Storage tank</b> level sensors close Pond Drain when the tank is full. The submersible pump feeds the irrigation zones.</li>
        <li><b>Storage Tank Drain</b> empties the tank through an outlet near its bottom. <b>Drain Tank</b> opens Pond Drain and closes Pond Fill first, so no spring water flows into the tank while it drains.</li>
        <li><b>Auto filter</b> (Orival ORG/B-030-LE) cleans the pumped water before the zones. Its Omnitrol 300 controller flushes the screen on its own.</li>
      </ul>
    </details>`;
}

function togglePondDiagram(el) {
    pondDiagramOpen = el.open;
    try { localStorage.setItem('pondDiagramOpen', el.open); } catch {}
}

function filterCard(f) {
    const want    = f.desired;
    const got     = f.reported;
    const isOpen  = filter.online && got?.valve === 'open';
    const pending = filter.online && got && (got.cycle_enabled !== want.cycle_enabled
                    || got.flush_sec !== want.flush_sec || got.wait_min !== want.wait_min);

    let detail;
    if (!filter.online) {
        detail = 'Unit E offline' + (filter.last_seen ? ` — last seen ${new Date(filter.last_seen).toLocaleString()}` : '');
    } else if (!got) {
        detail = 'Waiting for Unit E…';
    } else if (pending) {
        detail = 'Sending to Unit E…';
    } else if (isOpen) {
        detail = `Flushing — ${got.flush_remaining_s}s left`;
    } else if (got.cycle_enabled && got.waiting) {
        detail = 'Waiting — flushes when the other pre-filter closes';
    } else if (got.cycle_enabled) {
        detail = `Cycle running — next flush in ${formatDuration(got.next_flush_in_s ?? 0)}`;
    } else {
        detail = 'Cycle stopped';
    }

    const options = (unit, selected) => Array.from({ length: 12 }, (_, i) => (i + 1) * 10)
        .map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${v} ${unit}</option>`).join('');

    return `
    <div class="zone-card ${isOpen ? 'valve-open' : ''}" id="filter-${f.filter}">
      <div class="zone-header">
        <div>
          <div class="zone-name">${escHtml(f.name)}</div>
          <div class="zone-id">Automatic flush cycle</div>
        </div>
        <span class="valve-badge ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>
      </div>
      <div class="card-info"><div class="zone-sensors">${detail}</div></div>
      <div class="zone-actions">
        <button class="${want.cycle_enabled ? 'btn-close' : 'btn-open'}"
          onclick="setFilterCycle(${f.filter}, { cycle_enabled: ${!want.cycle_enabled} })">
          ${want.cycle_enabled ? 'Stop flush cycle' : 'Start flush cycle'}
        </button>
      </div>
      <div class="card-fields">
        <label class="card-field">Flush period
          <select onchange="setFilterCycle(${f.filter}, { flush_sec: parseInt(this.value) })">${options('seconds', want.flush_sec)}</select>
        </label>
        <label class="card-field">Wait time between flushes
          <select onchange="setFilterCycle(${f.filter}, { wait_min: parseInt(this.value) })">${options('minutes', want.wait_min)}</select>
        </label>
      </div>
    </div>`;
}

async function setFilterCycle(n, changes) {
    try {
        const res  = await apiFetch('/api/filter.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filter: n, ...changes }),
        });
        const data = await res.json();
        if (!data.success) alert('Error: ' + (data.error || 'Unknown error'));
        document.activeElement?.blur();
        fetchAll();
        setTimeout(fetchAll, 3000);    // Unit E picks up changes within 2 s
    } catch (e) {
        if (e.message !== 'session_expired') alert('Network error — could not reach server.');
    }
}

// ── Valve command ─────────────────────────────────────────────────────────────
async function valveCmd(zoneId, open) {
    const card = document.getElementById(`zone-${zoneId}`);
    card.querySelectorAll('button').forEach(b => b.disabled = true);

    try {
        const res  = await apiFetch('/api/valve.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zone_id: zoneId, open }),
        });
        const data = await res.json();
        if (!data.success) {
            alert('Error: ' + (data.error || 'Unknown error'));
        }
        fetchAll();
    } catch (e) {
        if (e.message !== 'session_expired') {
            alert('Network error — could not reach server.');
            card.querySelectorAll('button').forEach(b => b.disabled = false);
        }
    }
}

// ── Schedules ─────────────────────────────────────────────────────────────────
function renderSchedules() {
    const tbody = document.querySelector('#schedulesTable tbody');
    if (!schedules.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center">No schedules</td></tr>';
        return;
    }
    tbody.innerHTML = schedules.map(s => `
        <tr>
          <td>${escHtml(s.zone_name)}</td>
          <td>${escHtml(s.name || '—')}</td>
          <td><code>${escHtml(s.cron_expression)}</code></td>
          <td>${formatDuration(s.duration_sec)}</td>
          <td>${s.skip_if_moist ? `&gt;${s.skip_threshold}%` : 'No'}</td>
          <td>
            <label class="toggle" title="Enable/disable">
              <input type="checkbox" ${s.enabled ? 'checked' : ''}
                onchange="toggleSchedule(${s.id}, this.checked)">
              <span class="slider"></span>
            </label>
          </td>
          <td><button class="btn-danger" onclick="deleteSchedule(${s.id})">Delete</button></td>
        </tr>`).join('');
}

function openScheduleModal() {
    const sel = document.getElementById('schedZone');
    // Irrigation zones only — Unit E flush valves run on their own cycle
    sel.innerHTML = zones.map(z => `<option value="${z.id}">Zone ${z.id} — ${escHtml(z.name)}</option>`).join('');
    document.getElementById('scheduleModal').classList.remove('hidden');
}

function closeScheduleModal() {
    document.getElementById('scheduleModal').classList.add('hidden');
    document.getElementById('scheduleForm').reset();
}

async function submitSchedule(e) {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const body = {
        zone_id:         parseInt(fd.get('zone_id')),
        name:            fd.get('name'),
        cron_expression: fd.get('cron_expression'),
        duration_sec:    parseInt(fd.get('duration_sec')),
        skip_if_moist:   fd.get('skip_if_moist') === 'on',
        skip_threshold:  parseInt(fd.get('skip_threshold')),
    };
    const res = await apiFetch('/api/schedules.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) { closeScheduleModal(); fetchAll(); }
    else alert('Error: ' + data.error);
}

async function toggleSchedule(id, enabled) {
    await apiFetch('/api/schedules.php', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
    });
    fetchAll();
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    await apiFetch('/api/schedules.php', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    fetchAll();
}

// ── Events table ──────────────────────────────────────────────────────────────
function renderEvents(events) {
    const tbody = document.querySelector('#eventsTable tbody');
    if (!events.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center">No events in the last 48 hours</td></tr>';
        return;
    }
    tbody.innerHTML = events.map(ev => `
        <tr>
          <td>${new Date(ev.executed_at).toLocaleString()}</td>
          <td>${ev.zone_id > 15 ? '' : `Zone ${ev.zone_id} — `}${escHtml(ev.zone_name)}</td>
          <td><span style="color:${ev.action==='open'?'var(--green)':'var(--muted)'}">${ev.action.toUpperCase()}</span></td>
          <td>${escHtml(ev.notes || ev.trigger_type)}</td>
          <td>${escHtml(ev.initiated_by || '—')}</td>
        </tr>`).join('');
}

// ── Auto mode toggle ──────────────────────────────────────────────────────────
async function toggleAutoMode(e) {
    const toggle = e.target;
    toggle.disabled = true;
    try {
        const res  = await apiFetch('/api/settings.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'auto_mode_enabled', value: toggle.checked ? 'true' : 'false' }),
        });
        const data = await res.json();
        if (!data.success) {
            toggle.checked = !toggle.checked;
            alert('Error: ' + (data.error || 'Could not save Auto Mode'));
        }
    } catch (err) {
        if (err.message !== 'session_expired') {
            toggle.checked = !toggle.checked;
            alert('Network error — Auto Mode not changed.');
        }
    } finally {
        toggle.disabled = false;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatDuration(sec) {
    if (sec < 60)  return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec/60)}m ${sec%60}s`;
    return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
}
