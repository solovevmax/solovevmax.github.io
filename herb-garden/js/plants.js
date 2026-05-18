/* Plant reference database + Test Data scenarios.
 *
 * Add a new herb by appending an entry to PLANTS with the same shape.
 * ranges: "ideal" = sub-score 100; "ok" = wider tolerable band.
 * weights must sum to 1.0; moisture + temperature carry the highest
 * weight for basil per common care guidance.
 *
 * `live: true` = wired to the smart garden hardware (basil only for now).
 * Other herbs are info-only reference profiles.
 */
(function (root) {

  // Re-tint helpers: leaves use the lime palette via SVG paint URLs.
  // Each illustration keeps its own gradients; per-herb colors below.
  const ILLUSTRATIONS = {
    basil: `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="basilA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9FC643"/>
      <stop offset="1" stop-color="#6B8538"/>
    </linearGradient>
    <linearGradient id="basilB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C8E64E"/>
      <stop offset="1" stop-color="#9FC643"/>
    </linearGradient>
    <linearGradient id="basilPot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1A1B17"/>
      <stop offset="1" stop-color="#0D0E0B"/>
    </linearGradient>
  </defs>
  <path d="M100 165 C 98 130, 86 105, 78 90" stroke="#6B8538" stroke-width="3"
        stroke-linecap="round" fill="none"/>
  <path d="M100 165 C 102 130, 118 105, 126 88" stroke="#6B8538" stroke-width="3"
        stroke-linecap="round" fill="none"/>
  <path d="M100 170 V 130" stroke="#6B8538" stroke-width="3" stroke-linecap="round"/>
  <g fill="url(#basilB)">
    <ellipse cx="60"  cy="78"  rx="22" ry="14" transform="rotate(-30 60 78)"/>
    <ellipse cx="142" cy="76"  rx="22" ry="14" transform="rotate(30 142 76)"/>
    <ellipse cx="92"  cy="48"  rx="20" ry="13" transform="rotate(-15 92 48)"/>
  </g>
  <g fill="url(#basilA)">
    <path d="M100 135 C 70 130, 55 115, 60 95 C 80 90, 100 105, 100 135 Z"/>
    <path d="M100 135 C 130 130, 145 115, 140 95 C 120 90, 100 105, 100 135 Z"/>
    <path d="M100 105 C 78 100, 70 80, 80 60 C 95 60, 105 80, 100 105 Z"/>
    <path d="M100 105 C 122 100, 130 80, 120 60 C 105 60, 95 80, 100 105 Z"/>
    <ellipse cx="118" cy="38" rx="14" ry="9" transform="rotate(25 118 38)"/>
    <ellipse cx="82"  cy="38" rx="14" ry="9" transform="rotate(-25 82 38)"/>
  </g>
  <g stroke="#0D0E0B" stroke-width="1" fill="none" opacity=".35">
    <path d="M80 124 L 95 115"/>
    <path d="M120 124 L 105 115"/>
    <path d="M85 95 L 97 80"/>
    <path d="M115 95 L 103 80"/>
  </g>
  <path d="M70 170 L 130 170 L 124 196 L 76 196 Z" fill="url(#basilPot)"/>
  <ellipse cx="100" cy="170" rx="30" ry="6" fill="#0D0E0B"/>
  <ellipse cx="100" cy="168" rx="28" ry="5" fill="#1A1B17"/>
</svg>`,

    parsley: `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="parsleyA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#A8D04E"/>
      <stop offset="1" stop-color="#5E8033"/>
    </linearGradient>
    <linearGradient id="parsleyPot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1A1B17"/>
      <stop offset="1" stop-color="#0D0E0B"/>
    </linearGradient>
  </defs>
  <g stroke="#5E8033" stroke-width="2" stroke-linecap="round" fill="none">
    <path d="M100 165 V 70"/>
    <path d="M100 130 L 70 80"/>
    <path d="M100 130 L 130 80"/>
    <path d="M100 110 L 80 60"/>
    <path d="M100 110 L 120 60"/>
  </g>
  <g fill="url(#parsleyA)">
    <!-- Frilly parsley leaves: clusters of small circles -->
    <g transform="translate(70,75)">
      <circle cx="0" cy="0" r="6"/><circle cx="-6" cy="-4" r="5"/>
      <circle cx="6" cy="-4" r="5"/><circle cx="0" cy="-9" r="5"/>
      <circle cx="-10" cy="2" r="4"/><circle cx="10" cy="2" r="4"/>
    </g>
    <g transform="translate(130,75)">
      <circle cx="0" cy="0" r="6"/><circle cx="-6" cy="-4" r="5"/>
      <circle cx="6" cy="-4" r="5"/><circle cx="0" cy="-9" r="5"/>
      <circle cx="-10" cy="2" r="4"/><circle cx="10" cy="2" r="4"/>
    </g>
    <g transform="translate(80,55)">
      <circle cx="0" cy="0" r="6"/><circle cx="-6" cy="-4" r="5"/>
      <circle cx="6" cy="-4" r="5"/><circle cx="0" cy="-9" r="5"/>
    </g>
    <g transform="translate(120,55)">
      <circle cx="0" cy="0" r="6"/><circle cx="-6" cy="-4" r="5"/>
      <circle cx="6" cy="-4" r="5"/><circle cx="0" cy="-9" r="5"/>
    </g>
    <g transform="translate(100,40)">
      <circle cx="0" cy="0" r="7"/><circle cx="-7" cy="-4" r="6"/>
      <circle cx="7" cy="-4" r="6"/><circle cx="0" cy="-10" r="6"/>
      <circle cx="-11" cy="3" r="5"/><circle cx="11" cy="3" r="5"/>
    </g>
  </g>
  <path d="M70 170 L 130 170 L 124 196 L 76 196 Z" fill="url(#parsleyPot)"/>
  <ellipse cx="100" cy="170" rx="30" ry="6" fill="#0D0E0B"/>
  <ellipse cx="100" cy="168" rx="28" ry="5" fill="#1A1B17"/>
</svg>`,

    thyme: `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="thymeA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9FB870"/>
      <stop offset="1" stop-color="#5C7035"/>
    </linearGradient>
    <linearGradient id="thymePot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1A1B17"/>
      <stop offset="1" stop-color="#0D0E0B"/>
    </linearGradient>
  </defs>
  <!-- Many thin sprigs fanning out -->
  <g stroke="#5C7035" stroke-width="1.5" stroke-linecap="round" fill="none">
    <path d="M100 168 C 92 140, 78 110, 58 88"/>
    <path d="M100 168 C 108 140, 122 110, 142 88"/>
    <path d="M100 168 C 96 130, 90 95, 78 64"/>
    <path d="M100 168 C 104 130, 110 95, 122 64"/>
    <path d="M100 168 V 60"/>
  </g>
  <!-- Tiny leaf pairs along each stem -->
  <g fill="url(#thymeA)">
    <ellipse cx="68" cy="100" rx="4" ry="2.5" transform="rotate(-25 68 100)"/>
    <ellipse cx="60" cy="115" rx="4" ry="2.5" transform="rotate(-25 60 115)"/>
    <ellipse cx="132" cy="100" rx="4" ry="2.5" transform="rotate(25 132 100)"/>
    <ellipse cx="140" cy="115" rx="4" ry="2.5" transform="rotate(25 140 115)"/>
    <ellipse cx="88" cy="90" rx="4" ry="2.5" transform="rotate(-15 88 90)"/>
    <ellipse cx="83" cy="110" rx="4" ry="2.5" transform="rotate(-15 83 110)"/>
    <ellipse cx="112" cy="90" rx="4" ry="2.5" transform="rotate(15 112 90)"/>
    <ellipse cx="117" cy="110" rx="4" ry="2.5" transform="rotate(15 117 110)"/>
    <ellipse cx="100" cy="85" rx="4" ry="2.5"/>
    <ellipse cx="100" cy="105" rx="4" ry="2.5"/>
    <ellipse cx="100" cy="125" rx="4" ry="2.5"/>
    <ellipse cx="100" cy="145" rx="4" ry="2.5"/>
    <ellipse cx="72" cy="80" rx="5" ry="3" transform="rotate(-30 72 80)"/>
    <ellipse cx="128" cy="80" rx="5" ry="3" transform="rotate(30 128 80)"/>
  </g>
  <path d="M70 170 L 130 170 L 124 196 L 76 196 Z" fill="url(#thymePot)"/>
  <ellipse cx="100" cy="170" rx="30" ry="6" fill="#0D0E0B"/>
  <ellipse cx="100" cy="168" rx="28" ry="5" fill="#1A1B17"/>
</svg>`,

    mint: `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="mintA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#A4DF6E"/>
      <stop offset="1" stop-color="#5C9A48"/>
    </linearGradient>
    <linearGradient id="mintB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C8EE92"/>
      <stop offset="1" stop-color="#7CB85A"/>
    </linearGradient>
    <linearGradient id="mintPot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1A1B17"/>
      <stop offset="1" stop-color="#0D0E0B"/>
    </linearGradient>
  </defs>
  <g stroke="#5C9A48" stroke-width="2.5" stroke-linecap="round" fill="none">
    <path d="M100 168 V 60"/>
    <path d="M100 130 L 70 100"/>
    <path d="M100 130 L 130 100"/>
    <path d="M100 100 L 75 70"/>
    <path d="M100 100 L 125 70"/>
  </g>
  <!-- Pointed serrated mint leaves -->
  <g fill="url(#mintA)">
    <path d="M70 100 C 60 90, 58 80, 65 70 C 72 78, 76 88, 70 100 Z"/>
    <path d="M130 100 C 140 90, 142 80, 135 70 C 128 78, 124 88, 130 100 Z"/>
    <path d="M100 130 C 90 124, 84 116, 86 105 C 96 110, 102 118, 100 130 Z"/>
    <path d="M100 130 C 110 124, 116 116, 114 105 C 104 110, 98 118, 100 130 Z"/>
  </g>
  <g fill="url(#mintB)">
    <path d="M75 70 C 65 64, 60 56, 64 46 C 73 50, 79 58, 75 70 Z"/>
    <path d="M125 70 C 135 64, 140 56, 136 46 C 127 50, 121 58, 125 70 Z"/>
    <path d="M100 60 C 92 52, 88 42, 92 32 C 100 36, 106 48, 100 60 Z"/>
  </g>
  <g stroke="#0D0E0B" stroke-width=".8" fill="none" opacity=".35">
    <path d="M64 90 L 68 80"/><path d="M136 90 L 132 80"/>
    <path d="M94 124 L 96 113"/><path d="M106 124 L 104 113"/>
  </g>
  <path d="M70 170 L 130 170 L 124 196 L 76 196 Z" fill="url(#mintPot)"/>
  <ellipse cx="100" cy="170" rx="30" ry="6" fill="#0D0E0B"/>
  <ellipse cx="100" cy="168" rx="28" ry="5" fill="#1A1B17"/>
</svg>`,
  };

  // Standard weights template — moisture + temperature lead for most herbs.
  const STANDARD_WEIGHTS = {
    moisture_pct:  0.30,
    temperature_c: 0.20,
    light_lux:     0.20,
    humidity_pct:  0.10,
    ph:            0.10,
    reservoir:     0.10,
  };

  const PLANTS = {
    basil: {
      id: 'basil',
      common_name: 'Basil',
      scientific_name: 'Ocimum basilicum',
      illustration: 'basil',
      live: true,
      notes: 'Basil loves warm conditions, moist but well-drained soil, ' +
             'a pH around 6.0–7.0, and at least 4–6+ hours of strong, ' +
             'direct light per day. Avoid letting soil dry out completely.',
      info: {
        moisture:       'Keep soil consistently moist, never soggy. Water when the top centimetre feels dry.',
        light:          '4–6+ hours of direct, strong light per day. A sunny south-facing windowsill works well.',
        temperature:    'Warm room temperatures, 18–27 °C. Avoid cold draughts and night temps below 13 °C.',
        grow_time:      '6–8 weeks from seed to first usable harvest.',
        harvest_timing: 'Pinch top leaves once the plant has 6+ true leaves. Regular light harvesting promotes bushiness.',
        care_notes:     'Pinch flower buds to keep leaves tender. Rotate the pot every few days for even growth.',
      },
      ranges: {
        moisture_pct:  { ideal: [40, 70],   ok: [25, 85] },
        temperature_c: { ideal: [18, 27],   ok: [13, 32] },
        humidity_pct:  { ideal: [40, 60],   ok: [30, 80] },
        ph:            { ideal: [6.0, 7.0], ok: [5.5, 7.5] },
        light_lux:     { ideal: [10000, 50000], ok: [3000, 100000] },
      },
      weights: { ...STANDARD_WEIGHTS },
      moisture_threshold_pct: 35,
      watering_cooldown_s: 600,
      grow_time_days:    { seedling: 14, vegetative: 35, mature: 55, harvest: 56 },
      harvest_window_days: [56, 120],
      seasonality: { warmth_sensitive: true,  uk_best_months: [5, 6, 7, 8, 9] },
    },

    parsley: {
      id: 'parsley',
      common_name: 'Parsley',
      scientific_name: 'Petroselinum crispum',
      illustration: 'parsley',
      live: false,
      notes: 'Parsley is hardy, biennial, and tolerates a wide range of UK conditions. ' +
             'Likes moist, well-drained soil and partial shade through full sun.',
      info: {
        moisture:       'Even moisture. Drought makes leaves tough; avoid waterlogging.',
        light:          'Tolerates partial shade; 3–5 hours of direct sun is plenty.',
        temperature:    'Comfortable from 10–24 °C; can survive light frost.',
        grow_time:      '10–12 weeks from seed; slow germination (up to 3 weeks).',
        harvest_timing: 'Pick outer stems first once the plant has 8+ stems. Regular picking keeps it productive.',
        care_notes:     'Pinch off flower stalks in the second year to extend leaf harvest.',
      },
      ranges: {
        moisture_pct:  { ideal: [45, 75],   ok: [30, 90] },
        temperature_c: { ideal: [13, 22],   ok: [5, 28] },
        humidity_pct:  { ideal: [45, 65],   ok: [30, 85] },
        ph:            { ideal: [6.0, 7.0], ok: [5.5, 7.5] },
        light_lux:     { ideal: [8000, 35000], ok: [2000, 80000] },
      },
      weights: { ...STANDARD_WEIGHTS },
      moisture_threshold_pct: 40,
      watering_cooldown_s: 600,
      grow_time_days:    { seedling: 21, vegetative: 50, mature: 75, harvest: 76 },
      harvest_window_days: [76, 240],
      seasonality: { warmth_sensitive: false, uk_best_months: [3, 4, 5, 6, 7, 8, 9, 10] },
    },

    thyme: {
      id: 'thyme',
      common_name: 'Thyme',
      scientific_name: 'Thymus vulgaris',
      illustration: 'thyme',
      live: false,
      notes: 'Thyme is a hardy Mediterranean perennial that prefers it dry and bright. ' +
             'Drought-tolerant once established and very forgiving in UK gardens.',
      info: {
        moisture:       'Likes it on the drier side. Let the top 2–3 cm dry between waterings.',
        light:          'Full sun, 5+ hours direct. Tolerates poor soils.',
        temperature:    '10–28 °C in growing season; hardy down to light frost outdoors.',
        grow_time:      '12–14 weeks from seed; faster from cuttings.',
        harvest_timing: 'Snip sprigs anytime once established. Best flavour just before flowering.',
        care_notes:     'Avoid heavy feeding — thyme prefers lean soil. Trim back after flowering.',
      },
      ranges: {
        moisture_pct:  { ideal: [25, 50],   ok: [15, 70] },
        temperature_c: { ideal: [16, 26],   ok: [8, 32] },
        humidity_pct:  { ideal: [30, 55],   ok: [20, 75] },
        ph:            { ideal: [6.0, 8.0], ok: [5.5, 8.5] },
        light_lux:     { ideal: [15000, 60000], ok: [5000, 120000] },
      },
      weights: { ...STANDARD_WEIGHTS },
      moisture_threshold_pct: 25,
      watering_cooldown_s: 1200,
      grow_time_days:    { seedling: 28, vegetative: 60, mature: 90, harvest: 91 },
      harvest_window_days: [91, 365],
      seasonality: { warmth_sensitive: false, uk_best_months: [4, 5, 6, 7, 8, 9, 10] },
    },

    mint: {
      id: 'mint',
      common_name: 'Mint',
      scientific_name: 'Mentha',
      illustration: 'mint',
      live: false,
      notes: 'Mint is vigorous and easy. Loves moisture and is happy in partial shade. ' +
             'Grow in its own pot — it will out-compete neighbours otherwise.',
      info: {
        moisture:       'Likes consistently moist soil. Wilts quickly if dry.',
        light:          'Partial shade through full sun. 3+ hours of direct light is enough.',
        temperature:    '13–24 °C ideal; hardy through UK winters as a perennial.',
        grow_time:      '8–10 weeks from cutting; spreads fast.',
        harvest_timing: 'Pick sprigs anytime once established. Frequent cutting keeps it tidy.',
        care_notes:     'Confine roots to a pot to stop it spreading. Pinch flower stalks to extend leaf production.',
      },
      ranges: {
        moisture_pct:  { ideal: [50, 80],   ok: [35, 90] },
        temperature_c: { ideal: [15, 24],   ok: [8, 30] },
        humidity_pct:  { ideal: [50, 70],   ok: [35, 90] },
        ph:            { ideal: [6.0, 7.0], ok: [5.5, 7.5] },
        light_lux:     { ideal: [5000, 30000], ok: [1500, 70000] },
      },
      weights: { ...STANDARD_WEIGHTS },
      moisture_threshold_pct: 45,
      watering_cooldown_s: 600,
      grow_time_days:    { seedling: 14, vegetative: 35, mature: 60, harvest: 61 },
      harvest_window_days: [61, 365],
      seasonality: { warmth_sensitive: false, uk_best_months: [3, 4, 5, 6, 7, 8, 9, 10, 11] },
    },
  };

  // Test Mode presets. Each just populates the manual input fields; you can
  // edit any value afterward. ph_present=false means "no pH sensor attached".
  const SCENARIOS = {
    healthy: {
      label: 'Healthy basil',
      reading: {
        moisture_pct: 58, temperature_c: 22.4, humidity_pct: 52,
        ph: 6.6, light_lux: 22000, reservoir_level: 85,
      },
      last_watered_minutes_ago: 90,
      ph_present: true,
    },
    dry: {
      label: 'Dry soil',
      reading: {
        moisture_pct: 22, temperature_c: 26.1, humidity_pct: 38,
        ph: 6.5, light_lux: 18000, reservoir_level: 60,
      },
      last_watered_minutes_ago: 720,
      ph_present: true,
    },
    overly_wet: {
      label: 'Overly wet soil',
      reading: {
        moisture_pct: 92, temperature_c: 22.0, humidity_pct: 75,
        ph: 6.6, light_lux: 20000, reservoir_level: 80,
      },
      last_watered_minutes_ago: 20,
      ph_present: true,
    },
    low_reservoir: {
      label: 'Low reservoir',
      reading: {
        moisture_pct: 44, temperature_c: 23.0, humidity_pct: 49,
        ph: 6.4, light_lux: 24000, reservoir_level: 12,
      },
      last_watered_minutes_ago: 45,
      ph_present: true,
    },
    poor_light: {
      label: 'Poor light',
      reading: {
        moisture_pct: 50, temperature_c: 22.0, humidity_pct: 52,
        ph: 6.6, light_lux: 1500, reservoir_level: 80,
      },
      last_watered_minutes_ago: 120,
      ph_present: true,
    },
    low_temp: {
      label: 'Low temperature',
      reading: {
        moisture_pct: 50, temperature_c: 10.5, humidity_pct: 50,
        ph: 6.6, light_lux: 20000, reservoir_level: 80,
      },
      last_watered_minutes_ago: 90,
      ph_present: true,
    },
    high_temp: {
      label: 'High temperature',
      reading: {
        moisture_pct: 38, temperature_c: 34.5, humidity_pct: 32,
        ph: 6.5, light_lux: 60000, reservoir_level: 70,
      },
      last_watered_minutes_ago: 180,
      ph_present: true,
    },
    low_ph: {
      label: 'Low soil pH',
      reading: {
        moisture_pct: 55, temperature_c: 22.0, humidity_pct: 50,
        ph: 4.8, light_lux: 22000, reservoir_level: 80,
      },
      last_watered_minutes_ago: 90,
      ph_present: true,
    },
    high_ph: {
      label: 'High soil pH',
      reading: {
        moisture_pct: 55, temperature_c: 22.0, humidity_pct: 50,
        ph: 8.4, light_lux: 22000, reservoir_level: 80,
      },
      last_watered_minutes_ago: 90,
      ph_present: true,
    },
  };

  function getPlant(id) {
    if (!PLANTS[id]) throw new Error('Unknown plant: ' + id);
    return PLANTS[id];
  }

  function listPlants() {
    return Object.values(PLANTS).map(p => ({
      id: p.id, common_name: p.common_name, live: !!p.live,
    }));
  }

  root.HerbPlants = { PLANTS, SCENARIOS, ILLUSTRATIONS, getPlant, listPlants };
})(window);
