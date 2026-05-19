/* localStorage helpers for Sprout and Spoon: settings, event log,
 * test mode state, planted dates, plant source, and per-recipe
 * shopping list check-state. Namespaced under "sproutandspoon.*".
 *
 * Adafruit IO credentials are NOT stored here — they live server-side
 * in backend/.env so the AIO key never reaches the browser.
 */
(function (root) {

  const KEYS = {
    settings:     'sproutandspoon.settings.v1',
    events:       'sproutandspoon.events.v1',
    waterTs:      'sproutandspoon.lastWaterTs.v1',
    testMode:     'sproutandspoon.testMode.v1',
    planted:      'sproutandspoon.plantedDates.v1',
    plantSources: 'sproutandspoon.plantSources.v1',
    shopping:     'sproutandspoon.shopping.v1',
  };

  const DEFAULTS = {
    selected_plant: 'basil',
    moisture_threshold_pct: 35,
    watering_cooldown_s: 600,
    low_reservoir_pct: 20,
    stale_after_s: 30,
    notifications_enabled: true,
    // Primary live channel is the local backend that proxies Adafruit IO.
    // Browser never sees the AIO key.
    data_source: 'backend',          // 'backend' | 'mock' | 'serial'
    backend_url: '',                 // '' = same origin
    backend_poll_interval_s: 10,
  };

  // Field names that should NEVER appear in this app's localStorage going
  // forward (they used to hold the AIO key in cleartext). Wiped on load.
  const LEGACY_CREDENTIAL_FIELDS = ['aio_username', 'aio_key', 'aio_feeds'];

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (_) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  function loadSettings() {
    const stored = readJSON(KEYS.settings, {});
    // Migrate the old 'adafruit' value (which used direct AIO from the
    // browser) to the new backend-proxied source.
    if (stored.data_source === 'adafruit') stored.data_source = 'backend';
    // Purge legacy credentials from prior versions of this app.
    let purged = false;
    for (const f of LEGACY_CREDENTIAL_FIELDS) {
      if (f in stored) { delete stored[f]; purged = true; }
    }
    const merged = { ...DEFAULTS, ...stored };
    if (purged) writeJSON(KEYS.settings, merged);
    return merged;
  }
  function saveSettings(patch) {
    const next = { ...loadSettings(), ...patch };
    writeJSON(KEYS.settings, next);
    return next;
  }

  function loadEvents() { return readJSON(KEYS.events, []); }
  function addEvent(kind, message, extra) {
    return addEventAt(new Date().toISOString(), kind, message, extra);
  }
  function addEventAt(timestamp, kind, message, extra) {
    const events = loadEvents();
    events.push({ timestamp, kind, message, ...(extra || {}) });
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (events.length > 200) events.splice(0, events.length - 200);
    writeJSON(KEYS.events, events);
    return events;
  }
  function clearEvents() { writeJSON(KEYS.events, []); }
  function setEvents(arr) { writeJSON(KEYS.events, arr); }
  function lastOf(kind) {
    const ev = loadEvents();
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].kind === kind) return ev[i];
    return null;
  }

  function loadTestMode() { return readJSON(KEYS.testMode, null); }
  function saveTestMode(state) { writeJSON(KEYS.testMode, state); }

  function loadLastWaterTs() {
    const v = Number(localStorage.getItem(KEYS.waterTs));
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  function saveLastWaterTs(ts) {
    try { localStorage.setItem(KEYS.waterTs, String(ts)); } catch (_) {}
  }

  function loadPlantedDates() { return readJSON(KEYS.planted, {}); }
  function loadPlantedDate(plantId) {
    const all = loadPlantedDates();
    return all[plantId] || null;
  }
  function savePlantedDate(plantId, iso) {
    const all = loadPlantedDates();
    all[plantId] = iso;
    writeJSON(KEYS.planted, all);
  }
  function ensurePlantedDate(plantId) {
    let iso = loadPlantedDate(plantId);
    if (!iso) {
      iso = new Date().toISOString().slice(0, 10);
      savePlantedDate(plantId, iso);
    }
    return iso;
  }

  function loadShoppingState(recipeId) {
    const all = readJSON(KEYS.shopping, {});
    return all[recipeId] || {};
  }
  function saveShoppingState(recipeId, state) {
    const all = readJSON(KEYS.shopping, {});
    all[recipeId] = state;
    writeJSON(KEYS.shopping, all);
  }

  // Plant source: 'seeds' (default) or 'mature' (bought as a grown plant).
  const PLANT_SOURCE_VALUES = ['seeds', 'mature'];
  function loadPlantSources() { return readJSON(KEYS.plantSources, {}); }
  function loadPlantSource(plantId) {
    const all = loadPlantSources();
    const v = all[plantId];
    return PLANT_SOURCE_VALUES.includes(v) ? v : 'seeds';
  }
  function savePlantSource(plantId, value) {
    if (!PLANT_SOURCE_VALUES.includes(value)) return;
    const all = loadPlantSources();
    all[plantId] = value;
    writeJSON(KEYS.plantSources, all);
  }
  function ensurePlantSource(plantId) {
    const cur = loadPlantSource(plantId);
    const all = loadPlantSources();
    if (!all[plantId]) {
      all[plantId] = cur;
      writeJSON(KEYS.plantSources, all);
    }
    return cur;
  }

  root.HerbStorage = {
    DEFAULTS,
    loadSettings, saveSettings,
    loadEvents, addEvent, addEventAt, clearEvents, setEvents, lastOf,
    loadTestMode, saveTestMode,
    loadLastWaterTs, saveLastWaterTs,
    loadPlantedDates, loadPlantedDate, savePlantedDate, ensurePlantedDate,
    loadPlantSources, loadPlantSource, savePlantSource, ensurePlantSource,
    loadShoppingState, saveShoppingState,
  };
})(window);
