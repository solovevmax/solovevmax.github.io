# Herb Garden — local prototype

A local-only monitoring + auto-watering app for a self-watering smart herb
garden. Built for **basil** first and structured so more herbs can be added.
Starts with mock data; designed to swap to live USB serial input from an
Arduino Nano RP2040 Connect later, with no architectural changes.

## Stack

- **Python 3** + **Flask** (serves UI + small JSON API)
- **pyserial** (for the Arduino swap; not used in mock mode)
- Vanilla HTML / CSS / JS — no build step
- JSON files on disk for settings + event log (no DB)

## Run it locally

```bash
cd herb-garden
python3 -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5000>. The "Demo Data" badge in the header confirms
mock mode. Watch the moisture metric drift down — when it crosses the
threshold, an auto-watering fires, the gauge climbs, and a watering event
appears in **History**.

## Switch to live Arduino serial

1. Plug in the Arduino over USB. Identify the port:
   - macOS/Linux: `ls /dev/tty.* /dev/ttyACM*` (typically `/dev/ttyACM0`)
   - Windows: Device Manager → "COMx"
2. In **Settings**:
   - Set **Data source** to `Live serial (Arduino)`
   - Set **Serial port** to your port (e.g. `/dev/ttyACM0` or `COM3`)
   - Save. The connection swap is hot — no restart.
3. The Arduino must emit one JSON object per line at 115200 baud (see
   schema below). When real data starts flowing the "Demo Data" badge
   disappears and the connection badge turns green.

## Serial schema (one JSON object per line)

**Arduino → App** (~1 Hz):
```json
{"timestamp":"2026-05-17T12:34:56Z","moisture":42.3,"temperature":22.1,
 "humidity":55,"ph":6.5,"light_lux":12000,"reservoir_level":80,
 "pump_event":null}
```

**Arduino → App** when pump finishes:
```json
{"timestamp":"...","pump_event":"completed","moisture":...}
```

**App → Arduino** (command):
```json
{"cmd":"water","duration_ms":3000}
```

Any missing field is treated as `null` and rendered as "— no data —".
Impossible values (e.g. moisture = -5, temp = 999) are rejected.

## File map

```
herb-garden/
├── app.py                     # Flask routes + bootstrap
├── herb_garden/
│   ├── plants.py              # Plant reference DB
│   ├── health.py              # Plant Health formula
│   ├── data_sources.py        # MockDataSource + SerialDataSource
│   ├── controller.py          # Auto-water, alerts, snapshot for UI
│   ├── events.py              # Append-only event log (JSON)
│   ├── validation.py          # Sanity checks for sensor values
│   └── config.py              # Settings persisted to JSON
├── static/                    # index.html, styles.css, app.js
└── data/                      # created at runtime: settings.json, events.json
```

## Adding a new herb

Open `herb_garden/plants.py` and append a dict to `PLANTS`:

```python
"mint": {
    "id": "mint", "common_name": "Mint", "scientific_name": "Mentha",
    "image": "basil",  # or add a new SVG in static/app.js
    "notes": "Cool-tolerant; loves moisture; partial sun OK.",
    "ranges": {
        "moisture_pct":  {"ideal": [50, 80],   "ok": [35, 90]},
        "temperature_c": {"ideal": [15, 24],   "ok": [10, 30]},
        ...
    },
    "weights": { "moisture_pct": 0.35, ... },          # must sum to 1.0
    "moisture_threshold_pct": 45,
    "watering_cooldown_s": 600,
}
```

The Settings dropdown picks it up automatically.

## Plant Health formula

For each metric `m`, a sub-score `s_m` in 0–100 is computed:

- `null` → 0 (and labelled "Missing")
- inside `ideal` range → 100
- inside `ok` range but outside `ideal` → linear taper 100 → 50 across the gap
- outside `ok` range → linear taper 50 → 0 across an equal-width buffer, clamped

Reservoir sub-score = `clamp(level%, 0, 100)`.

`Plant Health = round(Σ weight_m × s_m / Σ weight_m)`, clamped to 1–100.

The **explanation** below the gauge is the metric with the lowest sub-score
("Low moisture", "Low light", "Reservoir low"). If every sub-score ≥ 80 it
reads "Thriving"; if all ≥ 60, "Doing well".

## What's mocked vs. real

| Concern              | Mock                            | Live (later)                          |
|----------------------|---------------------------------|---------------------------------------|
| Sensor readings      | `MockDataSource` synthesizes    | `SerialDataSource` reads JSON lines   |
| Watering command     | Mock bumps moisture internally  | App sends `{"cmd":"water",...}` over serial |
| Pump completion event| Synthesized after command       | Arduino echoes `"pump_event":"completed"`  |
| Connection badge     | Always green ("Demo Data" chip) | Green when port is open and data fresh|
| Stale-data alert     | Same logic                      | Same logic                            |

No code outside `_build_source()` cares which source is in use — that's the
seam that lets the prototype graduate to real hardware.
