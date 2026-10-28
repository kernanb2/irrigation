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

## Zone Units A–C (`irrigation_controller/`)

The same sketch runs on all three boards. It reads the unit ID, WiFi settings and API key from `irrigation_controller/secrets.h` (git-ignored):

1. Copy `secrets.example.h` to `secrets.h`.
2. Set `SECRET_UNIT_ID` (1 = A, 2 = B, 3 = C) and paste in that unit's key (`unit-a` / `unit-b` / `unit-c` in `backend/config/device_keys.php`).
3. Flash. Before flashing the next board, change both lines in `secrets.h`.

The board checks in with the server every 5 s (`/api/unit_report.php`); the reply says which valves should be open and for how much longer. The board closes each valve itself when its time is up, even without WiFi, and closes all valves at power-up. Only `GET /status` is served locally — valves are controlled from the web page.

**Rotating a key:** run `openssl rand -hex 32`, put the result in `device_keys.php` and the board's `secrets.h`, then reflash that board.

### Filter flush board

`filter_flush/` reads its WiFi settings and key from `filter_flush/secrets.h` (git-ignored). Copy `secrets.example.h` to `secrets.h` and paste in the `filter-flush` key from `device_keys.php`.
