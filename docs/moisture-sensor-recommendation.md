# Moisture Sensor Recommendation

## Recommended: Capacitive Soil Moisture Sensor v1.2 (Generic)

**Why capacitive over resistive:**
Resistive sensors pass current through the soil to measure resistance, which causes electrolytic corrosion of the probes within months. Capacitive sensors measure dielectric permittivity without direct current through the soil — they last years in wet ground.

## Recommended Model
**Generic Capacitive Soil Moisture Sensor v1.2**
- ~$3–5 each (widely available on Amazon, AliExpress)
- Search: "capacitive soil moisture sensor v1.2 arduino"
- Operating voltage: 3.3V – 5V (compatible with ESP-32 at 3.3V)
- Output: Analog 0–3.3V (use ADC1 pins on ESP-32)
- Dimensions: 98mm × 23mm
- Needs sealing: coat the electronics side with conformal coating or liquid electrical tape before burial — only the probe tip should be exposed to soil

## Quantity Needed
- 15 sensors total (one per irrigation zone)
- Buy 17–18 to account for failures/calibration duds

## Calibration
Each sensor must be calibrated individually:
1. Read value in completely dry air → store as `DRY_VALUE` (~3200–3500)
2. Read value submerged in water → store as `WET_VALUE` (~1200–1500)
3. Map to 0–100% moisture: `moisture% = map(reading, DRY_VALUE, WET_VALUE, 0, 100)`
4. Store calibration values per zone in MySQL

## Moisture Threshold Recommendations (starting point, adjust by plant type)
| Condition       | Moisture % | Action                  |
|-----------------|-----------|-------------------------|
| Very dry        | < 25%     | Trigger automatic water |
| Dry             | 25–40%    | Schedule soon           |
| Adequate        | 40–65%    | No action               |
| Moist           | 65–80%    | Skip scheduled watering |
| Saturated       | > 80%     | Skip + suppress schedule|

## Installation Tips
- Insert sensor vertically into soil, probe fully buried
- Keep electronics PCB above soil line or seal thoroughly
- Place in root zone of plants (6–8 inches deep for most irrigation)
- Avoid direct sun on sensor PCB — UV degrades the board over time
