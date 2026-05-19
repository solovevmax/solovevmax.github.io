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
 *   { timestamp, time_valid, moisture_pct, temperature_c, humidity_pct,
 *     light_lux, reservoir_level, pump_event, pump_status }
 *
 * Source roles:
 *   BackendSource    - primary live channel. Talks to the local Flask
 *                      backend which owns the Adafruit IO key.
 *   LiveMockSource   - default fallback when the backend is unreachable.
 *   SerialSource     - optional USB debug channel. Same JSON-per-line
 *                      schema as before; the firmware exposes it on
 *                      usb_cdc.data.
 */
(function (root) {

  const LIMITS = {
    moisture_pct:    [0, 100],
    temperature_c:   [-20, 60],
    humidity_pct:    [0, 100],
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

  // Accept ISO 8601 with either "Z" or numeric offset. Anything that fails
  // to parse comes back as null so the UI can fall back to receipt time.
  function safeIso(v) {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function normalize(raw) {
    const ts = safeIso(raw.timestamp);
    // The firmware emits an explicit time_valid boolean over serial; over
    // AIO it's true whenever the backend reports a usable created_at.
    let timeValid = raw.time_valid;
    if (timeValid == null) timeValid = ts != null;
    return {
      timestamp: ts,                 // null = device clock not usable
      time_valid: !!timeValid,
      moisture_pct:    clean('moisture_pct',    raw.moisture_pct    ?? raw.moisture),
      temperature_c:   clean('temperature_c',   raw.temperature_c   ?? raw.temperature),
      humidity_pct:    clean('humidity_pct',    raw.humidity_pct    ?? raw.humidity),
      light_lux:       clean('light_lux',       raw.light_lux),
      reservoir_level: clean('reservoir_level', raw.reservoir_level),
      pump_event:      raw.pump_event ?? null,
      pump_status:     raw.pump_status ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // LiveMockSource — believable drift. Moisture trickles down so the auto-
  // water threshold actually fires. Used as a fallback when the backend
  // isn't running yet, and as the standalone Demo source.
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
        const lux   = Math.max(0, 24000 + 18000 * Math.sin(this._t / 90) + (Math.random() - 0.5) * 1500);
        this._reading = {
          timestamp: new Date().toISOString(),
          time_valid: true,
          moisture_pct: Math.round(this._moisture * 10) / 10,
          temperature_c: Math.round(temp * 10) / 10,
          humidity_pct: Math.round(hum * 10) / 10,
          light_lux: Math.round(lux),
          reservoir_level: Math.round(this._reservoir * 10) / 10,
          pump_event: pumpEvent,
          pump_status: pumpEvent === 'completed' ? 'completed' : 'idle',
        };
      };
      tick();
      this._timer = setInterval(tick, this._interval);
    }
    stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
    getLatest() { return this._reading; }
    sendCommand(cmd) { if (cmd && cmd.cmd === 'water') this._pendingPumpEvent = true; }
    async publishSelectedHerb(_) { /* mock no-op */ }
    isConnected() { return true; }
    isStale() { return false; }
    lastSyncMs() { return Date.now(); }
  }

  // -------------------------------------------------------------------------
  // BackendSource — primary live channel. Polls a local Flask backend that
  // owns the Adafruit IO key. The AIO key is NEVER exposed to this frontend.
  //
  // Endpoints used (served by herb-garden/backend/app.py):
  //   GET  /api/telemetry         -> latest reading from all AIO feeds
  //   POST /api/water             -> { duration_ms } => writes water:<ms>
  //   POST /api/selected-herb     -> { herb }        => writes herb id
  //   GET  /api/health            -> { configured, feeds }
  // -------------------------------------------------------------------------
  class BackendSource {
    constructor(config = {}) {
      this._baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
      this._pollMs = config.pollIntervalMs || 10_000;     // 10 s default
      this._staleAfter = config.staleAfterMs || 30_000;   // 30 s = stale
      this._timer = null;
      this._reading = null;
      this._lastSyncTs = 0;
      this._lastError = null;
      this._configured = null;
      this._connected = false;
      this._inFlight = false;
      this.sourceLabel = 'Adafruit IO (via backend)';
      this.allowAutoWater = true;
    }

    _url(path) { return this._baseUrl + path; }

    async _pollOnce() {
      if (this._inFlight) return;
      this._inFlight = true;
      try {
        const r = await fetch(this._url('/api/telemetry'), {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store',
        });
        // 503 = backend running but missing AIO credentials.
        if (r.status === 503) {
          const body = await r.json().catch(() => ({}));
          this._configured = false;
          this._lastError = body.error || 'Backend missing AIO credentials';
          this._connected = false;
          return;
        }
        if (!r.ok) {
          this._lastError = `Backend HTTP ${r.status}`;
          this._connected = false;
          return;
        }
        const data = await r.json();
        this._configured = data.configured !== false;
        this._reading = normalize({
          timestamp:       data.timestamp,
          time_valid:      data.time_valid,
          moisture_pct:    data.moisture_pct,
          temperature_c:   data.temperature_c,
          humidity_pct:    data.humidity_pct,
          light_lux:       data.light_lux,
          reservoir_level: data.reservoir_level,
          pump_status:     data.pump_status,
          // Translate the firmware's pump_status string into the
          // pump_event the rest of the app's UI already understands.
          pump_event: typeof data.pump_status === 'string' &&
                      /complete|done|ok/i.test(data.pump_status)
                      ? 'completed' : null,
        });
        this._lastSyncTs = Date.now();
        this._connected = true;
        this._lastError = (data.feed_errors && Object.keys(data.feed_errors).length)
          ? `Feed errors: ${Object.keys(data.feed_errors).join(', ')}`
          : null;
      } catch (e) {
        // Backend not running, network error, CORS, etc.
        this._lastError = e.message || String(e);
        this._connected = false;
      } finally {
        this._inFlight = false;
      }
    }

    start() {
      if (this._timer) return;
      this._pollOnce();
      this._timer = setInterval(() => this._pollOnce(), this._pollMs);
    }
    stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this._connected = false;
    }
    getLatest() { return this._reading; }

    async sendCommand(cmd) {
      if (!cmd || cmd.cmd !== 'water') return;
      // Throw on failure so the UI can show a clear error. The caller is
      // responsible for catching; a fire-and-forget caller can attach
      // .catch(...). Single POST per call — no retries here.
      let r;
      try {
        r = await fetch(this._url('/api/water'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration_ms: cmd.duration_ms || 3000 }),
        });
      } catch (e) {
        this._lastError = e.message || String(e);
        throw new Error(this._lastError);
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const msg = body.error || `Water POST HTTP ${r.status}`;
        this._lastError = msg;
        throw new Error(msg);
      }
      this._lastError = null;
    }

    async publishSelectedHerb(herb) {
      if (!herb) return;
      try {
        await fetch(this._url('/api/selected-herb'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ herb }),
        });
      } catch (_) { /* best-effort */ }
    }

    isConnected() { return this._connected && !this.isStale(); }
    isStale() {
      return this._lastSyncTs > 0 && (Date.now() - this._lastSyncTs) > this._staleAfter;
    }
    lastSyncMs() { return this._lastSyncTs; }
    lastError()  { return this._lastError; }
    isConfigured() { return this._configured !== false; }
  }

  // -------------------------------------------------------------------------
  // SerialSource — optional USB debug channel. Reads JSON-per-line frames
  // from the firmware's usb_cdc.data port; writes commands as JSON+newline.
  // Stub if the Web Serial API isn't available.
  // -------------------------------------------------------------------------
  class SerialSource {
    constructor(staleAfterMs = 30_000) {
      this._port = null; this._reader = null; this._writer = null;
      this._buf = ''; this._reading = null;
      this._lastUpdate = 0; this._connected = false;
      this._staleAfter = staleAfterMs;
      this.sourceLabel = 'Serial (debug)';
      this.allowAutoWater = false;   // debug channel — let the cloud drive
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
    async publishSelectedHerb(_) { /* serial: no separate selected-herb channel */ }
    isConnected() { return this._connected && !this.isStale(); }
    isStale() {
      return this._connected
        && this._lastUpdate > 0
        && (Date.now() - this._lastUpdate) > this._staleAfter;
    }
    lastSyncMs() { return this._lastUpdate; }
  }

  root.HerbSources = {
    LiveMockSource, SerialSource, BackendSource, normalize,
  };
})(window);
