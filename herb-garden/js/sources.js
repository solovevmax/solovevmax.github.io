/* Data sources. All implement the same shape:
 *
 *   start()             - begin producing readings
 *   stop()
 *   getLatest()         - the most recent normalized reading or null
 *   sendCommand(cmd)    - e.g. { cmd: "water", duration_ms: 3000 }
 *   isConnected()       - bool
 *   isStale()           - bool
 *   sourceLabel         - human string
 *
 * Reading shape (after normalization):
 *   { timestamp, moisture_pct, temperature_c, humidity_pct, ph,
 *     light_lux, reservoir_level, pump_event }
 */
(function (root) {

  const LIMITS = {
    moisture_pct:    [0, 100],
    temperature_c:   [-20, 60],
    humidity_pct:    [0, 100],
    ph:              [0, 14],
    light_lux:       [0, 200000],
    reservoir_level: [0, 100],
  };

  function clean(field, v) {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const [lo, hi] = LIMITS[field];
    if (n < lo || n > hi) return null;
    return n;
  }

  function normalize(raw) {
    return {
      timestamp: raw.timestamp || new Date().toISOString(),
      moisture_pct:    clean('moisture_pct',    raw.moisture_pct    ?? raw.moisture),
      temperature_c:   clean('temperature_c',   raw.temperature_c   ?? raw.temperature),
      humidity_pct:    clean('humidity_pct',    raw.humidity_pct    ?? raw.humidity),
      ph:              clean('ph',              raw.ph),
      light_lux:       clean('light_lux',       raw.light_lux),
      reservoir_level: clean('reservoir_level', raw.reservoir_level),
      pump_event:      raw.pump_event ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // ScenarioSource — fixed Test Data state. Static reading; auto-water still
  // works (manual + auto-trigger), and the chosen scenario evolves slightly so
  // the UI feels alive (small jitter, moisture climbs after watering).
  // -------------------------------------------------------------------------
  class ScenarioSource {
    constructor(scenario, intervalMs = 1000) {
      this.scenarioId = scenario.id;
      this.label = scenario.label;
      this._base = { ...scenario.reading };
      this._reading = null;
      this._timer = null;
      this._interval = intervalMs;
      this._lastUpdate = 0;
      this._pumpBump = 0;
      this.sourceLabel = `Test: ${scenario.label}`;
      // Static scenarios are previews; auto-water shouldn't fire automatically
      // (would destabilize the demo state). Manual water still works.
      this.allowAutoWater = false;
    }
    start() {
      if (this._timer) return;
      const tick = () => {
        const j = (k, amp) => this._base[k] + (Math.random() - 0.5) * amp;
        let moisture = this._base.moisture_pct + this._pumpBump + (Math.random() - 0.5) * 1.5;
        // Pump effect fades quickly so the dry-soil scenario re-dries within a few seconds
        if (this._pumpBump > 0) this._pumpBump = Math.max(0, this._pumpBump - 5);
        const reading = {
          timestamp: new Date().toISOString(),
          moisture_pct: clean('moisture_pct', moisture),
          temperature_c: clean('temperature_c', j('temperature_c', 0.4)),
          humidity_pct:  clean('humidity_pct',  j('humidity_pct',  1.5)),
          ph:            clean('ph',            j('ph',            0.05)),
          light_lux:     clean('light_lux',     j('light_lux',     800)),
          reservoir_level: clean('reservoir_level', this._base.reservoir_level - 0),
          pump_event: null,
        };
        this._reading = reading;
        this._lastUpdate = Date.now();
      };
      tick();
      this._timer = setInterval(tick, this._interval);
    }
    stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
    getLatest() { return this._reading; }
    sendCommand(cmd) {
      if (cmd && cmd.cmd === 'water') {
        // Pump bumps moisture upward by ~25%; reservoir drops a touch
        this._pumpBump += 25;
        this._base.reservoir_level = Math.max(0, this._base.reservoir_level - 3);
      }
    }
    isConnected() { return true; }
    isStale() { return false; }
  }

  // -------------------------------------------------------------------------
  // LiveMockSource — believable drift. Moisture trickles down so the auto-
  // water threshold actually fires. Default source when no scenario picked.
  // -------------------------------------------------------------------------
  class LiveMockSource {
    constructor(intervalMs = 1000) {
      this._timer = null; this._reading = null;
      this._interval = intervalMs;
      this._t = 0;
      this._moisture = 58;
      this._reservoir = 92;
      this._pendingPumpEvent = false;
      this.sourceLabel = 'Demo (mock)';
      this.allowAutoWater = true;
    }
    start() {
      if (this._timer) return;
      const tick = () => {
        this._t += this._interval / 1000;
        // Drift moisture down (~0.3 %/s). After ~80s from 58% we'd hit 35%.
        this._moisture = Math.max(5, this._moisture - 0.3);
        let pumpEvent = null;
        if (this._pendingPumpEvent) {
          this._moisture = Math.min(85, this._moisture + 25);
          this._reservoir = Math.max(0, this._reservoir - 3);
          this._pendingPumpEvent = false;
          pumpEvent = 'completed';
        }
        const temp  = 22 + 2.5 * Math.sin(this._t / 30) + (Math.random() - 0.5) * 0.6;
        const hum   = 50 + 7   * Math.sin(this._t / 40) + (Math.random() - 0.5) * 2;
        const ph    = 6.5 + 0.15 * Math.sin(this._t / 60);
        const lux   = Math.max(0, 24000 + 18000 * Math.sin(this._t / 90) + (Math.random() - 0.5) * 1500);
        this._reading = {
          timestamp: new Date().toISOString(),
          moisture_pct: Math.round(this._moisture * 10) / 10,
          temperature_c: Math.round(temp * 10) / 10,
          humidity_pct: Math.round(hum * 10) / 10,
          ph: Math.round(ph * 100) / 100,
          light_lux: Math.round(lux),
          reservoir_level: Math.round(this._reservoir * 10) / 10,
          pump_event: pumpEvent,
        };
      };
      tick();
      this._timer = setInterval(tick, this._interval);
    }
    stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
    getLatest() { return this._reading; }
    sendCommand(cmd) { if (cmd && cmd.cmd === 'water') this._pendingPumpEvent = true; }
    isConnected() { return true; }
    isStale() { return false; }
  }

  // -------------------------------------------------------------------------
  // SerialSource — Web Serial API. Reads JSON-per-line frames; writes
  // commands as JSON+newline. Stub if API isn't available.
  // -------------------------------------------------------------------------
  class SerialSource {
    constructor(staleAfterMs = 10000) {
      this._port = null; this._reader = null; this._writer = null;
      this._buf = ''; this._reading = null;
      this._lastUpdate = 0; this._connected = false;
      this._staleAfter = staleAfterMs;
      this.sourceLabel = 'Live serial';
      this.allowAutoWater = true;
    }
    static isSupported() { return 'serial' in navigator; }
    async connect() {
      if (!SerialSource.isSupported()) {
        throw new Error('Web Serial API not available in this browser.');
      }
      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: 115200 });
      this._connected = true;
      const decoder = new TextDecoderStream();
      this._port.readable.pipeTo(decoder.writable).catch(() => {});
      this._reader = decoder.readable.getReader();
      this._writer = this._port.writable.getWriter();
      this._readLoop();
    }
    async _readLoop() {
      try {
        while (true) {
          const { value, done } = await this._reader.read();
          if (done) break;
          this._buf += value;
          let nl;
          while ((nl = this._buf.indexOf('\n')) >= 0) {
            const line = this._buf.slice(0, nl).trim();
            this._buf = this._buf.slice(nl + 1);
            if (!line) continue;
            try {
              const raw = JSON.parse(line);
              this._reading = normalize(raw);
              this._lastUpdate = Date.now();
            } catch (_) { /* ignore malformed lines */ }
          }
        }
      } catch (_) {
        this._connected = false;
      }
    }
    start() { /* connect() drives it */ }
    stop() {
      this._connected = false;
      try { this._reader && this._reader.cancel(); } catch (_) {}
      try { this._writer && this._writer.close(); } catch (_) {}
      try { this._port && this._port.close(); } catch (_) {}
    }
    getLatest() { return this._reading; }
    sendCommand(cmd) {
      if (!this._writer) return;
      const enc = new TextEncoder();
      this._writer.write(enc.encode(JSON.stringify(cmd) + '\n')).catch(() => {});
    }
    isConnected() { return this._connected && !this.isStale(); }
    isStale() {
      return this._connected
        && this._lastUpdate > 0
        && (Date.now() - this._lastUpdate) > this._staleAfter;
    }
  }

  root.HerbSources = { ScenarioSource, LiveMockSource, SerialSource, normalize };
})(window);
