/* Herb seasonality, UK-oriented.
 *
 * Practical growing guidance: detect current season from the date, then
 * rate each herb's suitability with a short tip. Basil is warmth-sensitive;
 * parsley, thyme and mint are more forgiving and useful year-round
 * (especially indoors).
 */
(function (root) {

  // Northern-hemisphere meteorological calendar (matches UK convention).
  function currentSeason(date = new Date()) {
    const m = date.getMonth() + 1;  // 1..12
    if (m >= 3 && m <= 5)  return 'Spring';
    if (m >= 6 && m <= 8)  return 'Summer';
    if (m >= 9 && m <= 11) return 'Autumn';
    return 'Winter';
  }

  // Tiers: Excellent / Good / OK / Avoid — sorted by suitability.
  const TIER_RANK = { Excellent: 0, Good: 1, OK: 2, Avoid: 3 };

  // Per-herb suitability per season for UK growers.
  const TABLE = {
    basil: {
      Spring: { tier: 'Good',      tip: 'Start indoors on a sunny windowsill; wait until late May before moving outside.' },
      Summer: { tier: 'Excellent', tip: 'Peak basil weather. Outdoors in a warm spot or in a sunny kitchen.' },
      Autumn: { tier: 'OK',        tip: 'Keep indoors and bright; cool nights will slow growth. Don\'t let it dry out.' },
      Winter: { tier: 'Avoid',     tip: 'Outdoors is a no. Indoors only with strong supplementary light and warmth.' },
    },
    parsley: {
      Spring: { tier: 'Excellent', tip: 'Sow now — parsley loves the long cool light of UK spring.' },
      Summer: { tier: 'Good',      tip: 'Keep it well-watered in heat; it may bolt if very hot and dry.' },
      Autumn: { tier: 'Good',      tip: 'Still productive outdoors. A second autumn sowing overwinters under a cloche.' },
      Winter: { tier: 'OK',        tip: 'Slow but steady on a cool windowsill. Indoor pots stay productive.' },
    },
    thyme: {
      Spring: { tier: 'Good',      tip: 'Plant out once the worst frosts have passed. Loves a sunny, dry spot.' },
      Summer: { tier: 'Excellent', tip: 'Sunshine + lean soil = peak flavour. Trim after flowering.' },
      Autumn: { tier: 'Good',      tip: 'Keep harvesting; outdoor plants are hardy through the cool months.' },
      Winter: { tier: 'OK',        tip: 'Hardy outdoors but slow. Indoors stays useful all winter.' },
    },
    mint: {
      Spring: { tier: 'Excellent', tip: 'Vigorous spring growth. Keep contained — pot only, never in a bed.' },
      Summer: { tier: 'Excellent', tip: 'Easy and productive. Pinch off flower stalks to keep leaves coming.' },
      Autumn: { tier: 'Good',      tip: 'Dies back outdoors but returns. Indoor cuttings root in water in days.' },
      Winter: { tier: 'OK',        tip: 'Outdoor mint goes dormant; an indoor pot gives you a steady supply.' },
    },
  };

  // Estimated grow time strings shown alongside each herb in the season card.
  const GROW_HINT = {
    basil:   '6–8 weeks indoors',
    parsley: '10–12 weeks (slow germ.)',
    thyme:   '12–14 weeks from seed',
    mint:    '8–10 weeks from cutting',
  };

  function herbSuitability(season) {
    return Object.entries(TABLE).map(([id, by]) => {
      const s = by[season] || { tier: 'OK', tip: '' };
      return {
        id,
        tier: s.tier,
        tip: s.tip,
        grow_hint: GROW_HINT[id] || '',
      };
    }).sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  }

  root.SproutSeasonality = { currentSeason, herbSuitability, TABLE };
})(window);
