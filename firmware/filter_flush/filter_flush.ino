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

// Filter valves count as "moving" (drawing motor current) this long after switching
#define FILTER_TRAVEL_MS  5000

// ── Pond Drain ────────────────────────────────────────────────────────────────
// BOKYWOX/Tonhe A150 2" valve, CR2-01 = 2-wire reverse polarity: red + / black −
// closes, black + / red − opens; it stops itself at each end. No position sensor,
// so partial positions are timed from DRAIN_TRAVEL_MS.
//   Relay 3 (GPIO 25): COM → red,   NC → +12V, NO → GND
//   Relay 4 (GPIO 33): COM → black, NC → GND,  NO → +12V
//   both off = CLOSE (also the power-off / crash state), both on = OPEN,
//   relay 3 only = HOLD (both wires to GND, motor stopped)
#define DRAIN_RD_PIN      25
#define DRAIN_BK_PIN      33
#define DRAIN_TRAVEL_MS   11000   // full closed→open time (datasheet ≤11 s) — measure and adjust
#define DRAIN_END_MARGIN_MS 2000  // extra drive at 0%/100% so it always reaches the end stop
#define DRAIN_INDEX       2       // device number 3 in events (filters are 0 and 1)

// ── Tank level sensors ────────────────────────────────────────────────────────
// Two XKC-Y25 non-contact sensors on the tank the drain fills (the controller's own
// two sensors run the irrigation pump). Top sensor wet → drain closes; once the water
// drops below the second sensor, the drain goes back to the last web-page setting.
// Each sensor: brown → 5V, blue → GND, black (mode) set so yellow is HIGH when DRY,
// yellow → 10k → GPIO, with 15k from GPIO to GND (5 V → 3.0 V).
// A broken wire or dead sensor reads LOW = wet, so it can only keep the drain closed.
#define TANK_SENSORS      1       // 0 = sensors not wired, ignore them
#define TANK_TOP_PIN      34      // input-only pins — the 15k resistor is the pull-down
#define TANK_REFILL_PIN   35
#define TANK_DEBOUNCE_MS  5000    // a reading must hold this long (ripples, splashing)

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
    unsigned long lastChangeMs;   // last open/close, for the power-sharing check
};
Filter filters[NUM_FILTERS];

enum DrainDrive : uint8_t { DRIVE_CLOSE, DRIVE_OPEN, DRIVE_HOLD };

struct Drain {
    float         posPct;         // estimated position, 0 = closed
    uint8_t       targetPct;
    bool          moving;
    bool          movePending;    // new target waiting for the filter valves to stop
    float         startPct;
    unsigned long moveStartMs;
    unsigned long moveEndMs;
    uint32_t      appliedSeq;     // last web command applied (kept across reboots)
    uint8_t       pendingReason;
    uint8_t       userPct;        // last web-page setting — where to return after the tank empties
} drain;

struct LevelSensor {
    uint8_t       pin;
    bool          wet;            // debounced
    bool          rawWet;
    unsigned long rawSinceMs;
};
struct Tank {
    LevelSensor   top    = {TANK_TOP_PIN,    false, false, 0};
    LevelSensor   refill = {TANK_REFILL_PIN, false, false, 0};
    bool          full   = false;  // drain held closed until the water drops below the refill sensor
} tank;

unsigned long   lastReportMs  = 0;

// ── Valve event queue ─────────────────────────────────────────────────────────
// Every open/close is queued and sent with the next report, so flushes shorter
// than the report interval still reach the event log. seq starts at 1 each boot;
// the server uses boot_id + seq to skip events it already stored.
enum Reason : uint8_t { REASON_CYCLE, REASON_STOP, REASON_MANUAL, REASON_WEB, REASON_RESTART,
                       REASON_TANK_FULL, REASON_TANK_LOW };
const char* REASON_NAME[] = {"cycle", "stop", "manual", "web", "restart", "tank_full", "tank_low"};

struct ValveEvent {
    uint32_t      seq;
    uint8_t       filter;        // 0-based; DRAIN_INDEX = Pond Drain
    bool          open;
    uint8_t       pct;           // drain target position
    Reason        reason;
    unsigned long atMs;
};
#define EVENT_QUEUE_LEN   32
ValveEvent      eventQueue[EVENT_QUEUE_LEN];
uint8_t         eventCount    = 0;
uint32_t        nextEventSeq  = 1;
uint32_t        bootId        = 0;

void queueEvent(uint8_t f, bool open, Reason reason, uint8_t pct = 0) {
    if (eventCount == EVENT_QUEUE_LEN) {   // full (long WiFi outage) — drop the oldest
        memmove(eventQueue, eventQueue + 1, sizeof(ValveEvent) * (EVENT_QUEUE_LEN - 1));
        eventCount--;
    }
    eventQueue[eventCount++] = {nextEventSeq++, f, open, pct, reason, millis()};
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
    fl.valveOpen    = open;
    fl.lastChangeMs = millis();
    if (!open) fl.nextFlushMs = millis() + fl.waitMin * 60000UL;   // also covers a manual /close
    queueEvent(f, open, reason);
    Serial.printf("Filter %d valve %s (%s)\n", f + 1, open ? "OPEN" : "CLOSED", REASON_NAME[reason]);
}

void startFlush(uint8_t f, uint32_t seconds, Reason reason) {
    setValve(f, true, reason);
    filters[f].flushEndMs  = millis() + seconds * 1000UL + VALVE_OPEN_TRAVEL_MS;
    filters[f].lastFlushMs = millis();
}

// ── Power sharing ─────────────────────────────────────────────────────────────
// The 12V 3A supply can't comfortably run the drain motor (~1A) together with
// both filter motors, so the drain never starts while a filter valve is moving
// and a flush never starts while the drain is moving. (Closing is never delayed.)
bool filterMoving() {
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        if (filters[f].lastChangeMs && millis() - filters[f].lastChangeMs < FILTER_TRAVEL_MS) return true;
    }
    return false;
}

// ── Pond Drain control ────────────────────────────────────────────────────────
void setDrainDrive(DrainDrive d) {
    digitalWrite(DRAIN_RD_PIN, d == DRIVE_CLOSE ? RELAY_OFF : RELAY_ON);
    digitalWrite(DRAIN_BK_PIN, d == DRIVE_OPEN  ? RELAY_ON  : RELAY_OFF);
}

// Resting drive for a position: the end stops hold 0% and 100%, HOLD keeps a partial
DrainDrive restingDrive(uint8_t pct) {
    return pct == 0 ? DRIVE_CLOSE : pct == 100 ? DRIVE_OPEN : DRIVE_HOLD;
}

void saveDrain() {
    prefs.begin("drain", false);
    prefs.putUChar("pos", (uint8_t)(drain.posPct + 0.5f));
    prefs.putULong("seq", drain.appliedSeq);
    prefs.end();
}

void startDrainMove() {
    drain.movePending = false;
    float delta = drain.targetPct - drain.posPct;

    if (fabsf(delta) < 0.5f && drain.targetPct != 0 && drain.targetPct != 100) {
        setDrainDrive(restingDrive(drain.targetPct));
        return;
    }

    unsigned long ms = (unsigned long)(fabsf(delta) / 100.0f * DRAIN_TRAVEL_MS);
    if (drain.targetPct == 0 || drain.targetPct == 100) ms += DRAIN_END_MARGIN_MS;

    bool opening = drain.targetPct > drain.posPct;
    setDrainDrive(opening ? DRIVE_OPEN : DRIVE_CLOSE);
    drain.moving      = true;
    drain.startPct    = drain.posPct;
    drain.moveStartMs = millis();
    drain.moveEndMs   = millis() + ms;
    queueEvent(DRAIN_INDEX, drain.targetPct > 0 && opening, (Reason)drain.pendingReason, drain.targetPct);
    Serial.printf("Drain %s to %d%% (%lu ms)\n", opening ? "opening" : "closing", drain.targetPct, ms);
}

// New target from the web page (or a restart). Starts once no filter valve is moving.
void setDrainTarget(uint8_t pct, Reason reason) {
    if (drain.moving) {                       // stop where it is and re-plan from there
        setDrainDrive(DRIVE_HOLD);
        drain.moving = false;
    }
    drain.targetPct     = pct;
    drain.pendingReason = reason;
    drain.movePending   = true;
}

void runDrain() {
    unsigned long now = millis();

    if (drain.moving) {
        float done = (float)(now - drain.moveStartMs) / DRAIN_TRAVEL_MS * 100.0f;
        drain.posPct = drain.targetPct > drain.startPct
                     ? min(drain.startPct + done, (float)drain.targetPct)
                     : max(drain.startPct - done, (float)drain.targetPct);
        if ((long)(now - drain.moveEndMs) >= 0) {
            drain.moving = false;
            drain.posPct = drain.targetPct;
            setDrainDrive(restingDrive(drain.targetPct));
            saveDrain();
            Serial.printf("Drain at %d%%\n", drain.targetPct);
        }
    }

    if (drain.movePending && !drain.moving && !filterMoving()) {
        startDrainMove();
    }
}

// New setting from the web page. While the tank is full it's remembered and
// applied once the water drops below the refill sensor.
void webDrainTarget(uint8_t pct) {
    drain.userPct = pct;
    if (tank.full && pct > 0) {
        Serial.printf("Drain %d%% requested — waiting for the tank to drop\n", pct);
        return;
    }
    setDrainTarget(pct, REASON_WEB);
}

// ── Tank level ────────────────────────────────────────────────────────────────
void readLevel(LevelSensor& s, unsigned long now) {
    bool wet = digitalRead(s.pin) == LOW;    // HIGH = dry
    if (wet != s.rawWet) { s.rawWet = wet; s.rawSinceMs = now; }
    if (s.wet != s.rawWet && now - s.rawSinceMs >= TANK_DEBOUNCE_MS) {
        s.wet = s.rawWet;
        Serial.printf("Tank sensor GPIO %d: %s\n", s.pin, s.wet ? "water" : "dry");
    }
}

// Top wet but refill dry can't happen with working sensors — treat it as full
bool tankFault() { return tank.top.wet && !tank.refill.wet; }

void runTank() {
    if (!TANK_SENSORS) return;
    unsigned long now = millis();
    readLevel(tank.top, now);
    readLevel(tank.refill, now);

    if (!tank.full && tank.top.wet) {
        tank.full = true;
        Serial.println(tankFault() ? "Tank sensor fault — drain held closed" : "Tank full — drain closing");
        if (drain.targetPct > 0) setDrainTarget(0, REASON_TANK_FULL);
    } else if (tank.full && !tank.top.wet && !tank.refill.wet) {
        tank.full = false;
        Serial.printf("Tank below refill sensor — drain back to %d%%\n", drain.userPct);
        if (drain.userPct > 0) setDrainTarget(drain.userPct, REASON_TANK_LOW);
    }
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
        fl.nextFlushMs = millis();   // flush now — runCycles starts it once the drain isn't moving
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
        if (fl.cycleEnabled && !fl.valveOpen && !drain.moving && (long)(now - fl.nextFlushMs) >= 0) {
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
    JsonObject d = doc["drain"].to<JsonObject>();
    d["position_pct"] = (int)(drain.posPct + 0.5f);
    d["target_pct"]   = drain.targetPct;
    d["moving"]       = drain.moving || drain.movePending;
    d["seq"]          = drain.appliedSeq;
    d["user_pct"]     = drain.userPct;
    if (TANK_SENSORS) {
        JsonObject t = d["tank"].to<JsonObject>();
        t["top_wet"]    = tank.top.wet;
        t["refill_wet"] = tank.refill.wet;
        t["full"]       = tank.full;
        t["fault"]      = tankFault();
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
        if (eventQueue[i].filter == DRAIN_INDEX) e["pct"] = eventQueue[i].pct;
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
            // Drain: only a new command (seq changed) moves it, so a reboot never replays one
            uint32_t seq = reply["drain"]["seq"] | drain.appliedSeq;
            int pct      = reply["drain"]["target_pct"] | -1;
            if (seq != drain.appliedSeq && pct >= 0 && pct <= 100) {
                drain.appliedSeq = seq;
                saveDrain();
                webDrainTarget(pct);
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
    if (drain.moving) {
        server.send(200, "application/json", "{\"ok\":false,\"error\":\"Pond Drain is moving — try again shortly\"}");
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
    // Drive relays off before anything else so all valves stay closed.
    // pinMode first: on ESP32 core 3.x a digitalWrite before pinMode is ignored,
    // and the pin then defaults LOW (= relay ON, valve opens). The few µs of LOW
    // between these two calls is far too short for the relay to react.
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        pinMode(RELAY_PIN[f], OUTPUT);
        digitalWrite(RELAY_PIN[f], RELAY_OFF);
    }
    pinMode(DRAIN_RD_PIN, OUTPUT);
    pinMode(DRAIN_BK_PIN, OUTPUT);
    setDrainDrive(DRIVE_CLOSE);   // both relays off — drain drives closed
    pinMode(LED_BUILTIN_PIN, OUTPUT);
    pinMode(TANK_TOP_PIN, INPUT);
    pinMode(TANK_REFILL_PIN, INPUT);

    Serial.begin(115200);
    bootId = esp_random();

    // Resume the saved cycles; first flush comes one wait period after boot
    loadCycles();
    for (uint8_t f = 0; f < NUM_FILTERS; f++) {
        filters[f].nextFlushMs = millis() + filters[f].waitMin * 60000UL;
        Serial.printf("Filter %d cycle %s: flush %ds every %dmin\n", f + 1,
                      filters[f].cycleEnabled ? "ON" : "OFF", filters[f].flushSec, filters[f].waitMin);
    }

    // Pond Drain always closes after a restart. If it was open, log it and time the
    // close so the position estimate is right; the last web command isn't replayed.
    prefs.begin("drain", true);
    uint8_t savedPos = prefs.getUChar("pos", 0);
    drain.appliedSeq = prefs.getULong("seq", 0);
    prefs.end();
    drain.posPct = savedPos > 100 ? 100 : savedPos;
    if (drain.posPct > 0) {
        setDrainTarget(0, REASON_RESTART);
        startDrainMove();
    }
    Serial.printf("Drain was at %d%% — closing\n", savedPos);

    // Start from the current tank readings rather than waiting out the debounce
    if (TANK_SENSORS) {
        for (LevelSensor* s : {&tank.top, &tank.refill}) {
            s->wet = s->rawWet = digitalRead(s->pin) == LOW;
            s->rawSinceMs = millis();
        }
        tank.full = tank.top.wet;
        Serial.printf("Tank: top %s, refill %s\n", tank.top.wet ? "water" : "dry", tank.refill.wet ? "water" : "dry");
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
    runTank();
    runDrain();

    bool online = WiFi.status() == WL_CONNECTED;
    digitalWrite(LED_BUILTIN_PIN, online ? HIGH : (millis() / 250) % 2);   // solid = online, blink = no WiFi

    if (online && millis() - lastReportMs >= REPORT_MS) {
        lastReportMs = millis();
        reportToServer();
        runCycles();   // the report can take up to HTTP_TIMEOUT_MS — catch up on the timers
        runDrain();
    }
}
