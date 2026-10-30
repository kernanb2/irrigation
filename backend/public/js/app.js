// ── State ─────────────────────────────────────────────────────────────────────
let zones = [], units = {}, schedules = [], pendingZone = null, filter = null, drainFollowTimer = null, zoneFollowTimer = null;
let fillHoursChoice = null;   // Pond Fill run time picked on the card (sent with Start)
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

        // Follow a zone valve until its unit has picked up the change (one timer at a time)
        if (zones.some(z => units[z.unit_id]?.online == 1 && z.desired_state !== z.valve_state) && !zoneFollowTimer) {
            zoneFollowTimer = setTimeout(() => { zoneFollowTimer = null; fetchAll(); }, 2000);
        }

        // Follow the drain and Pond Fill while they move (one timer at a time)
        if ((filter?.drain?.reported?.moving || filter?.fill?.reported?.moving) && !drainFollowTimer) {
            drainFollowTimer = setTimeout(() => { drainFollowTimer = null; fetchAll(); }, 2000);
        }

        // Show the saved Auto Mode setting (not while a change is being saved)
        const auto = document.getElementById('autoToggle');
        if (!auto.disabled) auto.checked = !!status.auto_mode;

        renderUnitPills();
        renderZones();
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

    const byUnit = { 1: [], 2: [], 3: [] };
    zones.forEach(z => (byUnit[z.unit_id] || []).push(z));

    const unitNames = { 1: 'Unit A — Zones 1–5', 2: 'Unit B — Zones 6–10', 3: 'Unit C — Zones 11–15' };

    [1, 2, 3].forEach(uid => {
        html += `<div class="zone-unit-header">${unitNames[uid]}</div>`;
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

// ── Units D and E ─────────────────────────────────────────────────────────────
function renderExtraUnits() {
    const box = document.getElementById('extraUnits');
    // Don't rebuild while a dropdown is open — it would snap shut mid-choice
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;

    box.innerHTML = `
      <div class="zone-unit-header">Unit D</div>
      <div class="zone-card"><div class="zone-sensors">Not set up yet</div></div>
      <div class="zone-unit-header">Unit E — Pre-filter Flush &amp; Pond</div>
      ${filter ? pondDiagram() : ''}
      ${(filter?.filters || []).map(filterCard).join('')}
      ${filter?.drain ? drainCard(filter.drain) : ''}
      ${filter?.fill ? fillCard(filter.fill) : ''}`;
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
    const filling = online && filter.fill?.reported?.active;
    const tank    = online && got?.tank;
    if (filling && !got.moving && !pending) {
        detail = 'Fully open — Pond Fill running (tank sensors ignored)';
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
    // Opening drains the pond — make sure it's intended. During Pond Fill any drain button ends the fill.
    const where = pct === 0 ? 'closed' : pct === 100 ? 'fully open' : pct + '% open';
    const question = filter?.fill?.reported?.active
        ? `This ends Pond Fill: Pond Fill opens, then the Pond Drain goes to ${where}. Continue?`
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
    if (fillHoursChoice === null) fillHoursChoice = want.hours;

    let detail;
    if (!online) {
        detail = 'Unit E offline' + (filter.last_seen ? ` — last seen ${new Date(filter.last_seen).toLocaleString()}` : '');
    } else if (!got) {
        detail = 'Waiting for Unit E…';
    } else if (pending) {
        detail = 'Sending to Unit E…';
    } else if (got.moving) {
        detail = active ? 'Starting — opening the Pond Drain, then closing Pond Fill…'
                        : 'Ending — opening Pond Fill, then the Pond Drain goes back to its setting…';
    } else if (active) {
        detail = `Filling the pond — ${formatDuration(got.remaining_s)} left`;
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
    await fillCmd({ hours: h });
}

async function stopFill() {
    if (!confirm('Stop Pond Fill? Pond Fill opens, then the Pond Drain goes back to its last setting.')) return;
    await fillCmd({ stop: true });
}

async function fillCmd(body) {
    try {
        const res  = await apiFetch('/api/fill.php', {
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
// pre-filters (in parallel) → storage tank → pump → Orival auto filter → irrigation zones. Pipes with
// water moving in them are blue and animated, so anyone can see where it's going.
function pondDiagram() {
    const online   = filter.online;
    const d        = online ? filter.drain?.reported : null;
    const p        = online ? filter.fill?.reported  : null;
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
    const flushState = i => !online ? 'unknown' : flushing[i] ? 'open' : 'closed';
    const sensor     = (y, wet) => `<circle class="pd-sensor ${!tank ? 'unknown' : wet ? 'wet' : ''}" cx="700" cy="${y}" r="5"/>`;
    const waterTop   = !tank ? 215 : tank.top_wet ? 180 : tank.refill_wet ? 205 : 235;

    let caption;
    if (!online) {
        caption = 'Unit E is offline, so the valve positions are unknown.';
    } else if (d?.moving || p?.moving) {
        caption = 'A valve is moving — the picture updates when it stops.';
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
        <svg viewBox="0 0 890 300" role="img" aria-label="Pond and storage tank plumbing">
          ${pipe('M95 90 V140 H300', pondFlows, !fillOpen)}
          ${pipe('M300 20 V140', springFlows)}
          ${pipe('M300 140 H420', toTank)}
          ${pipe('M420 140 V95 H540 V140', toTank)}
          ${pipe('M420 140 V185 H540 V140', toTank)}
          ${pipe('M540 140 H610 V165', toTank)}
          ${pipe('M485 83 V40', toTank && flushing[0])}
          ${pipe('M485 197 V245', toTank && flushing[1])}
          ${pipe('M665 248 V130 H880', false)}

          <path class="pd-water" d="M20 30 H170 V70 Q170 90 150 90 H40 Q20 90 20 70 Z"/>
          <text class="pd-label" x="95" y="64" text-anchor="middle">Pond</text>
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
    sel.innerHTML = zones.filter(z => z.id <= 15).map(z => `<option value="${z.id}">Zone ${z.id} — ${escHtml(z.name)}</option>`).join('');
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
