# Herb Garden — local prototype

A calm, mobile-first prototype for a self-watering smart herb garden.
**Pure static site** — no backend, no build step. Open it locally now;
later, host it as a static page (e.g. GitHub Pages) or connect a real
Arduino Nano RP2040 Connect over USB serial from the browser.

## Run it locally

The simplest path that works on every browser:

```bash
cd herb-garden
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

> A local server is needed because the JS files are loaded as separate
> scripts and Web Serial requires a secure context (localhost counts as
> secure). Any static server works — `npx serve`, `php -S`, etc.

## Test Data (preview without an Arduino)

There's a **Test** dropdown in the top-right at all times. Switch between:

- **Live demo** — drifting mock data; moisture trickles down, auto-water
  fires when it crosses the threshold, the gauge animates.
- **Healthy basil** — fixed thriving readings (score ~95+).
- **Dry soil — needs water** — moisture below threshold; click *Water now*
  or just wait for auto-water to kick in.
- **Low reservoir** — reservoir at ~12%; triggers the refill alert and
  blocks auto-watering.

Every section (Home, Live Data, History, Plant Profile, Settings, Alerts)
updates from the same source, so the whole UI previews accurately.

## Switch to a live Arduino

1. Open **Settings → Connection** and set *Data source* to
   **Live serial (Arduino)**.
2. Click **Connect Arduino**. The browser prompts you to pick the serial
   port. Use Chrome or Edge — Firefox/Safari don't yet support Web Serial.
3. The Arduino must emit one JSON object per line at 115200 baud. The
   demo banner disappears and the connection chip turns green.

## Serial schema

**Arduino → app** (one JSON object per line, ~1 Hz):
```json
{"timestamp":"2026-05-17T12:34:56Z","moisture":42.3,"temperature":22.1,
 "humidity":55,"ph":6.5,"light_lux":12000,"reservoir_level":80,
 "pump_event":null}
```

**Arduino → app** when pump completes (optional echo):
```json
{"timestamp":"...","pump_event":"completed","moisture":...}
```

**App → Arduino** (command):
```json
{"cmd":"water","duration_ms":3000}
```

Missing fields → `null` and rendered as "— no data —". Out-of-range
values (e.g. moisture = -5) are silently rejected. No frame within 10 s
→ stale-data alert + the connection chip turns amber.

## File structure

```
herb-garden/
├── index.html
├── styles.css
├── js/
│   ├── plants.js      # Plant DB (basil) + Test Data SCENARIOS
│   ├── health.js      # Plant Health formula
│   ├── sources.js     # ScenarioSource | LiveMockSource | SerialSource
│   ├── storage.js     # localStorage helpers (settings + events)
│   └── app.js         # Controller + UI rendering + tab nav
└── README.md
```

## Plant Health formula

For each metric `m` with value `v` and ranges `{ideal, ok}`:

- `null` → **excluded from the average** (weight is redistributed)
- inside `ideal` → 100
- inside `ok` but outside `ideal` → linear 100 → 50 across the gap
- outside `ok` → linear 50 → 0 across an equal-width buffer, clamped

Reservoir sub-score = `clamp(level%, 0, 100)`.

```
PlantHealth = round( Σ wₘ · sₘ / Σ wₘ )  →  clamp 1..100
```

Basil weights: moisture **30%**, temperature **20%**, light **20%**,
humidity **10%**, pH **10%**, reservoir **10%**.

The line under the gauge surfaces the worst sub-score in plain English:
"Low moisture", "High temperature", "Reservoir low", etc.

## Adding a new herb

Open `js/plants.js` and add an entry to `PLANTS`:

```js
mint: {
  id: 'mint', common_name: 'Mint', scientific_name: 'Mentha',
  illustration: 'basil',          // or add a new SVG to ILLUSTRATIONS
  notes: 'Cool-tolerant; loves moisture; partial sun is fine.',
  ranges: {
    moisture_pct:  { ideal: [50, 80], ok: [35, 90] },
    temperature_c: { ideal: [15, 24], ok: [10, 30] },
    // ...
  },
  weights: { /* must sum to 1.0 */ },
  moisture_threshold_pct: 45,
  watering_cooldown_s: 600,
}
```

## What's mocked vs. real

| Concern             | Mock / Test                          | Live (later)                         |
|---------------------|--------------------------------------|--------------------------------------|
| Sensor readings     | `ScenarioSource` / `LiveMockSource`  | `SerialSource` reads JSON lines      |
| Water command       | Mock bumps moisture internally        | `{"cmd":"water"}` written to USB     |
| Completion event    | Synthesized after command            | Arduino echoes `pump_event:"completed"` |
| Connection chip     | Always green ("Demo (mock)" label)    | Green when port open and data fresh  |
| Stale-data warning  | Same logic                            | Same logic                           |

The only swap-point is `makeSource()` in `js/app.js`. Everything else is
source-agnostic.
