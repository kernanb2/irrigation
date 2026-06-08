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

## Build Status (2026-06-08)

- **Unit A:** provisioned and online at 192.168.1.118
- **Units B & C:** not yet built
- **In progress:** first valve bench test — Zone 1 (GPIO 4/5), one DRV8871, one Rainbird solenoid
- **Power:** 12V LiPo → LM2596 #1 (9V for valves) + LM2596 #2 (5V for ESP32)
- **Next step:** set LM2596 voltages, wire DRV8871 for Zone 1, test via web UI
