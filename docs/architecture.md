# Irrigation System Architecture

## Overview
A solar-powered, WiFi-connected irrigation controller spanning 15 zones across 3 ESP-32 units. A central web server coordinates all units, persists data to MySQL, and serves a web UI for monitoring and control.

---

## System Diagram

```
[Solar Panel]
     |
[Renogy Wanderer 10A Charge Controller]
     |
[Redodo 12.8V 50Ah LiFePO4 Battery]
     |___________________________________
     |                                   |
[LM2596 #1: 12V → 9V]          [LM2596 #2: 12V → 5V]
  (valve supply rail)               (ESP-32 supply)
     |                                   |
[DRV8871 × 5]                      [ESP-32]
     |
[Rainbird 9V Latching Solenoids × 5]
```

---

## Units

| Unit | Zones         | Notes                              |
|------|---------------|------------------------------------|
| A    | 1–5           | Includes creek intake valve        |
| B    | 6–10          | Includes pond → pump tank valve    |
| C    | 11–15         | Standard irrigation zones          |

Each unit is identical in hardware design.

---

## Network Architecture

```
[Outdoor Mesh WiFi Network]
         |
    _____|_______________
   |           |         |
[ESP-32 A] [ESP-32 B] [ESP-32 C]
   |           |         |
   |___________|_________|
                |
         [Central Server]
          - Web UI
          - REST API
          - MySQL Database
```

- Each ESP-32 exposes a local REST API on port 80
- Central server polls ESP-32s for status and issues valve commands
- ESP-32s report sensor readings to the central server
- Central server makes scheduling and automation decisions using MySQL data

---

## Control Modes

| Mode        | Trigger                        | Decision Maker    |
|-------------|--------------------------------|-------------------|
| Manual      | Web UI button press            | User              |
| Time-based  | Cron schedule in MySQL         | Central server    |
| Automatic   | Moisture sensor threshold      | Central server    |
| Temperature | DS18B20 threshold (heat alert) | Central server    |

---

## Data Flow

1. ESP-32s read moisture + temperature sensors every 60 seconds
2. Readings posted to central server REST API → stored in MySQL
3. Central server evaluates schedules and thresholds → issues valve commands
4. ESP-32 executes valve pulse → reports new state back to server
5. Web UI polls server for live status display

---

## Special Zones

- **Creek intake valve (Zone 1, Unit A):** Opens creek water supply. Should only activate when downstream zones require water and pond level is adequate.
- **Pond → pump tank valve (Zone 6, Unit B):** Fills pump/holding tank from pond. Interlock logic should prevent this and creek valve from being open simultaneously.
