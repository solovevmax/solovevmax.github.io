/* Plant reference database + Test Data scenarios.
 *
 * Add a new herb by appending an entry to PLANTS with the same shape.
 * ranges: "ideal" = sub-score 100; "ok" = wider tolerable band.
 * weights must sum to 1.0; moisture + temperature carry the highest
 * weight for basil per common care guidance.
 */
(function (root) {

  // Inline SVG illustrations. Use as innerHTML.
  const ILLUSTRATIONS = {
    basil: `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="leafA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#86A77B"/>
      <stop offset="1" stop-color="#5C7A55"/>
    </linearGradient>
    <linearGradient id="leafB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9CB78E"/>
      <stop offset="1" stop-color="#6E8A66"/>
    </linearGradient>
    <linearGradient id="pot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C99876"/>
      <stop offset="1" stop-color="#A26E4C"/>
    </linearGradient>
  </defs>

  <!-- stems -->
  <path d="M100 165 C 98 130, 86 105, 78 90" stroke="#5C7A55" stroke-width="3"
        stroke-linecap="round" fill="none"/>
  <path d="M100 165 C 102 130, 118 105, 126 88" stroke="#5C7A55" stroke-width="3"
        stroke-linecap="round" fill="none"/>
  <path d="M100 170 V 130" stroke="#5C7A55" stroke-width="3" stroke-linecap="round"/>

  <!-- back leaves (lighter) -->
  <g fill="url(#leafB)">
    <ellipse cx="60"  cy="78"  rx="22" ry="14" transform="rotate(-30 60 78)"/>
    <ellipse cx="142" cy="76"  rx="22" ry="14" transform="rotate(30 142 76)"/>
    <ellipse cx="92"  cy="48"  rx="20" ry="13" transform="rotate(-15 92 48)"/>
  </g>

  <!-- front leaves (darker) -->
  <g fill="url(#leafA)">
    <path d="M100 135 C 70 130, 55 115, 60 95 C 80 90, 100 105, 100 135 Z"/>
    <path d="M100 135 C 130 130, 145 115, 140 95 C 120 90, 100 105, 100 135 Z"/>
    <path d="M100 105 C 78 100, 70 80, 80 60 C 95 60, 105 80, 100 105 Z"/>
    <path d="M100 105 C 122 100, 130 80, 120 60 C 105 60, 95 80, 100 105 Z"/>
    <ellipse cx="118" cy="38" rx="14" ry="9" transform="rotate(25 118 38)"/>
    <ellipse cx="82"  cy="38" rx="14" ry="9" transform="rotate(-25 82 38)"/>
  </g>
  <!-- leaf veins -->
  <g stroke="#3F5638" stroke-width="1" fill="none" opacity=".5">
    <path d="M80 124 L 95 115"/>
    <path d="M120 124 L 105 115"/>
    <path d="M85 95 L 97 80"/>
    <path d="M115 95 L 103 80"/>
  </g>

  <!-- pot -->
  <path d="M70 170 L 130 170 L 124 196 L 76 196 Z" fill="url(#pot)"/>
  <ellipse cx="100" cy="170" rx="30" ry="6" fill="#A26E4C"/>
  <ellipse cx="100" cy="168" rx="28" ry="5" fill="#5C3E25"/>
</svg>`,
  };

  const PLANTS = {
    basil: {
      id: 'basil',
      common_name: 'Basil',
      scientific_name: 'Ocimum basilicum',
      illustration: 'basil',
      notes: 'Basil loves warm conditions, moist but well-drained soil, ' +
             'a pH around 6.0–7.0, and at least 4–6+ hours of strong, ' +
             'direct light per day. Avoid letting soil dry out completely.',
      ranges: {
        moisture_pct:  { ideal: [40, 70],   ok: [25, 85] },
        temperature_c: { ideal: [18, 27],   ok: [13, 32] },
        humidity_pct:  { ideal: [40, 60],   ok: [30, 80] },
        ph:            { ideal: [6.0, 7.0], ok: [5.5, 7.5] },
        light_lux:     { ideal: [10000, 50000], ok: [3000, 100000] },
      },
      weights: {
        moisture_pct:  0.30,
        temperature_c: 0.20,
        light_lux:     0.20,
        humidity_pct:  0.10,
        ph:            0.10,
        reservoir:     0.10,
      },
      moisture_threshold_pct: 35,
      watering_cooldown_s: 600,
    },
  };

  // Test Data scenarios — fixed believable readings for previewing the UI.
  const SCENARIOS = {
    healthy: {
      label: 'Healthy basil',
      banner: 'Preview of a happy, well-cared-for basil plant.',
      reading: {
        moisture_pct: 58, temperature_c: 22.4, humidity_pct: 52,
        ph: 6.6, light_lux: 22000, reservoir_level: 85,
      },
      last_watered_minutes_ago: 90,
    },
    dry: {
      label: 'Dry soil — needs water',
      banner: 'Preview of a thirsty plant. Press "Water now" to see the watering action.',
      reading: {
        moisture_pct: 22, temperature_c: 26.1, humidity_pct: 38,
        ph: 6.5, light_lux: 18000, reservoir_level: 60,
      },
      last_watered_minutes_ago: 720, // 12 h ago
    },
    low_reservoir: {
      label: 'Low reservoir',
      banner: 'Preview of a low water tank. The reservoir is at 12% — a refill is needed.',
      reading: {
        moisture_pct: 44, temperature_c: 23.0, humidity_pct: 49,
        ph: 6.4, light_lux: 24000, reservoir_level: 12,
      },
      last_watered_minutes_ago: 45,
    },
  };

  function getPlant(id) {
    if (!PLANTS[id]) throw new Error('Unknown plant: ' + id);
    return PLANTS[id];
  }

  function listPlants() {
    return Object.values(PLANTS).map(p => ({ id: p.id, common_name: p.common_name }));
  }

  root.HerbPlants = { PLANTS, SCENARIOS, ILLUSTRATIONS, getPlant, listPlants };
})(window);
