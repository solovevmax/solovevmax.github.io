# Sprout and Spoon — local prototype

A calm, mobile-first kitchen-garden companion app. The frontend is a
**custom UI** (not an Adafruit IO dashboard) and talks to the smart
garden through a small local **Flask backend** that proxies Adafruit
IO. The Adafruit IO key lives only in `backend/.env` — the browser
never sees it.

## Highlights

- **Backend-first communication.** The frontend polls a local
  Flask backend (`herb-garden/backend/app.py`) every 10 s; the backend
  fans out to the AIO feeds in parallel and returns one merged
  telemetry frame. The AIO key stays server-side.
- **Optional USB serial debug.** The firmware also emits newline-
  delimited JSON on `usb_cdc.data`. The app exposes a "Serial (debug)"
  option in Settings for direct bench debugging; it is not the main
  channel.
- **Demo fallback.** When the backend is offline (or before you set up
  AIO creds) the app falls back to a believable mock so the UI never
  freezes.
- **Four herbs**, Recipes tab, UK Seasonality, Test Mode — unchanged
  from earlier milestones.

## Run it locally

```bash
# 1. Install the backend deps (one time).
cd herb-garden/backend
pip install -r requirements.txt

# 2. Configure Adafruit IO credentials (one time).
cp .env.example .env
# Edit .env and fill in AIO_USERNAME and AIO_KEY.

# 3. Start the backend (serves the API and the static frontend).
python app.py
```

Open <http://127.0.0.1:8000>.

`python app.py` reads `backend/.env`, starts Flask on
`127.0.0.1:8000`, and serves `herb-garden/index.html` at `/` so the
backend and frontend share an origin (no CORS headaches).

To bind on every interface (for phone testing on the same Wi-Fi):

```bash
HOST=0.0.0.0 PORT=8000 python app.py
```

Then open `http://<your-local-ip>:8000` on your phone.

## Environment variables (backend/.env)

| Variable                       | Required | Default            | Notes |
|--------------------------------|----------|--------------------|-------|
| `AIO_USERNAME`                 | yes      | —                  | Adafruit IO username |
| `AIO_KEY`                      | yes      | —                  | AIO key from io.adafruit.com/my-key |
| `AIO_FEED_MOISTURE`            | no       | `soil-moisture`    | telemetry feed slug |
| `AIO_FEED_TEMPERATURE`         | no       | `temperature`      | telemetry feed slug |
| `AIO_FEED_HUMIDITY`            | no       | `humidity`         | telemetry feed slug |
| `AIO_FEED_LIGHT`               | no       | `light-level`      | telemetry feed slug |
| `AIO_FEED_RESERVOIR`           | no       | `water-reservoir`  | telemetry feed slug |
| `AIO_FEED_PUMP_STATUS`         | no       | `pump-status`      | telemetry feed slug |
| `AIO_FEED_WATER_COMMAND`       | no       | `water-command`    | command feed slug |
| `AIO_FEED_SELECTED_HERB`       | no       | `selected-herb`    | command feed slug |
| `HOST`                         | no       | `127.0.0.1`        | bind address |
| `PORT`                         | no       | `8000`             | bind port |
| `FLASK_DEBUG`                  | no       | `0`                | `1` enables the Flask reloader |

If `AIO_USERNAME` / `AIO_KEY` are unset, the backend stays up but
returns `503` from `/api/telemetry`; the frontend displays "Backend:
no AIO creds" so it's obvious what's missing.

## Backend API

| Endpoint                  | Method | Purpose |
|---------------------------|--------|---------|
| `/`                       | GET    | serves the static frontend |
| `/api/health`             | GET    | `{ ok, configured, feeds }` |
| `/api/telemetry`          | GET    | latest reading merged across the six AIO telemetry feeds; `503` if creds missing |
| `/api/water`              | POST   | `{ "duration_ms": 3000 }` → writes `water:3000` to the `water-command` feed |
| `/api/selected-herb`      | POST   | `{ "herb": "basil" }` → writes the herb id to the `selected-herb` feed |

`/api/telemetry` response shape:

```json
{
  "configured": true,
  "fetched_at": "2026-05-19T14:32:05Z",
  "moisture_pct": 42.3,
  "temperature_c": 22.1,
  "humidity_pct": 55.0,
  "light_lux": 12000,
  "reservoir_level": 80,
  "pump_status": "idle",
  "timestamp": "2026-05-19T14:32:01Z",
  "time_valid": true,
  "feed_errors": {}
}
```

- `timestamp` is the newest `created_at` across the polled feeds, or
  `null` if every feed is empty.
- `time_valid` is `true` whenever the backend got a usable
  `created_at`, mirroring the firmware's signal so the frontend can
  render "Device · 5s ago" vs "Received · 5s ago" gracefully.

## Where everything is configured

| What                | Where                                                    |
|---------------------|----------------------------------------------------------|
| **Adafruit IO creds** | `backend/.env` (`AIO_USERNAME`, `AIO_KEY`). Never in the browser. |
| **AIO feed slugs**  | `backend/.env` (`AIO_FEED_*`) or the defaults baked into `backend/app.py` |
| **Backend URL / poll interval** | Settings → Connection (frontend). Defaults: same-origin, 10 s poll |
| **Serial (debug)**  | Settings → Connection, pick "Serial (debug only)" → "Connect Arduino". Web Serial; Chrome/Edge only. |
| **Herb data**       | `js/plants.js` — the `PLANTS` object + `ILLUSTRATIONS` |
| **Recipe data**     | `js/recipes.js` — `RECIPES` keyed by herb id |
| **Shopping list**   | Derived from a recipe's `ingredients`; check-state persists in `sproutandspoon.shopping.v1` |
| **Seasonality**     | `js/seasonality.js` |
| **Planted dates / plant source** | Settings → Garden. Persist per-herb in `sproutandspoon.plantedDates.v1` / `sproutandspoon.plantSources.v1` |
| **Plant Health**    | `js/health.js` |

## Serial schema (firmware ↔ app, debug only)

The firmware emits one JSON object per line at 115 200 baud on
`usb_cdc.data`:

```json
{"timestamp":"2026-05-19T14:32:01Z","moisture":42.3,"temperature":22.1,
 "humidity":55,"light_lux":12000,"reservoir_level":80,
 "pump_event":null,"time_valid":true}
```

- `time_valid` is the new flag from the firmware. When `false`, the
  frontend falls back to "Received · Xs ago" using the receipt time
  instead of the device timestamp.
- Unknown fields are ignored, so older firmware that still emits `ph`
  remains compatible.

App → firmware command:

```json
{"cmd":"water","duration_ms":3000}
```

Out-of-range and malformed values are scrubbed in
`js/sources.js → normalize()`.

## Architecture

```
herb-garden/
├── index.html
├── styles.css
├── js/
│   ├── plants.js        # PLANTS DB + Test Mode SCENARIOS + ILLUSTRATIONS
│   ├── health.js        # Plant Health formula
│   ├── storage.js       # localStorage wrappers (no creds — purges legacy keys)
│   ├── sources.js       # BackendSource | LiveMockSource | SerialSource
│   ├── recipes.js
│   ├── seasonality.js
│   └── app.js
├── backend/
│   ├── app.py           # Flask proxy + static file server
│   ├── requirements.txt
│   ├── .env.example
│   └── .gitignore       # .env, __pycache__, venvs
└── README.md
```

The DataSource interface — `start / stop / getLatest / sendCommand /
isConnected / isStale / sourceLabel / lastSyncMs / publishSelectedHerb`
— is the only seam the comms layer needs.

## Plant Health formula

For each metric `m` with value `v` and ranges `{ideal, ok}`:
- `null` → excluded from the average (weight redistributes)
- inside `ideal` → 100
- inside `ok` but outside `ideal` → linear 100 → 50 across the gap
- outside `ok` → linear 50 → 0 across an equal-width buffer, clamped

Reservoir sub-score = `clamp(level%, 0, 100)`.

Metrics scored: soil moisture (30%), temperature (25%), light (20%),
humidity (15%), reservoir (10%). pH is intentionally not scored.

`PlantHealth = round(Σ wₘ · sₘ / Σ wₘ)`, clamped to 1–100.
