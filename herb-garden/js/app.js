/* Sprout and Spoon — main app:
 * - Live-mode controller (auto-water, alerts) for whichever data source the
 *   user picks (LiveMock / Serial / Adafruit IO).
 * - UI rendering for Home, Live, History, Plant Profile, Settings, Alerts,
 *   Test Mode, Recipes, and the Shopping List sub-view.
 * - Multi-herb gating: only Basil triggers live actions (auto-water, pump
 *   commands, event log). Other herbs are info-only reference profiles.
 */
(function () {
  const { PLANTS, SCENARIOS, ILLUSTRATIONS, getPlant, listPlants } = window.HerbPlants;
  const { computeHealth, bucket } = window.HerbHealth;
  const { LiveMockSource, SerialSource, AdafruitIOSource } = window.HerbSources;
  const { RECIPES, recipeOfTheDay, growthStage } = window.SproutRecipes;
  const { currentSeason, herbSuitability } = window.SproutSeasonality;
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
    { key: 'light_lux',       name: 'Light',         unit: ' lx',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2"/></svg>' },
    { key: 'reservoir_level', name: 'Reservoir',     unit: '%',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v6a7 7 0 0 1-14 0z"/><path d="M5 14h14"/></svg>' },
  ];

  // --- Live mode controller state ------------------------------------------
  let settings = S.loadSettings();
  let plant = getPlant(settings.selected_plant);
  let source = null;
  let alertActive = { low_res: false, stale: false, off: false };

  function makeSource() {
    try {
      if (settings.data_source === 'serial' && SerialSource.isSupported()) {
        return new SerialSource(settings.stale_after_s * 1000);
      }
      if (settings.data_source === 'adafruit') {
        const src = new AdafruitIOSource({
          username: settings.aio_username,
          key: settings.aio_key,
          feeds: settings.aio_feeds,
          pollIntervalMs: (settings.aio_poll_interval_s || 5) * 1000,
          staleAfterMs: (settings.stale_after_s || 10) * 1000 * 2,
        });
        if (!src.isConfigured()) {
          // Fall back; the AIO config panel makes the missing-config obvious.
          return new LiveMockSource();
        }
        return src;
      }
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
      // for reference-only herbs (parsley/thyme/mint).
      const lastTs = S.loadLastWaterTs();
      const cooldownOk = (now - lastTs) > settings.watering_cooldown_s * 1000;
      const haveWater = r.reservoir_level == null || r.reservoir_level >= settings.low_reservoir_pct;
      const liveWired = plant.live === true;
      if (liveWired
          && source.allowAutoWater !== false
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
    if (!plant.live) {
      // Suppress the device command for reference-only herbs. Still surface
      // an info message so the user knows why nothing happened.
      S.addEvent('info', `Watering disabled for ${plant.common_name}. Switch to Basil to trigger the pump.`);
      return;
    }
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
      else                  { descr = `Ideal for ${plant.common_name.toLowerCase()}`; }
      $('#light-sub').textContent = descr;
    }

    // Key metrics (small chips, secondary)
    const keys = ['moisture_pct', 'temperature_c', 'humidity_pct', 'light_lux'];
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

    // Demo-profile note for non-basil reference herbs.
    const demoNote = $('#demo-profile-note');
    if (demoNote) demoNote.hidden = !!plant.live;

    // Disable Water now for non-live herbs (since the pump isn't wired to them).
    const waterBtn = $('#water-btn');
    if (waterBtn) {
      waterBtn.disabled = !plant.live;
      waterBtn.title = plant.live ? '' : `Switch to Basil in Settings to water the live garden.`;
    }
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
    // Tell Adafruit IO (best-effort) which herb is now selected.
    if (source instanceof AdafruitIOSource && source.publishSelectedHerb) {
      source.publishSelectedHerb(plantId);
    }
    renderHerbPicker();
    render();
    renderProfile();
    renderRecipes();
    renderSettings();
  }

  // Connection chip + demo banner.
  // Labels reflect the active source type: Adafruit IO / Serial / Demo / Stale / Disconnected.
  function renderConn(state) {
    const chip = $('#conn-chip');
    const label = $('#conn-label');
    const sync  = $('#conn-sync');
    chip.classList.remove('ok', 'stale', 'off');

    let labelText, isLiveSource = false;
    if (source instanceof SerialSource) {
      labelText = 'Connected (Serial)'; isLiveSource = true;
    } else if (source instanceof AdafruitIOSource) {
      labelText = 'Connected (Adafruit IO)'; isLiveSource = true;
    } else {
      labelText = 'Demo (mock)';
    }

    if (state.stale) {
      chip.classList.add('stale'); label.textContent = 'Stale data';
    } else if (state.connected) {
      chip.classList.add('ok');
      label.textContent = labelText;
    } else {
      chip.classList.add('off');
      label.textContent = (source instanceof AdafruitIOSource)
        ? 'AIO not connected' : 'Disconnected';
    }

    // Last-sync subtext (from the source's own lastSyncMs).
    if (sync) {
      const ms = (source.lastSyncMs && source.lastSyncMs()) || 0;
      sync.textContent = ms ? `Last sync · ${fmtAgo(new Date(ms).toISOString())}` : '';
    }

    // Demo banner only shows in live tabs while running on mock data.
    const banner = $('#demo-banner');
    const onTestMode = $('#panel-test-mode').classList.contains('active');
    const isMock = !(source instanceof SerialSource || source instanceof AdafruitIOSource);
    if (isMock && !onTestMode) banner.classList.remove('hidden');
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
    $('#aio-key').value = settings.aio_key || '';
    const f = settings.aio_feeds || {};
    $('#aio-feed-moisture').value    = f.moisture      || '';
    $('#aio-feed-temperature').value = f.temperature   || '';
    $('#aio-feed-humidity').value    = f.humidity      || '';
    $('#aio-feed-light').value       = f.light         || '';
    $('#aio-feed-reservoir').value   = f.reservoir     || '';
    $('#aio-feed-pump').value        = f.pump_status   || '';
    $('#aio-feed-cmd').value         = f.water_command || '';
    $('#aio-feed-herb').value        = f.selected_herb || '';
    if (source instanceof AdafruitIOSource) {
      const hint = $('#aio-status-hint');
      hint.className = 'hint ' + (source.isConnected() ? 'aio-status-ok' : 'aio-status-error');
      if (source.isConnected()) {
        const t = source.lastSyncMs && source.lastSyncMs();
        hint.textContent = t ? `Connected — last sync ${fmtAgo(new Date(t).toISOString())}` : 'Connected';
      } else {
        hint.textContent = source.lastError ? (source.lastError() || 'Waiting for first sync…') : 'Not connected';
      }
    } else if (settings.data_source === 'adafruit') {
      const hint = $('#aio-status-hint');
      hint.className = 'hint';
      hint.textContent = 'Save the settings, then click Test connection.';
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
      if (t === 'test-mode') renderTestMode();
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

  // Adafruit IO field bindings
  function bindAioField(id, key) {
    $(id).addEventListener('change', (e) => {
      settings = S.saveSettings({ [key]: e.target.value.trim() });
    });
  }
  bindAioField('#aio-username', 'aio_username');
  bindAioField('#aio-key',      'aio_key');

  function bindAioFeed(id, feedKey) {
    $(id).addEventListener('change', (e) => {
      const feeds = { ...(settings.aio_feeds || {}), [feedKey]: e.target.value.trim() };
      settings = S.saveSettings({ aio_feeds: feeds });
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
    renderSettings();
    // Force an immediate poll attempt and then re-render the status.
    if (source instanceof AdafruitIOSource) {
      const hint = $('#aio-status-hint');
      hint.className = 'hint'; hint.textContent = 'Connecting…';
      // give the immediate _pollOnce() inside start() a moment to complete
      setTimeout(() => { renderSettings(); render(); }, 800);
    }
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

  // Plant source segmented toggle (From seed / Shop-bought · mature)
  document.querySelectorAll('#plant-source-toggle .ps-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const value = opt.dataset.value;
      S.savePlantSource(plant.id, value);
      renderSettings();
      renderRecipes();
    });
  });

  // ------------------------------------------------------------------------
  // TEST MODE — fully isolated manual sandbox. Does NOT touch the live data
  // source, events log, or last-watered timestamp.
  // ------------------------------------------------------------------------
  const TEST_DEFAULTS = {
    moisture_pct: 58, temperature_c: 22.4, humidity_pct: 52,
    light_lux: 22000, reservoir_level: 85,
    last_watered_min_ago: 90,
  };
  // Strip any legacy pH fields a previous build may have written into
  // localStorage so the test state matches the current schema.
  let testState = S.loadTestMode() || { ...TEST_DEFAULTS };
  delete testState.ph;
  delete testState.ph_present;

  function buildTestReading() {
    return {
      timestamp: new Date().toISOString(),
      moisture_pct:    Number(testState.moisture_pct),
      temperature_c:   Number(testState.temperature_c),
      humidity_pct:    Number(testState.humidity_pct),
      light_lux:       Number(testState.light_lux),
      reservoir_level: Number(testState.reservoir_level),
      pump_event: null,
    };
  }

  function fmtMinAgo(min) {
    if (min < 1) return 'just now';
    if (min < 60) return `${Math.round(min)}m ago`;
    if (min < 1440) {
      const h = min / 60;
      return h < 10 ? `${h.toFixed(1)}h ago` : `${Math.round(h)}h ago`;
    }
    return `${Math.round(min / 1440)}d ago`;
  }

  function renderPresets() {
    const html = Object.entries(SCENARIOS).map(([id, sc]) =>
      `<button class="preset" data-preset="${id}" type="button">${sc.label}</button>`
    ).join('');
    $('#presets').innerHTML = html;
    $('#presets').querySelectorAll('.preset').forEach(b => {
      b.addEventListener('click', () => applyPreset(b.dataset.preset));
    });
  }

  function applyPreset(id) {
    const sc = SCENARIOS[id];
    if (!sc) return;
    testState = {
      ...sc.reading,
      last_watered_min_ago: sc.last_watered_minutes_ago,
    };
    S.saveTestMode(testState);
    renderTestInputs();
    renderTestPreview();
    // Highlight the active preset chip
    $('#presets').querySelectorAll('.preset').forEach(b =>
      b.classList.toggle('active', b.dataset.preset === id));
  }

  function bindSliders() {
    document.querySelectorAll('#panel-test-mode .slider-row').forEach(row => {
      const input = row.querySelector('input[type="range"]');
      const key = row.dataset.key;
      input.addEventListener('input', () => {
        testState[key] = parseFloat(input.value);
        S.saveTestMode(testState);
        $('#presets').querySelectorAll('.preset.active').forEach(b => b.classList.remove('active'));
        renderTestInputs();
        renderTestPreview();
      });
    });
    $('#reset-test').addEventListener('click', () => applyPreset('healthy'));
  }

  function renderTestInputs() {
    document.querySelectorAll('#panel-test-mode .slider-row').forEach(row => {
      const input = row.querySelector('input[type="range"]');
      const valEl = row.querySelector('.srval');
      const key = row.dataset.key;
      const unit = row.dataset.unit || '';
      const v = testState[key];
      input.value = v;
      if (key === 'light_lux') {
        valEl.textContent = Math.round(v).toLocaleString() + unit;
      } else if (key === 'last_watered_min_ago') {
        valEl.textContent = fmtMinAgo(Number(v));
      } else {
        valEl.textContent = Math.round(v) + unit;
      }
    });
  }

  function renderTestPreview() {
    const reading = buildTestReading();
    const health = computeHealth(plant, reading);

    setGauge('#test-gauge-fill', '#test-gauge-num', health.score);
    $('#test-gauge-exp').textContent = health.explanation;
    $('#test-summary').textContent = health.summary;

    // Last watered tile
    const min = Number(testState.last_watered_min_ago);
    $('#test-lw').textContent = fmtMinAgo(min);
    const lwTs = new Date(Date.now() - min * 60_000);
    $('#test-lw-sub').textContent =
      lwTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      + ' · ' + lwTs.toLocaleDateString([], { month: 'short', day: 'numeric' });

    // Reservoir tile
    const tileRes = $('#test-tile-reservoir');
    tileRes.classList.remove('warn', 'bad');
    const res = reading.reservoir_level;
    $('#test-res').textContent = Math.round(res) + '%';
    $('#test-res-bar').style.width = Math.max(0, Math.min(100, res)) + '%';
    if (res < settings.low_reservoir_pct) tileRes.classList.add('bad');
    else if (res < settings.low_reservoir_pct + 15) tileRes.classList.add('warn');

    // Light tile
    const lux = reading.light_lux;
    const tileLight = $('#test-tile-light');
    tileLight.classList.remove('warn', 'bad');
    $('#test-light').textContent = Math.round(lux).toLocaleString() + ' lx';
    let descr = 'Bright indirect';
    if (lux < 3000)       { descr = 'Too dim'; tileLight.classList.add('bad'); }
    else if (lux < 10000) { descr = 'Low light'; tileLight.classList.add('warn'); }
    else if (lux > 100000){ descr = 'Very intense'; tileLight.classList.add('warn'); }
    else if (lux > 50000) { descr = 'Bright sun'; }
    else                  { descr = 'Ideal for basil'; }
    $('#test-light-sub').textContent = descr;

    // Key metrics chips
    const keys = ['moisture_pct', 'temperature_c', 'humidity_pct', 'light_lux'];
    $('#test-key-metrics').innerHTML = keys.map(k => {
      const def = METRICS.find(m => m.key === k);
      const v = reading[k];
      const b = bucket(plant, k, v);
      const cls = b === 'missing' ? '' : (b === 'good' ? '' : ' ' + b);
      const formatted = fmtVal(k, v);
      return `<div class="chip${cls}">
        <div class="icon">${def.icon}</div>
        <div class="ml">${def.name}</div>
        <div class="mv">${formatted == null ? '<span class="missing">—</span>' : formatted + def.unit}</div>
      </div>`;
    }).join('');

    // Sub-scores breakdown
    const SUB_LABELS = {
      moisture_pct: 'Soil moisture', temperature_c: 'Temperature',
      humidity_pct: 'Humidity',
      light_lux: 'Light (BH1750)', reservoir: 'Reservoir',
    };
    const subRows = Object.entries(health.subscores).map(([k, v]) => {
      const w = plant.weights[k] != null ? Math.round(plant.weights[k] * 100) + '% weight' : '';
      let cls = '';
      if (v < 40) cls = 'bad';
      else if (v < 70) cls = 'warn';
      return `<div class="subscore-row ${cls}">
        <div class="lbl">${SUB_LABELS[k] || k}<br><span style="color:var(--muted);font-size:11px">${w}</span></div>
        <div class="bar"><span style="width:${v}%"></span></div>
        <div class="num">${Math.round(v)}</div>
      </div>`;
    });
    $('#test-subscores').innerHTML = subRows.join('');

    // Alerts that would trigger
    const alerts = [];
    if (res < settings.low_reservoir_pct) {
      alerts.push({ kind: 'alert', msg: `Low reservoir (${Math.round(res)}%) — refill needed` });
    }
    const wouldAutoWater = reading.moisture_pct < settings.moisture_threshold_pct
                          && res >= settings.low_reservoir_pct;
    if (wouldAutoWater) {
      alerts.push({ kind: 'watering', msg:
        `Would auto-water now (moisture ${Math.round(reading.moisture_pct)}% < threshold ${settings.moisture_threshold_pct}%)` });
    }
    if (reading.moisture_pct < settings.moisture_threshold_pct
        && res < settings.low_reservoir_pct) {
      alerts.push({ kind: 'alert', msg: 'Watering needed but reservoir is empty — refill before watering can resume' });
    }
    if (reading.temperature_c < plant.ranges.temperature_c.ok[0]) {
      alerts.push({ kind: 'alert', msg: `Temperature ${reading.temperature_c.toFixed(1)}°C is below the safe range` });
    }
    if (reading.temperature_c > plant.ranges.temperature_c.ok[1]) {
      alerts.push({ kind: 'alert', msg: `Temperature ${reading.temperature_c.toFixed(1)}°C is above the safe range` });
    }
    if (alerts.length === 0) {
      $('#test-alerts').innerHTML = `<div class="empty">No alerts at these values</div>`;
    } else {
      $('#test-alerts').innerHTML = alerts.map(a => {
        const icoCls = a.kind === 'alert' ? 'alert' : '';
        const iconSvg = a.kind === 'watering'
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s-6 7-6 12a6 6 0 0 0 12 0c0-5-6-12-6-12z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';
        return `<div class="event">
          <div class="left">
            <div class="ico ${icoCls}">${iconSvg}</div>
            <div class="msg">${a.msg}</div>
          </div>
        </div>`;
      }).join('');
    }
  }

  function renderTestMode() {
    renderTestInputs();
    renderTestPreview();
  }

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

  renderPresets();
  bindSliders();

  // First paint
  S.ensurePlantedDate(plant.id);
  renderSettings();
  renderProfile();
  renderHistory();
  renderRecipes();
  render();
  renderTestMode();
  setInterval(tick, 1000);
})();
