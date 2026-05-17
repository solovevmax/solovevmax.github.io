/* Main app: controller logic (auto-water, alerts) + UI rendering. */
(function () {
  const { PLANTS, SCENARIOS, ILLUSTRATIONS, getPlant } = window.HerbPlants;
  const { computeHealth, bucket } = window.HerbHealth;
  const { ScenarioSource, LiveMockSource, SerialSource } = window.HerbSources;
  const S = window.HerbStorage;

  const $ = (sel) => document.querySelector(sel);

  // --- Static metric metadata used in rendering ----------------------------
  const METRICS = [
    { key: 'moisture_pct',    name: 'Soil moisture', unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z"/></svg>' },
    { key: 'temperature_c',   name: 'Temperature',   unit: '°C',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/></svg>' },
    { key: 'humidity_pct',    name: 'Humidity',      unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15a4 4 0 0 0 4 4 5 5 0 0 0 5-3 5 5 0 0 0 5 3 4 4 0 0 0 4-4c0-3-4-6-9-12-5 6-9 9-9 12z"/></svg>' },
    { key: 'ph',              name: 'pH',            unit: '',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>' },
    { key: 'light_lux',       name: 'Light',         unit: ' lx',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2"/></svg>' },
    { key: 'reservoir_level', name: 'Reservoir',     unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v6a7 7 0 0 1-14 0z"/><path d="M5 14h14"/></svg>' },
  ];

  // --- Controller state ----------------------------------------------------
  let settings = S.loadSettings();
  let plant = getPlant(settings.selected_plant);
  let scenarioId = S.loadScenario();        // 'live' | 'healthy' | 'dry' | 'low_reservoir'
  let source = null;
  let alertActive = { low_res: false, stale: false, off: false };

  function makeSource() {
    if (settings.data_source === 'serial' && SerialSource.isSupported()) {
      return new SerialSource(settings.stale_after_s * 1000);
    }
    if (scenarioId && scenarioId !== 'live' && SCENARIOS[scenarioId]) {
      const sc = { id: scenarioId, ...SCENARIOS[scenarioId] };
      return new ScenarioSource(sc);
    }
    return new LiveMockSource();
  }
  function rebuildSource() {
    if (source) source.stop();
    source = makeSource();
    source.start();
  }

  // Seed a believable history + last-watered time when switching to a fixed
  // scenario, so the History tab and "Last watered" tile reflect the demo.
  function primeScenario(id) {
    if (!SCENARIOS[id]) return;
    const sc = SCENARIOS[id];
    // Suppress edge-triggered duplicate of any alert we're about to seed
    alertActive = { low_res: false, stale: false, off: false };
    if (id === 'low_reservoir') alertActive.low_res = true;
    const now = Date.now();
    const lwTs = now - sc.last_watered_minutes_ago * 60_000;
    S.saveLastWaterTs(lwTs);
    const seeded = [];
    // Last watering event
    seeded.push({
      timestamp: new Date(lwTs).toISOString(),
      kind: 'watering',
      message: sc.last_watered_minutes_ago < 60
        ? 'Auto-watered (low moisture)'
        : 'Watered earlier today',
    });
    // A bit further back: a benign automated check (info)
    seeded.push({
      timestamp: new Date(now - sc.last_watered_minutes_ago * 60_000 - 3 * 3600_000).toISOString(),
      kind: 'watering',
      message: 'Auto-watered (low moisture)',
    });
    // Scenario-specific alerts
    if (id === 'low_reservoir') {
      seeded.push({
        timestamp: new Date(now - 90_000).toISOString(),
        kind: 'alert',
        message: 'Low reservoir (12%) — refill needed',
      });
    }
    if (id === 'dry') {
      seeded.push({
        timestamp: new Date(now - 5 * 60_000).toISOString(),
        kind: 'alert',
        message: 'Low moisture detected',
      });
    }
    seeded.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    S.setEvents(seeded);
  }
  rebuildSource();

  // --- Auto-water + alerts (runs every second) -----------------------------
  function tick() {
    const r = source.getLatest();
    const now = Date.now();
    const connected = source.isConnected();
    const stale = source.isStale ? source.isStale() : false;

    if (r) {
      // Low reservoir alert (edge-triggered)
      if (r.reservoir_level != null && r.reservoir_level < settings.low_reservoir_pct) {
        if (!alertActive.low_res) {
          S.addEvent('alert', `Low reservoir (${Math.round(r.reservoir_level)}%) — refill needed`);
          alertActive.low_res = true;
        }
      } else { alertActive.low_res = false; }

      // Auto-water — skipped for static preview scenarios so the demo state
      // stays stable. Manual "Water now" still works in all modes.
      const lastTs = S.loadLastWaterTs();
      const cooldownOk = (now - lastTs) > settings.watering_cooldown_s * 1000;
      const haveWater = r.reservoir_level == null || r.reservoir_level >= settings.low_reservoir_pct;
      if (source.allowAutoWater !== false
          && r.moisture_pct != null
          && r.moisture_pct < settings.moisture_threshold_pct
          && cooldownOk
          && haveWater) {
        triggerWatering(now, 'auto');
      }

      // Pump event echo (from real Arduino)
      if (r.pump_event === 'completed') {
        // De-dupe by timestamp
        const last = S.lastOf('watering');
        if (!last || last.timestamp !== r.timestamp) {
          S.addEvent('watering', 'Watering completed (device confirmed)');
        }
      }
    }

    // Stale/disconnected alerts (edge-triggered)
    if (stale && !alertActive.stale) {
      S.addEvent('alert', 'Stale sensor data: no recent updates');
      alertActive.stale = true;
    } else if (!stale) { alertActive.stale = false; }

    if (!connected && !alertActive.off) {
      S.addEvent('alert', 'Arduino disconnected');
      alertActive.off = true;
    } else if (connected) { alertActive.off = false; }

    render();
  }

  function triggerWatering(now, kind) {
    const duration = 3000;
    source.sendCommand({ cmd: 'water', duration_ms: duration });
    S.saveLastWaterTs(now);
    S.addEvent('watering',
      kind === 'manual' ? 'Watered manually' : 'Auto-watered (low moisture)',
      { duration_ms: duration });
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  // Gauge path geometry: half-circle, r=110, from (40,150) to (260,150).
  const GAUGE_LEN = Math.PI * 110; // ≈ 345.6

  function setGauge(score) {
    const fill = $('#gauge-fill');
    fill.style.strokeDasharray = String(GAUGE_LEN);
    const pct = Math.max(0, Math.min(100, score)) / 100;
    fill.style.strokeDashoffset = String(GAUGE_LEN * (1 - pct));
    let color = 'var(--good)';
    if (score < 70) color = 'var(--warn)';
    if (score < 40) color = 'var(--bad)';
    fill.style.stroke = color;
    $('#gauge-num').textContent = score;
  }

  function fmtAgo(iso) {
    if (!iso) return 'Never';
    const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60)    return `${Math.floor(secs)}s ago`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
         + ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function fmtVal(key, v) {
    if (v == null) return null;
    if (key === 'light_lux') return Math.round(v).toLocaleString();
    if (key === 'ph') return v.toFixed(2);
    return Number(v).toFixed(1);
  }

  // Render Home
  function renderHome(state) {
    $('#hero-art').innerHTML = ILLUSTRATIONS[plant.illustration];
    $('#hero-name').textContent = plant.common_name;
    $('#hero-sci').textContent = plant.scientific_name;

    setGauge(state.health.score);
    $('#gauge-exp').textContent = state.health.explanation;
    $('#hero-status').textContent = state.health.summary;
    $('#gauge-sub').textContent = subscoresHint(state.health.subscores);

    // Last watered
    const lw = state.lastWatered;
    const lwIso = lw ? lw.timestamp : (state.lastWaterTs ? new Date(state.lastWaterTs).toISOString() : null);
    $('#lw-value').textContent = lwIso ? fmtAgo(lwIso) : 'Never';
    $('#lw-sub').textContent = lwIso ? fmtTime(lwIso) : '';

    // Reservoir
    const res = state.reading ? state.reading.reservoir_level : null;
    const tileRes = $('#tile-reservoir');
    tileRes.classList.remove('warn', 'bad');
    if (res != null) {
      $('#res-value').textContent = Math.round(res) + '%';
      $('#res-bar-fill').style.width = Math.max(0, Math.min(100, res)) + '%';
      if (res < settings.low_reservoir_pct) tileRes.classList.add('bad');
      else if (res < settings.low_reservoir_pct + 15) tileRes.classList.add('warn');
    } else {
      $('#res-value').textContent = '—';
      $('#res-bar-fill').style.width = '0';
    }

    // Light tile
    const lux = state.reading ? state.reading.light_lux : null;
    const tileLight = $('#tile-light');
    tileLight.classList.remove('warn', 'bad');
    if (lux == null) {
      $('#light-value').textContent = '—';
      $('#light-sub').textContent = '';
    } else {
      $('#light-value').textContent = Math.round(lux).toLocaleString() + ' lx';
      let descr = 'Bright indirect';
      if (lux < 3000)       { descr = 'Too dim'; tileLight.classList.add('bad'); }
      else if (lux < 10000) { descr = 'Low light'; tileLight.classList.add('warn'); }
      else if (lux > 100000){ descr = 'Very intense'; tileLight.classList.add('warn'); }
      else if (lux > 50000) { descr = 'Bright sun'; }
      else                  { descr = 'Ideal for basil'; }
      $('#light-sub').textContent = descr;
    }

    // Key metrics (4 small chips, secondary)
    const keys = ['moisture_pct', 'temperature_c', 'humidity_pct', 'ph'];
    const r = state.reading || {};
    $('#key-metrics').innerHTML = keys.map(k => {
      const def = METRICS.find(m => m.key === k);
      const v = r[k];
      const b = bucket(plant, k, v);
      const cls = b === 'missing' ? '' : (b === 'good' ? '' : ' ' + b);
      const formatted = fmtVal(k, v);
      return `<div class="chip${cls}">
        <div class="icon">${def.icon}</div>
        <div class="ml">${def.name}</div>
        <div class="mv">${formatted == null ? '<span class="missing">—</span>' : formatted + def.unit}</div>
      </div>`;
    }).join('');
  }

  function subscoresHint(subs) {
    const entries = Object.entries(subs);
    if (entries.length === 0) return 'Awaiting sensor input';
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const [worstKey, worstVal] = sorted[0];
    if (worstVal >= 80) return 'All readings inside ideal ranges';
    const label = ({
      moisture_pct: 'moisture', temperature_c: 'temperature',
      humidity_pct: 'humidity', ph: 'pH', light_lux: 'light',
      reservoir: 'reservoir',
    })[worstKey] || worstKey;
    return `Bringing the score down: ${label}`;
  }

  // Live Data
  function renderLive(state) {
    const r = state.reading || {};
    $('#live-grid').innerHTML = METRICS.map(def => {
      const v = r[def.key];
      const formatted = fmtVal(def.key, v);
      let b;
      if (def.key === 'reservoir_level') {
        b = v == null ? 'missing'
          : (v < settings.low_reservoir_pct ? 'bad'
          : v < settings.low_reservoir_pct + 15 ? 'warn' : 'good');
      } else {
        b = bucket(plant, def.key, v);
      }
      const cls = b === 'missing' ? 'missing' : (b === 'good' ? '' : b);
      const rng = plant.ranges[def.key];
      const idealTxt = rng ? `Ideal ${rng.ideal[0]}–${rng.ideal[1]}${def.unit}` :
                       (def.key === 'reservoir_level' ? `Keep above ${settings.low_reservoir_pct}%` : '');
      // Indicator: position the marker along the chip's range bar
      let indicator = '';
      if (v != null && rng) {
        const span = rng.ok[1] - rng.ok[0];
        const pos = Math.max(0, Math.min(1, (v - rng.ok[0]) / span));
        indicator = `<div class="range-strip"><span class="indicator" style="left: calc(${pos * 100}% - 2px)"></span></div>`;
      } else if (v != null && def.key === 'reservoir_level') {
        indicator = `<div class="range-strip"><span class="indicator" style="left: calc(${Math.max(0, Math.min(100, v))}% - 2px)"></span></div>`;
      }
      return `<div class="metric-card ${cls}">
        <div class="top">
          <div class="icon">${def.icon}</div>
          <div class="name">${def.name}</div>
        </div>
        <div class="value">${formatted == null ? '— no data —' : formatted + '<span class="unit">' + def.unit + '</span>'}</div>
        ${indicator}
        <div class="target">${idealTxt}</div>
        <div class="ts">${r.timestamp ? 'Updated ' + fmtTime(r.timestamp) : ''}</div>
      </div>`;
    }).join('');
  }

  // History
  function renderHistory() {
    const water = S.loadEvents().filter(e => e.kind === 'watering').slice(-15).reverse();
    const alerts = S.loadEvents().filter(e => e.kind === 'alert').slice(-15).reverse();
    $('#hist-water').innerHTML = water.length
      ? water.map(eventRow).join('')
      : `<div class="empty">No watering events yet</div>`;
    $('#hist-alerts').innerHTML = alerts.length
      ? alerts.map(eventRow).join('')
      : `<div class="empty">No alerts</div>`;
    const all = S.loadEvents().slice(-30).reverse();
    $('#all-alerts').innerHTML = all.length
      ? all.map(eventRow).join('')
      : `<div class="empty">No alerts</div>`;
  }
  function eventRow(ev) {
    const icoCls = ev.kind === 'alert' ? 'alert' : (ev.kind === 'info' ? 'info' : '');
    const iconSvg = ev.kind === 'watering'
      ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';
    return `<div class="event">
      <div class="left">
        <div class="ico ${icoCls}">${iconSvg}</div>
        <div><div class="msg">${ev.message}</div><div class="when">${fmtTime(ev.timestamp)}</div></div>
      </div>
      <div class="when">${fmtAgo(ev.timestamp)}</div>
    </div>`;
  }

  // Plant profile
  function renderProfile() {
    $('#profile-art').innerHTML = ILLUSTRATIONS[plant.illustration];
    $('#prof-name').textContent = plant.common_name;
    $('#prof-sci').textContent = plant.scientific_name;
    $('#prof-notes').textContent = plant.notes;
    const rows = [
      `<div class="range-row head"><span>Metric</span><span>Ideal</span><span>OK range</span><span>Weight</span></div>`,
    ];
    const labels = {
      moisture_pct: ['Soil moisture', '%'], temperature_c: ['Temperature', '°C'],
      humidity_pct: ['Humidity', '%'], ph: ['pH', ''],
      light_lux: ['Light (BH1750)', ' lx'],
    };
    for (const [k, r] of Object.entries(plant.ranges)) {
      const [lbl, unit] = labels[k] || [k, ''];
      const w = (plant.weights[k] * 100).toFixed(0) + '%';
      rows.push(`<div class="range-row">
        <span class="rl">${lbl}</span>
        <span class="rv">${r.ideal[0]}–${r.ideal[1]}${unit}</span>
        <span class="rv">${r.ok[0]}–${r.ok[1]}${unit}</span>
        <span class="rw">${w}</span>
      </div>`);
    }
    rows.push(`<div class="range-row">
      <span class="rl">Reservoir</span>
      <span class="rv">≥ 30%</span>
      <span class="rv">≥ 0%</span>
      <span class="rw">${(plant.weights.reservoir * 100).toFixed(0)}%</span>
    </div>`);
    $('#ranges').innerHTML = rows.join('');
  }

  // Connection chip + demo banner
  function renderConn(state) {
    const chip = $('#conn-chip');
    const label = $('#conn-label');
    chip.classList.remove('ok', 'stale', 'off');
    const isDemo = !(source instanceof SerialSource);
    if (state.stale) {
      chip.classList.add('stale'); label.textContent = 'Stale data';
    } else if (state.connected) {
      chip.classList.add('ok');
      label.textContent = isDemo ? source.sourceLabel : 'Connected';
    } else {
      chip.classList.add('off'); label.textContent = 'Disconnected';
    }
    // Demo banner
    const banner = $('#demo-banner');
    const msg = $('#banner-msg');
    if (isDemo) {
      banner.classList.remove('hidden');
      if (scenarioId !== 'live' && SCENARIOS[scenarioId]) {
        msg.innerHTML = `<strong>${SCENARIOS[scenarioId].label}.</strong> ${SCENARIOS[scenarioId].banner}`;
      } else {
        msg.innerHTML = `Using simulated readings. Pick a <strong>Test</strong> scenario or set Data Source to <strong>Live serial</strong> in Settings.`;
      }
    } else {
      banner.classList.add('hidden');
    }
  }

  // Settings form binding
  function renderSettings() {
    $('#set-threshold').value = settings.moisture_threshold_pct;
    $('#set-cooldown').value = settings.watering_cooldown_s;
    $('#set-low-res').value = settings.low_reservoir_pct;
    $('#set-notifs').checked = settings.notifications_enabled;
    $('#sw-notifs').classList.toggle('on', settings.notifications_enabled);
    $('#set-source').value = settings.data_source;
    const supported = SerialSource.isSupported();
    const btn = $('#connect-serial');
    if (!supported) {
      btn.disabled = true; btn.textContent = 'Browser not supported';
      $('#serial-port-hint').textContent = 'Web Serial requires Chrome or Edge (over localhost or HTTPS).';
    } else if (source instanceof SerialSource && source.isConnected()) {
      btn.textContent = 'Connected';
      $('#serial-port-hint').textContent = 'Receiving data over USB serial.';
    } else {
      btn.disabled = false;
      btn.textContent = 'Connect Arduino';
      $('#serial-port-hint').textContent =
        settings.data_source === 'serial' ? 'Click Connect to choose a port.' : 'Not connected';
    }
  }

  // Master render
  function render() {
    const r = source.getLatest();
    const health = computeHealth(plant, r);
    const lastWatered = S.lastOf('watering');
    const state = {
      reading: r, health, lastWatered,
      lastWaterTs: S.loadLastWaterTs(),
      connected: source.isConnected(),
      stale: source.isStale ? source.isStale() : false,
    };
    renderHome(state);
    renderConn(state);
    if ($('#panel-live').classList.contains('active')) renderLive(state);
  }

  // ------------------------------------------------------------------------
  // Wiring: tabs, scenario picker, settings, water button
  // ------------------------------------------------------------------------
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.dataset.tab;
      $('#panel-' + t).classList.add('active');
      if (t === 'history' || t === 'alerts') renderHistory();
      if (t === 'profile') renderProfile();
      if (t === 'settings') renderSettings();
      if (t === 'live') render();
    });
  });

  // Scenario dropdown
  $('#scenario').value = scenarioId;
  $('#scenario').addEventListener('change', (e) => {
    scenarioId = e.target.value;
    S.saveScenario(scenarioId);
    if (scenarioId === 'live') {
      // Reset the watering history when leaving a scenario so live demo
      // starts from a clean state.
      S.clearEvents();
      S.saveLastWaterTs(0);
    } else {
      primeScenario(scenarioId);
    }
    if (settings.data_source !== 'serial') rebuildSource();
    renderHistory();
    render();
  });

  // Water now
  $('#water-btn').addEventListener('click', () => {
    triggerWatering(Date.now(), 'manual');
    render();
  });

  // Settings inputs
  function bindNumber(id, key) {
    $(id).addEventListener('change', (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      settings = S.saveSettings({ [key]: v });
    });
  }
  bindNumber('#set-threshold', 'moisture_threshold_pct');
  bindNumber('#set-cooldown',  'watering_cooldown_s');
  bindNumber('#set-low-res',   'low_reservoir_pct');
  $('#set-notifs').addEventListener('change', (e) => {
    settings = S.saveSettings({ notifications_enabled: e.target.checked });
    $('#sw-notifs').classList.toggle('on', e.target.checked);
  });
  $('#sw-notifs').addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const input = $('#set-notifs');
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change'));
  });

  $('#set-source').addEventListener('change', (e) => {
    settings = S.saveSettings({ data_source: e.target.value });
    rebuildSource();
    renderSettings();
  });

  $('#connect-serial').addEventListener('click', async () => {
    if (!SerialSource.isSupported()) return;
    try {
      if (settings.data_source !== 'serial') {
        settings = S.saveSettings({ data_source: 'serial' });
      }
      if (!(source instanceof SerialSource)) rebuildSource();
      await source.connect();
      S.addEvent('info', 'Arduino connected over USB serial');
      renderSettings();
      render();
    } catch (err) {
      $('#serial-port-hint').textContent = 'Connection cancelled or failed.';
    }
  });

  // First paint
  if (scenarioId !== 'live' && SCENARIOS[scenarioId]) primeScenario(scenarioId);
  renderSettings();
  renderProfile();
  renderHistory();
  render();
  setInterval(tick, 1000);
})();
