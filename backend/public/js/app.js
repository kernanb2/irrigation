// ── State ─────────────────────────────────────────────────────────────────────
let zones = [], schedules = [], pendingZone = null, filter = null, drainFollowTimer = null;
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

        // Follow the drain while it moves (one timer at a time)
        if (filter?.drain?.reported?.moving && !drainFollowTimer) {
            drainFollowTimer = setTimeout(() => { drainFollowTimer = null; fetchAll(); }, 2000);
        }

        renderUnitPills(status.temps || []);
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
function renderUnitPills(temps) {
    const unitsSeen = {};
    temps.forEach(t => { unitsSeen[t.unit_id] = t.recorded_at; });

    const now = Date.now() / 1000;
    const html = [1, 2, 3, 4, 5].map(uid => {
        const ts    = unitsSeen[uid] ? new Date(unitsSeen[uid]).getTime() / 1000 : 0;
        const alive = uid === 5 ? filter?.online : ts && (now - ts) < 180;
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
    const moist      = z.moisture_pct !== null ? parseInt(z.moisture_pct) : null;
    const moistColor = moist === null ? '' : moist > 65 ? 'moist-high' : moist > 40 ? 'moist-mid' : moist > 25 ? 'moist-low' : 'moist-dry';
    const moistBar   = moist !== null ? `<div class="moisture-bar-wrap"><div class="moisture-bar ${moistColor}" style="width:${moist}%"></div></div>` : '';
    const moistLabel = moist !== null ? `Moisture: ${moist}%` : 'No sensor data';

    return `
    <div class="zone-card ${isOpen ? 'valve-open' : ''} ${z.is_special == 1 ? 'special' : ''}" id="zone-${z.id}">
      <div class="zone-header">
        <div>
          <div class="zone-name">${escHtml(z.name)}</div>
          <div class="zone-id">Zone ${z.id}</div>
        </div>
        <span class="valve-badge ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>
      </div>
      <div class="zone-sensors">${moistLabel}</div>
      ${moistBar}
      <div class="zone-actions">
        <button class="btn-open"  onclick="valveCmd(${z.id}, true)"  ${isOpen    ? 'disabled' : ''}>Open</button>
        <button class="btn-close" onclick="valveCmd(${z.id}, false)" ${!isOpen   ? 'disabled' : ''}>Close</button>
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
      <div class="zone-unit-header">Unit E — Pre-filter Flush</div>
      ${(filter?.filters || []).map(filterCard).join('')}
      ${filter?.drain ? drainCard(filter.drain) : ''}`;
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
      <div class="zone-sensors">${detail}</div>
      <div class="zone-actions">
        <button class="btn-open"  onclick="setDrain(100)" ${busy || (pos === 100 && !got?.moving) ? 'disabled' : ''}>Open</button>
        <button class="btn-close" onclick="setDrain(0)"   ${busy || (pos === 0 && !got?.moving) ? 'disabled' : ''}>Close</button>
      </div>
      <label class="card-field">Partial open
        <select onchange="if (this.value) setDrain(parseInt(this.value))" ${busy ? 'disabled' : ''}>
          <option value="">Choose…</option>${partial}
        </select>
      </label>
    </div>`;
}

async function setDrain(pct) {
    // Opening drains the pond — make sure it's intended
    if (pct > 0 && !confirm(`Open the Pond Drain ${pct === 100 ? 'fully' : 'to ' + pct + '%'}?`)) {
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
      <div class="zone-sensors">${detail}</div>
      <div class="zone-actions">
        <button class="${want.cycle_enabled ? 'btn-close' : 'btn-open'}"
          onclick="setFilterCycle(${f.filter}, { cycle_enabled: ${!want.cycle_enabled} })">
          ${want.cycle_enabled ? 'Stop flush cycle' : 'Start flush cycle'}
        </button>
      </div>
      <label class="card-field">Flush period
        <select onchange="setFilterCycle(${f.filter}, { flush_sec: parseInt(this.value) })">${options('seconds', want.flush_sec)}</select>
      </label>
      <label class="card-field">Wait time between flushes
        <select onchange="setFilterCycle(${f.filter}, { wait_min: parseInt(this.value) })">${options('minutes', want.wait_min)}</select>
      </label>
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
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center">No events</td></tr>';
        return;
    }
    tbody.innerHTML = events.slice(0, 50).map(ev => `
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
    await apiFetch('/api/settings.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'auto_mode_enabled', value: e.target.checked ? 'true' : 'false' }),
    });
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
