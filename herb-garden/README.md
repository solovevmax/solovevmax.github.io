# Sprout and Spoon — local prototype

A calm, mobile-first kitchen-garden companion app. **Pure static site** —
no backend, no build step. The browser talks directly to Adafruit IO
using credentials the user enters in Settings (stored only in
`localStorage`).

## Highlights

- **Adafruit IO is the primary live channel.** Username + key are
  entered in Settings → Connection and live in browser `localStorage`
  only. The app polls the feeds via REST every 10 s and POSTs the
  water command to `water-command` when the Water now button is
  pressed (`water:3000` payload, single-flight).
- **USB serial is optional debug-only.** The firmware exposes JSON
  frames on `usb_cdc.data`; Settings → Connection has a
  "Serial (debug only)" choice that uses Web Serial.
- **Demo fallback.** When AIO credentials aren't filled in yet the
  source falls back to a believable mock so the UI never freezes.
- **Day / night grow cycle.** The app watches the user's local time
  and shifts targets accordingly: at night the light target drops to
  ~0 lx, temperature targets drop ~4 °C, the auto-water threshold
  drops 10 percentage points, and the cooldown doubles. The UI
  switches into a dark theme (`body.night-mode`) overnight and a
  cycle banner on Home shows the local time, a sunrise / midday /
  sunset / moon icon, the current cycle, and the active targets.
- **Four herbs**, Recipes tab, UK Seasonality, harvest tracking.
- **Shop-bought herbs are harvest-ready from day 1.** Selecting
  "Shop-bought / mature" in Settings → Garden flips the Recipes
  growth tracker to "Ready to harvest" and surfaces a "Ready to
  harvest — use the leaves in today's recipe" badge on Home.

## Run it locally

```bash
cd herb-garden
python3 -m http.server 8000
```

Open <http://localhost:8000>.

Any static server works (`npx serve`, `php -S`, etc). A server is
needed because the JS is split into multiple files and Web Serial
requires a secure context — `localhost` qualifies.

## Open it on your phone for UI testing

Both devices on the same Wi-Fi network:

1. `python3 -m http.server 8000 --bind 0.0.0.0`
2. Find your computer's local IP:
   - macOS (Wi-Fi): `ipconfig getifaddr en0`
   - Linux: `hostname -I`
   - Windows: `ipconfig` → IPv4 line of the Wi-Fi adapter
3. Open `http://<your-local-ip>:8000` on your phone.
4. If unreachable, allow port 8000 through your computer's firewall.

## Where everything is configured

| What                | Where                                                    |
|---------------------|----------------------------------------------------------|
| **Adafruit IO**     | Settings → Connection → "Adafruit IO (live)". Username, key, poll interval, feed slugs all entered here. Persists in `localStorage` under `sproutandspoon.settings.v1`. |
| **Serial (debug)**  | Settings → Connection → "Serial (debug only)" → "Connect Arduino". Web Serial; Chrome/Edge only. |
| **Day/night cycle** | `js/cycle.js`. Day = 06:00–20:00 local time. Edit `DAY_START_HOUR` / `DAY_END_HOUR` to shift the window. |
| **Cycle adjustments** | `js/cycle.js` → `adjustedRanges()` (night light/temp targets) and `adjustedWateringParams()` (night threshold + cooldown). |
| **Herb data**       | `js/plants.js` — the `PLANTS` object + `ILLUSTRATIONS` SVG map. |
| **Recipe data**     | `js/recipes.js` — `RECIPES` keyed by herb id. |
| **Shopping list**   | Derived from a recipe's `ingredients`; check-state persists in `sproutandspoon.shopping.v1`. |
| **Seasonality**     | `js/seasonality.js`. |
| **Planted dates / plant source** | Settings → Garden. Persist per-herb in `sproutandspoon.plantedDates.v1` / `sproutandspoon.plantSources.v1`. |
| **Plant Health**    | `js/health.js`. |

## Adafruit IO setup

In Settings → Connection, pick **Adafruit IO (live)** and fill in:

- **Username** — from `io.adafruit.com`.
- **AIO key** — from `io.adafruit.com/my-key`. Stored only in your
  browser via `localStorage`. The browser sends this directly to
  Adafruit IO over HTTPS.
- **Feed slugs** are under a small "Feed slugs" disclosure if you've
  named them differently to the firmware's defaults (`soil-moisture`,
  `temperature`, `humidity`, `light-level`, `water-reservoir`,
  `pump-status`, `water-command`, `selected-herb`).

The Arduino publishes telemetry every 15 s. The app polls each feed
via REST (`/data/last`) every 10 s and POSTs `water:3000` to
`water-command` when Water now is pressed. The firmware deduplicates
repeated water commands as a second layer of protection.

## Day / night grow cycle

`js/cycle.js` derives a binary `'day' | 'night'` state from the
local clock plus a finer `sunrise | morning | midday | sunset |
night` bucket used only for the icon and label on Home.

Cycle adjustments:

- Light target shifts to `ideal [0, 50] lx`, `ok [0, 300] lx` at
  night so the plant resting in darkness reads as "good".
- Temperature ideal + ok ranges drop 4 °C.
- Auto-water moisture threshold drops 10 percentage points and the
  cooldown doubles — the plant transpires less at night.

The body gains the `night-mode` class between 20:00 and 06:00. The
palette swaps to a near-black surface with brighter lime accents
while the brand mark and primary actions stay the same hue.

## Serial schema (firmware ↔ app, debug only)

The firmware emits one JSON object per line at 115 200 baud on
`usb_cdc.data`:

```json
{"timestamp":"2026-05-19T14:32:01Z","moisture":42.3,"temperature":22.1,
 "humidity":55,"light_lux":12000,"reservoir_level":80,
 "pump_event":null,"time_valid":true}
```

- `time_valid: false` makes the app fall back to "Received · Xs ago"
  instead of "Device · Xs ago" in the connection chip.
- Unknown fields are ignored — older firmware emitting `ph` is
  still compatible.

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
│   ├── plants.js        # PLANTS DB + ILLUSTRATIONS
│   ├── health.js        # Plant Health formula
│   ├── storage.js       # localStorage wrappers (sproutandspoon.*)
│   ├── sources.js       # AdafruitIOSource | LiveMockSource | SerialSource
│   ├── recipes.js
│   ├── seasonality.js
│   ├── cycle.js         # day/night grow cycle + dark mode trigger
│   └── app.js
└── README.md
```

The DataSource interface (`start / stop / getLatest / sendCommand /
isConnected / isStale / sourceLabel / lastSyncMs /
publishSelectedHerb`) is the only seam the comms layer needs.

## Plant Health formula

For each metric `m` with value `v` and the active (cycle-adjusted)
`{ideal, ok}` ranges:

- `null` → excluded from the average (weight redistributes)
- inside `ideal` → 100
- inside `ok` but outside `ideal` → linear 100 → 50 across the gap
- outside `ok` → linear 50 → 0 across an equal-width buffer, clamped

Reservoir sub-score = `clamp(level%, 0, 100)`.

Metrics scored: soil moisture (30%), temperature (25%), light (20%),
humidity (15%), reservoir (10%). pH is intentionally not scored.

`PlantHealth = round(Σ wₘ · sₘ / Σ wₘ)`, clamped to 1–100.
