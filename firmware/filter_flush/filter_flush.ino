#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "secrets.h"   // git-ignored — copy from secrets.example.h

// ── WiFi credentials ─────────────────────────────────────────────────────────
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// ── Central server ────────────────────────────────────────────────────────────
// This board is Unit E. It reports every REPORT_MS and the reply carries the
// flush cycles chosen on the web page. Key = 'filter-flush' in device_keys.php.
const char* SERVER_URL    = "http://paradisepond.tech/irrigation";
const char* API_KEY       = SECRET_API_KEY;
#define UNIT_ID           5
#define REPORT_MS         2000UL   // also how fast Start/Stop on the web page takes effect
#define HTTP_TIMEOUT_MS   2000     // a check-in normally takes 0.1–0.2 s

// ── Hardware pin assignments ──────────────────────────────────────────────────
#define LED_BUILTIN_PIN   2
#define NUM_FILTERS       2
// Filter 1 = "Pondwater Pre-filter"   → Relay 1 (GPIO 26), NO → valve 1 yellow
// Filter 2 = "Pondwater Pre-filter-2" → Relay 2 (GPIO 27), NO → valve 2 yellow
const uint8_t RELAY_PIN[NUM_FILTERS] = {26, 27};

// Relay module inputs are active LOW
#define RELAY_ON          LOW
#define RELAY_OFF         HIGH

// ── Flush limits ──────────────────────────────────────────────────────────────
#define DEFAULT_FLUSH_SEC 30
#define MAX_FLUSH_SEC     300   // manual /flush cap

// The ball valve takes ~3–5 s to swing open after the relay clicks. The relay
// stays on this much longer than the flush period, so the flush period is the
// time the valve is fully open. Raise it if the valve is slower than this.
#define VALVE_OPEN_TRAVEL_MS 5000

// Automatic cycle — both web page lists run 10–120 in steps of 10
#define CYCLE_MIN         10
#define CYCLE_MAX         120

// ── Global state ──────────────────────────────────────────────────────────────
WebServer       server(80);
Preferences     prefs;

struct Filter {
    bool          valveOpen;
    unsigned long flushEndMs;
    unsigned long lastFlushMs;    // 0 = no flush since boot
    bool          cycleEnabled;
    uint16_t      flushSec;
    uint16_t      waitMin;
    unsigned long nextFlushMs;    // valid while cycleEnabled and valve closed
};
Filter filters[NUM_FILTERS];

unsigned long   lastReportMs  = 0;

// ── Valve event queue ─────────────────────────────────────────────────────────
// Every open/close is queued and sent with the next report, so flushes shorter
// than the report interval still reach the event log. seq starts at 1 each boot;
// the server uses boot_id + seq to skip events it already stored.
enum Reason : uint8_t { REASON_CYCLE, REASON_STOP, REASON_MANUAL };
const char* REASON_NAME[] = {"cycle", "stop", "manual"};

struct ValveEvent {
    uint32_t      seq;
    uint8_t       filter;        // 0-based
    bool          open;
    Reason        reason;
    unsigned long atMs;
};
#define EVENT_QUEUE_LEN   32
ValveEvent      eventQueue[EVENT_QUEUE_LEN];
uint8_t         eventCount    = 0;
uint32_t        nextEventSeq  = 1;
uint32_t        bootId        = 0;

void queueEvent(uint8_t f, bool open, Reason reason) {
    if (eventCount == EVENT_QUEUE_LEN) {   // full (long WiFi outage) — drop the oldest
        memmove(eventQueue, eventQueue + 1, sizeof(ValveEvent) * (EVENT_QUEUE_LEN - 1));
        eventCount--;
    }
    eventQueue[eventCount++] = {nextEventSeq++, f, open, reason, millis()};
}

void dropSentEvents(uint8_t sent) {
    memmove(eventQueue, eventQueue + sent, sizeof(ValveEvent) * (eventCount - sent));
    eventCount -= sent;
}

// ── Valve control ─────────────────────────────────────────────────────────────
// Valve red has constant +12V; the relay switches +12V onto yellow to open.
// Relay off = closed, which is the fail-safe state.
void setValve(uint8_t f, bool open, Reason reason) {
    Filter& fl = filters[f];
    // Always drive the pin, even if the state looks unchanged, so the relay can
    // never be left on while the sketch thinks the valve is closed
    digitalWrite(RELAY_PIN[f], open ? RELAY_ON : RELAY_OFF);
    if (fl.valveOpen == open) return;
    fl.valveOpen = open;
    if (!open) fl.nextFlushMs = millis() + fl.waitMin * 60000UL;   // also covers a manual /close
    queueEvent(f, open, reason);
    Serial.printf("Filter %d valve %s (%s)\n", f + 1, open ? "OPEN" : "CLOSED", REASON_NAME[reason]);
}

void startFlush(uint8_t f, uint32_t seconds, Reason reason) {
    setValve(f, true, reason);
    filters[f].flushEndMs  = millis() + seconds * 1000UL + VALVE_OPEN_TRAVEL_MS;
    filters[f].lastFlushMs = millis();
}

// ── Automatic flush cycle ─────────────────────────────────────────────────────
bool validCycleValue(int v) {
    return v >= CYCLE_MIN && v <= CYCLE_MAX && v % 10 == 0;
}

void saveCycle(uint8_t f) {
    char key[8];
    prefs.begin("flush", false);
    snprintf(key, sizeof(key), "en%d", f); prefs.putBool(key, filters[f].cycleEnabled);
    snprintf(key, sizeof(key), "fs%d", f); prefs.putUShort(key, filters[f].flushSec);
    snprintf(key, sizeof(key), "wm%d", f); prefs.putUShort(key, filters[f].waitMin);
    prefs.end();
}

void loadCycles() {
    char key[8];
    prefs.begin("flush", true);
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        Filter& fl = filters[f];
        snprintf(key, sizeof(key), "en%d", f); fl.cycleEnabled = prefs.getBool(key, false);
        snprintf(key, sizeof(key), "fs%d", f); fl.flushSec     = prefs.getUShort(key, 30);
        snprintf(key, sizeof(key), "wm%d", f); fl.waitMin      = prefs.getUShort(key, 60);
        if (!validCycleValue(fl.flushSec)) fl.flushSec = 30;
        if (!validCycleValue(fl.waitMin))  fl.waitMin  = 60;
    }
    prefs.end();
}

// Apply settings from the server. Starting the cycle flushes right away;
// changing the wait time reschedules the next flush from the last one.
void applyCycle(uint8_t f, bool enabled, int flushSec, int waitMin) {
    Filter& fl = filters[f];
    if (!validCycleValue(flushSec) || !validCycleValue(waitMin)) return;
    if (enabled == fl.cycleEnabled && flushSec == fl.flushSec && waitMin == fl.waitMin) return;

    bool starting = enabled && !fl.cycleEnabled;
    unsigned long lastCloseMs = fl.nextFlushMs - fl.waitMin * 60000UL;
    fl.cycleEnabled = enabled;
    fl.flushSec     = flushSec;
    fl.waitMin      = waitMin;
    saveCycle(f);
    Serial.printf("Filter %d cycle %s: flush %ds every %dmin\n", f + 1, enabled ? "ON" : "OFF", flushSec, waitMin);

    if (!enabled) {
        setValve(f, false, REASON_STOP);
    } else if (starting) {
        startFlush(f, fl.flushSec, REASON_CYCLE);
    } else if (!fl.valveOpen) {
        fl.nextFlushMs = lastCloseMs + fl.waitMin * 60000UL;
    }
}

void runCycles() {
    unsigned long now = millis();
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        Filter& fl = filters[f];
        if (fl.valveOpen && (long)(now - fl.flushEndMs) >= 0) {
            setValve(f, false, fl.cycleEnabled ? REASON_CYCLE : REASON_MANUAL);
        }
        if (fl.cycleEnabled && !fl.valveOpen && (long)(now - fl.nextFlushMs) >= 0) {
            startFlush(f, fl.flushSec, REASON_CYCLE);
        }
    }
}

// ── Status ────────────────────────────────────────────────────────────────────
void fillStatus(JsonDocument& doc) {
    unsigned long now = millis();

    doc["unit_id"] = UNIT_ID;
    JsonArray arr = doc["filters"].to<JsonArray>();
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        Filter& fl     = filters[f];
        JsonObject o   = arr.add<JsonObject>();
        long remaining = fl.valveOpen ? (long)(fl.flushEndMs - now) / 1000 : 0;

        o["valve"]             = fl.valveOpen ? "open" : "closed";
        o["flush_remaining_s"] = remaining < 0 ? 0 : remaining;
        if (fl.lastFlushMs) o["last_flush_ago_s"] = (now - fl.lastFlushMs) / 1000;
        else                o["last_flush_ago_s"] = nullptr;
        o["cycle_enabled"]     = fl.cycleEnabled;
        o["flush_sec"]         = fl.flushSec;
        o["wait_min"]          = fl.waitMin;
        if (fl.cycleEnabled && !fl.valveOpen) {
            long next = (long)(fl.nextFlushMs - now) / 1000;
            o["next_flush_in_s"] = next < 0 ? 0 : next;
        } else {
            o["next_flush_in_s"] = nullptr;
        }
    }
    doc["uptime_s"] = now / 1000;
    doc["ip"]       = WiFi.localIP().toString();
}

// ── Server report / poll ──────────────────────────────────────────────────────
void reportToServer() {
    JsonDocument doc;
    fillStatus(doc);

    unsigned long now = millis();
    uint8_t sent      = eventCount;
    doc["boot_id"]    = String(bootId, HEX);
    JsonArray events  = doc["events"].to<JsonArray>();
    for (uint8_t i = 0; i < sent; i++) {
        JsonObject e = events.add<JsonObject>();
        e["seq"]     = eventQueue[i].seq;
        e["filter"]  = eventQueue[i].filter + 1;
        e["action"]  = eventQueue[i].open ? "open" : "close";
        e["reason"]  = REASON_NAME[eventQueue[i].reason];
        e["ago_s"]   = (now - eventQueue[i].atMs) / 1000;
    }

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(String(SERVER_URL) + "/api/filter_report.php");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + API_KEY);
    int code = http.POST(body);

    if (code == 200) {
        JsonDocument reply;
        if (!deserializeJson(reply, http.getString()) && reply["filters"].is<JsonArray>()) {
            dropSentEvents(sent);   // server has them now (events queued during the POST stay)
            JsonArray want = reply["filters"];
            for (uint8_t f = 0; f < NUM_FILTERS && f < want.size(); f++) {
                applyCycle(f, want[f]["cycle_enabled"] | false,
                              want[f]["flush_sec"] | 0,
                              want[f]["wait_min"] | 0);
            }
        } else {
            Serial.println("Server reply not understood");
        }
    } else {
        Serial.printf("Report failed: %d\n", code);
    }
    http.end();
}

// ── REST API handlers (LAN only, for testing) ─────────────────────────────────
// ?valve=1 or 2 selects the filter (default 1)
int valveArg() {
    int v = server.hasArg("valve") ? server.arg("valve").toInt() : 1;
    return (v >= 1 && v <= NUM_FILTERS) ? v - 1 : -1;
}

void handleStatus() {
    JsonDocument doc;
    fillStatus(doc);
    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
}

void handleFlush() {
    int f = valveArg();
    uint32_t seconds = server.hasArg("seconds") ? server.arg("seconds").toInt() : DEFAULT_FLUSH_SEC;
    if (f < 0 || seconds == 0 || seconds > MAX_FLUSH_SEC) {
        server.send(200, "application/json",
                    "{\"ok\":false,\"error\":\"valve must be 1-" + String(NUM_FILTERS) +
                    ", seconds 1-" + String(MAX_FLUSH_SEC) + "\"}");
        return;
    }
    startFlush(f, seconds, REASON_MANUAL);
    server.send(200, "application/json",
                "{\"ok\":true,\"valve\":" + String(f + 1) + ",\"seconds\":" + String(seconds) + "}");
}

void handleClose() {
    int f = valveArg();
    if (f < 0) {
        server.send(200, "application/json", "{\"ok\":false,\"error\":\"valve must be 1-" + String(NUM_FILTERS) + "\"}");
        return;
    }
    setValve(f, false, REASON_MANUAL);
    server.send(200, "application/json", "{\"ok\":true,\"valve\":" + String(f + 1) + "}");
}

// ── WiFi ──────────────────────────────────────────────────────────────────────
// Waits up to 20 s at boot; after that the ESP32 reconnects on its own and the
// flush cycles keep running without WiFi.
void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to WiFi");
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
    // Drive relays off before anything else so both valves stay closed.
    // pinMode first: on ESP32 core 3.x a digitalWrite before pinMode is ignored,
    // and the pin then defaults LOW (= relay ON, valve opens). The few µs of LOW
    // between these two calls is far too short for the relay to react.
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        pinMode(RELAY_PIN[f], OUTPUT);
        digitalWrite(RELAY_PIN[f], RELAY_OFF);
    }
    pinMode(LED_BUILTIN_PIN, OUTPUT);

    Serial.begin(115200);
    bootId = esp_random();

    // Resume the saved cycles; first flush comes one wait period after boot
    loadCycles();
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        filters[f].nextFlushMs = millis() + filters[f].waitMin * 60000UL;
        Serial.printf("Filter %d cycle %s: flush %ds every %dmin\n", f + 1,
                      filters[f].cycleEnabled ? "ON" : "OFF", filters[f].flushSec, filters[f].waitMin);
    }

    connectWiFi();

    server.on("/status", HTTP_GET,  handleStatus);
    server.on("/flush",  HTTP_POST, handleFlush);
    server.on("/close",  HTTP_POST, handleClose);
    server.begin();
}

void loop() {
    server.handleClient();
    runCycles();

    bool online = WiFi.status() == WL_CONNECTED;
    digitalWrite(LED_BUILTIN_PIN, online ? HIGH : (millis() / 250) % 2);   // solid = online, blink = no WiFi

    if (online && millis() - lastReportMs >= REPORT_MS) {
        lastReportMs = millis();
        reportToServer();
        runCycles();   // the report can take up to HTTP_TIMEOUT_MS — catch up on the timers
    }
}
