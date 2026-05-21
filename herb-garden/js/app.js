/* Sprout and Spoon — main app:
 * - Live-mode controller (auto-water, alerts). The primary live channel is
 *   Adafruit IO REST (AdafruitIOSource) polled directly from the browser
 *   with credentials the user enters in Settings. Demo mock and USB serial
 *   are the fallback / debug options.
 * - UI rendering for Home, Live, History, Plant Profile, Settings, Alerts,
 *   Recipes, and the Shopping List sub-view.
 * - Day/night grow cycle (js/cycle.js) shifts plant targets and auto-water
 *   parameters based on local time, and swaps the UI into a dark theme at
 *   night.
 * - Multi-herb gating: only Basil triggers live actions (auto-water, pump
 *   commands, event log). Other herbs are info-only reference profiles.
 */
(function () {
  const { PLANTS, ILLUSTRATIONS, getPlant, listPlants } = window.HerbPlants;
  const { computeHealth, bucket } = window.HerbHealth;
  const { LiveMockSource, SerialSource, AdafruitIOSource } = window.HerbSources;
  const { RECIPES, recipeOfTheDay, growthStage } = window.SproutRecipes;
  const { currentSeason, herbSuitability } = window.SproutSeasonality;
  const Cycle = window.SproutCycle;
  const S = window.HerbStorage;

  const $ = (sel) => document.querySelector(sel);

  // --- Static metric metadata used in rendering ----------------------------
  // `description` is shown as helper copy on each metric card in the Live
  // data tab. The tone is deliberately statement-style: it tells the user
  // how the value is produced, not how to read the number.
  const METRICS = [
    { key: 'moisture_pct',    name: 'Soil moisture', unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z"/></svg>',
      description: 'Soil moisture is sampled as a raw analog voltage from the capacitive probe, mapped onto a 0–100% scale between the dry-air and fully-wet calibration points, and averaged across the most recent samples. The figure is relative to this setup, not a lab-grade soil-water-content measurement.' },
    { key: 'temperature_c',   name: 'Temperature',   unit: '°C',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/></svg>',
      description: 'Temperature is read directly from the DHT sensor in degrees Celsius and reported as the latest ambient air measurement next to the plant.' },
    { key: 'humidity_pct',    name: 'Humidity',      unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15a4 4 0 0 0 4 4 5 5 0 0 0 5-3 5 5 0 0 0 5 3 4 4 0 0 0 4-4c0-3-4-6-9-12-5 6-9 9-9 12z"/></svg>',
      description: 'Humidity is reported by the DHT sensor as relative humidity — the ratio of water vapour in the air to the saturation point at the current temperature, expressed as a percentage and averaged across recent samples.' },
    { key: 'light_lux',       name: 'Light',         unit: ' lx',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2"/></svg>',
      description: 'Light is reported by the BH1750 directly in lux. The dim / medium / bright label is applied here in the app as a friendlier readout — the underlying value is the raw sensor measurement, not a rescaled estimate.' },
    { key: 'reservoir_level', name: 'Reservoir',     unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v6a7 7 0 0 1-14 0z"/><path d="M5 14h14"/></svg>',
      description: 'Reservoir level is read from the analog probe and converted to a 0–100% fill scale with the firmware\'s corrected mapping: 0% is empty, 100% is full.' },
  ];

  // Map a lux reading to the user-facing interpretation label.
  // dim < 100, medium 100–499, bright ≥ 500. The BH1750 reports lux
  // directly; this is a labelling layer, not a recalibration.
  function interpretLux(lux) {
    if (lux == null || !Number.isFinite(lux)) return null;
    if (lux < 100)  return 'dim';
    if (lux < 500)  return 'medium';
    return 'bright';
  }

  // Human-readable explanation of the firmware-side pump status string.
  // Mirrors the state machine in the CircuitPython firmware so the UI
  // stays in sync without firmware changes.
  function pumpStatusExplain(status) {
    switch ((status || '').toLowerCase()) {
      case 'idle':      return 'pump is currently off';
      case 'running':   return 'pump is on right now';
      case 'completed': return 'last watering finished';
      case 'blocked':   return 'firmware safety blocked this — usually low reservoir or cooldown is still active';
      case 'error':     return 'pump hardware reported an error';
      default:          return 'no status reported yet';
    }
  }

  // --- Live mode controller state ------------------------------------------
  let settings = S.loadSettings();
  let plant = getPlant(settings.selected_plant);
  let source = null;
  let alertActive = { low_res: false, stale: false, off: false };

  // Day/night grow cycle state. Recomputed once a minute. _activePlant
  // is the plant object with cycle-adjusted ranges, _activeSettings has
  // cycle-adjusted auto-water parameters. Live code paths use these
  // instead of the canonical `plant` / `settings`.
  let _activeCycle    = Cycle.currentCycle();
  let _activePlant    = { ...plant, ranges: Cycle.adjustedRanges(plant, _activeCycle) };
  let _activeSettings = Cycle.adjustedWateringParams(settings, _activeCycle);

  function refreshCycle() {
    _activeCycle = Cycle.currentCycle();
    _activePlant = { ...plant, ranges: Cycle.adjustedRanges(plant, _activeCycle) };
    _activeSettings = Cycle.adjustedWateringParams(settings, _activeCycle);
    document.body.classList.toggle('night-mode', _activeCycle === 'night');
  }
  refreshCycle();
  // Re-evaluate the cycle every minute so the UI flips to/from night mode
  // and the live targets shift without a page reload.
  setInterval(refreshCycle, 60_000);

  function makeSource() {
    try {
      if (settings.data_source === 'serial' && SerialSource.isSupported()) {
        return new SerialSource(settings.stale_after_s * 1000);
      }
      if (settings.data_source === 'adafruit') {
        const src = new AdafruitIOSource({
          username: settings.aio_username,
          key:      settings.aio_key,
          feeds:    settings.aio_feeds,
          pollIntervalMs: (settings.aio_poll_interval_s || 10) * 1000,
          staleAfterMs:   (settings.stale_after_s        || 30) * 1000,
        });
        if (!src.isConfigured()) {
          // No credentials yet — show mock data so the UI isn't blank.
          return new LiveMockSource();
        }
        return src;
      }
      return new LiveMockSource();
    } catch (e) {
      // Any source construction failure → graceful demo fallback.
      try { S.addEvent('alert', 'Data source failed to start: ' + (e.message || e)); } catch (_) {}
    }
    return new LiveMockSource();
  }
  function rebuildSource() {
    if (source) source.stop();
    source = makeSource();
    source.start();
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

      // Auto-water — only runs for the live-wired herb (basil) and never
      // for reference-only herbs (parsley/thyme/mint). Threshold and
      // cooldown shift with the day/night cycle (see js/cycle.js).
      const lastTs = S.loadLastWaterTs();
      const cooldownOk = (now - lastTs) > _activeSettings.watering_cooldown_s * 1000;
      const haveWater = r.reservoir_level == null || r.reservoir_level >= settings.low_reservoir_pct;
      const liveWired = plant.live === true;
      if (liveWired
          && source.allowAutoWater !== false
          && r.moisture_pct != null
          && r.moisture_pct < _activeSettings.moisture_threshold_pct
          && cooldownOk
          && haveWater) {
        // Fire-and-forget; the in-flight lock inside triggerWatering
        // prevents overlap with manual presses. Errors are surfaced via
        // the event log so we don't crash the tick loop.
        triggerWatering(now, 'auto').catch(e => {
          S.addEvent('alert', `Auto-water failed: ${e.message || e}`);
        });
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

  // Single-flight lock on water commands. Prevents a second POST from
  // being issued before the first one has settled — covers double-clicks
  // on the Water now button, parallel auto-water ticks, and stray
  // re-bound event listeners. The firmware also deduplicates on its end,
  // so the lock is defence in depth.
  let _waterInFlight = false;

  async function triggerWatering(now, kind) {
    if (!plant.live) {
      S.addEvent('info', `Watering disabled for ${plant.common_name}. Switch to Basil to trigger the pump.`);
      return { skipped: 'not-live' };
    }
    if (_waterInFlight) return { skipped: 'in-flight' };
    _waterInFlight = true;
    const duration = 3000;
    try {
      await source.sendCommand({ cmd: 'water', duration_ms: duration });
      S.saveLastWaterTs(now);
      S.addEvent('watering',
        kind === 'manual' ? 'Watered manually' : 'Auto-watered (low moisture)',
        { duration_ms: duration });
      return { ok: true };
    } finally {
      _waterInFlight = false;
    }
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  // Gauge path geometry: half-circle, r=110, from (40,150) to (260,150).
  const GAUGE_LEN = Math.PI * 110; // ≈ 345.6

  function setGauge(fillSel, numSel, score) {
    const fill = $(fillSel);
    fill.style.strokeDasharray = String(GAUGE_LEN);
    const pct = Math.max(0, Math.min(100, score)) / 100;
    fill.style.strokeDashoffset = String(GAUGE_LEN * (1 - pct));
    let color = 'var(--good)';
    if (score < 70) color = 'var(--warn)';
    if (score < 40) color = 'var(--bad)';
    fill.style.stroke = color;
    $(numSel).textContent = score;
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
    return Number(v).toFixed(1);
  }

  // Render Home
  function renderHome(state) {
    $('#hero-art').innerHTML = ILLUSTRATIONS[plant.illustration];
    $('#hero-name').textContent = plant.common_name;
    $('#hero-sci').textContent = plant.scientific_name;

    setGauge('#gauge-fill', '#gauge-num', state.health.score);
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

    // Light tile — show the raw lux value plus the dim/medium/bright
    // interpretation. The BH1750 reports lux directly; the label is just
    // a friendlier readout (full explanation lives on the Live data tab).
    const lux = state.reading ? state.reading.light_lux : null;
    const tileLight = $('#tile-light');
    tileLight.classList.remove('warn', 'bad', 'ps-dim', 'ps-medium', 'ps-bright');
    if (lux == null) {
      $('#light-value').textContent = '—';
      $('#light-sub').textContent = '';
    } else {
      $('#light-value').textContent = Math.round(lux).toLocaleString() + ' lx';
      const label = interpretLux(lux);
      if (label === 'dim')    tileLight.classList.add('bad');
      if (label === 'medium') tileLight.classList.add('warn');
      $('#light-sub').textContent = label || '—';
    }

    // Pump status line — surface the firmware's current pump state plus
    // an explanation. Hidden for non-live herbs since the pump only
    // applies to the wired (basil) plant.
    const psWrap = $('#pump-status-line');
    if (psWrap) {
      if (!plant.live) {
        psWrap.hidden = true;
      } else {
        psWrap.hidden = false;
        const ps = (state.reading && state.reading.pump_status) || 'idle';
        const explain = pumpStatusExplain(ps);
        $('#pump-status-value').textContent = ps;
        $('#pump-status-value').className = 'ps-' + (ps || '').toLowerCase();
        $('#pump-status-explain').textContent = ' — ' + explain;
      }
    }

    // Key metrics (small chips, secondary)
    const keys = ['moisture_pct', 'temperature_c', 'humidity_pct', 'light_lux'];
    const r = state.reading || {};
    $('#key-metrics').innerHTML = keys.map(k => {
      const def = METRICS.find(m => m.key === k);
      const v = r[k];
      // Use the cycle-adjusted plant so the colour buckets honour the
      // current day/night targets (low light is "good" at night).
      const b = bucket(_activePlant, k, v);
      const cls = b === 'missing' ? '' : (b === 'good' ? '' : ' ' + b);
      const formatted = fmtVal(k, v);
      return `<div class="chip${cls}">
        <div class="icon">${def.icon}</div>
        <div class="ml">${def.name}</div>
        <div class="mv">${formatted == null ? '<span class="missing">—</span>' : formatted + def.unit}</div>
      </div>`;
    }).join('');

    // Demo-profile note for non-basil reference herbs.
    const demoNote = $('#demo-profile-note');
    if (demoNote) demoNote.hidden = !!plant.live;

    // Disable Water now for non-live herbs (since the pump isn't wired to them).
    const waterBtn = $('#water-btn');
    if (waterBtn) {
      waterBtn.disabled = !plant.live;
      waterBtn.title = plant.live ? '' : `Switch to Basil in Settings to water the live garden.`;
    }

    // Cycle banner — local time + day/night icon + active targets.
    renderCycleBanner();

    // Harvest-ready badge: only when the user marked this herb as
    // "shop-bought / mature" in Settings. Otherwise it stays hidden.
    const harvestBadge = $('#harvest-badge');
    if (harvestBadge) {
      const ps = S.ensurePlantSource(plant.id);
      harvestBadge.hidden = ps !== 'mature';
    }
  }

  // Render the day/night cycle banner on Home: clock, icon, mode label
  // and a short summary of the active targets. Called from renderHome and
  // also on a 1 s clock tick so the time stays current without redrawing
  // the whole panel.
  function renderCycleBanner() {
    const banner = $('#cycle-banner');
    if (!banner) return;
    const now = new Date();
    const bucket = Cycle.timeOfDayBucket(now);
    banner.dataset.cycle = _activeCycle;     // 'day' | 'night' — used by CSS
    banner.dataset.bucket = bucket;
    $('#cycle-icon').innerHTML = Cycle.ICONS[bucket] || Cycle.ICONS.midday;
    $('#cycle-time').textContent = Cycle.timeOfDayLabel(now);
    $('#cycle-mode').textContent = Cycle.bucketLabel(bucket);
    $('#cycle-targets').textContent = Cycle.targetsSummary(plant, _activeCycle);
  }

  function subscoresHint(subs) {
    const entries = Object.entries(subs);
    if (entries.length === 0) return 'Awaiting sensor input';
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const [worstKey, worstVal] = sorted[0];
    if (worstVal >= 80) return 'All readings inside ideal ranges';
    const label = ({
      moisture_pct: 'moisture', temperature_c: 'temperature',
      humidity_pct: 'humidity', light_lux: 'light',
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
        // _activePlant.ranges = cycle-adjusted targets (night drops light/temp).
        b = bucket(_activePlant, def.key, v);
      }
      const cls = b === 'missing' ? 'missing' : (b === 'good' ? '' : b);
      const rng = _activePlant.ranges[def.key];
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
      // Light gets the live dim/medium/bright interpretation too.
      let luxLabel = '';
      if (def.key === 'light_lux') {
        const lbl = interpretLux(v);
        if (lbl) luxLabel = `<div class="metric-tag ml-${lbl}">${lbl}</div>`;
      }
      const descTxt = def.description
        ? `<p class="metric-description">${def.description}</p>` : '';
      return `<div class="metric-card ${cls}">
        <div class="top">
          <div class="icon">${def.icon}</div>
          <div class="name">${def.name}</div>
          ${luxLabel}
        </div>
        <div class="value">${formatted == null ? '— no data —' : formatted + '<span class="unit">' + def.unit + '</span>'}</div>
        ${indicator}
        <div class="target">${idealTxt}</div>
        <div class="ts">${r.timestamp ? 'Updated ' + fmtTime(r.timestamp) : ''}</div>
        ${descTxt}
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

  // Plant profile — herb picker + hero + info cards + ranges + seasonality.
  function renderProfile() {
    renderHerbPicker();
    $('#profile-art').innerHTML = ILLUSTRATIONS[plant.illustration];
    $('#prof-name').textContent = plant.common_name;
    $('#prof-sci').textContent = plant.scientific_name;
    $('#prof-notes').textContent = plant.notes;

    // Live badge
    const liveBadge = $('#prof-live-badge');
    if (liveBadge) {
      if (plant.live) {
        liveBadge.className = 'live-badge';
        liveBadge.textContent = 'Live wired to garden';
      } else {
        liveBadge.className = 'live-badge demo';
        liveBadge.textContent = 'Demo / reference profile';
      }
    }

    // Info cards
    const ICON = {
      moisture:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z"/></svg>',
      light:          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2"/></svg>',
      temperature:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/></svg>',
      grow_time:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      harvest_timing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l8 4 8-4"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/></svg>',
      care_notes:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M21 12v6a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h11"/></svg>',
    };
    const infoOrder = [
      ['moisture',       'Ideal moisture'],
      ['light',          'Ideal light'],
      ['temperature',    'Ideal temperature'],
      ['grow_time',      'Grow time'],
      ['harvest_timing', 'Harvest timing'],
      ['care_notes',     'Care notes'],
    ];
    const info = plant.info || {};
    $('#info-cards').innerHTML = infoOrder.map(([key, label]) =>
      `<div class="info-card">
        <div class="ic-label"><span class="ic-icon">${ICON[key]}</span>${label}</div>
        <div class="ic-value">${info[key] || '—'}</div>
      </div>`
    ).join('');

    // Ideal-ranges table (existing)
    const rows = [
      `<div class="range-row head"><span>Metric</span><span>Ideal</span><span>OK range</span><span>Weight</span></div>`,
    ];
    const labels = {
      moisture_pct: ['Soil moisture', '%'], temperature_c: ['Temperature', '°C'],
      humidity_pct: ['Humidity', '%'],
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

    renderSeasonality();
  }

  function renderHerbPicker() {
    const picker = $('#herb-picker');
    if (!picker) return;
    const all = listPlants();
    picker.innerHTML = all.map(p =>
      `<button class="herb-pick${p.id === plant.id ? ' active' : ''}${p.live ? ' live' : ''}"
               data-plant="${p.id}" type="button">
         <span class="herb-dot"></span>
         <span>${p.common_name}</span>
       </button>`
    ).join('');
    picker.querySelectorAll('.herb-pick').forEach(btn => {
      btn.addEventListener('click', () => switchPlant(btn.dataset.plant));
    });
  }

  function renderSeasonality() {
    const season = currentSeason();
    $('#season-headline').textContent = `Right now in the UK: ${season}`;
    const list = herbSuitability(season);
    $('#season-grid').innerHTML = list.map(item => {
      const name = PLANTS[item.id]?.common_name || item.id;
      const initial = name.charAt(0);
      return `<div class="season-row tier-${item.tier}">
        <span class="leaf">${initial}</span>
        <div>
          <div class="s-name">${name} <span style="color:var(--muted);font-weight:500;font-size:12px">· ${item.tier}</span></div>
          <div class="s-tip">${item.tip}</div>
        </div>
        <div class="s-grow">${item.grow_hint}</div>
      </div>`;
    }).join('');
  }

  function switchPlant(plantId) {
    if (!PLANTS[plantId] || plantId === plant.id) return;
    settings = S.saveSettings({ selected_plant: plantId });
    plant = getPlant(plantId);
    S.ensurePlantedDate(plantId);
    S.ensurePlantSource(plantId);
    // Best-effort: tell the device (via the backend) which herb is now
    // selected. The backend translates this into an AIO feed write.
    if (source && typeof source.publishSelectedHerb === 'function') {
      source.publishSelectedHerb(plantId);
    }
    renderHerbPicker();
    render();
    renderProfile();
    renderRecipes();
    renderSettings();
  }

  // Connection chip + demo banner. Labels reflect the active source:
  //   Connected (Adafruit IO) / Connected (Serial) / Demo (mock) /
  //   Stale data / Disconnected. When the user has picked Adafruit IO
  //   but hasn't entered credentials yet the source falls back to mock,
  //   so the chip reads "Demo (mock)" until the creds are saved.
  function renderConn(state) {
    const chip = $('#conn-chip');
    const label = $('#conn-label');
    const sync  = $('#conn-sync');
    chip.classList.remove('ok', 'stale', 'off');

    const isAio    = source instanceof AdafruitIOSource;
    const isSerial = source instanceof SerialSource;

    let labelText;
    if (isSerial)   labelText = 'Connected (Serial)';
    else if (isAio) labelText = 'Connected (Adafruit IO)';
    else            labelText = 'Demo (mock)';

    if (state.stale) {
      chip.classList.add('stale'); label.textContent = 'Stale data';
    } else if (state.connected) {
      chip.classList.add('ok');
      label.textContent = labelText;
    } else {
      chip.classList.add('off');
      label.textContent = isAio ? 'AIO not connected' : 'Disconnected';
    }

    // Last-sync subtext. Prefer the device timestamp when it's valid,
    // otherwise fall back to receipt time so the chip is never empty.
    if (sync) {
      const ms = (source.lastSyncMs && source.lastSyncMs()) || 0;
      if (state.reading && state.reading.time_valid && state.reading.timestamp) {
        sync.textContent = `Device · ${fmtAgo(state.reading.timestamp)}`;
      } else if (ms) {
        sync.textContent = `Received · ${fmtAgo(new Date(ms).toISOString())}`;
      } else {
        sync.textContent = '';
      }
    }

    // Demo banner only shows on live tabs while running on mock data.
    const banner = $('#demo-banner');
    const isMock = !(isSerial || isAio);
    if (isMock) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }

  // Settings form binding
  function renderSettings() {
    $('#set-threshold').value = settings.moisture_threshold_pct;
    $('#set-cooldown').value = settings.watering_cooldown_s;
    $('#set-low-res').value = settings.low_reservoir_pct;
    $('#set-notifs').checked = settings.notifications_enabled;
    $('#sw-notifs').classList.toggle('on', settings.notifications_enabled);
    $('#set-source').value = settings.data_source;

    // Serial group: visible when source = serial
    const serialRow = $('#serial-status-row');
    if (serialRow) serialRow.hidden = settings.data_source !== 'serial';
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

    // Adafruit IO group: visible when source = adafruit
    const aioCfg = $('#aio-config');
    if (aioCfg) aioCfg.hidden = settings.data_source !== 'adafruit';
    $('#aio-username').value = settings.aio_username || '';
    $('#aio-key').value      = settings.aio_key      || '';
    $('#aio-poll').value     = settings.aio_poll_interval_s || 10;
    const f = settings.aio_feeds || {};
    $('#aio-feed-moisture').value    = f.moisture      || '';
    $('#aio-feed-temperature').value = f.temperature   || '';
    $('#aio-feed-humidity').value    = f.humidity      || '';
    $('#aio-feed-light').value       = f.light         || '';
    $('#aio-feed-reservoir').value   = f.reservoir     || '';
    $('#aio-feed-pump').value        = f.pump_status   || '';
    $('#aio-feed-cmd').value         = f.water_command || '';
    $('#aio-feed-herb').value        = f.selected_herb || '';
    const aioHint = $('#aio-status-hint');
    if (aioHint) {
      aioHint.className = 'hint';
      if (source instanceof AdafruitIOSource) {
        if (source.isConnected()) {
          const t = source.lastSyncMs && source.lastSyncMs();
          aioHint.classList.add('aio-status-ok');
          aioHint.textContent = t
            ? `Connected — last sync ${fmtAgo(new Date(t).toISOString())}`
            : 'Connected';
        } else {
          aioHint.classList.add('aio-status-error');
          aioHint.textContent = source.lastError
            ? `Not connected: ${source.lastError() || 'unknown error'}`
            : 'Waiting for first sync…';
        }
      } else if (settings.data_source === 'adafruit') {
        aioHint.textContent = 'Enter your username + key, then Save and Test.';
      } else {
        aioHint.textContent = 'Switch source to Adafruit IO to enable.';
      }
    }

    // Garden: herb dropdown + planted date
    const plantSel = $('#set-plant');
    if (plantSel) {
      plantSel.innerHTML = listPlants().map(p =>
        `<option value="${p.id}"${p.id === settings.selected_plant ? ' selected' : ''}>${p.common_name}${p.live ? ' · live' : ''}</option>`
      ).join('');
    }
    const planted = S.ensurePlantedDate(settings.selected_plant);
    $('#set-planted-date').value = planted;

    // Plant source toggle (From seed / Shop-bought · mature)
    const plantSource = S.ensurePlantSource(settings.selected_plant);
    document.querySelectorAll('#plant-source-toggle .ps-opt').forEach(opt => {
      const active = opt.dataset.value === plantSource;
      opt.classList.toggle('active', active);
      opt.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    const liveStr = plant.live ? 'Live wired to garden' : 'Demo / reference profile';
    $('#planted-hint').textContent = `Used by Recipes for growth tracking · ${liveStr}`;
    $('#planted-date-label').textContent =
      plantSource === 'mature' ? 'Date acquired' : 'Planted date';
    $('#plant-source-hint').textContent = plantSource === 'mature'
      ? 'Treated as mature — harvest-ready from day one.'
      : 'Counted from sowing — uses the herb\'s grow-time thresholds.';
  }

  // Master render
  function render() {
    const r = source.getLatest();
    // Health scoring uses the cycle-adjusted plant so night-time low light
    // doesn't drag the score down.
    const health = computeHealth(_activePlant, r);
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
  // Wiring: tabs, settings, water button
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
      if (t === 'recipes') renderRecipes();
      if (t === 'demo')    renderDemo();
      // Shopping is a sub-view of Recipes; never reached via tab.
      // Re-render conn so the demo banner shows/hides per tab
      const r = source.getLatest();
      renderConn({
        connected: source.isConnected(),
        stale: source.isStale ? source.isStale() : false,
        reading: r,
      });
    });
  });

  // Water now
  // Water now — single command per click, lockout while in flight, then a
  // brief cool-down to absorb double-clicks even after the POST returns.
  // Feedback is announced via aria-live so screen readers pick it up.
  let _waterFeedbackTimer = null;
  function setWaterFeedback(text, level /* 'info' | 'ok' | 'error' */) {
    const fb = $('#water-feedback');
    if (!fb) return;
    fb.classList.remove('info', 'ok', 'error');
    if (level) fb.classList.add(level);
    fb.textContent = text || '';
    if (_waterFeedbackTimer) { clearTimeout(_waterFeedbackTimer); _waterFeedbackTimer = null; }
    if (level === 'ok' || level === 'error') {
      _waterFeedbackTimer = setTimeout(() => {
        // Don't clobber a later message that overwrote ours.
        if (fb.textContent === text) setWaterFeedback('', null);
      }, 5000);
    }
  }

  $('#water-btn').addEventListener('click', async () => {
    if (_waterInFlight) return;       // belt
    const btn = $('#water-btn');
    if (btn.disabled) return;          // braces
    btn.disabled = true;
    setWaterFeedback('Sending water:3000 to the device…', 'info');
    let result;
    try {
      result = await triggerWatering(Date.now(), 'manual');
    } catch (e) {
      setWaterFeedback(`Couldn't send the water command: ${e.message || e}`, 'error');
    }
    if (result && result.ok) {
      setWaterFeedback('Watering command sent (water:3000).', 'ok');
    } else if (result && result.skipped === 'in-flight') {
      setWaterFeedback('Already sending… please wait a moment.', 'info');
    } else if (result && result.skipped === 'not-live') {
      setWaterFeedback('Watering is disabled for this herb. Switch to Basil in Settings.', 'info');
    }
    // Small cool-down to swallow rapid double-clicks even after the POST
    // returns. Then re-enable based on the active herb's live status.
    setTimeout(() => {
      btn.disabled = !plant.live;
      render();
    }, 1200);
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

  // Adafruit IO credential + feed bindings. Username and key are held in
  // localStorage only — no cloud sync, never leaves the browser.
  function bindAioField(id, key) {
    $(id).addEventListener('change', (e) => {
      settings = S.saveSettings({ [key]: e.target.value.trim() });
      if (settings.data_source === 'adafruit') rebuildSource();
    });
  }
  bindAioField('#aio-username', 'aio_username');
  bindAioField('#aio-key',      'aio_key');

  $('#aio-poll').addEventListener('change', (e) => {
    const v = Math.max(5, Math.min(30, Number(e.target.value) || 10));
    settings = S.saveSettings({ aio_poll_interval_s: v });
    if (settings.data_source === 'adafruit') rebuildSource();
    renderSettings();
  });

  function bindAioFeed(id, feedKey) {
    $(id).addEventListener('change', (e) => {
      const feeds = { ...(settings.aio_feeds || {}), [feedKey]: e.target.value.trim() };
      settings = S.saveSettings({ aio_feeds: feeds });
      if (settings.data_source === 'adafruit') rebuildSource();
    });
  }
  bindAioFeed('#aio-feed-moisture',    'moisture');
  bindAioFeed('#aio-feed-temperature', 'temperature');
  bindAioFeed('#aio-feed-humidity',    'humidity');
  bindAioFeed('#aio-feed-light',       'light');
  bindAioFeed('#aio-feed-reservoir',   'reservoir');
  bindAioFeed('#aio-feed-pump',        'pump_status');
  bindAioFeed('#aio-feed-cmd',         'water_command');
  bindAioFeed('#aio-feed-herb',        'selected_herb');

  $('#test-aio').addEventListener('click', async () => {
    settings = S.saveSettings({ data_source: 'adafruit' });
    rebuildSource();
    const hint = $('#aio-status-hint');
    hint.className = 'hint';
    hint.textContent = 'Connecting…';
    setTimeout(() => { renderSettings(); render(); }, 1000);
  });

  // Herb dropdown in Settings
  $('#set-plant').addEventListener('change', (e) => switchPlant(e.target.value));

  // Planted date input
  $('#set-planted-date').addEventListener('change', (e) => {
    const iso = e.target.value;
    if (!iso) return;
    S.savePlantedDate(plant.id, iso);
    renderRecipes();
  });

  // Plant source segmented toggle (From seed / Shop-bought · mature).
  // render() is called so the Home harvest badge updates immediately.
  document.querySelectorAll('#plant-source-toggle .ps-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const value = opt.dataset.value;
      S.savePlantSource(plant.id, value);
      renderSettings();
      renderRecipes();
      render();
    });
  });

  // ------------------------------------------------------------------------
  // (Test Mode tab was removed — diagnostics no longer needed.)
  // ------------------------------------------------------------------------

  // ------------------------------------------------------------------------
  // RECIPES + SHOPPING (sub-view)
  // ------------------------------------------------------------------------

  let _currentRecipeId = null;

  function renderRecipes() {
    const plantedIso = S.ensurePlantedDate(plant.id);
    const plantSource = S.ensurePlantSource(plant.id);
    $('#growth-art').innerHTML = ILLUSTRATIONS[plant.illustration];
    const sourceTag = plantSource === 'mature' ? ' · shop-bought' : ' · from seed';
    const demoTag = plant.live ? '' : ' · demo profile';
    $('#growth-herb').textContent = `Growing: ${plant.common_name}${sourceTag}${demoTag}`;
    const g = growthStage(plantedIso, plant, plantSource);
    $('#growth-headline').textContent = `Day ${g.days}`;
    $('#growth-stage').textContent = g.stage;
    $('#growth-rec').textContent = g.recommendation;
    // Progress bar: 0..harvest threshold for seeds, 100% for mature.
    $('#growth-bar-fill').style.width = g.progressPct + '%';
    if (plantSource === 'mature') {
      $('#growth-marks').innerHTML = [
        ['Settling in', g.days < 7],
        ['Established', g.days >= 7],
      ].map(([lbl, current]) =>
        `<span class="${current ? 'reached' : ''}">${lbl}</span>`
      ).join('');
    } else {
      const thresholds = plant.grow_time_days;
      $('#growth-marks').innerHTML = [
        ['Seedling',     g.days >= 0],
        ['Vegetative',   g.days >= thresholds.seedling],
        ['Maturing',     g.days >= thresholds.vegetative],
        ['Harvest',      g.days >= thresholds.mature],
      ].map(([lbl, reached]) =>
        `<span class="${reached ? 'reached' : ''}">${lbl}</span>`
      ).join('');
    }

    // Recipe of the day
    const r = recipeOfTheDay(plant.id);
    _currentRecipeId = r.id;
    $('#recipe-title').textContent = r.title;
    $('#recipe-blurb').textContent = r.blurb;
    $('#recipe-ingredients').innerHTML = r.ingredients
      .map(i => `<li>${i.text}</li>`).join('');
    $('#recipe-method').innerHTML = r.method.map(s => `<li>${s}</li>`).join('');
  }

  // Shopping List sub-view (no tab; navigated via in-app push)
  function goToShopping() {
    if (!_currentRecipeId) renderRecipes();
    $('#panel-recipes').classList.remove('active');
    $('#panel-shopping').classList.add('active');
    // Keep the Recipes tab visually active
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    const recipesTab = document.querySelector('.tab[data-tab="recipes"]');
    if (recipesTab) recipesTab.classList.add('active');
    renderShopping();
  }
  function returnToRecipe() {
    $('#panel-shopping').classList.remove('active');
    $('#panel-recipes').classList.add('active');
  }
  function renderShopping() {
    const recipe = currentRecipe();
    if (!recipe) return;
    $('#shopping-title').textContent = 'Shopping list';
    $('#shopping-subtitle').textContent = `For: ${recipe.title}`;
    const state = S.loadShoppingState(recipe.id);
    const items = recipe.ingredients;
    $('#shopping-items').innerHTML = items.map(i => {
      const checked = !!state[i.id];
      return `<li class="${checked ? 'checked' : ''}" data-id="${i.id}">
        <span class="check"><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg></span>
        <span class="text">${i.text}</span>
      </li>`;
    }).join('');
    const done = items.filter(i => state[i.id]).length;
    $('#shopping-status').textContent = `${done} of ${items.length} checked off`;
    // Wire item clicks
    $('#shopping-items').querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const id = li.dataset.id;
        const cur = S.loadShoppingState(recipe.id);
        cur[id] = !cur[id];
        S.saveShoppingState(recipe.id, cur);
        renderShopping();
      });
    });
  }
  function currentRecipe() {
    if (!_currentRecipeId) return null;
    for (const list of Object.values(RECIPES)) {
      const found = list.find(r => r.id === _currentRecipeId);
      if (found) return found;
    }
    return null;
  }

  // Recipe / Shopping wiring
  $('#shopping-btn').addEventListener('click', goToShopping);
  $('#back-to-recipe').addEventListener('click', returnToRecipe);

  // ------------------------------------------------------------------------
  // DEMO — guided walkthrough of the auto-water workflow.
  //
  // The Demo tab's moisture value is driven entirely by this state machine;
  // it does NOT reflect the live sensor. The ONE real action is the
  // water:8000 POST to Adafruit IO when moisture crosses 35%. Everything
  // else — the moisture animation, the plant-health gauge, the recovery
  // curve — is synthesised for visual demonstration only.
  // ------------------------------------------------------------------------
  const DEMO_TICK_MS = 500;
  const DEMO_START_MOISTURE   = 37;
  const DEMO_TRIGGER_BELOW    = 35;
  const DEMO_RECOVERY_TARGET  = 65;
  const DEMO_DRY_PER_TICK     = 0.6;
  const DEMO_WATER_PER_TICK   = 0.8;
  const DEMO_WATER_DURATION_MS = 8000;

  const demoState = {
    phase: 'idle',            // 'idle' | 'drying' | 'watering' | 'complete'
    moisture: DEMO_START_MOISTURE,
    timer: null,
    aioStatus: null,          // { ok: bool, reason?: string } from the AIO POST
  };

  // Always reach Adafruit IO when AIO creds are saved — even if the active
  // data source is mock or serial — so the demo demonstrates the real
  // device reacting. If creds aren't saved, return a status so the toast
  // can explain why no real command went out.
  async function sendDemoWaterToAio() {
    const duration = DEMO_WATER_DURATION_MS;
    if (source instanceof AdafruitIOSource && source.isConfigured()) {
      try {
        await source.sendCommand({ cmd: 'water', duration_ms: duration });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message || String(e) };
      }
    }
    const u = (settings.aio_username || '').trim();
    const k = (settings.aio_key || '').trim();
    const feed = (settings.aio_feeds && settings.aio_feeds.water_command) || 'water-command';
    if (!u || !k) {
      return { ok: false, reason: 'No Adafruit IO credentials saved — enter them in Settings → Connection to send the real command.' };
    }
    const url = `https://io.adafruit.com/api/v2/${encodeURIComponent(u)}/feeds/${encodeURIComponent(feed)}/data`;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'X-AIO-Key': k, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: `water:${duration}` }),
      });
      if (!r.ok) return { ok: false, reason: `Adafruit IO returned HTTP ${r.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message || String(e) };
    }
  }

  function demoStartIfIdle() {
    if (demoState.phase !== 'idle' && demoState.phase !== 'complete') return;
    demoState.phase = 'drying';
    demoState.moisture = DEMO_START_MOISTURE;
    demoState.aioStatus = null;
    hideDemoToast();
    if (demoState.timer) clearInterval(demoState.timer);
    demoState.timer = setInterval(demoTick, DEMO_TICK_MS);
    renderDemo();
  }

  function demoReset() {
    if (demoState.timer) { clearInterval(demoState.timer); demoState.timer = null; }
    demoState.phase = 'idle';
    demoState.moisture = DEMO_START_MOISTURE;
    demoState.aioStatus = null;
    hideDemoToast();
    renderDemo();
  }

  function demoTick() {
    if (demoState.phase === 'drying') {
      demoState.moisture = Math.max(0, demoState.moisture - DEMO_DRY_PER_TICK);
      if (demoState.moisture < DEMO_TRIGGER_BELOW) {
        // Cross the threshold once. Flip to watering immediately so the
        // tick doesn't fire the AIO POST twice; the real send is awaited
        // in the background and its status feeds the final toast.
        demoState.phase = 'watering';
        sendDemoWaterToAio().then(status => { demoState.aioStatus = status; });
      }
    } else if (demoState.phase === 'watering') {
      demoState.moisture = Math.min(100, demoState.moisture + DEMO_WATER_PER_TICK);
      if (demoState.moisture >= DEMO_RECOVERY_TARGET) {
        demoState.phase = 'complete';
        if (demoState.timer) { clearInterval(demoState.timer); demoState.timer = null; }
        showDemoToast();
      }
    }
    renderDemo();
  }

  function showDemoToast() {
    const toast = $('#demo-toast');
    if (!toast) return;
    $('#demo-toast-title').textContent =
      'Moisture Level Low, Automatic Watering Complete.';
    const sub = $('#demo-toast-sub');
    if (demoState.aioStatus && demoState.aioStatus.ok) {
      sub.textContent = `water:${DEMO_WATER_DURATION_MS} posted to Adafruit IO.`;
    } else if (demoState.aioStatus && demoState.aioStatus.reason) {
      sub.textContent = `Visual demo only — ${demoState.aioStatus.reason}`;
    } else {
      sub.textContent = '';
    }
    toast.hidden = false;
  }
  function hideDemoToast() {
    const toast = $('#demo-toast');
    if (toast) toast.hidden = true;
  }

  function demoStageLabel() {
    return ({
      idle:     'Press Start Demo to begin',
      drying:   'Moisture is dropping — auto-water threshold is 35%',
      watering: 'Water command sent — moisture recovering',
      complete: 'Demo complete — Reset to run again',
    })[demoState.phase] || '';
  }

  function renderDemo() {
    const m = demoState.moisture;
    const moistureEl = $('#demo-moisture-value');
    const fillEl     = $('#demo-moisture-fill');
    if (moistureEl) {
      moistureEl.textContent = m.toFixed(1) + '%';
      moistureEl.classList.toggle('warning', m < 40 && m >= 30);
      moistureEl.classList.toggle('danger',  m < 30);
    }
    if (fillEl) {
      fillEl.style.width = Math.max(0, Math.min(100, m)) + '%';
      fillEl.classList.toggle('warning', m < 40 && m >= 30);
      fillEl.classList.toggle('danger',  m < 30);
    }
    $('#demo-stage').textContent = demoStageLabel();

    // Plant Health gauge — the demo only varies moisture, so the other
    // sub-scores stay at "all readings at ideal" so the gauge tracks the
    // moisture swing without other noise.
    const reading = {
      timestamp: new Date().toISOString(),
      time_valid: true,
      moisture_pct: m,
      temperature_c: 22.0,
      humidity_pct: 50.0,
      light_lux: 22000,
      reservoir_level: 85,
      pump_event: null,
      pump_status: demoState.phase === 'watering' ? 'running' : 'idle',
    };
    const health = computeHealth(_activePlant, reading);
    setGauge('#demo-gauge-fill', '#demo-gauge-num', health.score);
    $('#demo-gauge-exp').textContent = demoState.phase === 'idle'
      ? 'Awaiting demo start'
      : health.explanation;

    // Buttons
    const startBtn = $('#demo-start');
    const resetBtn = $('#demo-reset');
    if (startBtn && resetBtn) {
      const running = demoState.phase === 'drying' || demoState.phase === 'watering';
      startBtn.disabled = running;
      startBtn.textContent = demoState.phase === 'complete' ? 'Run Demo Again' : 'Start Demo';
      resetBtn.hidden = demoState.phase === 'idle';
    }

    // Hero illustration uses the canonical basil illustration regardless
    // of which herb the user has selected elsewhere — the demo is fixed
    // to basil for a predictable narrative.
    const art = $('#demo-art');
    if (art && !art.hasChildNodes()) {
      art.innerHTML = ILLUSTRATIONS.basil;
    }
  }

  $('#demo-start').addEventListener('click', demoStartIfIdle);
  $('#demo-reset').addEventListener('click', demoReset);

  // First paint
  S.ensurePlantedDate(plant.id);
  renderSettings();
  renderProfile();
  renderHistory();
  renderRecipes();
  renderDemo();
  render();
  setInterval(tick, 1000);
})();
