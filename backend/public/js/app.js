// ── State ─────────────────────────────────────────────────────────────────────
let zones = [], units = {}, pendingZone = null, filter = null, drainFollowTimer = null, zoneFollowTimer = null;
let fillHoursChoice = null;   // Pond Fill run time picked on the card (sent with Start)
let tankDrainMinutesChoice = null;   // Storage Tank Drain run time picked on the card
let automation = null, autoSaving = false;   // Automation panel rules (api/automation.php)
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

    document.getElementById('autoToggle').addEventListener('change', toggleAutoMode);
});

function clockTick() {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString();
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchAll() {
    try {
        const [statusRes, eventsRes, filterRes, autoRes] = await Promise.all([
            apiFetch('/api/status.php'),
            apiFetch('/api/events.php'),
            apiFetch('/api/filter.php'),
            apiFetch('/api/automation.php'),
        ]);
        const status = await statusRes.json();
        const events = await eventsRes.json();
        filter       = await filterRes.json();
        automation   = await autoRes.json();

        zones     = status.zones     || [];
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
        renderAutomation();
        renderSchedule();
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
      ${helpBtn(z.id == 1 ? 'creek' : z.id == 21 ? 'fountain' : 'zone')}
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
            ${helpBtn('pond')}
            <div class="zone-header">
              <div>
                <div class="zone-name">Pond Level</div>
                <div class="zone-id">Ultrasonic sensor on Unit D · recorded every 30 minutes</div>
              </div>
              <button class="btn-close" id="pondNormalBtn" onclick="setPondNormal()">Set current level as normal</button>
            </div>
            <div class="pond-now"><span id="pondOffset" class="pond-offset"></span> <span id="pondDetail" class="zone-sensors"></span>
              <div id="pondTrend" class="zone-sensors pond-trend"></div></div>
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
        drawPondChart(data);
        renderPondTrend(data.trend);
    } catch (e) {
        console.error('Pond history failed:', e);
    }
}

// Against the normal level once it's set; before that, inches below the sensor
// (drawn negative, so higher water is still higher on the graph).
// 24 hours: the 3-hour average held steady until it moves more than 0.5 in (the
// sensor's accuracy). 7 and 30 days: one average per day, so slow changes such as
// evaporation show as a slope.
function drawPondChart(data) {
    const normalMm = data.pond?.normal_mm ?? null;
    const daily    = pondDays !== 1;
    const rows     = daily ? (data.daily || []) : (data.readings || []);
    const empty = document.getElementById('pondChartEmpty');
    empty.style.display = rows.length ? 'none' : '';
    if (typeof Chart === 'undefined') { empty.textContent = 'Graph library did not load.'; empty.style.display = ''; return; }

    const css    = getComputedStyle(document.documentElement);
    const color  = n => css.getPropertyValue(n).trim();
    const inches = mm => +((normalMm != null ? normalMm - mm : -mm) / 25.4).toFixed(2);
    const toF    = c => c != null ? (c * 9 / 5 + 32).toFixed(1) : null;
    const points = rows.map(r => ({
        x: new Date(r.at.replace(' ', 'T')).getTime(),
        y: daily ? inches(r.mm) : inches(r.level_mm ?? r.avg_mm ?? r.mm),
        avg: daily ? null : inches(r.avg_mm ?? r.mm),
        raw: daily ? null : inches(r.mm),
        tempF: toF(r.temp_c),
        date: r.date, count: r.count,
    }));
    const signed = v => `${v > 0 ? '+' : ''}${v} in`;
    const yTitle = normalMm != null ? 'Inches above / below normal' : 'Inches below sensor';
    const fmt    = ms => new Date(ms).toLocaleString([], daily
        ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' });
    // Show at least 1 inch top to bottom, so a few hundredths don't fill the graph
    const ys  = points.map(p => p.y);
    const mid = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

    const tooltipLines = p => daily
        ? [`Daily average ${signed(p.y.toFixed(2))}`,
           `${p.count} reading${p.count === 1 ? '' : 's'}`,
           ...(p.tempF != null ? [`Average temperature ${p.tempF} °F`] : [])]
        : [`Level ${signed(p.y.toFixed(1))}`,
           `3-hour average ${signed(p.avg.toFixed(2))}`,
           `Reading ${signed(p.raw.toFixed(2))}`,
           ...(p.tempF != null ? [`Temperature ${p.tempF} °F`] : [])];

    if (pondChart) pondChart.destroy();
    pondChart = new Chart(document.getElementById('pondChart'), {
        type: 'line',
        data: { datasets: [{
            data: points, borderColor: color('--blue'), backgroundColor: color('--blue'),
            borderWidth: 2,
            ...(daily ? { pointRadius: 3, tension: 0 }
                      : { pointRadius: points.length > 60 ? 0 : 2, stepped: true }),
        }] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: {
                    title: items => {
                        const p = items[0].raw;
                        return p.date
                            ? new Date(p.date + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
                            : new Date(p.x).toLocaleString();
                    },
                    label: item => tooltipLines(item.raw),
                } },
            },
            scales: {
                x: { type: 'linear', ticks: { color: color('--muted'), callback: fmt, maxTicksLimit: 8 },
                     grid: { color: color('--border') } },
                y: { title: { display: true, text: yTitle, color: color('--muted') },
                     suggestedMin: mid - 0.5, suggestedMax: mid + 0.5,
                     ticks: { color: color('--muted') },
                     grid: { color: ctx => normalMm != null && ctx.tick.value === 0 ? color('--green') : color('--border') } },
            },
        },
    });
}

// "Trend over 7 days: falling 0.12 in/day" from a straight-line fit on the server
function renderPondTrend(trend) {
    const el = document.getElementById('pondTrend');
    if (!trend) { el.textContent = 'Trend: needs 2 days of readings'; return; }
    const span = trend.days < 7 ? `${trend.days} days` : '7 days';
    el.textContent = trend.steady
        ? `Trend over ${span}: steady (under 0.02 in/day)`
        : `Trend over ${span}: ${trend.in_per_day > 0 ? 'rising' : 'falling'} ${Math.abs(trend.in_per_day).toFixed(2)} in/day`;
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
        ? `<div class="zone-sensors">Tank: ${tank.top_wet ? 'at top sensor' : tank.refill_wet ? 'between sensors'
             : tank.low_wet === undefined ? 'below refill sensor'
             : tank.low_wet ? 'below refill sensor' : tank.empty_wet ? 'below low level sensor' : 'empty'}</div>`
        : '';
    badge = !isOpen ? 'Closed' : pos === 100 && !got.moving ? 'Open' : `${pos}%`;

    const partial = Array.from({ length: 9 }, (_, i) => (i + 1) * 10)
        .map(v => `<option value="${v}">${v}% open</option>`).join('');
    const busy = !online || !got || pending;

    return `
    <div class="zone-card special ${isOpen ? 'valve-open' : ''}" id="pond-drain">
      ${helpBtn('drain')}
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
      ${helpBtn('fill')}
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
      ${helpBtn('tankDrain')}
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
    // Low level and tank empty sensors aren't fitted yet: grey until Unit E reports them
    const sensor     = (y, wet) => `<circle class="pd-sensor ${!tank || wet === undefined ? 'unknown' : wet ? 'wet' : ''}" cx="700" cy="${y}" r="5"/>`;
    const hasLow     = tank && tank.low_wet !== undefined && tank.empty_wet !== undefined;
    const waterTop   = !tank ? 215 : tank.top_wet ? 180 : tank.refill_wet ? 205
                     : !hasLow ? 230 : tank.low_wet ? 230 : tank.empty_wet ? 252 : 268;

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
          ${sensor(240, tank ? tank.low_wet : undefined)}
          <text class="pd-note" x="710" y="244">low level sensor${hasLow ? '' : ' (not fitted yet)'}</text>
          ${sensor(262, tank ? tank.empty_wet : undefined)}
          <text class="pd-note" x="710" y="266">tank empty sensor${hasLow ? '' : ' (not fitted yet)'}</text>
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
      ${helpBtn('filter')}
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
    card.querySelectorAll('button:not(.help-btn)').forEach(b => b.disabled = true);

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

// ── Automation ────────────────────────────────────────────────────────────────
// Rule cards are built once and rebuilt only after a save, so polling never resets a
// choice being made; the status lines update on every poll. Each change saves at once.
const POND_SOURCE_DETAIL = {
    pond_fill: 'Unit E — spring water to the pond',
    creek:     'Zone 1, Unit A',
    fountain:  'Zone 21, Unit D',
};

function inchText(v) {
    return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} in`;
}

function renderAutomation() {
    const rules = document.getElementById('automationRules');
    const rule  = automation?.pond_level;
    if (!rule) { rules.innerHTML = '<div class="loading">Automation not available.</div>'; return; }
    if (!document.getElementById('autoPondWrap')) {
        rules.innerHTML = '<div id="autoPondWrap"></div><div id="autoTimedWrap"></div><div id="autoZoneWrap"></div>';
    }
    renderTimedRuns();
    const box = document.getElementById('autoPondWrap');

    const note = document.getElementById('automationNote');
    note.textContent = rule.auto_mode ? '' : 'Auto Mode is off, so automations are paused. Turn it on at the top of the page.';
    note.classList.toggle('hidden', rule.auto_mode);

    if (!document.getElementById('autoPond')) {
        const c = rule.config, ch = rule.choices;
        const opts = (list, sel) => list.map(v =>
            `<option value="${v}" ${Number(v) === Number(sel) ? 'selected' : ''}>${inchText(v)}</option>`).join('');
        box.innerHTML = `
          <div class="auto-rule" id="autoPond">
            ${helpBtn('autoPond')}
            <div class="auto-rule-head">
              <h3>Pond level</h3>
              <label class="toggle" title="Turn this rule on or off">
                <input type="checkbox" id="apEnabled" ${rule.enabled ? 'checked' : ''} onchange="savePondRule()">
                <span class="slider"></span>
              </label>
            </div>
            <div class="auto-line">When the pond is
              <select id="apBelow" onchange="savePondRule()">${opts(ch.below_in, c.below_in)}</select>
              below full, fill it with:</div>
            <div class="auto-radios" role="radiogroup" aria-label="How to fill the pond">
              ${Object.entries(ch.sources).map(([k, label]) => `
                <label class="auto-radio">
                  <input type="radio" name="apSource" value="${k}" ${c.source === k ? 'checked' : ''} onchange="savePondRule()">
                  <span><strong>${escHtml(label)}</strong> <small>${escHtml(POND_SOURCE_DETAIL[k] || '')}</small></span>
                </label>`).join('')}
            </div>
            <div class="auto-line auto-muted">…until it's back to full (the normal level set on the Pond Level card).</div>
            <div class="auto-line">Low water mark:
              <select id="apLow" onchange="savePondRule()">${opts(ch.low_mark_in, c.low_mark_in)}</select>
              below full</div>
            <div class="auto-line auto-muted">At the low water mark the Pond Drain closes, so the tanks stop taking pond water. It goes back to where it was once the pond is 0.5 in above the mark.</div>
            <div class="auto-line auto-override">
              <label class="toggle" title="Override">
                <input type="checkbox" id="apAllowLow" ${c.allow_below_low ? 'checked' : ''} onchange="savePondRule(this)">
                <span class="slider"></span>
              </label>
              <span><strong>Override:</strong> allow the pond to go below the low water mark</span>
            </div>
            <div class="auto-status" id="apStatus"></div>
          </div>`;
    }

    // Status
    const lines = [];
    const src   = rule.choices.sources[rule.config.source];
    if (!rule.normal_set)            lines.push('⚠ Set the normal level on the Pond Level card first. Until then the rule can\'t tell how full the pond is.');
    else if (rule.below_in === null) lines.push('Pond level unknown: no reading from Unit D in the last hour.');
    else lines.push(rule.below_in > 0
        ? `Pond is ${inchText(rule.below_in.toFixed(1))} below full (3-hour average).`
        : `Pond is at or above full (${inchText(Math.abs(rule.below_in).toFixed(1))} above, 3-hour average).`);
    if (rule.filling) lines.push(`<strong class="auto-on">Filling with ${escHtml(rule.choices.sources[rule.filling])}</strong> since ${new Date(rule.started_at).toLocaleString()}.`);
    else if (rule.enabled && rule.auto_mode) lines.push(`Waiting. ${escHtml(src)} starts when the pond is ${inchText(rule.config.below_in)} below full.`);
    else if (!rule.enabled) lines.push('Rule is off.');
    if (rule.drain_held_pct !== null) lines.push(`<strong class="auto-warn">Pond Drain held closed</strong> (was ${rule.drain_held_pct}%). The pond is at the low water mark.`);
    if (!rule.source_online) lines.push(`<span class="auto-warn">⚠ ${escHtml(src)} is on a unit that's offline, so it can't run.</span>`);
    if (rule.last_action) lines.push(`<span class="auto-muted">Last: ${escHtml(rule.last_action)} (${new Date(rule.last_at).toLocaleString()})</span>`);
    document.getElementById('apStatus').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

async function savePondRule(changed) {
    if (autoSaving) return;
    const box = document.getElementById('autoPond');
    // Ask before letting the pond drop below the low water mark
    if (changed?.id === 'apAllowLow' && changed.checked
        && !confirm('Allow the pond to go below the low water mark? The Pond Drain will be left alone even when the pond is that low.')) {
        changed.checked = false;
        return;
    }
    const body = {
        kind: 'pond_level',
        enabled: document.getElementById('apEnabled').checked,
        config: {
            below_in:        parseFloat(document.getElementById('apBelow').value),
            source:          box.querySelector('input[name="apSource"]:checked')?.value,
            low_mark_in:     parseFloat(document.getElementById('apLow').value),
            allow_below_low: document.getElementById('apAllowLow').checked,
        },
    };
    autoSaving = true;
    box.querySelectorAll('input, select').forEach(el => el.disabled = true);
    try {
        const res  = await apiFetch('/api/automation.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) alert('Not saved: ' + data.error);
        else automation = data;
    } catch (err) {
        if (err.message !== 'session_expired') alert('Network error — rule not saved.');
    } finally {
        autoSaving = false;
        box.remove();   // rebuild from the saved rule (or put the old choices back)
        renderAutomation();
    }
}

// Timed runs and Zone watering: run a source for 20 min–6 h from start times on chosen
// days. Both cards come from the one saved list (pond sources on Timed runs, irrigation
// zones on Zone watering). A card is rebuilt after each save (or if its list changed in
// another window); polling only updates each run's status line.
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RUN_CARDS = [
    { wrap: 'autoTimedWrap', id: 'autoTimed', title: 'Timed runs', zones: false, add: '+ Add timed run',
      empty: 'No timed runs yet. Add one to run the Creek, the Pond Fountain or Pond Fill at set times.',
      fresh: { source: 'fountain', minutes: 60 } },
    { wrap: 'autoZoneWrap', id: 'autoZones', title: 'Zone watering', zones: true, add: '+ Add zone watering',
      empty: 'No zone watering yet. Add one to water a zone at set times, skipping it when the soil is already wet.',
      fresh: { source: 'zone22', minutes: 20, skip_above_pct: 60 } },
];
let timedSaving = false;

function minutesText(m) {
    const h = Math.floor(m / 60), r = m % 60;
    return [h ? `${h} h` : '', r ? `${r} min` : ''].filter(Boolean).join(' ');
}

function timeText(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const clockText = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayClockText = iso => `${new Date(iso).toLocaleDateString([], { weekday: 'short' })} ${clockText(iso)}`;

function timedRunStatus(run, tr) {
    const lines = [];
    if (!run.enabled)           lines.push('<span class="auto-muted">Off</span>');
    else if (run.running_until) lines.push(`<strong class="auto-on">Running</strong> until ${clockText(run.running_until)}`);
    else if (!run.times.length) lines.push('<span class="auto-warn">Add a start time</span>');
    else if (!run.days.length)  lines.push('<span class="auto-warn">Pick at least one day</span>');
    else lines.push(`Next: ${dayClockText(run.next_start)}`
         + (automation.pond_level?.auto_mode ? '' : ' <span class="auto-muted">(paused: Auto Mode is off)</span>'));
    const z = tr.zone_sources[run.source];
    if (z) {
        lines.push(z.moisture_pct === null
            ? '<span class="auto-muted">Soil moisture: no recent reading. It will water.</span>'
            : `<span class="auto-muted">Soil moisture now: ${z.moisture_pct}%</span>`);
        if (run.last_skipped) lines.push(`<span class="auto-warn">Skipped ${dayClockText(run.last_skipped.at)}: moisture ${run.last_skipped.pct}% was above ${run.skip_above_pct}%</span>`);
    }
    return lines.join(' · ');
}

function renderTimedRuns() {
    const tr = automation?.timed_runs;
    if (!tr || timedSaving) return;
    RUN_CARDS.forEach(card => renderRunCard(card, tr));
}

function renderRunCard(card, tr) {
    const wrap = document.getElementById(card.wrap);
    if (!wrap) return;
    // Global index into the saved list, so edits on either card save the whole list
    const mine = tr.runs.map((run, i) => ({ run, i })).filter(({ run }) => (run.source in tr.zone_sources) === card.zones);
    const ids  = mine.map(({ run }) => run.id).join(',');
    if (wrap.dataset.ids !== ids || !document.getElementById(card.id)) {
        wrap.dataset.ids = ids;
        const sources = Object.fromEntries(Object.entries(tr.sources).filter(([k]) => (k in tr.zone_sources) === card.zones));
        const lengths = [];
        for (let m = tr.step_min; m <= tr.max_min; m += tr.step_min) lengths.push(m);
        wrap.innerHTML = `
          <div class="auto-rule" id="${card.id}">
            ${helpBtn(card.id)}
            <div class="auto-rule-head"><h3>${card.title}</h3>
              <button class="btn-primary" onclick="addTimedRun('${card.id}')">${card.add}</button></div>
            ${mine.length ? '' : `<div class="auto-muted">${card.empty}</div>`}
            ${mine.map(({ run, i }) => `
              <div class="timed-run">
                <div class="timed-head">
                  <label class="toggle" title="Turn this run on or off">
                    <input type="checkbox" ${run.enabled ? 'checked' : ''} onchange="editTimedRun(${i}, 'enabled', this.checked)">
                    <span class="slider"></span>
                  </label>
                  <div class="auto-radios timed-sources" role="radiogroup" aria-label="What to run">
                    ${Object.entries(sources).map(([k, label]) => `
                      <label class="auto-radio"><input type="radio" name="trSource${run.id}" value="${k}" ${run.source === k ? 'checked' : ''}
                        onchange="editTimedRun(${i}, 'source', this.value)"> ${escHtml(label)}</label>`).join('')}
                  </div>
                  <button class="btn-danger" onclick="deleteTimedRun(${i})" title="Delete this run">Delete</button>
                </div>
                <div class="auto-line">${card.zones ? 'Water for' : 'Run for'}
                  <select onchange="editTimedRun(${i}, 'minutes', parseInt(this.value))">
                    ${lengths.map(m => `<option value="${m}" ${m === run.minutes ? 'selected' : ''}>${minutesText(m)}</option>`).join('')}
                  </select>
                  starting at:</div>
                <div class="timed-times">
                  ${run.times.map((t, j) => `<span class="timed-chip">${timeText(t)}
                    <button title="Remove ${timeText(t)}" aria-label="Remove ${timeText(t)}" onclick="removeTimedTime(${i}, ${j})">×</button></span>`).join('')}
                  ${run.times.length < tr.max_times ? `<span class="timed-add">
                    <input type="time" id="trNew${i}" aria-label="New start time"
                      onblur="addTimedTime(${i}, true)" onkeydown="if (event.key === 'Enter') addTimedTime(${i}, true)">
                    <button class="btn-close" onmousedown="event.preventDefault()" onclick="addTimedTime(${i})">Add time</button></span>` : ''}
                </div>
                <div class="timed-days" role="group" aria-label="Days of the week">
                  ${DAY_LETTERS.map((d, n) => `<label class="day-btn" title="${DAY_NAMES[n]}">
                    <input type="checkbox" ${run.days.includes(n) ? 'checked' : ''} onchange="toggleTimedDay(${i}, ${n}, this.checked)">
                    <span>${d}</span></label>`).join('')}
                  <button class="btn-link" onclick="setTimedDays(${i}, [0,1,2,3,4,5,6])">Every day</button>
                </div>
                ${card.zones ? `<div class="auto-line">Skip if soil moisture is above
                  <select onchange="editTimedRun(${i}, 'skip_above_pct', this.value === '' ? null : parseInt(this.value))">
                    <option value="" ${run.skip_above_pct === null ? 'selected' : ''}>never skip</option>
                    ${tr.skip_pct.map(p => `<option value="${p}" ${p === run.skip_above_pct ? 'selected' : ''}>${p}%</option>`).join('')}
                  </select></div>` : ''}
                <div class="timed-status" id="trStatus${run.id}"></div>
              </div>`).join('')}
            <div class="auto-muted timed-foot" id="${card.id}Last"></div>
          </div>`;
    }
    mine.forEach(({ run }) => {
        const el = document.getElementById(`trStatus${run.id}`);
        if (el) el.innerHTML = timedRunStatus(run, tr);
    });
    // The last action, on the card whose source it was about
    const mineLast = tr.last_action && Object.entries(tr.sources)
        .some(([k, label]) => (k in tr.zone_sources) === card.zones && tr.last_action.includes(label));
    document.getElementById(`${card.id}Last`).textContent = mineLast
        ? `Last: ${tr.last_action} (${new Date(tr.last_at).toLocaleString()})` : '';
}

// The saved list without the status fields, for editing
function timedRunsCopy() {
    return automation.timed_runs.runs.map(({ id, enabled, source, minutes, times, days, skip_above_pct }) =>
        ({ id, enabled, source, minutes, times: [...times], days: [...days], skip_above_pct }));
}

async function saveTimedRuns(runs) {
    if (timedSaving) return;
    timedSaving = true;
    document.querySelectorAll('.timed-run input, .timed-run select, .timed-run button, .auto-rule-head .btn-primary')
        .forEach(el => el.disabled = true);
    try {
        const res  = await apiFetch('/api/automation.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'timed_runs', runs }),
        });
        const data = await res.json();
        if (data.error) alert('Not saved: ' + data.error);
        else automation = data;
    } catch (err) {
        if (err.message !== 'session_expired') alert('Network error — not saved.');
    } finally {
        timedSaving = false;
        RUN_CARDS.forEach(c => document.getElementById(c.id)?.remove());   // rebuild from what's saved
        renderAutomation();
        renderSchedule();
    }
}

function editTimedRun(i, field, value) {
    const runs = timedRunsCopy();
    runs[i][field] = value;
    // Moisture skip is only for zones
    if (field === 'source' && !(value in automation.timed_runs.zone_sources)) runs[i].skip_above_pct = null;
    saveTimedRuns(runs);
}

function addTimedRun(cardId) {
    const card = RUN_CARDS.find(c => c.id === cardId);
    const runs = timedRunsCopy();
    runs.push({ enabled: true, times: ['06:00'], days: [0, 1, 2, 3, 4, 5, 6], skip_above_pct: null, ...card.fresh });
    saveTimedRuns(runs);
}

function deleteTimedRun(i) {
    const run = automation.timed_runs.runs[i];
    if (!confirm(`Delete this run for ${automation.timed_runs.sources[run.source]}?`)) return;
    const runs = timedRunsCopy();
    runs.splice(i, 1);
    saveTimedRuns(runs);
}

// A time typed in the box is saved when you leave the box, press Enter or press Add time
function addTimedTime(i, quiet = false) {
    if (timedSaving) return;
    const v = document.getElementById(`trNew${i}`)?.value;
    if (!v) { if (!quiet) alert('Pick a time first.'); return; }
    const runs = timedRunsCopy();
    if (runs[i].times.includes(v)) { if (!quiet) alert(`${timeText(v)} is already a start time.`); return; }
    runs[i].times.push(v);
    saveTimedRuns(runs);
}

function removeTimedTime(i, j) {
    const runs = timedRunsCopy();
    runs[i].times.splice(j, 1);
    saveTimedRuns(runs);
}

function toggleTimedDay(i, day, on) {
    const runs = timedRunsCopy();
    runs[i].days = on ? [...runs[i].days, day] : runs[i].days.filter(d => d !== day);
    saveTimedRuns(runs);
}

function setTimedDays(i, days) {
    const runs = timedRunsCopy();
    runs[i].days = days;
    saveTimedRuns(runs);
}

// ── Week schedule ─────────────────────────────────────────────────────────────
// The timed runs and zone watering over today and the next 6 days: one row per day,
// one lane per source (fixed order and colour), blocks where a run is scheduled.
// Runs past midnight carry into the next day's row. Hover a block for its details;
// "Show as a list" gives the same thing as text.
const SCHED_ORDER = ['pond_fill', 'creek', 'fountain', 'zone22', 'zone23', 'zone24'];   // = colour slots 1–6
let schedSig = '', schedListOpen = false;

function scheduleBlocks(tr, dayStart, now) {
    // Every occurrence that touches this day: runs starting today, and yesterday's that carry over
    const out = [];
    const dayEnd = dayStart + 86400000;
    tr.runs.forEach(run => {
        [-1, 0].forEach(off => {
            const base = new Date(dayStart); base.setDate(base.getDate() + off);
            if (!run.days.includes(base.getDay())) return;
            run.times.forEach(t => {
                const [h, m] = t.split(':').map(Number);
                const s = new Date(base); s.setHours(h, m, 0, 0);
                const start = s.getTime(), end = start + run.minutes * 60000;
                if (end <= dayStart || start >= dayEnd) return;
                out.push({ run, start, end, from: Math.max(start, dayStart), to: Math.min(end, dayEnd),
                           live: run.enabled && now >= start && now < end && !!run.running_until });
            });
        });
    });
    return out.sort((a, b) => a.start - b.start);
}

function renderSchedule() {
    const box = document.getElementById('weekSchedule');
    const tr  = automation?.timed_runs, pl = automation?.pond_level;
    if (!tr || !pl) return;
    const now   = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const sig   = JSON.stringify([tr.runs, pl.filling, pl.started_at, pl.enabled, pl.auto_mode, today.getTime(), Math.floor(now / 60000)]);
    if (sig === schedSig) return;
    schedSig = sig;

    const used = SCHED_ORDER.filter(k => tr.runs.some(r => r.source === k) || pl.filling === k);
    const name = k => tr.sources[k] || k;
    const hm   = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const blockTip = b => [
        `${name(b.run.source)}: ${hm(b.start)}–${hm(b.end)} (${minutesText(b.run.minutes)})`,
        !b.run.enabled ? 'Off: this run won\'t happen' : b.live ? 'Running now' : '',
        b.run.skip_above_pct !== null && b.run.skip_above_pct !== undefined ? `Skipped if soil moisture is above ${b.run.skip_above_pct}%` : '',
    ].filter(Boolean).join('\n');

    if (!used.length) {
        box.innerHTML = '<div class="auto-muted">Nothing scheduled. Add timed runs or zone watering on the Automation panel and they\'ll show here.</div>';
        return;
    }

    const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    const hourLabel = h => h % 24 === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
    const days = [], list = [];
    for (let d = 0; d < 7; d++) {
        const ds = new Date(today); ds.setDate(ds.getDate() + d);
        const dayStart = ds.getTime();
        const blocks = scheduleBlocks(tr, dayStart, now);
        const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : ds.toLocaleDateString([], { weekday: 'long' });
        const lanes = used.map((k, li) => {
            const slot = SCHED_ORDER.indexOf(k) + 1;
            let marks = blocks.filter(b => b.run.source === k).map(b => {
                const left = (b.from - dayStart) / 864000, width = Math.max((b.to - b.from) / 864000, 0.4);
                const cls = ['sched-block', !b.run.enabled && 'off', b.live && 'live', b.run.skip_above_pct != null && 'may-skip'].filter(Boolean).join(' ');
                return `<span class="${cls}" style="left:${left}%;width:${width}%;--c:var(--series-${slot})"
                          tabindex="0" data-tip="${escHtml(blockTip(b))}" aria-label="${escHtml(blockTip(b))}"></span>`;
            }).join('');
            // The Pond level rule's fill going on now (it isn't on a clock, so only today, up to now)
            if (d === 0 && pl.filling === k && pl.started_at) {
                const st = Math.max(new Date(pl.started_at).getTime(), dayStart);
                const tip = `${name(k)}: filling since ${hm(new Date(pl.started_at).getTime())} (Pond level rule, until the pond is full)`;
                marks += `<span class="sched-block pond-rule live" style="left:${(st - dayStart) / 864000}%;width:${Math.max((now - st) / 864000, 0.4)}%;--c:var(--series-${slot})"
                            tabindex="0" data-tip="${escHtml(tip)}" aria-label="${escHtml(tip)}"></span>`;
            }
            return `<div class="sched-lane">${marks}</div>`;
        }).join('');
        const nowLine = d === 0 ? `<span class="sched-now" style="left:${(now - dayStart) / 864000}%" title="Now: ${hm(now)}"><b>Now</b></span>` : '';
        days.push(`
          <div class="sched-day${d === 0 ? ' today' : ''}">
            <div class="sched-daylabel">${label}<small>${ds.toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></div>
            <div class="sched-track">${hours.slice(1, -1).map(h => `<span class="sched-grid" style="left:${h / 24 * 100}%"></span>`).join('')}${lanes}${nowLine}</div>
          </div>`);
        list.push(`<li><strong>${label}</strong>: ${blocks.length
            ? blocks.map(b => `${escHtml(name(b.run.source))} ${hm(b.start)}–${hm(b.end)}${!b.run.enabled ? ' (off)' : ''}${b.run.skip_above_pct != null ? ` (skips above ${b.run.skip_above_pct}%)` : ''}`).join('; ')
            : 'nothing'}</li>`);
    }

    const notes = [];
    if (!pl.auto_mode) notes.push('Auto Mode is off, so nothing here will run until it\'s turned on.');
    if (pl.enabled) notes.push(`The Pond level rule isn't on a clock: it runs ${escHtml(name(pl.config.source))} whenever the pond is ${inchText(pl.config.below_in)} below full${pl.filling ? ' (filling now, shown striped)' : ''}.`);

    box.innerHTML = `
      <div class="sched-legend">${used.map(k => `<span><i style="--c:var(--series-${SCHED_ORDER.indexOf(k) + 1})"></i>${escHtml(name(k))}</span>`).join('')}
        <span><i class="key-off"></i>Off</span><span><i class="key-skip"></i>Skips when wet</span></div>
      <div class="sched-grid-wrap">
        <div class="sched-day sched-axis"><div class="sched-daylabel"></div>
          <div class="sched-track">${hours.map(h => `<span class="sched-hour" style="left:${h / 24 * 100}%">${hourLabel(h)}</span>`).join('')}</div></div>
        ${days.join('')}
      </div>
      ${notes.map(n => `<div class="auto-muted sched-note">${n}</div>`).join('')}
      <details class="sched-list" ${schedListOpen ? 'open' : ''} ontoggle="schedListOpen = this.open"><summary>Show as a list</summary><ul>${list.join('')}</ul></details>
      <div class="sched-tip" id="schedTip" role="tooltip" hidden></div>`;

    // Hover / focus tooltip
    const tip = document.getElementById('schedTip');
    box.querySelectorAll('.sched-block').forEach(el => {
        const show = () => {
            tip.textContent = el.dataset.tip;
            tip.hidden = false;
            const r = el.getBoundingClientRect(), br = box.getBoundingClientRect();
            const x = Math.min(Math.max(r.left + r.width / 2 - br.left, 110), br.width - 110);
            tip.style.left = `${x}px`;
            tip.style.top  = `${r.top - br.top - 8}px`;
        };
        el.addEventListener('mouseenter', show);
        el.addEventListener('focus', show);
        el.addEventListener('mouseleave', () => tip.hidden = true);
        el.addEventListener('blur', () => tip.hidden = true);
    });
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
        else fetchAll();   // the Automation panel shows whether it's paused
    } catch (err) {
        if (err.message !== 'session_expired') {
            toggle.checked = !toggle.checked;
            alert('Network error — Auto Mode not changed.');
        }
    } finally {
        toggle.disabled = false;
    }
}

// ── Card help ─────────────────────────────────────────────────────────────────
// The "?" in a card's top-right corner opens a box saying what the card shows.
// One box for the whole page (outside the cards), so the cards re-rendering every
// few seconds can't close it.
const ZONE_HELP = `
  <li><b>Open / Closed</b> (top right) is what the unit last reported for the valve.</li>
  <li><b>Open</b> runs the valve for up to 1 hour. <b>Close</b> stops it. The unit picks the change up on its next check-in (every 5 s); until then the card says "sending to Unit …".</li>
  <li><b>Closes in …</b> is the time left on the run. Every run has an end time on the unit itself, so the valve still closes if WiFi or the server goes down.</li>
  <li>If the unit hasn't checked in for 30 s it shows as offline, with when it was last seen, and the buttons are greyed out.</li>`;
const MOIST_HELP = `
  <li><b>Moisture</b> is from the soil sensor: 0% bone dry, 100% in water. The bar is red under 25%, orange to 40%, green to 65%, blue above. "No sensor data" means the input reads as if nothing is connected.</li>`;

const CARD_HELP = {
    zone: { title: 'Irrigation zone', body: `<ul>${ZONE_HELP}${MOIST_HELP}
        <li>Zones 22–24 can be watered on a schedule from <b>Zone watering</b> in the Automation panel.</li></ul>` },
    creek: { title: 'Creek Source', body: `<p>The valve on Unit A that opens the creek water supply. It has no moisture sensor.</p><ul>${ZONE_HELP}
        <li>The Creek can fill the pond: the Automation panel's <b>Pond level</b> rule and <b>Timed runs</b> can open it.</li></ul>` },
    fountain: { title: 'Pond Fountain', body: `<p>Zone 21 on Unit D runs the pond fountain.</p><ul>${ZONE_HELP}${MOIST_HELP}
        <li>The Automation panel's <b>Pond level</b> rule and <b>Timed runs</b> can run the fountain.</li></ul>` },
    pond: { title: 'Pond Level', body: `
        <p>An ultrasonic sensor on Unit D measures the distance down to the water.</p>
        <ul>
          <li><b>▲ / ▼ … above / below normal</b>: how far the pond is from the normal (full) level.</li>
          <li><b>Set current level as normal</b> marks today's level as full. The Pond level automation rule measures from it.</li>
          <li><b>Water is … below the sensor</b>: the latest reading.</li>
          <li><b>Trend over 7 days</b>: a straight-line fit through the last week, in inches per day. A fill, a drain or heavy rain pulls it for a while.</li>
          <li><b>24 hours</b>: the 3-hour average, held flat until it moves more than 0.5 in (the sensor's accuracy), so a real change shows as a step.</li>
          <li><b>7 / 30 days</b>: one point per day, that day's average, so slow changes like evaporation show as a slope.</li>
          <li>Hover over the graph for the readings and water temperature.</li>
        </ul>` },
    filter: { title: 'Pre-filter', body: `
        <p>Each pre-filter before the storage tank has a flush valve that opens on a cycle to wash it out.</p>
        <ul>
          <li><b>Open</b> (top right) means it's flushing now.</li>
          <li><b>Start / Stop flush cycle</b> turns the cycle on or off.</li>
          <li><b>Flush period</b>: how long the flush valve stays open. <b>Wait time between flushes</b>: how long until the next flush.</li>
          <li>Only one pre-filter flushes at a time. "Waiting" means the other one is flushing; this one goes once that closes.</li>
          <li>Changes reach Unit E within about 2 s ("Sending to Unit E…" until then).</li>
        </ul>` },
    drain: { title: 'Pond Drain', body: `
        <p>The 2" valve at the bottom of the pond. When it's open, pond water joins the spring water and goes through the pre-filters to the storage tank.</p>
        <ul>
          <li>The badge shows Open, Closed or how far open it is. It takes about 9 s to open fully.</li>
          <li><b>Open</b>, <b>Close</b> or <b>Partial open</b> (10–90%) sets it. Opening asks you to confirm first.</li>
          <li>When the tank reaches its top sensor the drain closes by itself, and goes back to your setting once the level drops below the refill sensor.</li>
          <li><b>Tank</b>: the storage tank level from its sensors.</li>
          <li>During a Pond Fill or a Drain Tank run it's held fully open (tank sensors ignored).</li>
          <li>The Pond level rule's <b>low water mark</b> can close it so the tanks stop taking pond water.</li>
        </ul>` },
    fill: { title: 'Pond Fill', body: `
        <p>The 2" valve after the T where the spring water joins. It's normally open, so the spring water goes on to the storage tank.</p>
        <ul>
          <li><b>Start Pond Fill</b> runs for the time picked under <b>Run time</b> (1–24 hours). It opens the Pond Drain fully, then closes Pond Fill, so the spring water runs back up into the pond.</li>
          <li>When the run ends (or you press <b>Stop Pond Fill</b>) Pond Fill opens first, then the Pond Drain goes back to its setting.</li>
          <li>If Unit E restarts or loses power, Pond Fill opens.</li>
          <li>The Automation panel's <b>Pond level</b> rule and <b>Timed runs</b> can start it.</li>
        </ul>` },
    tankDrain: { title: 'Storage Tank Drain', body: `
        <p>The 1" valve near the bottom of the storage tank. It's normally closed.</p>
        <ul>
          <li><b>Drain Tank</b> runs for the time picked under <b>Run time</b> (10–120 minutes). It opens the Pond Drain and closes Pond Fill first, so no spring water flows into the tank while it empties, then opens the tank drain.</li>
          <li>When it ends the tank drain closes, then Pond Fill opens again.</li>
        </ul>` },
    autoPond: { title: 'Pond level rule', body: `
        <p>Keeps the pond full. The switch turns the rule on or off.</p>
        <ul>
          <li>When the pond is the chosen amount <b>below full</b>, it fills it with the source you pick (Pond Fill, the Creek or the Pond Fountain) until it's back to full.</li>
          <li>Full is the normal level set on the Pond Level card. The level used is the 3-hour average, so the sensor's wander can't start or stop a fill.</li>
          <li>Pond Fill runs 4 hours at a time and starts again if the pond is still low.</li>
          <li><b>Low water mark</b>: if the pond drops that far, the Pond Drain is closed so the tanks stop taking pond water. It goes back to where it was once the pond is 0.5 in above the mark.</li>
          <li><b>Override</b>: allow the pond to go below the low water mark. The rule then leaves the Pond Drain alone.</li>
          <li>It only runs while Auto Mode is on, and only stops what it started.</li>
          <li>The line at the bottom says what it's doing now and its last action.</li>
        </ul>` },
    autoTimed: { title: 'Timed runs', body: `
        <p>Run the Creek, the Pond Fountain or Pond Fill at set times.</p>
        <ul>
          <li>Each run has a switch, what to run, how long (20 minutes to 6 hours), one or more start times and the days of the week.</li>
          <li>Type a start time and press Enter or click away to save it. Remove one with its ×.</li>
          <li>Each run shows whether it's running now and when it next starts.</li>
          <li>A run that goes past midnight carries on into the next day.</li>
          <li>If you stop the source by hand, the run leaves it stopped. It won't take over a source you started by hand.</li>
          <li>Timed runs only work while Auto Mode is on. They're drawn on the Week Schedule.</li>
        </ul>` },
    autoZones: { title: 'Zone watering', body: `
        <p>Water Zones 22–24 at set times. It works like Timed runs.</p>
        <ul>
          <li>Each run has a switch, the zone, how long (20 minutes to 6 hours), one or more start times and the days of the week.</li>
          <li><b>Skip if soil moisture is above</b>: at each start the zone's latest moisture reading is checked. If it's wetter than that, that start is skipped (not retried later). With no reading in the last hour it waters anyway.</li>
          <li>Each run shows the moisture now, when it next starts, and the last skip in the past day.</li>
          <li>Zones 23 and 24 have no moisture sensors yet, so set them to <b>never skip</b>.</li>
          <li>Only works while Auto Mode is on.</li>
        </ul>` },
    schedule: { title: 'Week Schedule', body: `
        <p>The Timed runs and Zone watering laid out over today and the next 6 days.</p>
        <ul>
          <li>One row per day, midnight to midnight. Inside each day, one lane per source, each in its own colour (named in the legend).</li>
          <li>A block is a scheduled run. Hover over it, or tap it, for its times.</li>
          <li><b>Dashed</b>: the run is switched off. <b>White left edge</b>: it skips when the soil is wet. <b>Ring</b>: running now. <b>Striped</b>: the Pond level rule is filling now.</li>
          <li>The dotted white line marked <b>Now</b> is the current time.</li>
          <li>The Pond level rule isn't on a clock, so it's described in a note below the grid.</li>
          <li><b>Show as a list</b> gives the same schedule as text.</li>
        </ul>` },
    events: { title: 'Valve Events', body: `
        <p>Every valve opening and closing in the last 48 hours, newest first.</p>
        <ul>
          <li><b>Trigger</b>: manual (from this page) or schedule (from automation).</li>
          <li><b>By</b>: who asked for it: your sign-in name, Pond automation, Timed run, or the unit itself.</li>
          <li>"run time ended" means the unit closed the valve when its time ran out. "closed after restart" means it closed it at power-up.</li>
        </ul>` },
};

function helpBtn(key) {
    return `<button type="button" class="help-btn" onclick="showHelp('${key}', this)" title="What this card shows" aria-label="What this card shows">?</button>`;
}

let helpReturnFocus = null;
function showHelp(key, btn) {
    const h = CARD_HELP[key];
    if (!h) return;
    helpReturnFocus = btn;
    document.getElementById('helpTitle').textContent = h.title;
    document.getElementById('helpBody').innerHTML = h.body;
    document.getElementById('helpModal').classList.remove('hidden');
    document.getElementById('helpClose').focus();
}

function closeHelp() {
    document.getElementById('helpModal').classList.add('hidden');
    // The card may have been rebuilt meanwhile; fall back to its new "?" if so
    if (helpReturnFocus?.isConnected) helpReturnFocus.focus();
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('helpModal')?.classList.contains('hidden')) closeHelp();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatDuration(sec) {
    if (sec < 60)  return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec/60)}m ${sec%60}s`;
    return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
}
