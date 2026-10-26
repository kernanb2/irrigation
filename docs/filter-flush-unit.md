# Filter Flush Unit (ESP32 #2)

A second ESP32 that opens and closes a motorized ball valve to flush (clean) one of the pre-filters on the line feeding the irrigation storage tank. This board is separate from the zone controllers (Units A/B/C) and has its own firmware.

---

## Parts

| Part | Notes |
|------|-------|
| ESP32 dev board | Arduino IDE board: **ESP32 Dev Module** |
| U.S. Solid **USS-MSV00202** | 1/2" stainless (SS304) motorized ball valve, full port, 9–24V AC/DC, **3-wire**, manual override. The actuator has internal limit switches, so it stops on its own at fully open / fully closed and draws almost nothing once in position. Travel time is about 5–8 s. |
| 12V 3A power supply | Powers everything |
| 2-relay module, Songle **SRD-05VDC-SL-C** | 5V relay coils, contacts rated 10A @ 30VDC. Typical modules are **active-LOW** (IN pulled LOW = relay on) and opto-isolated. |
| LM2596 buck converter (Amazon FNSKU X004ZQRESH) | 12V → 5V for the ESP32 and relay coils |
| Blade fuses + inline holders | See fusing below |

---

## How the Valve Is Driven

Wire functions, confirmed by bench test on 2026-10-26:

| Wire | Function | Connects to |
|------|----------|-------------|
| **Blue**   | Common (−) | Common GND |
| **Red**    | Constant +12V (motor power) | 12V via F2, always on |
| **Yellow** | Open signal | Relay 1 **NO** |

| Red | Yellow | Valve |
|-----|--------|-------|
| +12V | +12V | Drives / stays **open** |
| +12V | off  | Drives / stays **closed** |

The internal limit switches stop the motor at the end of travel. Relay 1 just switches +12V onto the yellow wire:

| Relay 1 | Yellow | Valve |
|---------|--------|-------|
| Off | off  | **Closed** |
| On  | +12V | **Open** |

Why it's wired this way:
- **Fails closed when the controller fails.** If the ESP32 crashes, reboots, loses WiFi, or is unplugged, the relay drops out, yellow loses power, and the valve closes. A flush valve stuck open would dump water.
- **Caveat:** red needs power to drive the valve closed. If the **12V supply itself** dies, the valve stays wherever it was.
- Only one GPIO is needed. **Relay 2 is a spare** (for example, for a second filter later).

---

## Wiring

### Power

```
12V 3A supply (+) ── FUSE F1 (2A) ──┬── 12V rail
                                    │
12V rail ───────────────────────────┼── LM2596 IN+   → OUT+ = 5.0V (5V rail)
12V rail ── FUSE F2 (1A) ───────────┴── Valve RED + Relay 1 COM  (valve power)

12V supply (−) ── Common GND rail ── LM2596 IN− / OUT−, ESP32 GND, relay GND, valve BLUE
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
| IN1 | ESP32 **GPIO 26** (valve) |
| IN2 | ESP32 **GPIO 27** (spare) |

If your module has **no JD-VCC jumper**, run VCC from 5V and test it. Check that the relay **releases** when the GPIO is HIGH (3.3V). Some modules stay energized at 3.3V. If yours does, you need a logic-level transistor, or use a module with a jumper.

### Relay 1 Contacts → Valve

```
12V rail ── F2 (1A) ──┬──────────────── Valve RED    (constant power)
                      └── Relay 1 COM
                          Relay 1 NO ── Valve YELLOW (open signal)
                          Relay 1 NC ── (not connected)
Common GND ──────────────────────────── Valve BLUE   (common)
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
| F1 | Right after the 12V supply (+) | **2A** | Protects wiring. Total normal load is well under 1A. |
| F2 | 12V feed to valve red + Relay 1 COM | **1A** | The valve motor draws roughly 0.2–0.5A at 12V (max ~5W). A jammed motor or shorted lead blows this fuse instead of overheating anything. |

The relay coils (~70mA each at 5V) and the ESP32 (~250mA peak at 5V) together draw about 0.2A from the 12V side through the LM2596, which is covered by F1.

---

## GPIO Assignments

| GPIO | Function | Notes |
|------|----------|-------|
| 2  | Built-in LED | Solid = WiFi connected, blinking = connecting |
| 26 | Relay 1 IN (valve) | Active LOW. LOW = OPEN, HIGH = CLOSED |
| 27 | Relay 2 IN (spare) | Active LOW. Held HIGH (off) |

GPIOs 26/27 are not strapping pins and don't glitch during boot. While the ESP32 boots, the module's own pull-ups keep both relays off, so the valve stays closed.

---

## Firmware

Sketch: `firmware/filter_flush/filter_flush.ino`. It needs no extra libraries.

WiFi settings and this board's API key go in `firmware/filter_flush/secrets.h` (git-ignored; copy from `secrets.example.h`). The key is the `filter-flush` entry in `backend/config/device_keys.php`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Valve state, seconds left in the current flush, seconds since last flush, uptime |
| `/flush?seconds=N` | POST | Open the valve for N seconds, then close it automatically (default 30, max 300) |
| `/close` | POST | Close the valve immediately |

Examples from a computer on the LAN:
```
curl http://<esp32-ip>/status
curl -X POST "http://<esp32-ip>/flush?seconds=20"
curl -X POST http://<esp32-ip>/close
```

The valve **always** closes when the flush timer ends. `MAX_FLUSH_SEC` caps any request, so a bad command can't leave it open indefinitely.

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

- Connecting to the central server at `paradisepond.tech`. The server can't reach LAN devices directly (see `project-context.md`). Like the zone units, this board should poll the server for commands.
- Flushing on a schedule or when the filter's pressure drop gets too high (would need a pressure sensor).
