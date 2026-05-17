# Herb Garden — local prototype

A calm, mobile-first prototype for a self-watering smart herb garden.
**Pure static site** — no backend, no build step. The live monitoring
app and the new **Test Mode** sandbox are two completely separate
experiences. Designed to later connect to an Arduino Nano RP2040
Connect over USB serial; ready to host as a static page (e.g. GitHub
Pages) without changes.

## Two modes

| Mode             | What it is                                   | Data source                  | Touches history? |
|------------------|----------------------------------------------|------------------------------|------------------|
| **Live mode**    | The real monitoring app (Home, Live Data, History, Plant Profile, Settings, Alerts) | `LiveMockSource` (drifting mock) → swap to Arduino in Settings | Yes — real events log |
| **Test Mode tab**| Manual sandbox for UI / logic evaluation     | Whatever values you enter via sliders + presets | No — fully isolated |

A clear `SIMULATED` pill at the top of Test Mode reminds you it's
manual data, not from the live system. Live mode keeps a `Demo (mock)`
chip in the header while you haven't connected a real Arduino yet.

## Run it locally

```bash
cd herb-garden
python3 -m http.server 8000
```

Open <http://localhost:8000>.

A local server is needed (separate JS files + Web Serial needs a secure
context — `localhost` qualifies). Any static server works: `npx serve`,
`php -S 0.0.0.0:8000`, etc.

## Open it on your phone for UI testing

Both your computer and phone must be on the **same Wi-Fi network**.

1. **Start the server bound to all interfaces.** `python3 -m http.server`
   already listens on `0.0.0.0` by default (i.e. on every network
   interface), so the command above is enough. To be explicit:

   ```bash
   python3 -m http.server 8000 --bind 0.0.0.0
   ```

2. **Find your computer's local IP address:**

   - **macOS** (Wi-Fi): `ipconfig getifaddr en0`
     If you're on a wired Mac, try `en1` or use `ifconfig | grep "inet "`.
   - **Linux**: `hostname -I` (usually the first IP listed).
   - **Windows**: `ipconfig` and look at the IPv4 line of your Wi-Fi
     adapter — something like `192.168.x.x` or `10.0.x.x`.

   You're looking for a private LAN address: typically starts with
   `192.168.`, `10.`, or `172.16–31.`.

3. **Open `http://<your-local-ip>:8000` on your phone's browser.**
   Example: `http://192.168.1.42:8000`. The full app loads, including
   Test Mode.

4. **If the phone can't reach it,** the culprit is almost always your
   computer's firewall blocking port 8000:

   - **macOS**: System Settings → Network → Firewall → allow incoming
     connections for `Python`, or temporarily turn the firewall off.
   - **Windows**: Windows Security → Firewall & network protection →
     Allow an app through firewall → add Python for the *Private*
     network. Or run the dev server through the WSL2 console if
     applicable.
   - **Linux** (ufw): `sudo ufw allow 8000/tcp` (only while testing).
   - Some public/guest Wi-Fi networks (cafés, hotels, school) block
     device-to-device traffic. Use a phone hotspot or a home/private
     network in that case.

> Hot reload tip: edit a file, then just refresh the page on your
> phone. No restart needed.

## Test Mode tour

The Test tab gives you:

- **Scenario presets** (chips, horizontally scrollable): Healthy basil,
  Dry soil, Overly wet soil, Low reservoir, Poor light, Low temperature,
  High temperature, Low pH, High pH. Each one only **populates the
  sliders** — you can edit any value afterward.
- **Sensor inputs** (sliders + numeric overlay): soil moisture,
  temperature, humidity, soil pH (+ a "pH sensor present" toggle),
  light intensity in lux, reservoir level, last-watered minutes ago.
- **Live preview** that recomputes instantly: Plant Health gauge, plain-
  English status summary, last-watered tile, reservoir tile with bar,
  light tile with descriptor, key-metric chips, full sub-scores
  breakdown showing exactly how the formula sees each metric, and the
  alerts that *would* trigger at those values (low reservoir,
  auto-water trigger, temperature out of safe range, etc.).
- **Reset to Healthy preset** button.

State is persisted to `localStorage` so your last Test Mode setup
survives a reload, but it never leaks into the live history or
last-watered time.

## Switch to a live Arduino

1. **Settings → Connection** → set *Data source* to **Live serial
   (Arduino)**.
2. Click **Connect Arduino**. Use Chrome or Edge (Web Serial requires
   them). Pick the port.
3. The Arduino must emit one JSON object per line at 115200 baud (see
   schema below). The "Demo (mock)" chip turns into a green
   "Connected" chip when frames start arriving.

## Serial schema

**Arduino → app** (~1 Hz, one JSON object per line):
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
│   ├── plants.js      # Plant DB (basil) + SCENARIOS (used by Test Mode presets)
│   ├── health.js      # Plant Health formula
│   ├── sources.js     # LiveMockSource | SerialSource (live mode only)
│   ├── storage.js     # localStorage helpers (settings, events, test mode)
│   └── app.js         # Live-mode controller + UI rendering + Test Mode sandbox
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

The Test Mode sub-scores card shows each metric's score and weight, so
you can verify the formula behavior at any input combination.

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
