# Project Context — Paradise Pond Irrigation Controller

A solar-powered, WiFi-connected irrigation controller spanning 15 zones across 3 ESP32 units. A central PHP/MySQL web server coordinates all units, persists data, and serves a web UI for monitoring and control.

---

## Codebase Locations

| Component       | Path                                              |
|-----------------|---------------------------------------------------|
| Web backend     | `/usr/local/var/irrigation/` (this repo)          |
| Firmware        | `/Users/kernanb/Arduino/irrigation_controller/`   |
| Provisioning    | `/Users/kernanb/Arduino/provision_unit/`          |
| Arduino libs    | `/Users/kernanb/Arduino/libraries/`               |

Arduino IDE sketchbook location must be set to `/Users/kernanb/Arduino` (File → Preferences).

---

## Firmware

- **Main sketch:** `irrigation_controller.ino`
- **Provisioning sketch:** `provision_unit.ino` — writes unit ID to NVS, run once per board before flashing main sketch
- **Libraries:** WiFi, WebServer, Preferences, OneWire, DallasTemperature, ArduinoJson, HTTPClient
- **Unit ID:** stored in NVS namespace `unit`, key `id`. If 0, device halts with fast LED blink.
- **Valve states:** persisted to NVS namespace `valves`
- **Local REST API (port 80):**
  - `GET /status` — zone valve states, moisture readings, temperature, uptime
  - `POST /valve` — body: `{"zone": N, "open": true/false}`
- **Sensor reporting:** POSTs to central server every 60s with Bearer token auth
- **API keys:** one per board, in `backend/config/device_keys.php` (git-ignored). Zone units store theirs in NVS namespace `unit`, key `api_key` (set by provisioning). A key is only accepted for its own `unit_id`.

---

## Hardware (per unit — identical across all 3)

### Power Chain
```
Solar Panel
  → Renogy Wanderer 10A Charge Controller
    → Redodo 12.8V 50Ah LiFePO4 Battery
      ├── LM2596 #1: 12V → 9V  (valve supply rail)
      └── LM2596 #2: 12V → 5V  (ESP32 VIN)

Common GND rail ties all components together.
```
> Set LM2596 voltages with a multimeter BEFORE connecting any loads.

### Valve Driver (DRV8871, one per zone)
```
DRV8871 VM   → 9V rail
DRV8871 GND  → Common GND
DRV8871 IN1  → ESP32 GPIO (see pin map)
DRV8871 IN2  → ESP32 GPIO (see pin map)
DRV8871 OUT1 → Solenoid wire 1
DRV8871 OUT2 → Solenoid wire 2
```
- **Flyback diode:** 1N4007 across OUT1–OUT2, cathode toward OUT1, close to solenoid terminals
- **Decoupling cap:** 100µF electrolytic across VM and GND on each DRV8871

### Solenoids
Rainbird 9V latching solenoids. Pulse duration: 100ms. Both IN pins return LOW after pulse (latching = holds state without power).

| Action | IN1  | IN2  |
|--------|------|------|
| Open   | HIGH | LOW  |
| Close  | LOW  | HIGH |
| Idle   | LOW  | LOW  |

### ESP32 GPIO Assignments (same for all units)

| GPIO | Function                                          |
|------|---------------------------------------------------|
| 2    | Built-in LED (solid = online, fast blink = error) |
| 4    | Zone 1 IN1                                        |
| 5    | Zone 1 IN2                                        |
| 12   | Zone 2 IN1 (strapping pin — must be LOW at boot)  |
| 13   | Zone 2 IN2                                        |
| 14   | Zone 3 IN1                                        |
| 15   | Zone 3 IN2                                        |
| 16   | Zone 4 IN1                                        |
| 17   | Zone 4 IN2                                        |
| 18   | Zone 5 IN1                                        |
| 19   | Zone 5 IN2                                        |
| 21   | DS18B20 OneWire (4.7kΩ pull-up to 3.3V)           |
| 32   | Moisture Zone 1 (ADC1)                            |
| 33   | Moisture Zone 2 (ADC1)                            |
| 34   | Moisture Zone 3 (input only)                      |
| 35   | Moisture Zone 4 (input only)                      |
| 36   | Moisture Zone 5 (input only, VP)                  |

> GPIOs 34/35/36 are input-only (no pull-up/down). GPIOs 6–11 reserved for internal flash — do not use.

### DS18B20 Temperature Sensor
```
VDD  → 3.3V
GND  → GND
DATA → GPIO 21 + 4.7kΩ pull-up to 3.3V
```

### Capacitive Moisture Sensors
```
VCC  → 3.3V
GND  → GND
AOUT → ADC pin (32–36)
```
Dry soil = high reading, wet soil = low reading. Calibrated per zone in `sensor_calibration` DB table.

---

## Zone Layout

| Zone | Unit | Local Index | Name                | Notes                          |
|------|------|-------------|---------------------|--------------------------------|
| 1    | A    | 0           | Creek Intake        | Special — interlock applies    |
| 2–5  | A    | 1–4         | Zones 2–5           |                                |
| 6    | B    | 0           | Pond to Pump Tank   | Special — interlock applies    |
| 7–10 | B    | 1–4         | Zones 7–10          |                                |
| 11–15| C    | 0–4         | Zones 11–15         |                                |

| Unit | ID | Purpose |
|------|----|---------|
| D | 4 | Placeholder on the dashboard, no hardware yet |
| E | 5 | Pondwater pre-filter flush (2 valves) + Pond Drain (filter flush board, 192.168.1.47). Zones rows 16/17/18 exist only for event logging |

**Interlock:** Creek Intake (Zone 1) and Pond to Pump Tank (Zone 6) cannot both be open simultaneously. Enforced in `backend/public/api/valve.php`.

---

## Web Backend

- **URL:** `https://paradisepond.tech/irrigation/`
- **Public files:** `backend/public/` — index.php, login.php, css/style.css, js/app.js
- **API endpoints:** `backend/public/api/` — status.php, valve.php, sensors.php, schedules.php, settings.php, events.php
- **PHP classes:** `backend/src/` — Auth.php, Database.php, Unit.php
- **Config:** `backend/config/config.php` — DB connection, API key, timezone (America/Chicago), BASE_PATH=/irrigation
- **Cron:** `backend/cron/check_schedules.php` — evaluates schedules and moisture thresholds
- **DB:** MySQL, database name `irrigation`
- **Apache config:** `backend/apache/irrigation.conf`
- **Dashboard:** polls every 15s — valve states, moisture bars, unit online/offline pills, schedules, event log

### DB Tables
`users`, `units`, `zones`, `moisture_readings`, `temperature_readings`, `valve_events`, `schedules`, `pending_closes`, `sensor_calibration`, `settings`

### Key Settings Rows (settings table)
`auto_mode_enabled`, `moisture_trigger_threshold`, `creek_pond_interlock`, `max_zone_duration_sec`

---

## Build Status (2026-06-10)

- **Unit A:** provisioned and online — IP is DHCP-assigned, was 192.168.1.124 last session (may change)
- **Units B & C:** not yet built
- **First valve bench test in progress:**
  - Zone 1 (GPIO 4 IN1, GPIO 5 IN2) → DRV8871 → Rainbird latching solenoid
  - 9V battery (temporary) → DRV8871 VM (only 1 LM2596 on hand, more ordered)
  - LM2596 set to 5.0V → ESP32 VIN
  - Common GND: 9V battery −, LM2596 OUT−, ESP32 GND all tied together
  - 8µF cap across DRV8871 VM and GND (temporary — 100µF caps on order)
  - 1N4007 diode across OUT1–OUT2
- **Bug found:** diode wired backwards — banded end (cathode) must face OUT1, currently reversed, clamping output to ~1.1V instead of 9V
- **Next step:** reverse the 1N4007 diode, confirm solenoid clicks

## Unit E — Pre-filter Flush + Pond Drain (ESP32 #2)

Separate ESP32 that flushes a pre-filter on the storage-tank inlet. Full details: `docs/filter-flush-unit.md`.

- **Valve:** U.S. Solid USS-MSV00202, 1/2" SS motorized ball valve, 9–24V, 3-wire: blue = common (−), red = constant +12V, yellow = +12V to open / off to close. Internal limit switches
- **Power:** 12V 3A supply → F1 2A → 12V rail; LM2596 → 5V (ESP32 VIN + relay JD-VCC)
- **Relay:** Songle SRD-05VDC-SL-C 2-ch module, active LOW. Relay 1 (GPIO 26) → filter 1 valve, relay 2 (GPIO 27) → filter 2 valve. Each: COM ← 12V via its own 1A fuse (F2 / F3, also feeds red), NO → yellow, NC unused. Fails closed on controller failure.
- **Firmware:** `firmware/filter_flush/filter_flush.ino`. Runs both automatic flush cycles itself (settings saved in NVS), queues valve events for the event log, and reports to `/api/filter_report.php` every 2 s (via paradisepond.tech); the reply carries the cycle settings from the web page. Local: `GET /status`, `POST /flush?seconds=N`, `POST /close`
- **Web page:** Unit E cards "Pondwater Pre-filter" and "Pondwater Pre-filter-2", each with Start/Stop flush cycle, flush period 10–120 s, wait between flushes 10–120 min. Every open/close appears in Recent Valve Events.
- **Pond Drain:** BOKYWOX A150-T50-S2-CR2-01-DC12V (2", 2-wire reverse polarity, ≤1A, ≤11 s travel). Relays 3+4 on a second 2-relay module, GPIO 25 (red) / 33 (black), fuse F4 2A. Both relays off = close (fail-safe), both on = open, relay 3 only = hold. Partial open (10–90%) is timed from `DRAIN_TRAVEL_MS`. Closes after any restart; web commands use `drain_cmd_seq` so they're never replayed. Firmware never moves the drain while a filter valve moves (and vice versa) to stay inside the 3A supply. Main fuse F1 raised to 3A. Docs: `docs/filter-flush-unit.md`.
- **Status (2026-10-26):** fully wired and tested. IP 192.168.1.47 (DHCP reservation, MAC e0:8c:fe:57:be:5c), `/flush` opens the valve and it closes when the timer ends. Fail-safe confirmed: valve closes if ESP32 loses power mid-flush. **2026-10-27:** reflashed with server polling; flush cycle started/stopped from the web page works correctly. Second valve (Pondwater Pre-filter-2, GPIO 27) wired and working; event log, 2 s check-ins, and valve opening-time allowance confirmed. Power-up test passed: both valves stay closed when the whole system is powered on. Reflashed with Pond Drain support; firmware and drain card working. Drain hardware (second 2-relay module, F4 fuse, F1 → 3A) not yet wired — relay modules on order.

## Known Issues / Architecture Notes

- **Server cannot reach ESP32 directly** — Apache runs on this Mac (same LAN as the ESP32s), but **macOS Local Network privacy blocks httpd** from connecting to LAN devices ("No route to host"; the router at 192.168.1.1 is exempt). Web UI valve commands fail with "could not reach unit". Unit E works around this by polling the server (`/api/filter_report.php`); the zone units should do the same. (Allowing httpd under System Settings → Privacy & Security → Local Network may also work, but polling keeps working if the server moves.)
- **Apache access log skips ESP32 check-ins** — `/usr/local/etc/httpd/httpd.conf` (outside this repo), in the `<VirtualHost *:80>` block:
  ```
  SetEnvIf Request_URI "^/irrigation/api/filter_report\.php$" esp32_checkin
  CustomLog "/usr/local/var/log/httpd/access_log_80" common env=!esp32_checkin
  ```
  Check-ins every 2 s would otherwise add ~4 MB/day per board. Valve events are in the DB, not this log. Add new check-in endpoints (e.g. for Units A–C) to the `SetEnvIf` pattern.
- **macOS firewall blocks LAN connections to Apache** — `http://192.168.1.128/irrigation` from another device gets an empty reply, so boards use `paradisepond.tech` (needs internet). Allowing httpd in System Settings → Network → Firewall → Options would let boards use the LAN address.
- **ESP32 core 3.x: `digitalWrite` before `pinMode` is ignored** — the pin then defaults LOW. With active-LOW relays that turned the relays on at power-up. Always call `pinMode(OUTPUT)` first, then `digitalWrite`.
- **Do not connect LM2596 5V and USB simultaneously** — causes USB port to disappear from Mac. Disconnect LM2596 VIN wire before plugging in USB for flashing.
- **temp_c = -127** means DS18B20 not connected — expected for now, no sensor wired yet.
