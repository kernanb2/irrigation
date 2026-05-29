# Firmware

## Required Arduino Libraries

Install via Arduino IDE → Library Manager:
- **ArduinoJson** by Benoit Blanchon (v6.x)
- **OneWire** by Paul Stoffregen
- **DallasTemperature** by Miles Burton

## Board Setup

1. In Arduino IDE, go to **File → Preferences → Additional Board URLs** and add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
2. Go to **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif Systems**
3. Select **Tools → Board → ESP32 Arduino → ESP32 Dev Module**

## Provisioning (Set Unit ID)

Before flashing, run this one-time sketch to burn the unit ID into NVS flash:

```cpp
#include <Preferences.h>
void setup() {
    Preferences prefs;
    prefs.begin("unit", false);
    prefs.putUChar("id", 1);  // Change to 1, 2, or 3 for Unit A, B, C
    prefs.end();
    Serial.begin(115200);
    Serial.println("Unit ID saved.");
}
void loop() {}
```

## Configuration

Edit these lines in `irrigation_controller.ino` before flashing:
```cpp
const char* WIFI_SSID     = "YOUR_SSID";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* SERVER_URL    = "http://YOUR_SERVER_IP:3000";
```

## REST API

| Endpoint  | Method | Description              |
|-----------|--------|--------------------------|
| `/status` | GET    | Returns zone states, moisture readings, temperature |
| `/valve`  | POST   | Open or close a valve    |

### POST /valve
```json
{ "zone": 0, "open": true }
```
- `zone`: 0–4 (local index within this unit)
- `open`: true = open valve, false = close valve
