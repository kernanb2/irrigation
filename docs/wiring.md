# Wiring Guide

## Power Supply Chain

```
LiFePO4 12.8V Battery (+) ──┬── Fuse (12 AWG) ──── Charge Controller LOAD+
                             ├── LM2596 #1 IN+  →  OUT+ = 9V  (valve supply)
                             └── LM2596 #2 IN+  →  OUT+ = 5V  (ESP-32 VIN)

Battery (−) ──────────────── Common ground rail on terminal block
```

> **IMPORTANT:** Set LM2596 #1 output to exactly 9.0V before connecting DRV8871.
> Set LM2596 #2 output to 5.0V before connecting ESP-32.

---

## DRV8871 Wiring (per valve)

```
DRV8871 Pin   Connects To
──────────────────────────────────────────────
VM            9V rail (from LM2596 #1)
GND           Common ground
IN1           ESP-32 GPIO (see pin mapping)
IN2           ESP-32 GPIO (see pin mapping)
OUT1          Solenoid wire 1 (18 AWG)
OUT2          Solenoid wire 2 (18 AWG)
```

**Flyback protection:** Wire a 1N4007 diode across OUT1–OUT2 on each DRV8871 (cathode toward OUT1 when opening, anode toward OUT2). Place as close to the solenoid terminals as possible.

**Decoupling capacitor:** Place a 100µF electrolytic capacitor across VM and GND on each DRV8871 to suppress voltage spikes.

---

## DRV8871 Valve Logic

| Action       | IN1  | IN2  | Duration |
|--------------|------|------|----------|
| Open valve   | HIGH | LOW  | 100 ms   |
| Close valve  | LOW  | HIGH | 100 ms   |
| Idle         | LOW  | LOW  | —        |

> Latching solenoids hold their state without power. Always return both IN1 and IN2 to LOW after the pulse.

---

## DS18B20 Temperature Sensor

```
DS18B20 Pin   Connects To
──────────────────────────────────────────
VDD           3.3V
GND           GND
DATA          ESP-32 GPIO (one per unit)
              + 4.7kΩ pull-up to 3.3V
```

Multiple DS18B20 sensors can share one data line (1-Wire bus). Each has a unique 64-bit address read via software.

---

## Capacitive Moisture Sensors

```
Sensor Pin    Connects To
──────────────────────────────────────────
VCC           3.3V
GND           GND
AOUT          ESP-32 ADC pin (one per zone)
```

ESP-32 ADC range: 0–3.3V (12-bit = 0–4095). Dry soil = high reading, wet soil = low reading. Calibrate per sensor in software.

---

## Terminal Block Layout (Marine 6-circuit)

| Terminal | Wire             |
|----------|------------------|
| 1        | Battery +12V in  |
| 2        | 9V rail (valves) |
| 3        | 5V rail (ESP-32) |
| 4        | GND common       |
| 5        | Solar charge +   |
| 6        | Spare            |

---

## Wire Gauge Summary

| Run                          | Gauge  |
|------------------------------|--------|
| Battery to fuse to terminal  | 12 AWG |
| Terminal to LM2596 converters| 12 AWG |
| ESP-32 power                 | 18 AWG |
| Solenoid leads               | 18 AWG |
| Sensor signal wires          | 22 AWG |
