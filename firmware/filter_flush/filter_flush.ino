#include <WiFi.h>
#include <WebServer.h>
#include "secrets.h"   // git-ignored — copy from secrets.example.h

// ── WiFi credentials ─────────────────────────────────────────────────────────
const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

// ── Central server ────────────────────────────────────────────────────────────
// Per-board key ('filter-flush' in backend/config/device_keys.php).
// Not used until this board reports to the server.
const char* API_KEY       = SECRET_API_KEY;

// ── Hardware pin assignments ──────────────────────────────────────────────────
#define LED_BUILTIN_PIN   2
#define RELAY_VALVE_PIN   26   // Relay 1: NO → valve yellow (open signal)
#define RELAY_SPARE_PIN   27   // Relay 2: unused

// Relay module inputs are active LOW
#define RELAY_ON          LOW
#define RELAY_OFF         HIGH

// ── Flush limits ──────────────────────────────────────────────────────────────
#define DEFAULT_FLUSH_SEC 30
#define MAX_FLUSH_SEC     300

// ── Global state ──────────────────────────────────────────────────────────────
WebServer       server(80);

bool            valveOpen     = false;
unsigned long   flushEndMs    = 0;
unsigned long   lastFlushMs   = 0;    // 0 = no flush since boot

// ── Valve control ─────────────────────────────────────────────────────────────
// Valve red has constant +12V; the relay switches +12V onto yellow to open.
// Relay off = closed, which is the fail-safe state.
void setValve(bool open) {
    digitalWrite(RELAY_VALVE_PIN, open ? RELAY_ON : RELAY_OFF);
    valveOpen = open;
    Serial.printf("Valve %s\n", open ? "OPEN" : "CLOSED");
}

void startFlush(uint32_t seconds) {
    setValve(true);
    flushEndMs  = millis() + seconds * 1000UL;
    lastFlushMs = millis();
}

// ── REST API handlers ─────────────────────────────────────────────────────────
void handleStatus() {
    unsigned long now = millis();
    long remaining    = valveOpen ? (long)(flushEndMs - now) / 1000 : 0;

    String json = "{";
    json += "\"valve\":\"" + String(valveOpen ? "open" : "closed") + "\",";
    json += "\"flush_remaining_s\":" + String(remaining < 0 ? 0 : remaining) + ",";
    json += "\"last_flush_ago_s\":" + (lastFlushMs ? String((now - lastFlushMs) / 1000) : String("null")) + ",";
    json += "\"uptime_s\":" + String(now / 1000) + ",";
    json += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
    json += "}";
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
void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        digitalWrite(LED_BUILTIN_PIN, !digitalRead(LED_BUILTIN_PIN));
        delay(250);
        Serial.print(".");
    }
    digitalWrite(LED_BUILTIN_PIN, HIGH);
    Serial.printf("\nConnected, IP: %s\n", WiFi.localIP().toString().c_str());
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

    connectWiFi();

    server.on("/status", HTTP_GET,  handleStatus);
    server.on("/flush",  HTTP_POST, handleFlush);
    server.on("/close",  HTTP_POST, handleClose);
    server.begin();
}

void loop() {
    server.handleClient();

    if (valveOpen && (long)(millis() - flushEndMs) >= 0) {
        setValve(false);
    }

    // connectWiFi() blocks, which would stall the flush timer — close first
    if (WiFi.status() != WL_CONNECTED) {
        if (valveOpen) setValve(false);
        connectWiFi();
    }
}
