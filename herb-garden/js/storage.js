/* localStorage helpers for settings + event log. */
(function (root) {

  const KEYS = {
    settings: 'herbgarden.settings.v1',
    events:   'herbgarden.events.v1',
    waterTs:  'herbgarden.lastWaterTs.v1',
    testMode: 'herbgarden.testMode.v1',
  };

  const DEFAULTS = {
    selected_plant: 'basil',
    moisture_threshold_pct: 35,
    watering_cooldown_s: 600,
    low_reservoir_pct: 20,
    stale_after_s: 10,
    notifications_enabled: true,
    data_source: 'mock',     // 'mock' | 'serial'
  };

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (_) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  function loadSettings() {
    return { ...DEFAULTS, ...readJSON(KEYS.settings, {}) };
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

  root.HerbStorage = {
    DEFAULTS,
    loadSettings, saveSettings,
    loadEvents, addEvent, addEventAt, clearEvents, setEvents, lastOf,
    loadTestMode, saveTestMode,
    loadLastWaterTs, saveLastWaterTs,
  };
})(window);
