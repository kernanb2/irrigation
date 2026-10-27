# Firmware

## Required Arduino Libraries

Install via Arduino IDE → Library Manager:
- **ArduinoJson** by Benoit Blanchon (v7.x; the filter-flush sketch needs v7)
- **OneWire** by Paul Stoffregen
- **DallasTemperature** by Miles Burton

## Board Setup

1. In Arduino IDE, go to **File → Preferences → Additional Board URLs** and add:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
2. Go to **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif Systems**
3. Select **Tools → Board → ESP32 Arduino → ESP32 Dev Module**

## Provisioning (Set Unit ID and API Key)

Each board has its **own** API key. Keys live in `backend/config/device_keys.php` on the server (git-ignored). Before flashing the main sketch, run this one-time sketch to store the unit ID and that unit's key in NVS flash:

```cpp
#include <Preferences.h>

#define UNIT_ID 1                          // 1, 2, or 3 for Unit A, B, C
#define API_KEY "PASTE_KEY_FOR_THIS_UNIT"  // 'unit-a' / 'unit-b' / 'unit-c' in device_keys.php

void setup() {
    Serial.begin(115200);
    delay(1000);
    Preferences prefs;
    prefs.begin("unit", false);
    prefs.putUChar("id", UNIT_ID);
    prefs.putString("api_key", API_KEY);
    prefs.end();
    Serial.printf("Unit ID %d and API key saved.\n", UNIT_ID);
}
void loop() {}
```

Don't commit the provisioning sketch with a real key in it. If the unit ID or key is missing, the main sketch halts with a fast-blinking LED.

**Rotating a key:** run `openssl rand -hex 32`, put the result in `device_keys.php`, then re-run provisioning on that board. You don't need to reflash the main sketch.

### Filter flush board

`filter_flush/` reads its WiFi settings and key from `filter_flush/secrets.h` (git-ignored). Copy `secrets.example.h` to `secrets.h` and paste in the `filter-flush` key from `device_keys.php`.

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
