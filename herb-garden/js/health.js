/* Plant Health (1–100) — transparent, weighted sub-scores.
 *
 * For each metric m with value v and ranges {ideal, ok}:
 *   v === null               -> excluded from the average
 *   v in ideal               -> sub-score 100
 *   v in ok but outside ideal-> linear taper 100 -> 50
 *   v outside ok             -> linear taper 50 -> 0 across an equal-width buffer
 *
 * Reservoir is special: sub-score = clamp(level%, 0, 100).
 *
 * Explanation = the metric with the lowest sub-score, phrased plainly
 * ("Low moisture", "High temperature", "Reservoir low", "Thriving", "Doing well").
 */
(function (root) {

  const LABEL = {
    moisture_pct:  'moisture',
    temperature_c: 'temperature',
    humidity_pct:  'humidity',
    ph:            'pH',
    light_lux:     'light',
    reservoir:     'reservoir',
  };

  function rangeSubscore(value, ideal, ok) {
    if (value == null) return null;
    const [imin, imax] = ideal;
    const [omin, omax] = ok;
    if (value >= imin && value <= imax) return 100;
    if (value < imin) {
      if (value >= omin) {
        const frac = imin === omin ? 1 : (value - omin) / (imin - omin);
        return 50 + 50 * frac;
      }
      const buf = imin - omin;
      if (buf <= 0) return 0;
      const frac = (omin - value) / buf;
      return Math.max(0, 50 - 50 * frac);
    }
    if (value <= omax) {
      const frac = omax === imax ? 1 : (omax - value) / (omax - imax);
      return 50 + 50 * frac;
    }
    const buf = omax - imax;
    if (buf <= 0) return 0;
    const frac = (value - omax) / buf;
    return Math.max(0, 50 - 50 * frac);
  }

  function reservoirSubscore(level) {
    if (level == null) return null;
    return Math.max(0, Math.min(100, level));
  }

  function computeHealth(plant, reading) {
    if (!reading) {
      return { score: 1, subscores: {}, explanation: 'No data',
               worst: null, summary: 'Waiting for sensor data…' };
    }
    const subs = {};
    const weights = {};
    for (const [m, rng] of Object.entries(plant.ranges)) {
      const s = rangeSubscore(reading[m], rng.ideal, rng.ok);
      if (s != null) { subs[m] = s; weights[m] = plant.weights[m]; }
    }
    const res = reservoirSubscore(reading.reservoir_level);
    if (res != null) { subs.reservoir = res; weights.reservoir = plant.weights.reservoir; }

    if (Object.keys(subs).length === 0) {
      return { score: 1, subscores: {}, explanation: 'No data',
               worst: null, summary: 'Waiting for sensor data…' };
    }

    const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
    const score = Math.max(1, Math.min(100, Math.round(
      Object.keys(subs).reduce((acc, m) => acc + subs[m] * weights[m], 0) / totalW
    )));

    let worst = null, worstVal = Infinity;
    for (const [m, v] of Object.entries(subs)) {
      if (v < worstVal) { worst = m; worstVal = v; }
    }

    let explanation, summary;
    const plantName = plant.common_name.toLowerCase();
    const PHRASES = {
      'Low moisture':    `${plantName} soil is dry`,
      'High moisture':   `${plantName} soil is too wet`,
      'Low temperature': `it’s too cool for your ${plantName}`,
      'High temperature':`it’s too warm for your ${plantName}`,
      'Low humidity':    'the air is dry',
      'High humidity':   'the air is humid',
      'Low light':       `your ${plantName} needs more light`,
      'High light':      `your ${plantName} is in very strong light`,
      'Low pH':          'soil pH is below the ideal range',
      'High pH':         'soil pH is above the ideal range',
    };
    if (Object.values(subs).every(v => v >= 80)) {
      explanation = 'Thriving';
      summary = `Your ${plantName} is thriving`;
    } else if (worstVal >= 60) {
      explanation = 'Doing well';
      summary = `Your ${plantName} is doing well`;
    } else if (worst === 'reservoir') {
      explanation = 'Reservoir low';
      summary = `Your ${plantName} needs a refill soon`;
    } else {
      const ideal = plant.ranges[worst].ideal;
      const val = reading[worst];
      const mid = (ideal[0] + ideal[1]) / 2;
      const direction = val < mid ? 'Low' : 'High';
      explanation = `${direction} ${LABEL[worst]}`;
      const phrase = PHRASES[explanation];
      summary = phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1)
                       : `Your ${plantName} could use attention`;
    }

    return {
      score,
      subscores: Object.fromEntries(Object.entries(subs).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      explanation, summary, worst,
    };
  }

  // bucket a single value relative to a plant range (for UI coloring)
  function bucket(plant, metric, value) {
    if (value == null) return 'missing';
    const r = plant.ranges[metric];
    if (!r) return 'good';
    if (value >= r.ideal[0] && value <= r.ideal[1]) return 'good';
    if (value >= r.ok[0]    && value <= r.ok[1])    return 'warn';
    return 'bad';
  }

  root.HerbHealth = { computeHealth, bucket, LABEL };
})(window);
