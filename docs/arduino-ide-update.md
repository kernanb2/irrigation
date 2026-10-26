# Updating the Arduino IDE (macOS)

Versions in use as of 2026-10-26: **Arduino IDE 2.3.10**, **esp32 by Espressif Systems 3.3.10**.

There are three separate things you can update: the **IDE app**, the **ESP32 board package**, and the **libraries**. Updating one doesn't update the others.

## Before You Start

- Your sketches in `/Users/kernanb/Arduino` and your settings, boards, and libraries in `~/Library/Arduino15` are **not touched** when you replace the app.
- Optional backup: `cp -R ~/Library/Arduino15 ~/Arduino15-backup`
- Close the IDE and Serial Monitor before updating.

## 1. Update the IDE App

**Option A: built-in updater (easiest)**
1. Open Arduino IDE → **Arduino IDE menu → Check for Arduino IDE Updates…** (on some versions this is under **Help**).
2. If an update is offered, click **Download**, then **Install and Restart**.

**Option B: manual install**
1. Go to <https://www.arduino.cc/en/software> and download **Arduino IDE 2.x, macOS**. Pick **Apple Silicon** or **Intel** to match your Mac ( → About This Mac → Chip/Processor).
2. Open the `.dmg` and drag **Arduino IDE** into **Applications**. Choose **Replace**.
3. Launch it. If macOS blocks it, go to System Settings → Privacy & Security → **Open Anyway**.

Afterward, check **File → Preferences → Sketchbook location** is still `/Users/kernanb/Arduino`.

## 2. Update the ESP32 Board Package

1. **File → Preferences → Additional boards manager URLs** should contain:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
   If it has the older `raw.githubusercontent.com/.../gh-pages/package_esp32_index.json` URL, replace it with this one.
2. **Tools → Board → Boards Manager**, search `esp32`. Under **esp32 by Espressif Systems**, choose the newest version and click **Install** (or **Update**).
3. Re-select **Tools → Board → esp32 → ESP32 Dev Module** and the correct **Port**.

Stay on the **3.x** series. Don't go back to 2.x, and before jumping to a new major version (4.x), check its release notes for breaking changes.

## 3. Update Libraries

1. **Tools → Manage Libraries…** and set the **Type** filter to **Updatable**.
2. Update **OneWire** and **DallasTemperature** freely.
3. **ArduinoJson:** the zone-controller sketch is written for v6 (`StaticJsonDocument`). Version 7 still compiles it but prints deprecation warnings. Updating is fine, but if you get compile errors, install the latest **6.x** from the version dropdown.

The filter-flush sketch uses no external libraries.

## 4. Verify

1. Open `irrigation_controller.ino` and `filter_flush.ino` and click **Verify** (✓) on each. Both should compile without errors.
2. Remember to unplug the LM2596 5V from VIN before connecting USB to upload.

## If Something Breaks

- **Board package:** in Boards Manager, use the version dropdown to reinstall the previous version (3.3.10).
- **Library:** in Library Manager, use the version dropdown the same way.
- **IDE:** older versions are on the Arduino GitHub releases page: <https://github.com/arduino/arduino-ide/releases>
