# Sprout and Spoon — local prototype

A calm, mobile-first kitchen-garden companion app. **Pure static site** —
no backend, no build step. Designed to talk to an Arduino Nano RP2040
Connect over USB serial (COM port) **or** Adafruit IO over Wi-Fi, with a
demo data path that always works as a fallback.

## Highlights

- **Two comms paths + demo**: COM serial (Web Serial) and Adafruit IO
  (HTTP REST polling) — selectable in Settings. If neither is configured
  the app falls back to a believable demo source.
- **Four herbs**: Basil (live, wired to the smart garden), plus Parsley,
  Thyme and Mint as informational reference profiles.
- **Recipes tab** with per-herb growth tracking from a planted date,
  growth-stage recommendations, a rotating Recipe of the Day per herb,
  and a Shopping List sub-view with persistent check-state.
- **UK Seasonality** card inside Plant Profile — detects season from
  today's date and ranks herbs by suitability with practical tips.
- **Test Mode** stays as a fully-isolated manual sandbox for UI / logic
  evaluation.

## Run it locally

```bash
cd herb-garden
python3 -m http.server 8000
```

Open <http://localhost:8000>.

Any static server works (`npx serve`, `php -S`, etc). A server is needed
because the JS is split into multiple files and Web Serial requires a
secure context — `localhost` qualifies.

## Open it on your phone for UI testing

Both devices on the same Wi-Fi network:

1. `python3 -m http.server 8000 --bind 0.0.0.0` (the default `0.0.0.0`
   already binds to every interface; `--bind` is just explicit).
2. Find your computer's local IP:
   - macOS (Wi-Fi): `ipconfig getifaddr en0`
   - Linux: `hostname -I`
   - Windows: `ipconfig` → IPv4 line of the Wi-Fi adapter
3. Open `http://<your-local-ip>:8000` on your phone.
4. If unreachable, allow port 8000 through your computer's firewall
   (macOS Firewall settings; Windows Defender → "Allow an app";
   Linux `sudo ufw allow 8000/tcp`).

## Where everything is configured

| What                | Where                                                    |
|---------------------|----------------------------------------------------------|
| **Adafruit IO**     | Settings → Connection (pick "Adafruit IO (Wi-Fi)" → fill username, key, feed names) — stored locally in `localStorage` keys `sproutandspoon.settings.v1` |
| **COM / Serial**    | Settings → Connection (pick "COM port / Serial (Arduino)" → "Connect Arduino" button uses Web Serial, Chrome/Edge only) |
| **Herb data**       | `js/plants.js` — the `PLANTS` object (basil/parsley/thyme/mint) + `ILLUSTRATIONS` SVG map |
| **Recipe data**     | `js/recipes.js` — `RECIPES` keyed by herb id (3 recipes each, edit / add freely) |
| **Shopping list**   | Derived from a recipe's `ingredients` array; check-state persists in localStorage key `sproutandspoon.shopping.v1` |
| **Seasonality**     | `js/seasonality.js` — `TABLE` (per-herb / per-season tier + tip) and `GROW_HINT` |
| **Planted dates**   | Settings → Garden ("Planted date" / "Date acquired" input). Persists per herb in `sproutandspoon.plantedDates.v1` |
| **Plant source**    | Settings → Garden ("From seed" / "Shop-bought · mature" toggle). Persists per herb in `sproutandspoon.plantSources.v1`. Drives growth-stage logic in Recipes |
| **Plant Health**    | `js/health.js` — the scoring formula (unchanged from prior milestones) |

## Adafruit IO setup

In Settings → Connection, pick **Adafruit IO (Wi-Fi)** and fill in:

- **Username**: your `io.adafruit.com` account name.
- **AIO key**: from `io.adafruit.com/my-key`. Stored only in your browser
  via `localStorage`.
- **Feed keys** for the 8 fields: moisture, temperature, humidity, light,
  reservoir, pump-status, water-command, selected-herb (optional). These
  are the *feed keys* (URL slugs) — not the human display names.

The Arduino publishes telemetry to the read-only feeds (~1 Hz works
well). The app polls each feed via REST (`/data/last`) every 5 seconds
and POSTs the water command to the `water_command` feed as a string
value like `"water:3000"`.

## Serial schema (unchanged)

When using **COM port / Serial**, the Arduino emits one JSON object per
line at 115200 baud:

```json
{"timestamp":"2026-05-17T12:34:56Z","moisture":42.3,"temperature":22.1,
 "humidity":55,"light_lux":12000,"reservoir_level":80,
 "pump_event":null}
```

Unknown fields are silently ignored, so existing firmware that still
emits a `ph` value will continue to work — the field just isn't used.

App → Arduino command:
```json
{"cmd":"water","duration_ms":3000}
```

Out-of-range and malformed values are scrubbed at the source layer
(`js/sources.js` → `normalize()` / `clean()`).

## Architecture

```
herb-garden/
├── index.html
├── styles.css
├── js/
│   ├── plants.js        # PLANTS DB + Test Mode SCENARIOS + ILLUSTRATIONS
│   ├── health.js        # Plant Health formula (unchanged)
│   ├── storage.js       # localStorage wrappers (sproutandspoon.*)
│   ├── sources.js       # LiveMockSource | SerialSource | AdafruitIOSource
│   ├── recipes.js       # RECIPES + recipeOfTheDay() + growthStage()
│   ├── seasonality.js   # currentSeason() + herbSuitability() (UK)
│   └── app.js           # Controller + UI rendering + tab routing
└── README.md
```

The DataSource interface — `start / stop / getLatest / sendCommand /
isConnected / isStale / sourceLabel / lastSyncMs / allowAutoWater` —
is the only seam the comms layer needs. Adding another transport (e.g.
local MQTT) means writing one new class implementing that shape and
adding a branch in `makeSource()` in `js/app.js`.

## Multi-herb behavior

| Herb     | live wiring | auto-water | event log writes | info cards | recipes |
|----------|-------------|------------|------------------|------------|---------|
| Basil    | ✓           | ✓          | ✓                | ✓          | ✓       |
| Parsley  | ✗ (demo)    | ✗          | ✗                | ✓          | ✓       |
| Thyme    | ✗ (demo)    | ✗          | ✗                | ✓          | ✓       |
| Mint     | ✗ (demo)    | ✗          | ✗                | ✓          | ✓       |

Selecting a non-basil herb shows the "Demo profile" note on Home and
disables the Water now button. Recipes, seasonality and growth tracking
all still work for any selected herb.

## Adding a new herb

In `js/plants.js`, add an entry to `PLANTS` with the same shape as
`basil` or `parsley`. Set `live: false` unless you've wired the smart
garden hardware to react to it. Add 3 recipes in `js/recipes.js` under
the new id, and an `ILLUSTRATIONS` entry in `js/plants.js`. The herb
picker, dropdowns, and seasonality table pick it up automatically.

## Plant Health formula

For each metric `m` with value `v` and ranges `{ideal, ok}`:
- `null` → excluded from the average (weight redistributes)
- inside `ideal` → 100
- inside `ok` but outside `ideal` → linear 100 → 50 across the gap
- outside `ok` → linear 50 → 0 across an equal-width buffer, clamped

Reservoir sub-score = `clamp(level%, 0, 100)`.

Metrics scored: soil moisture (30%), temperature (25%), light (20%),
humidity (15%), reservoir (10%). pH is intentionally not scored —
the prototype hardware doesn't include a pH sensor.

`PlantHealth = round(Σ wₘ · sₘ / Σ wₘ)`, clamped to 1–100.
