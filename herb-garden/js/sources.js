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
 *   AdafruitIOSource - primary live channel. Polls io.adafruit.com REST
 *                      directly from the browser; credentials are entered
 *                      by the user in Settings and held in localStorage.
 *   LiveMockSource   - default fallback when AIO isn't configured.
 *   SerialSource     - optional USB debug channel.
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

  function safeIso(v) {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function normalize(raw) {
    const ts = safeIso(raw.timestamp);
    let timeValid = raw.time_valid;
    if (timeValid == null) timeValid = ts != null;
    return {
      timestamp: ts,
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
  // LiveMockSource — believable drift. Default fallback when AIO isn't set.
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
  // AdafruitIOSource — direct HTTP REST polling against io.adafruit.com.
  // The user enters their username and key in Settings; both are stored in
  // localStorage. This is the primary live channel.
  // -------------------------------------------------------------------------
  class AdafruitIOSource {
    constructor(config) {
      this.username = (config.username || '').trim();
      this.key = (config.key || '').trim();
      this.feeds = config.feeds || {};
      this._pollMs = config.pollIntervalMs || 10_000;     // 10 s default
      this._staleAfter = config.staleAfterMs || 30_000;   // 30 s = stale
      this._timer = null;
      this._reading = null;
      this._lastSyncTs = 0;
      this._lastError = null;
      this._connected = false;
      this._inFlight = false;
      this.sourceLabel = 'Adafruit IO';
      this.allowAutoWater = true;
    }
    isConfigured() {
      return Boolean(this.username && this.key);
    }
    _url(feedKey) {
      return `https://io.adafruit.com/api/v2/${encodeURIComponent(this.username)}` +
             `/feeds/${encodeURIComponent(feedKey)}/data/last`;
    }
    _cmdUrl(feedKey) {
      return `https://io.adafruit.com/api/v2/${encodeURIComponent(this.username)}` +
             `/feeds/${encodeURIComponent(feedKey)}/data`;
    }
    async _fetchLast(feedKey) {
      if (!feedKey) return null;
      try {
        const r = await fetch(this._url(feedKey), {
          headers: { 'X-AIO-Key': this.key, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (r.status === 404) return null;  // feed doesn't exist yet
        if (!r.ok) throw new Error(`AIO ${feedKey}: HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        this._lastError = e.message || String(e);
        return null;
      }
    }
    async _pollOnce() {
      if (this._inFlight) return;
      this._inFlight = true;
      try {
        const f = this.feeds;
        const [m, t, h, l, r, p] = await Promise.all([
          this._fetchLast(f.moisture),
          this._fetchLast(f.temperature),
          this._fetchLast(f.humidity),
          this._fetchLast(f.light),
          this._fetchLast(f.reservoir),
          this._fetchLast(f.pump_status),
        ]);
        if (!m && !t && !h && !l && !r && !p && !this._reading) {
          this._connected = false;
          return;
        }
        const latest = newest([m, t, h, l, r, p]);
        const pumpVal = p ? String(p.value) : null;
        const raw = {
          timestamp:       latest ? latest.created_at : null,
          time_valid:      latest != null,
          moisture_pct:    m ? m.value : null,
          temperature_c:   t ? t.value : null,
          humidity_pct:    h ? h.value : null,
          light_lux:       l ? l.value : null,
          reservoir_level: r ? r.value : null,
          pump_status:     pumpVal,
          pump_event:      pumpVal && /complete|done|ok/i.test(pumpVal) ? 'completed' : null,
        };
        this._reading = normalize(raw);
        this._lastSyncTs = Date.now();
        this._connected = true;
        this._lastError = null;
      } finally {
        this._inFlight = false;
      }
    }
    start() {
      if (!this.isConfigured()) {
        this._lastError = 'Adafruit IO username and key required';
        return;
      }
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
      const feed = this.feeds.water_command;
      if (!feed) throw new Error('water_command feed not configured');
      const value = `water:${cmd.duration_ms || 3000}`;
      let r;
      try {
        r = await fetch(this._cmdUrl(feed), {
          method: 'POST',
          headers: {
            'X-AIO-Key': this.key,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ value }),
        });
      } catch (e) {
        this._lastError = e.message || String(e);
        throw new Error(this._lastError);
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const msg = (body && body.error) || `AIO POST HTTP ${r.status}`;
        this._lastError = msg;
        throw new Error(msg);
      }
      this._lastError = null;
    }
    async publishSelectedHerb(plantId) {
      const feed = this.feeds.selected_herb;
      if (!feed || !this.isConfigured()) return;
      try {
        await fetch(this._cmdUrl(feed), {
          method: 'POST',
          headers: { 'X-AIO-Key': this.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: plantId }),
        });
      } catch (_) { /* best-effort */ }
    }
    isConnected() { return this._connected && !this.isStale(); }
    isStale() {
      return this._lastSyncTs > 0 && (Date.now() - this._lastSyncTs) > this._staleAfter;
    }
    lastSyncMs() { return this._lastSyncTs; }
    lastError()  { return this._lastError; }
  }

  function newest(items) {
    let best = null;
    for (const it of items) {
      if (!it || !it.created_at) continue;
      if (!best || it.created_at > best.created_at) best = it;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // SerialSource — optional USB debug channel. Same JSON-per-line schema.
  // -------------------------------------------------------------------------
  class SerialSource {
    constructor(staleAfterMs = 30_000) {
      this._port = null; this._reader = null; this._writer = null;
      this._buf = ''; this._reading = null;
      this._lastUpdate = 0; this._connected = false;
      this._staleAfter = staleAfterMs;
      this.sourceLabel = 'Serial (debug)';
      this.allowAutoWater = false;
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
    async publishSelectedHerb(_) { /* serial has no separate herb channel */ }
    isConnected() { return this._connected && !this.isStale(); }
    isStale() {
      return this._connected
        && this._lastUpdate > 0
        && (Date.now() - this._lastUpdate) > this._staleAfter;
    }
    lastSyncMs() { return this._lastUpdate; }
  }

  root.HerbSources = {
    LiveMockSource, SerialSource, AdafruitIOSource, normalize,
  };
})(window);
