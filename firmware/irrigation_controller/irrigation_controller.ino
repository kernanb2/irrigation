#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

// ── WiFi credentials ─────────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_SSID";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";

// ── Central server ────────────────────────────────────────────────────────────
const char* SERVER_URL    = "http://YOUR_SERVER_IP:3000";  // central Node.js API

// ── Hardware pin assignments ──────────────────────────────────────────────────
#define LED_BUILTIN_PIN   2
#define ONE_WIRE_PIN      21

#define NUM_ZONES         5

const uint8_t VALVE_IN1[NUM_ZONES] = {4,  12, 14, 16, 18};
const uint8_t VALVE_IN2[NUM_ZONES] = {5,  13, 15, 17, 19};
const uint8_t MOISTURE_PIN[NUM_ZONES] = {32, 33, 34, 35, 36};

// ── Valve pulse duration ──────────────────────────────────────────────────────
#define VALVE_PULSE_MS    100

// ── Sensor poll interval ──────────────────────────────────────────────────────
#define SENSOR_POLL_MS    60000UL

// ── Global state ──────────────────────────────────────────────────────────────
WebServer       server(80);
Preferences     prefs;
OneWire         oneWire(ONE_WIRE_PIN);
DallasTemperature tempSensors(&oneWire);

uint8_t         unitId = 0;          // set once in NVS during provisioning
bool            valveState[NUM_ZONES] = {false};
unsigned long   lastSensorPoll = 0;

// ── Valve control ─────────────────────────────────────────────────────────────
void pulseValve(uint8_t zone, bool open) {
    uint8_t in1 = open ? HIGH : LOW;
    uint8_t in2 = open ? LOW  : HIGH;
    digitalWrite(VALVE_IN1[zone], in1);
    digitalWrite(VALVE_IN2[zone], in2);
    delay(VALVE_PULSE_MS);
    digitalWrite(VALVE_IN1[zone], LOW);
    digitalWrite(VALVE_IN2[zone], LOW);
    valveState[zone] = open;
    saveValveStates();
}

void saveValveStates() {
    prefs.begin("valves", false);
    for (int i = 0; i < NUM_ZONES; i++) {
        prefs.putBool(String("v" + String(i)).c_str(), valveState[i]);
    }
    prefs.end();
}

void loadValveStates() {
    prefs.begin("valves", true);
    for (int i = 0; i < NUM_ZONES; i++) {
        valveState[i] = prefs.getBool(String("v" + String(i)).c_str(), false);
    }
    prefs.end();
}

// ── Sensor readings ───────────────────────────────────────────────────────────
int readMoisture(uint8_t zone) {
    return analogRead(MOISTURE_PIN[zone]);  // 0–4095
}

// ── REST API handlers ─────────────────────────────────────────────────────────
void handleStatus() {
    StaticJsonDocument<512> doc;
    doc["unit_id"]    = unitId;
    doc["ip"]         = WiFi.localIP().toString();
    doc["uptime_sec"] = millis() / 1000;

    JsonArray zones = doc.createNestedArray("zones");
    for (int i = 0; i < NUM_ZONES; i++) {
        JsonObject z = zones.createNestedObject();
        z["index"]        = i;
        z["valve"]        = valveState[i] ? "open" : "closed";
        z["moisture_raw"] = readMoisture(i);
    }

    tempSensors.requestTemperatures();
    doc["temp_c"] = tempSensors.getTempCByIndex(0);

    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
}

void handleValveControl() {
    if (!server.hasArg("plain")) {
        server.send(400, "application/json", "{\"error\":\"missing body\"}");
        return;
    }

    StaticJsonDocument<128> req;
    DeserializationError err = deserializeJson(req, server.arg("plain"));
    if (err) {
        server.send(400, "application/json", "{\"error\":\"invalid JSON\"}");
        return;
    }

    int  zone = req["zone"];
    bool open = req["open"];

    if (zone < 0 || zone >= NUM_ZONES) {
        server.send(400, "application/json", "{\"error\":\"invalid zone\"}");
        return;
    }

    pulseValve(zone, open);

    StaticJsonDocument<64> resp;
    resp["zone"]  = zone;
    resp["state"] = valveState[zone] ? "open" : "closed";
    String out;
    serializeJson(resp, out);
    server.send(200, "application/json", out);
}

void handleNotFound() {
    server.send(404, "application/json", "{\"error\":\"not found\"}");
}

// ── Post sensor data to central server ───────────────────────────────────────
void reportSensors() {
    if (WiFi.status() != WL_CONNECTED) return;

    StaticJsonDocument<512> doc;
    doc["unit_id"] = unitId;

    JsonArray moisture = doc.createNestedArray("moisture");
    for (int i = 0; i < NUM_ZONES; i++) {
        JsonObject m = moisture.createNestedObject();
        m["zone_index"] = i;
        m["raw"]        = readMoisture(i);
    }

    tempSensors.requestTemperatures();
    doc["temp_c"] = tempSensors.getTempCByIndex(0);

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    http.begin(String(SERVER_URL) + "/api/sensors");
    http.addHeader("Content-Type", "application/json");
    http.POST(body);
    http.end();
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    // Load unit ID from NVS
    prefs.begin("unit", true);
    unitId = prefs.getUChar("id", 0);
    prefs.end();

    if (unitId == 0) {
        Serial.println("ERROR: Unit ID not set. Run provisioning.");
        // Blink fast to indicate error
        pinMode(LED_BUILTIN_PIN, OUTPUT);
        while (true) {
            digitalWrite(LED_BUILTIN_PIN, HIGH); delay(100);
            digitalWrite(LED_BUILTIN_PIN, LOW);  delay(100);
        }
    }

    // Init valve pins — all off
    for (int i = 0; i < NUM_ZONES; i++) {
        pinMode(VALVE_IN1[i], OUTPUT);
        pinMode(VALVE_IN2[i], OUTPUT);
        digitalWrite(VALVE_IN1[i], LOW);
        digitalWrite(VALVE_IN2[i], LOW);
    }

    // Restore valve states from NVS
    loadValveStates();

    // Init sensors
    for (int i = 0; i < NUM_ZONES; i++) {
        pinMode(MOISTURE_PIN[i], INPUT);
    }
    tempSensors.begin();

    // Connect to WiFi
    Serial.printf("Unit %d connecting to %s\n", unitId, WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500); Serial.print(".");
    }
    Serial.printf("\nConnected. IP: %s\n", WiFi.localIP().toString().c_str());

    // Register REST endpoints
    server.on("/status",        HTTP_GET,  handleStatus);
    server.on("/valve",         HTTP_POST, handleValveControl);
    server.onNotFound(handleNotFound);
    server.begin();

    pinMode(LED_BUILTIN_PIN, OUTPUT);
    digitalWrite(LED_BUILTIN_PIN, HIGH);  // solid = online
    Serial.println("Ready.");
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    server.handleClient();

    if (millis() - lastSensorPoll >= SENSOR_POLL_MS) {
        lastSensorPoll = millis();
        reportSensors();
    }
}
