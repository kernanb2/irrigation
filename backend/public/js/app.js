// ── State ─────────────────────────────────────────────────────────────────────
let zones = [], schedules = [], pendingZone = null;
const POLL_MS = 15000;

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
        const [statusRes, eventsRes] = await Promise.all([
            fetch(BASE + '/api/status.php'),
            fetch(BASE + '/api/events.php'),
        ]);
        const status = await statusRes.json();
        const events = await eventsRes.json();

        zones     = status.zones     || [];
        schedules = status.schedules || [];

        renderUnitPills(status.temps || []);
        renderZones();
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
    const html = [1, 2, 3].map(uid => {
        const ts    = unitsSeen[uid] ? new Date(unitsSeen[uid]).getTime() / 1000 : 0;
        const alive = ts && (now - ts) < 180;
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

// ── Valve command ─────────────────────────────────────────────────────────────
async function valveCmd(zoneId, open) {
    const card = document.getElementById(`zone-${zoneId}`);
    card.querySelectorAll('button').forEach(b => b.disabled = true);

    try {
        const res  = await fetch(BASE + '/api/valve.php', {
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
        alert('Network error — could not reach server.');
        card.querySelectorAll('button').forEach(b => b.disabled = false);
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
    const res = await fetch(BASE + '/api/schedules.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) { closeScheduleModal(); fetchAll(); }
    else alert('Error: ' + data.error);
}

async function toggleSchedule(id, enabled) {
    await fetch(BASE + '/api/schedules.php', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled }),
    });
    fetchAll();
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    await fetch(BASE + '/api/schedules.php', {
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
          <td>Zone ${ev.zone_id} — ${escHtml(ev.zone_name)}</td>
          <td><span style="color:${ev.action==='open'?'var(--green)':'var(--muted)'}">${ev.action.toUpperCase()}</span></td>
          <td>${ev.trigger_type}</td>
          <td>${escHtml(ev.initiated_by || '—')}</td>
        </tr>`).join('');
}

// ── Auto mode toggle ──────────────────────────────────────────────────────────
async function toggleAutoMode(e) {
    await fetch(BASE + '/api/settings.php', {
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
