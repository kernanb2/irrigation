# Irrigation Controller

Solar-powered, WiFi-connected irrigation system built on ESP-32. Controls 15 zones across 3 units with DC latching valves, moisture sensors, and temperature-based automation.

## Features
- Manual, time-based, automatic (moisture), and temperature-triggered watering
- Web UI for monitoring and control
- MySQL database for scheduling and sensor history
- 3× ESP-32 units, 5 zones each
- Rainbird 9V DC latching solenoids via DRV8871 H-bridge drivers
- DS18B20 waterproof temperature sensors
- Capacitive soil moisture sensors (one per zone)
- Solar + LiFePO4 battery powered

## Repository Structure

```
├── docs/
│   ├── architecture.md           System design overview
│   ├── wiring.md                 Wiring guide and electrical notes
│   ├── pin-mapping.md            ESP-32 GPIO assignments
│   └── moisture-sensor-recommendation.md
├── firmware/
│   ├── irrigation_controller/    Main ESP-32 sketch
│   └── README.md                 Library setup and provisioning
├── backend/
│   └── db/schema.sql             MySQL database schema
└── README.md
```

## Hardware

See [docs/architecture.md](docs/architecture.md) for full system diagram.  
See [docs/wiring.md](docs/wiring.md) for electrical connections.  
See [docs/pin-mapping.md](docs/pin-mapping.md) for GPIO assignments.

## Getting Started

1. Set up MySQL and run `backend/db/schema.sql`
2. Flash each ESP-32 with a unit ID (see `firmware/README.md`)
3. Update WiFi credentials and server URL in the firmware
4. Flash firmware to each ESP-32
5. (Backend and web UI — in progress)
