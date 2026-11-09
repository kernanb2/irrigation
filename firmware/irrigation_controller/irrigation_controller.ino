#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include <algorithm>
#include "secrets.h"   // git-ignored — copy from secrets.example.h

// ── Which unit this board is ──────────────────────────────────────────────────
// Set in secrets.h together with that unit's key: 1 = Unit A, 2 = B, 3 = C, 4 = D.
// Unit D has four zones and the pond level sensor.
#define UNIT_ID           SECRET_UNIT_ID

// ── WiFi credentials ─────────────────────────────────────────────────────────
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// ── Central server ────────────────────────────────────────────────────────────
// The board checks in every CHECKIN_MS; the reply says which valves should be
// open and for how many more seconds. Key = 'unit-a' … 'unit-d' in
// backend/config/device_keys.php.
const char* SERVER_URL    = "http://paradisepond.tech/irrigation";
const char* API_KEY       = SECRET_API_KEY;
#define CHECKIN_MS        5000UL   // also how fast Open/Close on the web page takes effect
#define HTTP_TIMEOUT_MS   3000
#define SENSOR_REPORT_MS  60000UL  // moisture, temperature (and pond level) go with one check-in a minute

// ── Hardware pin assignments ──────────────────────────────────────────────────
#define LED_BUILTIN_PIN   2
#define ONE_WIRE_PIN      21

// DRV8871 per zone: IN1/IN2. GPIO 12 is a strapping pin and must be LOW at boot —
// the DRV8871's own input pull-downs keep it LOW.
#if UNIT_ID == 4
#define NUM_ZONES         4
#define POND_SENSOR       1
const uint8_t VALVE_IN1[NUM_ZONES]    = {4,  12, 14, 16};
const uint8_t VALVE_IN2[NUM_ZONES]    = {5,  13, 15, 17};
const uint8_t MOISTURE_PIN[NUM_ZONES] = {32, 33, 34, 35};   // DFRobot SEN0308
#else
#define NUM_ZONES         5
#define POND_SENSOR       0
const uint8_t VALVE_IN1[NUM_ZONES]    = {4,  12, 14, 16, 18};
const uint8_t VALVE_IN2[NUM_ZONES]    = {5,  13, 15, 17, 19};
const uint8_t MOISTURE_PIN[NUM_ZONES] = {32, 33, 34, 35, 36};
#endif

// ── Pond level (Unit D) ───────────────────────────────────────────────────────
// Taidacent waterproof ultrasonic sensor, UART 9600 8N1, mounted above the water
// looking down. Each frame is 0xFF, high byte, low byte, checksum (low 8 bits of
// the sum of the first three); the distance is high × 256 + low in mm. The
// "auto output" version sends frames on its own; the "controlled" version answers
// a byte on its RX, so the board sends one whenever frames stop arriving.
#define POND_RX_PIN       26        // ← sensor TX (pin 4, white)
#define POND_TX_PIN       27        // → sensor RX (pin 3, yellow). Power it from 3.3V (red, black = GND)
#define POND_SAMPLES      15        // median of the latest readings, to ride out ripples
#define POND_STALE_MS     10000UL   // no reading for this long = sensor not answering

// ── Valves ────────────────────────────────────────────────────────────────────
// Rainbird 9V latching solenoids: a 100 ms pulse switches them, and they stay
// put without power. Open = IN1 HIGH, close = IN2 HIGH, idle = both LOW.
#define VALVE_PULSE_MS    100
#define VALVE_GAP_MS      200   // between pulses, so two solenoids never pulse at once

// ── Global state ──────────────────────────────────────────────────────────────
WebServer         server(80);
Preferences       prefs;
OneWire           oneWire(ONE_WIRE_PIN);
DallasTemperature tempSensors(&oneWire);

struct Zone {
    bool          open;
    unsigned long closeAtMs;     // the board closes the valve itself at this time
};
Zone zones[NUM_ZONES];

unsigned long lastCheckinMs  = 0;
unsigned long lastSensorMs   = 0;
bool          sensorsDue     = true;   // send readings with the first check-in

#if POND_SENSOR
uint16_t      pondSamples[POND_SAMPLES];
uint8_t       pondCount      = 0, pondNext = 0;
unsigned long pondLastMs     = 0;       // last good frame
unsigned long pondPollMs     = 0;
uint8_t       pondFrame[4];
uint8_t       pondPos        = 0;
#endif

// ── Valve event queue ─────────────────────────────────────────────────────────
// Every open/close is queued and sent with the next check-in, so moves during a
// WiFi outage still reach the event log. seq starts at 1 each boot; the server
// uses boot_id + seq to skip events it already stored.
enum Reason : uint8_t { REASON_SERVER, REASON_TIMER, REASON_RESTART };
const char* REASON_NAME[] = {"server", "timer", "restart"};

struct ValveEvent {
    uint32_t      seq;
    uint8_t       zone;          // local index 0 to NUM_ZONES - 1
    bool          open;
    Reason        reason;
    unsigned long atMs;
};
#define EVENT_QUEUE_LEN   32
ValveEvent    eventQueue[EVENT_QUEUE_LEN];
uint8_t       eventCount   = 0;
uint32_t      nextEventSeq = 1;
uint32_t      bootId       = 0;

void queueEvent(uint8_t z, bool open, Reason reason) {
    if (eventCount == EVENT_QUEUE_LEN) {   // full (long WiFi outage) — drop the oldest
        memmove(eventQueue, eventQueue + 1, sizeof(ValveEvent) * (EVENT_QUEUE_LEN - 1));
        eventCount--;
    }
    eventQueue[eventCount++] = {nextEventSeq++, z, open, reason, millis()};
}

void dropSentEvents(uint8_t sent) {
    memmove(eventQueue, eventQueue + sent, sizeof(ValveEvent) * (eventCount - sent));
    eventCount -= sent;
}

// ── Valve control ─────────────────────────────────────────────────────────────
void saveValveStates() {
    prefs.begin("valves", false);
    for (uint8_t i = 0; i < NUM_ZONES; i++) {
        char key[4];
        snprintf(key, sizeof(key), "v%d", i);
        prefs.putBool(key, zones[i].open);
    }
    prefs.end();
}

void pulse(uint8_t z, bool open) {
    digitalWrite(VALVE_IN1[z], open ? HIGH : LOW);
    digitalWrite(VALVE_IN2[z], open ? LOW  : HIGH);
    delay(VALVE_PULSE_MS);
    digitalWrite(VALVE_IN1[z], LOW);
    digitalWrite(VALVE_IN2[z], LOW);
    delay(VALVE_GAP_MS);
}

void setValve(uint8_t z, bool open, Reason reason, uint32_t runSec = 0) {
    if (open) zones[z].closeAtMs = millis() + runSec * 1000UL;
    if (zones[z].open == open) return;
    pulse(z, open);
    zones[z].open = open;
    saveValveStates();
    queueEvent(z, open, reason);
    Serial.printf("Zone %d valve %s (%s)\n", z, open ? "OPEN" : "CLOSED", REASON_NAME[reason]);
}

// Close any valve whose run time is up — works without WiFi
void runTimers() {
    for (uint8_t z = 0; z < NUM_ZONES; z++) {
        if (zones[z].open && (long)(millis() - zones[z].closeAtMs) >= 0) {
            setValve(z, false, REASON_TIMER);
        }
    }
}

// ── Status ────────────────────────────────────────────────────────────────────
void fillStatus(JsonDocument& doc) {
    unsigned long now = millis();
    doc["unit_id"]  = UNIT_ID;
    doc["ip"]       = WiFi.localIP().toString();
    doc["uptime_s"] = now / 1000;
    doc["rssi"]     = WiFi.RSSI();   // dBm, shown on the dashboard
    doc["bssid"]    = WiFi.BSSIDstr();   // which access point it's on
    JsonArray arr = doc["valves"].to<JsonArray>();
    for (uint8_t z = 0; z < NUM_ZONES; z++) {
        JsonObject o = arr.add<JsonObject>();
        o["open"] = zones[z].open;
        long left = zones[z].open ? (long)(zones[z].closeAtMs - now) / 1000 : 0;
        o["remaining_s"] = left < 0 ? 0 : left;
    }
}

#if POND_SENSOR
// Read whatever bytes have arrived and keep each good frame's distance
void readPond() {
    while (Serial2.available()) {
        uint8_t b = Serial2.read();
        if (pondPos == 0 && b != 0xFF) continue;   // wait for a frame start
        pondFrame[pondPos++] = b;
        if (pondPos < 4) continue;
        pondPos = 0;
        if (((pondFrame[0] + pondFrame[1] + pondFrame[2]) & 0xFF) != pondFrame[3]) continue;
        uint16_t mm = pondFrame[1] << 8 | pondFrame[2];
        if (mm == 0) continue;                     // nothing in range
        pondSamples[pondNext] = mm;
        pondNext = (pondNext + 1) % POND_SAMPLES;
        if (pondCount < POND_SAMPLES) pondCount++;
        pondLastMs = millis();
    }
    // Controlled-output sensors only measure when asked
    if (millis() - pondLastMs > 1000 && millis() - pondPollMs > 300) {
        pondPollMs = millis();
        Serial2.write(0x55);
    }
}

// Median of the recent readings in mm, or 0 when the sensor has gone quiet
uint16_t pondDistanceMm() {
    if (pondCount == 0 || millis() - pondLastMs > POND_STALE_MS) return 0;
    uint16_t sorted[POND_SAMPLES];
    memcpy(sorted, pondSamples, sizeof(uint16_t) * pondCount);
    std::sort(sorted, sorted + pondCount);
    return sorted[pondCount / 2];
}
#endif

void fillSensors(JsonDocument& doc) {
    JsonObject s = doc["sensors"].to<JsonObject>();
    JsonArray m  = s["moisture"].to<JsonArray>();
    for (uint8_t z = 0; z < NUM_ZONES; z++) m.add(analogRead(MOISTURE_PIN[z]));   // 0–4095, dry = high

#if POND_SENSOR
    uint16_t mm = pondDistanceMm();
    if (mm) s["pond_mm"] = mm;
    else    s["pond_mm"] = nullptr;   // the server shows "no reading"
#endif

    tempSensors.requestTemperatures();
    s["temp_c"] = tempSensors.getTempCByIndex(0);   // -127 = no sensor connected
    DeviceAddress addr;
    if (tempSensors.getAddress(addr, 0)) {
        char addrStr[17];
        for (uint8_t i = 0; i < 8; i++) sprintf(addrStr + i * 2, "%02X", addr[i]);
        s["sensor_addr"] = addrStr;
    }
}

// ── Server check-in ───────────────────────────────────────────────────────────
void checkIn() {
    JsonDocument doc;
    fillStatus(doc);
    bool withSensors = sensorsDue;
    if (withSensors) fillSensors(doc);

    unsigned long now = millis();
    uint8_t sent      = eventCount;
    doc["boot_id"]    = String(bootId, HEX);
    JsonArray events  = doc["events"].to<JsonArray>();
    for (uint8_t i = 0; i < sent; i++) {
        JsonObject e = events.add<JsonObject>();
        e["seq"]    = eventQueue[i].seq;
        e["zone"]   = eventQueue[i].zone;
        e["action"] = eventQueue[i].open ? "open" : "close";
        e["reason"] = REASON_NAME[eventQueue[i].reason];
        e["ago_s"]  = (now - eventQueue[i].atMs) / 1000;
    }

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(String(SERVER_URL) + "/api/unit_report.php");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + API_KEY);
    int code = http.POST(body);

    if (code == 200) {
        JsonDocument reply;
        if (!deserializeJson(reply, http.getString()) && reply["zones"].is<JsonArray>()) {
            dropSentEvents(sent);   // server has them now (events queued during the POST stay)
            if (withSensors) sensorsDue = false;
            JsonArray want = reply["zones"];
            for (uint8_t z = 0; z < NUM_ZONES && z < want.size(); z++) {
                bool     open = want[z]["open"] | false;
                uint32_t runS = want[z]["run_s"] | 0;
                if (open && runS > 0) setValve(z, true, REASON_SERVER, runS);   // also refreshes the end time
                else if (!open)       setValve(z, false, REASON_SERVER);
            }
        } else {
            Serial.printf("Server reply not understood: %s\n", http.getString().c_str());
        }
    } else {
        Serial.printf("Check-in failed: %d\n", code);
    }
    http.end();
}

// ── Local endpoint (LAN only, for testing) ────────────────────────────────────
// Valves are controlled from the web page only — the server decides what's open.
void handleStatus() {
    JsonDocument doc;
    fillStatus(doc);
    fillSensors(doc);
    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
}

// ── WiFi ──────────────────────────────────────────────────────────────────────
// Waits up to 20 s at boot; after that the ESP32 reconnects on its own and any
// open valve still closes on its timer without WiFi.
void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("Unit %d connecting to %s", UNIT_ID, WIFI_SSID);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
        digitalWrite(LED_BUILTIN_PIN, !digitalRead(LED_BUILTIN_PIN));
        delay(250);
        Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\nConnected, IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\nWiFi not connected yet — continuing, will keep retrying");
    }
}

// ── Setup / loop ──────────────────────────────────────────────────────────────
void setup() {
    // Driver inputs LOW first (idle). pinMode before digitalWrite: on ESP32 core 3.x
    // a digitalWrite before pinMode is ignored.
    for (uint8_t z = 0; z < NUM_ZONES; z++) {
        pinMode(VALVE_IN1[z], OUTPUT);
        pinMode(VALVE_IN2[z], OUTPUT);
        digitalWrite(VALVE_IN1[z], LOW);
        digitalWrite(VALVE_IN2[z], LOW);
        pinMode(MOISTURE_PIN[z], INPUT);
    }
    pinMode(LED_BUILTIN_PIN, OUTPUT);

    Serial.begin(115200);
#if POND_SENSOR
    Serial2.begin(9600, SERIAL_8N1, POND_RX_PIN, POND_TX_PIN);
#endif
    bootId = esp_random();
    tempSensors.begin();

    // Latching valves keep whatever state they had, and the run timer was lost, so
    // close every valve at power-up. If the web page or a schedule still wants one
    // open, the first check-in reopens it for the time that's left.
    prefs.begin("valves", true);
    bool wasOpen[NUM_ZONES];
    for (uint8_t z = 0; z < NUM_ZONES; z++) {
        char key[4];
        snprintf(key, sizeof(key), "v%d", z);
        wasOpen[z] = prefs.getBool(key, false);
    }
    prefs.end();
    for (uint8_t z = 0; z < NUM_ZONES; z++) {
        pulse(z, false);
        zones[z] = {false, 0};
        if (wasOpen[z]) queueEvent(z, false, REASON_RESTART);
    }
    saveValveStates();
    Serial.printf("Unit %d: all valves closed\n", UNIT_ID);

    connectWiFi();

    server.on("/status", HTTP_GET, handleStatus);
    server.begin();
}

void loop() {
    server.handleClient();
    runTimers();
#if POND_SENSOR
    readPond();
#endif

    bool online = WiFi.status() == WL_CONNECTED;
    digitalWrite(LED_BUILTIN_PIN, online ? HIGH : (millis() / 250) % 2);   // solid = online, blink = no WiFi

    if (millis() - lastSensorMs >= SENSOR_REPORT_MS) {
        lastSensorMs = millis();
        sensorsDue   = true;
    }
    if (online && millis() - lastCheckinMs >= CHECKIN_MS) {
        lastCheckinMs = millis();
        checkIn();
        runTimers();
    }
}
