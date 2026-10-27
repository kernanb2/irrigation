# Filter Flush Unit — Unit E (ESP32 #2)

A second ESP32 that opens and closes two motorized ball valves to flush (clean) the pre-filters on the line feeding the irrigation storage tank:

| Filter | Web page name | Relay | GPIO |
|--------|---------------|-------|------|
| 1 | Pondwater Pre-filter   | Relay 1 | 26 |
| 2 | Pondwater Pre-filter-2 | Relay 2 | 27 |

Each filter has its own independent flush cycle. This board is separate from the zone controllers (Units A/B/C) and has its own firmware.

---

## Parts

| Part | Notes |
|------|-------|
| ESP32 dev board | Arduino IDE board: **ESP32 Dev Module** |
| U.S. Solid **USS-MSV00202** ×2 (one per filter) | 1/2" stainless (SS304) motorized ball valve, full port, 9–24V AC/DC, **3-wire**, manual override. The actuator has internal limit switches, so it stops on its own at fully open / fully closed and draws almost nothing once in position. Travel time is about 5–8 s. |
| 12V 3A power supply | Powers everything |
| 2-relay module, Songle **SRD-05VDC-SL-C** | 5V relay coils, contacts rated 10A @ 30VDC. Typical modules are **active-LOW** (IN pulled LOW = relay on) and opto-isolated. |
| LM2596 buck converter (Amazon FNSKU X004ZQRESH) | 12V → 5V for the ESP32 and relay coils |
| Blade fuses + inline holders | See fusing below |

---

## How the Valve Is Driven

Wire functions, confirmed by bench test on 2026-10-26 (valve 1). Valve 2 is the same model; check its colors match before wiring it.

| Wire | Function | Connects to |
|------|----------|-------------|
| **Blue**   | Common (−) | Common GND |
| **Red**    | Constant +12V (motor power) | 12V via its fuse (F2 / F3), always on |
| **Yellow** | Open signal | Its relay's **NO** (relay 1 / relay 2) |

| Red | Yellow | Valve |
|-----|--------|-------|
| +12V | +12V | Drives / stays **open** |
| +12V | off  | Drives / stays **closed** |

The internal limit switches stop the motor at the end of travel. Each relay just switches +12V onto its valve's yellow wire:

| Relay | Yellow | Valve |
|---------|--------|-------|
| Off | off  | **Closed** |
| On  | +12V | **Open** |

Why it's wired this way:
- **Fails closed when the controller fails.** If the ESP32 crashes, reboots, loses WiFi, or is unplugged, the relay drops out, yellow loses power, and the valve closes. A flush valve stuck open would dump water.
- **Caveat:** red needs power to drive the valve closed. If the **12V supply itself** dies, the valve stays wherever it was.
- One GPIO per valve: relay 1 (GPIO 26) for filter 1, relay 2 (GPIO 27) for filter 2.

---

## Wiring

### Power

```
12V 3A supply (+) ── FUSE F1 (2A) ──┬── 12V rail
                                    │
12V rail ───────────────────────────┼── LM2596 IN+   → OUT+ = 5.0V (5V rail)
12V rail ── FUSE F2 (1A) ───────────┼── Valve 1 RED + Relay 1 COM  (filter 1 valve power)
12V rail ── FUSE F3 (1A) ───────────┴── Valve 2 RED + Relay 2 COM  (filter 2 valve power)

12V supply (−) ── Common GND rail ── LM2596 IN− / OUT−, ESP32 GND, relay GND, valve 1 + 2 BLUE
```

> **Set the LM2596 to 5.0V with a multimeter BEFORE connecting the ESP32.**
> **Do not have the LM2596 5V and USB connected at the same time** (same issue as Unit A). Unplug the 5V VIN wire before plugging in USB to flash.

### Relay Module → ESP32

Most of these modules have a 3-pin **JD-VCC / VCC / GND** header with a jumper. The ESP32 drives 3.3V logic into a module built for 5V. The reliable setup is:

| Relay module pin | Connects to |
|------------------|-------------|
| **Remove** the JD-VCC↔VCC jumper | — |
| JD-VCC | 5V rail (powers the relay coils) |
| GND (on the JD-VCC header) | Common GND |
| VCC (on the IN header) | ESP32 **3V3** (powers the opto LEDs at logic level) |
| GND (on the IN header) | ESP32 GND |
| IN1 | ESP32 **GPIO 26** (filter 1 valve) |
| IN2 | ESP32 **GPIO 27** (filter 2 valve) |

If your module has **no JD-VCC jumper**, run VCC from 5V and test it. Check that the relay **releases** when the GPIO is HIGH (3.3V). Some modules stay energized at 3.3V. If yours does, you need a logic-level transistor, or use a module with a jumper.

### Relay 1 Contacts → Valve

Relay 1 has three screw terminals. On this module, confirmed with a continuity meter on 2026-10-26:

| Terminal | Name | Relay off (idle) | Relay on (flushing) |
|----------|------|------------------|---------------------|
| 1 | **NO** (normally open)   | Open        | Connected to 2 |
| 2 | **COM** (common, middle) | —           | —              |
| 3 | **NC** (normally closed) | Connected to 2 | Open        |

To check a different module: with the relay idle, the two terminals that show continuity are COM and NC. Then start a flush; the terminal that now connects to COM is NO.

Hook-up (unplug the 12V supply while you wire):

| From | To |
|------|----|
| +12V, **after the 1A fuse (F2)** | Relay terminal **2** (COM) |
| +12V, **after the 1A fuse (F2)** | Valve **red** |
| Relay terminal **1** (NO) | Valve **yellow** |
| Relay terminal **3** (NC) | Nothing; leave it empty |
| 12V supply **−** (common ground) | Valve **blue** |

```
+12V ── F2 (1A) ──┬──────────────── RED     (constant power)
                  └── Relay 2 (COM)
                      Relay 1 (NO) ── YELLOW (open signal)
                      Relay 3 (NC) ── (empty)
GND ─────────────────────────────── BLUE    (common)
```

Red and relay COM both connect to the output side of the 1A fuse. Run one wire out of the fuse to a terminal or a small splice, then branch to both.

If the valve moves the wrong way, unplug power and check the yellow wire. It must go to terminal 1, the one that's connected only during a flush.

### Relay 2 Contacts → Valve 2 (Pondwater Pre-filter-2)

Same as relay 1. Check relay 2's terminals with the meter the same way first: with the relay idle, COM and NC show continuity. On most modules the layout is the same: **1 = NO, 2 = COM (middle), 3 = NC**.

| From | To |
|------|----|
| +12V, **after the 1A fuse (F3)** | Relay 2 terminal **2** (COM) |
| +12V, **after the 1A fuse (F3)** | Valve 2 **red** |
| Relay 2 terminal **1** (NO) | Valve 2 **yellow** |
| Relay 2 terminal **3** (NC) | Nothing; leave it empty |
| 12V supply **−** (common ground) | Valve 2 **blue** |

```
+12V ── F3 (1A) ──┬──────────────── VALVE 2 RED     (constant power)
                  └── Relay 2 term 2 (COM)
                      Relay 2 term 1 (NO) ── VALVE 2 YELLOW (open signal)
                      Relay 2 term 3 (NC) ── (empty)
GND ─────────────────────────────── VALVE 2 BLUE    (common)
```

### ESP32 Power

```
5V rail  → ESP32 VIN (5V pin)
GND rail → ESP32 GND
```

---

## Fusing

| Fuse | Location | Rating | Reason |
|------|----------|--------|--------|
| F1 | Right after the 12V supply (+) | **2A** | Protects wiring. Worst case (both valves moving at once plus electronics) is about 1.2A. |
| F2 | 12V feed to valve 1 red + Relay 1 COM | **1A** | The valve motor draws roughly 0.2–0.5A at 12V (max ~5W). A jammed motor or shorted lead blows this fuse instead of overheating anything. |
| F3 | 12V feed to valve 2 red + Relay 2 COM | **1A** | Same as F2, for valve 2. A separate fuse means a fault on one valve doesn't take out the other. |

The relay coils (~70mA each at 5V) and the ESP32 (~250mA peak at 5V) together draw about 0.2A from the 12V side through the LM2596, which is covered by F1.

---

## GPIO Assignments

| GPIO | Function | Notes |
|------|----------|-------|
| 2  | Built-in LED | Solid = WiFi connected, blinking = connecting |
| 26 | Relay 1 IN (filter 1 valve) | Active LOW. LOW = OPEN, HIGH = CLOSED |
| 27 | Relay 2 IN (filter 2 valve) | Active LOW. LOW = OPEN, HIGH = CLOSED |

GPIOs 26/27 are not strapping pins and don't glitch during boot. While the ESP32 boots, the module's own pull-ups keep both relays off, so both valves stay closed.

---

## Network

| Setting | Value |
|---------|-------|
| IP address | **192.168.1.47** (DHCP reservation in the router at 192.168.1.1) |
| MAC address | `e0:8c:fe:57:be:5c` |

The sketch still uses DHCP. The router always hands this MAC the same address. If the ESP32 board is ever replaced, the new board has a different MAC, so update the reservation.

---

## Firmware

Sketch: `firmware/filter_flush/filter_flush.ino`. Needs the **ArduinoJson** library (v7), already installed for the zone sketch.

WiFi settings and this board's API key go in `firmware/filter_flush/secrets.h` (git-ignored; copy from `secrets.example.h`). The key is the `filter-flush` entry in `backend/config/device_keys.php`.

### Automatic Flush Cycle (Web Page)

On the dashboard, Unit E has two cards, **Pondwater Pre-filter** and **Pondwater Pre-filter-2**. Each has its own:
- **Start / Stop flush cycle** button
- **Flush period:** 10–120 seconds (steps of 10). How long the valve stays **fully open**. The valve takes about 3–5 s to swing open, so the relay stays on 5 s longer than the flush period (`VALVE_OPEN_TRAVEL_MS` in the sketch). A 10 s flush keeps the relay on for 15 s.
- **Wait time between flushes:** 10–120 minutes (steps of 10). How long it stays closed before the next flush.

How the cycle behaves:
- **Start:** flushes right away, then repeats: open for the flush period, wait, flush again.
- **Stop:** closes the valve immediately (even mid-flush) and stops the cycle.
- The two cycles are independent, so both valves can flush at the same time.
- **Changing the wait time while running:** the next flush is rescheduled from the end of the last one. If that time has already passed, it flushes right away.
- The **ESP32 runs the timer itself** and saves the settings in flash. The cycle keeps going if WiFi or the server goes down, and resumes after a reboot. After a reboot, the first flush comes one wait period later.

### Talking to the Server

Unit E **reports to the server every 2 s** (`POST /api/filter_report.php`, Bearer key). The server's reply contains the cycle settings chosen on the web page, and the board applies them. So a change on the web page (like Start) reaches the board within about 2 s. Until then the card shows "Sending to Unit E…".

The board reaches the server through `paradisepond.tech` (Cloudflare), about 0.1–0.2 s per check-in. That means it depends on the internet connection. Using the Mac's LAN address (`http://192.168.1.128/irrigation`) instead would avoid that, but the macOS firewall currently blocks incoming LAN connections to Apache.

The server can't push to the board (see "Server cannot reach ESP32 directly" in `project-context.md`), so the board has to poll. The page shows Unit E as **offline** if it hasn't reported in 30 s.

| Server endpoint | Auth | Used by |
|-----------------|------|---------|
| `/api/filter_report.php` (POST) | `filter-flush` API key, only accepted for unit 5 | Unit E: sends status, gets settings |
| `/api/filter.php` (GET / POST) | Login session | Web page: reads status, changes settings |

Settings are stored in the `settings` table as `filter1_cycle_enabled`, `filter1_flush_sec`, `filter1_wait_min` (and the same with `filter2_`). The last report is stored as `filter_last_report`.

### Event Log

Every valve open and close appears in **Recent Valve Events** on the dashboard, with the filter name, the action, and why it happened:

| Shown as | Meaning |
|----------|---------|
| flush cycle | The automatic cycle opened or closed the valve |
| cycle stopped | Stop flush cycle was pressed and closed the valve |
| local LAN command | `/flush` or `/close` was called directly on the board |

The board queues each open/close (up to 32) and sends them with its next report. Flushes are logged even if a check-in fails, and events from a WiFi outage are sent when it reconnects. The time shown is when the valve actually moved. Each event has a sequence number, so a report that's sent twice doesn't create duplicates.

Each filter has a row in the `zones` table (ids 16 and 17, unit 5) so `valve_events` can refer to it. These ids are outside the 1–15 range, so they can't be opened from the zone controls or scheduled.

### Local Endpoints (LAN only, for testing)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | For each valve: state, flush time left, cycle settings, time to next flush. Plus uptime |
| `/flush?valve=V&seconds=N` | POST | Open valve V (1 or 2, default 1) fully for N seconds (plus the 5 s opening time), then close it automatically (default 30, max 300) |
| `/close?valve=V` | POST | Close valve V immediately (its cycle continues; next flush is one wait period later) |

Examples from a computer on the LAN:
```
curl http://192.168.1.47/status
curl -X POST "http://192.168.1.47/flush?valve=2&seconds=20"
curl -X POST "http://192.168.1.47/close?valve=2"
```

The valve **always** closes when the flush timer ends. `MAX_FLUSH_SEC` caps manual requests, and the cycle only accepts 10–120 s, so a bad command can't leave it open indefinitely.

---

## Bring-Up Checklist

1. ~~Identify the valve wires~~ Done: blue = common, red = power, yellow = open.
2. Set the LM2596 to 5.0V with no load.
3. Wire power, fuses, relay module, and valve. Leave the ESP32 unplugged.
4. Power on. The valve should drive **closed** (relay off → yellow unpowered).
5. Flash the ESP32 over USB (LM2596 VIN disconnected). Open Serial Monitor at 115200 baud and note the IP address.
6. Disconnect USB, reconnect the LM2596 5V, and power up.
7. `curl -X POST "http://<ip>/flush?seconds=15"`. The relay clicks, the valve opens, and about 15 s later it closes.
8. Pull the ESP32's power during a flush. The valve should close.

## Not Yet Done

- Flushing when the filter's pressure drop gets too high (would need a pressure sensor).
