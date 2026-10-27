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
// flush cycle chosen on the web page. Key = 'filter-flush' in device_keys.php.
const char* SERVER_URL    = "http://paradisepond.tech/irrigation";
const char* API_KEY       = SECRET_API_KEY;
#define UNIT_ID           5
#define REPORT_MS         10000UL
#define HTTP_TIMEOUT_MS   3000

// ── Hardware pin assignments ──────────────────────────────────────────────────
#define LED_BUILTIN_PIN   2
#define RELAY_VALVE_PIN   26   // Relay 1: NO → valve yellow (open signal)
#define RELAY_SPARE_PIN   27   // Relay 2: unused

// Relay module inputs are active LOW
#define RELAY_ON          LOW
#define RELAY_OFF         HIGH

// ── Flush limits ──────────────────────────────────────────────────────────────
#define DEFAULT_FLUSH_SEC 30
#define MAX_FLUSH_SEC     300   // manual /flush cap

// Automatic cycle — both web page lists run 10–120 in steps of 10
#define CYCLE_MIN         10
#define CYCLE_MAX         120

// ── Global state ──────────────────────────────────────────────────────────────
WebServer       server(80);
Preferences     prefs;

bool            valveOpen     = false;
unsigned long   flushEndMs    = 0;
unsigned long   lastFlushMs   = 0;    // 0 = no flush since boot
unsigned long   lastCloseMs   = 0;

bool            cycleEnabled  = false;
uint16_t        cycleFlushSec = 30;
uint16_t        cycleWaitMin  = 60;
unsigned long   nextFlushMs   = 0;    // valid while cycleEnabled and valve closed

unsigned long   lastReportMs  = 0;

// ── Valve control ─────────────────────────────────────────────────────────────
// Valve red has constant +12V; the relay switches +12V onto yellow to open.
// Relay off = closed, which is the fail-safe state.
void setValve(bool open) {
    digitalWrite(RELAY_VALVE_PIN, open ? RELAY_ON : RELAY_OFF);
    valveOpen = open;
    if (!open) {
        lastCloseMs = millis();
        nextFlushMs = lastCloseMs + cycleWaitMin * 60000UL;   // also covers a manual /close
    }
    Serial.printf("Valve %s\n", open ? "OPEN" : "CLOSED");
}

void startFlush(uint32_t seconds) {
    setValve(true);
    flushEndMs  = millis() + seconds * 1000UL;
    lastFlushMs = millis();
}

// ── Automatic flush cycle ─────────────────────────────────────────────────────
bool validCycleValue(int v) {
    return v >= CYCLE_MIN && v <= CYCLE_MAX && v % 10 == 0;
}

void saveCycle() {
    prefs.begin("flush", false);
    prefs.putBool("enabled", cycleEnabled);
    prefs.putUShort("flush_s", cycleFlushSec);
    prefs.putUShort("wait_m", cycleWaitMin);
    prefs.end();
}

void loadCycle() {
    prefs.begin("flush", true);
    cycleEnabled  = prefs.getBool("enabled", false);
    cycleFlushSec = prefs.getUShort("flush_s", 30);
    cycleWaitMin  = prefs.getUShort("wait_m", 60);
    prefs.end();
    if (!validCycleValue(cycleFlushSec)) cycleFlushSec = 30;
    if (!validCycleValue(cycleWaitMin))  cycleWaitMin  = 60;
}

// Apply settings from the server. Starting the cycle flushes right away;
// changing the wait time reschedules the next flush from the last one.
void applyCycle(bool enabled, int flushSec, int waitMin) {
    if (!validCycleValue(flushSec) || !validCycleValue(waitMin)) return;
    if (enabled == cycleEnabled && flushSec == cycleFlushSec && waitMin == cycleWaitMin) return;

    bool starting = enabled && !cycleEnabled;
    cycleEnabled  = enabled;
    cycleFlushSec = flushSec;
    cycleWaitMin  = waitMin;
    saveCycle();
    Serial.printf("Cycle %s: flush %ds every %dmin\n", enabled ? "ON" : "OFF", flushSec, waitMin);

    if (!enabled) {
        if (valveOpen) setValve(false);
    } else if (starting) {
        startFlush(cycleFlushSec);
    } else {
        nextFlushMs = lastCloseMs + cycleWaitMin * 60000UL;
    }
}

void runCycle() {
    unsigned long now = millis();

    if (valveOpen && (long)(now - flushEndMs) >= 0) {
        setValve(false);
    }

    if (cycleEnabled && !valveOpen && (long)(now - nextFlushMs) >= 0) {
        startFlush(cycleFlushSec);
    }
}

// ── Status ────────────────────────────────────────────────────────────────────
void fillStatus(JsonDocument& doc) {
    unsigned long now = millis();
    long remaining    = valveOpen ? (long)(flushEndMs - now) / 1000 : 0;

    doc["unit_id"]           = UNIT_ID;
    doc["valve"]             = valveOpen ? "open" : "closed";
    doc["flush_remaining_s"] = remaining < 0 ? 0 : remaining;
    if (lastFlushMs) doc["last_flush_ago_s"] = (now - lastFlushMs) / 1000;
    else             doc["last_flush_ago_s"] = nullptr;
    doc["cycle_enabled"]     = cycleEnabled;
    doc["flush_sec"]         = cycleFlushSec;
    doc["wait_min"]          = cycleWaitMin;
    if (cycleEnabled && !valveOpen) {
        long next = (long)(nextFlushMs - now) / 1000;
        doc["next_flush_in_s"] = next < 0 ? 0 : next;
    } else {
        doc["next_flush_in_s"] = nullptr;
    }
    doc["uptime_s"]          = now / 1000;
    doc["ip"]                = WiFi.localIP().toString();
}

// ── Server report / poll ──────────────────────────────────────────────────────
void reportToServer() {
    JsonDocument doc;
    fillStatus(doc);
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
        if (!deserializeJson(reply, http.getString()) && reply["flush_sec"].is<int>()) {
            applyCycle(reply["cycle_enabled"] | false,
                       reply["flush_sec"].as<int>(),
                       reply["wait_min"].as<int>());
        } else {
            Serial.println("Server reply not understood");
        }
    } else {
        Serial.printf("Report failed: %d\n", code);
    }
    http.end();
}

// ── REST API handlers ─────────────────────────────────────────────────────────
void handleStatus() {
    JsonDocument doc;
    fillStatus(doc);
    String json;
    serializeJson(doc, json);
    server.send(200, "application/json", json);
}

void handleFlush() {
    uint32_t seconds = DEFAULT_FLUSH_SEC;
    if (server.hasArg("seconds")) {
        seconds = server.arg("seconds").toInt();
    }
    if (seconds == 0 || seconds > MAX_FLUSH_SEC) {
        server.send(200, "application/json",
                    "{\"ok\":false,\"error\":\"seconds must be 1-" + String(MAX_FLUSH_SEC) + "\"}");
        return;
    }
    startFlush(seconds);
    server.send(200, "application/json",
                "{\"ok\":true,\"seconds\":" + String(seconds) + "}");
}

void handleClose() {
    setValve(false);
    server.send(200, "application/json", "{\"ok\":true}");
}

// ── WiFi ──────────────────────────────────────────────────────────────────────
// Waits up to 20 s at boot; after that the ESP32 reconnects on its own and the
// flush cycle keeps running without WiFi.
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
    // Drive relays off before anything else so the valve stays closed
    digitalWrite(RELAY_VALVE_PIN, RELAY_OFF);
    digitalWrite(RELAY_SPARE_PIN, RELAY_OFF);
    pinMode(RELAY_VALVE_PIN, OUTPUT);
    pinMode(RELAY_SPARE_PIN, OUTPUT);
    pinMode(LED_BUILTIN_PIN, OUTPUT);

    Serial.begin(115200);
    setValve(false);

    // Resume the saved cycle; first flush comes one wait period after boot
    loadCycle();
    nextFlushMs = millis() + cycleWaitMin * 60000UL;
    Serial.printf("Cycle %s: flush %ds every %dmin\n",
                  cycleEnabled ? "ON" : "OFF", cycleFlushSec, cycleWaitMin);

    connectWiFi();

    server.on("/status", HTTP_GET,  handleStatus);
    server.on("/flush",  HTTP_POST, handleFlush);
    server.on("/close",  HTTP_POST, handleClose);
    server.begin();
}

void loop() {
    server.handleClient();
    runCycle();

    bool online = WiFi.status() == WL_CONNECTED;
    digitalWrite(LED_BUILTIN_PIN, online ? HIGH : (millis() / 250) % 2);   // solid = online, blink = no WiFi

    if (online && millis() - lastReportMs >= REPORT_MS) {
        lastReportMs = millis();
        reportToServer();
        runCycle();   // the report can take up to HTTP_TIMEOUT_MS — catch up on the timer
    }
}
