/* Day/night grow cycle.
 *
 * The cycle is derived from the user's local clock. Day = 06:00..20:00,
 * night = the rest. The five sub-buckets (sunrise / morning / midday /
 * sunset / night) only drive the Home banner icon + label; the binary
 * day/night decision is what feeds the live targets and watering logic.
 *
 * Cycle adjustments:
 *   - At night, light targets drop to near-zero (the plant rests).
 *   - At night, temperature targets drop ~4 °C (cooler ambient).
 *   - At night, the auto-water moisture threshold drops 10 percentage
 *     points (less transpiration = less water needed) and the cooldown
 *     between automatic waterings doubles.
 */
(function (root) {

  const DAY_START_HOUR = 6;
  const DAY_END_HOUR   = 20;

  function currentCycle(date) {
    const d = date || new Date();
    const h = d.getHours();
    return (h >= DAY_START_HOUR && h < DAY_END_HOUR) ? 'day' : 'night';
  }

  // Granular bucket used only for the icon + label.
  function timeOfDayBucket(date) {
    const d = date || new Date();
    const h = d.getHours();
    if (h >= 5  && h < 8)  return 'sunrise';
    if (h >= 8  && h < 11) return 'morning';
    if (h >= 11 && h < 17) return 'midday';
    if (h >= 17 && h < 20) return 'sunset';
    return 'night';
  }

  // Apply cycle-aware adjustments to the plant's ideal/ok ranges.
  function adjustedRanges(plant, cycle) {
    if (cycle !== 'night') return plant.ranges;
    const r = { ...plant.ranges };
    r.light_lux = { ideal: [0, 50], ok: [0, 300] };
    if (plant.ranges.temperature_c) {
      const t = plant.ranges.temperature_c;
      r.temperature_c = {
        ideal: [t.ideal[0] - 4, t.ideal[1] - 4],
        ok:    [t.ok[0]    - 4, t.ok[1]    - 4],
      };
    }
    return r;
  }

  // Apply cycle-aware adjustments to the auto-water settings.
  function adjustedWateringParams(settings, cycle) {
    if (cycle !== 'night') return settings;
    return {
      ...settings,
      moisture_threshold_pct: Math.max(15, settings.moisture_threshold_pct - 10),
      watering_cooldown_s:    settings.watering_cooldown_s * 2,
    };
  }

  function timeOfDayLabel(date) {
    return (date || new Date()).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    });
  }

  function bucketLabel(bucket) {
    return ({
      sunrise: 'Sunrise · day cycle starting',
      morning: 'Morning · day cycle',
      midday:  'Midday · day cycle',
      sunset:  'Sunset · winding down',
      night:   'Night cycle',
    })[bucket] || 'Day cycle';
  }

  // Inline SVG icons keyed by bucket. Tiny and stroke-based so they pick
  // up `currentColor` from the surrounding text.
  const ICONS = {
    sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 3v5"/><path d="M8 7l4-4 4 4"/><path d="M2 22h20"/></svg>',
    morning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="4"/><path d="M12 3v3M3 13h3M18 13h3M5.6 6.6l2.1 2.1M16.3 6.6l-2.1 2.1"/></svg>',
    midday:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2"/></svg>',
    sunset:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 9V3"/><path d="M8 6l4 4 4-4"/><path d="M2 22h20"/></svg>',
    night:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/><circle cx="17" cy="6" r=".7" fill="currentColor"/><circle cx="19" cy="10" r=".5" fill="currentColor"/></svg>',
  };

  // Short summary of the cycle's effective targets, for the Home banner.
  function targetsSummary(plant, cycle) {
    const r = adjustedRanges(plant, cycle);
    const t = r.temperature_c;
    const l = r.light_lux;
    if (cycle === 'night') {
      return `Night targets · light ≈ 0 lx · temp ${t.ideal[0]}–${t.ideal[1]} °C`;
    }
    return `Day targets · light ${l.ideal[0].toLocaleString()}+ lx · temp ${t.ideal[0]}–${t.ideal[1]} °C`;
  }

  root.SproutCycle = {
    currentCycle, timeOfDayBucket, bucketLabel, timeOfDayLabel,
    adjustedRanges, adjustedWateringParams, targetsSummary, ICONS,
  };
})(window);
