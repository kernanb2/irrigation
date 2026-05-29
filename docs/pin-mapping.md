# ESP-32 Pin Mapping (Per Unit — 5 Zones)

## GPIO Assignments

| GPIO | Function         | Notes                              |
|------|------------------|------------------------------------|
| 2    | Built-in LED     | Status indicator                   |
| 4    | Zone 1 IN1       | DRV8871 driver, valve 1            |
| 5    | Zone 1 IN2       | DRV8871 driver, valve 1            |
| 12   | Zone 2 IN1       | DRV8871 driver, valve 2            |
| 13   | Zone 2 IN2       | DRV8871 driver, valve 2            |
| 14   | Zone 3 IN1       | DRV8871 driver, valve 3            |
| 15   | Zone 3 IN2       | DRV8871 driver, valve 3            |
| 16   | Zone 4 IN1       | DRV8871 driver, valve 4            |
| 17   | Zone 4 IN2       | DRV8871 driver, valve 4            |
| 18   | Zone 5 IN1       | DRV8871 driver, valve 5            |
| 19   | Zone 5 IN2       | DRV8871 driver, valve 5            |
| 21   | DS18B20 Data     | 1-Wire bus, 4.7kΩ pull-up to 3.3V |
| 32   | Moisture Zone 1  | ADC1_CH4 — analog input            |
| 33   | Moisture Zone 2  | ADC1_CH5 — analog input            |
| 34   | Moisture Zone 3  | ADC1_CH6 — analog input (input only)|
| 35   | Moisture Zone 4  | ADC1_CH7 — analog input (input only)|
| 36   | Moisture Zone 5  | ADC1_CH0 (VP) — analog input only  |

## Notes
- GPIOs 34, 35, 36 are **input only** — no internal pull-up/pull-down
- GPIOs 6–11 are connected to internal flash — **do not use**
- GPIO 12 must be LOW at boot — avoid pull-up on this pin
- ADC2 pins (GPIO 0, 2, 4, 12–15, 25–27) conflict with WiFi — use ADC1 pins (32–39) for sensors
- All DRV8871 IN pins default LOW (valve closed) on ESP-32 boot

## Zone Numbering Per Unit

| Unit | Physical Zones | Local Zone Index |
|------|---------------|-----------------|
| A    | 1–5           | 0–4             |
| B    | 6–10          | 0–4             |
| C    | 11–15         | 0–4             |

Each ESP-32 uses the same firmware with a **unit ID** stored in NVS flash (set once during provisioning).
